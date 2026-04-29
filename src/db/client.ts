// src/db/client.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getDatabaseUrl } from '../config/secrets';

const connectionString = await getDatabaseUrl();

const pool = new Pool({ connectionString });

const adapter = new PrismaPg(pool);

export const db = new PrismaClient({ adapter });
