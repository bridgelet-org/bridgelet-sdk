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
      errors.push(${key} is missing);
    }
  }

  if (env.DATABASE_PORT && Number.isNaN(Number(env.DATABASE_PORT))) {
    errors.push('DATABASE_PORT must be a number');
  }

  if (env.ENCRYPTION_KEY && !/^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY)) {
    errors.push('ENCRYPTION_KEY must be a 64-character hex string');
  }

  // Production check: reject wildcard CORS
  if (env.NODE_ENV === 'production') {
    if (env.CORS_ORIGINS === '*' || env.CORS_ORIGINS?.trim() === '*') {
      errors.push('CORS_ORIGINS must not be wildcard (*) in production');
    }
  }

  // Non-test environment requirements
  if (env.NODE_ENV !== 'test') {
    // #811: createEphemeralAccount requires EPHEMERAL_ACCOUNT_WASM_HASH
    const wasmHash = env.EPHEMERAL_ACCOUNT_WASM_HASH;
    if (!wasmHash || wasmHash.trim() === '') {
      errors.push('EPHEMERAL_ACCOUNT_WASM_HASH is missing');
    } else if (!/^[0-9a-f]{64}$/.test(wasmHash.trim())) {
      errors.push(
        'EPHEMERAL_ACCOUNT_WASM_HASH must be a 64-character hex string',
      );
    }

    // #824: require SWEEP_CONTROLLER_CONTRACT_ID outside test
    const sweepController = env.SWEEP_CONTROLLER_CONTRACT_ID;
    if (!sweepController || sweepController.trim() === '') {
      errors.push('SWEEP_CONTROLLER_CONTRACT_ID is missing');
    } else if (!/^C[A-Z0-9]{55}$/.test(sweepController.trim())) {
      errors.push(
        'SWEEP_CONTROLLER_CONTRACT_ID must be a valid 56-character Stellar contract ID starting with C',
      );
    }

    // #824: require CLAIM_BASE_URL outside test and enforce no trailing slash
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

  if (errors.length > 0) {
    throw new Error(
      Invalid environment configuration:\n- ,
    );
  }
}