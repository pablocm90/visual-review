import type { GraphDiff } from './diff-graphs.ts';
import type { Finding } from './findings.ts';
import { edgeId } from './graph.ts';
import type { RuleBreak } from './rule-breaks.ts';

type RuleFindingsOptions = {
  readonly ruleBreaks: ReadonlyArray<RuleBreak>;
  readonly edges: GraphDiff['edges'];
};

export const ruleFindings = ({
  ruleBreaks,
  edges,
}: RuleFindingsOptions): ReadonlyArray<Finding> => {
  const added = new Set(edges.filter(({ state }) => state === 'added').map(edgeId));
  return ruleBreaks.map(({ rule, reason, edge }) => ({
    id: `rules:broken:${rule}:${edgeId(edge)}`,
    check: 'rules:broken',
    dimension: 'rules',
    level: added.has(edgeId(edge)) ? 'look' : 'info',
    target: edgeId(edge),
    title: `breaks ${rule}`,
    detail: edge.via === undefined ? reason : `${reason} (via ${edge.via.join(', ')})`,
  }));
};
