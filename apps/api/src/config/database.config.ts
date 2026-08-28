import { registerAs } from '@nestjs/config';
import type { DataSourceOptions } from 'typeorm';
import { join } from 'node:path';

export function createDatabaseOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: [join(__dirname, '../**/*.{entity,persistence}{.ts,.js}')],
    migrations: [join(__dirname, '../database/migrations/*{.ts,.js}')],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
  };
}

export default registerAs('database', () =>
  createDatabaseOptions(process.env.DATABASE_URL ?? ''),
);
