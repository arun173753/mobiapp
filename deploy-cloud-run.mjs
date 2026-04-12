import { GoogleAuth } from 'google-auth-library';
import { createReadStream, createWriteStream, readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';

const SA_KEY = JSON.parse(readFileSync('/tmp/gcp_sa.json', 'utf8'));
const PROJECT_ID = 'atoz-mobile-repair-488915';
const REGION = 'asia-south1';
const SERVICE_NAME = 'repair-backend';
const IMAGE = `${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME}`;
const WORKSPACE = '/home/runner/workspace';

const auth = new GoogleAuth({
  credentials: SA_KEY,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

async function getToken() {
  const client = await auth.getClient();
  return (await client.getAccessToken()).token;
}

async function main() {
  console.log('=== Step 1: Create source tarball ===');
  
  // Create tarball of build context
  const tarPath = '/tmp/source.tar.gz';
  execSync(`cd ${WORKSPACE} && tar -czf ${tarPath} \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist' \
    --exclude='server_dist' \
    --exclude='.expo' \
    --exclude='*.log' \
    --exclude='tmp' \
    --exclude='.local' \
    Dockerfile \
    package.json \
    package-lock.json \
    tsconfig.json \
    drizzle.config.ts \
    app.json \
    shared/ \
    server/ \
    scripts/ \
    patches/ \
    assets/ \
    static-build/ \
    2>/dev/null || true`, { stdio: 'pipe' });
  
  console.log('Tarball created:', tarPath);
  
  const token = await getToken();
  
  // Step 2: Get upload URL for Cloud Build
  console.log('\n=== Step 2: Get Cloud Build upload URL ===');
  const uploadResp = await fetch(
    `https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/builds:createGCSUpload`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }
  );
  
  if (!uploadResp.ok) {
    // Try the standard approach: upload to GCS bucket manually
    console.log('Direct upload not available, using GCS approach...');
    await buildViaGCS(token);
    return;
  }
  
  const uploadData = await uploadResp.json();
  console.log('Upload URL obtained');
  
  // Upload the tarball
  const tarContent = readFileSync(tarPath);
  const putResp = await fetch(uploadData.uploadUri, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/gzip', 'Content-Length': tarContent.length.toString() },
    body: tarContent,
  });
  
  console.log('Upload status:', putResp.status);
  await submitBuildFromUpload(token, uploadData.storageSource);
}

async function buildViaGCS(token) {
  // Find or create a GCS bucket for Cloud Build
  const BUCKET = `${PROJECT_ID}_cloudbuild`;
  const OBJECT = `source-${Date.now()}.tar.gz`;
  
  console.log('\n=== Step 2b: Upload to GCS bucket ===');
  const tarContent = readFileSync('/tmp/source.tar.gz');
  
  const uploadResp = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${OBJECT}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' },
      body: tarContent,
    }
  );
  
  if (!uploadResp.ok) {
    const err = await uploadResp.text();
    console.log('GCS upload error:', uploadResp.status, err.substring(0, 500));
    
    // Try creating the bucket first
    console.log('Trying to create bucket...');
    const createResp = await fetch(
      `https://storage.googleapis.com/storage/v1/b?project=${PROJECT_ID}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: BUCKET, location: REGION })
      }
    );
    console.log('Create bucket:', createResp.status);
    
    // Retry upload
    const retryResp = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${OBJECT}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' },
        body: tarContent,
      }
    );
    if (!retryResp.ok) {
      console.log('Retry upload failed:', retryResp.status, await retryResp.text());
      return;
    }
    console.log('Upload retry succeeded');
  } else {
    console.log('GCS upload succeeded');
  }
  
  await submitBuildFromGCS(token, BUCKET, OBJECT);
}

async function submitBuildFromGCS(token, bucket, object) {
  console.log('\n=== Step 3: Submit Cloud Build job ===');
  
  const buildConfig = {
    source: {
      storageSource: { bucket, object }
    },
    steps: [
      {
        name: 'gcr.io/cloud-builders/docker',
        args: ['build', '-t', IMAGE, '-f', 'Dockerfile', '.']
      },
      {
        name: 'gcr.io/cloud-builders/docker',
        args: ['push', IMAGE]
      }
    ],
    images: [IMAGE],
    options: { logging: 'CLOUD_LOGGING_ONLY' }
  };
  
  const buildResp = await fetch(
    `https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/builds`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildConfig)
    }
  );
  
  if (!buildResp.ok) {
    const err = await buildResp.text();
    console.log('Build submit error:', buildResp.status, err.substring(0, 1000));
    return;
  }
  
  const buildData = await buildResp.json();
  const buildId = buildData.metadata?.build?.id;
  console.log('Build submitted! ID:', buildId);
  console.log('Build name:', buildData.name);
  
  // Poll for completion
  await pollBuild(token, buildId, buildData.name);
}

async function pollBuild(token, buildId, buildName) {
  console.log('\n=== Step 4: Waiting for build to complete ===');
  const maxWait = 60; // Poll for up to 10 minutes (60 * 10s)
  
  for (let i = 0; i < maxWait; i++) {
    await new Promise(r => setTimeout(r, 10000)); // wait 10s
    
    const freshToken = await getToken();
    const statusResp = await fetch(
      `https://cloudbuild.googleapis.com/v1/${buildName}`,
      { headers: { Authorization: `Bearer ${freshToken}` } }
    );
    
    if (!statusResp.ok) {
      console.log('Status check error:', statusResp.status);
      continue;
    }
    
    const statusData = await statusResp.json();
    const status = statusData.status;
    console.log(`[${(i+1)*10}s] Build status: ${status}`);
    
    if (status === 'SUCCESS') {
      console.log('Build succeeded! Image:', IMAGE);
      await deployToCloudRun();
      return;
    } else if (status === 'FAILURE' || status === 'CANCELLED' || status === 'TIMEOUT') {
      console.log('Build failed:', status);
      console.log('Logs:', statusData.logUrl);
      return;
    }
  }
  
  console.log('Timed out waiting for build');
}

async function deployToCloudRun() {
  console.log('\n=== Step 5: Deploy to Cloud Run ===');
  const token = await getToken();
  
  const crUrl = `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/services/${SERVICE_NAME}`;
  const getResp = await fetch(crUrl, { headers: { Authorization: `Bearer ${token}` } });
  
  if (!getResp.ok) {
    console.log('Failed to get Cloud Run service:', getResp.status);
    return;
  }
  
  const svc = await getResp.json();
  console.log('Current service fetched, updating image...');
  
  // Update the container image
  svc.template.containers[0].image = IMAGE;
  
  const patchResp = await fetch(crUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(svc)
  });
  
  if (patchResp.ok) {
    console.log('✅ Cloud Run updated successfully!');
    console.log('New image deployed:', IMAGE);
  } else {
    const err = await patchResp.json();
    console.log('Cloud Run update error:', JSON.stringify(err, null, 2));
  }
}

await main();
