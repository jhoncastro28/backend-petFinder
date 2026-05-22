import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from '../../application/services/reports.service';
import { VisionService } from '../../application/services/vision.service';
import { AzureBlobStorageService } from '../../infrastructure/external-services/azure';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Report } from '../../domain/entities/report.entity';
import { PetSize, PetType, PostStatus, PostType } from '../../domain/enums';

const mockReportsService = () => ({
  createReport: jest.fn(),
  findAll: jest.fn(),
  search: jest.fn(),
  backfillEmbeddings: jest.fn(),
  exportDataset: jest.fn(),
  findMyReports: jest.fn(),
  getPublicStats: jest.fn(),
  findMatchesForReport: jest.fn(),
  generateReportSummary: jest.fn(),
  findById: jest.fn(),
  updateReport: jest.fn(),
  removeReport: jest.fn(),
  adminRemoveReport: jest.fn(),
});

const mockVisionService = () => ({
  isAvailable: jest.fn(),
  analyzeImage: jest.fn(),
});

const mockAzureService = () => ({
  uploadImage: jest.fn(),
});

const mockUser = () => ({ id: 'user-1', email: 'test@example.com', role: 'user' });

const makeReport = (): Report =>
  new Report(
    'report-1',
    'user-1',
    PetType.DOG,
    PostType.LOST,
    PostStatus.ACTIVE,
    'Perro perdido marrón',
    'marrón',
    'Labrador',
    PetSize.MEDIUM,
    '3001234567',
    'https://storage.blob.core.windows.net/img/r1.jpg',
    5.535,
    -73.367,
    new Date(),
    new Date(),
  );

