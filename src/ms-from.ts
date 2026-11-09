import { z } from 'zod';

const MsSchema = z.coerce.number().int().min(1).max(2_147_483_647);

type MsFromOptions = {
  readonly variable: string;
  readonly fallback: number;
};

export const msFrom = ({ variable, fallback }: MsFromOptions): number => {
  const written = process.env[variable];
  if (written === undefined) return fallback;
  const parsed = MsSchema.safeParse(written);
  if (!parsed.success)
    throw new Error(
      `${variable} must be a whole number of milliseconds from 1 to 2147483647, not ${JSON.stringify(written)}`,
    );
  return parsed.data;
};
