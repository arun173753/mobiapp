/**
 * Lightweight Cloud Run API shell for service "mobiapp".
 * Full Expo/API logic remains in repo root server/ for local/dev; extend this file or add routes as needed.
 */
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.disable("x-powered-by");
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.status(200).json({
    service: process.env.K_SERVICE || "mobiapp",
    project:
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      "mobi-backend-491410",
    region: process.env.REGION || "asia-south1",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`mobiapp listening on ${PORT}`);
});
