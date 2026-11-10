export const countedId = (id: string, before: number): string =>
  before === 0 ? id : `${id}#${before + 1}`;

export const countingRepeats = <T>(
  items: ReadonlyArray<T>,
  idOf: (item: T) => string,
): ReadonlyArray<{ readonly item: T; readonly id: string }> =>
  items.map((item, index) => {
    const id = idOf(item);
    const before = items.slice(0, index).filter(other => idOf(other) === id).length;
    return { item, id: countedId(id, before) };
  });
