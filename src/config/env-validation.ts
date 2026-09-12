import { StrKey } from '@stellar/stellar-sdk';

/**
 * Startup validation for required environment variables (issue #540).
 *
 * Every value below previously had a silent fallback in its config factory --
 * `process.env.DATABASE_PORT ?? '5432'`, `process.env.JWT_SECRET ??
 * 'change-me-in-production'`, and so on -- so a deployment missing a variable
 * did not fail at boot. It failed later, in the first request that needed it,
 * with an error that named a library rather than the variable. Wiring this into
 * `ConfigModule.forRoot({ validate })` makes Nest call it with the merged
 * environment before the container is built, so a misconfigured deployment dies
 * with one message that lists **every** problem at once.
 *
 * The rules come in two groups on purpose:
 *
 * 1. `PRESENT_VALUE_RULES` run in every environment, and only on variables that
 *    are actually set. They cover values whose shape is unambiguous and whose
 *    example value is never acceptable: a port that is not a number, an
 *    encryption key that is not 64 hex characters, a secret still set to the
 *    string published in `.env.example`.
 * 2. `REQUIRED_IN_PRODUCTION` adds presence and format checks when
 *    `NODE_ENV === 'production'`. The e2e suites boot the real `AppModule`
 *    with deliberate mock identifiers and no database or JWT variables at all
 *    (`test/accounts-concurrency.e2e-spec.ts` sets
 *    `RECOVERY_ACCOUNT_PUBLIC=GBMOCKRECOVERYACCOUNT...`, `test/app.e2e-spec.ts`
 *    sets none), so a rule set that fired everywhere would have to accept the
 *    mocks -- which is the opposite of the point.
 *
 * Adding a variable: put it in `REQUIRED_IN_PRODUCTION` if the service cannot
 * serve a single request without it, and give it a `check` when a wrong value
 * is worse than a missing one. JWT_SECRET is the exception: the example
 * placeholder is rejected here, but its strength stays with the bootstrap guard
 * in main.ts, which runs before Nest exists.
 */

export type EnvRecord = Record<string, unknown>;

interface EnvRule {
  /** Canonical name, used in the message even when an alias supplied the value. */
  name: string;
  /** Accepted alternative names for the same value. */
  aliases?: readonly string[];
  /** Why the variable is required, printed with the failure. */
  why: string;
  /** Returns a problem description, or null when the value is acceptable. */
  check?: (value: string) => string | null;
}

/**
 * Values published in `.env.example`. They are documentation, not defaults:
 * anything still holding one is misconfigured, and for a secret it is worse
 * than empty because it looks intentional.
 */
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  'your-super-secret-jwt-key-change-in-production',
  'your-64-char-hex-string',
  '64_char_hex_string_here',
  'change-me-in-production',
  // The example seed shipped in .env.example. It is public, so it must not be
  // used to sign anything.
  'f76f684a3a8b64f32a7dc7eba0b0a5040ba66b5ea67dad348c3b69b79db3339c',
]);

const isPlaceholder = (value: string): boolean =>
  PLACEHOLDERS.has(value.trim());

const portProblem = (value: string): string | null => {
  if (!/^\d+$/.test(value.trim())) {
    return `must be a port number, got "${value}"`;
  }
  const port = Number(value);
  return port >= 1 && port <= 65535
    ? null
    : `must be between 1 and 65535, got ${port}`;
};

const hexKeyProblem = (value: string): string | null => {
  if (isPlaceholder(value)) {
    return 'is still the example value from .env.example';
  }
  return /^[0-9a-fA-F]{64}$/.test(value.trim())
    ? null
    : `must be 64 hexadecimal characters (32 bytes), got ${value.trim().length}`;
};

const secretSeedProblem = (value: string): string | null =>
  StrKey.isValidEd25519SecretSeed(value.trim())
    ? null
    : 'must be a Stellar secret seed (S...)';

const publicKeyProblem = (value: string): string | null =>
  StrKey.isValidEd25519PublicKey(value.trim())
    ? null
    : 'must be a Stellar public key (G...)';

const contractIdProblem = (value: string): string | null =>
  StrKey.isValidContract(value.trim())
    ? null
    : 'must be a Soroban contract id (C...)';

const corsOriginsProblem = (value: string): string | null =>
  value.trim() === '*'
    ? "must not be '*' in production: list the origins that may call the API"
    : null;

/** Checked in every environment, but only when the variable is set. */
const PRESENT_VALUE_RULES: readonly EnvRule[] = [
  { name: 'PORT', why: 'HTTP port', check: portProblem },
  {
    name: 'DATABASE_PORT',
    why: 'PostgreSQL port',
    check: portProblem,
  },
  {
    name: 'ENCRYPTION_KEY',
    why: '32-byte key that encrypts ephemeral account secrets at rest',
    check: hexKeyProblem,
  },
  {
    name: 'JWT_SECRET',
    why: 'signs integrator JWTs',
    check: (value) =>
      isPlaceholder(value)
        ? 'is still the example value from .env.example'
        : null,
  },
];

