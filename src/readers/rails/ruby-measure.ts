import type { Node } from 'web-tree-sitter';
import type { FileMeasures, FunctionMeasures } from '../../core/reader.ts';
import { codeLines } from '../tree-sitter.ts';
import { parseRuby } from './ruby-syntax.ts';

const METHODS = ['method', 'singleton_method'];

const nameOf = (method: Node): string => {
  const name = method.childForFieldName('name')?.text ?? '';
  const object = method.childForFieldName('object');
  return object === null ? name : `${object.text}.${name}`;
};

const measureMethod = (method: Node): FunctionMeasures => ({
  name: nameOf(method),
  cyclomatic: 1,
  abc: { assignments: 0, branches: 0, conditions: 0 },
});

export const measureRuby = (text: string): FileMeasures | undefined => {
  const program = parseRuby(text);
  if (program === undefined) return undefined;
  return {
    lines: codeLines(program, node => node.type === 'comment'),
    functions: program.descendantsOfType(METHODS).map(measureMethod),
  };
};
