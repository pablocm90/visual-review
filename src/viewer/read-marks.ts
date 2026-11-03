import { z } from 'zod';

const ReadMarks = z.array(z.string());

const keyOf = (range: string) => `visual-review:read:${range}`;

export const storedReadMarks = (range: string): ReadonlySet<string> =>
  new Set(ReadMarks.parse(JSON.parse(localStorage.getItem(keyOf(range)) ?? '[]')));

export const storeReadMarks = (range: string, marks: ReadonlySet<string>) =>
  localStorage.setItem(keyOf(range), JSON.stringify([...marks]));
