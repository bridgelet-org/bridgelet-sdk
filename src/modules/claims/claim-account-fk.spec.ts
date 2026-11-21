import { readFileSync } from 'fs';
import { join } from 'path';

const readRepoFile = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('claims.accountId foreign key behavior (#1025)', () => {
  const migration = readRepoFile(
    'src/database/migrations/1718100001000-CreateClaimsTable.ts',
  );
  const entity = readRepoFile('src/modules/claims/entities/claim.entity.ts');
  const docs = readRepoFile('docs/database-schema.md');

  it('uses ON DELETE CASCADE consistently in the migration and entity', () => {
    expect(migration).toContain('CONSTRAINT "FK_claims_accountId"');
    expect(migration).toContain('ON DELETE CASCADE');
    expect(entity).toContain("onDelete: 'CASCADE'");
    expect(entity).toContain('FK_claims_accountId');
  });

  it('documents that soft-deleted accounts keep their claim rows', () => {
    expect(docs).toContain('## Foreign Key Cascade Behavior');
    expect(docs).toContain("onDelete: 'CASCADE'");
    expect(docs).toContain('soft-deleting an account never');
    expect(docs).toContain(
      'triggers this FK and existing claims remain intact',
    );
    expect(docs).toContain('only fires on an actual (hard) `DELETE`');
  });
});
