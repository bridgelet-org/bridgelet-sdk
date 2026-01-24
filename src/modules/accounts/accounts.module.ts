import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { Account } from './entities/account.entity.js';
import { StellarModule } from '../stellar/stellar.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('app.jwtSecret'),
        signOptions: {
          // To add default sign options here latter
        },
      }),
      inject: [ConfigService],
    }),
    StellarModule,
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
