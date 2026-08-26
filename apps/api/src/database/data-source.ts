import 'dotenv/config';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';

export default new DataSource(
  createDatabaseOptions(process.env.DATABASE_URL ?? ''),
);
