/**
 * Cross-platform project clean (Windows-safe).
 * Removes node_modules, Expo caches, and lockfile.
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function rm(p) {
  const abs = path.join(root, p);
  if (!fs.existsSync(abs)) return;
  fs.rmSync(abs, { recursive: true, force: true });
  console.log("removed", p);
}

rm("node_modules");
rm(".expo");
rm(".expo-shared");
rm("package-lock.json");

console.log("clean complete");

