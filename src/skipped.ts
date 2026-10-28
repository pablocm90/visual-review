import type { ReaderName } from './config.ts';

export type Skipped = {
  readonly reader: ReaderName;
  readonly tool: string;
  readonly stacks: ReadonlyArray<string>;
};

export const notReadLine = ({ tool, stacks }: Skipped): string =>
  `${stacks.join(', ')} not read: ${tool} not found on PATH`;
