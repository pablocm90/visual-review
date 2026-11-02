import type { FileSymbols } from '../../core/reader.ts';
import { functionsIn, parseTypeScript } from './typescript-syntax.ts';

export const symbolsOfTypeScript = (text: string, path: string): FileSymbols => {
  const { program } = parseTypeScript(text, path);
  return { symbols: functionsIn(text, program).map(({ symbol }) => symbol) };
};