/** Presence and format are both enforced when NODE_ENV=production. */
const REQUIRED_IN_PRODUCTION: readonly EnvRule[] = [
  { name: 'DATABASE_HOST', why: 'PostgreSQL host', check: undefined },
  { name: 'DATABASE_PORT', why: 'PostgreSQL port', check: portProblem },
  { name: 'DATABASE_USER', why: 'PostgreSQL user' },
  { name: 'DATABASE_PASSWORD', why: 'PostgreSQL password' },
  { name: 'DATABASE_NAME', why: 'PostgreSQL database' },
  // JWT_SECRET is deliberately absent here: main.ts's assertSecretStrength()
  // already refuses to boot a non-development deployment with a weak or
  // placeholder secret, and it runs before Nest exists so no DI graph -- and no
  // database connection -- is built first. Repeating the rule would give one
  // variable two owners.
  {
    name: 'ENCRYPTION_KEY',
    why: '32-byte key that encrypts ephemeral account secrets at rest',
    check: hexKeyProblem,
  },
  {
    name: 'FUNDING_ACCOUNT_SECRET',
    why: 'signs the account-creation transactions',
    check: secretSeedProblem,
  },
  {
    name: 'RECOVERY_ACCOUNT_PUBLIC',
    why: 'recovery address passed to the contract',
    check: publicKeyProblem,
  },
  {
    name: 'EPHEMERAL_ACCOUNT_CONTRACT_ID',
    why: 'the deployed ephemeral-account contract',
    check: contractIdProblem,
  },
  {
    name: 'STELLAR_SWEEP_CONTROLLER_CONTRACT_ID',
    aliases: ['SWEEP_CONTROLLER_CONTRACT_ID'],
    why: 'the deployed sweep-controller contract',
    check: contractIdProblem,
  },
  {
    name: 'SWEEP_SIGNING_KEY_SEED',
    why: 'authorizes sweep calls on the sweep controller',
    check: hexKeyProblem,
  },
  {
    name: 'CORS_ORIGINS',
    why: 'allowed browser origins',
    check: corsOriginsProblem,
  },
];

const readValue = (config: EnvRecord, rule: EnvRule): string | undefined => {
  for (const key of [rule.name, ...(rule.aliases ?? [])]) {
    const value = config[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
};

/**
 * Every problem with the given environment, sorted by variable name so two runs
 * with the same input produce the same message.
 */
export function collectEnvProblems(config: EnvRecord): string[] {
  const nodeEnv =
    typeof config.NODE_ENV === 'string' ? config.NODE_ENV : 'development';
  const problems: string[] = [];

  for (const rule of PRESENT_VALUE_RULES) {
    const value = readValue(config, rule);
    const problem = value === undefined ? null : (rule.check?.(value) ?? null);
    if (problem) {
      problems.push(`${rule.name} ${problem}`);
    }
  }

  if (nodeEnv === 'production') {
    for (const rule of REQUIRED_IN_PRODUCTION) {
      const value = readValue(config, rule);
      if (value === undefined) {
        problems.push(`${rule.name} is required (${rule.why})`);
        continue;
      }
      const problem = rule.check?.(value) ?? null;
      if (problem) {
        problems.push(`${rule.name} ${problem}`);
      }
    }
  }

  return [...new Set(problems)].sort();
}

/** The message a failed boot prints: what is wrong, and where to fix it. */
export function formatEnvProblemReport(problems: readonly string[]): string {
  const plural = problems.length === 1 ? 'problem' : 'problems';
  return [
    `Refusing to start: ${problems.length} environment ${plural}.`,
    ...problems.map((problem) => `  - ${problem}`),
    'See .env.example for the expected values and README.md for what each one does.',
  ].join('\n');
}

/**
 * Nest calls this from `ConfigModule.forRoot({ validate })` with the merged
 * environment. Throwing here aborts startup; returning the config unchanged
 * keeps Nest's merge semantics intact.
 */
export function validateEnv(config: EnvRecord): EnvRecord {
  const problems = collectEnvProblems(config);
  if (problems.length > 0) {
    const report = formatEnvProblemReport(problems);
    // Printed as well as thrown on purpose. Nest logs the error this throws
    // through its exception handler, which serializes an Error to '{}' -- so a
    // deployment that refuses to start would otherwise emit
    // {"context":"ExceptionHandler","msg":"{}"} and tell the operator nothing.
    // Same channel and prefix as the guards in main.ts, which run before the
    // Nest logger exists for the same reason.
    console.error(`[Bootstrap] FATAL: ${report}`);
    throw new Error(report);
  }
  return config;
}

export default validateEnv;
