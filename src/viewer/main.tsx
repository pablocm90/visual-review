import { createRoot } from 'react-dom/client';
import { pageIn } from '../core/page.ts';
import { ReviewPage } from './review-page.tsx';
import './styles.css';

const { data: review, notes } = pageIn(id => document.getElementById(id)?.textContent ?? undefined);
const root = document.getElementById('root');

if (root) {
  document.title = `Visual review ${review.range}`;
  createRoot(root).render(<ReviewPage review={review} notes={notes} />);
}
