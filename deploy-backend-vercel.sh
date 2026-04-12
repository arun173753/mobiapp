#!/bin/bash
set -e

echo "=== Deploying Backend to Vercel ==="

if [ -z "$VERCEL_TOKEN" ]; then
  echo "❌ VERCEL_TOKEN not set. Please add it as a Replit secret."
  exit 1
fi

if [ -z "$SUPABASE_DATABASE_URL" ]; then
  echo "❌ SUPABASE_DATABASE_URL not set. Please add it as a Replit secret."
  exit 1
fi

echo "[1/4] Installing @vercel/node types..."
npm install --save-dev @vercel/node 2>/dev/null || true

echo "[2/4] Deploying backend to Vercel..."
DEPLOY_URL=$(npx vercel deploy \
  --token "$VERCEL_TOKEN" \
  --yes \
  --prod \
  --scope atozmobilerepaircourse-1699s-projects \
  --env SUPABASE_DATABASE_URL="$SUPABASE_DATABASE_URL" \
  --env NODE_ENV=production \
  --env FAST2SMS_API_KEY="${FAST2SMS_API_KEY:-}" \
  --env OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  --env BUNNY_STREAM_API_KEY="${BUNNY_STREAM_API_KEY:-}" \
  --env BUNNY_STREAM_LIBRARY_ID="${BUNNY_STREAM_LIBRARY_ID:-}" \
  --env BUNNY_STORAGE_API_KEY="${BUNNY_STORAGE_API_KEY:-}" \
  --env BUNNY_STORAGE_ZONE_NAME="arun-storag" \
  --env BUNNY_STORAGE_REGION="uk" \
  --env GOOGLE_CLIENT_ID="456751858632-brh0ir7j9v2ks5kk6antp6q757kmhaus.apps.googleusercontent.com" \
  --env NVIDIA_API_KEY="${NVIDIA_API_KEY:-}" \
  --env VERCEL_FRONTEND_URL="${VERCEL_FRONTEND_URL:-}" \
  2>&1 | grep -E "https://" | head -1)

echo "[3/4] Backend deployed!"
echo "  URL: $DEPLOY_URL"

echo "[4/4] Saving backend URL for frontend..."
# Export for use in frontend deploy
echo "VERCEL_BACKEND_URL=$DEPLOY_URL" > /tmp/vercel-backend-url.env
echo "export VERCEL_BACKEND_URL='$DEPLOY_URL'"

echo ""
echo "✅ Backend deployed successfully!"
echo "Live at: $DEPLOY_URL"
echo ""
echo "Next step: Run deploy-frontend-vercel.sh to deploy the frontend"
echo "Or set VERCEL_BACKEND_URL='$DEPLOY_URL' and run the frontend deploy script"
