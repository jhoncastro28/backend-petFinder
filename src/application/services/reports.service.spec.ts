import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { NotificationsService } from './notifications.service';
import { LocationService } from './location.service';
import { EmbeddingService } from './embedding.service';
import { Report } from '../../domain/entities/report.entity';
import { PetSize, PetType, PostStatus, PostType } from '../../domain/enums';

const makeReport = (
  overrides: Partial<{
    id: string;
    userId: string;
    status: PostStatus;
    type: PostType;
    embedding: number[];
  }> = {},
): Report =>
  new Report(
    overrides.id ?? 'report-1',
    overrides.userId ?? 'user-1',
    PetType.DOG,
    overrides.type ?? PostType.LOST,
    overrides.status ?? PostStatus.ACTIVE,
    'Perro perdido marrón',
    'marrón',
    'Labrador',
    PetSize.MEDIUM,
    '3001234567',
    'https://storage.blob.core.windows.net/reports/img.jpg',
    5.535,
    -73.367,
    new Date(),
    new Date(),
    overrides.embedding ?? [],
  );

const mockReportRepository = () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findAll: jest.fn(),
  findByUserId: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  countActive: jest.fn(),
});

const mockNotificationsService = () => ({
  create: jest.fn().mockResolvedValue(undefined),
});

const mockLocationService = () => ({
  resolveCoordinates: jest.fn().mockResolvedValue({ lat: 5.535, lon: -73.367 }),
});

const mockEmbeddingService = () => ({
  isAvailable: jest.fn().mockReturnValue(true),
  generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  buildReportText: jest.fn().mockReturnValue('perro marrón labrador'),
  preprocessQuery: jest.fn().mockImplementation((q: string) => q),
  cosineSimilarity: jest.fn().mockReturnValue(0.85),
  calculateDistanceKm: jest.fn().mockReturnValue(2.5),
  generateSocialSummary: jest.fn().mockResolvedValue('Se reporta perro perdido.'),
});

const createDto = () => ({
  species: PetType.DOG,
  type: PostType.LOST,
  description: 'Perro perdido marrón',
  color: 'marrón',
  breed: 'Labrador',
  size: PetSize.MEDIUM,
  contact: '3001234567',
  imageUrl: 'https://storage.blob.core.windows.net/reports/img.jpg',
  lat: 5.535,
  lon: -73.367,
});

