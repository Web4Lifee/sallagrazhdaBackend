import type { Queryable } from '../db/pool.js';
import type { Actor } from '../domain/types.js';

/** Records a change. Call it inside the same transaction as the change itself. */
export async function recordAudit(
  q: Queryable,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  await q.query(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
    [actor.userId, action, entity, entityId, details ? JSON.stringify(details) : null, actor.ip],
  );
}