const paginatedResult = (data: Report[] = [makeReport()]) => ({
  data,
  pagination: {
    page: 1,
    limit: 10,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
});

describe('ReportsController', () => {
  let controller: ReportsController;
  let reportsService: ReturnType<typeof mockReportsService>;
  let visionService: ReturnType<typeof mockVisionService>;
  let azureService: ReturnType<typeof mockAzureService>;

  beforeEach(async () => {
    reportsService = mockReportsService();
    visionService = mockVisionService();
    azureService = mockAzureService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: reportsService },
        { provide: VisionService, useValue: visionService },
        { provide: AzureBlobStorageService, useValue: azureService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReportsController>(ReportsController);
  });

  describe('getAiStatus', () => {
    it('should return available: true when vision service is available', () => {
      visionService.isAvailable.mockReturnValue(true);
      expect(controller.getAiStatus()).toEqual({ available: true });
    });

    it('should return available: false when vision service is unavailable', () => {
      visionService.isAvailable.mockReturnValue(false);
      expect(controller.getAiStatus()).toEqual({ available: false });
    });
  });

  describe('create', () => {
    it('should create a report and return it', async () => {
      const report = makeReport();
      reportsService.createReport.mockResolvedValue(report);
      const dto = {
        species: 'dog',
        type: 'lost',
        description: 'Perro perdido',
        lat: 5.5,
        lon: -73.3,
      };

      const result = await controller.create(mockUser() as any, dto as any);

      expect(reportsService.createReport).toHaveBeenCalledWith('user-1', dto);
      expect(result).toBe(report);
    });
  });

  describe('findAll', () => {
    it('should return paginated reports', async () => {
      const paginated = paginatedResult();
      reportsService.findAll.mockResolvedValue(paginated);

      const result = await controller.findAll('1', '10');

      expect(reportsService.findAll).toHaveBeenCalledWith(1, 10, expect.any(Object));
      expect(result).toBe(paginated);
    });

    it('should throw BadRequestException when page < 1', async () => {
      await expect(controller.findAll('0', '10')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when limit > 100', async () => {
      await expect(controller.findAll('1', '101')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when limit < 1', async () => {
      await expect(controller.findAll('1', '0')).rejects.toThrow(BadRequestException);
    });

    it('should pass optional filters to service', async () => {
      reportsService.findAll.mockResolvedValue(paginatedResult());

      await controller.findAll(
        '1',
        '10',
        'perro',
        'dog' as any,
        'lost' as any,
        'small' as any,
        'negro',
        'labrador',
      );

      expect(reportsService.findAll).toHaveBeenCalledWith(
        1,
        10,
        expect.objectContaining({ search: 'perro', species: 'dog', type: 'lost' }),
      );
    });
  });

  describe('search', () => {
    it('should throw BadRequestException when query is too short', async () => {
      await expect(controller.search('a')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when query is empty', async () => {
      await expect(controller.search('')).rejects.toThrow(BadRequestException);
    });

    it('should delegate search to reportsService', async () => {
      const response = {
        data: [],
        pagination: paginatedResult().pagination,
        isSemanticSearch: true,
      };
      reportsService.search.mockResolvedValue(response);

      const result = await controller.search('perro labrador', '1', '10');

      expect(reportsService.search).toHaveBeenCalledWith(
        'perro labrador',
        1,
        10,
        expect.any(Object),
      );
      expect(result).toBe(response);
    });

    it('should parse lat/lon/radiusKm and pass to service', async () => {
      reportsService.search.mockResolvedValue({
        data: [],
        pagination: paginatedResult().pagination,
        isSemanticSearch: false,
      });

      await controller.search('perro', '1', '10', '5.535', '-73.367', '20');

      expect(reportsService.search).toHaveBeenCalledWith(
        'perro',
        1,
        10,
        expect.objectContaining({ lat: 5.535, lon: -73.367, radiusKm: 20 }),
      );
    });

    it('should throw BadRequestException when page is invalid', async () => {
      await expect(controller.search('perro', '0', '10')).rejects.toThrow(BadRequestException);
    });
  });

  describe('backfillEmbeddings', () => {
    it('should call reportsService.backfillEmbeddings', async () => {
      reportsService.backfillEmbeddings.mockResolvedValue({ updated: 3, skipped: 0, errors: 0 });

      const result = await controller.backfillEmbeddings();

      expect(reportsService.backfillEmbeddings).toHaveBeenCalled();
      expect(result).toEqual({ updated: 3, skipped: 0, errors: 0 });
    });
  });

  describe('exportJson', () => {
    it('should return dataset rows', async () => {
      const rows = [
        {
          id: 'r1',
          species: 'dog',
          type: 'lost',
          status: 'active',
          breed: 'lab',
          createdAt: '2025-01-01',
          lat: 5.5,
          lon: -73.3,
          city: null,
          neighborhood: null,
        },
      ];
      reportsService.exportDataset.mockResolvedValue(rows);

      const result = await controller.exportJson();

      expect(reportsService.exportDataset).toHaveBeenCalled();
      expect(result).toBe(rows);
    });
  });

  describe('exportCsv', () => {
    it('should generate CSV with header and rows', async () => {
      const rows = [
        {
          id: 'r1',
          species: 'dog',
          type: 'lost',
          status: 'active',
          breed: 'lab',
          createdAt: '2025-01-01',
          lat: 5.5,
          lon: -73.3,
          city: 'Tunja',
          neighborhood: 'Centro',
        },
      ];
      reportsService.exportDataset.mockResolvedValue(rows);

      const result = await controller.exportCsv();

      expect(typeof result).toBe('string');
      expect(result).toContain('id,species,type,status');
      expect(result).toContain('r1');
    });

    it('should handle null city and neighborhood in CSV', async () => {
      const rows = [
        {
          id: 'r1',
          species: 'dog',
          type: 'lost',
          status: 'active',
          breed: 'lab',
          createdAt: '2025-01-01',
          lat: 5.5,
          lon: -73.3,
          city: null,
          neighborhood: null,
        },
      ];
      reportsService.exportDataset.mockResolvedValue(rows);

      const result = await controller.exportCsv();
      expect(result).toContain('""');
    });
  });

  describe('findMyReports', () => {
    it('should return reports of the authenticated user', async () => {
      const reports = [makeReport()];
      reportsService.findMyReports.mockResolvedValue(reports);

      const result = await controller.findMyReports(mockUser() as any);

      expect(reportsService.findMyReports).toHaveBeenCalledWith('user-1');
      expect(result).toBe(reports);
    });
  });

  describe('getPublicStats', () => {
    it('should return public statistics', async () => {
      const stats = { lost: 5, found: 3, resolved: 2, totalActive: 8 };
      reportsService.getPublicStats.mockResolvedValue(stats);

      const result = await controller.getPublicStats();

      expect(reportsService.getPublicStats).toHaveBeenCalled();
      expect(result).toEqual(stats);
    });
  });

  describe('findMatches', () => {
    it('should return matches for a report', async () => {
      const matches = [Object.assign(makeReport(), { similarityScore: 0.85 })];
      reportsService.findMatchesForReport.mockResolvedValue(matches);

      const result = await controller.findMatches('report-1', '6');

      expect(reportsService.findMatchesForReport).toHaveBeenCalledWith('report-1', 6);
      expect(result).toEqual({ data: matches });
    });

    it('should throw BadRequestException when limit > 20', async () => {
      await expect(controller.findMatches('report-1', '21')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when limit < 1', async () => {
      await expect(controller.findMatches('report-1', '0')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSummary', () => {
    it('should return AI summary for report', async () => {
      reportsService.generateReportSummary.mockResolvedValue('Se reporta perro perdido marrón.');

      const result = await controller.getSummary('report-1');

      expect(reportsService.generateReportSummary).toHaveBeenCalledWith('report-1');
      expect(result).toEqual({ summary: 'Se reporta perro perdido marrón.' });
    });
  });

  describe('findOne', () => {
    it('should return a report by id', async () => {
      const report = makeReport();
      reportsService.findById.mockResolvedValue(report);

      const result = await controller.findOne('report-1');

      expect(reportsService.findById).toHaveBeenCalledWith('report-1');
      expect(result).toBe(report);
    });
  });

  describe('update', () => {
    it('should update a report and return it', async () => {
      const report = makeReport();
      reportsService.updateReport.mockResolvedValue(report);
      const dto = { description: 'Actualizado' };

      const result = await controller.update('report-1', mockUser() as any, dto as any);

      expect(reportsService.updateReport).toHaveBeenCalledWith('report-1', 'user-1', dto);
      expect(result).toBe(report);
    });
  });

  describe('remove', () => {
    it('should soft-delete a report', async () => {
      reportsService.removeReport.mockResolvedValue(undefined);

      await controller.remove('report-1', mockUser() as any);

      expect(reportsService.removeReport).toHaveBeenCalledWith('report-1', 'user-1');
    });
  });

  describe('adminRemove', () => {
    it('should call adminRemoveReport', async () => {
      reportsService.adminRemoveReport.mockResolvedValue(undefined);

      await controller.adminRemove('report-1');

      expect(reportsService.adminRemoveReport).toHaveBeenCalledWith('report-1');
    });
  });

  describe('uploadImage', () => {
    it('should throw BadRequestException when no file provided', async () => {
      await expect(controller.uploadImage(mockUser() as any, null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should upload image and return result', async () => {
      const uploadResult = {
        imageId: 'img-1',
        imageUrl: 'https://blob.core.windows.net/img/1.jpg',
        signedUrl: 'https://blob?sig=x',
      };
      azureService.uploadImage.mockResolvedValue(uploadResult);
      const file = { buffer: Buffer.from('img'), originalname: 'test.jpg', mimetype: 'image/jpeg' };

      const result = await controller.uploadImage(mockUser() as any, file as any);

      expect(azureService.uploadImage).toHaveBeenCalledWith(file, 'reports', 'user-1');
      expect(result).toEqual({
        imageId: 'img-1',
        imageUrl: uploadResult.imageUrl,
        signedUrl: uploadResult.signedUrl,
      });
    });
  });

  describe('analyzeImage', () => {
    it('should throw BadRequestException when no file provided', async () => {
      await expect(controller.analyzeImage(null)).rejects.toThrow(BadRequestException);
    });

    it('should call visionService.analyzeImage', async () => {
      const analysis = {
        species: 'dog',
        color: 'marrón',
        breed: 'Labrador',
        confidence: 'high',
        aiAvailable: true,
        message: null,
      };
      visionService.analyzeImage.mockResolvedValue(analysis);
      const file = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' };

      const result = await controller.analyzeImage(file as any);

      expect(visionService.analyzeImage).toHaveBeenCalledWith(file.buffer, file.mimetype);
      expect(result).toBe(analysis);
    });
  });
});
