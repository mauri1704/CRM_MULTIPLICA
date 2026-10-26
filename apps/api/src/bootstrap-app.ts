import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import { env } from './infra/env';

export const API_PREFIX = 'api/v1';

/** Configuración HTTP común a main.ts y a las pruebas de integración. */
export function configureApp(app: INestApplication): void {
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', env().TRUST_PROXY);
  express.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          // Swagger UI (solo /api/docs) necesita sus propios estilos y scripts.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('CRM Multiplica — API')
    .setDescription(
      'API REST del CRM. Autenticación por cookie de sesión (`crm_session`). ' +
        'Toda petición que modifica datos debe enviar la cabecera `X-CRM-Request: 1`.',
    )
    .setVersion('1')
    .addCookieAuth('crm_session')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
}
