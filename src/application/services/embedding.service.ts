import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly genAI: GoogleGenerativeAI | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('gemini.apiKey');
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.logger.log('✅ Gemini Embedding Service initialized');
    } else {
      this.logger.warn('⚠️  GEMINI_API_KEY not configured — semantic search disabled');
    }
  }

  /**
   * Genera un vector de embedding para el texto dado usando Gemini text-embedding-004.
   * Retorna [] si la API no está configurada o falla (fallback seguro).
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.genAI) return [];

    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
      const result = await model.embedContent(text.trim());
      return result.embedding.values;
    } catch (error) {
      this.logger.warn(`Error generando embedding: ${error.message}`);
      return [];
    }
  }

  /**
   * Calcula la similitud coseno entre dos vectores.
   * Retorna un valor entre 0 (sin similitud) y 1 (idénticos).
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (!a?.length || !b?.length || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }

  /**
   * Construye texto bilingüe (español + inglés) con sinónimos para maximizar la cobertura
   * semántica. Incluye el tipo del reporte (perdido/encontrado) con sus variantes léxicas.
   */
  buildReportText(report: {
    species: string;
    color: string;
    breed: string;
    size: string;
    description: string;
    type?: string;
  }): string {
    const speciesMap: Record<string, { es: string; en: string }> = {
      dog: { es: 'perro', en: 'dog' },
      cat: { es: 'gato', en: 'cat' },
      bird: { es: 'ave pájaro', en: 'bird' },
      rabbit: { es: 'conejo', en: 'rabbit' },
      other: { es: 'mascota animal', en: 'pet animal' },
    };
    const sizeMap: Record<string, { es: string; en: string }> = {
      small: { es: 'pequeño chico', en: 'small' },
      medium: { es: 'mediano', en: 'medium' },
      large: { es: 'grande', en: 'large' },
    };
    const typeMap: Record<string, { es: string; en: string }> = {
      lost: { es: 'perdido extraviado desaparecido', en: 'lost missing' },
      found: { es: 'encontrado hallado rescatado', en: 'found rescued' },
    };

    const spec = speciesMap[report.species] ?? { es: report.species, en: report.species };
    const sz = report.size ? (sizeMap[report.size] ?? null) : null;
    const tp = report.type ? (typeMap[report.type] ?? null) : null;

    // Oración en español: especie raza, color X, tamaño Y, estado
    const esParts = [
      spec.es,
      report.breed,
      report.color ? `color ${report.color}` : '',
      sz ? `tamaño ${sz.es}` : '',
      tp ? tp.es : '',
    ]
      .filter(Boolean)
      .join(', ');

    // Oración en inglés: estado tamaño color raza especie
    const enParts = [tp?.en ?? '', sz?.en ?? '', report.color ?? '', report.breed ?? '', spec.en]
      .filter(Boolean)
      .join(' ');

    return [esParts, enParts, report.description]
      .filter(Boolean)
      .join('. ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normaliza la query del usuario antes de generar su embedding:
   * - Corrige palabras en español escritas sin tilde
   * - Expande sinónimos comunes de búsqueda de mascotas (español ↔ inglés)
   */
  preprocessQuery(query: string): string {
    let q = query.trim().toLowerCase();

    // Corrección de tildes omitidas (errores tipográficos frecuentes en español)
    const accentFixes: [RegExp, string][] = [
      [/\bperdio\b/g, 'perdió'],
      [/\bencontro\b/g, 'encontró'],
      [/\bdesaparecio\b/g, 'desapareció'],
      [/\bpequeno\b/g, 'pequeño'],
      [/\bextravio\b/g, 'extravió extraviado'],
      [/\bpajaro\b/g, 'pájaro ave'],
    ];
    for (const [re, rep] of accentFixes) {
      q = q.replace(re, rep);
    }

    // Expansión de sinónimos: cada término se amplía con sus equivalentes semánticos
    const synonyms: [RegExp, string][] = [
      [/\bextraviado\b/g, 'extraviado perdido lost missing'],
      [/\bdesaparecido\b/g, 'desaparecido perdido lost missing'],
      [/\bhallado\b/g, 'hallado encontrado found'],
      [/\brescatado\b/g, 'rescatado encontrado found rescued'],
      [/\babandonado\b/g, 'abandonado perdido stray lost'],
      [/\bcallejero\b/g, 'callejero perdido stray lost'],
      [/\bcachorro\b/g, 'cachorro perro dog puppy'],
      [/\bperrito\b/g, 'perrito perro dog'],
      [/\bgatito\b/g, 'gatito gato cat'],
    ];
    for (const [re, rep] of synonyms) {
      q = q.replace(re, rep);
    }

    return q;
  }

  /**
   * Calcula la distancia en km entre dos coordenadas usando la fórmula Haversine.
   */
  calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (v: number) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(3));
  }

  isAvailable(): boolean {
    return this.genAI !== null;
  }

  /**
   * Genera un resumen breve y compartible en español para un reporte.
   * Retorna null si Gemini no está disponible o falla.
   */
  async generateSocialSummary(input: {
    species: string;
    type: string;
    color?: string;
    breed?: string;
    size?: string;
    description?: string;
  }): Promise<string | null> {
    if (!this.genAI) return null;

    const prompt = [
      'Redacta un resumen en español para redes sociales sobre una mascota perdida/encontrada.',
      'Requisitos:',
      '- 2 a 3 oraciones cortas.',
      '- Tono humano, claro y empatico (no robotico).',
      '- Maximo 260 caracteres.',
      '- Sin hashtags ni emojis.',
      '- Sin inventar datos que no esten en el contexto.',
      '- Devuelve solo el texto final.',
      '',
      `Contexto: especie=${input.species}, tipo=${input.type}, color=${input.color ?? 'N/D'}, raza=${input.breed ?? 'N/D'}, tamano=${input.size ?? 'N/D'}`,
      `Descripcion: ${input.description ?? 'N/D'}`,
    ].join('\n');

    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(prompt);
      const text = result.response.text()?.trim();
      if (!text) return null;
      return text.replace(/^"|"$/g, '').trim();
    } catch (error) {
      this.logger.warn(`Error generando resumen IA: ${error.message}`);
      return null;
    }
  }
}
