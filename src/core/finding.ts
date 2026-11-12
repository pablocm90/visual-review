import type { Check } from './checks.ts';
import type { GraphNode } from './graph.ts';
import type { SplitSuggestion } from './split-suggestion.ts';

/** What a finding is, apart from how the page's findings are raised, so a check can use it alone. */
export const DIMENSIONS = [
  'structure',
  'logic',
  'api',
  'tests',
  'metrics',
  'dependencies',
  'rules',
  'schema',
  'routes',
  'blast-radius',
  'security',
  'tenancy',
  'deploy',
  'performance',
  'failure',
  'ownership',
  'cohesion',
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export type Finding = {
  readonly id: string;
  readonly check: Check | 'flag';
  readonly dimension: Dimension;
  readonly level: 'look' | 'info';
  readonly target?: string;
  readonly file?: string;
  readonly table?: string;
  readonly route?: string;
  readonly line?: string;
  readonly title: string;
  readonly detail?: string;
  readonly groups?: SplitSuggestion['groups'];
};

export type PlaceInFile = Pick<Finding, 'table' | 'route' | 'line'>;

/** Where a finding about a file sits: on the node holding it, so the page opens it, else on the file. */
export const placeOfFile = (
  nodes: ReadonlyArray<GraphNode>,
  file: string,
): { readonly target: string } | { readonly file: string } => {
  const node = nodes.find(({ path }) => path === file);
  return node === undefined ? { file } : { target: node.id };
};
