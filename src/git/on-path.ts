import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

const runs = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

export const onPath = (command: string): boolean => {
  const path = process.env['PATH'];
  return (
    path === undefined ||
    path.split(delimiter).some(directory => isAbsolute(directory) && runs(join(directory, command)))
  );
};
