import type { DiffedNode } from './diff-graphs.ts';
import { type Hotspot, hotspotOf, inHotspot } from './metric-findings.ts';
import { measuredLeaves } from './metric-rows.ts';
import type { PageData } from './page.ts';

export type HotspotMove = {
  readonly node: DiffedNode;
  readonly base?: Hotspot;
  readonly head: Hotspot;
  readonly corner?: 'enters' | 'stays';
};

const cornerOf = (
  from: Hotspot | undefined,
  to: Hotspot,
  cut: Hotspot,
): Pick<HotspotMove, 'corner'> => {
  if (!inHotspot(to, cut)) return {};
  return { corner: inHotspot(from, cut) ? 'stays' : 'enters' };
};

export const hotspotMoves = ({
  diff,
  metrics,
  thresholds,
}: Pick<PageData, 'diff' | 'metrics' | 'thresholds'>): ReadonlyArray<HotspotMove> =>
  measuredLeaves({ diff, metrics })
    .filter(({ node }) => node.state !== 'unchanged')
    .flatMap(({ node, base, head }) => {
      const to = hotspotOf(head);
      const from = hotspotOf(base);
      if (to === undefined) return [];
      return [
        { node, head: to, ...(from && { base: from }), ...cornerOf(from, to, thresholds.hotspot) },
      ];
    });
