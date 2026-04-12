#!/bin/bash

REGION="asia-south1"
PROJECT_ID="atoz-mobile-repair-488915"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/repair-backend:latest"

echo "=== Step 1: Setup crane ==="
cp ./crane /usr/local/bin/crane || { echo "cp crane failed"; exit 1; }
chmod +x /usr/local/bin/crane
/usr/local/bin/crane version || { echo "crane version failed"; exit 1; }
echo "crane OK"

echo "=== Step 2: Get token via python3 ==="
TOKEN=$(python3 -c "import urllib.request, json; req=urllib.request.Request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', headers={'Metadata-Flavor': 'Google'}); print(json.loads(urllib.request.urlopen(req, timeout=10).read())['access_token'])") || { echo "python3 token failed"; exit 1; }
echo "token length: ${#TOKEN}"
[ -z "$TOKEN" ] && echo "empty token" && exit 1

echo "=== Step 3: Auth crane ==="
echo "$TOKEN" | /usr/local/bin/crane auth login "${REGION}-docker.pkg.dev" --username oauth2accesstoken --password-stdin || { echo "crane auth failed"; exit 1; }
echo "auth OK"

echo "=== Step 4: Create app layer ==="
mkdir -p /workspace/lyr/app/server
cp -r server_dist /workspace/lyr/app/ || { echo "cp server_dist failed"; exit 1; }
cp -r shared /workspace/lyr/app/ || { echo "cp shared failed"; exit 1; }
cp -r assets /workspace/lyr/app/ || { echo "cp assets failed"; exit 1; }
cp -r server/templates /workspace/lyr/app/server/ || { echo "cp templates failed"; exit 1; }
cp app.json /workspace/lyr/app/ || { echo "cp app.json failed"; exit 1; }
tar -czf /workspace/app-layer.tar.gz -C /workspace/lyr . || { echo "tar failed"; exit 1; }
echo "layer OK"

echo "=== Step 5: crane append ==="
/usr/local/bin/crane append -b node:20-slim -f /workspace/app-layer.tar.gz -t "$IMAGE" || { echo "crane append failed"; exit 1; }
echo "append OK"

echo "=== Step 6: crane mutate ==="
/usr/local/bin/crane mutate "$IMAGE" --workdir /app --env PORT=8080 --env NODE_ENV=production --cmd "node,server_dist/index.js" || { echo "crane mutate failed"; exit 1; }
echo "mutate OK"

echo "=== Image ready ==="
/usr/local/bin/crane digest "$IMAGE"
