import 'reflect-metadata';
import { loadDotEnv } from './infra/env';

loadDotEnv();

/**
 * Worker (pg-boss). Solo procesos técnicos o de mantenimiento aprobados en D-16 — nunca
 * automatizaciones comerciales:
 * - `trash.purge-expired`: purga diaria de la papelera según la retención de cada organización.
 * Las importaciones/exportaciones (Fase 2) y los avisos de tareas vencidas (Fase 4) se suman aquí.
 */
async function main() {
  const { NestFactory } = await import('@nestjs/core');
  const { Logger } = await import('@nestjs/common');
  const { WorkerModule } = await import('./worker.module');
  const { startJobs } = await import('./jobs');

  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  const stop = await startJobs(app);
  new Logger('Worker').log('Worker iniciado.');
  const shutdown = async () => {
    await stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main();
