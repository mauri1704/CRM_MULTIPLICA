import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from './common/auth.guard';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { TenantInterceptor } from './common/tenant.interceptor';
import { env } from './infra/env';
import { InfraModule } from './infra/infra.module';
import { AuditController } from './modules/audit/audit.controller';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { CatalogsController } from './modules/catalogs/catalogs.controller';
import { CatalogsService } from './modules/catalogs/catalogs.service';
import { CoreModule } from './modules/core.module';
import { CustomFieldsController } from './modules/custom-fields/custom-fields.controller';
import { DomainModule } from './modules/domain.module';
import { HealthController } from './modules/health/health.controller';
import { HistoryController } from './modules/history/history.controller';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { OrganizationController } from './modules/organization/organization.controller';
import { OrganizationService } from './modules/organization/organization.service';
import { PipelinesController } from './modules/pipelines/pipelines.controller';
import { PipelinesService } from './modules/pipelines/pipelines.service';
import { RolesController } from './modules/roles/roles.controller';
import { RolesService } from './modules/roles/roles.service';
import { TeamsController } from './modules/teams/teams.controller';
import { TrashController } from './modules/trash/trash.controller';
import { UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';
import { CompaniesController } from './modules/companies/companies.controller';
import { ContactsController } from './modules/contacts/contacts.controller';
import { CurrenciesController } from './modules/currencies/currencies.controller';
import { ExchangeRatesController } from './modules/exchange-rates/exchange-rates.controller';
import { ImportExportController } from './modules/import-export/import-export.controller';
import { ImportExportService } from './modules/import-export/import-export.service';
import { ImportExportRegistry } from './modules/import-export/registry';
import { ProductsController } from './modules/products/products.controller';
import { SearchController } from './modules/search/search.controller';
import { CommentsController } from './modules/comments/comments.controller';
import { CommentsService } from './modules/comments/comments.service';
import { DealsController } from './modules/deals/deals.controller';
import { LeadsController } from './modules/leads/leads.controller';
import { ActivitiesController } from './modules/activities/activities.controller';
import { ActivitiesService } from './modules/activities/activities.service';
import { ProjectsController } from './modules/projects/projects.controller';
import { TasksController } from './modules/tasks/tasks.controller';

export const loggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: env().NODE_ENV === 'test' ? 'silent' : env().LOG_LEVEL,
    transport:
      env().NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
    // Nunca registrar cookies, cabeceras de autenticación ni contraseñas.
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
      ],
      remove: true,
    },
    autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
  },
});

@Module({
  imports: [
    loggerModule,
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 600 }],
      // Las pruebas de integración inician sesión decenas de veces desde la misma IP.
      skipIf: () => env().NODE_ENV === 'test',
    }),
    InfraModule,
    CoreModule,
    DomainModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    TeamsController,
    RolesController,
    OrganizationController,
    CatalogsController,
    PipelinesController,
    CustomFieldsController,
    HistoryController,
    AuditController,
    NotificationsController,
    TrashController,
    CurrenciesController,
    ExchangeRatesController,
    ProductsController,
    CompaniesController,
    ContactsController,
    SearchController,
    ImportExportController,
    LeadsController,
    DealsController,
    CommentsController,
    ProjectsController,
    TasksController,
    ActivitiesController,
  ],
  providers: [
    AuthService,
    UsersService,
    RolesService,
    OrganizationService,
    CatalogsService,
    PipelinesService,
    ImportExportService,
    ImportExportRegistry,
    CommentsService,
    ActivitiesService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
