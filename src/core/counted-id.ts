export const countedId = (id: string, before: number): string =>
  before === 0 ? id : `${id}#${before + 1}`;
