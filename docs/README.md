# Documentación para Desarrolladores

Documentación técnica de **CliniQ / DentalVoice** — SaaS multi-tenant de agente de voz + WhatsApp con IA para clínicas.

| Documento | Contenido |
|---|---|
| [01 — Arquitectura del sistema](./01-arquitectura.md) | Diagramas (Mermaid) de componentes, flujos de telefonía y WhatsApp, colas BullMQ, modelo de datos y estructura del monorepo |
| [02 — Guía de configuración (Setup)](./02-setup.md) | Clonar, instalar dependencias, levantar Postgres/Redis/MinIO con Docker, env vars y entorno de desarrollo local |
| [03 — Referencia de API / Endpoints](./03-api-referencia.md) | Autenticación, todos los endpoints REST, webhooks, tools del agente de voz y convenciones de error |
| [04 — Despliegue (Deployment)](./04-deployment.md) | Build de imágenes Docker, auto-deploy con Dokploy, env de producción, migraciones y rollback |

## Swagger / OpenAPI

- Spec: [`apps/web/public/openapi.yaml`](../apps/web/public/openapi.yaml)
- Swagger UI interactivo: **`/api/docs`** (requiere sesión Clerk) — en producción `https://app.futuradigital.es/api/docs`

## Otros documentos del repo

- [`README.md`](../README.md) — quickstart general
- [`CLAUDE.md`](../CLAUDE.md) — reglas operativas del stack (⚠️ leer antes de tocar infra)
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) — guía paso a paso original de despliegue en Dokploy

> Los diagramas usan sintaxis **Mermaid** y se renderizan automáticamente en GitHub.
