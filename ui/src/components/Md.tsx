// Tiny markdown for chat text: **bold**, `code`, "- " bullets and paragraphs. No HTML is ever injected.
import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <b key={i} className="font-semibold text-ink">{part.slice(2, -2)}</b>;
    if (/^`[^`]+`$/.test(part)) return <code key={i} className="rounded bg-tile px-1 py-px font-mono text-[12px] text-ink">{part.slice(1, -1)}</code>;
    return part;
  });
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul'; items: string[] };
const BULLET = /^\s*[-*•] /;

// line by line, so "Yapılanlar:" followed by bullets becomes a paragraph and a list
function parse(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.trim().split('\n')) {
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      blocks.push({ kind: 'p', lines: [] });
    } else if (BULLET.test(line)) {
      const item = line.replace(BULLET, '');
      if (last?.kind === 'ul') last.items.push(item);
      else blocks.push({ kind: 'ul', items: [item] });
    } else if (last?.kind === 'p') last.lines.push(line);
    else blocks.push({ kind: 'p', lines: [line] });
  }
  return blocks.filter((b) => (b.kind === 'p' ? b.lines.length : b.items.length));
}

export function Md({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      {parse(text).map((b, i) =>
        b.kind === 'ul' ? (
          <ul key={i} className="list-disc space-y-0.5 pl-4 marker:text-faint">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {inline(b.lines.join('\n'))}
          </p>
        )
      )}
    </div>
  );
}
