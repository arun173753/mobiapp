#!/usr/bin/env node
const https = require('https');

const RENDER_TOKEN = 'rnd_ndOPfluLZ9TqIqlJ0rUkdtccq1q4';
const GITHUB_REPO = 'atozmobilerepaircourse-png/atoz-mobile-repair';

const envVars = [
  { key: 'NODE_ENV', value: 'production' },
  { key: 'SUPABASE_DATABASE_URL', value: process.env.SUPABASE_DATABASE_URL },
  { key: 'RAZORPAY_KEY_ID', value: process.env.RAZORPAY_KEY_ID },
  { key: 'RAZORPAY_SECRET_KEY', value: process.env.RAZORPAY_SECRET_KEY },
  { key: 'OPENAI_API_KEY', value: process.env.OPENAI_API_KEY },
  { key: 'BUNNY_STREAM_API_KEY', value: process.env.BUNNY_STREAM_API_KEY },
  { key: 'BUNNY_STREAM_LIBRARY_ID', value: process.env.BUNNY_STREAM_LIBRARY_ID },
  { key: 'BUNNY_STORAGE_API_KEY', value: process.env.BUNNY_STORAGE_API_KEY },
  { key: 'BUNNY_STORAGE_ZONE_NAME', value: 'arun-storag' },
  { key: 'BUNNY_STORAGE_REGION', value: 'uk' },
  { key: 'FAST2SMS_API_KEY', value: process.env.FAST2SMS_API_KEY },
  { key: 'GOOGLE_CLIENT_SECRET', value: process.env.GOOGLE_CLIENT_SECRET },
  { key: 'NVIDIA_API_KEY', value: process.env.NVIDIA_API_KEY || '' }
].filter(v => v.value);

const payload = {
  name: 'mobi-backend',
  type: 'web_service',
  repo: `https://github.com/${GITHUB_REPO}`,
  branch: 'main',
  buildCommand: 'npm install && npx esbuild server/index.ts --platform=node --bundle --format=cjs --external:*.node --outdir=server_dist',
  startCommand: 'NODE_ENV=production node server_dist/index.js',
  envVars: envVars,
  plan: 'free',
  region: 'singapore'
};

console.log('🚀 Deploying to Render...');
console.log('Payload:', JSON.stringify(payload, null, 2));

const options = {
  hostname: 'api.render.com',
  port: 443,
  path: '/v1/services',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${RENDER_TOKEN}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(JSON.stringify(payload))
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      if (response.id) {
        console.log('✅ Service created!');
        console.log('Service ID:', response.id);
        console.log('Name:', response.name);
        console.log('Status:', response.status);
        console.log('\n📊 Dashboard: https://dashboard.render.com/web/' + response.id);
        console.log('\nDeployment in progress... Check dashboard for live URL');
      } else {
        console.log('Response:', JSON.stringify(response, null, 2));
      }
    } catch (e) {
      console.log('Response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});

req.write(JSON.stringify(payload));
req.end();
