import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeclinedInvitationStatus1768400000000 implements MigrationInterface {
  name = 'AddDeclinedInvitationStatus1768400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TYPE invitation_status ADD VALUE IF NOT EXISTS 'DECLINED'");
  }

  async down(): Promise<void> {
    // PostgreSQL enum values are intentionally not removed: existing rows may use DECLINED.
  }
}
