/**
 * Ensures EXPO_PUBLIC_DOMAIN is set for `expo export` so the Firebase web host
 * calls the Cloud Run API (same default as eas.json preview).
 */
if (!process.env.EXPO_PUBLIC_DOMAIN && !process.env.EXPO_PUBLIC_API_URL) {
  console.error(
    "Set EXPO_PUBLIC_DOMAIN or EXPO_PUBLIC_API_URL before export (see .env.example).",
  );
  process.exit(1);
}
if (!process.env.EXPO_PUBLIC_DOMAIN && process.env.EXPO_PUBLIC_API_URL) {
  process.env.EXPO_PUBLIC_DOMAIN = process.env.EXPO_PUBLIC_API_URL;
}

const { execSync } = require("child_process");
execSync("npx expo export -p web", { stdio: "inherit", env: process.env });
