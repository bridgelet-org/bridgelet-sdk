/**
 * Fails startup fast with one clear error listing every missing/invalid
 * required env var, instead of failing confusingly deep in a request
 * handler. Call from main.ts before the Nest app is created.
 */
const REQUIRED_VARS = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'STELLAR_NETWORK',
  'STELLAR_HORIZON_URL',
  'STELLAR_SOROBAN_RPC_URL',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
];

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];

  for (const key of REQUIRED_VARS) {
    if (!env[key] || env[key]?.trim() === '') {
      errors.push(`${key} is missing`);
    }
  }

  if (env.DATABASE_PORT && Number.isNaN(Number(env.DATABASE_PORT))) {
    errors.push('DATABASE_PORT must be a number');
  }

  if (env.ENCRYPTION_KEY && !/^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY)) {
    errors.push('ENCRYPTION_KEY must be a 64-character hex string');
  }

  // #811: createEphemeralAccount deploys a contract instance per account from
  // this hash, so it must be present outside tests. Skipped under
  // NODE_ENV=test so unit tests can boot without a live network.
  //
  // #824: the same non-test gate now also covers the sweep controller id and
  // the claim base URL. Both used to fail late and confusingly: a missing
  // controller id only surfaced when the first sweep was rejected on chain,
  // and a missing claim base URL silently fell back to
  // https://claim.bridgelet.io, which produced claim links pointing at the
  // wrong host when running locally.
  if (env.NODE_ENV !== 'test') {
    const wasmHash = env.EPHEMERAL_ACCOUNT_WASM_HASH;
    if (!wasmHash || wasmHash.trim() === '') {
      errors.push('EPHEMERAL_ACCOUNT_WASM_HASH is missing');
    } else if (!/^[0-9a-f]{64}$/.test(wasmHash.trim())) {
      errors.push(
        'EPHEMERAL_ACCOUNT_WASM_HASH must be a 64-character hex string',
      );
    }

    const controllerId = env.SWEEP_CONTROLLER_CONTRACT_ID;
    if (!controllerId || controllerId.trim() === '') {
      errors.push('SWEEP_CONTROLLER_CONTRACT_ID is missing');
    }

    const claimBaseUrl = env.CLAIM_BASE_URL;
    if (!claimBaseUrl || claimBaseUrl.trim() === '') {
      errors.push('CLAIM_BASE_URL is missing');
    } else {
      const trimmed = claimBaseUrl.trim();
      if (trimmed.endsWith('/')) {
        errors.push('CLAIM_BASE_URL must not have a trailing slash');
      } else {
        try {
          const parsed = new URL(trimmed);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            errors.push('CLAIM_BASE_URL must be a valid http or https URL');
          }
        } catch {
          errors.push('CLAIM_BASE_URL must be a valid http or https URL');
        }
      }
    }
  }

  // #824: app.config.ts reads `CORS_ORIGINS?.split(',') || '*'`, so an unset
  // variable is indistinguishable from an explicit '*' — both let any origin
  // call the API. Production has to name its origins.
  if (env.NODE_ENV === 'production') {
    const origins = (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== '');

    if (origins.length === 0 || origins.includes('*')) {
      errors.push(
        'CORS_ORIGINS must list explicit origins in production; "*" (or unset) is not allowed',
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n- ${errors.join('\n- ')}`,
    );
  }
}
