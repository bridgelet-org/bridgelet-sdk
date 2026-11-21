import { spawnSync } from 'child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const bashExecutable = process.env.BASH_PATH ?? 'bash';
const scriptPath = path.resolve(__dirname, 'generate-migrations.sh');
const generatedMigration = '1718100000000-CreateAccountsTable.ts';
const localMigration = '1718900000000-LocalExperiment.ts';

describe('generate-migrations.sh pre-flight guard', () => {
  const roots: string[] = [];

  function git(root: string, ...args: string[]) {
    return spawnSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.name=Test Contributor',
        '-c',
        'user.email=test@example.com',
        ...args,
      ],
      { encoding: 'utf8' },
    );
  }

  function setupRepo(): string {
    const root = mkdtempSync(
      path.join(tmpdir(), 'bridgelet-generate-migrations-'),
    );
    roots.push(root);

    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    mkdirSync(path.join(root, 'src', 'database', 'migrations'), {
      recursive: true,
    });
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'bridgelet-sdk', version: '0.0.0' }),
    );
    writeFileSync(
      path.join(root, 'src', 'database', 'migrations', generatedMigration),
      'export const committed = true;\n',
    );
    copyFileSync(
      scriptPath,
      path.join(root, 'scripts', 'generate-migrations.sh'),
    );

    for (const args of [
      ['init', '-q'],
      ['add', '.'],
      ['commit', '-q', '-m', 'initial'],
    ]) {
      const result = git(root, ...args);
      expect(result.status).toBe(0);
    }

    return root;
  }

  function runScript(root: string, ...args: string[]) {
    return spawnSync(
      bashExecutable,
      [path.join(root, 'scripts', 'generate-migrations.sh'), ...args],
      { cwd: root, encoding: 'utf8' },
    );
  }

  function migrationPath(root: string, name: string): string {
    return path.join(root, 'src', 'database', 'migrations', name);
  }

  afterEach(() => {
    while (roots.length > 0) {
      rmSync(roots.pop()!, { recursive: true, force: true });
    }
  });

  it('rewrites the folder from a clean working tree', () => {
    const root = setupRepo();

    const result = runScript(root, '--yes');

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('uncommitted changes detected');
    expect(
      readFileSync(migrationPath(root, generatedMigration), 'utf8'),
    ).toContain('CreateAccountsTable1718100000000');
  });

  it('refuses to overwrite a hand-edited migration without --force', () => {
    const root = setupRepo();
    const edited = 'export const handEdited = true;\n';
    writeFileSync(migrationPath(root, generatedMigration), edited);

    const result = runScript(root, '--yes');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('uncommitted changes detected');
    expect(readFileSync(migrationPath(root, generatedMigration), 'utf8')).toBe(
      edited,
    );
  });

  it('refuses to overwrite an untracked migration file', () => {
    const root = setupRepo();
    writeFileSync(
      migrationPath(root, localMigration),
      'export const local = true;\n',
    );

    const result = runScript(root, '--yes');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(localMigration);
    expect(readFileSync(migrationPath(root, localMigration), 'utf8')).toContain(
      'local',
    );
  });

  it('aborts before prompting when there are uncommitted changes', () => {
    const root = setupRepo();
    writeFileSync(migrationPath(root, generatedMigration), '// local edit\n');

    const result = runScript(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('uncommitted changes detected');
  });

  it('overwrites deliberately only with --yes --force', () => {
    const root = setupRepo();
    writeFileSync(migrationPath(root, generatedMigration), '// local edit\n');

    const result = runScript(root, '--yes', '--force');

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('will be overwritten');
    expect(
      readFileSync(migrationPath(root, generatedMigration), 'utf8'),
    ).toContain('CreateAccountsTable1718100000000');
  });
});
