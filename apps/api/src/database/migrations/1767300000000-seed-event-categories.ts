import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedEventCategories1767300000000 implements MigrationInterface {
  name = 'SeedEventCategories1767300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO categories (name, slug, sort_order, updated_by_kind)
      VALUES
        ('Sosyal', 'sosyal', 10, 'SYSTEM'),
        ('Kültür ve sanat', 'kultur-sanat', 20, 'SYSTEM'),
        ('Müzik', 'muzik', 30, 'SYSTEM'),
        ('Yemek ve içecek', 'yemek-icecek', 40, 'SYSTEM'),
        ('Spor ve sağlık', 'spor-saglik', 50, 'SYSTEM'),
        ('Teknoloji', 'teknoloji', 60, 'SYSTEM'),
        ('Eğitim', 'egitim', 70, 'SYSTEM'),
        ('Doğa ve gezi', 'doga-gezi', 80, 'SYSTEM')
      ON CONFLICT (slug) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM categories WHERE slug IN ('sosyal', 'kultur-sanat', 'muzik', 'yemek-icecek', 'spor-saglik', 'teknoloji', 'egitim', 'doga-gezi')");
  }
}
