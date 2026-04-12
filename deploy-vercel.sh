#!/bin/bash
set -euo pipefail
# Set in environment or .env (never commit tokens)
: "${VERCEL_TOKEN:?Set VERCEL_TOKEN (Vercel personal access token)}"
PROJECT_NAME="${VERCEL_PROJECT_NAME:-mobi-repair}"

echo "Checking Vercel projects..."
PROJECTS=$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects" | grep -o '"name":"[^"]*"' | head -5)

echo "Found projects: $PROJECTS"

echo "Creating deployment..."
DEPLOYMENT=$(curl -s -X POST \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.vercel.com/v13/deployments" \
  -d '{
    "name": "'$PROJECT_NAME'",
    "files": [],
    "projectSettings": {
      "buildCommand": "npx expo export -p web",
      "outputDirectory": "dist"
    }
  }')

echo "$DEPLOYMENT" | head -100
