/**
 * Standalone spec for issue #1004: define and test metadata sanitizer
 * disallowed-key/size limits and rules.
 */
const METADATA_MAX_BYTES = 4096;
const METADATA_MAX_KEYS = 32;
const METADATA_MAX_DEPTH = 3;
const METADATA_MAX_KEY_LENGTH = 64;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PII_KEYS = new Set(['email', 'phone', 'phonenumber', 'mobile', 'ssn', 'dob', 'dateofbirth', 'address', 'fullname', 'firstname', 'lastname', 'name', 'nationalid', 'passport', 'taxid']);

function byteSize(obj: unknown): number {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function sanitize(value: unknown, depth = 1): unknown {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object') return undefined; // function/symbol/undefined/bigint in effect
  if (depth > METADATA_MAX_DEPTH) return Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1)).filter((v) => v !== undefined);
  if (!isPlainObject(value)) return undefined;
  if (typeof (value as any).toJSON === 'function') return undefined;
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (kept >= METADATA_MAX_KEYS) break;
    if (DANGEROUS_KEYS.has(k)) continue;
    if (k.length > METADATA_MAX_KEY_LENGTH) continue;
    if (PII_KEYS.has(k.toLowerCase())) continue;
    const clean = sanitize(v, depth + 1);
    if (clean !== undefined) {
      out[k] = clean;
      kept += 1;
    }
  }
  return out;
}

function sanitizeMetadata(metadata: Record<string, unknown>) {
  if (byteSize(metadata) > METADATA_MAX_BYTES) throw new Error('METADATA_TOO_LARGE');
  return sanitize(metadata, 1) as Record<string, unknown>;
}

describe('eniolaagoro7-1004 metadata sanitizer rules (standalone)', () => {
  it('enforces max serialized size (DoS guard)', () => {
    expect(() => sanitizeMetadata({ blob: 'x'.repeat(METADATA_MAX_BYTES + 10) })).toThrow('METADATA_TOO_LARGE');
  });

  it('drops prototype-pollution keys and preserves safe keys', () => {
    const input: any = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":1,"safe":"ok"}');
    const out = sanitizeMetadata(input);
    expect(out).toEqual({ safe: 'ok' });
    expect(({} as any).polluted).toBeUndefined();
  });

  it('strips PII-like keys case-insensitively and secrets should not be stored in metadata', () => {
    const out = sanitizeMetadata({ Email: 'a@b.com', phone: '123', integration_id: 'i1', nested: { SSN: '000' } });
    expect(out).toEqual({ integration_id: 'i1', nested: {} });
  });

  it('drops non-JSON/unsafe values and enforces depth/key budgets', () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < METADATA_MAX_KEYS + 5; i += 1) many[`k${i}`] = i;
    const deep = { a: { b: { c: { d: 1 } } } };
    const outMany = sanitizeMetadata(many);
    expect(Object.keys(outMany).length).toBeLessThanOrEqual(METADATA_MAX_KEYS);
    const outDeep = sanitizeMetadata(deep as any);
    expect(outDeep).toEqual({ a: { b: { c: {} } } });
  });

  it('drops NaN/Infinity/functions/symbol-like non-scalars by rule', () => {
    const out = sanitizeMetadata({ n: NaN, i: Infinity, ok: 1 } as any);
    expect(out).toEqual({ ok: 1 });
  });
});
