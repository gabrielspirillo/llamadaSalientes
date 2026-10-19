import { cn } from '@/lib/cn';
import { RICH_COLORS, type RichNode, parseRich } from '@/lib/rich-text';
import type * as React from 'react';

/**
 * Pinta un texto con formato (`lib/rich-text.ts`) creando los elementos uno a
 * uno: nunca `dangerouslySetInnerHTML`. Sirve en servidor y en cliente. Un
 * texto sin etiquetas se ve igual que antes (los saltos de línea se respetan).
 */
export function RichText({
  value,
  className,
  as: Tag = 'span',
}: {
  value: string | null | undefined;
  className?: string;
  as?: 'span' | 'div' | 'p';
}) {
  if (!value) return null;
  return <Tag className={cn('whitespace-pre-wrap', className)}>{render(parseRich(value))}</Tag>;
}

function render(nodes: RichNode[]): React.ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${n.type}-${i}`;
    switch (n.type) {
      case 'text':
        return n.text;
      case 'br':
        return <br key={key} />;
      case 'b':
        return (
          <strong key={key} className="font-bold">
            {render(n.children)}
          </strong>
        );
      case 'i':
        return <em key={key}>{render(n.children)}</em>;
      case 'u':
        return (
          <u key={key} className="underline underline-offset-2">
            {render(n.children)}
          </u>
        );
      case 'mark':
        return (
          <mark key={key} className="rounded-[3px] bg-yellow-200 px-0.5 text-inherit">
            {render(n.children)}
          </mark>
        );
      case 'color':
        return (
          <span key={key} style={{ color: RICH_COLORS[n.color].hex }}>
            {render(n.children)}
          </span>
        );
      case 'ul':
        return (
          <ul key={key} className="my-1 list-disc whitespace-normal pl-5">
            {render(n.children)}
          </ul>
        );
      case 'ol':
        return (
          <ol key={key} className="my-1 list-decimal whitespace-normal pl-5">
            {render(n.children)}
          </ol>
        );
      case 'li':
        return (
          <li key={key} className="whitespace-pre-wrap">
            {render(n.children)}
          </li>
        );
      default:
        return null;
    }
  });
}
