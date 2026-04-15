/* eslint-disable no-console */

async function main() {
  const base = "https://arunmobi-app.web.app";
  const htmlRes = await fetch(`${base}/`, { headers: { "user-agent": "Mozilla/5.0" } });
  const html = await htmlRes.text();
  console.log("index_status", htmlRes.status);

  const scriptRe = /<script[^>]+src="([^"]+)"/g;
  const scripts = [];
  let m;
  while ((m = scriptRe.exec(html))) scripts.push(m[1]);
  console.log("script_count", scripts.length);
  scripts.forEach((s) => console.log("script", s));

  const needles = [
    "FIREBASE CONFIG (sanitized):",
    "Firebase ENV NOT LOADED (module init)",
    "expoConfig.extra.firebaseProjectId",
    "firebaseProjectId",
    "ENV NOT LOADED: Firebase API key/authDomain/projectId missing",
  ];

  for (const src of scripts.slice(0, 10)) {
    const url = src.startsWith("http") ? src : `${base}${src.startsWith("/") ? "" : "/"}${src}`;
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    const t = await r.text();
    console.log("bundle_status", r.status, url);
    for (const n of needles) {
      if (t.includes(n)) console.log("FOUND", n, "in", url);
    }

    // Find Google-style web API keys embedded in the bundle without printing full secrets.
    const keyRe = /AIzaSy[0-9A-Za-z_-]{20,60}/g;
    const found = t.match(keyRe) || [];
    const uniq = Array.from(new Set(found));
    console.log("bundle_google_key_count", uniq.length);
    for (const k of uniq.slice(0, 10)) {
      const masked = `${k.slice(0, 6)}…${k.slice(-4)}`;
      console.log("bundle_google_key", masked, "len", k.length);
    }
  }

  // Compare to local dist (helps prove whether Hosting is serving an old build)
  try {
    const fs = require("fs");
    const distHtml = fs.readFileSync("dist/index.html", "utf8");
    const distRe = /<script[^>]+src="([^"]+)"/g;
    const distScripts = [];
    let dm;
    while ((dm = distRe.exec(distHtml))) distScripts.push(dm[1]);
    console.log("dist_script_count", distScripts.length);
    distScripts.forEach((s) => console.log("dist_script", s));

    // Check whether the dist bundle contains the Firebase API key from .env.production exactly.
    const envProd = fs.readFileSync(".env.production", "utf8");
    const apiKeyLine = envProd
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("EXPO_PUBLIC_FIREBASE_API_KEY="));
    const apiKey = apiKeyLine ? apiKeyLine.split("=").slice(1).join("=").trim() : "";
    const apiKeyMasked = apiKey ? `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}` : "(missing)";
    console.log("envprod_firebase_key", apiKeyMasked, "len", apiKey.length || 0);

    // Also check root .env (Expo CLI always loads this for web bundling)
    let envKey = "";
    try {
      const envTxt = fs.readFileSync(".env", "utf8");
      const envLine = envTxt
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("EXPO_PUBLIC_FIREBASE_API_KEY="));
      envKey = envLine ? envLine.split("=").slice(1).join("=").trim() : "";
    } catch {}
    const envKeyMasked = envKey ? `${envKey.slice(0, 6)}…${envKey.slice(-4)}` : "(missing)";
    console.log("env_firebase_key", envKeyMasked, "len", envKey.length || 0);

    for (const src of distScripts.slice(0, 10)) {
      const file = src.startsWith("/") ? src.slice(1) : src;
      const p = require("path").join("dist", file);
      if (!fs.existsSync(p)) continue;
      const b = fs.readFileSync(p, "utf8");
      const matches = (b.match(/AIzaSy[0-9A-Za-z_-]{20,60}/g) || []).filter((k) => k.length === 40);
      const uniq40 = Array.from(new Set(matches));
      const candidate = uniq40.find((k) => k.endsWith("BXE0")) || "";
      const sameProd = Boolean(apiKey && candidate && apiKey === candidate);
      const sameEnv = Boolean(envKey && candidate && envKey === candidate);
      let firstDiff = -1;
      if (apiKey && candidate && apiKey.length === candidate.length) {
        for (let i = 0; i < apiKey.length; i++) {
          if (apiKey[i] !== candidate[i]) {
            firstDiff = i;
            break;
          }
        }
      }
      console.log("dist_bundle", src, "contains_envprod_key", apiKey ? b.includes(apiKey) : false);
      console.log(
        "dist_bundle_firebase_key_compare",
        "envprodMasked",
        apiKeyMasked,
        "envMasked",
        envKeyMasked,
        "bundleMasked",
        candidate ? `${candidate.slice(0, 6)}…${candidate.slice(-4)}` : "(missing)",
        "sameEnv",
        sameEnv,
        "sameEnvProd",
        sameProd,
        "firstDiffIndex",
        firstDiff,
      );
    }
  } catch (e) {
    console.log("dist_read_failed", e?.message || String(e));
  }
}

main().catch((e) => {
  console.error("debug-fetch-deploy failed:", e?.message || String(e));
  process.exit(1);
});

