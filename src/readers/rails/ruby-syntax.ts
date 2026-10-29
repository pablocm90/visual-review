import { createRequire } from 'node:module';
import { Language, type Node, Parser } from 'web-tree-sitter';

await Parser.init();
const parser = new Parser();
parser.setLanguage(
  await Language.load(
    createRequire(import.meta.url).resolve('tree-sitter-ruby/tree-sitter-ruby.wasm'),
  ),
);

export const parseRuby = (text: string): Node | undefined => parser.parse(text)?.rootNode;
