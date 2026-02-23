/**
 * SweepExecutionRequest represents an internal domain command to execute a fund sweep.
 *
 * NOTE: This is NOT a transport DTO and should not be used at controller boundaries.
 * It is an internal orchestration contract (domain command). Validation is handled
 * by domain providers (e.g., ValidationProvider), not by class-validator.
 */
export interface SweepExecutionRequest {
  accountId: string;
  ephemeralPublicKey: string;
  ephemeralSecret: string;
  destinationAddress: string;
  amount: string;
  asset: string;
}
