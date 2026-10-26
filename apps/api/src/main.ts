import 'reflect-metadata';
import { loadDotEnv } from './infra/env';

loadDotEnv();

async function main() {
  const { NestFactory } = await import('@nestjs/core');
  const { Logger } = await import('nestjs-pino');
  const { AppModule } = await import('./app.module');
  const { configureApp, setupSwagger } = await import('./bootstrap-app');
  const { env } = await import('./infra/env');

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  setupSwagger(app);
  await app.listen(env().API_PORT);
}

void main();
