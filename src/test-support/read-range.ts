import { linkers, lockfiles, readers } from '../adapters.ts';
import {
  type RangeReading,
  type ReviewedHead,
  readRange as readRangeWith,
} from '../core/read-range.ts';
import { onPath } from '../git/on-path.ts';

type RangeOptions = {
  readonly repo: string;
  readonly from: string;
  readonly to: string;
  readonly onPath?: (command: string) => boolean;
  readonly reviewed?: ReviewedHead;
};

export const readRange = (range: RangeOptions): Promise<RangeReading> =>
  readRangeWith({ readers, linkers, lockfiles, onPath, ...range });
