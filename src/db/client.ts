// src/db/client.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// 1. Initialize the native Postgres driver pool
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL 
});

// 2. Wrap it in the Prisma 7 adapter
const adapter = new PrismaPg(pool);

// 3. Export the fully configured client
export const db = new PrismaClient({ adapter });