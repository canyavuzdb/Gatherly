import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEventDraftTables1766800000000 implements MigrationInterface {
  name = 'CreateEventDraftTables1766800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TYPE event_visibility AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE')",
    );
    await queryRunner.query(
      "CREATE TYPE join_policy AS ENUM ('OPEN', 'APPROVAL_REQUIRED', 'INVITE_ONLY')",
    );
    await queryRunner.query(
      "CREATE TYPE event_status AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED')",
    );
    await queryRunner.query(
      "CREATE TYPE address_visibility AS ENUM ('EVENT_VIEWERS', 'CONFIRMED_ATTENDEES')",
    );
    await queryRunner.query(
      "CREATE TYPE attendance_status AS ENUM ('PENDING', 'CONFIRMED', 'WAITLISTED', 'REJECTED', 'CANCELLED')",
    );
    await queryRunner.query(`
      CREATE TABLE categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(80) NOT NULL UNIQUE,
        slug varchar(80) NOT NULL UNIQUE,
        is_active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid NULL REFERENCES users(id),
        updated_by_kind change_actor_kind NOT NULL,
        version integer NOT NULL DEFAULT 1
      )
    `);
    await queryRunner.query(`
      CREATE TABLE events (
        id uuid PRIMARY KEY,
        organizer_id uuid NOT NULL REFERENCES users(id),
        category_id uuid NOT NULL REFERENCES categories(id),
        title varchar(160) NOT NULL,
        description text NOT NULL,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        timezone varchar(64) NOT NULL,
        capacity integer NULL,
        confirmed_count integer NOT NULL DEFAULT 0,
        visibility event_visibility NOT NULL,
        join_policy join_policy NOT NULL,
        status event_status NOT NULL DEFAULT 'DRAFT',
        share_token uuid NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by_user_id uuid NOT NULL REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid NULL REFERENCES users(id),
        updated_by_kind change_actor_kind NOT NULL,
        version integer NOT NULL DEFAULT 1,
        CHECK (ends_at > starts_at),
        CHECK (capacity IS NULL OR capacity > 0),
        CHECK (confirmed_count >= 0),
        CHECK (capacity IS NULL OR confirmed_count <= capacity),
        CHECK (visibility <> 'UNLISTED' OR share_token IS NOT NULL),
        CHECK (visibility <> 'PRIVATE' OR join_policy = 'INVITE_ONLY')
      )
    `);
    await queryRunner.query(`
      CREATE TABLE event_locations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL UNIQUE REFERENCES events(id),
        city varchar(100) NOT NULL,
        district varchar(100) NOT NULL,
        venue_name varchar(160) NULL,
        address text NULL,
        address_visibility address_visibility NOT NULL DEFAULT 'EVENT_VIEWERS',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid NULL REFERENCES users(id),
        updated_by_kind change_actor_kind NOT NULL,
        version integer NOT NULL DEFAULT 1
      )
    `);
    await queryRunner.query(`
      CREATE TABLE event_creation_quota_usage (
        user_id uuid NOT NULL REFERENCES users(id),
        period_start date NOT NULL,
        created_count integer NOT NULL DEFAULT 0,
        monthly_event_limit integer NOT NULL DEFAULT 8 CHECK (monthly_event_limit > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid NULL REFERENCES users(id),
        updated_by_kind change_actor_kind NOT NULL,
        version integer NOT NULL DEFAULT 1,
        PRIMARY KEY (user_id, period_start)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE attendances (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL REFERENCES events(id),
        user_id uuid NOT NULL REFERENCES users(id),
        status attendance_status NOT NULL,
        waitlist_opt_in boolean NOT NULL DEFAULT false,
        requested_at timestamptz NOT NULL,
        waitlisted_at timestamptz NULL,
        confirmed_at timestamptz NULL,
        rejected_at timestamptz NULL,
        rejection_reason varchar(300) NULL,
        cancelled_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by_user_id uuid NULL REFERENCES users(id),
        updated_by_kind change_actor_kind NOT NULL,
        version integer NOT NULL DEFAULT 1,
        UNIQUE (event_id, user_id)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX events_status_visibility_starts_at_idx ON events(status, visibility, starts_at)',
    );
    await queryRunner.query(
      'CREATE INDEX event_locations_city_district_event_id_idx ON event_locations(city, district, event_id)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE attendances');
    await queryRunner.query('DROP TABLE event_creation_quota_usage');
    await queryRunner.query('DROP TABLE event_locations');
    await queryRunner.query('DROP TABLE events');
    await queryRunner.query('DROP TABLE categories');
    await queryRunner.query('DROP TYPE attendance_status');
    await queryRunner.query('DROP TYPE address_visibility');
    await queryRunner.query('DROP TYPE event_status');
    await queryRunner.query('DROP TYPE join_policy');
    await queryRunner.query('DROP TYPE event_visibility');
  }
}
