import type { FileMeasures } from '../../core/reader.ts';
import { codeLines } from '../tree-sitter.ts';
import { parseRuby } from './ruby-syntax.ts';

export const measureRuby = (text: string): FileMeasures | undefined => {
  const program = parseRuby(text);
  if (program === undefined) return undefined;
  return { lines: codeLines(program, node => node.type === 'comment'), functions: [] };
};
