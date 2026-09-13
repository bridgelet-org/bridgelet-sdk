import {
  collectEnvProblems,
  formatEnvProblemReport,
  validateEnv,
} from './env-validation.js';
import { Keypair } from '@stellar/stellar-sdk';

// Generated per run. The checks below only care about the Stellar key formats,
// and a fixture is not worth a secret-shaped literal in the repository.
const FUNDING_KEYPAIR = Keypair.random();

/** A production environment with nothing wrong with it. */
const VALID_PRODUCTION_ENV = {
  NODE_ENV: 'production',
  DATABASE_HOST: 'db.internal',
  DATABASE_PORT: '5432',
  DATABASE_USER: 'bridgelet_user',
  DATABASE_PASSWORD: 'not-the-example-password',
  DATABASE_NAME: 'bridgelet',
  JWT_SECRET: 'a'.repeat(48),
  ENCRYPTION_KEY: 'b'.repeat(64),
  FUNDING_ACCOUNT_SECRET: FUNDING_KEYPAIR.secret(),
  RECOVERY_ACCOUNT_PUBLIC: FUNDING_KEYPAIR.publicKey(),
  EPHEMERAL_ACCOUNT_CONTRACT_ID:
    'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR',
  STELLAR_SWEEP_CONTROLLER_CONTRACT_ID:
    'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L',
  SWEEP_SIGNING_KEY_SEED: 'f'.repeat(64),
  CORS_ORIGINS: 'https://app.bridgelet.io',
};

const without = (name: string): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...VALID_PRODUCTION_ENV };
  delete copy[name];
  return copy;
};

describe('validateEnv', () => {
  it('returns the same config object when everything is valid', () => {
    const config = { ...VALID_PRODUCTION_ENV };
    expect(validateEnv(config)).toBe(config);
  });

  it('lists every missing variable at once rather than failing on the first', () => {
    const config = without('DATABASE_HOST');
    delete config.RECOVERY_ACCOUNT_PUBLIC;
    delete config.SWEEP_SIGNING_KEY_SEED;

    const problems = collectEnvProblems(config);

    expect(problems).toEqual([
      expect.stringContaining('DATABASE_HOST is required'),
      expect.stringContaining('RECOVERY_ACCOUNT_PUBLIC is required'),
      expect.stringContaining('SWEEP_SIGNING_KEY_SEED is required'),
    ]);
    expect(problems).toHaveLength(3);
  });

  it('names the count, the variables and where to look, in one message', () => {
    const config = without('DATABASE_PASSWORD');
    delete config.DATABASE_USER;

    expect(() => validateEnv(config)).toThrow(
      /Refusing to start: 2 environment problems\.[\s\S]*DATABASE_PASSWORD[\s\S]*DATABASE_USER[\s\S]*\.env\.example/,
    );
  });

  it('treats an empty string as missing', () => {
    const config = { ...VALID_PRODUCTION_ENV, DATABASE_NAME: '   ' };
    expect(collectEnvProblems(config)).toContainEqual(
      expect.stringContaining('DATABASE_NAME is required'),
    );
  });

  it('accepts the alternate sweep-controller variable name', () => {
    const config: Record<string, unknown> = {
      ...VALID_PRODUCTION_ENV,
      SWEEP_CONTROLLER_CONTRACT_ID:
        VALID_PRODUCTION_ENV.STELLAR_SWEEP_CONTROLLER_CONTRACT_ID,
    };
    delete config.STELLAR_SWEEP_CONTROLLER_CONTRACT_ID;

    expect(collectEnvProblems(config)).toEqual([]);
  });

  it('sorts its problems so the same input always reads the same way', () => {
    const config = without('DATABASE_USER');
    delete config.DATABASE_PASSWORD;
    delete config.CORS_ORIGINS;

    const problems = collectEnvProblems(config);
    expect(problems).toEqual([...problems].sort());
  });
});

