import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configJsonSchema } from './core/config.ts';
import { notesJsonSchema } from './core/notes.ts';
import { reviewJsonSchema } from './core/review.ts';

const write = (name: string, schema: unknown): void =>
  writeFileSync(
    join(import.meta.dirname, '..', 'dist', name),
    `${JSON.stringify(schema, null, 2)}\n`,
  );

write('config.schema.json', configJsonSchema());
write('notes.schema.json', notesJsonSchema());
write('review.schema.json', reviewJsonSchema());
