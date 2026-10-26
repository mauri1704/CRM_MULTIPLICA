import { Module } from '@nestjs/common';
import { InfraModule } from './infra/infra.module';
import { CoreModule } from './modules/core.module';
import { DomainModule } from './modules/domain.module';

@Module({ imports: [InfraModule, CoreModule, DomainModule] })
export class WorkerModule {}