describe('production-only rules', () => {
  it('leaves JWT_SECRET strength to the bootstrap guard in main.ts', () => {
    // assertSecretStrength() already refuses a weak secret before Nest exists.
    // This module must not become a second owner of the same rule, so a short
    // secret is not one of the problems reported here.
    const config = { ...VALID_PRODUCTION_ENV, JWT_SECRET: 'short-secret' };
    expect(
      collectEnvProblems(config).filter((p) => p.startsWith('JWT_SECRET')),
    ).toEqual([]);
  });

  it('rejects a placeholder JWT secret in production', () => {
    const config = {
      ...VALID_PRODUCTION_ENV,
      JWT_SECRET: 'your-super-secret-jwt-key-change-in-production',
    };
    expect(collectEnvProblems(config)).toContainEqual(
      'JWT_SECRET is still the example value from .env.example',
    );
  });

  it('rejects identifiers that are not valid Stellar keys', () => {
    const config = {
      ...VALID_PRODUCTION_ENV,
      FUNDING_ACCOUNT_SECRET: 'not-a-stellar-secret-seed',
      RECOVERY_ACCOUNT_PUBLIC: 'not-a-stellar-public-key',
      EPHEMERAL_ACCOUNT_CONTRACT_ID: 'not-a-contract-id',
    };

    const problems = collectEnvProblems(config);

    expect(problems).toContainEqual(
      'FUNDING_ACCOUNT_SECRET must be a Stellar secret seed (S...)',
    );
    expect(problems).toContainEqual(
      'RECOVERY_ACCOUNT_PUBLIC must be a Stellar public key (G...)',
    );
    expect(problems).toContainEqual(
      'EPHEMERAL_ACCOUNT_CONTRACT_ID must be a Soroban contract id (C...)',
    );
  });

  it("rejects CORS_ORIGINS='*'", () => {
    const config = { ...VALID_PRODUCTION_ENV, CORS_ORIGINS: '*' };
    expect(collectEnvProblems(config)).toContainEqual(
      "CORS_ORIGINS must not be '*' in production: list the origins that may call the API",
    );
  });

  it('rejects the example sweep signing seed, which is public', () => {
    const config = {
      ...VALID_PRODUCTION_ENV,
      SWEEP_SIGNING_KEY_SEED:
        'f76f684a3a8b64f32a7dc7eba0b0a5040ba66b5ea67dad348c3b69b79db3339c',
    };
    expect(collectEnvProblems(config)).toContainEqual(
      'SWEEP_SIGNING_KEY_SEED is still the example value from .env.example',
    );
  });
});

describe('rules that run in every environment', () => {
  const testEnv = {
    NODE_ENV: 'test',
    DATABASE_PORT: '5432',
    ENCRYPTION_KEY: 'a'.repeat(64),
  };

  it('leaves a correctly shaped non-production environment alone', () => {
    expect(validateEnv(testEnv)).toBe(testEnv);
  });

  it('rejects a malformed encryption key', () => {
    const config = { ...testEnv, ENCRYPTION_KEY: 'not-a-key' };
    expect(collectEnvProblems(config)).toContainEqual(
      expect.stringContaining(
        'ENCRYPTION_KEY must be 64 hexadecimal characters',
      ),
    );
  });

  it('rejects an encryption key still set to the example value', () => {
    const config = { ...testEnv, ENCRYPTION_KEY: 'your-64-char-hex-string' };
    expect(collectEnvProblems(config)).toContainEqual(
      'ENCRYPTION_KEY is still the example value from .env.example',
    );
  });

  it('rejects a non-numeric database port', () => {
    const config = { ...testEnv, DATABASE_PORT: 'five thousand' };
    expect(collectEnvProblems(config)).toContainEqual(
      'DATABASE_PORT must be a port number, got "five thousand"',
    );
  });

  it('rejects a port outside the valid range', () => {
    const config = { ...testEnv, PORT: '70000' };
    expect(collectEnvProblems(config)).toContainEqual(
      'PORT must be between 1 and 65535, got 70000',
    );
  });
});

describe('the e2e mocks stay bootable', () => {
  it('accepts the Stellar-shaped mocks the concurrency suite boots AppModule with', () => {
    const config = {
      NODE_ENV: 'test',
      DATABASE_HOST: '127.0.0.1',
      DATABASE_PORT: '5432',
      DATABASE_USER: 'postgres',
      DATABASE_PASSWORD: 'postgres',
      DATABASE_NAME: 'bridgelet_accounts_concurrency_test',
      JWT_SECRET: 'e2e-jwt-secret',
      ENCRYPTION_KEY: 'a'.repeat(64),
      FUNDING_ACCOUNT_SECRET: FUNDING_KEYPAIR.secret(),
      RECOVERY_ACCOUNT_PUBLIC:
        'GBMOCKRECOVERYACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      EPHEMERAL_ACCOUNT_CONTRACT_ID:
        'CONTRACT_EPHEMERAL_ACCOUNT_000000000000000000000000',
      SWEEP_CONTROLLER_CONTRACT_ID:
        'CONTRACT_SWEEP_CONTROLLER_0000000000000000000000',
      CORS_ORIGINS: '*',
    };

    expect(collectEnvProblems(config)).toEqual([]);
  });

  it('still reports a malformed value in that environment', () => {
    const config = { NODE_ENV: 'test', ENCRYPTION_KEY: 'a'.repeat(63) };
    expect(collectEnvProblems(config)).toEqual([
      'ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes), got 63',
    ]);
  });
});

describe('the report reaches the operator', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prints the report before throwing, because Nest logs an Error as {}', () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const config = without('DATABASE_HOST');

    expect(() => validateEnv(config)).toThrow(/DATABASE_HOST is required/);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[Bootstrap] FATAL: Refusing to start:'),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('DATABASE_HOST is required'),
    );
  });

  it('stays silent when the environment is valid', () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    validateEnv({ ...VALID_PRODUCTION_ENV });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('formatEnvProblemReport', () => {
  it('uses the singular for one problem', () => {
    expect(
      formatEnvProblemReport(['JWT_SECRET is required (signs JWTs)']),
    ).toBe(
      [
        'Refusing to start: 1 environment problem.',
        '  - JWT_SECRET is required (signs JWTs)',
        'See .env.example for the expected values and README.md for what each one does.',
      ].join('\n'),
    );
  });
});
