import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventOrganizerTransfers1768300000000 implements MigrationInterface {
  name = 'AddEventOrganizerTransfers1768300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TYPE organizer_transfer_status AS ENUM ('PENDING','ACCEPTED','DECLINED','REVOKED')");
    await queryRunner.query(`CREATE TABLE event_organizer_transfers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES events(id),
      from_user_id uuid NOT NULL REFERENCES users(id),
      to_user_id uuid NOT NULL REFERENCES users(id),
      status organizer_transfer_status NOT NULL DEFAULT 'PENDING',
      responded_at timestamptz NULL,
      updated_by_user_id uuid NULL REFERENCES users(id),
      updated_by_kind varchar NOT NULL,
      version integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (from_user_id <> to_user_id)
    )`);
    await queryRunner.query("CREATE UNIQUE INDEX event_organizer_transfers_one_pending_idx ON event_organizer_transfers(event_id) WHERE status = 'PENDING'");
    await queryRunner.query('CREATE INDEX event_organizer_transfers_recipient_idx ON event_organizer_transfers(to_user_id, status, created_at DESC)');
    await queryRunner.query("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ORGANIZER_TRANSFER_RECEIVED'");
    await queryRunner.query("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ORGANIZER_TRANSFER_ACCEPTED'");
    await queryRunner.query("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ORGANIZER_TRANSFER_DECLINED'");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE event_organizer_transfers');
    await queryRunner.query('DROP TYPE organizer_transfer_status');
  }
}
