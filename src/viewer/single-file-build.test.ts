import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

test('the viewer builds to a single HTML file that loads nothing from outside itself', () => {
  const html = readFileSync(join(import.meta.dirname, '..', '..', 'dist', 'viewer.html'), 'utf8');

  expect(html).toContain('<script type="application/json" id="review-data">');
  const markup = html.replace(/(<(script|style)\b[^>]*>)[\s\S]*?<\/\2>/g, '$1</$2>');
  expect(markup.match(/\b(?:src|href)=["'](?!#|data:)[^"']*/g)).toBeNull();
});
