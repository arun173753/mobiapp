const { GoogleAuth } = require('google-auth-library');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { execSync } = require('child_process');

const SA_KEY = JSON.parse(readFileSync('/tmp/gcp_sa.json', 'utf8'));
const auth = new GoogleAuth({ credentials: SA_KEY, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const PROJECT_ID = 'mobi-backend-491410';
const REGION = 'asia-south1';
const BUCKET = PROJECT_ID + '_cloudbuild';
const IMAGE = `${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/repair-backend:latest`;
const OBJECT = 'source-v19-' + Date.now() + '.tar.gz';
const WORKSPACE = '/home/runner/workspace';
const TAR_PATH = '/tmp/source-deploy.tar.gz';

const getToken = async () => (await (await auth.getClient()).getAccessToken()).token;

// Python snippet to get token via metadata server (runs inside Cloud Build)
const pyGetToken = `python3 -c "import urllib.request,json; req=urllib.request.Request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',headers={'Metadata-Flavor':'Google'}); data=json.loads(urllib.request.urlopen(req).read()); print(data['access_token'])"`;

// Create the source tarball for Cloud Build (includes push-oci.js and server files)
console.log('=== Creating source tarball ===');
const includeFiles = [
  'push-oci.js',         // OCI push script that runs inside Cloud Build
  'server_dist',         // Fully-bundled server (all npm packages inlined, no node_modules needed)
  'shared',
  'assets',
  'app.json',
];
const optionalFiles = ['server/templates', 'static-build', 'patches'];
for (const f of optionalFiles) {
  if (existsSync(`${WORKSPACE}/${f}`)) includeFiles.push(f);
}

const tarArgs = includeFiles.map(f => `"${f}"`).join(' ');
execSync(
  `cd "${WORKSPACE}" && tar -czf "${TAR_PATH}" ${tarArgs} 2>&1`,
  { stdio: 'pipe' }
);
const tarSize = readFileSync(TAR_PATH).length;
console.log(`Tarball: ${TAR_PATH} (${(tarSize / 1024 / 1024).toFixed(2)} MB)`);
console.log('Includes:', includeFiles.join(', '));

const buildConfig = {
  source: { storageSource: { bucket: BUCKET, object: OBJECT } },
  steps: [
    {
      // push-oci.js downloads node:20-slim from Docker Hub, adds our /app layer, pushes to AR
      name: 'node:20',
      id: 'BuildAndPushImage',
      entrypoint: 'node',
      args: ['push-oci.js'],
      timeout: '600s'
    }
    // NOTE: gcloud DeployToCloudRun step removed — we deploy via Cloud Run REST API directly
    // after this build completes, which is more reliable and doesn't require gcloud in Cloud Build.
  ],
  options: { logging: 'CLOUD_LOGGING_ONLY' },
  timeout: '1000s'
};

writeFileSync('/tmp/build-config.json', JSON.stringify(buildConfig, null, 2));
console.log('Build config written. push-oci.js will build and push OCI image inside Cloud Build.');
console.log('server_dist/index.js is now fully bundled (26MB) with all npm packages inlined — no node_modules needed.');

(async () => {
  const token = await getToken();

  // Upload source tarball to GCS
  console.log('\n=== Uploading source tarball to GCS ===');
  const tarContent = readFileSync(TAR_PATH);
  const up = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${OBJECT}`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/gzip' },
      body: tarContent
    }
  );
  if (!up.ok) {
    console.error('Upload failed:', up.status, await up.text());
    process.exit(1);
  }
  console.log('Upload:', up.status, '✓');

  // Submit Cloud Build
  console.log('\n=== Submitting Cloud Build job ===');
  const resp = await fetch(
    `https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/builds`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildConfig)
    }
  );
  const d = await resp.json();
  if (!d.metadata?.build?.id) {
    console.error('Failed to start build:', JSON.stringify(d).slice(0, 500));
    process.exit(1);
  }
  const buildId = d.metadata.build.id;
  console.log('Build ID:', buildId);
  console.log('Log URL: https://console.cloud.google.com/cloud-build/builds/' + buildId + '?project=' + PROJECT_ID);

  // Poll until complete (max 15 minutes)
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const tok = await getToken();
    const r2 = await fetch(
      `https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/builds/${buildId}`,
      { headers: { Authorization: 'Bearer ' + tok } }
    );
    const d2 = await r2.json();
    const stepStatuses = (d2.steps || []).map(s => `${s.id || 'step'}:${s.status || 'PENDING'}`).join(', ');
    const elapsed = (i + 1) * 10;
    console.log(`[${elapsed}s] ${d2.status} | ${stepStatuses}`);

    if (!['QUEUED', 'WORKING'].includes(d2.status)) {
      if (d2.failureInfo) console.log('Failure info:', JSON.stringify(d2.failureInfo));

      if (d2.status === 'SUCCESS') {
        console.log('\n=== Image built and pushed! Now deploying to Cloud Run via REST API... ===');

        // ── Deploy image + sync env vars to Cloud Run via REST API ──────────────────
        console.log('\n=== Updating Cloud Run service with new image + env vars ===');
        try {
          const envToken = await getToken();
          const serviceUrl = `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/services/repair-backendarun`;

          // Get current service definition
          console.log('  Fetching current Cloud Run service definition...');
          const svcResp = await fetch(serviceUrl, {
            headers: { Authorization: 'Bearer ' + envToken }
          });
          const svc = await svcResp.json();
          console.log('  Service fetch status:', svcResp.status);

          if (!svc.template?.containers?.[0]) {
            console.error('  Could not read service template! Response:', JSON.stringify(svc).slice(0, 500));
            process.exit(1);
          }

          // Update the container image to the newly built one
          console.log('  Updating container image to:', IMAGE);
          svc.template.containers[0].image = IMAGE;

          // Force a new revision by adding a unique deploy timestamp annotation AND env var
          svc.template.annotations = svc.template.annotations || {};
          const deployTs = String(Date.now());
          svc.template.annotations['run.googleapis.com/deploy-timestamp'] = deployTs;
          console.log('  Force-new-revision annotation:', deployTs);

          // Build env map from existing vars, then apply overrides from Replit secrets
          const existingEnv = svc.template.containers[0].env || [];
          const envMap = {};
          for (const e of existingEnv) {
            if (e.name && e.value !== undefined) envMap[e.name] = e.value;
          }

          // Secrets to sync from Replit → Cloud Run
          const secretsToSync = [
            'SUPABASE_DATABASE_URL',
            'NEON_DATABASE_URL',
            'GOOGLE_CLIENT_SECRET',
            'FAST2SMS_API_KEY',
            'BULKBLASTER_API_KEY',
            'API_HOME_API_KEY',
            'BUNNY_STREAM_API_KEY',
            'BUNNY_STREAM_LIBRARY_ID',
            'BUNNY_STORAGE_API_KEY',
            'GCP_SA_KEY',
            'OPENAI_API_KEY',
            'RESEND_API_KEY',
            'MAILERSEND_API_KEY',
            'RAZORPAY_KEY_ID',
            'RAZORPAY_KEY_SECRET',
            'ONESIGNAL_APP_ID',
            'ONESIGNAL_REST_API_KEY',
          ];
          
          // Static env vars
          envMap['NODE_ENV'] = 'production';
          envMap['BUNNY_STORAGE_ZONE_NAME'] = 'arun-storag';
          envMap['BUNNY_STORAGE_REGION'] = 'uk';
          // Force new revision by changing this env var every deployment
          envMap['DEPLOY_TIMESTAMP'] = deployTs;

          let syncCount = 0;
          for (const key of secretsToSync) {
            const val = process.env[key];
            if (val) {
              envMap[key] = val;
              syncCount++;
              console.log(`  ✓ ${key} (${val.length} chars)`);
            } else {
              console.log(`  ⚠ ${key} not set in Replit env — skipping`);
            }
          }

          // Override DATABASE_URL with Supabase URL (preferred)
          const dbUrl = process.env.SUPABASE_DATABASE_URL || process.env.NEON_DATABASE_URL;
          if (dbUrl) {
            envMap['DATABASE_URL'] = dbUrl;
            const provider = process.env.SUPABASE_DATABASE_URL ? 'Supabase' : 'Neon';
            console.log(`  ✓ DATABASE_URL set to ${provider}`);
          }

          // Rebuild env array
          svc.template.containers[0].env = Object.entries(envMap).map(([name, value]) => ({ name, value }));

          // Remove fields that cause PATCH to fail
          delete svc.reconciling;
          delete svc.observedGeneration;
          delete svc.terminalCondition;
          delete svc.conditions;
          delete svc.latestReadyRevision;
          delete svc.latestCreatedRevision;
          delete svc.traffic;
          delete svc.trafficStatuses;
          delete svc.uri;
          delete svc.satisfiesPzs;
          delete svc.etag;
          delete svc.createTime;
          delete svc.updateTime;
          delete svc.creator;
          delete svc.lastModifier;

          // PATCH the service with new image + env vars
          console.log('  Sending PATCH request to Cloud Run...');
          const patchResp = await fetch(serviceUrl, {
            method: 'PATCH',
            headers: { Authorization: 'Bearer ' + envToken, 'Content-Type': 'application/json' },
            body: JSON.stringify(svc)
          });
          const patchData = await patchResp.json();
          
          if (patchResp.ok) {
            console.log(`  ✅ Cloud Run service updated: new image + ${syncCount} env var(s) synced`);
            console.log('  latestCreatedRevision from PATCH:', patchData.latestCreatedRevision || 'n/a');
            // Poll until new revision is ready (max 3 min)
            const maxWait = 180000;
            const pollInterval = 10000;
            const started = Date.now();
            let ready = false;
            while (Date.now() - started < maxWait) {
              await new Promise(r => setTimeout(r, pollInterval));
              const pollTok = await getToken();
              const svcPoll = await fetch(serviceUrl, { headers: { Authorization: 'Bearer ' + pollTok } });
              const svcData = await svcPoll.json();
              const latest = svcData.latestCreatedRevision || '';
              const readyRev = svcData.latestReadyRevision || '';
              const elapsed = Math.round((Date.now() - started) / 1000);
              console.log(`  [${elapsed}s] latestCreated=${latest.split('/').pop()} latestReady=${readyRev.split('/').pop()}`);
              if (latest === readyRev && latest !== '' && !svcData.reconciling) {
                console.log('  ✅ New revision is ready and serving!');
                ready = true;
                break;
              }
            }
            if (!ready) console.log('  ⚠ Timed out waiting for revision — check Cloud Run console');
          } else {
            console.error('  ❌ Failed to update Cloud Run service:', JSON.stringify(patchData).slice(0, 500));
            process.exit(1);
          }
        } catch (envErr) {
          console.error('  Deploy error:', envErr.message);
          process.exit(1);
        }

        console.log('\nDeploy complete! Live at: https://repair-backendarun-iaz6jex5fa-el.a.run.app');
      } else {
        console.error('Build FAILED with status:', d2.status);
        process.exit(1);
      }
      break;
    }
  }
})().catch(err => { console.error(err); process.exit(1); });

// Dummy export to prevent errors
module.exports = {};
