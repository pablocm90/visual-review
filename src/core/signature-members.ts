import { aligned } from './aligned.ts';

export type SplitSignature = {
  readonly by: '(' | '{' | '|';
  readonly opener: string;
  readonly members: ReadonlyArray<string>;
  readonly closer: string;
};

type Mark = { readonly token: string; readonly at: number; readonly depth: number };

type Scan = { readonly open: string; readonly marks: ReadonlyArray<Mark> };

const STRUCTURE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|=>|[()[\]{}<>,;=|'"`]/g;

const OPENER_OF: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

const scanned = (scan: Scan, open: string, mark: Mark): Scan => ({
  open,
  marks: [...scan.marks, mark],
});

const step = (scan: Scan, token: string, at: number): Scan | undefined => {
  const depth = scan.open.length;
  if ('\'"`'.includes(token)) return undefined;
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

export const splitSignature = (text: string): SplitSignature | undefined => {
  const marks = marksOf(text);
  if (marks === undefined) return undefined;
  const top = marks.filter(({ depth }) => depth === 0);
  if (top.some(({ token, at }) => token === ';' && at < text.length - 1)) return undefined;
  const union = unionSplit(text, top);
  if (union !== undefined) return union;
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

export type SignatureLine =
  | { readonly change: 'same' | 'added' | 'removed'; readonly text: string }
  | { readonly change: 'changed'; readonly base: string; readonly head: string };

export type SignatureDiff = {
  readonly opener: ReadonlyArray<SignatureLine>;
  readonly members: ReadonlyArray<SignatureLine>;
  readonly closer: ReadonlyArray<SignatureLine>;
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

const edge = (base: string, head: string): ReadonlyArray<SignatureLine> => {
  const [from, to] = [base.trim(), head.trim()];
  return from === to
    ? [{ change: 'same', text: to }]
    : [
        { change: 'removed', text: from },
        { change: 'added', text: to },
      ];
};

type Member = { readonly text: string; readonly name: string | undefined };

const memberOf = (member: string): Member => {
  const text = comparable(member);
  return { text, name: nameOf(text) };
};

const partnersOf = (base: ReadonlyArray<Member>, head: ReadonlyArray<Member>) =>
  head.map(({ text, name }, index) => {
    const before = head.slice(0, index).filter(member => member.name === name).length;
    const partner = base.filter(member => member.name === name)[before];
    return name === undefined || partner?.text === text ? undefined : partner;
  });

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
    opener: edge(from.opener, to.opener),
    members: aligned({
      base: from.members.map(memberOf),
      head: to.members.map(memberOf),
      same: (one, other) => one.text === other.text,
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
