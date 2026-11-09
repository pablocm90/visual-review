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

const nodesUnder = (graph: Graph, globs: ReadonlyArray<string>): ReadonlySet<string> => {
  const parents = new Map(graph.nodes.map(node => [node.id, node.parent]));
  const found = new Map<string, boolean>();
  const under = (id: string | undefined): boolean => {
    if (id === undefined) return false;
    const known = found.get(id);
    if (known !== undefined) return known;
    const matched = globs.some(glob => matchesGlob(id, glob)) || under(parents.get(id));
    found.set(id, matched);
    return matched;
  };
  return new Set(graph.nodes.map(({ id }) => id).filter(under));
};

export const ruleBreaks = ({ rules, graph }: RuleBreaksOptions): ReadonlyArray<RuleBreak> =>
  Object.entries(rules).flatMap(([rule, { from, notTo, reason }]) => {
    const starts = nodesUnder(graph, from);
    const forbidden = nodesUnder(graph, notTo);
    return graph.edges
      .filter(edge => starts.has(edge.from) && forbidden.has(edge.to) && !forbidden.has(edge.from))
      .map(edge => ({ rule, reason, edge }));
  });

export const rulesNotRead = ({ rules, graph }: RuleBreaksOptions): ReadonlyArray<string> => {
  if (Object.keys(rules).length === 0) return ['none configured'];
  const matchesNone = (glob: string) => !graph.nodes.some(({ id }) => matchesGlob(id, glob));
  return Object.entries(rules).flatMap(([name, globs]) =>
    (['from', 'notTo'] as const).flatMap(side =>
      globs[side].filter(matchesNone).map(glob => `${name}: ${side} ${glob} matches no node`),
    ),
  );
};
