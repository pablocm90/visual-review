import { counted } from '../core/findings.ts';
import type { PageData } from '../core/page.ts';
import type { SchemaReading } from '../core/read-schemas.ts';

const WholeFile = ({ reading }: { readonly reading: SchemaReading }) => {
  if ('notRead' in reading) return <p className="schema-line">Not read: {reading.notRead}</p>;
  if ('whole' in reading)
    return (
      <p className="schema-line">
        File {reading.whole}, with {counted(reading.tableCount, 'table', 'tables')}.
      </p>
    );
  return null;
};

export const SchemaScreen = ({ review }: { readonly review: Pick<PageData, 'schemas'> }) => (
  <div className="schema-screen">
    {review.schemas.map(reading => (
      <section key={reading.file} aria-label={reading.file}>
        <h2 className="schema-file">
          <code>{reading.file}</code>
        </h2>
        <WholeFile reading={reading} />
      </section>
    ))}
  </div>
);
