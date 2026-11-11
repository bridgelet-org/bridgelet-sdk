const SENSITIVE_KEY_PARTS = new Set([
  'address',
  'authorization',
  'claimurl',
  'destination',
  'fundingsource',
  'ip',
  'issuer',
  'password',
  'private',
  'publickey',
  'secret',
  'signature',
  'token',
]);

const STELLAR_ADDRESS_PATTERN = /\b[GSC][A-Z2-7]{55}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function keyParts(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function isSensitiveKey(key: string): boolean {
  return keyParts(key).some((part) => SENSITIVE_KEY_PARTS.has(part));
}

function sanitizeString(value: string): string {
  return value
    .replace(STELLAR_ADDRESS_PATTERN, '[redacted]')
    .replace(JWT_PATTERN, '[redacted]')
    .replace(IPV4_PATTERN, '[redacted]');
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? '[redacted]' : sanitizeValue(child);
    }
    return result;
  }

  return value;
}

export function sanitizeAccountEventDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!details) return {};

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    result[key] = isSensitiveKey(key) ? '[redacted]' : sanitizeValue(value);
  }
  return result;
}
