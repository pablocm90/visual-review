import { createRoot } from 'react-dom/client';
import type { ReviewNotes } from '../notes.ts';
import type { ReviewData } from './review-data.ts';
import { ReviewPage } from './review-page.tsx';
import './styles.css';

const data: ReviewData = JSON.parse(document.getElementById('review-data')?.textContent ?? '{}');
const notes: ReviewNotes | null = JSON.parse(
  document.getElementById('review-notes')?.textContent ?? 'null',
);
const review: ReviewData = notes ? { ...data, notes } : data;
const root = document.getElementById('root');

if (root) {
  document.title = `Visual review ${review.range}`;
  createRoot(root).render(<ReviewPage review={review} />);
}
