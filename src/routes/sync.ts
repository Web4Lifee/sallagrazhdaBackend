import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { actorOf } from '../http/context.js';
import {
  EurosSchema,
  IdSchema,
  IsoDateSchema,
  MonthSchema,
  NameSchema,
  NoteSchema,
  ReasonsSchema,
  SeasonYearSchema,
  parse,
} from '../lib/validation.js';
import type { SyncService } from '../services/sync.js';
import { SettingsSchema } from './settings.js';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Defaults for settings missing from older app versions (same as the app's DEFAULT_SETTINGS). */
const IMPORT_DEFAULT_SETTINGS = {
  adminName: 'Administratori',
  organization: 'Mirëmbajtja e Oborrit',
  goal: 2500,
  annualFee: 35,
  seasonStartMonth: 9,
  seasonStartYear: 2027,
  reasons: ['Mirëmbajtja e oborrit', 'Kositja e barit', 'Pastrimi'],
  paperWidth: 58 as const,
};

/** The app's saved store (AsyncStorage "babi-app-store" → state), validated record by record. */
const SnapshotSchema = z.object({
  people: z
    .array(
      z.object({
        id: IdSchema,
        firstName: NameSchema,
        fatherName: NameSchema,
        lastName: NameSchema,
        createdAt: IsoDateSchema,
      }),
    )
    .max(20_000),
  tickets: z
    .array(
      z.object({
        id: IdSchema,
        number: z.number().int().min(1).max(2_000_000_000),
        personId: IdSchema,
        kind: z.enum(['annual', 'payment']),
        season: SeasonYearSchema,
        amount: EurosSchema,
        due: EurosSchema.optional(),
        reasons: ReasonsSchema,
        status: z.enum(['paid', 'unpaid']),
        note: NoteSchema.optional(),
        createdAt: IsoDateSchema,
        paidAt: IsoDateSchema.optional(),
      }),
    )
    .max(200_000),
  // Lenient (unknown keys dropped) so data from newer or older app versions still imports.
  settings: z
    .object(SettingsSchema.shape)
    .partial()
    .transform((s) => ({ ...IMPORT_DEFAULT_SETTINGS, ...s })),
  seasons: z
    .array(z.object({ year: SeasonYearSchema, month: MonthSchema, startedAt: IsoDateSchema }))
    .max(200),
  nextTicketNumber: z.number().int().min(1).max(2_000_000_000),
  dismissedAnnual: z.array(z.string().max(100)).max(200_000).default([]),
});

/** Protected routes: register inside a scope that has the auth hook. */
export function syncRoutes(sync: SyncService): FastifyPluginAsync {
  return async (app) => {
    // Full download in the app's own data shape.
    app.get('/v1/sync', async () => sync.snapshot());

    // One-time upload of the phone's data to an empty server.
    app.post('/v1/import', { bodyLimit: MAX_IMPORT_BYTES }, async (request, reply) => {
      const result = await sync.import(parse(SnapshotSchema, request.body), actorOf(request));
      return reply.status(201).send(result);
    });
  };
}
