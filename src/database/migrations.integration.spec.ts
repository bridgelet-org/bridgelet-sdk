import { execFile } from 'child_process';
import { promisify } from 'util';
import { AccountStatus } from '../modules/accounts/enums/account-status.enum.js';

const execFileAsync = promisify(execFile);

type MigrationCheckResult = {
  enumValues: string[];
  executedMigrationNames: string[];
  foreignKeyColumns: string[][];
  foreignKeyRejected: boolean;
  contractEventColumns: string[];
  contractEventInsertSucceeded: boolean;
  schemaInSync: boolean;
};

describe('Database migrations integration', () => {
  jest.setTimeout(180_000);

  let result: MigrationCheckResult;

  beforeAll(async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--loader', 'ts-node/esm', './test/migrations.integration.runner.ts'],
      {
        cwd: process.cwd(),
      },
    );

    result = JSON.parse(stdout) as MigrationCheckResult;
  });

  it('applies every migration, matches entity metadata, and validates key tables', () => {
    expect(result.executedMigrationNames).toHaveLength(6);
    expect(result.schemaInSync).toBe(true);
    expect(result.enumValues).toEqual(Object.values(AccountStatus));
    expect(result.foreignKeyColumns).toContainEqual(['accountId']);
    expect(result.foreignKeyRejected).toBe(true);
    expect(result.contractEventColumns).toEqual([
      'id',
      'event_type',
      'contract_address',
      'ledger_sequence',
      'tx_hash',
      'payload',
      'created_at',
    ]);
    expect(result.contractEventInsertSucceeded).toBe(true);
  });
});
