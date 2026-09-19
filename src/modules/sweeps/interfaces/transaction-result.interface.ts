/**
 * Result returned by TransactionProvider after submitting a transaction
 * to the Stellar Horizon REST API.
 *
 * ⚠️ HORIZON TYPE MISMATCH - READ BEFORE MODIFYING:
 * The Stellar Horizon API is a REST API that returns JSON. JSON has no
 * native integer type, so numeric fields like `ledger` are transmitted as
 * JSON numbers but in practice the Horizon SDK has returned them as
 * strings in certain SDK versions and response shapes.
 *
 * `ledger` is typed here as `number | string` to reflect that reality.
 * In TransactionProvider.executeSweepTransaction() the raw value from
 * `result.ledger` is explicitly coerced with `Number(result.ledger)` before
 * being stored here, so consumers of this interface always receive a number.
 * Do NOT remove that coercion thinking it is unnecessary - the SDK type
 * definition says `number` but the wire value can be a string.
 *
 * See: https://developers.stellar.org/api/horizon/resources/submit-a-transaction
 */
export interface TransactionResult {
  hash: string;
  ledger: number;
  successful: boolean;
  timestamp: Date;
  /**
   * Indicates whether the transaction result originated from a fee-bump transaction
   * (e.g., used to accelerate stuck sweeps during network congestion).
   * Populated for audit tracking and accounting reconciliation.
   */
  isFeeBump?: boolean;
  /**
   * Optional inner transaction hash if this result was fee-bumped.
   * Useful for audit tracking and correlating the original transaction envelope.
   */
  innerTransactionHash?: string;
}
