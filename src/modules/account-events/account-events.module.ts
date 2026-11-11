import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEvent } from './entities/account-event.entity.js';
import { AccountEventsProvider } from './providers/account-events.provider.js';

@Module({
  imports: [TypeOrmModule.forFeature([AccountEvent])],
  providers: [AccountEventsProvider],
  exports: [AccountEventsProvider],
})
export class AccountEventsModule {}
