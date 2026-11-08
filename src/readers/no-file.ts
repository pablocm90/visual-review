const NO_FILE: ReadonlyArray<unknown> = ['ENOENT', 'ENOTDIR', 'EISDIR'];

export const isNoFile = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && NO_FILE.includes(error.code);
