import { z } from 'zod';
import { anchorKey, anchorOfKey } from './anchors.ts';
import type { GraphDiff } from './diff-graphs.ts';
import { DIMENSIONS } from './findings.ts';
import { edgeId } from './graph.ts';
import type { SymbolFile } from './read-range.ts';
import { anchoredSymbols } from './symbol-findings.ts';
import {
  boxesAboveIn,
  type VisibleDiffOptions,
  visibleDiff,
  visibleNodeOf,
} from './visible-diff.ts';

const notesVersion = 2;

const answerOf = <Status extends string>(status: Status, means: string) =>
  z.strictObject({ status: z.literal(status).describe(means), text: z.string() }).readonly();

const AnswerSchema = z.discriminatedUnion('status', [
  z
    .strictObject({
      status: z.literal('done').describe('What it asked for is done'),
      commit: z.string().describe('The commit that did it'),
      text: z.string(),
    })
    .readonly(),
  answerOf('answered', 'It wanted an answer, and this is it'),
  answerOf('declined', 'Not taken, and this says why'),
]);

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
        z.templateLiteral([z.enum(['part', 'edge', 'symbol']), ' ', z.string()]),
        z
          .strictObject({
            text: z.string(),
            why: z
              .string()
              .optional()
              .describe('Why it changed this way, and what follows from it'),
            recommendation: z
              .string()
              .optional()
              .describe('What to do about it, when something warrants it'),
            flag: z.string().optional().describe('A short label for a structural concern'),
            dimension: z
              .enum(DIMENSIONS)
              .optional()
              .describe('What the flag is about; left out, structure'),
          })
          .readonly(),
      )
      .readonly()
      .default({})
      .describe(
        'Notes by `part <node id>`, `edge <from> -> <to>` or `symbol <file node id>#<symbol>`; left out, there are none',
      ),
    answers: z
      .record(z.string(), AnswerSchema)
      .readonly()
      .optional()
      .describe(
        "Answers to the last review, by each comment's anchor as `<kind> <id>`; left out, there are none",
      ),
    unasked: z
      .record(z.string(), z.strictObject({ text: z.string() }).readonly())
      .readonly()
      .optional()
      .describe(
        'Changes no comment asked for, by node id, or by `<from> -> <to>` for an edge; left out, there are none',
      ),
  })
  .readonly();

export type ReviewNotes = z.infer<typeof ReviewNotesSchema>;

export type Note = ReviewNotes['notes'][keyof ReviewNotes['notes']];

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

type JoinedField = 'why' | 'recommendation' | 'flag';

const joinedField = (
  key: JoinedField,
  notes: readonly Note[],
  separator: string,
): Partial<Record<JoinedField, string>> => {
  const values = notes.map(note => note[key]).filter(value => value !== undefined);
  return values.length > 0 ? { [key]: values.join(separator) } : {};
};

const joined = (one: Note, other: Note): Note => ({
  text: `${one.text} ${other.text}`,
  ...joinedField('why', [one, other], ' '),
  ...joinedField('recommendation', [one, other], ' '),
  ...joinedField('flag', [one, other], ', '),
});

export const notesOnTheGraph = (notes: ReviewNotes['notes']): Readonly<Record<string, Note>> =>
  Object.fromEntries(Object.entries(notes).map(([key, note]) => [anchorOfKey(key).id, note]));

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
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly said:
    | ReadonlyArray<{ readonly anchor: { readonly kind: string; readonly id: string } }>
    | undefined;
};

const lastReviewProblems = ({
  notes,
  said,
}: Pick<NotesProblemsOptions, 'notes' | 'said'>): ReadonlyArray<string> => {
  const saidAnchors = new Set((said ?? []).map(({ anchor }) => anchorKey(anchor)));
  return [
    ...Object.keys(notes.answers ?? {})
      .filter(key => !saidAnchors.has(key))
      .map(key => `unknown comment ${key}`),
    ...(said === undefined && notes.unasked !== undefined
      ? ['unasked changes show under the last review, and this page has none']
      : []),
  ];
};

export const notesProblems = ({
  diff,
  notes,
  symbols,
  said,
}: NotesProblemsOptions): ReadonlyArray<string> => {
  const boxesAbove = boxesAboveIn(diff.nodes);
  const endsOf = (id: string): ReadonlyArray<string> => [id, ...boxesAbove(id)];
  const parts = diff.nodes.filter(node => node.kind !== 'stack').map(node => node.id);
  const edges = diff.edges.flatMap(edge =>
    endsOf(edge.from).flatMap(from =>
      endsOf(edge.to)
        .filter(to => to !== from)
        .map(to => edgeId({ from, to })),
    ),
  );
  const knownIds = new Set([...parts, ...edges]);
  const knownKeys = new Set([
    ...parts.map(id => anchorKey({ kind: 'part', id })),
    ...edges.map(id => anchorKey({ kind: 'edge', id })),
    ...symbols.flatMap(file =>
      'symbols' in file
        ? anchoredSymbols(file.node, file.symbols).map(({ id }) =>
            anchorKey({ kind: 'symbol', id }),
          )
        : [],
    ),
  ]);
  const collapsed = visibleDiff({ diff, expanded: new Set() });
  const shown = visibleNotes({ diff, expanded: new Set(), notes: notesOnTheGraph(notes.notes) });
  const touched = [
    ...collapsed.nodes
      .filter(node => node.kind !== 'stack' && node.state !== 'unchanged')
      .map(node => ({ kind: 'part', id: node.id })),
    ...collapsed.edges
      .filter(edge => edge.state !== 'unchanged')
      .map(edge => ({ kind: 'edge', id: edgeId(edge) })),
  ];
  return [
    ...Object.keys(notes.notes)
      .filter(key => !knownKeys.has(key))
      .map(key => `unknown key ${key}`),
    ...Object.entries(notes.notes)
      .filter(([key, { flag }]) => flag !== undefined && anchorOfKey(key).kind === 'symbol')
      .map(([key]) => `flag on ${key}: only a part or edge note takes a flag`),
    ...[...notes.summary.flatMap(item => item.target ?? []), ...Object.keys(notes.unasked ?? {})]
      .filter(id => !knownIds.has(id))
      .map(id => `unknown id ${id}`),
    ...touched
      .filter(({ id }) => shown[id] === undefined)
      .map(anchor => `no note on ${anchorKey(anchor)}`),
    ...lastReviewProblems({ notes, said }),
  ];
};
