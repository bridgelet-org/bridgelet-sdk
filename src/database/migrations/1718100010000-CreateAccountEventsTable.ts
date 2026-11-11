import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountEventsTable1718100010000
  implements MigrationInterface
{
  name = 'CreateAccountEventsTable1718100010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "account_events" (
        "id"          uuid                   NOT NULL DEFAULT gen_random_uuid(),
        "accountId"   uuid                   NOT NULL,
        "type"        character varying(32)  NOT NULL,
        "txHash"      character varying(64),
        "details"     jsonb                  NOT NULL DEFAULT '{}'::jsonb,
        "createdAt"   TIMESTAMP              NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_account_events_accountId_createdAt" ON "account_events" ("accountId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_account_events_accountId_createdAt"`,
    );
    await queryRunner.query(`DROP TABLE "account_events"`);
  }
}
