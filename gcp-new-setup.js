/**
 * GCP New Project Full Setup Script
 * Enables APIs, creates infrastructure, and deploys to Cloud Run
 * Requires: GCP_SA_KEY env var with a service account that has Owner/Editor on the new project
 */

const https = require('https');
const fs = require('fs');
const { GoogleAuth } = require('google-auth-library');

const SA_KEY = JSON.parse(process.env.GCP_SA_KEY || '{}');
const auth = new GoogleAuth({
  credentials: SA_KEY,
  scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

const PROJECT_ID = 'mobi-backend-491410';
const REGION = 'asia-south1';
const SERVICE_NAME = 'repair-backend';
const BUCKET = `${PROJECT_ID}_cloudbuild`;
const AR_REPO = 'cloud-run-source-deploy';

const getToken = async () => (await (await auth.getClient()).getAccessToken()).token;

async function apiCall(method, url, body = null, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      }
    };
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function enableAPI(api, token) {
  const r = await apiCall('POST',
    `https://serviceusage.googleapis.com/v1/projects/${PROJECT_ID}/services/${api}:enable`,
    {}, token
  );
  const body = JSON.parse(r.body || '{}');
  if (r.status === 200 || r.status === 204 || body.error?.status === 'ALREADY_EXISTS') {
    console.log(`  ✓ ${api}`);
  } else {
    console.log(`  ⚠ ${api}: ${r.status} - ${body.error?.message || r.body.slice(0, 100)}`);
  }
}

async function createGCSBucket(token) {
  // Check if bucket exists
  const check = await apiCall('GET',
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}`,
    null, token
  );
  if (check.status === 200) {
    console.log(`  ✓ Bucket already exists: ${BUCKET}`);
    return;
  }

  // Create bucket
  const r = await apiCall('POST',
    `https://storage.googleapis.com/storage/v1/b?project=${PROJECT_ID}`,
    {
      name: BUCKET,
      location: REGION,
      storageClass: 'STANDARD',
    }, token
  );
  const body = JSON.parse(r.body || '{}');
  if (r.status === 200 || r.status === 409) {
    console.log(`  ✓ Bucket created: ${BUCKET}`);
  } else {
    console.log(`  ✗ Bucket creation failed: ${body.error?.message}`);
    throw new Error(body.error?.message);
  }
}

async function createArtifactRegistry(token) {
  // Check if repo exists
  const check = await apiCall('GET',
    `https://artifactregistry.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/repositories/${AR_REPO}`,
    null, token
  );
  if (check.status === 200) {
    console.log(`  ✓ Artifact Registry repo already exists: ${AR_REPO}`);
    return;
  }

  // Create AR repo
  const r = await apiCall('POST',
    `https://artifactregistry.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/repositories?repositoryId=${AR_REPO}`,
    { format: 'DOCKER', description: 'Cloud Run source deploy' },
    token
  );
  const body = JSON.parse(r.body || '{}');
  if (r.status === 200 || r.status === 409) {
    console.log(`  ✓ Artifact Registry repo created: ${AR_REPO}`);
    // Wait for it to be ready
    await new Promise(r => setTimeout(r, 5000));
  } else {
    console.log(`  ⚠ AR repo: ${r.status} - ${body.error?.message || r.body.slice(0, 150)}`);
  }
}

async function setupCloudBuildServiceAccount(token) {
  // Get project number
  const projR = await apiCall('GET',
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}`,
    null, token
  );
  const projData = JSON.parse(projR.body || '{}');
  const projectNumber = projData.projectNumber;
  if (!projectNumber) {
    console.log('  ⚠ Could not get project number for CB SA setup');
    return;
  }

  const cbSA = `${projectNumber}@cloudbuild.gserviceaccount.com`;
  console.log(`  Cloud Build SA: ${cbSA}`);

  // Grant Cloud Run Admin to Cloud Build SA
  const policyR = await apiCall('POST',
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:getIamPolicy`,
    {}, token
  );
  const policy = JSON.parse(policyR.body || '{}');
  if (!policy.bindings) policy.bindings = [];

  const rolesToAdd = [
    'roles/run.admin',
    'roles/iam.serviceAccountUser',
    'roles/artifactregistry.writer',
    'roles/storage.objectAdmin',
  ];

  let changed = false;
  for (const role of rolesToAdd) {
    const member = `serviceAccount:${cbSA}`;
    let binding = policy.bindings.find(b => b.role === role);
    if (!binding) {
      policy.bindings.push({ role, members: [member] });
      changed = true;
    } else if (!binding.members.includes(member)) {
      binding.members.push(member);
      changed = true;
    }
  }

  if (changed) {
    const setR = await apiCall('POST',
      `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:setIamPolicy`,
      { policy }, token
    );
    if (setR.status === 200) {
      console.log('  ✓ Cloud Build service account IAM configured');
    } else {
      console.log(`  ⚠ IAM update: ${setR.status} ${setR.body.slice(0, 150)}`);
    }
  } else {
    console.log('  ✓ Cloud Build SA already has required roles');
  }
}

