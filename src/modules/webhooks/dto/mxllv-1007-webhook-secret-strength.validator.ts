export type Mxllv1007SecretValidation =
  | { ok: true }
  | { ok: false; reason: 'too_short' | 'invalid_chars' | 'too_long' };

export const MXLLV_1007_SECRET_MIN_LENGTH = 16;
export const MXLLV_1007_SECRET_MAX_LENGTH = 256;
export const MXLLV_1007_SECRET_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Standalone helper for issue #1007: validate webhook secret strength/format for
 * create/update DTOs. Secrets are used for outbound HMAC signing and must not be
 * weak or malformed.
 */
export function mxllv1007ValidateWebhookSecret(
  secret: string,
): Mxllv1007SecretValidation {
  if (secret.length < MXLLV_1007_SECRET_MIN_LENGTH)
    return { ok: false, reason: 'too_short' };
  if (secret.length > MXLLV_1007_SECRET_MAX_LENGTH)
    return { ok: false, reason: 'too_long' };
  if (!MXLLV_1007_SECRET_PATTERN.test(secret))
    return { ok: false, reason: 'invalid_chars' };
  return { ok: true };
}

export function mxllv1007AssertWebhookSecret(secret: string): void {
  const result = mxllv1007ValidateWebhookSecret(secret);
  if (!result.ok) {
    throw new Error(`Invalid webhook secret: ${result.reason}`);
  }
}
