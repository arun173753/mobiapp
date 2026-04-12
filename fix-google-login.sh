#!/bin/bash
# Fixed Google login redirect URL script
# This script ensures the backend is using the exact redirect URI required by Google Cloud Console

echo "Setting Google OAuth redirect URI to: https://repair-backend-3siuld7gbq-el.a.run.app/api/auth/google/callback"

# Update the redirectUri in server/routes.ts
# Using a more robust sed pattern to replace the dynamic string with the static one
sed -i 's|const redirectUri = `${protocol}://${host}/api/auth/google/callback`;|const redirectUri = "https://repair-backend-3siuld7gbq-el.a.run.app/api/auth/google/callback";|g' server/routes.ts

echo "Backend routes updated. Starting deployment..."
bash deploy-backend.sh
