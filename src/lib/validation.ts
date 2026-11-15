import { z } from 'zod';

import { badRequest } from './errors.js';
import { hasAtMostTwoDecimals } from './money.js';

/** Validates `data` against `schema`, or throws a 400 listing every problem. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Invalid request',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

/** IDs from the app ("mbx3k2a1b2c3") or the server (UUIDs). */
export const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id');

export const IdParamsSchema = z.strictObject({ id: IdSchema });

/** A euro amount: 0 or more, at most two decimals, at most one billion. */
export const EurosSchema = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000)
  .refine(hasAtMostTwoDecimals, 'Use at most two decimals');

export const SeasonYearSchema = z.number().int().min(2000).max(2200);

export const MonthSchema = z.number().int().min(0).max(11);

/** A name part: trimmed, 1–80 characters, no control characters. */
export const NameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}]*$/u, 'Must not contain control characters');

export const ReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}]*$/u, 'Must not contain control characters');

export const ReasonsSchema = z.array(ReasonSchema).max(50);

export const NoteSchema = z.string().trim().max(500);

export const IsoDateSchema = z.iso.datetime({ offset: true });
