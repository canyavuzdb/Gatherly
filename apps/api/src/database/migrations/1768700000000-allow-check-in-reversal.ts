import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowCheckInReversal1768700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX check_in_records_one_check_in_per_attendance');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE UNIQUE INDEX check_in_records_one_check_in_per_attendance ON check_in_records(attendance_id) WHERE kind = 'CHECKED_IN'");
  }
}
