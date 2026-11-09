import { anchorOfKey, anchorTarget, type TargetsOf } from '../core/anchors.ts';
import type { Finding } from '../core/findings.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { SymbolFile } from '../core/read-range.ts';
import type { Comment } from '../core/review.ts';
import type { SinceReview } from '../core/since-review.ts';
import { anchoredSymbols, decisionsOf } from '../core/symbol-findings.ts';
import { anchorName, type PlaceOfLine, placeOfLine } from './anchors.ts';
import { Said, saidLabel } from './said-before.tsx';

const QUIET_TITLE = 'Changed since, no comment';
const UNASKED_TITLE = 'Claude also changed';

type Going = {
  readonly nodes: TargetsOf['nodes'];
  readonly findings: ReadonlyArray<Finding>;
  readonly onGoTo: (id: string) => void;
  readonly onGoToDraft: (id: string, anchor: PreviousComment['anchor']) => void;
  readonly onGoToOutside: (place: PlaceOfLine, opener: HTMLButtonElement) => void;
};

export const whereOf = (
  { anchor, target }: PreviousComment,
  { nodes, findings, onGoToDraft, onGoToOutside }: Omit<Going, 'onGoTo'>,
) => {
  if (anchor.kind === 'finding')
    return {
      name: findings.find(({ id }) => id === anchor.id)?.title ?? anchor.id,
      onGo: target === undefined ? undefined : () => onGoToDraft(target, anchor),
    };
  const place = placeOfLine(anchor);
  const goOutside = place && ((opener: HTMLButtonElement) => onGoToOutside(place, opener));
  const onTheGraph = anchor.kind === 'part' || anchor.kind === 'edge';
  return {
    name: anchorName(
      onTheGraph && target !== undefined ? { ...anchor, id: target } : anchor,
      nodes,
    ),
    onGo: target === undefined ? goOutside : () => onGoToDraft(target, anchor),
  };
};

type UnaskedChangesProps = Pick<Going, 'nodes' | 'onGoTo'> & {
  readonly changes: ReadonlyArray<readonly [string, { readonly text: string }]>;
  readonly tests: TargetsOf['tests'];
  readonly symbols: ReadonlyArray<SymbolFile>;
};

const decisionText = (symbols: ReadonlyArray<SymbolFile>, id: string): string =>
  symbols
    .flatMap(file => ('symbols' in file ? anchoredSymbols(file.node, file.symbols) : []))
    .flatMap(decisionsOf)
    .find(decision => decision.id === id)?.text ?? id;

const anchorOfUnasked = (key: string, symbols: ReadonlyArray<SymbolFile>): Comment['anchor'] => {
  const { kind, id } = anchorOfKey(key);
  if (kind === 'decision') return { kind, id, text: decisionText(symbols, id) };
  if (kind === 'symbol' || kind === 'test' || kind === 'edge') return { kind, id };
  return { kind: 'part', id };
};

const UnaskedChanges = ({ changes, nodes, tests, symbols, onGoTo }: UnaskedChangesProps) => {
  if (changes.length === 0) return null;
  return (
    <>
      <h3 className="last-review-subtitle">{UNASKED_TITLE}</h3>
      <ul aria-label={UNASKED_TITLE} className="last-review-list">
        {changes.map(([key, { text }]) => {
          const anchor = anchorOfUnasked(key, symbols);
          const name = anchorName(anchor, nodes);
          const target = anchorTarget(anchor, { nodes, tests });
          return (
            <li key={key} className="last-comment" aria-label={`${name}: ${text}`}>
              {target === undefined ? (
                name
              ) : (
                <button type="button" className="draft-target" onClick={() => onGoTo(target)}>
                  {name}
                </button>
              )}
              <p className="last-said">{text}</p>
            </li>
          );
        })}
      </ul>
    </>
  );
};

type LastReviewProps = Going &
  Pick<UnaskedChangesProps, 'tests' | 'symbols'> & {
    readonly since: SinceReview;
    readonly unasked: ReviewNotes['unasked'];
  };

export const LastReview = ({ since, unasked, tests, symbols, ...going }: LastReviewProps) => {
  const quiet = 'changedWithoutComment' in since ? since.changedWithoutComment : [];
  const unaskedChanges = Object.entries(unasked ?? {});
  if (
    since.body === undefined &&
    since.comments.length === 0 &&
    quiet.length === 0 &&
    unaskedChanges.length === 0
  )
    return null;
  const compared = 'changed' in since;
  return (
    <section className="last-review" aria-label="Last review">
      <details open>
        <summary className="last-review-title">Last review</summary>
        {since.body !== undefined && <p className="last-review-body">{since.body}</p>}
        <ul className="last-review-list">
          {since.comments.map(comment => {
            const { anchor } = comment;
            const { name, onGo } = whereOf(comment, going);
            return (
              <li
                key={`${anchor.kind} ${anchor.id}`}
                className="last-comment"
                aria-label={`${name}: ${saidLabel({ comment, compared })}`}
              >
                {onGo === undefined ? (
                  name
                ) : (
                  <button
                    type="button"
                    className="draft-target"
                    onClick={event => onGo(event.currentTarget)}
                  >
                    {name}
                  </button>
                )}{' '}
                <Said comment={comment} compared={compared} />
              </li>
            );
          })}
        </ul>
        {quiet.length > 0 && (
          <>
            <h3 className="last-review-subtitle">{QUIET_TITLE}</h3>
            <ul aria-label={QUIET_TITLE} className="last-review-list">
              {quiet.map(id => (
                <li key={id} className="last-comment">
                  <button type="button" className="draft-target" onClick={() => going.onGoTo(id)}>
                    {anchorName({ kind: 'part', id }, going.nodes)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <UnaskedChanges
          changes={unaskedChanges}
          nodes={going.nodes}
          tests={tests}
          symbols={symbols}
          onGoTo={going.onGoTo}
        />
      </details>
    </section>
  );
};
