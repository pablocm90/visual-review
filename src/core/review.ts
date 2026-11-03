import { z } from 'zod';

const reviewVersion = 5;

const anchorOn = <Kind extends string>(kind: Kind, id: string) =>
  z.strictObject({ kind: z.literal(kind), id: z.string().describe(id) }).readonly();

const CommentSchema = z
  .strictObject({
    anchor: z
      .discriminatedUnion('kind', [
        anchorOn('part', 'A node id'),
        anchorOn('edge', '`<from> -> <to>`, the node ids at its ends'),
        anchorOn('symbol', '`<file node id>#<scope.name>`: a function, method or class in a file'),
        anchorOn(
          'decision',
          '`<file node id>#<scope.name>#<text>`: a logic line of a function, the id its logic finding names',
        ),
        anchorOn('test', '`<test file>#<heading › … › name>`: a test by its headings and name'),
        z
          .strictObject({
            kind: z.literal('line'),
            id: z
              .string()
              .describe('`<file>@<base|head>:<n>`: a diff line by its side and line number'),
            text: z.string().describe("The line's text, since its number drifts between rounds"),
          })
          .readonly(),
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
