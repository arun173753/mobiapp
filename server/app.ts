import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { startEmailScheduler } from "./lib/emailScheduler";
import { fixDbUrl, verifyDatabaseConnection } from "./db";
import * as fs from "fs";
import * as path from "path";

const log = console.log;

const PRODUCTION_DOMAIN = (
  process.env.API_PUBLIC_URL ||
  process.env.APP_DOMAIN ||
  ""
).replace(/\/+$/, "");

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origin = req.get("origin");
    const allowedMethods = "GET, POST, PUT, DELETE, PATCH, OPTIONS";
    const allowedHeaders =
      "Content-Type, x-session-token, expo-platform, x-requested-with, Authorization, Accept";

    // Always allow CORS requests from known good origins and patterns
    // Permissive in development, restrictive in production if needed
    const extraOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const isAllowed =
      !origin || // Allow no-origin requests (mobile apps may not send origin)
      extraOrigins.includes(origin) ||
      (PRODUCTION_DOMAIN && origin === PRODUCTION_DOMAIN) ||
      origin === "https://arunmobi-app.web.app" ||
      origin === "https://arunmobi-app.firebaseapp.com" ||
      origin === "https://atozmobilerepair.in" ||
      origin === "https://www.atozmobilerepair.in" ||
      origin?.startsWith("http://localhost") ||
      origin?.startsWith("http://127.0.0.1") ||
      origin?.startsWith("http://") || // Allow all HTTP (dev origins)
      origin?.startsWith("https://") || // Allow all HTTPS origins
      origin?.endsWith(".web.app") ||
      origin?.endsWith(".firebaseapp.com") ||
      origin?.endsWith(".run.app") ||
      origin?.endsWith(".vercel.app") ||
      origin?.endsWith(".replit.dev") ||
      origin?.endsWith(".exp.host");

    if (isAllowed) {
      res.set("Access-Control-Allow-Origin", origin || "*");
      res.set("Access-Control-Allow-Methods", allowedMethods);
      res.set("Access-Control-Allow-Headers", allowedHeaders);
      res.set("Access-Control-Allow-Credentials", "true");
      res.set("Access-Control-Max-Age", "86400");
    }

    // Always respond 200 to preflight requests
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "200mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: "200mb" }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      log(`[req] ${req.method} ${req.originalUrl || req.url}`);
    }
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(process.cwd(), "static-build", platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(process.cwd(), "server", "templates", "landing-page.html");
  const appName = getAppName();

  let landingPageTemplate = "<html><body><h1>Mobi</h1></body></html>";
  try {
    landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  } catch {
    log("Landing page template not found, using default");
  }

  const distPath = path.resolve(process.cwd(), "dist");
  const hasWebBuild = fs.existsSync(path.join(distPath, "index.html"));

  log("Serving static Expo files with dynamic manifest routing");
  if (hasWebBuild) {
    log("Web build found in dist/ - serving web app for browser requests");
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    if (req.path === "/" && hasWebBuild) {
      return res.sendFile(path.join(distPath, "index.html"));
    }

    if (req.path === "/") {
      return serveLandingPage({ req, res, landingPageTemplate, appName });
    }

    next();
  });

  const assetsPath = path.resolve(process.cwd(), "assets");
  const uploadsPath = path.resolve(process.cwd(), "uploads");
  const staticBuildPath = path.resolve(process.cwd(), "static-build");

  if (fs.existsSync(assetsPath)) app.use("/assets", express.static(assetsPath));
  if (fs.existsSync(uploadsPath)) app.use("/uploads", express.static(uploadsPath));
  if (fs.existsSync(staticBuildPath)) app.use("/download", express.static(staticBuildPath));
  if (hasWebBuild) app.use(express.static(distPath));
  if (fs.existsSync(staticBuildPath)) app.use(express.static(staticBuildPath));

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupWebAppFallback(app: express.Application) {
  const distPath = path.resolve(process.cwd(), "dist");
  const indexPath = path.join(distPath, "index.html");
  if (!fs.existsSync(indexPath)) return;

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform) {
      return next();
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    res.sendFile(indexPath);
  });
}

function setupRateLimiter(app: express.Application) {
  // Rate limiter for abuse prevention (not strict for polling)
  const requestCounts = new Map<string, { count: number; resetTime: number }>();
  const WINDOW_MS = 60 * 1000; // 1 minute
  const MAX_REQUESTS = 500; // Increased to allow polling (8 calls/min for live chat + 2 for context + other requests)

  app.use((req, res, next) => {
    // Skip rate limiting for health checks and static files
    if (req.path === '/health' || req.path.startsWith('/assets') || req.path.startsWith('/uploads')) {
      return next();
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (!requestCounts.has(ip)) {
      requestCounts.set(ip, { count: 1, resetTime: now + WINDOW_MS });
      return next();
    }

    const record = requestCounts.get(ip)!;
    
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + WINDOW_MS;
      return next();
    }

    record.count++;
    if (record.count > MAX_REQUESTS) {
      console.warn(`[RateLimit] IP ${ip} exceeded limit: ${record.count} requests`);
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }

    next();
  });
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err instanceof Error ? err.stack : err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({
      error: status >= 500 ? "Internal server error" : "Request error",
      message,
    });
  });
}

function getValidDbUrl(): string | null {
  const candidates = [
    process.env.SUPABASE_DATABASE_URL,
    process.env.NEON_DATABASE_URL,
    process.env.DATABASE_URL,
  ];
  for (const url of candidates) {
    if (url && (url.startsWith("postgresql://") || url.startsWith("postgres://"))) {
      return fixDbUrl(url);
    }
  }
  return null;
}

async function runStartupMigrations() {
  const dbUrl = getValidDbUrl();

  if (!dbUrl) {
    log("Startup migration skipped: no database URL configured");
    return;
  }

  try {
    const pg = await import("pg");
    const pool = new pg.default.Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_tokens (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        phone text NOT NULL UNIQUE,
        otp text NOT NULL,
        expires_at bigint NOT NULL,
        created_at bigint NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_notifications (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        type text NOT NULL DEFAULT 'ACCOUNT_LOCKED',
        user_id text NOT NULL,
        user_name text NOT NULL DEFAULT '',
        phone text NOT NULL DEFAULT '',
        reason text NOT NULL DEFAULT '',
        read integer NOT NULL DEFAULT 0,
        created_at bigint NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
    await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banner_image TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shop_thumbnail TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS thumbnail TEXT DEFAULT ''`);
    await pool.query(
      `ALTER TABLE posts ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0`,
    );
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS latitude TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS longitude TEXT DEFAULT ''`);
    await pool.end();
    log("Startup migration: tables ready");
  } catch (err) {
    log("Startup migration warning:", err);
  }
}

let _appPromise: Promise<express.Application> | null = null;

export async function createApp(): Promise<express.Application> {
  if (_appPromise) return _appPromise;

  _appPromise = (async () => {
    const app = express();

    setupCors(app);
    setupRateLimiter(app);
    setupBodyParsing(app);
    setupRequestLogging(app);

    // Health check endpoint (before other routes)
    app.get('/health', (req, res) => {
      res.status(200).json({ success: true });
    });

    configureExpoAndLanding(app);

    await runStartupMigrations();

    try {
      await verifyDatabaseConnection();
    } catch (e) {
      log("[DB] verifyDatabaseConnection failed — API may error until DB is reachable:", e);
    }

    await registerRoutes(app);
    startEmailScheduler();

    setupWebAppFallback(app);
    setupErrorHandler(app);

    return app;
  })();

  return _appPromise;
}
