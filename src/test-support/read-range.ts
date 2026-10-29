import { linkers, readers } from '../adapters.ts';
import { type RangeReading, readRange as readRangeWith } from '../core/read-range.ts';
import { onPath } from '../git/on-path.ts';

type RangeOptions = {
  readonly repo: string;
  readonly from: string;
  readonly to: string;
  readonly onPath?: (command: string) => boolean;
};

export const readRange = (range: RangeOptions): Promise<RangeReading> =>
  readRangeWith({ readers, linkers, onPath, ...range });
