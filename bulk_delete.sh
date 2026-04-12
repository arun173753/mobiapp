#!/bin/bash

# First, log in to get session token
echo "📱 Logging in as admin..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5000/api/otp/request \
  -H "Content-Type: application/json" \
  -d '{"phone":"8179142535"}')
echo "Request OTP response: $LOGIN_RESPONSE"

# Verify OTP (any code works for this admin)
VERIFY_RESPONSE=$(curl -s -X POST http://localhost:5000/api/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone":"8179142535","otp":"000000","deviceId":"admin-bulk-delete"}')
echo "Verify response: $VERIFY_RESPONSE"

SESSION_TOKEN=$(echo "$VERIFY_RESPONSE" | grep -o '"sessionToken":"[^"]*' | cut -d'"' -f4)
echo "Session token: $SESSION_TOKEN"

if [ -z "$SESSION_TOKEN" ]; then
  echo "❌ Failed to get session token"
  exit 1
fi

# Now call the bulk delete endpoint
echo ""
echo "🗑️ Deleting all users except admins..."
DELETE_RESPONSE=$(curl -s -X POST http://localhost:5000/api/admin/bulk-delete-users \
  -H "Content-Type: application/json" \
  -H "x-session-token: $SESSION_TOKEN" \
  -d '{"keepPhones":["8179142535","9398391742"]}')

echo "Delete response: $DELETE_RESPONSE"

# Parse and show stats
echo ""
echo "📊 User statistics after deletion:"
curl -s -X GET http://localhost:5000/api/profiles | jq 'map(select(.blocked == 0)) | map({name, phone, role}) | .[0:5]' 2>/dev/null || echo "Active users: (check admin panel)"
