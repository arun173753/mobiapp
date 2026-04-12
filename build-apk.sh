#!/usr/bin/env bash
set -e

echo "=== Mobi APK Build (for testing & direct install) ==="
echo ""

# Use global eas command
EAS="eas"

# EXPO_TOKEN must be set in Replit Secrets to the kumarshraboni66 account token.
# Go to Replit Secrets, delete EXPO_TOKEN and re-add with the correct value.
if [ -z "$EXPO_TOKEN" ]; then
  echo "ERROR: EXPO_TOKEN secret is not set. Please set it in Replit Secrets."
  exit 1
fi

WHOAMI=$($EAS whoami 2>&1 | grep -v "eas-cli" | grep -v "upgrade" | grep -v "npm install" | grep -v "Proceeding" | grep -v "^$" | head -1) || true
echo "EAS user: $WHOAMI"
echo ""

echo "Starting APK build (preview profile)..."
echo "Build runs on Expo cloud — takes about 10-20 minutes."
echo "Monitor progress at: https://expo.dev/accounts/Kumarshraboni66/projects/mobi/builds"
echo ""

TMPDIR=/tmp/eas-build $EAS build -p android --profile preview --non-interactive

echo ""
echo "APK build complete! Download from:"
echo "https://expo.dev/accounts/Kumarshraboni66/projects/mobi/builds"
echo ""
echo "Install this APK directly on any Android device for testing."
