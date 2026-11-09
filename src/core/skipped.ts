import type { ReaderName } from './config.ts';

export type Skipped = {
  readonly reader: ReaderName;
  readonly stacks: ReadonlyArray<string>;
  readonly reason: string;
  readonly side?: 'base' | 'head' | 'reviewed';
};

const AT_SIDE = { base: ' at the base', head: ' at the head', reviewed: ' at the last review' };

export const notReadLine = ({ reason, stacks, side }: Skipped): string =>
  `${stacks.join(', ')} not read${side === undefined ? '' : AT_SIDE[side]}: ${reason}`;

export class StackNotRead extends Error {}
