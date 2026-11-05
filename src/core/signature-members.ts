import { aligned } from './aligned.ts';

export type SplitSignature = {
  readonly by: '(' | '{' | '|';
  readonly opener: string;
  readonly members: ReadonlyArray<string>;
  readonly closer: string;
};

type Mark = { readonly token: string; readonly at: number; readonly depth: number };

type Scan = { readonly open: string; readonly marks: ReadonlyArray<Mark> };

const STRINGS = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/.source;

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//.source;

const STRUCTURE = new RegExp(`${STRINGS}|${BLOCK_COMMENT}|//|/\\*|=>|[()[\\]{}<>,;=|'"\`]`, 'g');

const UNSPLITTABLE: ReadonlyArray<string> = ["'", '"', '`', '//', '/*'];

const OPENER_OF: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

const scanned = (scan: Scan, open: string, mark: Mark): Scan => ({
  open,
  marks: [...scan.marks, mark],
});

const step = (scan: Scan, token: string, at: number): Scan | undefined => {
  const depth = scan.open.length;
  if (UNSPLITTABLE.includes(token)) return undefined;
  if ('([{<'.includes(token)) return scanned(scan, scan.open + token, { token, at, depth });
  if (token === '>')
    return scan.open.endsWith('<') ? { ...scan, open: scan.open.slice(0, -1) } : scan;
  const opener = OPENER_OF[token];
  if (opener === undefined) return scanned(scan, scan.open, { token, at, depth });
  if (!scan.open.endsWith(opener)) return undefined;
  return scanned(scan, scan.open.slice(0, -1), { token, at, depth: depth - 1 });
};

const marksOf = (text: string): ReadonlyArray<Mark> | undefined => {
  const scan = [...text.matchAll(STRUCTURE)].reduce<Scan | undefined>(
    (sofar, match) => sofar && step(sofar, match[0], match.index),
    { open: '', marks: [] },
  );
  return scan?.open === '' ? scan.marks : undefined;
};

type Slices = {
  readonly by: SplitSignature['by'];
  readonly start: number;
  readonly cuts: ReadonlyArray<number>;
  readonly end: number;
};

const sliced = (text: string, { by, start, cuts, end }: Slices): SplitSignature => {
  const trimmedEnd = start + text.slice(start, end).trimEnd().length;
  return {
    by,
    opener: text.slice(0, start),
    members: [start, ...cuts]
      .map((from, index) => text.slice(from, cuts[index] ?? trimmedEnd))
      .filter(member => member !== ''),
    closer: text.slice(trimmedEnd),
  };
};

const unionSplit = (text: string, top: ReadonlyArray<Mark>): SplitSignature | undefined => {
  const equals = top.find(({ token }) => token === '=');
  if (equals === undefined) return undefined;
  const bars = top.filter(({ token, at }) => token === '|' && at > equals.at);
  const [first, ...rest] = bars;
  if (first === undefined) return undefined;
  const leading = text.slice(equals.at + 1, first.at).trim() === '';
  return sliced(text, {
    by: '|',
    start: (leading ? first.at : equals.at) + 1,
    cuts: (leading ? rest : bars).map(({ at }) => at + 1),
    end: text.endsWith(';') ? text.length - 1 : text.length,
  });
};

const bracketSplit = (
  text: string,
  marks: ReadonlyArray<Mark>,
  top: ReadonlyArray<Mark>,
): SplitSignature | undefined => {
  const open = top.find((mark): mark is Mark & { token: '(' | '{' } =>
    ['(', '{'].includes(mark.token),
  );
  const close = open && top[top.indexOf(open) + 1];
  if (open === undefined || close === undefined) return undefined;
  return sliced(text, {
    by: open.token,
    start: open.at + 1,
    cuts: marks
      .filter(
        ({ token, at, depth }) =>
          depth === 1 && at > open.at && at < close.at && ',;'.includes(token),
      )
      .map(({ at }) => at + 1),
    end: close.at,
  });
};

export const splitSignature = (text: string): SplitSignature | undefined => {
  const marks = marksOf(text);
  if (marks === undefined) return undefined;
  const top = marks.filter(({ depth }) => depth === 0);
  if (top.some(({ token, at }) => token === ';' && at < text.length - 1)) return undefined;
  return unionSplit(text, top) ?? bracketSplit(text, marks, top);
};

export type SignatureLine =
  | { readonly change: 'same' | 'added' | 'removed'; readonly text: string }
  | { readonly change: 'changed'; readonly base: string; readonly head: string };

type EdgeLine = Extract<SignatureLine, { readonly text: string }>;

export type SignatureDiff = {
  readonly opener: ReadonlyArray<EdgeLine>;
  readonly members: ReadonlyArray<SignatureLine>;
  readonly closer: ReadonlyArray<EdgeLine>;
};

