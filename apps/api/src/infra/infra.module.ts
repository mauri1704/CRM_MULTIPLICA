import { Global, Module } from '@nestjs/common';
import { Db } from './db';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [Db, MailService],
  exports: [Db, MailService],
})
export class InfraModule {}
