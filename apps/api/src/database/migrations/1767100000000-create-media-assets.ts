import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMediaAssets1767100000000 implements MigrationInterface {
  name = 'CreateMediaAssets1767100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TYPE media_status AS ENUM ('PENDING', 'PROCESSING', 'READY', 'REJECTED', 'DELETED')");
    await queryRunner.query("CREATE TYPE event_media_role AS ENUM ('COVER', 'GALLERY')");
    await queryRunner.query(`
      CREATE TABLE media_assets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id uuid NOT NULL REFERENCES users(id),
        storage_key varchar(512) NOT NULL UNIQUE,
        mime_type varchar(100) NOT NULL,
        byte_size integer NOT NULL CHECK (byte_size > 0),
        width integer NULL,
        height integer NULL,
        status media_status NOT NULL DEFAULT 'PENDING',
        rejection_reason varchar(300) NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid NULL REFERENCES users(id),
        updated_by_kind change_actor_kind NOT NULL,
        deleted_at timestamptz NULL,
        deleted_by_user_id uuid NULL REFERENCES users(id),
        version integer NOT NULL DEFAULT 1
      )
    `);
    await queryRunner.query(`
      CREATE TABLE event_media (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL REFERENCES events(id),
        media_asset_id uuid NOT NULL REFERENCES media_assets(id),
        role event_media_role NOT NULL,
        position integer NOT NULL DEFAULT 0,
        alt_text varchar(250) NULL,
        added_by_user_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid NULL REFERENCES users(id),
        updated_by_kind change_actor_kind NOT NULL,
        version integer NOT NULL DEFAULT 1,
        UNIQUE (event_id, media_asset_id)
      )
    `);
    await queryRunner.query('ALTER TABLE profiles ADD CONSTRAINT profiles_avatar_media_asset_id_fkey FOREIGN KEY (avatar_media_asset_id) REFERENCES media_assets(id)');
    await queryRunner.query('CREATE UNIQUE INDEX event_media_one_cover_per_event_idx ON event_media(event_id) WHERE role = \'COVER\'');
    await queryRunner.query('CREATE INDEX media_assets_owner_status_idx ON media_assets(owner_user_id, status)');
    await queryRunner.query('CREATE INDEX event_media_event_role_position_idx ON event_media(event_id, role, position)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE profiles DROP CONSTRAINT profiles_avatar_media_asset_id_fkey');
    await queryRunner.query('DROP TABLE event_media');
    await queryRunner.query('DROP TABLE media_assets');
    await queryRunner.query('DROP TYPE event_media_role');
    await queryRunner.query('DROP TYPE media_status');
  }
}
