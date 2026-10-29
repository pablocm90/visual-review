import { createRoot } from 'react-dom/client';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import { ReviewPage } from './review-page.tsx';
import './styles.css';

const review: PageData = JSON.parse(document.getElementById('review-data')?.textContent ?? '{}');
const notes: ReviewNotes | null = JSON.parse(
  document.getElementById('review-notes')?.textContent ?? 'null',
);
const root = document.getElementById('root');

if (root) {
  document.title = `Visual review ${review.range}`;
  createRoot(root).render(<ReviewPage review={review} notes={notes ?? undefined} />);
}
