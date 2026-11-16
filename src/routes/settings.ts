import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { EurosSchema, MonthSchema, ReasonsSchema, SeasonYearSchema, parse } from '../lib/validation.js';
import type { SettingsService } from '../services/settings.js';

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, 'Must not contain control characters');

export const SettingsSchema = z.strictObject({
  adminName: text(100),
  organization: text(150),
  goal: EurosSchema,
  annualFee: EurosSchema,
  seasonStartMonth: MonthSchema,
  seasonStartYear: SeasonYearSchema,
  reasons: ReasonsSchema,
  paperWidth: z.union([z.literal(58), z.literal(80)]),
});

const SettingsPatch = SettingsSchema.partial();

/** Protected routes: register inside a scope that has the auth hook. */
export function settingsRoutes(settings: SettingsService): FastifyPluginAsync {
  return async (app) => {
    app.get('/v1/settings', async () => settings.get());

    // Send only the fields you want to change.
    app.patch('/v1/settings', async (request) => settings.update(parse(SettingsPatch, request.body)));
  };
}
