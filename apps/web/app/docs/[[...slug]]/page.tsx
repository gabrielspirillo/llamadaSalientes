// Visor web de la documentación técnica (carpeta docs/ de la raíz del repo).
//
// - /docs            → docs/README.md (índice)
// - /docs/<archivo>  → docs/<archivo>.md (ej: /docs/01-arquitectura)
//
// Renderiza el Markdown en el server con `marked` y dibuja los diagramas
// Mermaid en el cliente (mermaid cargado desde CDN, igual que Swagger UI en
// /api/docs). La ruta NO está en la lista pública del middleware, así que
// requiere sesión Clerk. Los archivos docs/ llegan a la imagen standalone
// vía `outputFileTracingIncludes` en next.config.ts — y OJO: .dockerignore
// debe permitirlos (`!docs/*.md`), si no la imagen queda sin contenido.

import fs from 'node:fs';
import path from 'node:path';
import { type Tokens, marked } from 'marked';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MermaidRenderer } from './mermaid-renderer';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Documentación técnica — CliniQ',
  description: 'Documentación para desarrolladores: arquitectura, setup, API y deployment',
};

const GITHUB_BASE = 'https://github.com/gabrielspirillo/llamadaSalientes/blob/main';

// Metadata de los documentos conocidos. El índice /docs se arma acá (no lee
// docs/README.md: el tracer de Next excluye los README del output standalone,
// así que ese archivo no existe en la imagen de producción).
const DOC_META: Array<{ slug: string; title: string; description: string }> = [
  {
    slug: '01-arquitectura',
    title: 'Arquitectura del sistema',
    description:
      'Diagramas de componentes, flujos de telefonía y WhatsApp, colas BullMQ, modelo de datos y estructura del monorepo.',
  },
  {
    slug: '02-setup',
    title: 'Guía de configuración (Setup)',
    description:
      'Clonar, instalar dependencias, levantar Postgres/Redis/MinIO con Docker, env vars y desarrollo local.',
  },
  {
    slug: '03-api-referencia',
    title: 'Referencia de API / Endpoints',
    description:
      'Autenticación, todos los endpoints REST, webhooks, tools del agente de voz y convenciones de error.',
  },
  {
    slug: '04-deployment',
    title: 'Despliegue (Deployment)',
    description:
      'Build de imágenes Docker, auto-deploy con Dokploy, env de producción, migraciones y rollback.',
  },
];

// Etiquetas cortas del menú superior.
const NAV_LABELS: Record<string, string> = {
  '01-arquitectura': 'Arquitectura',
  '02-setup': 'Setup local',
  '03-api-referencia': 'Referencia de API',
  '04-deployment': 'Deployment',
};

// docs/ vive en la raíz del repo. En dev el cwd es apps/web; en el standalone
// de producción server.js hace chdir a apps/web dentro de /app, así que en
// ambos casos queda en ../../docs — igual probamos ambas por robustez.
function resolveDocsDir(): string | null {
  const candidates = [path.join(process.cwd(), '../../docs'), path.join(process.cwd(), 'docs')];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  return null;
}

function listDocs(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
}

