/**
 * Standalone helper for issue #1006: audit CLAIM_TOKEN_EXPIRY default (30 days)
 * against ephemeral-account expiry semantics.
 *
 * Claim JWTs can outlive account expiresAt/expiry_ledger if configured longer.
 * Redemption/verification must explicitly reject tokens for accounts already
 * expired rather than relying on downstream 404s.
 */

export const ENIOLAAGORO7_1006_DEFAULT_CLAIM_TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 2592000

export interface Eniolaagoro7_1006AccountExpiryState {
  accountId: string;
  accountExpiresAt: Date | string | null;
  accountStatus?: string;
  claimTokenExp?: number; // unix seconds from JWT exp claim, if known
}

export type Eniolaagoro7_1006Decision =
  | { allow: true }
  | { allow: false; reason: 'account_expired' | 'account_missing' | 'claim_token_expired' };

export function eniolaagoro7_1006IsAccountExpired(
  accountExpiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!accountExpiresAt) return false;
  const ts = typeof accountExpiresAt === 'string' ? new Date(accountExpiresAt) : accountExpiresAt;
  if (Number.isNaN(ts.getTime())) return false;
  return ts.getTime() <= now.getTime();
}

export function eniolaagoro7_1006EvaluateClaimEligibility(
  state: Eniolaagoro7_1006AccountExpiryState,
  now: Date = new Date(),
): Eniolaagoro7_1006Decision {
  if (state.claimTokenExp !== undefined && state.claimTokenExp * 1000 <= now.getTime()) {
    return { allow: false, reason: 'claim_token_expired' };
  }
  if (eniolaagoro7_1006IsAccountExpired(state.accountExpiresAt, now)) {
    return { allow: false, reason: 'account_expired' };
  }
  if (state.accountStatus === 'expired' || state.accountStatus === 'EXPIRED') {
    return { allow: false, reason: 'account_expired' };
  }
  return { allow: true };
}

export function eniolaagoro7_1006AuditNotes(): string[] {
  return [
    `Default CLAIM_TOKEN_EXPIRY is ${ENIOLAAGORO7_1006_DEFAULT_CLAIM_TOKEN_EXPIRY_SECONDS}s (30 days), which may exceed ephemeral account lifetime.`,
    'TokenVerificationProvider/ClaimsService should reject redemption when account is expired even if JWT signature/exp is still valid.',
    'Return an explicit expired-account rejection (not downstream 404) so clients can distinguish expired claims from unknown tokens.',
  ];
}
