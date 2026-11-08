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
  readonly foundByName?: true;
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
  ...(decision.foundByName ? { foundByName: true } : {}),
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

const KEYWORDS = new Set([
  'if',
  'else',
  'elsif',
  'unless',
  'return',
  'throw',
  'raise',
  'catch',
  'rescue',
  'case',
  'when',
  'for',
  'while',
  'until',
  'of',
  'in',
  'let',
  'match',
  'not',
  'and',
  'or',
  'undefined',
  'null',
  'nil',
  'true',
  'false',
  'this',
  'self',
  'typeof',
  'instanceof',
  'new',
  'await',
  'void',
  'delete',
  'yield',
  'const',
  'var',
  'then',
  'do',
  'end',
  'defined',
  'begin',
  'ensure',
  'next',
  'break',
  'continue',
]);

const namesOf = (text: string): ReadonlySet<string> =>
  new Set((text.match(/[A-Za-z_$][\w$]*/g) ?? []).filter(word => !KEYWORDS.has(word)));

type Renames = {
  readonly gone: ReadonlySet<string>;
  readonly new: ReadonlySet<string>;
};

const namesIn = (decisions: ReadonlyArray<Decision>): ReadonlySet<string> =>
  new Set(decisions.flatMap(({ text }) => [...namesOf(text)]));

const renamesOf = ({ base, head }: Sides): Renames => {
  const before = namesIn(base);
  const after = namesIn(head);
  return {
    gone: new Set([...before].filter(name => !after.has(name))),
    new: new Set([...after].filter(name => !before.has(name))),
  };
};

const shareAName = (base: Decision, head: Decision, renames: Renames): boolean => {
  const names = [...namesOf(base.text)];
  const others = namesOf(head.text);
  return (
    names.length === 0 ||
    others.size === 0 ||
    names.some(name => others.has(name)) ||
    (names.some(name => renames.gone.has(name)) && [...others].some(name => renames.new.has(name)))
  );
};

const canPair = (base: Decision, head: Decision, renames: Renames): boolean =>
  base.kind === head.kind &&
  shareAName(base, head, renames) &&
  (base.subject ?? []).every(name => head.subject?.some(held => tokensOf(held) === tokensOf(name)));

type Pairing = {
  readonly left: ReadonlyArray<Decision>;
  readonly lines: ReadonlyArray<LogicLine>;
};

const linesOfGap = ({ base, head }: Sides, renames: Renames): ReadonlyArray<LogicLine> => {
  const paired = head.reduce<Pairing>(
    ({ left, lines }, decision) => {
      const partner = left.find(one => canPair(one, decision, renames));
      return partner === undefined
        ? { left, lines: [...lines, ofHead('added', decision)] }
        : {
            left: left.filter(one => one !== partner),
            lines: [...lines, changed(partner, decision)],
          };
    },
    { left: base, lines: [] },
  );
  return [...paired.left.map(removed), ...paired.lines];
};

export const logicDiff = ({ base, head }: Sides): ReadonlyArray<LogicLine> => {
  const renames = renamesOf({ base, head });
  return aligned({ base, head, same: sameDecision }).flatMap(run =>
    'kept' in run ? [ofHead('same', run.kept)] : linesOfGap(run, renames),
  );
};
