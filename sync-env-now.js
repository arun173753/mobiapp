const { GoogleAuth } = require('google-auth-library');
const { readFileSync } = require('fs');

const SA_KEY = JSON.parse(readFileSync('/tmp/gcp_sa.json', 'utf8'));
const auth = new GoogleAuth({ credentials: SA_KEY, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const PROJECT_ID = 'atoz-mobile-repair-488915';
const REGION = 'asia-south1';

const getToken = async () => (await (await auth.getClient()).getAccessToken()).token;

const secretsToSync = [
  'GOOGLE_CLIENT_SECRET',
  'FAST2SMS_API_KEY',
  'BUNNY_STREAM_API_KEY',
  'BUNNY_STREAM_LIBRARY_ID',
];

(async () => {
  const token = await getToken();
  const serviceUrl = `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/services/repair-backend`;

  console.log('Fetching current Cloud Run service config...');
  const svcResp = await fetch(serviceUrl, { headers: { Authorization: 'Bearer ' + token } });
  const svc = await svcResp.json();
  
  if (!svc.template?.containers?.[0]) {
    console.error('Could not read service:', JSON.stringify(svc).slice(0, 300));
    process.exit(1);
  }

  const existingEnv = svc.template.containers[0].env || [];
  const envMap = {};
  for (const e of existingEnv) {
    if (e.name && e.value !== undefined) envMap[e.name] = e.value;
  }
  console.log('Existing env vars:', Object.keys(envMap).join(', ') || '(none)');

  let syncCount = 0;
  for (const key of secretsToSync) {
    const val = process.env[key];
    if (val) {
      envMap[key] = val;
      syncCount++;
      console.log(`  ✓ ${key} (${val.length} chars)`);
    } else {
      console.log(`  ⚠ ${key} not set`);
    }
  }

  svc.template.containers[0].env = Object.entries(envMap).map(([name, value]) => ({ name, value }));

  console.log(`\nPatching Cloud Run service with ${syncCount} secrets...`);
  const patchResp = await fetch(serviceUrl, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(svc)
  });
  const patchData = await patchResp.json();
  if (patchResp.ok) {
    console.log('✅ Env vars synced! Cloud Run is rolling out new revision...');
    console.log('Operation:', patchData.name || 'done');
  } else {
    console.error('❌ Failed:', JSON.stringify(patchData).slice(0, 400));
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
