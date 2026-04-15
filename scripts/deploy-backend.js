/**
 * Deploy backend to Cloud Run (repair-backendarun, asia-south1).
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PROJECT_ID = "mobi-backend-491410";
const REGION = "asia-south1";
const SERVICE = "repair-backendarun";
// Use Artifact Registry (gcr.io create-on-push is often disabled).
const ARTIFACT_REGION = process.env.ARTIFACT_REGION || "us-central1";
const ARTIFACT_REPO = process.env.ARTIFACT_REPO || "mobi-repo";
const IMAGE = `${ARTIFACT_REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/${SERVICE}:latest`;

function run(cmd) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", shell: true });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf8", shell: true }).trim();
}

function main() {
  const root = path.resolve(__dirname, "..");
  process.chdir(root);

  // Ensure dependencies exist for local build
  if (!fs.existsSync(path.join(root, "node_modules"))) {
    run("npm ci");
  }

  // Build server bundle for Docker context (Dockerfile copies ./server_dist)
  run("npm run server:build");

  const outFile = path.join(root, "server_dist", "index.js");
  if (!fs.existsSync(outFile)) {
    throw new Error(`Missing build output: ${outFile}. Run \`npm run server:build\` and ensure .gcloudignore/.dockerignore do not exclude server_dist/.`);
  }

  run(`gcloud config set project ${PROJECT_ID}`);
  run(`gcloud builds submit --tag ${IMAGE} .`);
  run(
    `gcloud run deploy ${SERVICE} --image ${IMAGE} --region ${REGION} --platform managed --allow-unauthenticated --memory 1Gi --timeout 300 --port 8080`,
  );

  const url = runCapture(
    `gcloud run services describe ${SERVICE} --region=${REGION} --project=${PROJECT_ID} --format="value(status.url)"`,
  );
  console.log("\n========================================");
  console.log(`Cloud Run URL (${SERVICE}):`);
  console.log(url);
  console.log("========================================\n");
}

main();

