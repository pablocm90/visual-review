const MOST_CHARACTERS = 262_144;

const LONGEST_LINE = 1000;

const grouped = (count: number): string => count.toLocaleString('en');

export const TOO_BIG = `too big to read: over ${grouped(MOST_CHARACTERS)} characters or a line over ${grouped(LONGEST_LINE)}`;

export const isTooBig = (text: string): boolean =>
  text.length > MOST_CHARACTERS || text.split('\n').some(line => line.length > LONGEST_LINE);
