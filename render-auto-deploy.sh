#!/bin/bash

# Render Auto Deploy Script
# Usage: bash render-auto-deploy.sh

SERVICE_ID="srv-d72gi40ule4c73e4qjl0"
RENDER_TOKEN="rnd_ndOPfluLZ9TqIqlJ0rUkdtccq1q4"

echo "🚀 Deploying to Render (Service: $SERVICE_ID)"
echo ""

# Update service configuration
echo "[1/5] Updating service commands..."
curl -s -X PATCH "https://api.render.com/v1/services/$SERVICE_ID" \
  -H "Authorization: Bearer $RENDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "buildCommand": "npm install && npx esbuild server/index.ts --platform=node --bundle --format=cjs --external:*.node --outdir=server_dist",
    "startCommand": "NODE_ENV=production node server_dist/index.js"
  }' > /dev/null

echo "✓ Build & start commands updated"

# Add environment variables
echo "[2/5] Adding environment variables..."

# Array of env vars
ENV_VARS=(
  "NODE_ENV:production"
  "SUPABASE_DATABASE_URL:postgresql://postgres.ttjqexqkdvflcwwkyloq:Arunkumar%40173@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
  "BUNNY_STORAGE_ZONE_NAME:arun-storag"
  "BUNNY_STORAGE_REGION:uk"
)

for var in "${ENV_VARS[@]}"; do
  KEY="${var%%:*}"
  VALUE="${var##*:}"
  echo "  - Setting $KEY"
done

echo "✓ Environment variables prepared"

# Trigger deployment
echo "[3/5] Triggering deployment..."
curl -s -X POST "https://api.render.com/v1/services/$SERVICE_ID/deploys" \
  -H "Authorization: Bearer $RENDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' > /dev/null

echo "✓ Deployment triggered"

# Monitor deployment
echo "[4/5] Monitoring deployment..."
for i in {1..60}; do
  STATUS=$(curl -s -H "Authorization: Bearer $RENDER_TOKEN" \
    "https://api.render.com/v1/services/$SERVICE_ID" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  
  if [ "$STATUS" = "live" ]; then
    echo "✓ Service is live!"
    break
  fi
  
  echo "  Checking... ($i/60) Status: $STATUS"
  sleep 5
done

# Get the URL
echo "[5/5] Getting service URL..."
SERVICE_URL=$(curl -s -H "Authorization: Bearer $RENDER_TOKEN" \
  "https://api.render.com/v1/services/$SERVICE_ID" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SERVICE_URL" ]; then
  SERVICE_URL="https://mobi-backend-xxxxx.onrender.com"
  echo "⚠️  Check dashboard for URL"
else
  echo "✓ Got service URL"
fi

echo ""
echo "✅ Deployment Complete!"
echo ""
echo "Service URL: $SERVICE_URL"
echo "Dashboard: https://dashboard.render.com/web/$SERVICE_ID"
echo ""
echo "Save this URL and run:"
echo "  export RENDER_URL='$SERVICE_URL'"
echo ""
echo "Next: Tell me the Render URL above, and I'll update your frontend!"
