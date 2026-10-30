import { createRequire } from 'node:module';
import { Language, type Node, Parser } from 'web-tree-sitter';

await Parser.init();

export const parserOf = async (grammar: string): Promise<(text: string) => Node | undefined> => {
  const parser = new Parser();
  parser.setLanguage(
    await Language.load(createRequire(import.meta.url).resolve(`${grammar}/${grammar}.wasm`)),
  );
  return text => parser.parse(text)?.rootNode;
};
