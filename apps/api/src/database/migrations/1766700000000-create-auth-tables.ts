import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthTables1766700000000 implements MigrationInterface {
  name = 'CreateAuthTables1766700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS citext');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await queryRunner.query(
      "CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED')",
    );
    await queryRunner.query(
      "CREATE TYPE profile_visibility AS ENUM ('PUBLIC', 'EVENT_ATTENDEES', 'PRIVATE')",
    );
    await queryRunner.query(
      "CREATE TYPE change_actor_kind AS ENUM ('USER', 'SYSTEM')",
    );
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email citext NOT NULL UNIQUE,
        password_hash text NOT NULL,
        email_verified_at timestamptz NULL,
        status user_status NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1
      )
    `);
    await queryRunner.query(`
      CREATE TABLE profiles (
        user_id uuid PRIMARY KEY REFERENCES users(id),
        first_name varchar(100) NOT NULL,
        last_name varchar(100) NOT NULL,
        bio varchar(500) NULL,
        avatar_media_asset_id uuid NULL,
        visibility profile_visibility NOT NULL DEFAULT 'EVENT_ATTENDEES',
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by_user_id uuid NULL REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid NULL REFERENCES users(id),
        updated_by_kind change_actor_kind NOT NULL,
        version integer NOT NULL DEFAULT 1
      )
    `);
    await queryRunner.query(`
      CREATE TABLE email_verification_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id),
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz NULL,
        invalidated_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE password_reset_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id),
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz NULL,
        invalidated_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE refresh_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id),
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz NULL
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE refresh_sessions');
    await queryRunner.query('DROP TABLE password_reset_tokens');
    await queryRunner.query('DROP TABLE email_verification_tokens');
    await queryRunner.query('DROP TABLE profiles');
    await queryRunner.query('DROP TABLE users');
    await queryRunner.query('DROP TYPE change_actor_kind');
    await queryRunner.query('DROP TYPE profile_visibility');
    await queryRunner.query('DROP TYPE user_status');
  }
}