// Reescribe los links relativos del Markdown:
// - ./otro-doc.md      → /docs/otro-doc (navegación interna del visor)
// - ../archivo         → blob de GitHub (archivos del repo fuera de docs/)
// - http(s), #anchor   → sin cambios
function rewriteHref(href: string): string {
  if (/^(?:https?:|mailto:|#|\/)/.test(href)) return href;
  const [target = '', hash = ''] = href.split('#');
  const anchor = hash ? `#${hash}` : '';
  if (!target) return href;
  const normalized = path.posix.normalize(path.posix.join('docs', target));
  if (normalized.startsWith('..')) return href;
  if (normalized.startsWith('docs/') && normalized.endsWith('.md')) {
    const name = normalized.slice('docs/'.length, -'.md'.length);
    return name === 'README' ? `/docs${anchor}` : `/docs/${name}${anchor}`;
  }
  return `${GITHUB_BASE}/${normalized}${anchor}`;
}

function renderMarkdown(md: string): string {
  marked.use({
    gfm: true,
    walkTokens: (token) => {
      if (token.type === 'link') {
        (token as Tokens.Link).href = rewriteHref((token as Tokens.Link).href);
      }
    },
  });
  return marked.parse(md, { async: false }) as string;
}

const DOCS_CSS = `
/* Visor de documentación — mismo lenguaje visual que el panel (Aurora). */
.docs-page {
  max-width: 940px; margin: 0 auto; padding: 40px 20px 96px;
  color: #171429; font-size: 15px; line-height: 1.7;
}
.docs-nav {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 32px;
  padding: 6px; border-radius: 999px;
  border: 1px solid #ebe8f6; background: rgba(255,255,255,.7);
  backdrop-filter: saturate(180%) blur(20px);
}
.docs-nav a {
  text-decoration: none; font-size: 13px; font-weight: 600;
  padding: 7px 14px; border-radius: 999px; color: #6d6883;
  transition: background-color .3s, color .3s;
}
.docs-nav a:hover { background: #f4f1ff; color: #5f2acc; }
.docs-nav a.active {
  background: linear-gradient(120deg,#7139e8,#8b5cf6); color: #fff;
  box-shadow: 0 6px 18px -8px rgba(113,57,232,.8);
}
.docs-nav a.external { color: #a29dba; }
.docs-body h1 {
  font-size: 2em; font-weight: 800; letter-spacing: -.02em;
  margin: .4em 0 .5em; padding-bottom: .35em; border-bottom: 1px solid #ebe8f6;
}
.docs-body h2 {
  font-size: 1.4em; font-weight: 700; letter-spacing: -.015em;
  margin-top: 1.8em; padding-bottom: .3em; border-bottom: 1px solid #f3f1f9;
}
.docs-body h3 { font-size: 1.14em; font-weight: 700; margin-top: 1.5em; }
.docs-body a { color: #7139e8; text-decoration: none; font-weight: 500; }
.docs-body a:hover { text-decoration: underline; }
.docs-body code {
  background: #f4f1ff; color: #5f2acc; padding: .16em .45em;
  border-radius: 7px; font-size: .87em;
}
.docs-body pre {
  background: #fbfaff; border: 1px solid #ebe8f6; border-radius: 16px;
  padding: 16px; overflow-x: auto;
  box-shadow: 0 1px 2px rgba(23,20,41,.04), 0 8px 24px -12px rgba(23,20,41,.12);
}
.docs-body pre code { background: none; color: inherit; padding: 0; font-size: .85em; }
.docs-body table {
  border-collapse: separate; border-spacing: 0; display: block;
  overflow-x: auto; margin: 1.2em 0; border-radius: 16px;
  border: 1px solid #ebe8f6;
}
.docs-body th, .docs-body td { border-bottom: 1px solid #f3f1f9; padding: 9px 14px; text-align: left; }
.docs-body tr:last-child td { border-bottom: 0; }
.docs-body th {
  background: #fbfaff; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .1em; color: #a29dba;
}
.docs-body blockquote {
  border-left: 3px solid #bfaeff; margin: 1.2em 0; padding: .2em 1em;
  color: #6d6883; background: #fbfaff; border-radius: 0 12px 12px 0;
}
.docs-body .mermaid { display: flex; justify-content: center; margin: 1.6em 0; overflow-x: auto; }
`;

function DocsNav({
  docs,
  active,
}: {
  docs: string[];
  active: string | null;
}) {
  return (
    <nav className="docs-nav">
      <Link href="/docs" className={active === null ? 'active' : ''}>
        Índice
      </Link>
      {docs.map((doc) => (
        <Link key={doc} href={`/docs/${doc}`} className={doc === active ? 'active' : ''}>
          {NAV_LABELS[doc] ?? doc}
        </Link>
      ))}
      <a href="/api/docs" className="external">
        Swagger UI ↗
      </a>
      <a href={`${GITHUB_BASE}/docs`} className="external" target="_blank" rel="noreferrer">
        GitHub ↗
      </a>
    </nav>
  );
}

// Índice /docs armado en JSX a partir de los archivos realmente disponibles.
function DocsIndex({ available }: { available: string[] }) {
  const known = DOC_META.filter((d) => available.includes(d.slug));
  const extras = available.filter((d) => !DOC_META.some((m) => m.slug === d));
  return (
    <main className="docs-body">
      <h1>Documentación para Desarrolladores</h1>
      <p>
        Documentación técnica de <strong>CliniQ / DentalVoice</strong> — SaaS multi-tenant de agente
        de voz + WhatsApp con IA para clínicas.
      </p>
      <ul>
        {known.map((doc) => (
          <li key={doc.slug}>
            <Link href={`/docs/${doc.slug}`}>
              <strong>{doc.title}</strong>
            </Link>
            <br />
            {doc.description}
          </li>
        ))}
        {extras.map((slug) => (
          <li key={slug}>
            <Link href={`/docs/${slug}`}>
              <strong>{slug}</strong>
            </Link>
          </li>
        ))}
      </ul>
      <h2>Swagger / OpenAPI</h2>
      <ul>
        <li>
          <a href="/api/docs">Swagger UI interactivo</a> (misma sesión del dashboard)
        </li>
        <li>
          <a href="/openapi.yaml">Spec OpenAPI 3.0 (openapi.yaml)</a> — importable en Postman /
          Insomnia / editor.swagger.io
        </li>
      </ul>
      <h2>Otros documentos del repo</h2>
      <ul>
        <li>
          <a href={`${GITHUB_BASE}/README.md`} target="_blank" rel="noreferrer">
            README.md
          </a>{' '}
          — quickstart general
        </li>
        <li>
          <a href={`${GITHUB_BASE}/CLAUDE.md`} target="_blank" rel="noreferrer">
            CLAUDE.md
          </a>{' '}
          — reglas operativas del stack (⚠️ leer antes de tocar infra)
        </li>
        <li>
          <a href={`${GITHUB_BASE}/DEPLOYMENT.md`} target="_blank" rel="noreferrer">
            DEPLOYMENT.md
          </a>{' '}
          — guía paso a paso original de despliegue en Dokploy
        </li>
      </ul>
    </main>
  );
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const docsDir = resolveDocsDir();
  if (!docsDir) notFound();

  // El tracer no incluye README.md en standalone, así que lo excluimos también
  // en dev para que ambos entornos se comporten igual.
  const available = listDocs(docsDir).filter((d) => d !== 'README');

  // /docs sin slug → índice armado en JSX (sin leer archivos).
  if (!slug || slug.length === 0) {
    return (
      <div className="docs-page">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: CSS estático definido en este archivo */}
        <style dangerouslySetInnerHTML={{ __html: DOCS_CSS }} />
        <DocsNav docs={available} active={null} />
        <DocsIndex available={available} />
      </div>
    );
  }

  // Solo archivos existentes en docs/ — sin path traversal.
  const requested = slug[0] ?? '';
  if (slug.length > 1) notFound();
  if (!/^[\w.-]+$/.test(requested) || !available.includes(requested)) notFound();

  const md = fs.readFileSync(path.join(docsDir, `${requested}.md`), 'utf8');
  const html = renderMarkdown(md);

  return (
    <div className="docs-page">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: CSS estático definido en este archivo */}
      <style dangerouslySetInnerHTML={{ __html: DOCS_CSS }} />
      <DocsNav docs={available} active={requested} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown propio del repo (docs/), no input de usuarios */}
      <main className="docs-body" dangerouslySetInnerHTML={{ __html: html }} />
      <MermaidRenderer docKey={requested} />
    </div>
  );
}