const nameOf = (text: string): string | undefined => {
  const [heading = ''] = text.split(/[:?=(<]/, 1);
  return (
    heading
      .trimEnd()
      .split(/[^\w$]/)
      .at(-1) || undefined
  );
};

const comparable = (member: string): string =>
  member
    .trim()
    .replace(/[,;|]$/, '')
    .trimEnd();

const lineOf = (change: 'same' | 'added' | 'removed', text: string) =>
  text === '' ? [] : [{ change, text }];

const withoutLeadingBar = (opener: string): string => opener.replace(/\|$/, '');

const edge = (base: string, head: string): ReadonlyArray<EdgeLine> => {
  const [from, to] = [base.trim(), head.trim()];
  return from === to ? lineOf('same', to) : [...lineOf('removed', from), ...lineOf('added', to)];
};

type Member = {
  readonly text: string;
  readonly compared: string;
  readonly name: string | undefined;
};

const NOISE = new RegExp(
  `${STRINGS}|${BLOCK_COMMENT}\\s*|[,;](?=\\s*[)\\]}>])|\\s+(?=[)\\]}>])|(?<=[(\\[{<])\\s+`,
  'g',
);

const withoutNoise = (text: string): string =>
  text.replace(NOISE, found => ('\'"`'.includes(found.charAt(0)) ? found : ''));

const memberOf = (member: string): Member => {
  const text = comparable(member);
  const compared = withoutNoise(text);
  return { text, compared, name: nameOf(compared) };
};

type Pairing = {
  readonly next: number;
  readonly partners: ReadonlyArray<Member | undefined>;
};

const partnersOf = (base: ReadonlyArray<Member>, head: ReadonlyArray<Member>) =>
  head.reduce<Pairing>(
    ({ next, partners }, { name, text }) => {
      const found = base.findIndex((member, at) => at >= next && member.name === name);
      const partner = base[found];
      return name === undefined || partner === undefined || partner.text === text
        ? { next, partners: [...partners, undefined] }
        : { next: found + 1, partners: [...partners, partner] };
    },
    { next: 0, partners: [] },
  ).partners;

const linesOfGap = (
  base: ReadonlyArray<Member>,
  head: ReadonlyArray<Member>,
): ReadonlyArray<SignatureLine> => {
  const partners = partnersOf(base, head);
  return [
    ...base
      .filter(member => !partners.includes(member))
      .map(({ text }): SignatureLine => ({ change: 'removed', text })),
    ...head.map(({ text }, index): SignatureLine => {
      const partner = partners[index];
      return partner
        ? { change: 'changed', base: partner.text, head: text }
        : { change: 'added', text };
    }),
  ];
};

export const LONGEST_SIGNATURE = 10_000;

export const signatureDiff = ({
  base,
  head,
}: {
  readonly base: string;
  readonly head: string;
}): SignatureDiff | undefined => {
  if (base.length > LONGEST_SIGNATURE || head.length > LONGEST_SIGNATURE) return undefined;
  const [from, to] = [splitSignature(base), splitSignature(head)];
  if (from === undefined || to === undefined || from.by !== to.by) return undefined;
  const diff = {
    opener: edge(withoutLeadingBar(from.opener), withoutLeadingBar(to.opener)),
    members: aligned({
      base: from.members.map(memberOf),
      head: to.members.map(memberOf),
      same: (one, other) => one.compared === other.compared,
    }).flatMap(
      (run): ReadonlyArray<SignatureLine> =>
        'kept' in run ? [{ change: 'same', text: run.kept.text }] : linesOfGap(run.base, run.head),
    ),
    closer: edge(from.closer, to.closer),
  };
  const marked = [...diff.opener, ...diff.members, ...diff.closer].some(
    ({ change }) => change !== 'same',
  );
  return marked ? diff : undefined;
};

const memberCounts = (members: SignatureDiff['members']): ReadonlyArray<string> =>
  (['added', 'changed', 'removed'] as const)
    .map(change => ({ change, count: members.filter(line => line.change === change).length }))
    .filter(({ count }) => count > 0)
    .map(({ change, count }, index) => {
      if (index > 0) return `${count} ${change}`;
      return `${count} ${count === 1 ? 'member' : 'members'} ${change}`;
    });

const edgeMove = (lines: SignatureDiff['opener']): string =>
  lines
    .filter(({ change }) => change !== 'same')
    .map(({ text }) => text)
    .join(' → ');

export const signatureSummary = (signature: {
  readonly base: string;
  readonly head: string;
}): string => {
  const diff = signatureDiff(signature);
  if (diff === undefined) return `${signature.base} → ${signature.head}`;
  return [...memberCounts(diff.members), edgeMove(diff.opener), edgeMove(diff.closer)]
    .filter(part => part !== '')
    .join(', ');
};
