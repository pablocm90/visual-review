import type { DiffedNode } from './diff-graphs.ts';
import { type Hotspot, hotspotOf } from './metric-findings.ts';
import { measuredLeaves } from './metric-rows.ts';
import type { PageData } from './page.ts';

export type HotspotMove = {
  readonly node: DiffedNode;
  readonly base?: Hotspot;
  readonly head: Hotspot;
};

export const hotspotMoves = ({
  diff,
  metrics,
}: Pick<PageData, 'diff' | 'metrics'>): ReadonlyArray<HotspotMove> =>
  measuredLeaves({ diff, metrics })
    .filter(({ node }) => node.state !== 'unchanged')
    .flatMap(({ node, base, head }) => {
      const to = hotspotOf(head);
      const from = hotspotOf(base);
      if (to === undefined) return [];
      return [{ node, head: to, ...(from && { base: from }) }];
    });
