export type SplitSignature = {
  readonly opener: string;
  readonly members: ReadonlyArray<string>;
  readonly closer: string;
};

type Mark = { readonly token: string; readonly at: number; readonly depth: number };

type Scan = { readonly open: string; readonly marks: ReadonlyArray<Mark> };

const STRUCTURE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|=>|[()[\]{}<>,;'"`]/g;

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

export const splitSignature = (text: string): SplitSignature | undefined => {
  const marks = marksOf(text);
  if (marks === undefined) return undefined;
  const top = marks.filter(({ depth }) => depth === 0);
  const open = top.find(({ token }) => token === '(' || token === '{');
  const close = open && top[top.indexOf(open) + 1];
  if (open === undefined || close === undefined) return undefined;
  const start = open.at + 1;
  const end = start + text.slice(start, close.at).trimEnd().length;
  const cuts = marks
    .filter(
      ({ token, at, depth }) =>
        depth === 1 && at > open.at && at < close.at && ',;'.includes(token),
    )
    .map(({ at }) => at + 1);
  return {
    opener: text.slice(0, start),
    members: [start, ...cuts]
      .map((from, index) => text.slice(from, cuts[index] ?? end))
      .filter(member => member !== ''),
    closer: text.slice(end),
  };
};
