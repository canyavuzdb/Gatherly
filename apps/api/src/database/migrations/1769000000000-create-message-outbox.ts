import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMessageOutbox1769000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE message_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id varchar(180) NOT NULL UNIQUE,
        event_name varchar(120) NOT NULL,
        event_version integer NOT NULL,
        occurred_at timestamptz NOT NULL,
        correlation_id varchar(180) NOT NULL,
        payload jsonb NOT NULL,
        published_at timestamptz NULL,
        attempt_count integer NOT NULL DEFAULT 0,
        last_error text NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query('CREATE INDEX message_outbox_unpublished_idx ON message_outbox (created_at) WHERE published_at IS NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE message_outbox');
  }
}
