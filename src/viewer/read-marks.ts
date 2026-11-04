import { z } from 'zod';

const ReadMarks = z.array(z.string());

const keyOf = (range: string) => `visual-review:read:${range}`;

export const storedReadMarks = (
  range: string,
  initial: ReadonlyArray<string>,
): ReadonlySet<string> => {
  try {
    const stored = localStorage.getItem(keyOf(range));
    return new Set(stored === null ? initial : ReadMarks.parse(JSON.parse(stored)));
  } catch {
    return new Set(initial);
  }
};

export const storeReadMarks = (range: string, marks: ReadonlySet<string>) => {
  try {
    localStorage.setItem(keyOf(range), JSON.stringify([...marks]));
  } catch {}
};
