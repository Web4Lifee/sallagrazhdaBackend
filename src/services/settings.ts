import { withTransaction, type Db } from '../db/pool.js';
import type { Actor, Settings } from '../domain/types.js';
import { cleanReasons } from '../lib/text.js';
import { recordAudit } from '../repositories/audit.js';
import { getSettings, saveSettings } from '../repositories/settings.js';

export function createSettingsService(db: Db) {
  return {
    async get(): Promise<Settings> {
      return (await getSettings(db)).settings;
    },

    /** Changes only the given fields. Existing tickets keep the fee they were created with. */
    update(patch: Partial<Settings>, actor: Actor): Promise<Settings> {
      return withTransaction(db, async (tx) => {
        const { settings: before } = await getSettings(tx, { forUpdate: true });
        const after: Settings = { ...before, ...patch };
        if (patch.reasons) after.reasons = cleanReasons(patch.reasons);
        if (patch.adminName !== undefined) after.adminName = patch.adminName.trim();
        if (patch.organization !== undefined) after.organization = patch.organization.trim();

        await saveSettings(tx, after);

        const changed = (Object.keys(patch) as (keyof Settings)[]).filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
        );
        if (changed.length) {
          await recordAudit(tx, actor, 'settings.update', 'settings', null, {
            before: Object.fromEntries(changed.map((k) => [k, before[k]])),
            after: Object.fromEntries(changed.map((k) => [k, after[k]])),
          });
        }
        return after;
      });
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
