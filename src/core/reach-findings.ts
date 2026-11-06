import { counted, type Finding } from './findings.ts';
import type { Reach } from './read-reaches.ts';

export const reachFindings = (reaches: ReadonlyArray<Reach>): ReadonlyArray<Finding> =>
  reaches.map(({ node, id, label, how, uses }) => ({
    id: `blast-radius:reaches:${id}`,
    check: 'blast-radius:reaches',
    dimension: 'blast-radius',
    level: 'look',
    target: node,
    title: `${label} reaches ${counted(uses.length, 'unchanged file', 'unchanged files')}`,
    detail: `${how}, found by name`,
  }));
