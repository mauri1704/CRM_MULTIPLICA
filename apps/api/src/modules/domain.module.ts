import { Module } from '@nestjs/common';
import { TeamsService } from './teams/teams.service';

/**
 * Servicios de dominio sin controladores: se cargan también en el worker para que registren sus
 * manejadores de papelera y la purga por retención los encuentre.
 */
@Module({
  providers: [TeamsService],
  exports: [TeamsService],
})
export class DomainModule {}
