import { SecretEncryptionUtil } from './secret-encryption.util.js';
import * as crypto from 'crypto';

describe('SecretEncryptionUtil', () => {
  const validKey = crypto.randomBytes(32).toString('hex');
  const oldKey = crypto.randomBytes(32).toString('hex');
  const config = {
    currentKeyId: 'current',
    keys: {
      current: validKey,
      previous: oldKey,
    },
  };
  const plaintext = 'SCZANGBA5YHTNYVSKOP3SJ2CAANRL5ZVTTHLQPTU26HQZQVTYVKBMCR';

  describe('encrypt', () => {
    it('produces a versioned string with the current key id', () => {
      const result = SecretEncryptionUtil.encrypt(plaintext, config);
      expect(result.split(':')).toHaveLength(5);
      expect(result.startsWith('v1:current:')).toBe(true);
    });

    it('produces a different output each call due to random IV', () => {
      const first = SecretEncryptionUtil.encrypt(plaintext, config);
      const second = SecretEncryptionUtil.encrypt(plaintext, config);
      expect(first).not.toBe(second);
    });
  });

  describe('decrypt', () => {
    it('round-trips correctly', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, config);
      const decrypted = SecretEncryptionUtil.decrypt(encrypted, config);
      expect(decrypted).toBe(plaintext);
    });

    it('decrypts records encrypted with a previous key in the keyring', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, {
        ...config,
        currentKeyId: 'previous',
      });

      expect(SecretEncryptionUtil.decrypt(encrypted, config)).toBe(plaintext);
    });

    it('throws when the wrong key is used', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, config);
      const wrongConfig = {
        currentKeyId: 'current',
        keys: { current: crypto.randomBytes(32).toString('hex') },
      };
      expect(() =>
        SecretEncryptionUtil.decrypt(encrypted, wrongConfig),
      ).toThrow();
    });

    it('throws when the ciphertext is tampered with', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, config);
      const parts = encrypted.split(':');
      parts[4] = 'aabbccdd'; // corrupt the ciphertext
      expect(() =>
        SecretEncryptionUtil.decrypt(parts.join(':'), config),
      ).toThrow();
    });

    it('throws a descriptive error for legacy base64 format', () => {
      const base64Secret = Buffer.from(plaintext).toString('base64');
      expect(() => SecretEncryptionUtil.decrypt(base64Secret, config)).toThrow(
        'Invalid encrypted format',
      );
    });

    it('throws when an encrypted record references a missing key id', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, config);
      const missingKeyConfig = {
        currentKeyId: 'other',
        keys: { other: crypto.randomBytes(32).toString('hex') },
      };

      expect(() =>
        SecretEncryptionUtil.decrypt(encrypted, missingKeyConfig),
      ).toThrow('Encryption key "current" is not configured');
    });
  });

  describe('key validation', () => {
    it('throws when key is wrong length', () => {
      const shortKeyConfig = {
        currentKeyId: 'short',
        keys: { short: 'abc123' },
      };
      expect(() =>
        SecretEncryptionUtil.encrypt(plaintext, shortKeyConfig),
      ).toThrow('Encryption key "short" must be 32 bytes');
    });
  });
});
