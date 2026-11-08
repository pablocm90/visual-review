import type { ReaderName } from './config.ts';

export type Skipped = {
  readonly reader: ReaderName;
  readonly stacks: ReadonlyArray<string>;
  readonly reason: string;
  readonly side?: 'base' | 'head';
};

export const notReadLine = ({ reason, stacks, side }: Skipped): string =>
  `${stacks.join(', ')} not read${side === undefined ? '' : ` at the ${side}`}: ${reason}`;

export class StackNotRead extends Error {}
