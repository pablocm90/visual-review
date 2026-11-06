import type { DiffedNode } from '../core/diff-graphs.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { Comment } from '../core/review.ts';
import { anchorName, lineAnchor, rowOfLine } from './anchors.ts';
import type { Comments } from './comment-field.tsx';
import type { PatchLine as Line, Piece } from './highlight-patch.ts';
import { CommentOn, SaidBefore, useSaidLinesOf } from './said-before.tsx';

const Scoped = ({ scopes: [scope, ...inner], text }: Piece) =>
  scope === undefined ? (
    text
  ) : (
    <span className={scope}>
      <Scoped scopes={inner} text={text} />
    </span>
  );

export type LineLanding = {
  readonly side: 'base' | 'head';
  readonly line: number;
  readonly text?: string;
};

export const rowLandedOn = ({
  lines,
  path,
  landing: { side, line, text },
}: {
  readonly lines: ReadonlyArray<Line>;
  readonly path: string;
  readonly landing: Partial<LineLanding>;
}) => {
  if (side === undefined || line === undefined) return undefined;
  return text === undefined
    ? lines.findIndex(row => row[side] === line)
    : rowOfLine(lines, { path, side, line, text });
};

export type LineComments = {
  readonly nodes: ReadonlyArray<DiffedNode>;
  readonly comments: Comments;
  readonly onComment: ((comment: Comment) => void) | undefined;
};

const PatchLine = ({
  path,
  line,
  said,
  landing,
  nodes,
  comments,
  onComment,
}: LineComments & {
  readonly path: string;
  readonly line: Line;
  readonly said: ReadonlyArray<PreviousComment['anchor']>;
  readonly landing: Partial<LineLanding> | undefined;
}) => {
  const { kind, prefix, pieces } = line;
  const anchor = lineAnchor({ path, line });
  const marks = { 'aria-current': landing !== undefined || undefined };
  const code = (
    <>
      {prefix}
      {pieces.map((piece, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a line's pieces are fixed and may repeat
        <Scoped key={index} {...piece} />
      ))}
      {said.map(on => (
        <SaidBefore key={on.id} on={on} landing={landing} />
      ))}
      {onComment && anchor && (
        <CommentOn
          anchor={anchor}
          name={anchorName(anchor, nodes)}
          comments={comments}
          onComment={onComment}
          landing={landing}
        />
      )}
    </>
  );
  if (kind === 'added') return <ins {...marks}>{code}</ins>;
  if (kind === 'removed') return <del {...marks}>{code}</del>;
  return <span {...marks}>{code}</span>;
};

type SaidAt = (row: Line | undefined) => ReadonlyArray<PreviousComment['anchor']>;

export const useSaidAt = (path: string, lines: ReadonlyArray<Line>): SaidAt => {
  const placed = useSaidLinesOf(path).map(({ anchor, place }) => {
    const row = rowOfLine(lines, place);
    return { anchor, row: row === undefined ? undefined : lines[row] };
  });
  return row => placed.filter(said => said.row === row).map(({ anchor }) => anchor);
};

export const PatchRows = ({
  path,
  lines,
  saidAt,
  landedRow,
  landed,
  ...commenting
}: LineComments & {
  readonly path: string;
  readonly lines: ReadonlyArray<Line>;
  readonly saidAt: SaidAt;
  readonly landedRow: number | undefined;
  readonly landed: Partial<LineLanding> | undefined;
}) => (
  <pre>
    {lines.map((line, index) => (
      <PatchLine
        // biome-ignore lint/suspicious/noArrayIndexKey: a patch's lines are fixed and may repeat
        key={index}
        path={path}
        line={line}
        said={saidAt(line)}
        landing={index === landedRow ? landed : undefined}
        {...commenting}
      />
    ))}
  </pre>
);
