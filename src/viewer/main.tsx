import { createRoot } from 'react-dom/client';
import { pageIn, pingServe, sendReview } from '../core/page.ts';
import { ReviewPage } from './review-page.tsx';
import './styles.css';

const {
  data: review,
  notes,
  token,
} = pageIn(id => document.getElementById(id)?.textContent ?? undefined);
const root = document.getElementById('root');

if (token !== undefined) {
  const ping = () => pingServe({ origin: location.origin, token }).catch(() => {});
  ping();
  setInterval(ping, 30_000);
}

if (root) {
  document.title = `Visual review ${review.range}`;
  createRoot(root).render(
    <ReviewPage
      review={review}
      notes={notes}
      send={
        token === undefined
          ? undefined
          : sent => sendReview({ origin: location.origin, token, review: sent })
      }
    />,
  );
}
