import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CanonicalizeEventLocationCities1767200000000 implements MigrationInterface {
  name = 'CanonicalizeEventLocationCities1767200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE event_locations
      SET city = initcap(lower(translate(btrim(city), 'ÇçĞğİIıÖöŞşÜü', 'CcGgIIiOoSsUu')))
    `);
  }

  async down(): Promise<void> {
    // Canonical city values are deliberately irreversible; they are a lookup key.
  }
}
