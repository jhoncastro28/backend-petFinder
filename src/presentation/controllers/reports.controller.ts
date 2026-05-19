import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  InternalServerErrorException,
  Header,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { ReportsService, ReportWithScore } from '../../application/services/reports.service';
import { VisionService } from '../../application/services/vision.service';
import { CreateReportDto } from '../../application/dtos/reports/create-report.dto';
import { UpdateReportDto } from '../../application/dtos/reports/update-report.dto';
import { Report } from '../../domain/entities/report.entity';
import { PetSize, PetType, PostType, UserRole } from '../../domain/enums';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser, UserFromJwt } from '../decorators/current-user.decorator';
import { AzureBlobStorageService } from '../../infrastructure/external-services/azure';

@ApiTags('Reports')
@ApiBearerAuth('JWT')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly azureBlobStorageService: AzureBlobStorageService,
    private readonly visionService: VisionService,
  ) {}

  // ─── Imagen ───────────────────────────────────────────────────────────────

  @Post('upload-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return callback(
            new BadRequestException('Solo se permiten imagenes jpg, png o webp'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadImage(
    @CurrentUser() user: UserFromJwt,
    @UploadedFile() file: any,
  ): Promise<{ imageId: string; imageUrl: string; signedUrl?: string }> {
    if (!file) throw new BadRequestException('Archivo de imagen requerido');

    try {
      const result = await this.azureBlobStorageService.uploadImage(file, 'reports', user.id);
      return { imageId: result.imageId, imageUrl: result.imageUrl, signedUrl: result.signedUrl };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('No fue posible cargar la imagen en este momento');
    }
  }

  // ─── Estado del servicio IA ───────────────────────────────────────────────

  @Get('ai-status')
  @ApiOperation({
    summary: 'Estado del servicio IA',
    description: 'Indica si el servicio de embeddings y visión por Gemini está disponible.',
  })
  @ApiResponse({ status: 200, schema: { example: { available: true } } })
  getAiStatus(): { available: boolean } {
    return { available: this.visionService.isAvailable() };
  }

  // ─── Análisis de imagen por IA ────────────────────────────────────────────

  @Post('analyze-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return callback(
            new BadRequestException('Solo se permiten imágenes jpg, png o webp'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  @ApiOperation({
    summary: 'Analizar imagen con IA',
    description:
      'Usa Gemini Vision para detectar especie, color y raza del animal en la imagen. ' +
      'Retorna null en los campos que no pueda identificar y un mensaje explicativo.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        species: 'dog',
        color: 'marrón con blanco',
        breed: 'Labrador',
        confidence: 'high',
        aiAvailable: true,
        message: null,
      },
    },
  })
  async analyzeImage(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Archivo de imagen requerido');
    return this.visionService.analyzeImage(file.buffer, file.mimetype);
  }

  // ─── Crear ────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Crear reporte',
    description: 'Crea un nuevo reporte de mascota (requiere JWT)',
  })
  @ApiBody({ type: CreateReportDto })
  @ApiResponse({ status: 201, description: 'Reporte creado', type: Report })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async create(
    @CurrentUser() user: UserFromJwt,
    @Body() createReportDto: CreateReportDto,
  ): Promise<Report> {
    return this.reportsService.createReport(user.id, createReportDto);
  }

  // ─── Listar ───────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Listar reportes',
    description: 'Listado público con paginación y filtros',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'species', required: false, enum: PetType })
  @ApiQuery({ name: 'type', required: false, enum: PostType })
  @ApiQuery({ name: 'size', required: false, enum: PetSize })
  @ApiQuery({ name: 'color', required: false, type: String })
  @ApiQuery({ name: 'breed', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Listado obtenido', type: [Report] })
  async findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
    @Query('species') species?: PetType,
    @Query('type') type?: PostType,
    @Query('size') size?: PetSize,
    @Query('color') color?: string,
    @Query('breed') breed?: string,
  ) {
    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    if (!Number.isInteger(parsedPage) || parsedPage < 1)
      throw new BadRequestException('El parámetro page debe ser un entero mayor o igual a 1');
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)
      throw new BadRequestException('El parámetro limit debe ser un entero entre 1 y 100');

    return this.reportsService.findAll(parsedPage, parsedLimit, {
      search,
      species,
      type,
      size,
      color: color?.trim() || undefined,
      breed: breed?.trim() || undefined,
    });
  }

  // ─── Búsqueda semántica ───────────────────────────────────────────────────

  @Get('search')
  @ApiOperation({
    summary: 'Búsqueda semántica',
    description:
      'Busca reportes usando IA (Gemini embeddings) + filtro geográfico opcional. ' +
      'Devuelve resultados ordenados por relevancia semántica. ' +
      'Si Gemini no está disponible hace fallback a búsqueda por texto.',
  })
  @ApiQuery({ name: 'query', required: true, description: 'Descripción libre de la mascota' })
  @ApiQuery({ name: 'lat', required: false, description: 'Latitud del punto de búsqueda' })
  @ApiQuery({ name: 'lon', required: false, description: 'Longitud del punto de búsqueda' })
  @ApiQuery({
    name: 'radiusKm',
    required: false,
    description: 'Radio de búsqueda en km (default 15)',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'species', required: false, enum: PetType })
  @ApiQuery({ name: 'type', required: false, enum: PostType })
  @ApiQuery({ name: 'size', required: false, enum: PetSize })
  @ApiQuery({ name: 'color', required: false, type: String })
  @ApiQuery({ name: 'breed', required: false, type: String })
  async search(
    @Query('query') query: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('lat') latStr?: string,
    @Query('lon') lonStr?: string,
    @Query('radiusKm') radiusKmStr?: string,
    @Query('species') species?: PetType,
    @Query('type') type?: PostType,
    @Query('size') size?: PetSize,
    @Query('color') color?: string,
    @Query('breed') breed?: string,
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
    if (!query || query.trim().length < 2)
      throw new BadRequestException('El parámetro query debe tener al menos 2 caracteres');

    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    if (!Number.isInteger(parsedPage) || parsedPage < 1)
      throw new BadRequestException('El parámetro page debe ser un entero mayor o igual a 1');
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)
      throw new BadRequestException('El parámetro limit debe ser un entero entre 1 y 100');

    const lat = latStr !== undefined ? parseFloat(latStr) : undefined;
    const lon = lonStr !== undefined ? parseFloat(lonStr) : undefined;
    const radiusKm = radiusKmStr !== undefined ? parseFloat(radiusKmStr) : 15;

    return this.reportsService.search(query.trim(), parsedPage, parsedLimit, {
      lat,
      lon,
      radiusKm,
      species,
      type,
      size,
      color: color?.trim() || undefined,
      breed: breed?.trim() || undefined,
    });
  }

  // ─── Backfill de embeddings ───────────────────────────────────────────────

  @Post('backfill-embeddings')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Backfill embeddings',
    description:
      'Genera embeddings para todos los reportes que aún no tienen vector. ' +
      'Requiere autenticación. Útil para migrar datos existentes.',
  })
  @ApiResponse({ status: 201, description: 'Backfill completado' })
  @ApiResponse({ status: 400, description: 'Gemini API no configurada' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async backfillEmbeddings(): Promise<{ updated: number; skipped: number; errors: number }> {
    return this.reportsService.backfillEmbeddings();
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  @Get('export')
  async exportJson() {
    return this.reportsService.exportDataset();
  }

  @Get('export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(): Promise<string> {
    const rows = await this.reportsService.exportDataset();
    const header = 'id,species,type,status,breed,createdAt,lat,lon,city,neighborhood';
    const csvRows = rows.map((row) =>
      [
        row.id,
        row.species,
        row.type,
        row.status,
        row.breed,
        row.createdAt,
        row.lat,
        row.lon,
        row.city ?? '',
        row.neighborhood ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    return [header, ...csvRows].join('\n');
  }

  // ─── Mis reportes ─────────────────────────────────────────────────────────

  @Get('my-reports')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Mis reportes',
    description: 'Retorna reportes del usuario autenticado',
  })
  async findMyReports(@CurrentUser() user: UserFromJwt): Promise<Report[]> {
    return this.reportsService.findMyReports(user.id);
  }

  // ─── Estadísticas públicas ────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({
    summary: 'Estadísticas públicas',
    description: 'Retorna conteo de reportes perdidos, encontrados y resueltos (sin autenticación)',
  })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas calculadas',
    schema: {
      type: 'object',
      properties: {
        lost: { type: 'number' },
        found: { type: 'number' },
        resolved: { type: 'number' },
        totalActive: { type: 'number' },
      },
    },
  })
  async getPublicStats(): Promise<{
    lost: number;
    found: number;
    resolved: number;
    totalActive: number;
  }> {
    return this.reportsService.getPublicStats();
  }

  // ─── Coincidencias automáticas ────────────────────────────────────────────

  @Get(':id/matches')
  @ApiOperation({
    summary: 'Coincidencias por reporte',
    description:
      'Obtiene coincidencias potenciales para un reporte comparando especie, tipo opuesto y similitud.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findMatches(
    @Param('id') id: string,
    @Query('limit') limit = '6',
  ): Promise<{ data: ReportWithScore[] }> {
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 20) {
      throw new BadRequestException('El parámetro limit debe ser un entero entre 1 y 20');
    }
    const data = await this.reportsService.findMatchesForReport(id, parsedLimit);
    return { data };
  }

  // ─── Resumen IA ───────────────────────────────────────────────────────────

  @Get(':id/summary')
  @ApiOperation({
    summary: 'Resumen IA de reporte',
    description: 'Genera un resumen breve en español para compartir un reporte de mascota.',
  })
  @ApiParam({ name: 'id', type: String })
  async getSummary(@Param('id') id: string): Promise<{ summary: string }> {
    const summary = await this.reportsService.generateReportSummary(id);
    return { summary };
  }

  // ─── Detalle ──────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Reporte por id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: Report })
  @ApiResponse({ status: 404, description: 'Reporte no encontrado' })
  async findOne(@Param('id') id: string): Promise<Report> {
    return this.reportsService.findById(id);
  }

  // ─── Actualizar ───────────────────────────────────────────────────────────

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Actualizar reporte' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: UpdateReportDto })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: UserFromJwt,
    @Body() updateReportDto: UpdateReportDto,
  ): Promise<Report> {
    return this.reportsService.updateReport(id, user.id, updateReportDto);
  }

  // ─── Eliminar ─────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Eliminar reporte (soft-delete)' })
  @ApiParam({ name: 'id', type: String })
  async remove(@Param('id') id: string, @CurrentUser() user: UserFromJwt): Promise<void> {
    return this.reportsService.removeReport(id, user.id);
  }

  @Delete('admin/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Eliminar reporte (admin, sin verificar propiedad)' })
  @ApiParam({ name: 'id', type: String })
  async adminRemove(@Param('id') id: string): Promise<void> {
    return this.reportsService.adminRemoveReport(id);
  }
}
