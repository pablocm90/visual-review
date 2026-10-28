import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configJsonSchema } from './config.ts';
import { notesJsonSchema } from './notes.ts';

const write = (name: string, schema: unknown): void =>
  writeFileSync(
    join(import.meta.dirname, '..', 'dist', name),
    `${JSON.stringify(schema, null, 2)}\n`,
  );

write('config.schema.json', configJsonSchema());
write('notes.schema.json', notesJsonSchema());
