/**
 * Deploy only ./mobiapp to Cloud Run (small upload, no Expo tree).
 * gcloud builds submit ./mobiapp --config mobiapp/cloudbuild.yaml
 */

const { execSync } = require("child_process");
const path = require("path");

const PROJECT_ID = "mobi-backend-491410";
const REGION = "us-central1";
const SERVICE = "mobiapp";

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

  run(`gcloud config set project ${PROJECT_ID}`);
  run(`gcloud builds submit ./mobiapp --config mobiapp/cloudbuild.yaml --project=${PROJECT_ID}`);

  const url = runCapture(
    `gcloud run services describe ${SERVICE} --region=${REGION} --project=${PROJECT_ID} --format="value(status.url)"`,
  );
  console.log("\n========================================");
  console.log("Cloud Run URL (mobiapp):");
  console.log(url);
  console.log("========================================\n");
}

main();
