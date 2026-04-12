#!/bin/bash
set -e

echo "=== Preparing Backend for Render Deployment ==="

echo "[1/3] Building server bundle..."
npx esbuild server/index.ts --platform=node --bundle --format=cjs --external:*.node --outdir=server_dist 2>&1 | tail -5

echo "[2/3] Creating Render configuration..."
cat > render.yaml << 'EOF'
services:
  - type: web
    name: mobi-backend
    runtime: node
    buildCommand: npm install && npx esbuild server/index.ts --platform=node --bundle --format=cjs --external:*.node --outdir=server_dist
    startCommand: NODE_ENV=production node server_dist/index.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3000
    envVarGroups:
      - id: database
        envVars:
          - key: SUPABASE_DATABASE_URL
            sync: false
          - key: NEON_DATABASE_URL
            sync: false
          - key: DATABASE_URL
            sync: false
      - id: payment
        envVars:
          - key: RAZORPAY_KEY_ID
            sync: false
          - key: RAZORPAY_SECRET_KEY
            sync: false
      - id: integrations
        envVars:
          - key: OPENAI_API_KEY
            sync: false
          - key: BUNNY_STREAM_API_KEY
            sync: false
          - key: BUNNY_STREAM_LIBRARY_ID
            sync: false
          - key: BUNNY_STORAGE_API_KEY
            sync: false
          - key: BUNNY_STORAGE_ZONE_NAME
            sync: false
          - key: BUNNY_STORAGE_REGION
            sync: false
          - key: FAST2SMS_API_KEY
            sync: false
          - key: GOOGLE_CLIENT_ID
            sync: false
          - key: GOOGLE_CLIENT_SECRET
            sync: false
EOF

echo "[3/3] Configuration ready!"
echo ""
echo "✅ Render deployment prepared!"
echo ""
echo "Next steps:"
echo "1. Commit this repo to GitHub (if not already done)"
echo "2. Go to https://render.com"
echo "3. Create new Web Service"
echo "4. Connect your GitHub repo"
echo "5. Set Environment Variables:"
echo "   - SUPABASE_DATABASE_URL=postgresql://postgres.ttjqexqkdvflcwwkyloq:...@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
echo "   - NODE_ENV=production"
echo "   - PORT=3000"
echo "   - (Add other secrets from Replit)"
echo "6. Deploy!"
echo ""
echo "Your Render backend URL will be displayed after deployment"
