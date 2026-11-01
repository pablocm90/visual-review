import { z } from 'zod';

const reviewVersion = 1;

const ReviewSchema = z
  .strictObject({
    version: z.literal(reviewVersion).describe('The review format this file is written in'),
    comments: z
      .record(z.string(), z.strictObject({ text: z.string() }).readonly())
      .readonly()
      .describe("The reviewer's comments by node id, or by `<from> -> <to>` for an edge"),
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
