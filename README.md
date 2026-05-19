# PetFinder Backend API

API REST para la plataforma de reportes y reencuentro de mascotas.

Este servicio centraliza autenticación, usuarios, reportes, notificaciones, geolocalización y capacidades de IA para análisis de imagen, coincidencias y resumen de reportes.

## Qué hace este backend

- Gestiona usuarios, sesiones y roles.
- Permite crear y consultar reportes de mascotas perdidas o encontradas.
- Procesa imágenes de reportes y extrae señales con IA.
- Ejecuta búsqueda semántica y coincidencias automáticas entre reportes.
- Genera un resumen corto de reporte para compartir.
- Sirve como base para despliegue en Azure (API + Blob + Cosmos DB).

## Arquitectura

El proyecto está organizado con enfoque de Clean Architecture + DDD:

- presentation: controladores HTTP, guards, decorators, filtros.
- application: servicios de casos de uso y DTOs.
- domain: entidades, reglas de negocio, enums y contratos.
- infrastructure: configuración, repositorios y servicios externos.

Documentación complementaria:

- [ARQUITECTURA.md](ARQUITECTURA.md)
- [docs/AUTH-GUARDS.md](docs/AUTH-GUARDS.md)
- [docs/PASSWORD-SECURITY.md](docs/PASSWORD-SECURITY.md)
- [docs/REGISTER-ENDPOINT.md](docs/REGISTER-ENDPOINT.md)

## Stack

- NestJS + TypeScript
- JWT + Passport
- Azure Blob Storage (imágenes)
- Azure Cosmos DB
- Gemini (análisis de imagen, embeddings, resumen)
- Jest para pruebas

## Requisitos

- Node.js 18+
- npm 9+
- Variables de entorno configuradas

## Instalación

```bash
npm install
cp .env.example .env
```

## Ejecución local

```bash
npm run start:dev
```

Build de producción:

```bash
npm run build
npm run start:prod
```

## Variables de entorno importantes

Configura al menos estas variables para habilitar todas las capacidades:

- `PORT`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `COSMOS_ENDPOINT`
- `COSMOS_KEY`
- `COSMOS_DATABASE`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER`
- `GEMINI_API_KEY`

Notas:

- Si `GEMINI_API_KEY` no está configurada, la API no se cae: usa fallback seguro en funciones de IA.
- Si Blob o Cosmos no están configurados correctamente, endpoints dependientes fallarán.

## Scripts útiles

```bash
npm run start:dev
npm run build
npm run lint
npm run test
npm run test:e2e
```

## Endpoints principales

Prefijo base: `/api/v1`

### Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`

### Users

- `GET /users/profile/me`
- `PUT /users/profile/me`
- `PUT /users/change-password`
- `POST /users/avatar`
- `DELETE /users/avatar`
- `DELETE /users/account`

### Reports

- `POST /reports`
- `GET /reports`
- `GET /reports/:id`
- `PUT /reports/:id`
- `DELETE /reports/:id`
- `POST /reports/upload-image`
- `POST /reports/analyze-image`
- `GET /reports/ai-status`
- `GET /reports/search`
- `GET /reports/:id/matches`
- `GET /reports/:id/summary`
- `GET /reports/export`
- `GET /reports/export/csv`

### Notifications

- `GET /notifications`
- `GET /notifications/unread`
- `PUT /notifications/:id/read`
- `PUT /notifications/read-all`
- `DELETE /notifications/:id`

## IA y comportamiento de fallback

### Análisis de imagen

`POST /reports/analyze-image` intenta detectar especie, color y raza.

- Si IA está disponible: devuelve resultado de análisis.
- Si IA falla: devuelve respuesta controlada para completar manualmente.

### Coincidencias automáticas

`GET /reports/:id/matches` calcula coincidencias comparando:

- especie (obligatoria)
- tipo opuesto (perdido vs encontrado)
- similitud semántica de descripción y atributos
- componente geográfica si hay coordenadas

No devuelve "todos los reportes" por defecto: si no hay coincidencias reales, devuelve lista vacía.

### Resumen de reporte

`GET /reports/:id/summary` genera un texto breve para compartir.

- Usa Gemini si está disponible.
- Si no, arma un resumen de fallback con datos del reporte.

## Flujo sugerido para reportes con imagen

1. Subir imagen con `POST /reports/upload-image`.
2. (Opcional) analizar con `POST /reports/analyze-image`.
3. Crear reporte con `POST /reports`.
4. Consultar coincidencias con `GET /reports/:id/matches`.
5. Consultar resumen con `GET /reports/:id/summary`.

## Estado del proyecto

Este backend está preparado para entorno real con Azure y ya incluye las integraciones principales para demo funcional:

- autenticación
- CRUD de reportes
- carga de imágenes
- búsqueda y matches
- resumen de IA
- configuración de usuario

## Licencia

Uso académico y de proyecto interno.
