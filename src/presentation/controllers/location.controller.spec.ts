import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LocationController } from './location.controller';
import { LocationService } from '../../application/services/location.service';

const mockLocationService = () => ({
  searchAddress: jest.fn(),
  reverseGeocode: jest.fn(),
  findNearbyReports: jest.fn(),
});

const geocodeResult = () => [{ displayName: 'Tunja, Boyacá', lat: 5.535, lon: -73.367 }];

const nearbyResult = () => ({
  data: [{ reportId: 'r-1', distanceKm: 1.2, lat: 5.535, lon: -73.367 }],
  pagination: {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
});

describe('LocationController', () => {
  let controller: LocationController;
  let service: ReturnType<typeof mockLocationService>;

  beforeEach(async () => {
    service = mockLocationService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LocationController],
      providers: [{ provide: LocationService, useValue: service }],
    }).compile();

    controller = module.get<LocationController>(LocationController);
  });

  describe('geocode', () => {
    it('should return geocoding results for valid query', async () => {
      service.searchAddress.mockResolvedValue(geocodeResult());

      const result = await controller.geocode('Tunja', '5');

      expect(service.searchAddress).toHaveBeenCalledWith('Tunja', 5);
      expect(result).toEqual(geocodeResult());
    });

    it('should throw BadRequestException for limit < 1', async () => {
      await expect(controller.geocode('Tunja', '0')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for limit > 10', async () => {
      await expect(controller.geocode('Tunja', '11')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-integer limit', async () => {
      await expect(controller.geocode('Tunja', '2.5')).rejects.toThrow(BadRequestException);
    });

    it('should use default limit of 5 when not specified', async () => {
      service.searchAddress.mockResolvedValue(geocodeResult());
      await controller.geocode('Tunja');
      expect(service.searchAddress).toHaveBeenCalledWith('Tunja', 5);
    });
  });

  describe('searchAddress', () => {
    it('should delegate to geocode', async () => {
      service.searchAddress.mockResolvedValue(geocodeResult());
      const result = await controller.searchAddress('Bogotá', '3');
      expect(service.searchAddress).toHaveBeenCalledWith('Bogotá', 3);
      expect(result).toEqual(geocodeResult());
    });
  });

  describe('reverseGeocode', () => {
    it('should return result for valid coordinates', async () => {
      const expected = { displayName: 'Tunja', lat: 5.535, lon: -73.367 };
      service.reverseGeocode.mockResolvedValue(expected);

      const result = await controller.reverseGeocode('5.535', '-73.367');

      expect(service.reverseGeocode).toHaveBeenCalledWith(5.535, -73.367);
      expect(result).toBe(expected);
    });

    it('should throw BadRequestException for non-numeric lat', async () => {
      await expect(controller.reverseGeocode('abc', '-73')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-numeric lon', async () => {
      await expect(controller.reverseGeocode('5.5', 'xyz')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when params are undefined', async () => {
      await expect(controller.reverseGeocode(undefined, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('nearby', () => {
    it('should return nearby reports for valid params', async () => {
      service.findNearbyReports.mockResolvedValue(nearbyResult());

      const result = await controller.nearby('5.535', '-73.367', '5', '1', '20');

      expect(service.findNearbyReports).toHaveBeenCalledWith(
        expect.objectContaining({ lat: 5.535, lon: -73.367, radiusKm: 5, page: 1, limit: 20 }),
      );
      expect(result).toEqual(nearbyResult());
    });

    it('should throw BadRequestException for non-numeric lat', async () => {
      await expect(controller.nearby('abc', '-73', '5', '1', '20')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for radiusKm = 0', async () => {
      await expect(controller.nearby('5.5', '-73', '0', '1', '20')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for page < 1', async () => {
      await expect(controller.nearby('5.5', '-73', '5', '0', '20')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for limit > 100', async () => {
      await expect(controller.nearby('5.5', '-73', '5', '1', '101')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should pass species and type filters to service', async () => {
      service.findNearbyReports.mockResolvedValue(nearbyResult());

      await controller.nearby('5.5', '-73', '5', '1', '10', 'dog' as any, 'lost' as any);

      expect(service.findNearbyReports).toHaveBeenCalledWith(
        expect.objectContaining({ species: 'dog', type: 'lost' }),
      );
    });
  });
});
