#!/bin/bash
set -e

# Install dependencies
npm install

# Build the server if TypeScript is present
if [ -f "server/routes.ts" ]; then
  npm run server:build
fi

echo "Post-merge setup completed successfully"
