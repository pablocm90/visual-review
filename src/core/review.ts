import { z } from 'zod';

const reviewVersion = 5;

const anchorOn = <Kind extends string>(kind: Kind, id: string) =>
  z.strictObject({ kind: z.literal(kind), id: z.string().describe(id) }).readonly();

const quotedAnchorOn = <Kind extends string>(kind: Kind, id: string, text: string) =>
  z
    .strictObject({
      kind: z.literal(kind),
      id: z.string().describe(id),
      text: z.string().describe(text),
    })
    .readonly();

const CommentSchema = z
  .strictObject({
    anchor: z
      .discriminatedUnion('kind', [
        anchorOn('part', 'A node id'),
        anchorOn('edge', '`<from> -> <to>`, the node ids at its ends'),
        anchorOn(
          'symbol',
          "`<file node id>#<scope.name>`: a function, method or class in a file, then `#<n>` on the n-th of the file's symbols of that name, as a getter and its setter are, in the page data's `symbols` order",
        ),
        quotedAnchorOn(
          'decision',
          "`<symbol id>#<text>`: a logic line of a function, the symbol's id with its `#<n>` if it has one, its text the base side's when removed, else the head side's, then `#<n>` on the n-th line of the function whose id reads the same. A removed guard's or catch's id is its `logic:removed:` finding's id without that prefix",
          "The logic line's text",
        ),
        anchorOn('test', '`<test file>#<heading › … › name>`: a test by its headings and name'),
        quotedAnchorOn(
          'line',
          '`<file>@<base|head>:<n>`: a diff line by its side and line number',
          "The line's text, since its number drifts between rounds",
        ),
      ])
      .describe('What the comment is on'),
    kind: z
      .enum(['change', 'question', 'suggestion'])
      .describe('What the comment asks for: a task, an answer, or a thought to weigh'),
    text: z.string(),
  })
  .readonly();

const AnswerSchema = z
  .strictObject({
    anchor: z
      .strictObject({
        kind: z.literal('finding').describe('An answer to a finding'),
        id: z.string().describe("The finding's id"),
      })
      .readonly(),
    kind: z
      .enum(['fix', 'fine', 'explain'])
      .describe('What the answer asks for: a task, nothing, or an answer'),
    text: z.string().optional().describe('Why it is fine, when the reviewer says'),
  })
  .readonly();

const ReviewSchema = z
  .strictObject({
    version: z.literal(reviewVersion).describe('The review format this file is written in'),
    verdict: z
      .enum(['approve', 'comment', 'request-changes'])
      .describe("The reviewer's verdict on the whole change"),
    body: z.string().optional().describe("The reviewer's general comment on the whole change"),
    reviewed: z
      .strictObject({
        range: z
          .string()
          .describe(
            'The range the page was drawn for, `<from>..<to>`, or `HEAD..worktree` for uncommitted work',
          ),
        pullRequest: z.number().optional().describe('The pull request it was drawn for'),
      })
      .readonly()
      .describe('What the page was drawn for'),
    read: z
      .array(z.string())
      .readonly()
      .describe('The parts the reviewer marked read, by node id, in reading order'),
    comments: z
      .array(z.union([CommentSchema, AnswerSchema]))
      .readonly()
      .superRefine((comments, context) => {
        const counts = Map.groupBy(comments, ({ anchor }) => `${anchor.kind} ${anchor.id}`);
        for (const [anchor, onIt] of counts) {
          if (onIt.length > 1) {
            context.addIssue(
              `${anchor} has ${onIt.length} comments; a review holds one per anchor`,
            );
          }
        }
      })
      .describe("The reviewer's comments and answers to findings, one per anchor"),
  })
  .readonly();

export type Review = z.infer<typeof ReviewSchema>;

export type Comment = z.infer<typeof CommentSchema>;

export type Answer = z.infer<typeof AnswerSchema>;

export const reviewJsonSchema = () => z.toJSONSchema(ReviewSchema, { io: 'input' });

const VersionedSchema = z.object({ version: z.unknown() });

const invalidReview = (reason: unknown): Error => new Error(`Invalid review: ${reason}`);

const versionProblem = (version: unknown): string =>
  `${version === undefined ? 'no "version"' : `version ${JSON.stringify(version)} is unknown`}; this visual-review reads version ${reviewVersion}`;

const contentsOf = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw invalidReview(error);
  }
};

export const parseReview = (text: string): Review => {
  const contents = contentsOf(text);
  const version = VersionedSchema.safeParse(contents).data?.version;
  if (version !== reviewVersion) {
    throw invalidReview(versionProblem(version));
  }
  const review = ReviewSchema.safeParse(contents);
  if (!review.success) {
    throw invalidReview(review.error);
  }
  return review.data;
};
