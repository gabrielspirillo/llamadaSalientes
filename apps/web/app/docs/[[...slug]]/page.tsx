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

// Etiquetas del menú para los documentos conocidos; fallback = nombre del archivo.
const NAV_LABELS: Record<string, string> = {
  README: 'Índice',
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

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const docsDir = resolveDocsDir();
  if (!docsDir) notFound();

  const available = listDocs(docsDir);
  const requested = slug?.[0] ?? 'README';
  // Solo archivos existentes en docs/ — sin path traversal.
  if (slug && slug.length > 1) notFound();
  if (!/^[\w.-]+$/.test(requested) || !available.includes(requested)) notFound();

  const md = fs.readFileSync(path.join(docsDir, `${requested}.md`), 'utf8');
  const html = renderMarkdown(md);
  const navDocs = ['README', ...available.filter((d) => d !== 'README')];

  return (
    <div className="docs-page">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: CSS estático definido en este archivo */}
      <style dangerouslySetInnerHTML={{ __html: DOCS_CSS }} />
      <nav className="docs-nav">
        {navDocs.map((doc) => (
          <Link
            key={doc}
            href={doc === 'README' ? '/docs' : `/docs/${doc}`}
            className={doc === requested ? 'active' : ''}
          >
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
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown propio del repo (docs/), no input de usuarios */}
      <main className="docs-body" dangerouslySetInnerHTML={{ __html: html }} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: script estático para renderizar diagramas Mermaid */}
      <script type="module" dangerouslySetInnerHTML={{ __html: MERMAID_SCRIPT }} />
    </div>
  );
}
