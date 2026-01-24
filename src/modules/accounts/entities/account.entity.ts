import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum AccountStatus {
  PENDING_PAYMENT = 'pending_payment',
  PENDING_CLAIM = 'pending_claim',
  CLAIMED = 'claimed',
  EXPIRED = 'expired',
  FAILED = 'failed',
}

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 56, unique: true })
  @Index()
  publicKey: string;

  @Column({ type: 'text' })
  secretKeyEncrypted: string;

  @Column({ type: 'varchar', length: 56 })
  fundingSource: string;

  @Column({ type: 'decimal', precision: 18, scale: 7 })
  amount: string;

  @Column({ type: 'varchar', length: 100 })
  asset: string;

  @Column({
    type: 'enum',
    enum: AccountStatus,
    default: AccountStatus.PENDING_PAYMENT,
  })
  @Index()
  status: AccountStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  @Index()
  claimTokenHash: string;

  @Column({ type: 'varchar', length: 56, nullable: true })
  destinationAddress: string;

  @Column({ type: 'timestamp' })
  @Index()
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiredAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;
}
