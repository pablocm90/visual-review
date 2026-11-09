import { createContext } from 'react';
import type { Note } from '../core/notes.ts';

export const SymbolNotes = createContext<Readonly<Record<string, Note>>>({});

type NoteBlockProps = {
  readonly note: Pick<Note, 'text' | 'why' | 'recommendation'>;
  readonly onTake: ((recommendation: string) => void) | undefined;
  readonly label?: string;
};

export const NoteBlock = ({
  note: { text, why, recommendation },
  onTake,
  label = 'Note',
}: NoteBlockProps) => (
  <section aria-label={label}>
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
