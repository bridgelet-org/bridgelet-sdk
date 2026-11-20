export interface Femaleotaku1013PaginationInput {
  limit?: number | string;
  offset?: number | string;
}

export interface Femaleotaku1013PaginationResult {
  limit: number;
  offset: number;
}

export const FEMALEOTAKU_1013_DEFAULT_LIMIT = 50;
export const FEMALEOTAKU_1013_MAX_LIMIT = 100;
export const FEMALEOTAKU_1013_MAX_OFFSET = 100000;

function parseIntStrict(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('INVALID_INTEGER');
    return value;
  }
  if (!/^-?\d+$/.test(value)) throw new Error('INVALID_INTEGER');
  return Number.parseInt(value, 10);
}

/**
 * Standalone helper for issue #1013: add pagination behavior for GET /webhooks
 * consistent with accounts listing (limit/offset normalization and bounds).
 */
export function femaleotaku1013NormalizeWebhookPagination(
  input: Femaleotaku1013PaginationInput,
): Femaleotaku1013PaginationResult {
  const rawLimit = parseIntStrict(input.limit);
  const rawOffset = parseIntStrict(input.offset);
  const limit = Math.min(
    FEMALEOTAKU_1013_MAX_LIMIT,
    Math.max(1, rawLimit ?? FEMALEOTAKU_1013_DEFAULT_LIMIT),
  );
  const offset = Math.min(
    FEMALEOTAKU_1013_MAX_OFFSET,
    Math.max(0, rawOffset ?? 0),
  );
  return { limit, offset };
}

export function femaleotaku1013ApplyPagination<T>(items: readonly T[], input: Femaleotaku1013PaginationInput) {
  const { limit, offset } = femaleotaku1013NormalizeWebhookPagination(input);
  return {
    webhooks: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}
