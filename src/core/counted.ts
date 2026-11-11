/** `1 file`, `2 files`: a count with the word that agrees with it. */
export const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
