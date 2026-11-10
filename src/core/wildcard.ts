const literally = (text: string): string => text.replace(/[\\^$.+?()[\]{}|]/g, '\\$&');

export const matchesWildcard = (pattern: string, name: string): boolean =>
  new RegExp(`^${pattern.split('*').map(literally).join('.*')}$`).test(name);
