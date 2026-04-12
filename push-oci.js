/**
 * Builds a proper Node.js Docker image for Cloud Run deployment.
 * No npm dependencies - uses ONLY Node.js built-ins.
 * Designed to run inside Google Cloud Build (uses metadata server for auth).
 * 
 * Strategy:
 * 1. Get node:20-slim manifest + layers from Docker Hub (anonymous pull)
 * 2. Copy each layer from Docker Hub to Artifact Registry
 * 3. Build our /app layer with server code
 * 4. Create new image config (based on node:20-slim) with our CMD/WORKDIR
 * 5. Push manifest to Artifact Registry as :latest
 * 6. Deploy to Cloud Run
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { URL } = require('url');

const PROJECT_ID = 'mobi-backend-491410';
const REGION = 'asia-south1';
const REGISTRY = `${REGION}-docker.pkg.dev`;
const REPO = 'cloud-run-source-deploy';
const IMAGE_NAME = 'repair-backend';
const FULL_REPO_PATH = `${PROJECT_ID}/${REPO}/${IMAGE_NAME}`;
const REGISTRY_BASE = `https://${REGISTRY}`;
const DOCKERHUB_REGISTRY = 'registry-1.docker.io';
const NODE_IMAGE = 'library/node';
const NODE_TAG = '20-slim';

// ---------- HTTP helpers ----------
function httpRequest(urlStr, opts = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (e) { return reject(new Error(`Invalid URL: ${urlStr}: ${e.message}`)); }
    const mod = url.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: 120000
    };
    const req = mod.request(reqOpts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 15) {
        res.resume();
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, urlStr).toString();
        const nextOpts = { ...opts, method: ['301','302','303'].includes(String(res.statusCode)) ? 'GET' : opts.method };
        if (!next.includes(REGISTRY) && !next.includes(DOCKERHUB_REGISTRY)) {
          const headers = { ...(nextOpts.headers || {}) };
          delete headers['Authorization'];
          nextOpts.headers = headers;
          nextOpts.body = null;
          nextOpts.method = 'GET';
        }
        resolve(httpRequest(next, nextOpts, redirects + 1));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timeout: ${urlStr}`)); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// GCP metadata token (works inside Cloud Build)
async function getGCPToken() {
  const r = await httpRequest(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } }
  );
  if (r.status !== 200) throw new Error(`Metadata token: ${r.status} ${r.body.toString().slice(0, 100)}`);
  return JSON.parse(r.body.toString()).access_token;
}

// Docker Hub anonymous token for node:20-slim
async function getDockerHubToken() {
  const r = await httpRequest(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull`,
    {}
  );
  if (r.status !== 200) throw new Error(`Docker Hub token: ${r.status} ${r.body.toString().slice(0, 200)}`);
  return JSON.parse(r.body.toString()).token;
}

// ---------- Artifact Registry operations ----------
async function arHead(path) {
  const token = await getGCPToken();
  return httpRequest(`${REGISTRY_BASE}/v2/${FULL_REPO_PATH}${path}`, {
    method: 'HEAD', headers: { Authorization: `Bearer ${token}` }
  });
}

async function arGet(path, extraHeaders = {}) {
  const token = await getGCPToken();
  return httpRequest(`${REGISTRY_BASE}/v2/${FULL_REPO_PATH}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...extraHeaders }
  });
}

async function pushBlobToAR(data) {
  const digest = 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
  const headR = await arHead(`/blobs/${digest}`);
  if (headR.status === 200) {
    console.log(`    Blob already in AR: ${digest.slice(0, 19)}... (${(data.length/1024/1024).toFixed(1)} MB)`);
    return digest;
  }
  const token1 = await getGCPToken();
  const startR = await httpRequest(`${REGISTRY_BASE}/v2/${FULL_REPO_PATH}/blobs/uploads/`, {
    method: 'POST', headers: { Authorization: `Bearer ${token1}`, 'Content-Length': '0' }
  });
  if (startR.status !== 202) throw new Error(`Start upload: ${startR.status} ${startR.body.toString().slice(0, 200)}`);
  const location = startR.headers['location'];
  if (!location) throw new Error('No upload location');
  const putUrl = (location.startsWith('http') ? location : `${REGISTRY_BASE}${location}`) +
    (location.includes('?') ? '&' : '?') + `digest=${encodeURIComponent(digest)}`;
  const token2 = await getGCPToken();
  const putR = await httpRequest(putUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) },
    body: data
  });
  if (putR.status !== 201) throw new Error(`Push blob: ${putR.status} ${putR.body.toString().slice(0, 300)}`);
  console.log(`    Pushed to AR: ${digest.slice(0, 19)}... (${(data.length/1024/1024).toFixed(1)} MB)`);
  return digest;
}

async function crossMountLayerToAR(digest, fromRepo) {
  // Try cross-repo mount first (fast, no data transfer)
  const token = await getGCPToken();
  const mountR = await httpRequest(`${REGISTRY_BASE}/v2/${FULL_REPO_PATH}/blobs/uploads/?mount=${encodeURIComponent(digest)}&from=${encodeURIComponent(fromRepo)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' }
  });
  if (mountR.status === 201) {
    console.log(`    Cross-mounted: ${digest.slice(0, 19)}...`);
    return true;
  }
  return false; // Fall back to download+upload
}

// ---------- Docker Hub operations ----------
async function dhGet(path, token, extraHeaders = {}) {
  return httpRequest(`https://${DOCKERHUB_REGISTRY}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...extraHeaders }
  });
}

// ---------- TAR implementation (manual, no deps) ----------
function octal6(n) { return n.toString(8).padStart(7, '0').slice(0, 7) + ' '; }
function octal11(n) { return n.toString(8).padStart(11, '0').slice(0, 11) + ' '; }

function makeTarHeader(name, size, type = '0', mode = 0o644) {
  const header = Buffer.alloc(512, 0);
  function enc(str, off, len) { Buffer.from(str.slice(0, len), 'ascii').copy(header, off); }
  function oct(n, off, len) { Buffer.from(n.toString(8).padStart(len - 1, '0') + '\0', 'ascii').copy(header, off); }
  enc(name.slice(0, 100), 0, 100);
  oct(mode, 100, 8);
  oct(0, 108, 8); oct(0, 116, 8);
  oct(size, 124, 12);
  oct(Math.floor(Date.now() / 1000), 136, 12);
  header[156] = type.charCodeAt(0);
  Buffer.from('ustar  \0', 'ascii').copy(header, 257);
  // Compute checksum
  Buffer.from('        ', 'ascii').copy(header, 148); // 8 spaces placeholder
  let cs = 0; for (let i = 0; i < 512; i++) cs += header[i];
  Buffer.from(cs.toString(8).padStart(6, '0') + '\0 ', 'ascii').copy(header, 148);
  return header;
}

function tarEntry(name, content, mode = 0o644) {
  const parts = [];
  if (Buffer.byteLength(name, 'ascii') > 100) {
    const ln = Buffer.from(name + '\0', 'ascii');
    parts.push(makeTarHeader('././@LongLink', ln.length, 'L', 0o644));
    parts.push(ln);
    const pad = (512 - ln.length % 512) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(makeTarHeader(name.slice(0, 100), content.length, '0', mode));
  parts.push(content);
  const pad = (512 - content.length % 512) % 512;
  if (pad) parts.push(Buffer.alloc(pad));
  return Buffer.concat(parts);
}

function tarDir(name) {
  if (!name.endsWith('/')) name += '/';
  return makeTarHeader(name.slice(0, 100), 0, '5', 0o755);
}

function addDirRecursive(chunks, tarPrefix, fsPath) {
  let entries;
  try { entries = fs.readdirSync(fsPath); } catch { return; }
  for (const entry of entries) {
    const fp = path.join(fsPath, entry), tp = tarPrefix + '/' + entry;
    let st;
    try { st = fs.statSync(fp); } catch { continue; }
    if (st.isDirectory()) {
      chunks.push(tarDir(tp));
      addDirRecursive(chunks, tp, fp);
    } else {
      try {
        chunks.push(tarEntry(tp, fs.readFileSync(fp), st.mode & 0o777));
      } catch (e) { console.warn(`    Warn: skip ${fp}: ${e.message}`); }
    }
  }
}

async function buildAppLayerGz(workDir) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const gz = zlib.createGzip({ level: 6 });
    const tc = [];
    tc.push(tarDir('app'));
    tc.push(tarDir('app/server'));
    tc.push(tarDir('app/uploads'));
    for (const d of ['server_dist', 'shared', 'assets']) {
      tc.push(tarDir(`app/${d}`));
      addDirRecursive(tc, `app/${d}`, path.join(workDir, d));
    }
    tc.push(tarDir('app/server/templates'));
    addDirRecursive(tc, 'app/server/templates', path.join(workDir, 'server/templates'));
    try { tc.push(tarEntry('app/app.json', fs.readFileSync(path.join(workDir, 'app.json')))); } catch {}
    tc.push(Buffer.alloc(1024)); // EOF
    const tarBuf = Buffer.concat(tc);
    gz.on('data', c => chunks.push(c));
    gz.on('end', () => resolve(Buffer.concat(chunks)));
    gz.on('error', reject);
    gz.write(tarBuf);
    gz.end();
  });
}

// ---------- Main ----------
async function main() {
  const workDir = process.cwd();
  console.log('Working dir:', workDir);
  console.log('Files:', fs.readdirSync(workDir).join(', ').slice(0, 120));

  // Step 1: Get Docker Hub auth token
  console.log('\n1. Getting Docker Hub token for node:20-slim...');
  const dhToken = await getDockerHubToken();
  console.log('   Docker Hub token OK');

  // Step 2: Get node:20-slim manifest from Docker Hub
  console.log('\n2. Fetching node:20-slim manifest...');
  // First try manifest list to handle multi-arch images
  const mListR = await dhGet(`/v2/${NODE_IMAGE}/manifests/${NODE_TAG}`, dhToken, {
    Accept: 'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
  });
  if (mListR.status !== 200) throw new Error(`DH manifest list: ${mListR.status} ${mListR.body.toString().slice(0, 200)}`);
  const mListParsed = JSON.parse(mListR.body.toString());
  console.log(`   mediaType: ${mListParsed.mediaType}, schemaVersion: ${mListParsed.schemaVersion}`);
  
  let singleManifestDigest = null;
  if (mListParsed.manifests) {
    // It's a manifest list - find linux/amd64
    const amd64 = mListParsed.manifests.find(m => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64');
    if (!amd64) throw new Error(`No linux/amd64 manifest found in list. Available: ${JSON.stringify(mListParsed.manifests.map(m => m.platform))}`);
    singleManifestDigest = amd64.digest;
    console.log(`   Found linux/amd64 digest: ${singleManifestDigest.slice(0, 20)}...`);
  }
  
  let dhManifest;
  if (singleManifestDigest) {
    // Fetch the specific single-platform manifest
    const smR = await dhGet(`/v2/${NODE_IMAGE}/manifests/${singleManifestDigest}`, dhToken, {
      Accept: 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
    });
    if (smR.status !== 200) throw new Error(`DH single manifest: ${smR.status} ${smR.body.toString().slice(0, 200)}`);
    dhManifest = JSON.parse(smR.body.toString());
  } else {
    dhManifest = mListParsed;
  }
  
  if (!dhManifest.layers) throw new Error(`Manifest has no layers field: ${JSON.stringify(dhManifest).slice(0, 200)}`);
  console.log(`   node:20-slim manifest: ${dhManifest.layers.length} layers, schema v${dhManifest.schemaVersion}`);
  console.log(`   Config digest: ${dhManifest.config.digest.slice(0, 20)}...`);

  // Step 3: Get node:20-slim config
  console.log('\n3. Fetching node:20-slim config...');
  const cfgR = await dhGet(`/v2/${NODE_IMAGE}/blobs/${dhManifest.config.digest}`, dhToken);
  if (cfgR.status !== 200) throw new Error(`DH config: ${cfgR.status}`);
  const nodeConfig = JSON.parse(cfgR.body.toString());
  console.log(`   node CMD: ${JSON.stringify(nodeConfig.config?.Cmd)}`);
  console.log(`   node Entrypoint: ${JSON.stringify(nodeConfig.config?.Entrypoint)}`);
  console.log(`   node WorkingDir: ${nodeConfig.config?.WorkingDir}`);
  console.log(`   Layers in config: ${nodeConfig.rootfs?.diff_ids?.length}`);

  // Step 4: Copy node:20-slim layers to Artifact Registry
  console.log('\n4. Copying node:20-slim layers to Artifact Registry...');
  const layersData = []; // Store layer blobs for pushing
  for (let i = 0; i < dhManifest.layers.length; i++) {
    const layer = dhManifest.layers[i];
    console.log(`   Layer ${i+1}/${dhManifest.layers.length}: ${layer.digest.slice(0, 20)}... (${(layer.size/1024/1024).toFixed(1)} MB)`);
    
    // Check if already in AR
    const headR = await arHead(`/blobs/${layer.digest}`);
    if (headR.status === 200) {
      console.log(`     Already in AR, skipping`);
      continue;
    }
    
    // Download from Docker Hub
    console.log(`     Downloading from Docker Hub...`);
    const layerR = await dhGet(`/v2/${NODE_IMAGE}/blobs/${layer.digest}`, dhToken);
    if (layerR.status !== 200) throw new Error(`DH layer ${i}: ${layerR.status}`);
    console.log(`     Downloaded: ${(layerR.body.length/1024/1024).toFixed(1)} MB`);
    
    // Push to AR
    await pushBlobToAR(layerR.body);
  }

  // Step 5: Build our app layer
  console.log('\n5. Building app layer tarball...');
  const layerGz = await buildAppLayerGz(workDir);
  console.log(`   App layer: ${(layerGz.length/1024/1024).toFixed(2)} MB`);
  const appLayerDigest = await pushBlobToAR(layerGz);
  
  // Compute diff_id (sha256 of uncompressed tar)
  const ungzipped = await new Promise((res, rej) => zlib.gunzip(layerGz, (e, b) => e ? rej(e) : res(b)));
  const appDiffId = 'sha256:' + crypto.createHash('sha256').update(ungzipped).digest('hex');
  console.log(`   App layer digest: ${appLayerDigest.slice(0, 19)}...`);
  console.log(`   App diff_id:      ${appDiffId.slice(0, 19)}...`);

  // Step 6: Build new image config
  console.log('\n6. Building new image config...');
  const newConfig = JSON.parse(JSON.stringify(nodeConfig));
  newConfig.config = newConfig.config || {};
  newConfig.config.Cmd = ['node', 'server_dist/index.js'];
  // Keep docker-entrypoint.sh as entrypoint — it properly handles args that start with '-'
  // CMD: ['node', 'server_dist/index.js'] → docker-entrypoint.sh node server_dist/index.js → node server_dist/index.js
  newConfig.config.WorkingDir = '/app';
  const envBase = (newConfig.config.Env || []).filter(e =>
    !e.startsWith('NODE_ENV=') && !e.startsWith('PORT=')
  );
  newConfig.config.Env = [...envBase, 'NODE_ENV=production', 'PORT=8080'];
  newConfig.rootfs = newConfig.rootfs || { type: 'layers', diff_ids: [] };
  newConfig.rootfs.diff_ids = [...(newConfig.rootfs.diff_ids || []), appDiffId];
  newConfig.created = new Date().toISOString();
  if (newConfig.history) {
    newConfig.history.push({ created: newConfig.created, created_by: 'push-oci.js: add /app server layer' });
  }
  
  const configBuf = Buffer.from(JSON.stringify(newConfig));
  const configDigest = await pushBlobToAR(configBuf);
  console.log(`   Config digest: ${configDigest.slice(0, 19)}...`);

  // Step 7: Build and push manifest
  console.log('\n7. Pushing new manifest...');
  const newManifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    config: {
      mediaType: 'application/vnd.docker.container.image.v1+json',
      size: configBuf.length,
      digest: configDigest
    },
    layers: [
      ...dhManifest.layers,
      {
        mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
        size: layerGz.length,
        digest: appLayerDigest
      }
    ]
  };
  const manifestBuf = Buffer.from(JSON.stringify(newManifest));
  const manifestDigest = 'sha256:' + crypto.createHash('sha256').update(manifestBuf).digest('hex');
  
  const gcpToken = await getGCPToken();
  const pushMR = await httpRequest(`${REGISTRY_BASE}/v2/${FULL_REPO_PATH}/manifests/latest`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${gcpToken}`, 'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json', 'Content-Length': String(manifestBuf.length) },
    body: manifestBuf
  });
  if (pushMR.status !== 201) throw new Error(`Push manifest: ${pushMR.status} ${pushMR.body.toString().slice(0, 300)}`);
  console.log(`   Manifest pushed! ${manifestDigest.slice(0, 30)}...`);
  console.log(`   Image: ${REGISTRY}/${FULL_REPO_PATH}:latest`);

  // Step 8: Deploy to Cloud Run
  console.log('\n8. Deploying to Cloud Run...');
  try {
    const crBase = 'https://run.googleapis.com';
    const crPath = `/v2/projects/${PROJECT_ID}/locations/${REGION}/services/repair-backend`;
    const tok1 = await getGCPToken();
    const svcR = await httpRequest(`${crBase}${crPath}`, { headers: { Authorization: `Bearer ${tok1}` } });
    if (svcR.status !== 200) throw new Error(`Get svc: ${svcR.status}`);
    const svc = JSON.parse(svcR.body.toString());
    
    // Use specific digest to force Cloud Run to create new revision
    svc.template.containers[0].image = `${REGISTRY}/${FULL_REPO_PATH}@${manifestDigest}`;
    
    // Add unique annotation to force a new revision even if image string looks same
    svc.template.annotations = svc.template.annotations || {};
    svc.template.annotations['run.googleapis.com/deploy-timestamp'] = String(Date.now());

    // Set 3600s (1 hour) timeout to allow large video uploads (500MB+ can take 20-60 min)
    svc.template.timeout = '3600s';
    svc.template.containers[0].resources = {
      limits: {
        memory: '2Gi',
        cpu: '1'
      }
    };

    // Ensure required env vars are always set
    const container = svc.template.containers[0];
    container.env = container.env || [];
    const setEnv = (name, value) => {
      if (!value) return;
      const idx = container.env.findIndex(e => e.name === name);
      if (idx >= 0) { container.env[idx].value = value; }
      else { container.env.push({ name, value }); }
      console.log(`   Env: ${name} = ${value.slice(0, 8)}...`);
    };
    setEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '');
    setEnv('BUNNY_STREAM_API_KEY', process.env.BUNNY_STREAM_API_KEY || '');
    setEnv('BUNNY_STREAM_LIBRARY_ID', process.env.BUNNY_STREAM_LIBRARY_ID || '');
    
    console.log('   Setting image digest:', manifestDigest.slice(0, 30) + '...');
    const svcBody = JSON.stringify(svc);
    const tok2 = await getGCPToken();
    const pR = await httpRequest(`${crBase}${crPath}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tok2}`, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(svcBody)) },
      body: Buffer.from(svcBody)
    });
    if (pR.status !== 200) {
      console.warn(`   Cloud Run PATCH ${pR.status}:`, pR.body.toString().slice(0, 300));
    } else {
      const op = JSON.parse(pR.body.toString());
      console.log('   Cloud Run PATCH: 200 SUCCESS');
      console.log('   New revision should be live in ~1 min');
      console.log('\n=== Deployment initiated! Backend live in ~1 min ===');
    }
  } catch (crErr) {
    console.warn('   Cloud Run deploy (non-fatal):', crErr.message);
    console.log('   Image ready. Trigger Cloud Run deployment separately.');
  }
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