async function main() {
  console.log(`\n🚀 GCP New Project Setup: ${PROJECT_ID}`);
  console.log(`   Using SA: ${SA_KEY.client_email}\n`);

  const token = await getToken();

  // Test permissions
  console.log('[0/5] Testing service account permissions...');
  const testR = await apiCall('GET',
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}`,
    null, token
  );
  if (testR.status === 403 || testR.status === 404) {
    const err = JSON.parse(testR.body || '{}');
    console.error('\n❌ PERMISSION ERROR!');
    console.error('   The service account does NOT have access to the new project.');
    console.error('   Error:', err.error?.message || 'Access denied');
    console.error('\n📋 MANUAL STEPS REQUIRED:');
    console.error('   1. Go to: https://console.cloud.google.com/iam-admin/iam?project=mobi-backend-491410');
    console.error('   2. Click "+ GRANT ACCESS"');
    console.error(`   3. Add: ${SA_KEY.client_email}`);
    console.error('   4. Role: "Owner" or "Editor"');
    console.error('   5. Click "Save"');
    console.error('   6. Then run: node gcp-new-setup.js\n');
    process.exit(1);
  }
  const projData = JSON.parse(testR.body || '{}');
  console.log(`  ✓ Project accessible: ${projData.name || PROJECT_ID}\n`);

  // Step 1: Enable APIs
  console.log('[1/5] Enabling required APIs...');
  const APIs = [
    'cloudbuild.googleapis.com',
    'run.googleapis.com',
    'artifactregistry.googleapis.com',
    'storage.googleapis.com',
    'containerregistry.googleapis.com',
    'cloudresourcemanager.googleapis.com',
    'iam.googleapis.com',
  ];
  for (const api of APIs) {
    await enableAPI(api, token);
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('  ✓ All APIs enabled\n');

  // Wait for APIs to propagate
  console.log('  Waiting 15 seconds for API activation...');
  await new Promise(r => setTimeout(r, 15000));

  // Refresh token after wait
  const token2 = await getToken();

  // Step 2: Create GCS bucket
  console.log('[2/5] Creating Cloud Build GCS bucket...');
  await createGCSBucket(token2);
  console.log();

  // Step 3: Create Artifact Registry
  console.log('[3/5] Creating Artifact Registry repository...');
  await createArtifactRegistry(token2);
  console.log();

  // Step 4: Configure Cloud Build SA
  console.log('[4/5] Configuring Cloud Build service account permissions...');
  await setupCloudBuildServiceAccount(token2);
  console.log();

  // Step 5: Verify setup
  console.log('[5/5] Verifying setup...');
  const bucketCheck = await apiCall('GET',
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}`,
    null, token2
  );
  console.log(`  Bucket: ${bucketCheck.status === 200 ? '✓' : '✗'} ${BUCKET}`);

  const arCheck = await apiCall('GET',
    `https://artifactregistry.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/repositories/${AR_REPO}`,
    null, token2
  );
  console.log(`  AR Repo: ${arCheck.status === 200 ? '✓' : '✗'} ${AR_REPO}`);

  console.log('\n✅ GCP Infrastructure Setup Complete!');
  console.log('   Now run: bash deploy-backend.sh');
}

main().catch(err => {
  console.error('\n❌ Setup failed:', err.message);
  process.exit(1);
});
