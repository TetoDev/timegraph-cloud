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

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export async function getSmtpConfig(): Promise<SmtpConfig> {
  try {
    const raw = await readFile("/run/secrets/smtp_credentials", "utf8");
    const parsed: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const eq = line.indexOf("=");
      if (eq !== -1) {
        parsed[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
    return {
      host: process.env.SMTP_HOST || parsed.SMTP_HOST || "ssl0.ovh.net",
      port: parseInt(process.env.SMTP_PORT || parsed.SMTP_PORT || "587", 10),
      user: parsed.SMTP_USER || process.env.SMTP_USER || "",
      pass: parsed.SMTP_PASS || process.env.SMTP_PASS || "",
      from: process.env.SMTP_FROM || parsed.SMTP_FROM || "contact@insa-racing.fr",
    };
  } catch {
    const host = process.env.SMTP_HOST || "ssl0.ovh.net";
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const user = process.env.SMTP_USER || "";
    const pass = process.env.SMTP_PASS || "";

    // Mailpit (local testing) doesn't require credentials
    if (host.includes("mailpit") || port === 1025) {
      return { host, port, user: "", pass: "", from: process.env.SMTP_FROM || "test@localhost.local" };
    }

    if (!user || !pass) {
      throw new Error("SMTP credentials not set (env vars SMTP_USER/SMTP_PASS or docker secret smtp_credentials required)");
    }
    return {
      host,
      port,
      user,
      pass,
      from: process.env.SMTP_FROM || "contact@insa-racing.fr",
    };
  }
}
