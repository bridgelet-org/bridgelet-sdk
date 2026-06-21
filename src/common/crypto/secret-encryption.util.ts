import * as crypto from 'crypto';
import { EncryptionConfig } from '../../config/encryption.config.js';

/**
 * SecretEncryptionUtil
 *
 * Shared AES-256-GCM encryption utility for ephemeral account secret keys.
 * Used by AccountsService (encrypt on creation) and ClaimRedemptionProvider
 * (decrypt on claim redemption). Both must always use this single implementation
 * - never inline encrypt/decrypt logic elsewhere.
 *
 * Encrypted format (colon-separated strings):
 *   v1:keyId:ivHex:authTagHex:encryptedDataHex
 *
 * The IV is randomly generated per call - never reused.
 * The GCM auth tag detects any tampering with the ciphertext.
 *
 * Key requirements:
 * - Each key must be a 32-byte value provided as a 64-character hex string
 * - Sourced from environment configuration
 * - Keep prior keys in the configured keyring so old records decrypt after rotation
 */
export class SecretEncryptionUtil {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 16;
  private static readonly FORMAT_VERSION = 'v1';

  static encrypt(plaintext: string, config: EncryptionConfig): string {
    const keyId = config.currentKeyId;
    const key = SecretEncryptionUtil.parseKey(keyId, config.keys[keyId]);
    const iv = crypto.randomBytes(SecretEncryptionUtil.IV_LENGTH);
    const cipher = crypto.createCipheriv(
      SecretEncryptionUtil.ALGORITHM,
      key,
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      SecretEncryptionUtil.FORMAT_VERSION,
      keyId,
      iv.toString('hex'),
      authTag.toString('hex'),
      encrypted.toString('hex'),
    ].join(':');
  }

  static decrypt(encryptedString: string, config: EncryptionConfig): string {
    const parts = encryptedString.split(':');
    if (
      parts.length !== 5 ||
      parts[0] !== SecretEncryptionUtil.FORMAT_VERSION
    ) {
      throw new Error(
        'Invalid encrypted format. Expected v1:keyId:iv:authTag:encryptedData. ' +
          'Legacy base64 development records must be wiped and recreated.',
      );
    }
    const [, keyId, ivHex, authTagHex, dataHex] = parts;
    const key = SecretEncryptionUtil.parseKey(keyId, config.keys[keyId]);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(
      SecretEncryptionUtil.ALGORITHM,
      key,
      iv,
    );
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }

  private static parseKey(keyId: string, hexKey?: string): Buffer {
    if (!hexKey) {
      throw new Error(`Encryption key "${keyId}" is not configured`);
    }

    const key = Buffer.from(hexKey, 'hex');
    if (key.length !== 32) {
      throw new Error(
        `Encryption key "${keyId}" must be 32 bytes (64 hex characters). Got ${key.length} bytes. ` +
          "Generate a valid key with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    return key;
  }
}
