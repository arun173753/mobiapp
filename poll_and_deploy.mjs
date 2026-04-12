import { GoogleAuth } from 'google-auth-library';
import { readFileSync } from 'fs';

const SA_KEY = JSON.parse(readFileSync('/tmp/gcp_sa.json', 'utf8'));
const PROJECT_ID = 'atoz-mobile-repair-488915';
const REGION = 'asia-south1';
const SERVICE_NAME = 'repair-backend';
const IMAGE = `${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME}`;
const BUILD_ID = '409f1aa1-f2ed-450d-bfef-4bdbfcc1aaf9';

const auth = new GoogleAuth({ credentials: SA_KEY, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
async function getToken() { return (await (await auth.getClient()).getAccessToken()).token; }

async function checkBuild() {
  const token = await getToken();
  const resp = await fetch(`https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/builds/${BUILD_ID}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) {
    const txt = await resp.text();
    console.log('Status check failed:', resp.status, txt.substring(0, 200));
    return null;
  }
  return await resp.json();
}

async function deployToCloudRun() {
  console.log('\n=== Deploying to Cloud Run ===');
  const token = await getToken();
  const crUrl = `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/services/${SERVICE_NAME}`;
  const getResp = await fetch(crUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!getResp.ok) { console.log('Get service failed:', getResp.status); return; }
  const svc = await getResp.json();
  svc.template.containers[0].image = IMAGE;
  const patchResp = await fetch(crUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(svc)
  });
  if (patchResp.ok) {
    console.log('✅ Cloud Run updated with new image:', IMAGE);
  } else {
    const err = await patchResp.json();
    console.log('Cloud Run update error:', JSON.stringify(err, null, 2));
  }
}

console.log('Polling build', BUILD_ID, '...');
for (let i = 0; i < 36; i++) {
  const data = await checkBuild();
  if (data) {
    console.log(`[${(i+1)*10}s] Status: ${data.status}`);
    if (data.status === 'SUCCESS') {
      console.log('Build succeeded!');
      await deployToCloudRun();
      break;
    } else if (['FAILURE','CANCELLED','TIMEOUT'].includes(data.status)) {
      console.log('Build failed:', data.status);
      console.log('Log URL:', data.logUrl);
      if (data.results && data.results.buildStepOutputs) console.log('Step outputs:', data.results.buildStepOutputs);
      break;
    }
  }
  await new Promise(r => setTimeout(r, 10000));
}
