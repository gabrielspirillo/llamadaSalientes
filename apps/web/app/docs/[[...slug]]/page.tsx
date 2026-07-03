// Visor web de la documentación técnica (carpeta docs/ de la raíz del repo).
//
// - /docs            → docs/README.md (índice)
// - /docs/<archivo>  → docs/<archivo>.md (ej: /docs/01-arquitectura)
//
// Renderiza el Markdown en el server con `marked` y dibuja los diagramas
// Mermaid en el cliente (mermaid cargado desde CDN, igual que Swagger UI en
// /api/docs). La ruta NO está en la lista pública del middleware, así que
// requiere sesión Clerk. Los archivos docs/ llegan a la imagen standalone
// vía `outputFileTracingIncludes` en next.config.ts.

import fs from 'node:fs';
import path from 'node:path';
import { type Tokens, marked } from 'marked';
import Link from 'next/link';
import { notFound } from 'next/navigation';

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

// Convierte los bloques ```mermaid en diagramas. Mismo patrón CDN que
// swagger-ui en /api/docs: sin dependencias npm ni build extra.
const MERMAID_SCRIPT = `
import mermaid from 'https://unpkg.com/mermaid@11/dist/mermaid.esm.min.mjs';
for (const code of document.querySelectorAll('pre > code.language-mermaid')) {
  const div = document.createElement('div');
  div.className = 'mermaid';
  div.textContent = code.textContent;
  code.closest('pre').replaceWith(div);
}
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
await mermaid.run({ querySelector: '.mermaid' });
`;

const DOCS_CSS = `
.docs-page { max-width: 900px; margin: 0 auto; padding: 24px 20px 80px; color: #1f2328; font-size: 15px; line-height: 1.65; }
.docs-nav { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 28px; padding-bottom: 14px; border-bottom: 1px solid #d1d9e0; }
.docs-nav a { text-decoration: none; font-size: 13px; font-weight: 500; padding: 5px 12px; border-radius: 999px; border: 1px solid #d1d9e0; color: #1f2328; }
.docs-nav a.active { background: #1f2328; color: #fff; border-color: #1f2328; }
.docs-nav a.external { border-style: dashed; }
.docs-body h1 { font-size: 1.9em; border-bottom: 1px solid #d1d9e0; padding-bottom: .3em; margin: .4em 0 .6em; }
.docs-body h2 { font-size: 1.4em; border-bottom: 1px solid #d1d9e0; padding-bottom: .3em; margin-top: 1.6em; }
.docs-body h3 { font-size: 1.15em; margin-top: 1.4em; }
.docs-body a { color: #0969da; text-decoration: none; }
.docs-body a:hover { text-decoration: underline; }
.docs-body code { background: #f0f1f3; padding: .15em .4em; border-radius: 6px; font-size: .88em; }
.docs-body pre { background: #f6f8fa; border: 1px solid #d1d9e0; border-radius: 8px; padding: 14px; overflow-x: auto; }
.docs-body pre code { background: none; padding: 0; font-size: .85em; }
.docs-body table { border-collapse: collapse; display: block; overflow-x: auto; margin: 1em 0; }
.docs-body th, .docs-body td { border: 1px solid #d1d9e0; padding: 6px 12px; text-align: left; }
.docs-body th { background: #f6f8fa; }
.docs-body blockquote { border-left: 4px solid #d1d9e0; margin: 1em 0; padding: 0 1em; color: #59636e; }
.docs-body .mermaid { display: flex; justify-content: center; margin: 1.4em 0; overflow-x: auto; }
@media (prefers-color-scheme: dark) {
  .docs-page { color: #e6edf3; }
  .docs-nav { border-color: #30363d; }
  .docs-nav a { border-color: #30363d; color: #e6edf3; }
  .docs-nav a.active { background: #e6edf3; color: #0d1117; border-color: #e6edf3; }
  .docs-body h1, .docs-body h2 { border-color: #30363d; }
  .docs-body a { color: #4493f8; }
  .docs-body code { background: #2a2f36; }
  .docs-body pre { background: #161b22; border-color: #30363d; }
  .docs-body th, .docs-body td { border-color: #30363d; }
  .docs-body th { background: #161b22; }
  .docs-body blockquote { border-color: #30363d; color: #9198a1; }
}
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
        Documentación técnica de <strong>CliniQ / DentalVoice</strong> — SaaS multi-tenant de
        agente de voz + WhatsApp con IA para clínicas.
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
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: script estático para renderizar diagramas Mermaid */}
      <script type="module" dangerouslySetInnerHTML={{ __html: MERMAID_SCRIPT }} />
    </div>
  );
}
