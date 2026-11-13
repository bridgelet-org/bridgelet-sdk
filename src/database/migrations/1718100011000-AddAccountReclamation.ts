import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountReclamation1718100011000 implements MigrationInterface {
  name = 'AddAccountReclamation1718100011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "account_reclamation_status_enum" AS ENUM (
        'pending',
        'refunded',
        'trustline_removed',
        'completed'
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "secretKeyEncrypted" DROP NOT NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE "accounts"
        ADD "reclamationStatus" "account_reclamation_status_enum" NOT NULL DEFAULT 'pending',
        ADD "reclamationAttempts" integer NOT NULL DEFAULT 0,
        ADD "reclamationLastAttemptAt" TIMESTAMP,
        ADD "reclamationNextAttemptAt" TIMESTAMP,
        ADD "reclamationLastError" text,
        ADD "reclamationCompletedAt" TIMESTAMP
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_accounts_reclamation"
        ON "accounts" (
          "status",
          "reclamationStatus",
          "reclamationNextAttemptAt"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_accounts_reclamation"`);

    await queryRunner.query(`
      ALTER TABLE "accounts"
        DROP COLUMN "reclamationCompletedAt",
        DROP COLUMN "reclamationLastError",
        DROP COLUMN "reclamationNextAttemptAt",
        DROP COLUMN "reclamationLastAttemptAt",
        DROP COLUMN "reclamationAttempts",
        DROP COLUMN "reclamationStatus"
    `);

    await queryRunner.query(`DROP TYPE "account_reclamation_status_enum"`);

    await queryRunner.query(
      `UPDATE "accounts" SET "secretKeyEncrypted" = '' WHERE "secretKeyEncrypted" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "secretKeyEncrypted" SET NOT NULL`,
    );
  }
}
