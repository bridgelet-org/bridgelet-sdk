import { registerAs } from '@nestjs/config';

export interface EncryptionConfig {
  currentKeyId: string;
  keys: Record<string, string>;
}

const HEX_32_BYTE_KEY = /^[0-9a-fA-F]{64}$/;

function assertValidKey(keyId: string, key: string): void {
  if (!HEX_32_BYTE_KEY.test(key)) {
    throw new Error(
      `Encryption key "${keyId}" must be 32 bytes encoded as 64 hex characters`,
    );
  }
}

function parseAdditionalKeys(): Record<string, string> {
  const rawKeys = process.env.ENCRYPTION_KEYS;
  if (!rawKeys) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    throw new Error('ENCRYPTION_KEYS must be a JSON object of keyId:hexKey');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ENCRYPTION_KEYS must be a JSON object of keyId:hexKey');
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([keyId, value]) => {
      if (typeof value !== 'string') {
        throw new Error(`Encryption key "${keyId}" must be a string`);
      }
      assertValidKey(keyId, value);
      return [keyId, value];
    }),
  );
}

export default registerAs('encryption', (): EncryptionConfig => {
  const currentKey = process.env.ENCRYPTION_KEY;
  if (!currentKey) {
    throw new Error('ENCRYPTION_KEY is required');
  }

  const currentKeyId = process.env.ENCRYPTION_KEY_ID || 'primary';
  assertValidKey(currentKeyId, currentKey);

  return {
    currentKeyId,
    keys: {
      ...parseAdditionalKeys(),
      [currentKeyId]: currentKey,
    },
  };
});
