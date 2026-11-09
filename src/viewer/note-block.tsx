import type { Note } from '../core/notes.ts';

type NoteBlockProps = {
  readonly note: Pick<Note, 'text' | 'why' | 'recommendation'>;
  readonly onTake: ((recommendation: string) => void) | undefined;
};

export const NoteBlock = ({ note: { text, why, recommendation }, onTake }: NoteBlockProps) => (
  <section aria-label="Note">
    <p>{text}</p>
    {why !== undefined && (
      <p className="note-why">
        <strong>Why</strong> {why}
      </p>
    )}
    {recommendation !== undefined && (
      <div className="note-recommendation">
        <p>
          <strong>Recommendation</strong> {recommendation}
        </p>
        {onTake && (
          <button type="button" className="take" onClick={() => onTake(recommendation)}>
            Take
          </button>
        )}
      </div>
    )}
  </section>
);
