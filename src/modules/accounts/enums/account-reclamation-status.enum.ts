/**
 * Progress of the background job that reclaims a terminal ephemeral account
 * (issue #994).
 *
 * A row is selected for reclamation once its lifecycle status is CLAIMED or
 * EXPIRED. Each successful step advances the phase so an interrupted run can
 * resume without repeating on-chain work; the provider still re-reads Horizon
 * because a crash can happen after a transaction is submitted but before the
 * phase is persisted.
 */
export enum AccountReclamationStatus {
  PENDING = 'pending',
  REFUNDED = 'refunded',
  TRUSTLINE_REMOVED = 'trustline_removed',
  COMPLETED = 'completed',
}
