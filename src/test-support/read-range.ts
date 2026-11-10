import {
  access,
  linkers,
  lockfiles,
  migrations,
  readers,
  routes,
  schemas,
  tenancy,
} from '../adapters.ts';
import {
  type RangeReading,
  type ReviewedHead,
  readRange as readRangeWith,
} from '../core/read-range.ts';
import type { Reader } from '../core/reader.ts';
import { onPath } from '../git/on-path.ts';

type RangeOptions = {
  readonly repo: string;
  readonly from: string;
  readonly to: string;
  readonly onPath?: (command: string) => boolean;
  readonly reviewed?: ReviewedHead;
  readonly readers?: ReadonlyArray<Reader>;
};

export const readRange = (range: RangeOptions): Promise<RangeReading> =>
  readRangeWith({
    access,
    tenancy,
    readers,
    linkers,
    lockfiles,
    migrations,
    schemas,
    routes,
    onPath,
    ...range,
  });
