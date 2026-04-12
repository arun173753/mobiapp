import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

export function fixDbUrl(raw: string): string {
  const protoEnd = raw.indexOf("://");
  if (protoEnd === -1) return raw;
  const proto = raw.substring(0, protoEnd + 3);
  const rest = raw.substring(protoEnd + 3);
  const lastAt = rest.lastIndexOf("@");
  if (lastAt === -1) return raw;
  const credentials = rest.substring(0, lastAt);
  const hostPart = rest.substring(lastAt + 1);
  const colonIdx = credentials.indexOf(":");
  if (colonIdx === -1) return raw;
  const user = credentials.substring(0, colonIdx);
  const rawPassword = credentials.substring(colonIdx + 1);
  let decodedPassword: string;
  try {
    decodedPassword = decodeURIComponent(rawPassword);
  } catch {
    decodedPassword = rawPassword;
  }
  const encodedPassword = encodeURIComponent(decodedPassword);
  return `${proto}${user}:${encodedPassword}@${hostPart}`;
}

function getValidDbUrl(): string {
  const candidates = [
    process.env.SUPABASE_DATABASE_URL,
    process.env.NEON_DATABASE_URL,
    process.env.DATABASE_URL,
  ];
  for (const raw of candidates) {
    if (raw && (raw.startsWith("postgresql://") || raw.startsWith("postgres://"))) {
      return fixDbUrl(raw);
    }
  }
  throw new Error(
    "No valid database URL found. SUPABASE_DATABASE_URL must be a postgresql:// connection string."
  );
}

const connectionString = getValidDbUrl();

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle(pool, { schema });
