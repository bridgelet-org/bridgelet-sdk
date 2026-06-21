import encryptionConfig, { EncryptionConfig } from './encryption.config.js';

const loadConfig = encryptionConfig as unknown as () => EncryptionConfig;

describe('encryptionConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_ID;
    delete process.env.ENCRYPTION_KEYS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('requires ENCRYPTION_KEY', () => {
    expect(() => loadConfig()).toThrow('ENCRYPTION_KEY is required');
  });

  it('rejects keys that are not 32-byte hex strings', () => {
    process.env.ENCRYPTION_KEY = 'not-a-valid-key';

    expect(() => loadConfig()).toThrow(
      'Encryption key "primary" must be 32 bytes encoded as 64 hex characters',
    );
  });

  it('loads the current key with a default key id', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);

    expect(loadConfig()).toEqual({
      currentKeyId: 'primary',
      keys: {
        primary: 'a'.repeat(64),
      },
    });
  });

  it('loads additional rotation keys from ENCRYPTION_KEYS', () => {
    process.env.ENCRYPTION_KEY_ID = 'current';
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.ENCRYPTION_KEYS = JSON.stringify({
      previous: 'b'.repeat(64),
    });

    expect(loadConfig()).toEqual({
      currentKeyId: 'current',
      keys: {
        previous: 'b'.repeat(64),
        current: 'a'.repeat(64),
      },
    });
  });

  it('rejects malformed ENCRYPTION_KEYS JSON', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.ENCRYPTION_KEYS = '{';

    expect(() => loadConfig()).toThrow(
      'ENCRYPTION_KEYS must be a JSON object of keyId:hexKey',
    );
  });
});
