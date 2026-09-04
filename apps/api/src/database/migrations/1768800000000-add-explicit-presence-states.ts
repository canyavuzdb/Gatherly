import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExplicitPresenceStates1768800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TYPE check_in_record_kind ADD VALUE IF NOT EXISTS 'MARKED_ABSENT'");
    await queryRunner.query("ALTER TYPE check_in_record_kind ADD VALUE IF NOT EXISTS 'CLEARED'");
    await queryRunner.query('ALTER TABLE check_in_records DROP CONSTRAINT check_in_records_check');
    await queryRunner.query("ALTER TABLE check_in_records ADD CONSTRAINT check_in_records_check CHECK ((kind = 'REVOKED' AND reverses_check_in_record_id IS NOT NULL) OR (kind <> 'REVOKED' AND reverses_check_in_record_id IS NULL))");
  }

  async down(): Promise<void> { /* PostgreSQL enum values are intentionally not removed. */ }
}
