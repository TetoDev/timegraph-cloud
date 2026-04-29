// src/config/secrets.ts
// Reads Docker Secrets from /run/secrets/<name>, falls back to process.env
// Works transparently in both Docker (production) and local dev (via .env)

import { readFile } from "node:fs/promises";

export async function readSecret(secretName: string, envVarName: string): Promise<string> {
  try {
    const content = await readFile(`/run/secrets/${secretName}`, "utf8");
    return content.trim();
  } catch {
    const val = process.env[envVarName];
    if (!val) throw new Error(`Secret "${secretName}" / env "${envVarName}" not set`);
    return val;
  }
}

export async function getDatabaseUrl(): Promise<string> {
  try {
    const password = await readSecret("db_password", "POSTGRES_PASSWORD");
    const host = process.env.DB_HOST || "localhost";
    const db = process.env.DB_NAME || "plpp_cloud";
    return `postgresql://admin:${password}@${host}:5432/${db}`;
  } catch {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set and Docker Secrets not available");
    }
    return process.env.DATABASE_URL;
  }
}
