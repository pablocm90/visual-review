import { parserOf } from '../tree-sitter.ts';

export const parseRuby = await parserOf('tree-sitter-ruby');
