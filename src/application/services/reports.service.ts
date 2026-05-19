import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Report } from '../../domain/entities/report.entity';
import { PostStatus, PostType } from '../../domain/enums';
import { IReportRepository, ReportFilters } from '../../domain/repositories';
import { NotificationType } from '../../domain/entities';
import { CreateReportDto } from '../dtos/reports/create-report.dto';
import { UpdateReportDto } from '../dtos/reports/update-report.dto';
import { NotificationsService } from './notifications.service';
import { LocationService } from './location.service';
import { EmbeddingService } from './embedding.service';

export type ReportWithScore = Report & {
  similarityScore: number;
  distanceKm?: number;
};

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject('IReportRepository')
    private readonly reportRepository: IReportRepository,
    private readonly notificationsService: NotificationsService,
    private readonly locationService: LocationService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async createReport(userId: string, dto: CreateReportDto): Promise<Report> {
    this.validateImageUrl(dto.imageUrl);
    const coordinates = await this.locationService.resolveCoordinates({
      lat: dto.lat,
      lon: dto.lon,
      locationQuery: dto.locationQuery,
    });

    // Generar embedding antes de crear el reporte
    const embeddingText = this.embeddingService.buildReportText({
      species: dto.species,
      color: dto.color,
      breed: dto.breed,
      size: dto.size,
      description: dto.description,
    });
    const embedding = await this.embeddingService.generateEmbedding(embeddingText);

    const report = new Report(
      '',
      userId,
      dto.species,
      dto.type,
      dto.status ?? PostStatus.ACTIVE,
      dto.description,
      dto.color,
      dto.breed,
      dto.size,
      dto.contact,
      dto.imageUrl,
      coordinates.lat,
      coordinates.lon,
      new Date(),
      new Date(),
      embedding,
    );

    const created = await this.reportRepository.create(report);

    try {
      const speciesEs: Record<string, string> = {
        dog: 'perro',
        cat: 'gato',
        bird: 'ave',
        rabbit: 'conejo',
        other: 'mascota',
      };
      const typeEs = created.type === 'found' ? 'encontrado' : 'perdido';
      const petDesc = `${speciesEs[created.species] ?? 'mascota'} ${typeEs}`;

      await this.notificationsService.create(
        userId,
        NotificationType.UPDATE,
        'Reporte publicado',
        `Tu reporte de ${petDesc} fue publicado correctamente.`,
        created.id,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo crear notificacion de creacion para reporte ${created.id}: ${error.message}`,
      );
    }

    return created;
  }

  async findAll(
    page: number,
    limit: number,
    filters?: Omit<ReportFilters, 'userId' | 'status'>,
  ): Promise<{
    data: Report[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
    };
  }> {
    const allActive = await this.reportRepository.findAll({
      ...filters,
      status: PostStatus.ACTIVE,
    });

    const total = allActive.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const data = allActive.slice(offset, offset + limit);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Búsqueda semántica con Gemini embeddings + filtro geográfico opcional.
   * Si Gemini no está disponible, hace fallback a búsqueda por texto (CONTAINS).
   */
  async search(
    query: string,
    page: number,
    limit: number,
    options?: {
      lat?: number;
      lon?: number;
      radiusKm?: number;
      species?: ReportFilters['species'];
      type?: ReportFilters['type'];
      size?: ReportFilters['size'];
      color?: string;
      breed?: string;
    },
  ): Promise<{
    data: ReportWithScore[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
    };
    isSemanticSearch: boolean;
  }> {
    const { lat, lon, radiusKm = 15, species, type, size, color, breed } = options ?? {};
    const hasGeo = lat !== undefined && lon !== undefined && !isNaN(lat) && !isNaN(lon);

    // Si Gemini no está disponible: fallback a texto
    if (!this.embeddingService.isAvailable()) {
      return this.textSearchFallback(query, page, limit, { species, type, size, color, breed });
    }

    // 1. Obtener todos los reportes activos con filtros estructurales
    const allActive = await this.reportRepository.findAll({
      status: PostStatus.ACTIVE,
      species,
      type,
      size,
      color,
      breed,
    });

    // 2. Filtrar por radio geográfico si se proporcionaron coordenadas
    const geoFiltered = hasGeo
      ? allActive.filter((r) => {
          if (!r.lat || !r.lon) return false;
          const dist = this.embeddingService.calculateDistanceKm(lat, lon, r.lat, r.lon);
          return dist <= radiusKm;
        })
      : allActive;

    if (geoFiltered.length === 0) {
      return this.emptyPaginatedResult(page, limit, true);
    }

    // 3. Generar embedding de la consulta
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);

    if (!queryEmbedding.length) {
      // Si falla la generación del embedding, hacer fallback a texto
      return this.textSearchFallback(query, page, limit, { species, type, size });
    }

    // 4. Calcular score combinado para cada reporte
    const scored: ReportWithScore[] = geoFiltered.map((report) => {
      const semanticScore = report.embedding?.length
        ? this.embeddingService.cosineSimilarity(queryEmbedding, report.embedding)
        : 0;

      let combinedScore = semanticScore;
      let distanceKm: number | undefined;

      if (hasGeo && report.lat && report.lon) {
        distanceKm = this.embeddingService.calculateDistanceKm(lat, lon, report.lat, report.lon);
        const geoScore = Math.max(0, 1 - distanceKm / radiusKm);
        // 70% semántico + 30% geográfico
        combinedScore = 0.7 * semanticScore + 0.3 * geoScore;
      }

      return Object.assign(report, {
        similarityScore: Math.round(combinedScore * 100) / 100,
        distanceKm,
      }) as ReportWithScore;
    });

    // 5. Ordenar por score descendente
    scored.sort((a, b) => b.similarityScore - a.similarityScore);

    // 6. Paginar
    const total = scored.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const data = scored.slice(offset, offset + limit);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      isSemanticSearch: true,
    };
  }

  /**
   * Backfill de embeddings para reportes que no tienen vector generado.
   * Útil para migrar reportes creados antes de implementar el EmbeddingService.
   */
  async backfillEmbeddings(): Promise<{ updated: number; skipped: number; errors: number }> {
    if (!this.embeddingService.isAvailable()) {
      throw new BadRequestException('Gemini API no está configurada (GEMINI_API_KEY)');
    }

    const allReports = await this.reportRepository.findAll();
    const pending = allReports.filter((r) => !r.embedding || r.embedding.length === 0);

    this.logger.log(`Backfill embeddings: ${pending.length} reportes pendientes`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const report of pending) {
      try {
        const text = this.embeddingService.buildReportText({
          species: report.species,
          color: report.color,
          breed: report.breed,
          size: report.size,
          description: report.description,
        });

        const embedding = await this.embeddingService.generateEmbedding(text);

        if (!embedding.length) {
          skipped++;
          continue;
        }

        const updatedReport = Report.fromPlainObject({
          ...report.toPlainObject(),
          embedding,
        });

        await this.reportRepository.update(report.id, updatedReport);
        updated++;

        // Respetar el rate limit de Gemini (100 RPM free tier)
        await new Promise((resolve) => setTimeout(resolve, 700));
      } catch (error) {
        this.logger.warn(`Error en backfill para reporte ${report.id}: ${error.message}`);
        errors++;
      }
    }

    this.logger.log(
      `Backfill completado — updated: ${updated}, skipped: ${skipped}, errors: ${errors}`,
    );
    return { updated, skipped, errors };
  }

  async exportDataset(): Promise<
    Array<{
      id: string;
      species: string;
      type: string;
      status: string;
      breed: string;
      createdAt: string;
      lat: number;
      lon: number;
      city: null;
      neighborhood: null;
    }>
  > {
    const reports = await this.reportRepository.findAll();

    return reports.map((report) => ({
      id: report.id,
      species: report.species,
      type: report.type,
      status: report.status,
      breed: report.breed,
      createdAt: report.createdAt.toISOString(),
      lat: report.lat,
      lon: report.lon,
      city: null,
      neighborhood: null,
    }));
  }

  async findById(id: string): Promise<Report> {
    const report = await this.reportRepository.findById(id);
    if (!report || !report.isActive()) {
      throw new NotFoundException('Reporte no encontrado');
    }
    return report;
  }

  async findMatchesForReport(reportId: string, limit = 6): Promise<ReportWithScore[]> {
    const source = await this.findById(reportId);

    const oppositeType = source.type === PostType.LOST ? PostType.FOUND : PostType.LOST;
    const candidates = await this.reportRepository.findAll({
      status: PostStatus.ACTIVE,
      species: source.species,
      type: oppositeType,
    });

    const filtered = candidates.filter((r) => r.id !== source.id);
    if (!filtered.length) return [];

    const hasGeoSource = Number.isFinite(source.lat) && Number.isFinite(source.lon);

    const sourceEmbedding = source.embedding?.length
      ? source.embedding
      : await this.embeddingService.generateEmbedding(
          this.embeddingService.buildReportText({
            species: source.species,
            color: source.color,
            breed: source.breed,
            size: source.size,
            description: source.description,
          }),
        );

    const scored = filtered
      .map((candidate) => {
        const candidateEmbedding = candidate.embedding?.length ? candidate.embedding : [];

        let semanticScore = 0;
        if (sourceEmbedding.length && candidateEmbedding.length) {
          semanticScore = this.embeddingService.cosineSimilarity(
            sourceEmbedding,
            candidateEmbedding,
          );
        } else {
          semanticScore = this.roughTextSimilarity(
            this.embeddingService.buildReportText({
              species: source.species,
              color: source.color,
              breed: source.breed,
              size: source.size,
              description: source.description,
            }),
            this.embeddingService.buildReportText({
              species: candidate.species,
              color: candidate.color,
              breed: candidate.breed,
              size: candidate.size,
              description: candidate.description,
            }),
          );
        }

        let distanceKm: number | undefined;
        let geoScore = 0;
        const hasGeoCandidate = Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon);
        if (hasGeoSource && hasGeoCandidate) {
          distanceKm = this.embeddingService.calculateDistanceKm(
            source.lat,
            source.lon,
            candidate.lat,
            candidate.lon,
          );
          geoScore = Math.max(0, 1 - distanceKm / 30);
        }

        const score =
          hasGeoSource && hasGeoCandidate ? 0.75 * semanticScore + 0.25 * geoScore : semanticScore;

        return Object.assign(candidate, {
          similarityScore: Math.round(score * 100) / 100,
          distanceKm,
        }) as ReportWithScore;
      })
      .filter((item) => item.similarityScore >= 0.2)
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, Math.max(1, Math.min(limit, 20)));

    return scored;
  }

  async generateReportSummary(reportId: string): Promise<string> {
    const report = await this.findById(reportId);

    const aiSummary = await this.embeddingService.generateSocialSummary({
      species: this.speciesLabel(report.species),
      type: report.type === PostType.LOST ? 'perdido' : 'encontrado',
      color: report.color,
      breed: report.breed,
      size: this.sizeLabel(report.size),
      description: report.description,
    });

    if (aiSummary) return aiSummary;

    const typeLabel = report.type === PostType.LOST ? 'perdido' : 'encontrado';
    const species = this.speciesLabel(report.species);
    const details = [report.color, report.breed, this.sizeLabel(report.size)]
      .filter(Boolean)
      .join(', ');
    const description =
      report.description?.trim() || 'Comparte este reporte para aumentar la visibilidad.';

    return [
      `Se reporta ${species} ${typeLabel}.${details ? ` Caracteristicas: ${details}.` : ''}`,
      description,
      'Ayudanos compartiendo esta informacion para lograr un reencuentro pronto.',
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async findMyReports(userId: string): Promise<Report[]> {
    return this.reportRepository.findByUserId(userId);
  }

  async updateReport(id: string, userId: string, dto: UpdateReportDto): Promise<Report> {
    const report = await this.reportRepository.findById(id);
    if (!report) throw new NotFoundException('Reporte no encontrado');
    if (report.userId !== userId)
      throw new ForbiddenException('No tienes permiso para editar este reporte');

    if (dto.imageUrl) this.validateImageUrl(dto.imageUrl);
    const coordinates = await this.locationService.resolveCoordinates(
      {
        lat: dto.lat,
        lon: dto.lon,
        locationQuery: dto.locationQuery,
      },
      { allowEmpty: true },
    );

    report.update({
      species: dto.species,
      status: dto.status,
      description: dto.description,
      color: dto.color,
      breed: dto.breed,
      size: dto.size,
      contact: dto.contact,
      imageUrl: dto.imageUrl,
      lat: coordinates?.lat,
      lon: coordinates?.lon,
    });

    // Regenerar embedding si algún campo descriptivo cambió
    const descriptiveFieldChanged = [
      dto.species,
      dto.color,
      dto.breed,
      dto.size,
      dto.description,
    ].some((f) => f !== undefined);

    let finalReport = report;

    if (descriptiveFieldChanged) {
      const embeddingText = this.embeddingService.buildReportText({
        species: report.species,
        color: report.color,
        breed: report.breed,
        size: report.size,
        description: report.description,
      });
      const newEmbedding = await this.embeddingService.generateEmbedding(embeddingText);

      if (newEmbedding.length) {
        finalReport = Report.fromPlainObject({
          ...report.toPlainObject(),
          embedding: newEmbedding,
        });
      }
    }

    const updated = await this.reportRepository.update(id, finalReport);

    try {
      const speciesEsUpd: Record<string, string> = {
        dog: 'perro',
        cat: 'gato',
        bird: 'ave',
        rabbit: 'conejo',
        other: 'mascota',
      };
      const typeEsUpd = report.type === 'found' ? 'encontrado' : 'perdido';
      const petDescUpd = `${speciesEsUpd[report.species] ?? 'mascota'} ${typeEsUpd}`;

      await this.notificationsService.create(
        userId,
        NotificationType.UPDATE,
        'Reporte actualizado',
        `Tu reporte de ${petDescUpd} fue actualizado correctamente.`,
        report.id,
      );
    } catch (error) {
      this.logger.warn(`No se pudo crear notificacion para reporte ${report.id}: ${error.message}`);
    }

    return updated;
  }

  async removeReport(id: string, userId: string): Promise<void> {
    const report = await this.reportRepository.findById(id);
    if (!report) throw new NotFoundException('Reporte no encontrado');
    if (report.userId !== userId)
      throw new ForbiddenException('No tienes permiso para eliminar este reporte');

    report.deactivate();
    await this.reportRepository.update(id, report);
  }

  async adminRemoveReport(id: string): Promise<void> {
    const report = await this.reportRepository.findById(id);
    if (!report) throw new NotFoundException('Reporte no encontrado');
    report.deactivate();
    await this.reportRepository.update(id, report);
  }

  async getStats(): Promise<{ totalActive: number }> {
    const totalActive = await this.reportRepository.countActive();
    return { totalActive };
  }

  async getPublicStats(): Promise<{
    lost: number;
    found: number;
    resolved: number;
    totalActive: number;
  }> {
    const [active, resolved] = await Promise.all([
      this.reportRepository.findAll({ status: PostStatus.ACTIVE }),
      this.reportRepository.findAll({ status: PostStatus.RESOLVED }),
    ]);

    const lost = active.filter((r) => r.type === PostType.LOST).length;
    const found = active.filter((r) => r.type === PostType.FOUND).length;

    return { lost, found, resolved: resolved.length, totalActive: active.length };
  }

  // ─── helpers privados ─────────────────────────────────────────────────────

  private async textSearchFallback(
    query: string,
    page: number,
    limit: number,
    filters?: {
      species?: ReportFilters['species'];
      type?: ReportFilters['type'];
      size?: ReportFilters['size'];
      color?: string;
      breed?: string;
    },
  ): Promise<{
    data: ReportWithScore[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
    };
    isSemanticSearch: boolean;
  }> {
    const allActive = await this.reportRepository.findAll({
      ...filters,
      search: query,
      status: PostStatus.ACTIVE,
    });

    const total = allActive.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const data = allActive
      .slice(offset, offset + limit)
      .map((r) => Object.assign(r, { similarityScore: 0 }) as ReportWithScore);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      isSemanticSearch: false,
    };
  }

  private emptyPaginatedResult(page: number, limit: number, isSemanticSearch: boolean) {
    return {
      data: [] as ReportWithScore[],
      pagination: { page, limit, total: 0, totalPages: 1, hasNextPage: false, hasPrevPage: false },
      isSemanticSearch,
    };
  }

  private roughTextSimilarity(a: string, b: string): number {
    const tokenize = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 2);

    const aSet = new Set(tokenize(a));
    const bSet = new Set(tokenize(b));
    if (!aSet.size || !bSet.size) return 0;

    let intersection = 0;
    aSet.forEach((token) => {
      if (bSet.has(token)) intersection += 1;
    });

    const union = new Set([...Array.from(aSet), ...Array.from(bSet)]).size;
    return union ? intersection / union : 0;
  }

  private speciesLabel(species: string): string {
    const map: Record<string, string> = {
      dog: 'perro',
      cat: 'gato',
      bird: 'ave',
      rabbit: 'conejo',
      other: 'mascota',
    };
    return map[species] ?? 'mascota';
  }

  private sizeLabel(size: string): string {
    const map: Record<string, string> = {
      small: 'pequeno',
      medium: 'mediano',
      large: 'grande',
    };
    return map[size] ?? '';
  }

  private validateImageUrl(imageUrl: string): void {
    let url: URL;
    try {
      url = new URL(imageUrl);
    } catch {
      throw new BadRequestException('imageUrl invalida');
    }
    if (!url.hostname.includes('blob.core.windows.net')) {
      throw new BadRequestException('imageUrl debe apuntar a Azure Blob Storage');
    }
  }
}
