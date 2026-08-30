import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventLocationCoordinates1768100000000 implements MigrationInterface {
  name = 'AddEventLocationCoordinates1768100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE event_locations ADD COLUMN latitude double precision NULL');
    await queryRunner.query('ALTER TABLE event_locations ADD COLUMN longitude double precision NULL');
    await queryRunner.query("ALTER TABLE event_locations ADD CONSTRAINT event_locations_coordinates_pair CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE event_locations DROP CONSTRAINT event_locations_coordinates_pair');
    await queryRunner.query('ALTER TABLE event_locations DROP COLUMN longitude');
    await queryRunner.query('ALTER TABLE event_locations DROP COLUMN latitude');
  }
}
