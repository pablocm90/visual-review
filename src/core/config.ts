import { normalize } from 'node:path';
import { z } from 'zod';

export const CONFIG_FILE = 'visual-review.config.json';

export const READERS = ['rust', 'typescript', 'rails'] as const;

export type ReaderName = (typeof READERS)[number];

export const LINKERS = ['fetch-axum'] as const;

export type LinkerName = (typeof LINKERS)[number];

export const folderOf = (path: string): string => normalize(path).replace(/\/$/, '');

const folderInside = (parent: string) =>
  z.string().refine(path => !`${folderOf(path)}/`.startsWith('../'), {
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
});

export type Config = z.infer<typeof ConfigSchema>;

export const configJsonSchema = () => z.toJSONSchema(ConfigSchema, { io: 'input' });

export type StackSettings = z.infer<typeof StackSchema>;

export const stackSettings = (config: Config, stack: string): StackSettings =>
  config.stacks[stack] || {};

const jsonIn = (text: string): unknown => {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`${CONFIG_FILE}: ${String(error)}`);
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

export const parseConfig = (text: string): Config => {
  const result = ConfigSchema.safeParse(jsonIn(text));
  if (result.success) return result.data;
  throw new Error(
    result.error.issues
      .flatMap(withinUnions)
      .map(({ path, message }) =>
        [CONFIG_FILE, ...(path.length === 0 ? [] : [path.join('.')]), message].join(': '),
      )
      .join('\n'),
  );
};
