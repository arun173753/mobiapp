#!/bin/bash
set -euo pipefail

echo "=== Deploying Frontend to Firebase Hosting ==="

echo "[1/3] Building Expo web export..."
npx expo export --platform web --output-dir dist

echo "[2/3] Copying fonts..."
mkdir -p dist/_expo/static/fonts
cp node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/*.ttf dist/_expo/static/fonts/
find node_modules/@expo-google-fonts/inter -name "*.ttf" -exec cp {} dist/_expo/static/fonts/ \;

echo "[3/3] Deploying to Firebase Hosting..."
: "${FIREBASE_DEPLOY_TOKEN:?Set FIREBASE_DEPLOY_TOKEN (CI token from firebase login:ci)}"
FIREBASE_PROJECT="${FIREBASE_HOSTING_PROJECT:-arunmobi-app}"

FIREBASE_TOKEN="$FIREBASE_DEPLOY_TOKEN" \
  ./node_modules/.bin/firebase deploy --only hosting --project "$FIREBASE_PROJECT" --non-interactive

echo ""
echo "Frontend deployed successfully!"
