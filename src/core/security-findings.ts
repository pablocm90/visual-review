import { countedId } from './counted-id.ts';
import type { FilePatch } from './diff-graphs.ts';
import type { Finding } from './findings.ts';
import { lineIdOf, patchHunks } from './patch-lines.ts';
import type { SymbolFile } from './read-range.ts';
import type { Risk, RiskKind } from './reader.ts';
import { qualified } from './symbol-changes.ts';
import { anchoredSymbols } from './symbol-findings.ts';

const DOES: Readonly<Record<Exclude<RiskKind, 'permit'>, string>> = {
  'permit!': 'permits every parameter',
  'raw-sql': 'runs raw SQL',
  'html-safe': 'marks HTML safe',
  'dynamic-send': 'sends a name it does not write',
};

const FOUND = 'found by name';

const said = (risk: Risk): { readonly does: string; readonly detail: string } => {
  if (risk.kind === 'permit') return { does: `permits ${risk.text}`, detail: FOUND };
  const how = risk.detail === undefined ? FOUND : `${FOUND}, ${risk.detail}`;
  return { does: DOES[risk.kind], detail: `${risk.text} (${how})` };
};

export const riskFindings = (files: ReadonlyArray<SymbolFile>): ReadonlyArray<Finding> =>
  files.flatMap(file =>
    'unreadable' in file
      ? []
      : anchoredSymbols(file.node, file.symbols).flatMap(({ item: statement, id }) =>
          (statement.risks ?? []).map((risk, index, risks) => {
            const { does, detail } = said(risk);
            const before = risks.slice(0, index).filter(({ kind }) => kind === risk.kind).length;
            return {
              id: countedId(`security:${risk.kind}:${id}`, before),
              check: `security:${risk.kind}` as const,
              dimension: 'security' as const,
              level: 'look' as const,
              target: file.node,
              title: `${statement.kind} ${qualified(statement)} ${does}`,
              detail,
            };
          }),
        ),
  );

const VIEW = /\.(erb|haml|slim)$/;

const MARKS_SAFE = /html_safe(?!\?)|\braw\(|<%==/;

export const viewRiskFindings = (patches: ReadonlyArray<FilePatch>): ReadonlyArray<Finding> =>
  patches
    .filter(({ path }) => VIEW.test(path))
    .flatMap(({ path, patch }) =>
      patchHunks(patch)
        .flatMap(hunk => hunk.rows)
        .filter(row => row.kind === 'added' && MARKS_SAFE.test(row.code))
        .flatMap((row, index): ReadonlyArray<Finding> => {
          const line = lineIdOf(path, row);
          return line === undefined
            ? []
            : [
                {
                  id: countedId(`security:html-safe:${path}`, index),
                  check: 'security:html-safe',
                  dimension: 'security',
                  level: 'look',
                  file: path,
                  line,
                  title: `${path} marks HTML safe`,
                  detail: `${row.code.trim()} (heuristic, view not parsed)`,
                },
              ];
        }),
    );
