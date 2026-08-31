import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMaybeAttendanceStatus1768500000000 implements MigrationInterface {
  name = 'AddMaybeAttendanceStatus1768500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TYPE attendance_status ADD VALUE IF NOT EXISTS 'MAYBE'");
  }

  async down(): Promise<void> {
    // PostgreSQL enum values are intentionally not removed: existing rows may use MAYBE.
  }
}
