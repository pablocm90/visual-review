import { z } from 'zod';

const reviewVersion = 3;

const ReviewSchema = z
  .strictObject({
    version: z.literal(reviewVersion).describe('The review format this file is written in'),
    verdict: z
      .enum(['approve', 'comment', 'request-changes'])
      .describe("The reviewer's verdict on the whole change"),
    body: z.string().optional().describe("The reviewer's general comment on the whole change"),
    reviewed: z
      .strictObject({
        range: z.string().describe('The range the page was drawn for, `<from>..<to>`'),
        pullRequest: z.number().optional().describe('The pull request it was drawn for'),
      })
      .readonly()
      .describe('What the page was drawn for'),
    read: z
      .array(z.string())
      .readonly()
      .describe('The parts the reviewer marked read, by node id, in reading order'),
    comments: z
      .array(
        z
          .strictObject({
            anchor: z
              .strictObject({
                kind: z.enum(['part', 'edge']).describe('What the comment is on'),
                id: z.string().describe('A node id, or `<from> -> <to>` for an edge'),
              })
              .readonly(),
            kind: z
              .enum(['change', 'question', 'suggestion'])
              .describe('What the comment asks for: a task, an answer, or a thought to weigh'),
            text: z.string(),
          })
          .readonly(),
      )
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
      .describe("The reviewer's comments, one per anchor"),
  })
  .readonly();

export type Review = z.infer<typeof ReviewSchema>;

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
