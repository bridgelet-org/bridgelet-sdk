import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SweepsService } from './sweeps.service.js';
import { ValidationProvider } from './providers/validation.provider.js';
import { Account } from '../accounts/entities/account.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Account])],
  providers: [SweepsService, ValidationProvider],
  exports: [SweepsService],
})
export class SweepsModule {}
