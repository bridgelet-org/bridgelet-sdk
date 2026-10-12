/**
 * #824: rules that a real deployment must satisfy but a unit test must not.
 * Every rule here has a passing and a failing case, so a future change to
 * validateEnv() has to keep both sides honest.
 */
const baseValidEnv: NodeJS.ProcessEnv = {
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'bridgelet',
  DATABASE_USER: 'postgres',
  DATABASE_PASSWORD: 'password',
  STELLAR_NETWORK: 'testnet',
  STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  STELLAR_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  JWT_SECRET: 'test-jwt-secret',
  ENCRYPTION_KEY: 'a'.repeat(64),
  EPHEMERAL_ACCOUNT_WASM_HASH: 'b'.repeat(64),
  SWEEP_CONTROLLER_CONTRACT_ID: 'C'.repeat(56),
  CLAIM_BASE_URL: 'https://claim.example.com',
};

describe('validateEnv - CORS_ORIGINS in production (#824)', () => {
  it('refuses a wildcard origin when NODE_ENV=production', async () => {
    const { validateEnv } = await import('./env-validation.js');
    expect(() =>
      validateEnv({
        ...baseValidEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: '*',
      }),
    ).toThrow("CORS_ORIGINS must not include '*' when NODE_ENV=production");
  });

  it('refuses a wildcard hidden inside a list', async () => {
    const { validateEnv } = await import('./env-validation.js');
    expect(() =>
      validateEnv({
        ...baseValidEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com, *',
      }),
    ).toThrow("CORS_ORIGINS must not include '*' when NODE_ENV=production");
  });

  it('refuses an unset CORS_ORIGINS when NODE_ENV=production', async () => {
    const { validateEnv } = await import('./env-validation.js');
    expect(() =>
      validateEnv({
        ...baseValidEnv,
        NODE_ENV: 'production',
      }),
    ).toThrow('CORS_ORIGINS is missing');
  });

  it('accepts an explicit origin list in production', async () => {
    const { validateEnv } = await import('./env-validation.js');
    expect(() =>
      validateEnv({
        ...baseValidEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com,https://admin.example.com',
      }),
    ).not.toThrow();
  });

  it('still allows the wildcard outside production', async () => {
    const { validateEnv } = await import('./env-validation.js');
    expect(() =>
      validateEnv({
        ...baseValidEnv,
        NODE_ENV: 'development',
        CORS_ORIGINS: '*',
      }),
    ).not.toThrow();
  });
});

describe('validateEnv - SWEEP_CONTROLLER_CONTRACT_ID (#824)', () => {
  it('refuses to start without it outside tests', async () => {
    const { validateEnv } = await import('./env-validation.js');
    for (const NODE_ENV of ['development', 'production']) {
      expect(() =>
        validateEnv({
          ...baseValidEnv,
          NODE_ENV,
          CORS_ORIGINS: 'https://app.example.com',
          SWEEP_CONTROLLER_CONTRACT_ID: undefined,
        }),
      ).toThrow('SWEEP_CONTROLLER_CONTRACT_ID is missing');
    }
  });

  it('still boots NODE_ENV=test without it', async () => {
    const { validateEnv } = await import('./env-validation.js');
    expect(() =>
      validateEnv({
        ...baseValidEnv,
        NODE_ENV: 'test',
        SWEEP_CONTROLLER_CONTRACT_ID: undefined,
      }),
    ).not.toThrow();
  });

  it('accepts a present value', async () => {
    const { validateEnv } = await import('./env-validation.js');
    expect(() =>
      validateEnv({ ...baseValidEnv, NODE_ENV: 'development' }),
    ).not.toThrow();
  });
});

describe('validateEnv - CLAIM_BASE_URL outside production (#824)', () => {
  it('refuses a trailing slash outside tests too', async () => {
    const { validateEnv } = await import('./env-validation.js');
    for (const NODE_ENV of ['development', 'production']) {
      expect(() =>
        validateEnv({
          ...baseValidEnv,
          NODE_ENV,
          CORS_ORIGINS: 'https://app.example.com',
          CLAIM_BASE_URL: 'http://localhost:3000/',
        }),
      ).toThrow('CLAIM_BASE_URL must not have a trailing slash');
    }
  });

  it('accepts a demo instance pointing at its own host', async () => {
    const { validateEnv } = await import('./env-validation.js');
    expect(() =>
      validateEnv({
        ...baseValidEnv,
        NODE_ENV: 'development',
        CLAIM_BASE_URL: 'http://localhost:3000',
      }),
    ).not.toThrow();
  });

  it('treats a blank value as missing', async () => {
    const { validateEnv } = await import('./env-validation.js');
    expect(() =>
      validateEnv({
        ...baseValidEnv,
        NODE_ENV: 'development',
        CLAIM_BASE_URL: '   ',
      }),
    ).toThrow('CLAIM_BASE_URL is missing');
  });
});
