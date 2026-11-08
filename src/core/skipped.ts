import type { ReaderName } from './config.ts';

export type Skipped = {
  readonly reader: ReaderName;
  readonly stacks: ReadonlyArray<string>;
  readonly reason: string;
};

export const notReadLine = ({ reason, stacks }: Skipped): string =>
  `${stacks.join(', ')} not read: ${reason}`;

export class StackNotRead extends Error {}
