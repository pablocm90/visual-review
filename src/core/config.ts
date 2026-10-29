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
        'TS stacks: folder globs under the source root, each matched folder a box; other files box by first folder',
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
});

export type Config = z.infer<typeof ConfigSchema>;

export const configJsonSchema = () => z.toJSONSchema(ConfigSchema, { io: 'input' });

export type StackSettings = z.infer<typeof StackSchema>;

export const stackSettings = (config: Config, stack: string): StackSettings =>
  config.stacks[stack] || {};

type AddedStack = {
  readonly stack: string;
  readonly root: string;
};

type AddedStacksOptions = {
  readonly config: Config;
  readonly reader: ReaderName;
  readonly detected: ReadonlyMap<string, string>;
  readonly taken: ReadonlySet<string>;
};

export const addedStacks = ({
  config,
  reader,
  detected,
  taken,
}: AddedStacksOptions): ReadonlyArray<AddedStack> => {
  const added = Object.entries(config.stacks).flatMap(([stack, settings]) =>
    settings && settings.reader === reader && settings.root !== undefined
      ? [{ stack, root: settings.root }]
      : [],
  );
  const problems = added.flatMap(({ stack, root }) => {
    const other = detected.get(folderOf(root));
    const detectedAt = [...detected].find(([, id]) => id === stack)?.[0];
    return [
      ...(other === undefined
        ? []
        : [
            `${CONFIG_FILE}: stacks.${stack}.root: ${root} is detected as stack ${other}; set stacks.${other} instead`,
          ]),
      ...(detectedAt === undefined
        ? []
        : [
            `${CONFIG_FILE}: stacks.${stack} is detected at ${detectedAt}; add the stack under another key, or drop its reader and root`,
          ]),
      ...(taken.has(stack)
        ? [
            `${CONFIG_FILE}: stacks.${stack} is drawn by another reader; add the stack under another key, or drop its reader and root`,
          ]
        : []),
    ];
  });
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return added;
};

type DrawnStack = {
  readonly stack: string;
  readonly reader: {
    readonly name: ReaderName;
    readonly stackFields: ReadonlyArray<string>;
  };
};

const OWN_FIELDS: ReadonlyArray<string> = ['reader', 'root', 'label'];

const undetectedIn = (config: Config, stacks: ReadonlyArray<DrawnStack>) =>
  Object.keys(config.stacks)
    .filter(stack => !stacks.some(drawn => drawn.stack === stack))
    .map(stack => {
      const { reader, root } = stackSettings(config, stack);
      return reader === undefined
        ? `${CONFIG_FILE}: stacks.${stack} names no detected stack; give it reader and root to add one`
        : `${CONFIG_FILE}: stacks.${stack}.root: ${root} holds no ${reader} stack on either side`;
    });

const untakenIn = (config: Config, stacks: ReadonlyArray<DrawnStack>) => [
  ...new Set(
    stacks.flatMap(({ stack, reader }) =>
      Object.keys(stackSettings(config, stack))
        .filter(field => !OWN_FIELDS.includes(field) && !reader.stackFields.includes(field))
        .map(
          field =>
            `${CONFIG_FILE}: stacks.${stack}.${field} is not taken by the ${reader.name} reader`,
        ),
    ),
  ),
];

type LinkerReaders = {
  readonly name: LinkerName;
  readonly from: ReaderName;
  readonly to: ReaderName;
};

const unlinkableIn = (
  config: Config,
  stacks: ReadonlyArray<DrawnStack>,
  linkers: ReadonlyArray<LinkerReaders>,
) =>
  linkers.flatMap(linker => {
    const settings = config.linkers[linker.name] || {};
    return (['from', 'to'] as const).flatMap(end =>
      (settings[end] ?? []).flatMap(stack => {
        if (config.stacks[stack] === false)
          return [
            `${CONFIG_FILE}: linkers.${linker.name}.${end}: ${stack} is dropped by stacks.${stack}`,
          ];
        return stacks.some(drawn => drawn.stack === stack && drawn.reader.name === linker[end])
          ? []
          : [
              `${CONFIG_FILE}: linkers.${linker.name}.${end}: ${stack} names no ${linker[end]} stack on either side`,
            ];
      }),
    );
  });

export const checkConfig = (
  config: Config,
  stacks: ReadonlyArray<DrawnStack>,
  linkers: ReadonlyArray<LinkerReaders>,
): void => {
  const problems = [
    ...undetectedIn(config, stacks),
    ...untakenIn(config, stacks),
    ...unlinkableIn(config, stacks, linkers),
  ];
  if (problems.length > 0) throw new Error(problems.join('\n'));
};

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
