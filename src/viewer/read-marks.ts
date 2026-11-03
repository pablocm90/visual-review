import { z } from 'zod';

const ReadMarks = z.array(z.string());

const keyOf = (range: string) => `visual-review:read:${range}`;

export const storedReadMarks = (range: string): ReadonlySet<string> => {
  try {
    return new Set(ReadMarks.parse(JSON.parse(localStorage.getItem(keyOf(range)) ?? '[]')));
  } catch {
    return new Set();
  }
};

export const storeReadMarks = (range: string, marks: ReadonlySet<string>) => {
  try {
    localStorage.setItem(keyOf(range), JSON.stringify([...marks]));
  } catch {}
};
