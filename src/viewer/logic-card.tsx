import type { DiffedNode } from '../core/diff-graphs.ts';
import { countsOf } from '../core/logic-strip.ts';
import type { SymbolFile } from '../core/read-range.ts';
import { qualified } from '../core/symbol-changes.ts';
import { anchoredSymbols, decisionsOf } from '../core/symbol-findings.ts';
import type { StripRow } from './logic-strip.tsx';
import { logicLabel } from './what-changed.tsx';

type CardRow = {
  readonly id: string;
  readonly name: string;
  readonly decisions: ReadonlyArray<StripRow>;
};

export type LogicCard = { readonly rows: ReadonlyArray<CardRow> };

export const logicCardsOf = ({
  files,
  nodes,
}: {
  readonly files: ReadonlyArray<SymbolFile>;
  readonly nodes: ReadonlyArray<DiffedNode>;
}): ReadonlyMap<string, LogicCard> =>
  new Map(
    files.flatMap(file => {
      if (!('symbols' in file)) return [];
      const rows = anchoredSymbols(file.node, file.symbols).flatMap(symbol => {
        const decisions = decisionsOf(symbol).map(({ id, line }) => ({
          id,
          line,
          label: logicLabel(line, nodes),
        }));
        return countsOf(decisions.map(({ line }) => line)).changed === 0
          ? []
          : [{ id: symbol.id, name: `${symbol.item.kind} ${qualified(symbol.item)}`, decisions }];
      });
      return [[file.node, { rows }] as const];
    }),
  );

export const LogicCardRows = ({ card }: { readonly card: LogicCard }) =>
  card.rows.map(({ id, name, decisions }) => (
    <g key={id} role="group" aria-label={`Marks of ${name}`}>
      {decisions.map(decision => (
        <g key={decision.id} role="button" tabIndex={-1} aria-label={decision.label}>
          <title>{decision.label}</title>
        </g>
      ))}
    </g>
  ));
