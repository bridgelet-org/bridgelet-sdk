import { validateEnv } from './env-validation';

describe('validateEnv', () => {
  const baseValidEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_HOST: 'localhost',
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'bridgelet_test',
    DATABASE_USER: 'test_user',
    DATABASE_PASSWORD: 'test_password',
    STELLAR_NETWORK: 'testnet',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    STELLAR_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    JWT_SECRET: 'test_secret_32_characters_minimum_len',
    ENCRYPTION_KEY: 'a'.repeat(64),
  };

  it('passes when valid in test environment', () => {
    expect(() => validateEnv(baseValidEnv)).not.toThrow();
  });

  it('fails if required basic variables are missing', () => {
    const invalid = { ...baseValidEnv, DATABASE_HOST: '' };
    expect(() => validateEnv(invalid)).toThrow(/DATABASE_HOST is missing/);
  });

  describe('production CORS validation', () => {
    it('rejects CORS_ORIGINS=* in production', () => {
      const env = {
        ...baseValidEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: '*',
        EPHEMERAL_ACCOUNT_WASM_HASH: 'b'.repeat(64),
        SWEEP_CONTROLLER_CONTRACT_ID: 'CA3D5KRYM6GYKAOWBZ75QHSQZSZEXLNRD4QMSI6LQI4TZQTHDV5BGY7V',
        CLAIM_BASE_URL: 'https://claim.bridgelet.io',
      };
      expect(() => validateEnv(env)).toThrow(/CORS_ORIGINS must not be wildcard/);
    });

    it('allows explicit origins in production', () => {
      const env = {
        ...baseValidEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.bridgelet.org,https://bridgelet.io',
        EPHEMERAL_ACCOUNT_WASM_HASH: 'b'.repeat(64),
        SWEEP_CONTROLLER_CONTRACT_ID: 'CA3D5KRYM6GYKAOWBZ75QHSQZSZEXLNRD4QMSI6LQI4TZQTHDV5BGY7V',
        CLAIM_BASE_URL: 'https://claim.bridgelet.io',
      };
      expect(() => validateEnv(env)).not.toThrow();
    });
  });

  describe('non-test environment validation (development / production)', () => {
    it('requires SWEEP_CONTROLLER_CONTRACT_ID outside test', () => {
      const env = {
        ...baseValidEnv,
        NODE_ENV: 'development',
        EPHEMERAL_ACCOUNT_WASM_HASH: 'b'.repeat(64),
        CLAIM_BASE_URL: 'http://localhost:3000',
        SWEEP_CONTROLLER_CONTRACT_ID: '',
      };
      expect(() => validateEnv(env)).toThrow(/SWEEP_CONTROLLER_CONTRACT_ID is missing/);
    });

    it('rejects invalid SWEEP_CONTROLLER_CONTRACT_ID format', () => {
      const env = {
        ...baseValidEnv,
        NODE_ENV: 'development',
        EPHEMERAL_ACCOUNT_WASM_HASH: 'b'.repeat(64),
        CLAIM_BASE_URL: 'http://localhost:3000',
        SWEEP_CONTROLLER_CONTRACT_ID: 'invalid_contract_id',
      };
      expect(() => validateEnv(env)).toThrow(/SWEEP_CONTROLLER_CONTRACT_ID must be a valid 56-character/);
    });

    it('requires CLAIM_BASE_URL without trailing slash outside test', () => {
      const envWithSlash = {
        ...baseValidEnv,
        NODE_ENV: 'development',
        EPHEMERAL_ACCOUNT_WASM_HASH: 'b'.repeat(64),
        SWEEP_CONTROLLER_CONTRACT_ID: 'CA3D5KRYM6GYKAOWBZ75QHSQZSZEXLNRD4QMSI6LQI4TZQTHDV5BGY7V',
        CLAIM_BASE_URL: 'http://localhost:3000/',
      };
      expect(() => validateEnv(envWithSlash)).toThrow(/CLAIM_BASE_URL must not have a trailing slash/);
    });

    it('passes when development env is completely configured', () => {
      const env = {
        ...baseValidEnv,
        NODE_ENV: 'development',
        EPHEMERAL_ACCOUNT_WASM_HASH: 'b'.repeat(64),
        SWEEP_CONTROLLER_CONTRACT_ID: 'CA3D5KRYM6GYKAOWBZ75QHSQZSZEXLNRD4QMSI6LQI4TZQTHDV5BGY7V',
        CLAIM_BASE_URL: 'http://localhost:3000',
      };
      expect(() => validateEnv(env)).not.toThrow();
    });
  });
});