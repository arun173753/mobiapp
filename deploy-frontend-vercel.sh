#!/bin/bash
set -e

echo "=== Deploying Frontend to Vercel ==="

if [ -z "$VERCEL_TOKEN" ]; then
  echo "❌ VERCEL_TOKEN not set. Please add it as a Replit secret."
  exit 1
fi

# Load backend URL if set from previous backend deploy
if [ -f /tmp/vercel-backend-url.env ]; then
  source /tmp/vercel-backend-url.env
fi

BACKEND_URL="${VERCEL_BACKEND_URL:-https://repair-backend-3siuld7gbq-el.a.run.app}"
echo "  Backend URL: $BACKEND_URL"

echo "[1/3] Building Expo web export..."
EXPO_PUBLIC_DOMAIN=$(echo "$BACKEND_URL" | sed 's|https://||') \
npm run expo:static:build-vercel

echo "[2/3] Copying fonts..."
mkdir -p dist-vercel/_expo/static/fonts
cp node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/*.ttf dist-vercel/_expo/static/fonts/ 2>/dev/null || true
find node_modules/@expo-google-fonts/inter -name "*.ttf" -exec cp {} dist-vercel/_expo/static/fonts/ \; 2>/dev/null || true

echo "[3/3] Deploying to Vercel..."
# Create a vercel config for the frontend static site
cat > dist-vercel/vercel.json << 'EOF'
{
  "rewrites": [
    { "source": "/((?!_expo|assets|favicon.ico|metadata.json).*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/index.html",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache" }
      ]
    }
  ]
}
EOF

FRONTEND_URL=$(cd dist-vercel && npx vercel deploy \
  --token "$VERCEL_TOKEN" \
  --yes \
  --prod \
  2>&1 | tail -1)

echo ""
echo "✅ Frontend deployed successfully!"
echo "Live at: $FRONTEND_URL"
echo ""
echo "Update VERCEL_FRONTEND_URL='$FRONTEND_URL' in your Replit secrets,"
echo "then redeploy backend to allow CORS from this URL."
