import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity.js';

@Entity('claims')
// @Index(['accountId'])
export class Claim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  accountId: string;

  @ManyToOne(() => Account, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column({ type: 'varchar', length: 56 })
  destinationAddress: string;

  @Column({ type: 'varchar', length: 64 })
  sweepTxHash: string;

  @Column({ type: 'varchar', length: 100 })
  amountSwept: string;

  @Column({ type: 'varchar', length: 100 })
  asset: string;

  @Column({ type: 'timestamp' })
  claimedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
