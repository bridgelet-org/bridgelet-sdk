import { BadRequestException } from '@nestjs/common';

/**
 * Utilities for the classic Stellar asset strings used across the SDK
 * (`"native"`, `"XLM"` or `"CODE:ISSUER"`), the per-network issued-asset
 * allowlist, and amount precision checks.
 *
 * #991: issued assets (e.g. USDC) must be allowlisted per network, temporary
 * accounts need a trustline for them, payments must match both the asset code
 * and issuer, and issued-asset amounts are limited to 7 decimal places.
 */

export interface ParsedAsset {
  code: string;
  issuer?: string;
  isNative: boolean;
}

/** Stellar classic amounts have exactly 7 decimal places (stroops). */
export const ISSUED_ASSET_MAX_DECIMALS = 7;
export const STROOPS_PER_UNIT = 10_000_000n;

const ASSET_CODE_REGEX = /^[a-zA-Z0-9]{1,12}$/;
const AMOUNT_REGEX = /^\d+(\.\d+)?$/;

export function isNativeAsset(asset: string): boolean {
  return asset === 'native' || asset === 'XLM';
}

export function parseAsset(asset: string): ParsedAsset {
  if (isNativeAsset(asset)) {
    return { code: 'XLM', isNative: true };
  }

  const parts = asset.split(':');
  if (parts.length !== 2) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'INVALID_ASSET',
      code: 'INVALID_ASSET',
      message: `Invalid asset "${asset}". Expected "native" or "CODE:ISSUER".`,
    });
  }

  const [code, issuer] = parts;
  if (!ASSET_CODE_REGEX.test(code) || issuer.trim() === '') {
    throw new BadRequestException({
      statusCode: 400,
      error: 'INVALID_ASSET',
      code: 'INVALID_ASSET',
      message: `Invalid asset "${asset}". Expected "native" or "CODE:ISSUER".`,
    });
  }

  return { code, issuer, isNative: false };
}

/**
 * Parses the comma-separated `SUPPORTED_ASSETS` config value into asset
 * strings. Blank entries are ignored so a trailing comma is harmless.
 */
export function parseSupportedAssets(raw: readonly string[]): string[] {
  return raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

export function isAssetSupported(
  asset: string,
  supportedAssets: readonly string[],
): boolean {
  if (isNativeAsset(asset)) return true;

  const parsed = parseAsset(asset);
  return supportedAssets.some((entry) => {
    if (isNativeAsset(entry)) return false;
    try {
      const supported = parseAsset(entry);
      return (
        supported.code === parsed.code && supported.issuer === parsed.issuer
      );
    } catch {
      // A malformed allowlist entry cannot authorise anything.
      return false;
    }
  });
}

export function assertAssetSupported(
  asset: string,
  supportedAssets: readonly string[],
  network?: string,
): void {
  if (isAssetSupported(asset, supportedAssets)) return;

  const supported = parseSupportedAssets(supportedAssets);
  const networkLabel = network ? ` on ${network}` : '';
  throw new BadRequestException({
    statusCode: 400,
    error: 'UNSUPPORTED_ASSET',
    code: 'UNSUPPORTED_ASSET',
    message:
      `Asset ${asset} is not supported${networkLabel}. ` +
      (supported.length > 0
        ? `Supported assets: ${supported.join(', ')}.`
        : 'No issued assets are configured.'),
  });
}

/**
 * Ensures an issued-asset amount has at most 7 decimal places. XLM also uses 7
 * decimals on the wire, but the issue scopes this validation to issued assets;
 * callers apply it only when the asset is non-native.
 */
export function assertIssuedAssetAmountPrecision(amount: string): void {
  const trimmed = amount.trim();

  if (!AMOUNT_REGEX.test(trimmed)) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'INVALID_AMOUNT',
      code: 'INVALID_AMOUNT',
      message: 'Amount must be a positive decimal string.',
    });
  }

  const fraction = trimmed.split('.')[1] ?? '';
  if (fraction.length > ISSUED_ASSET_MAX_DECIMALS) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'INVALID_AMOUNT_PRECISION',
      code: 'INVALID_AMOUNT_PRECISION',
      message: `Amount must have at most ${ISSUED_ASSET_MAX_DECIMALS} decimal places.`,
    });
  }
}

/** Converts a decimal amount string to stroops without floating point. */
export function parseAmountToStroops(amount: string): bigint {
  const trimmed = amount.trim();
  if (!AMOUNT_REGEX.test(trimmed)) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  const [whole, fraction = ''] = trimmed.split('.');
  const paddedFraction = fraction
    .padEnd(ISSUED_ASSET_MAX_DECIMALS, '0')
    .slice(0, ISSUED_ASSET_MAX_DECIMALS);
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(paddedFraction);
}

export interface PaymentAssetFields {
  asset_type?: string | null;
  asset_code?: string | null;
  asset_issuer?: string | null;
}

/**
 * Returns true when a Horizon payment record's asset is exactly the asset the
 * account expects: native for `native`/`XLM`, otherwise both the code and the
 * issuer must match. This is what stops a look-alike "USDC" from a different
 * issuer being treated as funding.
 */
export function paymentMatchesAsset(
  accountAsset: string,
  payment: PaymentAssetFields,
): boolean {
  const parsed = parseAsset(accountAsset);

  if (parsed.isNative) {
    return payment.asset_type === 'native';
  }

  return (
    payment.asset_type !== 'native' &&
    payment.asset_code === parsed.code &&
    payment.asset_issuer === parsed.issuer
  );
}
