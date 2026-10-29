import { z } from 'zod';
import type { GraphDiff } from './diff-graphs.ts';
import { edgeId } from './graph.ts';
import { type VisibleDiffOptions, visibleDiff, visibleNodeOf } from './visible-diff.ts';

const notesVersion = 1;

const ReviewNotesSchema = z
  .strictObject({
    $schema: z.string().optional(),
    version: z.literal(notesVersion).describe('The notes format this file is written in'),
    summary: z
      .array(
        z
          .strictObject({
            text: z.string(),
            target: z.string().optional().describe('The id of the node or edge it is about'),
          })
          .readonly(),
      )
      .readonly()
      .describe("A few items on the change's shape as a whole"),
    tests: z.string().describe('What the tests pin, and what the change leaves unpinned'),
    notes: z
      .record(
        z.string(),
        z
          .strictObject({
            text: z.string(),
            flag: z.string().optional().describe('A short label for a structural concern'),
          })
          .readonly(),
      )
      .readonly()
      .describe('Notes by node id, or by `<from> -> <to>` for an edge'),
  })
  .readonly();

export type ReviewNotes = z.infer<typeof ReviewNotesSchema>;

export type Note = ReviewNotes['notes'][string];

export const notesJsonSchema = () =>
  z.toJSONSchema(ReviewNotesSchema, {
    io: 'input',
    override: ({ jsonSchema }) => {
      delete jsonSchema.readOnly;
    },
  });

const VersionedSchema = z.object({ version: z.unknown() });

const invalidNotes = (file: string, reason: unknown): Error =>
  new Error(`Invalid notes file ${file}: ${reason}`);

const versionProblem = (version: unknown): string =>
  `${version === undefined ? 'no "version"' : `version ${JSON.stringify(version)} is unknown`}; this visual-review reads version ${notesVersion}`;

const contentsOf = (text: string, file: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw invalidNotes(file, error);
  }
};

type ParseNotesOptions = {
  readonly text: string;
  readonly file: string;
};

export const parseNotes = ({ text, file }: ParseNotesOptions): ReviewNotes => {
  const contents = contentsOf(text, file);
  const version = VersionedSchema.safeParse(contents).data?.version;
  if (version !== notesVersion) {
    throw invalidNotes(file, versionProblem(version));
  }
  const notes = ReviewNotesSchema.safeParse(contents);
  if (!notes.success) {
    throw invalidNotes(file, notes.error);
  }
  return notes.data;
};

const joined = (one: Note, other: Note): Note => {
  const flags = [one.flag, other.flag].filter(flag => flag !== undefined);
  return {
    text: `${one.text} ${other.text}`,
    ...(flags.length > 0 ? { flag: flags.join(', ') } : {}),
  };
};

type VisibleNotesOptions = VisibleDiffOptions & {
  readonly notes: Readonly<Record<string, Note>>;
};

export const visibleNotes = ({
  diff,
  expanded,
  notes,
}: VisibleNotesOptions): Readonly<Record<string, Note>> => {
  const visibleOf = visibleNodeOf({ diff, expanded });
  const drawnIdOf = new Map(
    diff.edges.map(edge => [
      edgeId(edge),
      edgeId({ from: visibleOf(edge.from), to: visibleOf(edge.to) }),
    ]),
  );
  const placed = Object.entries(notes).map(([id, note]) => ({ id: drawnIdOf.get(id) ?? id, note }));
  return Object.fromEntries(
    [...new Set(placed.map(({ id }) => id))].map(id => [
      id,
      placed
        .filter(other => other.id === id)
        .map(({ note }) => note)
        .reduce(joined),
    ]),
  );
};

type NotesProblemsOptions = {
  readonly diff: GraphDiff;
  readonly notes: ReviewNotes;
};

export const notesProblems = ({ diff, notes }: NotesProblemsOptions): ReadonlyArray<string> => {
  const collapsedOf = visibleNodeOf({ diff, expanded: new Set() });
  const endsOf = (id: string): ReadonlyArray<string> => [...new Set([id, collapsedOf(id)])];
  const known = new Set([
    ...diff.nodes.filter(node => node.kind !== 'stack').map(node => node.id),
    ...diff.edges.flatMap(edge =>
      endsOf(edge.from).flatMap(from =>
        endsOf(edge.to)
          .filter(to => to !== from)
          .map(to => edgeId({ from, to })),
      ),
    ),
  ]);
  const collapsed = visibleDiff({ diff, expanded: new Set() });
  const shown = visibleNotes({ diff, expanded: new Set(), notes: notes.notes });
  const touched = [
    ...collapsed.nodes
      .filter(node => node.kind !== 'stack' && node.state !== 'unchanged')
      .map(node => node.id),
    ...collapsed.edges.filter(edge => edge.state !== 'unchanged').map(edgeId),
  ];
  return [
    ...[...Object.keys(notes.notes), ...notes.summary.flatMap(item => item.target ?? [])]
      .filter(id => !known.has(id))
      .map(id => `unknown id ${id}`),
    ...touched.filter(id => shown[id] === undefined).map(id => `no note on ${id}`),
  ];
};
