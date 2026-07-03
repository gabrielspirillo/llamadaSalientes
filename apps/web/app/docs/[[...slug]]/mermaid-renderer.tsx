'use client';

// Convierte los bloques ```mermaid del Markdown en diagramas SVG.
//
// Corre en useEffect (post-hidratación) porque mutar el DOM antes de que
// React hidrate hace que la hidratación pise los diagramas y queden como
// código crudo. `mermaid` va empaquetado (import dinámico → chunk aparte
// que solo se descarga en /docs), sin depender de un CDN externo.

import { useEffect } from 'react';

export function MermaidRenderer({ docKey }: { docKey: string }) {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const blocks = Array.from(document.querySelectorAll('pre > code.language-mermaid'));
      if (blocks.length === 0) return;

      const mermaid = (await import('mermaid')).default;
      if (cancelled) return;

      for (const code of blocks) {
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = code.textContent ?? '';
        code.closest('pre')?.replaceWith(div);
      }

      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
      await mermaid.run({ querySelector: '.mermaid' });
    })().catch((err) => {
      // Si mermaid falla, los diagramas quedan como código — la página sigue usable.
      console.error('[docs] error renderizando diagramas mermaid', err);
    });

    return () => {
      cancelled = true;
    };
    // docKey: re-renderizar al navegar entre documentos (el HTML del body cambia).
  }, [docKey]);

  return null;
}
