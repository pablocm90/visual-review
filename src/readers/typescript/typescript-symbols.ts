import type { FileSymbols } from '../../core/reader.ts';
import { parseTypeScript, symbolsIn } from './typescript-syntax.ts';

export const symbolsOfTypeScript = (text: string, path: string): FileSymbols => {
  const { program } = parseTypeScript(text, path);
  return { symbols: symbolsIn(text, program).map(({ symbol }) => symbol) };
};
