import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { AccountsModule } from './modules/accounts/accounts.module.js';
import databaseConfig from './config/database.config.js';
import stellarConfig from './config/stellar.config.js';
import appConfig from './config/app.config.js';
import { StellarModule } from './modules/stellar/stellar.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, stellarConfig, appConfig],
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: () => databaseConfig().database,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: parseInt(process.env.API_RATE_LIMIT || '100'),
      },
    ]),
    AccountsModule,
    // ClaimsModule,
    // SweepsModule,
    // WebhooksModule,
    StellarModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
