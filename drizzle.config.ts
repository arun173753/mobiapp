import { defineConfig } from "drizzle-kit";
import { fixDbUrl } from "./server/db";

function getUrl(): string {
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
    "No database URL configured. Set SUPABASE_DATABASE_URL, NEON_DATABASE_URL, or DATABASE_URL."
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: getUrl(),
  },
});
