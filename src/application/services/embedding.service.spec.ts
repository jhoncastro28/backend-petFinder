import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';

const mockConfigService = (apiKey: string | undefined) => ({
  get: jest.fn().mockReturnValue(apiKey),
});

describe('EmbeddingService', () => {
  describe('when GEMINI_API_KEY is not configured', () => {
    let service: EmbeddingService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmbeddingService,
          { provide: ConfigService, useValue: mockConfigService(undefined) },
        ],
      }).compile();
      service = module.get<EmbeddingService>(EmbeddingService);
    });

    it('should report as unavailable', () => {
      expect(service.isAvailable()).toBe(false);
    });

    it('generateEmbedding should return empty array', async () => {
      const result = await service.generateEmbedding('perro negro');
      expect(result).toEqual([]);
    });

    it('generateSocialSummary should return null', async () => {
      const result = await service.generateSocialSummary({ species: 'dog', type: 'lost' });
      expect(result).toBeNull();
    });
  });

  describe('when GEMINI_API_KEY is configured', () => {
    let service: EmbeddingService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmbeddingService,
          { provide: ConfigService, useValue: mockConfigService('fake-api-key') },
        ],
      }).compile();
      service = module.get<EmbeddingService>(EmbeddingService);
    });

    it('should report as available', () => {
      expect(service.isAvailable()).toBe(true);
    });

    it('generateEmbedding should return empty array on API error', async () => {
      const result = await service.generateEmbedding('perro');
      expect(result).toEqual([]);
    });
  });

  describe('cosineSimilarity', () => {
    let service: EmbeddingService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmbeddingService,
          { provide: ConfigService, useValue: mockConfigService(undefined) },
        ],
      }).compile();
      service = module.get<EmbeddingService>(EmbeddingService);
    });

    it('should return 1 for identical vectors', () => {
      const v = [1, 0, 0];
      expect(service.cosineSimilarity(v, v)).toBeCloseTo(1);
    });

    it('should return 0 for orthogonal vectors', () => {
      expect(service.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it('should return 0 for empty arrays', () => {
      expect(service.cosineSimilarity([], [])).toBe(0);
    });

    it('should return 0 for null/undefined inputs', () => {
      expect(service.cosineSimilarity(null as any, [1, 0])).toBe(0);
      expect(service.cosineSimilarity([1, 0], null as any)).toBe(0);
    });

    it('should return 0 for vectors of different length', () => {
      expect(service.cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    });

    it('should return 0 for zero vectors', () => {
      expect(service.cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });

    it('should compute similarity between non-trivial vectors', () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      const result = service.cosineSimilarity(a, b);
      expect(result).toBeGreaterThan(0.97);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateDistanceKm', () => {
    let service: EmbeddingService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmbeddingService,
          { provide: ConfigService, useValue: mockConfigService(undefined) },
        ],
      }).compile();
      service = module.get<EmbeddingService>(EmbeddingService);
    });

    it('should return 0 for same coordinates', () => {
      expect(service.calculateDistanceKm(5.5353, -73.3678, 5.5353, -73.3678)).toBe(0);
    });

    it('should return positive distance for different coordinates', () => {
      const dist = service.calculateDistanceKm(5.5353, -73.3678, 5.8265, -73.0355);
      expect(dist).toBeGreaterThan(30);
      expect(dist).toBeLessThan(60);
    });
  });

  describe('buildReportText', () => {
    let service: EmbeddingService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmbeddingService,
          { provide: ConfigService, useValue: mockConfigService(undefined) },
        ],
      }).compile();
      service = module.get<EmbeddingService>(EmbeddingService);
    });

    it('should include Spanish and English species terms for dog', () => {
      const text = service.buildReportText({
        species: 'dog',
        color: 'negro',
        breed: 'Labrador',
        size: 'large',
        description: 'Muy sociable.',
        type: 'lost',
      });
      expect(text).toContain('perro');
      expect(text).toContain('dog');
    });

    it('should include Spanish and English species terms for cat', () => {
      const text = service.buildReportText({
        species: 'cat',
        color: 'naranja',
        breed: 'Criollo',
        size: 'small',
        description: 'Ojos verdes.',
        type: 'found',
      });
      expect(text).toContain('gato');
      expect(text).toContain('cat');
    });

    it('should include lost/missing terms for lost type', () => {
      const text = service.buildReportText({
        species: 'dog',
        color: 'café',
        breed: 'Mestizo',
        size: 'medium',
        description: 'Collar azul.',
        type: 'lost',
      });
      expect(text).toContain('perdido');
      expect(text).toContain('lost');
    });

    it('should include found/rescued terms for found type', () => {
      const text = service.buildReportText({
        species: 'cat',
        color: 'gris',
        breed: 'Mestizo',
        size: 'small',
        description: 'Sin collar.',
        type: 'found',
      });
      expect(text).toContain('encontrado');
      expect(text).toContain('found');
    });

    it('should handle unknown species gracefully', () => {
      const text = service.buildReportText({
        species: 'hamster',
        color: 'café',
        breed: 'Sirio',
        size: 'small',
        description: 'Muy rápido.',
        type: 'lost',
      });
      expect(text).toContain('hamster');
    });

    it('should handle missing type gracefully', () => {
      const text = service.buildReportText({
        species: 'dog',
        color: 'blanco',
        breed: 'Poodle',
        size: 'small',
        description: 'Pelo rizado.',
      });
      expect(text).toContain('perro');
      expect(text).toBeTruthy();
    });

    it('should handle bird species', () => {
      const text = service.buildReportText({
        species: 'bird',
        color: 'verde',
        breed: 'Loro',
        size: 'small',
        description: 'Habla.',
        type: 'lost',
      });
      expect(text).toContain('ave');
      expect(text).toContain('bird');
    });

    it('should include description in output', () => {
      const description = 'Collar rojo con chapa dorada';
      const text = service.buildReportText({
        species: 'dog',
        color: 'negro',
        breed: 'Labrador',
        size: 'large',
        description,
        type: 'lost',
      });
      expect(text).toContain(description);
    });
  });

  describe('preprocessQuery', () => {
    let service: EmbeddingService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmbeddingService,
          { provide: ConfigService, useValue: mockConfigService(undefined) },
        ],
      }).compile();
      service = module.get<EmbeddingService>(EmbeddingService);
    });

    it('should lowercase the query', () => {
      expect(service.preprocessQuery('Perro Negro')).toBe('perro negro');
    });

    it('should trim whitespace', () => {
      expect(service.preprocessQuery('  perro  ')).toBe('perro');
    });

    it('should fix perdio → perdió', () => {
      expect(service.preprocessQuery('perro que se perdio')).toContain('perdió');
    });

    it('should fix encontro → encontró', () => {
      expect(service.preprocessQuery('lo encontro ayer')).toContain('encontró');
    });

    it('should fix pequeno → pequeño', () => {
      expect(service.preprocessQuery('perro pequeno')).toContain('pequeño');
    });

    it('should fix pajaro → pájaro ave', () => {
      const result = service.preprocessQuery('vi un pajaro');
      expect(result).toContain('pájaro');
      expect(result).toContain('ave');
    });

    it('should expand extraviado with synonyms', () => {
      const result = service.preprocessQuery('gato extraviado');
      expect(result).toContain('lost');
      expect(result).toContain('missing');
    });

    it('should expand cachorro with synonyms', () => {
      const result = service.preprocessQuery('cachorro perdido');
      expect(result).toContain('dog');
      expect(result).toContain('puppy');
    });

    it('should expand perrito with synonyms', () => {
      const result = service.preprocessQuery('perrito negro');
      expect(result).toContain('dog');
    });

    it('should expand gatito with synonyms', () => {
      const result = service.preprocessQuery('gatito naranja');
      expect(result).toContain('cat');
    });

    it('should expand hallado with synonyms', () => {
      const result = service.preprocessQuery('perro hallado en el parque');
      expect(result).toContain('found');
    });

    it('should not modify queries without known keywords', () => {
      const query = 'perro labrador negro tunja';
      expect(service.preprocessQuery(query)).toBe(query);
    });
  });
});
