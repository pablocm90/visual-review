import type { PageData } from '../core/page.ts';

type RoutesScreenProps = {
  readonly review: Pick<PageData, 'routes'>;
};

export const RoutesScreen = ({ review }: RoutesScreenProps) => (
  <div className="schema-screen">
    {review.routes.flatMap(reading =>
      'notRead' in reading
        ? [
            <section key={reading.file} aria-label={reading.file}>
              <h2 className="schema-file">
                <code>{reading.file}</code>
              </h2>
              <p className="schema-line">Not read: {reading.notRead}</p>
            </section>,
          ]
        : [],
    )}
  </div>
);
