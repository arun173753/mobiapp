# Render Deployment Guide

## ⚡ Quick Deploy (5 minutes)

### 1. Go to Render Dashboard
Visit: https://dashboard.render.com

### 2. Click "New +" → "Web Service"

### 3. Select Repository
- Choose: `atozmobilerepaircourse-png/atoz-mobile-repair`
- Click "Connect"

### 4. Configure Service
Fill in these values:

| Field | Value |
|-------|-------|
| **Name** | `mobi-backend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npx esbuild server/index.ts --platform=node --bundle --format=cjs --external:*.node --outdir=server_dist` |
| **Start Command** | `NODE_ENV=production node server_dist/index.js` |
| **Plan** | `Free` |

### 5. Add Environment Variables
Copy-paste each one from your Replit Secrets:

```
SUPABASE_DATABASE_URL=postgresql://postgres.ttjqexqkdvflcwwkyloq:Arunkumar%40173@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
NEON_DATABASE_URL=(optional)
RAZORPAY_KEY_ID=(from Replit)
RAZORPAY_SECRET_KEY=(from Replit)
OPENAI_API_KEY=(from Replit)
BUNNY_STREAM_API_KEY=(from Replit)
BUNNY_STREAM_LIBRARY_ID=(from Replit)
BUNNY_STORAGE_API_KEY=(from Replit)
BUNNY_STORAGE_ZONE_NAME=arun-storag
BUNNY_STORAGE_REGION=uk
FAST2SMS_API_KEY=(from Replit)
GOOGLE_CLIENT_ID=456751858632-brh0ir7j9v2ks5kk6antp6q757kmhaus.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=(from Replit)
NVIDIA_API_KEY=(optional)
NODE_ENV=production
```

### 6. Click "Deploy"
Wait 3-5 minutes. You'll see:
```
✓ Deploy successful
Your service is live at: https://mobi-backend.onrender.com
```

### 7. That's it! ✅
Your app is now:
- Backend: Render
- Database: Supabase
- Frontend: Firebase

## Troubleshooting

**If deployment fails:**
1. Check "Logs" tab in Render
2. Most common: Missing environment variable
3. Re-add any missing variables and click "Deploy" again

**If frontend shows errors:**
1. Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
2. Clear browser cache
3. Check browser console for API errors

**If payments don't work:**
1. Verify `RAZORPAY_KEY_ID` and `RAZORPAY_SECRET_KEY` are set correctly
2. Check server logs in Render dashboard

## Cost
- Render: **Free tier** (~$0/month)
- Supabase: **Free tier** (~$0-10/month for your usage)
- Firebase: **Free tier** (~$0/month)
- **Total: ~$0-10/month vs ₹4.88K/month on Cloud Run** ✅

Enjoy your cheaper hosting!
