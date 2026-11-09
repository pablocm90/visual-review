import { matchesGlob } from 'node:path';
import type { Rules } from './config.ts';
import type { Graph, GraphEdge } from './graph.ts';

export type RuleBreak = {
  readonly rule: string;
  readonly reason: string;
  readonly edge: GraphEdge;
};

type RuleBreaksOptions = {
  readonly rules: Rules;
  readonly graph: Graph;
};

export const ruleBreaks = ({ rules, graph }: RuleBreaksOptions): ReadonlyArray<RuleBreak> => {
  const parents = new Map(graph.nodes.map(node => [node.id, node.parent]));
  const lineOf = (id: string | undefined): ReadonlyArray<string> =>
    id === undefined ? [] : [id, ...lineOf(parents.get(id))];
  const matches = (id: string, globs: ReadonlyArray<string>) =>
    lineOf(id).some(each => globs.some(glob => matchesGlob(each, glob)));
  return Object.entries(rules).flatMap(([rule, { from, notTo, reason }]) =>
    graph.edges
      .filter(
        edge => matches(edge.from, from) && matches(edge.to, notTo) && !matches(edge.from, notTo),
      )
      .map(edge => ({ rule, reason, edge })),
  );
};

export const rulesNotRead = ({ rules, graph }: RuleBreaksOptions): ReadonlyArray<string> => {
  if (Object.keys(rules).length === 0) return ['none configured'];
  const matchesNone = (glob: string) => !graph.nodes.some(({ id }) => matchesGlob(id, glob));
  return Object.entries(rules).flatMap(([name, globs]) =>
    (['from', 'notTo'] as const).flatMap(side =>
      globs[side].filter(matchesNone).map(glob => `${name}: ${side} ${glob} matches no node`),
    ),
  );
};
