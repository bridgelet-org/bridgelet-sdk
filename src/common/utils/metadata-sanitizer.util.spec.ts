import { BadRequestException } from '@nestjs/common';
import {
  sanitizeMetadata,
  METADATA_MAX_BYTES,
  PROTOTYPE_POLLUTION_KEYS,
  SECRET_KEYS,
  PII_KEYS,
  DISALLOWED_KEYS,
  isDisallowedKey,
} from './metadata-sanitizer.util.js';

describe('sanitizeMetadata', () => {
  describe('Input validation & edge cases', () => {
    it('returns undefined for null input', () => {
      expect(sanitizeMetadata(null)).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
      expect(sanitizeMetadata(undefined)).toBeUndefined();
    });

    it('returns undefined for array input', () => {
      expect(sanitizeMetadata([] as any)).toBeUndefined();
    });

    it('passes through safe keys unchanged', () => {
      const result = sanitizeMetadata({ userId: 'u123', orderId: 'o456', tag: 'test' });
      expect(result).toEqual({ userId: 'u123', orderId: 'o456', tag: 'test' });
    });

    it('preserves array values in safe keys', () => {
      const result = sanitizeMetadata({ tags: ['alpha', 'beta'], counts: [1, 2, 3] });
      expect(result).toEqual({ tags: ['alpha', 'beta'], counts: [1, 2, 3] });
    });
  });

  describe('PII key sanitization', () => {
    it('strips top-level PII keys: email, phone', () => {
      const result = sanitizeMetadata({
        userId: 'u1',
        email: 'user@example.com',
        phone: '555-1234',
      });
      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('phone');
      expect(result).toHaveProperty('userId', 'u1');
    });

    it('strips PII keys case-insensitively (Email, PHONE)', () => {
      const result = sanitizeMetadata({ Email: 'x@y.com', PHONE: '1234' });
      expect(result).not.toHaveProperty('Email');
      expect(result).not.toHaveProperty('PHONE');
    });

    it.each(Array.from(PII_KEYS))('strips the PII key "%s"', (key) => {
      const result = sanitizeMetadata({ [key]: 'sensitive', safe: 'ok' });
      expect(result).not.toHaveProperty(key);
      expect(result).toHaveProperty('safe', 'ok');
    });

    it('returns an empty object when all keys are PII', () => {
      const result = sanitizeMetadata({ email: 'a@b.com', phone: '123' });
      expect(result).toEqual({});
    });
  });

  describe('Secret & credential key sanitization', () => {
    it.each(Array.from(SECRET_KEYS))('strips the secret/credential key "%s"', (key) => {
      const result = sanitizeMetadata({ [key]: 'super_secret_value', safeKey: 'valid' });
      expect(result).not.toHaveProperty(key);
      expect(result).toHaveProperty('safeKey', 'valid');
    });

    it('strips secret keys case-insensitively (Password, API_KEY, TOKEN)', () => {
      const result = sanitizeMetadata({
        Password: 'pass',
        API_KEY: 'sk_test_123',
        TOKEN: 'jwt_abc',
        safe: 123,
      });
      expect(result).not.toHaveProperty('Password');
      expect(result).not.toHaveProperty('API_KEY');
      expect(result).not.toHaveProperty('TOKEN');
      expect(result).toHaveProperty('safe', 123);
    });
  });

  describe('Prototype pollution protection', () => {
    it.each(Array.from(PROTOTYPE_POLLUTION_KEYS))(
      'strips prototype pollution key "%s"',
      (protoKey) => {
        const payload = JSON.parse(`{"${protoKey}": {"polluted": true}, "safe": "ok"}`);
        const result = sanitizeMetadata(payload);
        expect(Object.prototype.hasOwnProperty.call(result, protoKey)).toBe(false);
        expect(Object.keys(result!)).not.toContain(protoKey);
        expect(result).toHaveProperty('safe', 'ok');
        expect((Object.prototype as any).polluted).toBeUndefined();
      },
    );

    it('prevents prototype pollution via __proto__ assignment', () => {
      const payload = JSON.parse('{"__proto__": {"isAdmin": true}}');
      const result = sanitizeMetadata(payload);
      expect(result).toEqual({});
      expect((Object.prototype as any).isAdmin).toBeUndefined();
    });
  });

  describe('Nested metadata sanitization', () => {
    it('recursively strips PII and secret keys from nested objects', () => {
      const input = {
        app: 'store',
        user: {
          id: '123',
          email: 'hidden@example.com',
          password: 'secret_password',
          profile: {
            dob: '1990-01-01',
            nickname: 'hero',
          },
        },
      };

      const result = sanitizeMetadata(input);
      expect(result).toEqual({
        app: 'store',
        user: {
          id: '123',
          profile: {
            nickname: 'hero',
          },
        },
      });
    });

    it('recursively strips prototype pollution keys from nested objects', () => {
      const payload = JSON.parse(
        '{"nested": {"__proto__": {"injected": "dangerous"}, "ok": 1}}',
      );
      const result = sanitizeMetadata(payload);
      expect(result).toEqual({ nested: { ok: 1 } });
      expect((Object.prototype as any).injected).toBeUndefined();
    });
  });

  describe('Size limits and DoS protection', () => {
    it('throws BadRequestException when metadata exceeds METADATA_MAX_BYTES', () => {
      const large = { data: 'x'.repeat(METADATA_MAX_BYTES + 1) };
      expect(() => sanitizeMetadata(large)).toThrow(BadRequestException);
      expect(() => sanitizeMetadata(large)).toThrow(
        `metadata exceeds maximum allowed size of ${METADATA_MAX_BYTES} bytes`,
      );
    });

    it('accepts metadata exactly at the byte limit', () => {
      // Build a payload whose JSON serialisation is exactly METADATA_MAX_BYTES
      const value = 'x'.repeat(METADATA_MAX_BYTES - '{"data":""}'.length);
      const result = sanitizeMetadata({ data: value });
      expect(result).toHaveProperty('data');
    });

    it('correctly calculates byte size for multi-byte Unicode strings', () => {
      // Each emoji is 4 bytes in UTF-8
      const emojiCount = Math.floor(METADATA_MAX_BYTES / 4) + 10;
      const largeUnicode = { text: '🔥'.repeat(emojiCount) };
      expect(() => sanitizeMetadata(largeUnicode)).toThrow(BadRequestException);
    });
  });

  describe('isDisallowedKey helper', () => {
    it('identifies disallowed keys correctly', () => {
      expect(isDisallowedKey('email')).toBe(true);
      expect(isDisallowedKey('EMAIL')).toBe(true);
      expect(isDisallowedKey('password')).toBe(true);
      expect(isDisallowedKey('__proto__')).toBe(true);
      expect(isDisallowedKey('orderId')).toBe(false);
      expect(isDisallowedKey('tenant_id')).toBe(false);
    });
  });
});