describe('ReportsService', () => {
  let service: ReportsService;
  let reportRepo: ReturnType<typeof mockReportRepository>;
  let notificationsService: ReturnType<typeof mockNotificationsService>;
  let locationService: ReturnType<typeof mockLocationService>;
  let embeddingService: ReturnType<typeof mockEmbeddingService>;

  beforeEach(async () => {
    reportRepo = mockReportRepository();
    notificationsService = mockNotificationsService();
    locationService = mockLocationService();
    embeddingService = mockEmbeddingService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: 'IReportRepository', useValue: reportRepo },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: LocationService, useValue: locationService },
        { provide: EmbeddingService, useValue: embeddingService },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  describe('createReport', () => {
    it('should create a report and send notification', async () => {
      const report = makeReport();
      reportRepo.create.mockResolvedValue(report);

      const result = await service.createReport('user-1', createDto() as any);

      expect(locationService.resolveCoordinates).toHaveBeenCalled();
      expect(embeddingService.generateEmbedding).toHaveBeenCalled();
      expect(reportRepo.create).toHaveBeenCalled();
      expect(notificationsService.create).toHaveBeenCalled();
      expect(result).toBe(report);
    });

    it('should throw BadRequestException for invalid imageUrl', async () => {
      const dto = { ...createDto(), imageUrl: 'https://otherstorage.com/img.jpg' };
      await expect(service.createReport('user-1', dto as any)).rejects.toThrow(BadRequestException);
    });

    it('should not throw if notification creation fails', async () => {
      const report = makeReport();
      reportRepo.create.mockResolvedValue(report);
      notificationsService.create.mockRejectedValue(new Error('SMTP error'));

      const result = await service.createReport('user-1', createDto() as any);
      expect(result).toBe(report);
    });
  });

  describe('findAll', () => {
    it('should return paginated active reports', async () => {
      const reports = [makeReport(), makeReport({ id: 'report-2' })];
      reportRepo.findAll.mockResolvedValue(reports);

      const result = await service.findAll(1, 10);

      expect(reportRepo.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: PostStatus.ACTIVE }),
      );
      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.page).toBe(1);
    });

    it('should slice results for page 2', async () => {
      const reports = Array.from({ length: 15 }, (_, i) => makeReport({ id: `r-${i}` }));
      reportRepo.findAll.mockResolvedValue(reports);

      const result = await service.findAll(2, 10);

      expect(result.data).toHaveLength(5);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.hasNextPage).toBe(false);
      expect(result.pagination.hasPrevPage).toBe(true);
    });

    it('should return empty data when no reports', async () => {
      reportRepo.findAll.mockResolvedValue([]);

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });
  });

  describe('findById', () => {
    it('should return an active report', async () => {
      const report = makeReport();
      reportRepo.findById.mockResolvedValue(report);

      const result = await service.findById('report-1');
      expect(result).toBe(report);
    });

    it('should throw NotFoundException when report not found', async () => {
      reportRepo.findById.mockResolvedValue(null);
      await expect(service.findById('ghost')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when report is not active', async () => {
      const report = makeReport({ status: PostStatus.INACTIVE });
      reportRepo.findById.mockResolvedValue(report);
      await expect(service.findById('report-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findMyReports', () => {
    it('should return reports belonging to the user', async () => {
      const reports = [makeReport(), makeReport({ id: 'r-2' })];
      reportRepo.findByUserId.mockResolvedValue(reports);

      const result = await service.findMyReports('user-1');

      expect(reportRepo.findByUserId).toHaveBeenCalledWith('user-1');
      expect(result).toBe(reports);
    });
  });

  describe('updateReport', () => {
    it('should update report and return it', async () => {
      const report = makeReport();
      const updated = makeReport({ id: 'report-1' });
      reportRepo.findById.mockResolvedValue(report);
      reportRepo.update.mockResolvedValue(updated);

      const result = await service.updateReport('report-1', 'user-1', {
        description: 'Nuevo',
      } as any);

      expect(reportRepo.update).toHaveBeenCalled();
      expect(result).toBe(updated);
    });

    it('should throw NotFoundException when report not found', async () => {
      reportRepo.findById.mockResolvedValue(null);
      await expect(service.updateReport('ghost', 'user-1', {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when user does not own report', async () => {
      reportRepo.findById.mockResolvedValue(makeReport({ userId: 'other-user' }));
      await expect(service.updateReport('report-1', 'user-1', {} as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException for invalid imageUrl on update', async () => {
      reportRepo.findById.mockResolvedValue(makeReport());
      await expect(
        service.updateReport('report-1', 'user-1', {
          imageUrl: 'https://invalid.com/img.jpg',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeReport', () => {
    it('should deactivate report', async () => {
      const report = makeReport();
      reportRepo.findById.mockResolvedValue(report);
      reportRepo.update.mockResolvedValue(report);

      await service.removeReport('report-1', 'user-1');

      expect(report.status).toBe(PostStatus.INACTIVE);
      expect(reportRepo.update).toHaveBeenCalledWith('report-1', report);
    });

    it('should throw NotFoundException when report not found', async () => {
      reportRepo.findById.mockResolvedValue(null);
      await expect(service.removeReport('ghost', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user does not own report', async () => {
      reportRepo.findById.mockResolvedValue(makeReport({ userId: 'other-user' }));
      await expect(service.removeReport('report-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('adminRemoveReport', () => {
    it('should deactivate any report regardless of owner', async () => {
      const report = makeReport({ userId: 'any-user' });
      reportRepo.findById.mockResolvedValue(report);
      reportRepo.update.mockResolvedValue(report);

      await service.adminRemoveReport('report-1');

      expect(report.status).toBe(PostStatus.INACTIVE);
    });

    it('should throw NotFoundException when report not found', async () => {
      reportRepo.findById.mockResolvedValue(null);
      await expect(service.adminRemoveReport('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPublicStats', () => {
    it('should return counts of lost, found and resolved', async () => {
      const active = [
        makeReport({ type: PostType.LOST }),
        makeReport({ type: PostType.LOST }),
        makeReport({ type: PostType.FOUND }),
      ];
      const resolved = [makeReport({ status: PostStatus.RESOLVED })];

      reportRepo.findAll.mockResolvedValueOnce(active).mockResolvedValueOnce(resolved);

      const result = await service.getPublicStats();

      expect(result.lost).toBe(2);
      expect(result.found).toBe(1);
      expect(result.resolved).toBe(1);
      expect(result.totalActive).toBe(3);
    });
  });

  describe('exportDataset', () => {
    it('should return serialized report data', async () => {
      const reports = [makeReport()];
      reportRepo.findAll.mockResolvedValue(reports);

      const result = await service.exportDataset();

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id', 'report-1');
      expect(result[0]).toHaveProperty('species', PetType.DOG);
      expect(result[0].city).toBeNull();
    });
  });

  describe('backfillEmbeddings', () => {
    it('should throw BadRequestException when embedding service is unavailable', async () => {
      embeddingService.isAvailable.mockReturnValue(false);
      await expect(service.backfillEmbeddings()).rejects.toThrow(BadRequestException);
    });

    it('should skip reports that already have embeddings', async () => {
      reportRepo.findAll.mockResolvedValue([makeReport({ embedding: [0.1, 0.2] })]);

      const result = await service.backfillEmbeddings();

      expect(result.skipped).toBe(0);
      expect(result.updated).toBe(0);
      expect(reportRepo.update).not.toHaveBeenCalled();
    });

    it('should update reports without embeddings', async () => {
      const report = makeReport({ embedding: [] });
      reportRepo.findAll.mockResolvedValue([report]);
      reportRepo.update.mockResolvedValue(report);
      embeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);

      const result = await service.backfillEmbeddings();

      expect(result.updated).toBe(1);
      expect(reportRepo.update).toHaveBeenCalled();
    });

    it('should count skipped when embedding generation returns empty', async () => {
      reportRepo.findAll.mockResolvedValue([makeReport({ embedding: [] })]);
      embeddingService.generateEmbedding.mockResolvedValue([]);

      const result = await service.backfillEmbeddings();

      expect(result.skipped).toBe(1);
      expect(result.updated).toBe(0);
    });
  });

  describe('search', () => {
    it('should fall back to text search when embedding service is unavailable', async () => {
      embeddingService.isAvailable.mockReturnValue(false);
      reportRepo.findAll.mockResolvedValue([makeReport()]);

      const result = await service.search('perro', 1, 10);

      expect(result.isSemanticSearch).toBe(false);
    });

    it('should do semantic search when embedding service is available', async () => {
      const reports = [makeReport({ embedding: [0.1, 0.2, 0.3] })];
      reportRepo.findAll.mockResolvedValue(reports);
      embeddingService.generateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
      embeddingService.cosineSimilarity.mockReturnValue(0.9);

      const result = await service.search('perro labrador', 1, 10);

      expect(result.isSemanticSearch).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should return empty result when no reports in geo radius', async () => {
      reportRepo.findAll.mockResolvedValue([]);

      const result = await service.search('perro', 1, 10, { lat: 5.5, lon: -73.3, radiusKm: 1 });

      expect(result.data).toHaveLength(0);
      expect(result.isSemanticSearch).toBe(true);
    });
  });

  describe('generateReportSummary', () => {
    it('should return AI summary when available', async () => {
      reportRepo.findById.mockResolvedValue(makeReport());
      embeddingService.generateSocialSummary.mockResolvedValue('Se reporta perro perdido marrón.');

      const result = await service.generateReportSummary('report-1');

      expect(result).toBe('Se reporta perro perdido marrón.');
    });

    it('should return fallback text when AI summary is null', async () => {
      reportRepo.findById.mockResolvedValue(makeReport());
      embeddingService.generateSocialSummary.mockResolvedValue(null);

      const result = await service.generateReportSummary('report-1');

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
