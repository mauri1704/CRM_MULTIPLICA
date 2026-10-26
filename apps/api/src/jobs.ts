import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { Db } from './infra/db';
import { env } from './infra/env';
import { TrashService } from './modules/trash/trash.service';

export const JOBS = { trashPurge: 'trash.purge-expired' } as const;

/** Purga de papelera de todas las organizaciones. Idempotente: puede correr varias veces. */
export async function runTrashPurge(app: INestApplicationContext): Promise<void> {
  const db = app.get(Db);
  const trash = app.get(TrashService);
  const logger = new Logger('TrashPurge');
  const orgs = await db.client.organization.findMany({ select: { id: true } });
  const results = await Promise.allSettled(
    orgs.map((o) => db.withOrg(o.id, () => trash.purgeExpired(), { timeout: 120_000 })),
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') logger.error(`Organización ${orgs[i]?.id}: ${String(r.reason)}`);
    else if (r.value.purged + r.value.blocked > 0) {
      logger.log(
        `Organización ${orgs[i]?.id}: ${r.value.purged} purgados, ${r.value.blocked} con dependencias.`,
      );
    }
  });
}

export async function startJobs(app: INestApplicationContext): Promise<() => Promise<void>> {
  // pg-boss crea y usa su propio esquema: se conecta con el rol dueño (DATABASE_URL).
  const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (e) => new Logger('pg-boss').error(e));
  await boss.start();
  await boss.createQueue(JOBS.trashPurge);
  // Todos los días a las 03:15, hora de Lima.
  await boss.schedule(JOBS.trashPurge, '15 3 * * *', {}, { tz: 'America/Lima' });
  await boss.work(JOBS.trashPurge, async () => runTrashPurge(app));
  return () => boss.stop({ graceful: true });
}
