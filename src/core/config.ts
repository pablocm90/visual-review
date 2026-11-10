import { isAbsolute, normalize } from 'node:path';
import { z } from 'zod';

export const CONFIG_FILE = 'visual-review.config.json';

export const READERS = ['rust', 'typescript', 'rails'] as const;

export type ReaderName = (typeof READERS)[number];

export const LINKERS = ['fetch-axum'] as const;

export type LinkerName = (typeof LINKERS)[number];

export const folderOf = (path: string): string => normalize(path).replace(/\/$/, '');

const folderInside = (parent: string) =>
  z.string().refine(path => !isAbsolute(path) && !`${folderOf(path)}/`.startsWith('../'), {
    message: `must be a folder inside ${parent}`,
  });

const StackSchema = z
  .strictObject({
    reader: z
      .enum(READERS)
      .optional()
      .describe('With root, adds a stack detection missed, read by this reader'),
    root: folderInside('the repo')
      .optional()
      .describe('With reader, the folder of the added stack, relative to the repo'),
    label: z.string().optional().describe("The stack's label on the page; its id stays"),
    sourceRoot: folderInside("the stack's root")
      .optional()
      .describe("TS stacks: the folder under the stack's root that holds its sources"),
    boxes: z
      .array(z.string())
      .optional()
      .describe(
        'TS and Rails stacks: folder globs under the source root (TS) or app root (Rails), each matched folder a box; other files box by first folder (TS) or layer (Rails)',
      ),
  })
  .refine(({ reader, root }) => (reader === undefined) === (root === undefined), {
    message: 'give both reader and root, or neither',
  });

const LinkerSchema = z.strictObject({
  from: z
    .array(z.string())
    .optional()
    .describe("The stacks it reads from, by drawn id; every stack of its from reader's by default"),
  to: z
    .array(z.string())
    .optional()
    .describe("The stacks it links to, by drawn id; every stack of its to reader's by default"),
});

const Threshold = z.int().positive();

const MetricsSchema = z.strictObject({
  churnDays: z
    .int()
    .positive()
    .default(90)
    .describe("How many days before each side's commit its churn counts"),
  cyclomatic: Threshold.default(10).describe(
    "The highest a function's cyclomatic complexity may be",
  ),
  hotspot: z
    .strictObject({
      churn: Threshold.default(6).describe('The churn a hotspot reaches'),
      cyclomatic: Threshold.default(8).describe('The highest cyclomatic a hotspot reaches'),
    })
    .prefault({})
    .describe('A node that reaches both is a hotspot'),
  lines: Threshold.optional().describe("The most lines a node's file may have; off unless set"),
  abc: z
    .number()
    .positive()
    .optional()
    .describe("The largest ABC size a node's file may have; off unless set"),
  splitParts: Threshold.default(4).describe(
    'The parts a separate group of changes reaches to count towards a split suggestion',
  ),
});

const Globs = z.union([z.string().transform(glob => [glob]), z.array(z.string()).min(1)], {
  error: 'Invalid input: expected a glob or a list of globs',
});

const RuleSchema = z.strictObject({
  from: Globs.describe('The nodes the rule holds for, by id glob; a node under one matches too'),
  notTo: Globs.describe(
    'The nodes they may not depend on, by id glob; a node under one matches too',
  ),
  reason: z.string().describe("Why: the rule's findings say it"),
});

const NotesConfigSchema = z.strictObject({
  guidance: z
    .string()
    .optional()
    .describe("What Claude's notes should say and where, followed when it writes them"),
  why: z
    .boolean()
    .optional()
    .describe('Whether a note may say why; false refuses one, left out it may'),
  recommendation: z
    .boolean()
    .optional()
    .describe('Whether a note may recommend; false refuses one, left out it may'),
});

const SecuritySchema = z.strictObject({
  authorize: z
    .array(z.string())
    .default([
      'authorize',
      'authorize!',
      'load_and_authorize_resource',
      'authorize_resource',
      'verify_authorized',
    ])
    .describe(
      'The callbacks and calls that authorize an action, * a wildcard; replaces the defaults',
    ),
});

const ConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  stacks: z
    .record(
      z.string(),
      z.union([z.literal(false), StackSchema], {
        error: 'Invalid input: expected false or an object',
      }),
    )
    .default({})
    .describe('Stacks by the id the page draws; false drops one'),
  linkers: z
    .partialRecord(
      z.enum(LINKERS),
      z.union([z.literal(false), LinkerSchema], {
        error: 'Invalid input: expected false or an object',
      }),
    )
    .default({})
    .describe('Linkers by name; false turns one off'),
  metrics: MetricsSchema.prefault({}).describe('How node metrics are read'),
  rules: z
    .record(z.string(), RuleSchema)
    .default({})
    .describe('Architecture rules by name: edges from some nodes to others that break them'),
  notes: NotesConfigSchema.prefault({}).describe(
    "How Claude writes its notes, read from the range's base revision, so a change can't rewrite it",
  ),
  security: SecuritySchema.prefault({}).describe('How access to controller actions is read'),
});

export type Config = z.infer<typeof ConfigSchema>;

export const configJsonSchema = () => z.toJSONSchema(ConfigSchema, { io: 'input' });

export type Rules = Config['rules'];

export type NotesConfig = Config['notes'];

export type StackSettings = z.infer<typeof StackSchema>;

export const stackSettings = (config: Config, stack: string): StackSettings =>
  config.stacks[stack] || {};

const jsonOf = (text: string): unknown => JSON.parse(text.replace(/^\uFEFF/, ''));

const jsonIn = (text: string, file: string): unknown => {
  try {
    return jsonOf(text);
  } catch (error) {
    throw new Error(`${file}: ${String(error)}`);
  }
};

const jsonOrNothing = (text: string): unknown => {
  try {
    return jsonOf(text);
  } catch {
    return {};
  }
};

const withinUnions = (issue: z.core.$ZodIssue): ReadonlyArray<z.core.$ZodIssue> => {
  if (issue.code !== 'invalid_union') return [issue];
  const within = issue.errors
    .flat()
    .filter(({ path }) => path.length > 0)
    .map(inner => ({ ...inner, path: [...issue.path, ...inner.path] }));
  return within.length > 0 ? within : [issue];
};

const parsedBy = <Schema extends z.ZodType>(
  schema: Schema,
  json: unknown,
  file: string,
): z.output<Schema> => {
  const result = schema.safeParse(json);
  if (result.success) return result.data;
  throw new Error(
    result.error.issues
      .flatMap(withinUnions)
      .map(({ path, message }) =>
        [file, ...(path.length === 0 ? [] : [path.join('.')]), message].join(': '),
      )
      .join('\n'),
  );
};

export const parseConfig = (text: string): Config =>
  parsedBy(ConfigSchema, jsonIn(text, CONFIG_FILE), CONFIG_FILE);

const BaseNotesSchema = z.object({ notes: NotesConfigSchema.prefault({}) });

export const parseBaseNotesConfig = (text: string): NotesConfig =>
  parsedBy(BaseNotesSchema, jsonOrNothing(text), `${CONFIG_FILE} at the base`).notes;
