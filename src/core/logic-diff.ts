import { aligned } from './aligned.ts';
import type { Decision, DecisionKind } from './reader.ts';

export type LogicLine = {
  readonly change: 'same' | 'added' | 'removed' | 'changed' | 'moved';
  readonly kind: DecisionKind;
  readonly depth: number;
  readonly base?: string;
  readonly head?: string;
  readonly line: number;
  readonly movedTo?: string;
  readonly movedToNode?: string;
};

type Sides = {
  readonly base: ReadonlyArray<Decision>;
  readonly head: ReadonlyArray<Decision>;
};

const STRINGS = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/;

const isWord = (character: string | undefined): boolean => /[\w$]/.test(character ?? '');

const spacingOf = (code: string): string =>
  code.replace(/\s+/g, (space, at: number) =>
    isWord(code[at - 1]) && isWord(code[at + space.length]) ? ' ' : '',
  );

const tokensOf = (text: string): string =>
  text
    .split(STRINGS)
    .map((part, index) => (index % 2 === 0 ? spacingOf(part) : part))
    .join('');

const sameDecision = (one: Decision, other: Decision): boolean =>
  one.kind === other.kind && tokensOf(one.text) === tokensOf(other.text);

export const decisionKey = ({ kind, text }: Pick<Decision, 'kind' | 'text'>): string =>
  `${kind} ${tokensOf(text)}`;

export const decisionText = ({ base, head }: LogicLine): string => head ?? base ?? '';

const removed = (decision: Decision): LogicLine => ({
  change: 'removed',
  kind: decision.kind,
  depth: decision.depth,
  base: decision.text,
  line: decision.line,
});

const ofHead = (change: 'same' | 'added', decision: Decision): LogicLine => ({
  change,
  kind: decision.kind,
  depth: decision.depth,
  head: decision.text,
  line: decision.line,
});

const changed = (old: Decision, decision: Decision): LogicLine => ({
  change: 'changed',
  kind: decision.kind,
  depth: decision.depth,
  base: old.text,
  head: decision.text,
  line: decision.line,
});

const sameKindBefore = (decisions: ReadonlyArray<Decision>, index: number): number =>
  decisions.slice(0, index).filter(({ kind }) => kind === decisions[index]?.kind).length;

const linesOfGap = ({ base, head }: Sides): ReadonlyArray<LogicLine> => {
  const partners = head.map(
    (decision, index) =>
      base.filter(({ kind }) => kind === decision.kind)[sameKindBefore(head, index)],
  );
  return [
    ...base.filter(decision => !partners.includes(decision)).map(removed),
    ...head.map((decision, index) => {
      const partner = partners[index];
      return partner ? changed(partner, decision) : ofHead('added', decision);
    }),
  ];
};

export const logicDiff = ({ base, head }: Sides): ReadonlyArray<LogicLine> =>
  aligned({ base, head, same: sameDecision }).flatMap(run =>
    'kept' in run ? [ofHead('same', run.kept)] : linesOfGap(run),
  );
