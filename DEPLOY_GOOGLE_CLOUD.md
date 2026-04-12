# Deploy Mobi Server to Google Cloud

## 🚀 Quick Backend Redeploy (Run on your local machine)

Your backend CORS has been updated to allow Firebase Hosting. To apply this to Cloud Run, run these commands from your local terminal (with gcloud installed and logged in):

```bash
# 1. Navigate to your project folder
cd /path/to/your/project

# 2. Build and deploy to Cloud Run
PROJECT_ID=mobile-repair-app-276b6   # replace if different
SERVICE_NAME=repair-backend
REGION=us-central1

gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME .
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 1 \
  --port 8080
```

Or to just update CORS without rebuilding (fastest):
```bash
gcloud run services update repair-backend \
  --region us-central1 \
  --update-env-vars ALLOWED_ORIGINS="https://mobile-repair-app-276b6.web.app,https://mobile-repair-app-276b6.firebaseapp.com,https://atozmobilerepair.in"
```

## Production Domain
**https://atozmobilerepair.in**

## What Gets Deployed

- **Express server** → Google Cloud Run (auto-scaling, serverless)
- **PostgreSQL database** → Google Cloud SQL (or Neon.tech)
- **Images & Videos** → Bunny.net CDN (no change)
- **Mobile app** → Expo / Median.co APK (update API URL to production domain)

## Prerequisites

1. Google Cloud account with billing enabled
2. `gcloud` CLI installed on your computer
3. A Google Cloud project created

## Step-by-Step Setup

### 1. Install & Login to Google Cloud CLI

```bash
curl https://sdk.cloud.google.com | bash
gcloud init
gcloud auth login
```

### 2. Create or Select a Google Cloud Project

```bash
gcloud projects create atozmobilerepair --name="AtoZ Mobile Repair"
gcloud config set project atozmobilerepair
gcloud services enable run.googleapis.com sqladmin.googleapis.com cloudbuild.googleapis.com
```

### 3. Create Cloud SQL PostgreSQL Database

```bash
gcloud sql instances create mobi-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=asia-south1 \
  --storage-size=10GB

gcloud sql users set-password postgres \
  --instance=mobi-db \
  --password=YOUR_SECURE_PASSWORD_HERE

gcloud sql databases create mobi --instance=mobi-db

# Note the connection name:
gcloud sql instances describe mobi-db --format="value(connectionName)"
```

### 4. Export Data from Replit (Run This on Replit)

```bash
pg_dump $DATABASE_URL --no-owner --no-acl > mobi_backup.sql
```

Download `mobi_backup.sql` from Replit Files.

### 5. Import Data to Cloud SQL

```bash
gsutil mb gs://mobi-backups-atozmobile
gsutil cp mobi_backup.sql gs://mobi-backups-atozmobile/

SA=$(gcloud sql instances describe mobi-db --format="value(serviceAccountEmailAddress)")
gsutil iam ch serviceAccount:$SA:objectViewer gs://mobi-backups-atozmobile

gcloud sql import sql mobi-db gs://mobi-backups-atozmobile/mobi_backup.sql --database=mobi
```

### 6. Build the Static Expo Bundle (Run on Replit First)

```bash
npm run expo:static:build
npm run server:build
```

Then download the project (or use Cloud Shell / GitHub).

### 7. Deploy to Cloud Run

```bash
gcloud run deploy mobi-server \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 10 \
  --port 8080 \
  --timeout 300 \
  --add-cloudsql-instances YOUR_PROJECT:asia-south1:mobi-db \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "APP_DOMAIN=https://atozmobilerepair.in" \
  --set-env-vars "DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@/mobi?host=/cloudsql/YOUR_PROJECT:asia-south1:mobi-db" \
  --set-env-vars "BUNNY_STORAGE_API_KEY=your_bunny_key" \
  --set-env-vars "BUNNY_STORAGE_ZONE_NAME=mobi-storage" \
  --set-env-vars "BUNNY_STORAGE_REGION=de" \
  --set-env-vars "RAZORPAY_KEY_ID=your_razorpay_key" \
  --set-env-vars "RAZORPAY_KEY_SECRET=your_razorpay_secret" \
  --set-env-vars "TWILIO_ACCOUNT_SID=your_twilio_sid" \
  --set-env-vars "TWILIO_AUTH_TOKEN=your_twilio_token" \
  --set-env-vars "TWILIO_PHONE_NUMBER=your_twilio_number" \
  --set-env-vars "RESEND_API_KEY=your_resend_api_key" \
  --set-env-vars "FIREBASE_SERVICE_ACCOUNT=your_firebase_json" \
  --set-env-vars "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=268167980763-tb4kmkkbugqmlielkg4udorm34mt55a4.apps.googleusercontent.com" \
  --set-env-vars "GOOGLE_CLIENT_SECRET=your_google_client_secret_json"
```

