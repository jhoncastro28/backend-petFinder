import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocationService } from './location.service';
import { Report } from '../../domain/entities/report.entity';
import { PetSize, PetType, PostStatus, PostType } from '../../domain/enums';

const mockReportRepository = () => ({
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  findByUserId: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  countActive: jest.fn(),
});

const mockConfigService = () => ({
  get: jest.fn((key: string) => {
    const config: Record<string, string> = {
      'location.geocodingBaseUrl': 'https://nominatim.openstreetmap.org',
      'location.defaultCountryCode': 'co',
      'location.userAgent': 'PetFinder/1.0',
    };
    return config[key];
  }),
});

const makeReport = (lat: number, lon: number): Report =>
  new Report(
    `report-${lat}`,
    'user-1',
    PetType.DOG,
    PostType.LOST,
    PostStatus.ACTIVE,
    'Perro perdido',
    'marrón',
    'Labrador',
    PetSize.MEDIUM,
    '3001234567',
    'https://storage.blob.core.windows.net/img/r.jpg',
    lat,
    lon,
    new Date(),
    new Date(),
  );

describe('LocationService', () => {
  let service: LocationService;
  let reportRepo: ReturnType<typeof mockReportRepository>;

  beforeEach(async () => {
    reportRepo = mockReportRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationService,
        { provide: 'IReportRepository', useValue: reportRepo },
        { provide: ConfigService, useValue: mockConfigService() },
      ],
    }).compile();

    service = module.get<LocationService>(LocationService);
  });

  describe('searchAddress', () => {
    it('should return geocoding results for valid query', async () => {
      const mockPayload = [{ display_name: 'Tunja, Boyacá', lat: '5.535', lon: '-73.367' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockPayload),
      });

      const result = await service.searchAddress('Tunja', 3);

      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe('Tunja, Boyacá');
      expect(result[0].lat).toBe(5.535);
      expect(result[0].lon).toBe(-73.367);
    });

    it('should throw BadRequestException when query is too short', async () => {
      await expect(service.searchAddress('Tu')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when query is empty', async () => {
      await expect(service.searchAddress('')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when geocoding service fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false });

      await expect(service.searchAddress('Tunja', 3)).rejects.toThrow(BadRequestException);
    });

    it('should clamp limit to max 10', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue([]) });

      await service.searchAddress('Tunja', 50);

      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(url).toContain('limit=10');
    });
  });

  describe('reverseGeocode', () => {
    it('should return location for valid coordinates', async () => {
      const mockPayload = { display_name: 'Tunja, Boyacá', lat: '5.535', lon: '-73.367' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockPayload),
      });

      const result = await service.reverseGeocode(5.535, -73.367);

      expect(result).not.toBeNull();
      expect(result!.displayName).toBe('Tunja, Boyacá');
    });

    it('should return null when display_name is empty', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ display_name: '', lat: '5', lon: '-73' }),
      });

      const result = await service.reverseGeocode(5, -73);
      expect(result).toBeNull();
    });

    it('should throw BadRequestException for invalid latitude', async () => {
      await expect(service.reverseGeocode(91, -73)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid longitude', async () => {
      await expect(service.reverseGeocode(5, 181)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when service fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false });
      await expect(service.reverseGeocode(5.5, -73.3)).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveCoordinates', () => {
    it('should return coordinates when lat and lon provided', async () => {
      const result = await service.resolveCoordinates({ lat: 5.5, lon: -73.3 });
      expect(result).toEqual({ lat: 5.5, lon: -73.3 });
    });

    it('should throw BadRequestException when only lat is provided', async () => {
      await expect(service.resolveCoordinates({ lat: 5.5 })).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when only lon is provided', async () => {
      await expect(service.resolveCoordinates({ lon: -73 })).rejects.toThrow(BadRequestException);
    });

    it('should resolve via locationQuery geocoding', async () => {
      const mockPayload = [{ display_name: 'Tunja', lat: '5.535', lon: '-73.367' }];
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(mockPayload) });

      const result = await service.resolveCoordinates({ locationQuery: 'Tunja Boyacá' });
      expect(result).toEqual({ lat: 5.535, lon: -73.367 });
    });

    it('should return null when allowEmpty is true and no coords given', async () => {
      const result = await service.resolveCoordinates({}, { allowEmpty: true });
      expect(result).toBeNull();
    });

    it('should throw when no coords and allowEmpty is false', async () => {
      await expect(service.resolveCoordinates({})).rejects.toThrow(BadRequestException);
    });
  });

  describe('findNearbyReports', () => {
    it('should return reports within radius', async () => {
      const reports = [makeReport(5.535, -73.367), makeReport(5.6, -73.4), makeReport(6.2, -72.0)];
      reportRepo.findAll.mockResolvedValue(reports);

      const result = await service.findNearbyReports({ lat: 5.535, lon: -73.367, radiusKm: 20 });

      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((entry) => expect(entry.distanceKm).toBeLessThanOrEqual(20));
    });

    it('should return empty data when no reports in radius', async () => {
      reportRepo.findAll.mockResolvedValue([makeReport(10, 10)]);

      const result = await service.findNearbyReports({ lat: 5.5, lon: -73.3, radiusKm: 1 });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it('should throw BadRequestException for invalid coordinates', async () => {
      await expect(service.findNearbyReports({ lat: 91, lon: -73 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should paginate results correctly', async () => {
      const reports = Array.from({ length: 5 }, (_, i) => makeReport(5.535 + i * 0.001, -73.367));
      reportRepo.findAll.mockResolvedValue(reports);

      const result = await service.findNearbyReports({
        lat: 5.535,
        lon: -73.367,
        radiusKm: 50,
        page: 1,
        limit: 2,
      });

      expect(result.data.length).toBeLessThanOrEqual(2);
      expect(result.pagination.limit).toBe(2);
    });

    it('should sort results by distance ascending', async () => {
      const reports = [makeReport(5.6, -73.367), makeReport(5.536, -73.367)];
      reportRepo.findAll.mockResolvedValue(reports);

      const result = await service.findNearbyReports({ lat: 5.535, lon: -73.367, radiusKm: 50 });

      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i].distanceKm).toBeGreaterThanOrEqual(result.data[i - 1].distanceKm);
      }
    });
  });
});
