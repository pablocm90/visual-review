import { counted, type Finding } from './findings.ts';
import type { Reach } from './read-reaches.ts';

export const reachFindingId = ({ id }: Pick<Reach, 'id'>): string => `blast-radius:reaches:${id}`;

export const isReachFinding = ({ check }: Finding): boolean => check === 'blast-radius:reaches';

export const reachFindings = (reaches: ReadonlyArray<Reach>): ReadonlyArray<Finding> =>
  reaches.map(reach => ({
    id: reachFindingId(reach),
    check: 'blast-radius:reaches',
    dimension: 'blast-radius',
    level: 'look',
    target: reach.node,
    title: `${reach.label} reaches ${counted(reach.uses.length, 'unchanged file', 'unchanged files')}`,
    detail: `${reach.how}, found by name`,
  }));
