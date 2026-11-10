import type { Finding } from './findings.ts';
import type { SymbolFile } from './read-range.ts';
import { qualified } from './symbol-changes.ts';
import { anchoredSymbols } from './symbol-findings.ts';

export const riskFindings = (files: ReadonlyArray<SymbolFile>): ReadonlyArray<Finding> =>
  files.flatMap(file =>
    'unreadable' in file
      ? []
      : anchoredSymbols(file.node, file.symbols).flatMap(({ item: statement, id }) =>
          (statement.risks ?? []).map(risk => ({
            id: `security:${risk.kind}:${id}`,
            check: 'security:permit' as const,
            dimension: 'security' as const,
            level: 'look' as const,
            target: file.node,
            title: `${statement.kind} ${qualified(statement)} permits ${risk.text}`,
            detail: 'found by name',
          })),
        ),
  );
