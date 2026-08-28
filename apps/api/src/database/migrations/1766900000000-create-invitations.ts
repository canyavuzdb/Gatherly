import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvitations1766900000000 implements MigrationInterface {
  name = 'CreateInvitations1766900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TYPE invitation_status AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')");
    await queryRunner.query(`
      CREATE TABLE invitations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL REFERENCES events(id),
        recipient_user_id uuid NOT NULL REFERENCES users(id),
        invited_by_user_id uuid NOT NULL REFERENCES users(id),
        status invitation_status NOT NULL DEFAULT 'PENDING',
        expires_at timestamptz NOT NULL,
        accepted_at timestamptz NULL,
        revoked_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid NULL REFERENCES users(id),
        updated_by_kind change_actor_kind NOT NULL,
        version integer NOT NULL DEFAULT 1,
        UNIQUE (event_id, recipient_user_id)
      )
    `);
    await queryRunner.query('CREATE INDEX invitations_recipient_status_idx ON invitations(recipient_user_id, status)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE invitations');
    await queryRunner.query('DROP TYPE invitation_status');
  }
}