### 8. Connect Your Custom Domain (atozmobilerepair.in)

**Option A — Cloud Run Domain Mapping:**
```bash
gcloud run domain-mappings create \
  --service mobi-server \
  --domain atozmobilerepair.in \
  --region asia-south1
```

Then update your DNS records as instructed by Cloud Run (CNAME/A records).

**Option B — Cloudflare or your DNS provider:**
- Point an A record for `atozmobilerepair.in` to the Cloud Run IP
- Or set a CNAME to the Cloud Run URL

### 9. Update Google OAuth Redirect URI

In **Google Cloud Console → APIs & Services → Credentials**:
- Add `https://atozmobilerepair.in/api/auth/google/callback` to **Authorized redirect URIs**
- Remove any old Replit URLs like `*.replit.app` or `*.replit.dev`

### 10. Update Razorpay Webhook

In **Razorpay Dashboard → Settings → Webhooks**:
- Set webhook URL to: `https://atozmobilerepair.in/api/razorpay/webhook`
- Remove any old Replit webhook URLs

### 11. Update Median.co / APK

In your APK wrapper:
- Update the app URL to: `https://atozmobilerepair.in`
- Rebuild and republish the APK

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `PORT` | Server port (Cloud Run sets this automatically) | `8080` |
| `APP_DOMAIN` | Your production domain | `https://atozmobilerepair.in` |
| `DATABASE_URL` | PostgreSQL connection string | Cloud SQL socket URL |
| `BUNNY_STORAGE_API_KEY` | Bunny.net storage password | |
| `BUNNY_STORAGE_ZONE_NAME` | Bunny.net zone | `mobi-storage` |
| `BUNNY_STORAGE_REGION` | Bunny.net region | `de` |
| `RAZORPAY_KEY_ID` | Razorpay API key | |
| `RAZORPAY_KEY_SECRET` | Razorpay secret | |
| `TWILIO_ACCOUNT_SID` | Twilio SID | |
| `TWILIO_AUTH_TOKEN` | Twilio token | |
| `TWILIO_PHONE_NUMBER` | Twilio number | |
| `RESEND_API_KEY` | Resend email API key | |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON | |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google OAuth client ID | |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret JSON | |
| `ALLOWED_ORIGINS` | Extra CORS origins (comma-separated, optional) | |

## Replit Independence Checklist

- [x] CORS: Only allows `atozmobilerepair.in` in production
- [x] PORT: Uses `process.env.PORT` (Cloud Run sets this to 8080 automatically)
- [x] Google OAuth redirect URI: `https://atozmobilerepair.in/api/auth/google/callback`
- [x] Razorpay checkout pages: Use `APP_DOMAIN` env var (no Replit hardcoding)
- [x] Email unsubscribe links: Use `https://atozmobilerepair.in`
- [x] Email scheduler: Uses `https://atozmobilerepair.in`
- [x] Dockerfile: Ready for Cloud Run (`FROM node:20-slim`, port 8080)
- [x] Cloud Build: `cloudbuild.yaml` configured for `asia-south1` region

## 12. Deploy Frontend (Web) to Firebase Hosting

Since you want the frontend to be independent of Replit, you can host the web version of your Mobi app on Firebase Hosting for free/low cost.

### 1. Build the Web App
```bash
# On your local machine or Replit
npm run expo:static:build
```
This creates a `dist` folder with your static web files.

### 2. Install Firebase CLI
```bash
npm install -g firebase-tools
firebase login
```

### 3. Initialize Firebase
```bash
firebase init hosting
```
- Select your project
- Public directory: `dist`
- Configure as single-page app: `Yes`
- Set up automatic builds with GitHub: `Optional`

### 4. Deploy
```bash
firebase deploy --only hosting
```

### 5. Final Replit Independence Checklist
- [x] Backend on Cloud Run: `https://atozmobilerepair.in`
- [x] Database on Cloud SQL
- [x] Frontend on Firebase: `https://your-app.web.app` (or your custom domain)
- [x] Google OAuth: Update URIs in Google Console
- [x] Razorpay: Update Webhooks to your domain
- [x] Median.co: Update app URL to your production domain

---

## Updating the Server After Code Changes

```bash
# From your local machine with the project files:
gcloud run deploy mobi-server --source . --region asia-south1
```

Cloud Run does zero-downtime deployment automatically.

## Estimated Monthly Costs

| Service | Estimated Cost |
|---------|---------------|
| Cloud Run (min 1 instance) | ~$15-30/month |
| Cloud SQL db-f1-micro | ~$10/month |
| Bunny.net CDN | Your existing plan |
| **Total** | **~$25-40/month** |
