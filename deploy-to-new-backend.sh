#!/bin/bash
set -e

echo "=== Building Docker Image for New Backend ==="

PROJECT_ID="mobi-backend-491410"
REGION="asia-south1"
IMAGE_NAME="repair-backend"
REGISTRY="${REGION}-docker.pkg.dev"
REPO="cloud-run-source-deploy"
IMAGE_URL="${REGISTRY}/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:latest"

echo "Image URL: ${IMAGE_URL}"

# Authenticate with GCP
echo "[1/4] Setting up GCP credentials..."
echo "$GCP_SA_KEY" > /tmp/gcp_sa.json

# Build the Docker image
echo "[2/4] Building Docker image..."
docker build -t ${IMAGE_URL} -f - . << 'DOCKERFILE'
FROM node:20-slim

WORKDIR /app

# Copy bundled server (already built by esbuild)
COPY server_dist/ ./server_dist/
COPY server/templates/ ./server/templates/ 2>/dev/null || true
COPY static-build/ ./static-build/ 2>/dev/null || true
COPY patches/ ./patches/ 2>/dev/null || true
COPY shared/ ./shared/ 2>/dev/null || true
COPY bin/ ./bin/ 2>/dev/null || true

# Copy ffmpeg if available
RUN mkdir -p ./bin
COPY server_dist/bin/ffmpeg ./bin/ffmpeg 2>/dev/null || true
RUN chmod +x ./bin/ffmpeg 2>/dev/null || true

EXPOSE 8080
ENV PORT=8080 NODE_ENV=production
CMD ["node", "server_dist/index.js"]
DOCKERFILE

echo "✓ Docker image built"

# Push to Artifact Registry
echo "[3/4] Pushing to Artifact Registry..."
gcloud auth activate-service-account --key-file=/tmp/gcp_sa.json --project=${PROJECT_ID}
gcloud auth configure-docker ${REGISTRY}

docker push ${IMAGE_URL}
echo "✓ Image pushed: ${IMAGE_URL}"

# Update Cloud Run service
echo "[4/4] Updating Cloud Run service..."
gcloud run deploy repair-backendarun \
  --image=${IMAGE_URL} \
  --project=${PROJECT_ID} \
  --region=${REGION} \
  --platform=managed \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,SUPABASE_DATABASE_URL=${SUPABASE_DATABASE_URL},NEON_DATABASE_URL=${NEON_DATABASE_URL},GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET},FAST2SMS_API_KEY=${FAST2SMS_API_KEY},BUNNY_STREAM_API_KEY=${BUNNY_STREAM_API_KEY},BUNNY_STREAM_LIBRARY_ID=${BUNNY_STREAM_LIBRARY_ID},OPENAI_API_KEY=${OPENAI_API_KEY},BUNNY_STORAGE_API_KEY=${BUNNY_STORAGE_API_KEY},BUNNY_STORAGE_ZONE_NAME=arun-storag,BUNNY_STORAGE_REGION=uk"

echo ""
echo "✅ Deployment Complete!"
echo "   New Backend URL: https://repair-backendarun-838751841074.asia-south1.run.app"
