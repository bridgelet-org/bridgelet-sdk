import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AccountEventType =
  | 'created'
  | 'contract_deployed'
  | 'funded'
  | 'claim_started'
  | 'claimed'
  | 'claim_failed'
  | 'partial_sweep'
  | 'expired'
  | 'failed';

@Entity('account_events')
@Index('IDX_account_events_accountId_createdAt', ['accountId', 'createdAt'])
export class AccountEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  accountId: string;

  @Column({ type: 'varchar', length: 32 })
  type: AccountEventType;

  @Column({ type: 'varchar', length: 64, nullable: true })
  txHash: string | null;

  @Column({ type: 'jsonb', default: {} })
  details: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
