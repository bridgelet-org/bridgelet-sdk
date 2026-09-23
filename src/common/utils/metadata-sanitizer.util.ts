import { BadRequestException } from '@nestjs/common';

/** Maximum allowed serialised size of metadata (4 KB). */
export const METADATA_MAX_BYTES = 4096;

/**
 * Keys that could lead to prototype pollution vulnerabilities if persisted or merged.
 * These keys are strictly disallowed and stripped.
 */
export const PROTOTYPE_POLLUTION_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Keys containing authentication secrets, private keys, or API tokens that should
 * never be stored in free-form metadata fields.
 */
export const SECRET_KEYS = new Set([
  'password',
  'secret',
  'secretkey',
  'secret_key',
  'privatekey',
  'private_key',
  'token',
  'apikey',
  'api_key',
  'auth_token',
  'authtoken',
  'access_token',
  'accesstoken',
  'refreshtoken',
  'refresh_token',
  'seed_phrase',
  'seedphrase',
  'mnemonic',
  'credential',
  'credentials',
]);

/**
 * Keys whose values may contain Personally Identifiable Information (PII)
 * and should be stripped before storage to comply with data privacy policies.
 * All comparisons are case-insensitive.
 */
export const PII_KEYS = new Set([
  'email',
  'phone',
  'phonenumber',
  'mobile',
  'ssn',
  'dob',
  'dateofbirth',
  'address',
  'fullname',
  'firstname',
  'lastname',
  'name',
  'nationalid',
  'passport',
  'taxid',
]);

/**
 * Comprehensive set of all disallowed keys (PII + Secrets + Prototype Pollution).
 */
export const DISALLOWED_KEYS = new Set([
  ...PII_KEYS,
  ...SECRET_KEYS,
  ...PROTOTYPE_POLLUTION_KEYS,
]);

/**
 * Helper to determine if a key is disallowed (case-insensitive).
 */
export function isDisallowedKey(key: string): boolean {
  return DISALLOWED_KEYS.has(key.toLowerCase());
}

/**
 * Validates that metadata does not exceed METADATA_MAX_BYTES when serialised,
 * then strips any keys that match prototype pollution, secrets, or PII.
 * Sanitization recursively traverses nested plain objects while preserving arrays
 * and primitive values.
 *
 * @param metadata - Free-form key-value dictionary to sanitize.
 * @throws BadRequestException when serialised metadata exceeds METADATA_MAX_BYTES.
 * @returns A sanitised copy with sensitive and unsafe keys removed (or undefined if input is falsy).
 */
export function sanitizeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const serialised = JSON.stringify(metadata);
  if (!serialised || Buffer.byteLength(serialised, 'utf8') > METADATA_MAX_BYTES) {
    throw new BadRequestException(
      `metadata exceeds maximum allowed size of ${METADATA_MAX_BYTES} bytes`,
    );
  }

  function cleanObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sanitised: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (DISALLOWED_KEYS.has(lowerKey)) {
        continue;
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitised[key] = cleanObject(value as Record<string, unknown>);
      } else {
        sanitised[key] = value;
      }
    }
    return sanitised;
  }

  return cleanObject(metadata);
}
