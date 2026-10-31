import { parse } from '@babel/parser';
import { z } from 'zod';
import type { FileMeasures } from '../../core/reader.ts';

const RowSchema = z.object({ line: z.number() });

const TokenSchema = z.object({
  type: z.union([z.string(), z.object({ label: z.string() }).transform(({ label }) => label)]),
  loc: z.object({ start: RowSchema, end: RowSchema }),
});

const NOT_CODE = new Set(['CommentLine', 'CommentBlock', 'eof']);

const rowsOf = ({ loc: { start, end } }: z.infer<typeof TokenSchema>): ReadonlyArray<number> =>
  Array.from({ length: end.line - start.line + 1 }, (_, index) => start.line + index);

export const measureTypeScript = (text: string): FileMeasures => {
  const { tokens } = parse(text, { sourceType: 'module', plugins: ['typescript'], tokens: true });
  const code = z
    .array(TokenSchema)
    .parse(tokens)
    .filter(({ type }) => !NOT_CODE.has(type));
  return { lines: new Set(code.flatMap(rowsOf)).size, functions: [] };
};
