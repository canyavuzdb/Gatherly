import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddParticipationRecords1768600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TYPE check_in_record_kind AS ENUM ('CHECKED_IN', 'REVOKED')");
    await queryRunner.query("CREATE TYPE participation_outcome_kind AS ENUM ('ATTENDED', 'NO_SHOW')");
    await queryRunner.query(`CREATE TABLE check_in_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES events(id),
      attendance_id uuid NOT NULL REFERENCES attendances(id),
      user_id uuid NOT NULL REFERENCES users(id),
      kind check_in_record_kind NOT NULL,
      method varchar(32) NOT NULL,
      recorded_by_user_id uuid NOT NULL REFERENCES users(id),
      reverses_check_in_record_id uuid NULL REFERENCES check_in_records(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((kind = 'CHECKED_IN' AND reverses_check_in_record_id IS NULL) OR (kind = 'REVOKED' AND reverses_check_in_record_id IS NOT NULL))
    )`);
    await queryRunner.query("CREATE UNIQUE INDEX check_in_records_one_check_in_per_attendance ON check_in_records(attendance_id) WHERE kind = 'CHECKED_IN'");
    await queryRunner.query("CREATE UNIQUE INDEX check_in_records_one_revocation_per_check_in ON check_in_records(reverses_check_in_record_id) WHERE kind = 'REVOKED'");
    await queryRunner.query('CREATE INDEX check_in_records_event_id_created_at ON check_in_records(event_id, created_at)');
    await queryRunner.query(`CREATE TABLE participation_outcomes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES events(id),
      attendance_id uuid NOT NULL REFERENCES attendances(id),
      user_id uuid NOT NULL REFERENCES users(id),
      outcome participation_outcome_kind NOT NULL,
      derived_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (event_id, attendance_id),
      UNIQUE (event_id, user_id)
    )`);
    await queryRunner.query('CREATE INDEX participation_outcomes_event_id_outcome ON participation_outcomes(event_id, outcome)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE participation_outcomes');
    await queryRunner.query('DROP INDEX check_in_records_event_id_created_at');
    await queryRunner.query('DROP INDEX check_in_records_one_revocation_per_check_in');
    await queryRunner.query('DROP INDEX check_in_records_one_check_in_per_attendance');
    await queryRunner.query('DROP TABLE check_in_records');
    await queryRunner.query('DROP TYPE participation_outcome_kind');
    await queryRunner.query('DROP TYPE check_in_record_kind');
  }
}
