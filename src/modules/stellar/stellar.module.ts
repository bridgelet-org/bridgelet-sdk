import { Module } from '@nestjs/common';
import { StellarService } from './stellar.service.js';

@Module({
  providers: [StellarService],
  exports: [StellarService],
})
export class StellarModule {}
