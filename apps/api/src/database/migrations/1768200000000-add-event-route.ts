import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventRoute1768200000000 implements MigrationInterface {
  name = 'AddEventRoute1768200000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE event_locations ADD COLUMN route_mode varchar NOT NULL DEFAULT 'NONE'");
    await queryRunner.query('ALTER TABLE event_locations ADD COLUMN route_end_latitude double precision NULL');
    await queryRunner.query('ALTER TABLE event_locations ADD COLUMN route_end_longitude double precision NULL');
    await queryRunner.query("ALTER TABLE event_locations ADD CONSTRAINT event_locations_route_coordinates_pair CHECK ((route_end_latitude IS NULL AND route_end_longitude IS NULL) OR (route_end_latitude BETWEEN -90 AND 90 AND route_end_longitude BETWEEN -180 AND 180))");
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE event_locations DROP CONSTRAINT event_locations_route_coordinates_pair');
    await queryRunner.query('ALTER TABLE event_locations DROP COLUMN route_end_longitude');
    await queryRunner.query('ALTER TABLE event_locations DROP COLUMN route_end_latitude');
    await queryRunner.query('ALTER TABLE event_locations DROP COLUMN route_mode');
  }
}
