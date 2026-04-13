import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { getFirestore, getAdminAuth, getStorage } from "./firebase-admin";
import { db } from "./db";
import OpenAI from "openai";
import { notifyAllUsers, notifyNewPost, notifyUser, notifyLiveChat, sendNotification, getDeviceCount, notifyUsersByRole } from "./push-notifications";
import { profiles, conversations, messages, posts, jobs, reels, products, orders, subscriptionSettings, courses, courseChapters, courseVideos, courseEnrollments, dubbedVideos, ads, liveChatMessages, liveClasses, liveSessions, courseNotices, sessions, payments, teacherPayouts, appSettings, videoProgress, livePolls, livePollVotes, emailCampaigns, otpTokens, adminNotifications, repairBookings, protectionPlans, protectionClaims, leads, leadClaims } from "@shared/schema";
import { sendWelcomeEmail, sendOTPEmail } from "./lib/sendEmail";
import { eq, or, and, desc, gt, gte, lt, sql, ne, isNotNull, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import Razorpay from "razorpay";
import {
  apiPublicBase,
  googleOAuthClientId,
  googleOAuthRedirectUri,
  uploadsPublicFileUrl,
} from "./config/public-urls";

const googleAuthTokens = new Map<string, { email: string; name: string; createdAt: number }>();

function getGoogleClientSecret(): string | undefined {
  const raw = process.env.GOOGLE_CLIENT_SECRET;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.web?.client_secret) return parsed.web.client_secret;
    if (parsed?.installed?.client_secret) return parsed.installed.client_secret;
    if (parsed?.client_secret) return parsed.client_secret;
  } catch {
    /* plain string secret */
  }
  return raw;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of googleAuthTokens) {
    if (now - val.createdAt > 5 * 60 * 1000) googleAuthTokens.delete(key);
  }
}, 60000);

// Disabled live-session cleanup to avoid runtime auth errors during startup.

const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const BUNNY_STORAGE_API_KEY = process.env.BUNNY_STORAGE_API_KEY || "";
const BUNNY_STORAGE_ZONE_NAME = process.env.BUNNY_STORAGE_ZONE_NAME || "";
const BUNNY_STORAGE_REGION = process.env.BUNNY_STORAGE_REGION || "uk";
const BUNNY_STORAGE_ENDPOINT =
  BUNNY_STORAGE_REGION === "de"
    ? "https://storage.bunnycdn.com"
    : `https://${BUNNY_STORAGE_REGION}.storage.bunnycdn.com`;
const BUNNY_CDN_URL = process.env.BUNNY_CDN_URL || "";
const bunnyAvailable = !!(BUNNY_STORAGE_API_KEY && BUNNY_STORAGE_ZONE_NAME);

// Bunny Stream — for video encoding + HLS streaming
const BUNNY_STREAM_API_KEY = process.env.BUNNY_STREAM_API_KEY || '';
const BUNNY_STREAM_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID || '';
const bunnyStreamAvailable = !!(BUNNY_STREAM_API_KEY && BUNNY_STREAM_LIBRARY_ID);

if (bunnyAvailable) {
  console.log(`[Bunny] Storage initialized: zone=${BUNNY_STORAGE_ZONE_NAME}, region=${BUNNY_STORAGE_REGION}`);
} else {
  console.log('[Bunny] Missing BUNNY_STORAGE_API_KEY or BUNNY_STORAGE_ZONE_NAME, using local disk storage');
}
if (bunnyStreamAvailable) {
  console.log(`[BunnyStream] Initialized: library=${BUNNY_STREAM_LIBRARY_ID}`);
} else {
  console.log('[BunnyStream] Missing BUNNY_STREAM_API_KEY or BUNNY_STREAM_LIBRARY_ID');
}

// Strip EXIF data from JPEG using Buffer manipulation (no external deps)
function stripEXIFFromJPEG(jpegBuffer: Buffer): Buffer {
  try {
    // Check if valid JPEG (starts with FFD8)
    if (jpegBuffer[0] !== 0xFF || jpegBuffer[1] !== 0xD8) return jpegBuffer;
    
    let i = 2;
    const segments: Buffer[] = [jpegBuffer.slice(0, 2)]; // Start with JPEG header
    
    while (i < jpegBuffer.length) {
      if (jpegBuffer[i] !== 0xFF) break;
      const marker = jpegBuffer[i + 1];
      
      // EXIF is in APP1 (FFE1) marker - skip it
      if (marker === 0xE1) {
        const segmentLen = (jpegBuffer[i + 2] << 8) | jpegBuffer[i + 3];
        i += 2 + segmentLen; // Skip this marker
        continue;
      }
      
      // Copy all other markers
      if (marker === 0xD9) {
        // EOI marker - end of image
        segments.push(jpegBuffer.slice(i, i + 2));
        break;
      }
      
      const segmentLen = (jpegBuffer[i + 2] << 8) | jpegBuffer[i + 3];
      segments.push(jpegBuffer.slice(i, i + 2 + segmentLen));
      i += 2 + segmentLen;
    }
    
    return Buffer.concat(segments);
  } catch (e) {
    console.warn('[EXIF] Failed to strip EXIF, returning original:', e);
    return jpegBuffer;
  }
}

async function uploadToStorage(buffer: Buffer, filename: string): Promise<string> {
  // Try Bunny.net Storage (primary)
  if (bunnyAvailable) {
    try {
      const url = `${BUNNY_STORAGE_ENDPOINT}/${BUNNY_STORAGE_ZONE_NAME}/${filename}`;
      console.log(`[Bunny] Uploading to: ${url}`);
      const contentType = filename.endsWith('.mp4')
        ? 'video/mp4'
        : filename.endsWith('.mov')
          ? 'video/quicktime'
          : filename.endsWith('.webm')
            ? 'video/webm'
            : filename.endsWith('.m4v')
              ? 'video/x-m4v'
              : 'application/octet-stream';
      const response = await Promise.race([
        fetch(url, {
          method: 'PUT',
          headers: {
            'AccessKey': BUNNY_STORAGE_API_KEY,
            'Content-Type': contentType,
            'Content-Length': String(buffer.length),
          },
          body: buffer,
          duplex: 'half',
        } as any),
        new Promise((_, reject) => setTimeout(() => reject(new Error('[Bunny] Upload timeout after 15s')), 15000))
      ]) as any;
      
      console.log(`[Bunny] Upload response: ${response.status}`);
      if (response.ok || response.status === 201) {
        const cdnUrl = `${BUNNY_CDN_URL}/${filename}`;
        console.log(`[Bunny] ✓ Success: ${filename} → ${cdnUrl}`);
        return cdnUrl;
      } else {
        const text = await response.text().catch(() => '');
        console.error(`[Bunny] ✗ Failed: ${response.status} ${text.slice(0, 200)}`);
        throw new Error(`Bunny returned ${response.status}`);
      }
    } catch (error: any) {
      console.error(`[Bunny] Error: ${error?.message || String(error)}`);
      throw error;
    }
  }
  
  // Fallback: Local storage (dev only, won't work on Cloud Run)
  const localFilename = filename.replace(/^(images|videos|reels)\//, "");
  const filePath = path.join(uploadsDir, localFilename);
  fs.writeFileSync(filePath, buffer);
  console.log(`[Local] Fallback: ${filePath}`);
  
  if (process.env.NODE_ENV === 'production') {
    // Bunny.net is required in production — if we reach here the upload failed
    throw new Error('Bunny.net upload failed and no local storage is available in production');
  }
  // CRITICAL FIX: Always use Cloud Run URL for image URLs (production domain)
  // Never use req.hostname or REPLIT_DEV_DOMAIN for uploaded image URLs
  // This ensures images are accessible from production web app
  return uploadsPublicFileUrl(localFilename);
}

async function uploadStreamToStorage(
  readableStream: any,
  filename: string,
  contentType: string,
  size?: number
): Promise<string> {
  if (bunnyAvailable) {
    try {
      const url = `${BUNNY_STORAGE_ENDPOINT}/${BUNNY_STORAGE_ZONE_NAME}/${filename}`;
      console.log(`[Bunny Stream] Uploading: ${filename}`);
      const headers: Record<string, string> = {
        'AccessKey': BUNNY_STORAGE_API_KEY,
        'Content-Type': contentType || 'application/octet-stream',
      };
      if (size) headers['Content-Length'] = String(size);

      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: readableStream,
        duplex: 'half',
      } as any);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Bunny stream upload failed: ${response.status} ${response.statusText} ${text}`);
      }
      console.log(`[Bunny] Stream uploaded: ${filename}`);
      return `${BUNNY_CDN_URL}/${filename}`;
    } catch (error) {
      console.error("[Bunny] Stream upload failed:", error);
      throw error;
    }
  }
  throw new Error("Bunny.net not available for stream upload");
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const memStorage = multer.memoryStorage();

const upload = multer({
  storage: memStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image and video files are allowed"));
    }
  },
});

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `temp-${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 2048 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});


function sanitizeImageUrls(images: string[]): string[] {
  if (!Array.isArray(images)) return [];
  return images.filter(url => {
    if (typeof url !== 'string') return false;
    if (url.startsWith('file://') || url.startsWith('content://') || url.startsWith('data:')) return false;
    // Support bunny.net CDN URLs
    if (url.includes('b-cdn.net')) return true;
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/uploads/') || url.startsWith('/api/files/') || url.startsWith('/api/gcs/');
  });
}

function sanitizeImageUrl(url: string): string {
  if (typeof url !== 'string') return '';
  if (url.startsWith('file://') || url.startsWith('content://') || url.startsWith('data:')) return '';
  // Support bunny.net CDN URLs
  if (url.includes('b-cdn.net')) return url;
  return url;
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Rate limiting: track OTP requests per phone number
const otpRateLimitMap = new Map<string, { count: number; windowStart: number }>();
const OTP_RATE_LIMIT = 5; // Allow 5 OTPs per 10 seconds for testing
const OTP_RATE_WINDOW_MS = 10 * 1000; // 10 seconds rate window for testing

function checkOtpRateLimit(phone: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = otpRateLimitMap.get(phone);
  if (!entry || now - entry.windowStart > OTP_RATE_WINDOW_MS) {
    otpRateLimitMap.set(phone, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.count >= OTP_RATE_LIMIT) {
    const retryAfterMs = OTP_RATE_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }
  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

async function sendOTPSMS(phone: string, otp: string): Promise<{ success: boolean; error?: string }> {
  try {
    const apiHomeKey = process.env.API_HOME_API_KEY;

    if (!apiHomeKey) {
      console.error('[OTP-SMS] API Home key not configured');
      return { success: false, error: 'SMS service not configured' };
    }

    // Clean phone number - remove all non-digits
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      return { success: false, error: 'Invalid phone number format' };
    }

    console.log(`[OTP-SMS] Sending OTP to ${cleanPhone} via API Home`);

    // API Home endpoint: https://apihome.in/panel/api/bulksms/?key=KEY&mobile=MOBILE&otp=OTP
    const url = new URL('https://apihome.in/panel/api/bulksms/');
    url.searchParams.append('key', apiHomeKey);
    url.searchParams.append('mobile', cleanPhone);
    url.searchParams.append('otp', otp);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json() as any;
    console.log(`[OTP-SMS] API Home response:`, data);

    // Check for success: API Home returns status 'Success' or 'success', or remark contains 'successfull'
    const isSuccess = response.ok && (
      data.success === true || 
      data.status === 'success' || 
      data.status === 'Success' ||  // API Home returns 'Success' with capital S
      data.status === 1 || 
      data.status === 'Sent' ||
      (data.remark && data.remark.toLowerCase().includes('success'))
    );

    if (isSuccess) {
      console.log(`[OTP-SMS] ✓ Successfully sent to ${cleanPhone}`);
      return { success: true };
    } else {
      const errorMsg = data.remark || data.message || data.error || 'Unknown error';
      console.error(`[OTP-SMS] Failed for ${cleanPhone}: ${errorMsg}`);
      return { success: false, error: `SMS delivery failed: ${errorMsg}` };
    }
  } catch (error: any) {
    console.error('[OTP-SMS] Network error:', error?.message);
    return { success: false, error: `Network error: ${error?.message || 'Unknown'}` };
  }
}

// Previous Twilio version - replaced with BulkBlaster above


export async function registerRoutes(app: Express): Promise<Server> {
  // ─── CORS Configuration ───
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    const allowedOrigins = [
      'https://mobi-backend-491410.web.app',
      'https://mobi-backend-491410.firebaseapp.com',
      'https://mobile-repair-app-276b6.web.app',
      'https://mobile-repair-app-276b6.firebaseapp.com',
      'http://localhost:8081',
      'http://localhost:3000',
      'http://localhost:5000',
    ];
    
    if (allowedOrigins.includes(origin) || origin.includes('replit.dev')) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, x-session-token, Authorization');
      res.header('Access-Control-Max-Age', '3600');
    }
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Ensure admin account exists and is always accessible
  (async () => {
    try {
      const adminPhone = "8179142535";
      const existing = await db.select().from(profiles).where(eq(profiles.phone, adminPhone));
      if (existing.length === 0) {
        await db.insert(profiles).values({
          id: "admin-" + randomUUID(),
          phone: adminPhone,
          name: "Admin",
          role: "admin",
          skills: "[]",
          blocked: 0,
        });
        console.log("[Admin] Created admin account for 8179142535");
      } else {
        // Ensure admin account is never blocked
        const admin = existing[0];
        if (admin.blocked === 1) {
          await db.update(profiles)
            .set({ blocked: 0 } as any)
            .where(eq(profiles.id, admin.id));
          console.log("[Admin] Reset admin account - was blocked");
        }
      }
    } catch (err) {
      console.error("[Admin] Error ensuring admin exists:", err);
    }
  })();

  // ─── Healthcheck ───
  app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));
  app.get("/_healthz", (_req, res) => res.status(200).json({ status: "ok" }));

  // ─── Admin Control APIs ───
  const LEGACY_ADMIN_PHONES_LAST10 = new Set(["8179142535", "9876543210", "9398391742"]);
  function profilePhoneDigits(phone: string | undefined | null): string {
    return (phone ?? "").toString().replace(/\D/g, "");
  }
  /** True if full digits or last 10 (e.g. 918179142535 → 8179142535) match a legacy admin line. */
  function isLegacyAdminPhoneDigits(digits: string): boolean {
    if (!digits) return false;
    if (LEGACY_ADMIN_PHONES_LAST10.has(digits)) return true;
    return LEGACY_ADMIN_PHONES_LAST10.has(digits.slice(-10));
  }
  /** Same idea as client `isAdminUser`: role admin OR legacy phones/email (often still `technician` in DB). */
  function isServerAdminProfile(profile: any): boolean {
    if (!profile) return false;
    if (profile.role === "admin") return true;
    if (isLegacyAdminPhoneDigits(profilePhoneDigits(profile.phone))) return true;
    const em = String(profile.email || "").toLowerCase();
    if (em === "atozmobilerepaircourse@gmail.com") return true;
    return false;
  }

  const adminMiddleware = async (req: any, res: any, next: any) => {
    try {
      // Phone bypass — always allow known admin phone numbers regardless of session token
      const phoneAuth = profilePhoneDigits((req.body?.phone || req.query?.phone || "") as string);
      if (isLegacyAdminPhoneDigits(phoneAuth)) {
        console.log("[AdminMiddleware] Auth via admin phone bypass:", phoneAuth.slice(-10));
        return next();
      }

      // Accept session token from header (primary) or request body/query (fallback for deployed web builds)
      const sessionToken = req.headers['x-session-token'] || req.body?.sessionToken || req.query?.sessionToken;
      if (!sessionToken) {
        console.log("[AdminMiddleware] No session token provided");
        return res.status(401).json({ success: false, message: "Unauthorized: Session token required" });
      }

      const sessionRows = await db.select().from(sessions).where(eq(sessions.sessionToken, sessionToken as string));
      const session = sessionRows[0];
      if (!session) {
        console.log("[AdminMiddleware] Invalid session token");
        return res.status(401).json({ success: false, message: "Invalid session" });
      }

      const profileRows = await db.select().from(profiles).where(eq(profiles.phone, session.phone));
      const profile = profileRows[0];
      if (!isServerAdminProfile(profile)) {
        return res.status(403).json({ success: false, message: "Access denied. Admin role required." });
      }
      next();
    } catch (error) {
      console.error("[AdminMiddleware] Error:", error);
      res.status(500).json({ success: false, message: "Internal server error in admin middleware" });
    }
  };

  app.post("/api/admin/add-admin", adminMiddleware, async (req, res) => {
    try {
      const { userId } = req.body;
      await db.update(profiles).set({ role: "admin" }).where(eq(profiles.id, userId));
      res.json({ success: true, message: "New admin added successfully" });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to add admin" });
    }
  });

  app.post("/api/admin/change-role", adminMiddleware, async (req, res) => {
    try {
      const { userId, newRole } = req.body;
      const allowedRoles = ["admin", "teacher", "technician", "customer", "supplier", "shopkeeper", "job_provider"];
      if (!allowedRoles.includes(newRole)) {
        return res.status(400).json({ success: false, message: "Invalid role" });
      }
      await db.update(profiles).set({ role: newRole as any }).where(eq(profiles.id, userId));
      res.json({ success: true, message: "Role updated successfully" });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to update role" });
    }
  });

  // User self-service role change — no admin required, uses session token to identify user
  app.post("/api/profile/change-role", async (req, res) => {
    try {
      const sessionToken = req.headers['x-session-token'] as string;
      const { newRole, userPhone } = req.body;
      const allowedRoles = ["teacher", "technician", "customer", "supplier", "shopkeeper", "job_provider", "admin"];
      if (!allowedRoles.includes(newRole)) {
        return res.status(400).json({ success: false, message: "Invalid role" });
      }
      
      let phone: string | null = null;
      
      // Try session token first
      if (sessionToken) {
        const sessionRows = await db.select().from(sessions).where(eq(sessions.sessionToken, sessionToken));
        if (sessionRows && sessionRows.length > 0) {
          phone = sessionRows[0].phone;
        }
      }
      
      // Fallback: use phone from request body if session lookup failed
      if (!phone && userPhone) {
        // Handle both regular phone (10+ digits) and email-format phones (email:xxx@xxx.com)
        if (userPhone.startsWith('email:')) {
          phone = userPhone; // Email-format, use as-is
        } else {
          const cleanPhone = (userPhone || '').replace(/\D/g, '');
          if (cleanPhone.length >= 10) {
            phone = cleanPhone;
          }
        }
      }
      
      if (!phone) {
        console.warn("[Profile] Cannot determine user phone — session token invalid and no phone provided");
        return res.status(401).json({ success: false, message: "Session expired. Please log out and log in again." });
      }
      
      // Find profile by phone (handles both phone and email-format phones)
      let profileRows: any[] = [];
      if (phone.startsWith('email:')) {
        // For email-format phones, match exactly
        profileRows = await db.select().from(profiles).where(eq(profiles.phone, phone));
      } else {
        // For regular phone numbers, match by cleaned digits
        const cleanPhone = phone.replace(/\D/g, '');
        const allProfiles = await db.select().from(profiles);
        profileRows = allProfiles.filter((p: any) => p.phone && p.phone.replace(/\D/g, '') === cleanPhone);
      }
      
      if (!profileRows || !profileRows[0]) {
        console.warn("[Profile] Profile not found for phone:", phone);
        return res.status(404).json({ success: false, message: "Profile not found" });
      }
      
      const currentProfile = profileRows[0];
      const currentRole = currentProfile.role as string;
      
      // Check if user is admin or super admin
      // Super admin privileges ONLY for phone-based login (8179142535), NOT for email-based login
      const isEmailBasedLogin = phone.startsWith('email:');
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      const isSuperAdmin = !isEmailBasedLogin && (cleanPhone === '8179142535' || cleanPhone === '9876543210');
      const isAdmin = currentRole === 'admin' || isSuperAdmin;
      
      // Admin (or super admin) can switch to any role
      if (!isAdmin) {
        // Non-admin role restrictions
        const roleRestrictions: Record<string, string[]> = {
          teacher: ['technician'],
          technician: ['teacher', 'supplier'],
          supplier: ['technician'],
          customer: [],
          job_provider: [],
        };
        
        const allowedNewRoles = roleRestrictions[currentRole] || [];
        if (!allowedNewRoles.includes(newRole)) {
          console.warn("[Profile] Role change denied:", currentRole, "→", newRole);
          return res.status(403).json({ 
            success: false, 
            message: `You can only switch to: ${allowedNewRoles.join(', ') || 'no other roles'}` 
          });
        }
      }
      
      await db.update(profiles).set({ role: newRole as any }).where(eq(profiles.id, currentProfile.id));
      console.log("[Profile] Role changed to", newRole, "for user", currentProfile.id, "phone:", phone);
      res.json({ success: true, message: "Role updated successfully" });
    } catch (error) {
      console.error("[Profile] Change role error:", error);
      res.status(500).json({ success: false, message: "Failed to update role" });
    }
  });

  // ========== File serving ==========
  const express = await import("express");
  app.use("/uploads", express.static(uploadsDir));
  app.use("/assets", express.static(path.join(process.cwd(), "server/templates")));

  async function proxyBunnyFile(folder: string, filename: string, res: any, req?: any) {
    if (!bunnyAvailable) {
      return res.status(404).json({ success: false, message: "Storage not available" });
    }
    const storageUrl = `${BUNNY_STORAGE_ENDPOINT}/${BUNNY_STORAGE_ZONE_NAME}/${folder}/${filename}`;
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
      '.mov': 'video/quicktime', '.webm': 'video/webm', '.MOV': 'video/quicktime',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const headers: Record<string, string> = { 'AccessKey': BUNNY_STORAGE_API_KEY };
    if (req?.headers?.range) {
      headers['Range'] = req.headers.range;
    }

    const response = await fetch(storageUrl, { headers });
    if (!response.ok && response.status !== 206) {
      return res.status(response.status).json({ success: false, message: "File not found" });
    }

    res.set('Content-Type', contentType);
    res.set('Accept-Ranges', 'bytes');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');

    const cl = response.headers.get('content-length');
    if (cl) res.set('Content-Length', cl);
    const cr = response.headers.get('content-range');
    if (cr) res.set('Content-Range', cr);

    res.status(response.status === 206 ? 206 : 200);
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  }

  app.get("/api/gcs/:folder/:filename", async (req, res) => {
    try {
      const { folder, filename } = req.params;
      if (!folder || !filename) {
        return res.status(404).json({ success: false, message: "File not found" });
      }
      if (req.query.proxy === '1' && bunnyAvailable) {
        return proxyBunnyFile(folder, filename, res, req);
      }
      if (bunnyAvailable) {
        const cdnUrl = `${BUNNY_CDN_URL}/${folder}/${filename}`;
        return res.redirect(302, cdnUrl);
      }
      return proxyBunnyFile(folder, filename, res, req);
    } catch (error) {
      console.error("[Files] Serve error:", error);
      return res.status(500).json({ success: false, message: "Failed to retrieve file" });
    }
  });

  app.get("/api/gcs-url/:folder/:filename", async (req, res) => {
    try {
      const { folder, filename } = req.params;
      if (!folder || !filename) {
        return res.status(404).json({ success: false, message: "File not found" });
      }
      if (bunnyAvailable) {
        return res.json({ url: `${BUNNY_CDN_URL}/${folder}/${filename}` });
      }
      return res.status(404).json({ success: false, message: "Failed to get URL" });
    } catch (error) {
      console.error("[Files] URL error:", error);
      return res.status(500).json({ success: false, message: "Failed to get URL" });
    }
  });

  app.get("/api/files/:folder/:filename", async (req, res) => {
    try {
      const { folder, filename } = req.params;
      if (!folder || !filename) {
        return res.status(400).json({ success: false, message: "File path required" });
      }
      return proxyBunnyFile(folder, filename, res);
    } catch (error) {
      console.error("[Files] Download error:", error);
      return res.status(500).json({ success: false, message: "Failed to retrieve file" });
    }
  });

  app.post("/api/upload", upload.single("image"), async (req, res) => {
    try {
      console.log('[Upload] POST /api/upload - Request received');
      if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
      const ext = path.extname(req.file.originalname) || '.jpg';
      const filename = `images/${randomUUID()}${ext}`;
      const url = await uploadToStorage(req.file.buffer, filename);
      res.json({ success: true, url });
    } catch (error) {
      console.error("[Upload] Error:", error);
      res.status(500).json({ success: false, message: "Upload failed" });
    }
  });

  app.post("/api/upload-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
      const ext = path.extname(req.file.originalname) || '.jpg';
      const filename = `images/${randomUUID()}${ext}`;
      const url = await uploadToStorage(req.file.buffer, filename);
      res.json({ success: true, url });
    } catch (error: any) {
      console.error("[Upload] Error:", error);
      res.status(500).json({ success: false, message: error.message || "Upload failed" });
    }
  });


  // ─── Bunny Stream: Create video slot (returns videoId + TUS upload URL) ───
  app.post("/api/bunny/create-video", async (req, res) => {
    try {
      if (!bunnyStreamAvailable) {
        return res.status(503).json({ success: false, message: "Bunny Stream not configured" });
      }
      const { title } = req.body;
      if (!title) return res.status(400).json({ success: false, message: "Title is required" });

      const response = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos`,
        {
          method: "POST",
          headers: {
            AccessKey: BUNNY_STREAM_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title }),
        }
      );
      if (!response.ok) {
        const txt = await response.text().catch(() => '');
        console.error(`[BunnyStream] Create video failed: ${response.status} ${txt}`);
        return res.status(502).json({ success: false, message: "Failed to create Bunny Stream video" });
      }
      const data = await response.json() as any;
      const videoId = data.guid;
      
      // Use 6-hour expiry
      const expires = Math.floor(Date.now() / 1000) + 21600;
      
      // Bunny Stream TUS signature: plain SHA256(LibraryId + ApiKey + ExpirationTime + VideoId)
      const signature = crypto
        .createHash("sha256")
        .update(BUNNY_STREAM_LIBRARY_ID + BUNNY_STREAM_API_KEY + expires + videoId)
        .digest("hex");

      const playbackUrl = `https://iframe.mediadelivery.net/embed/${BUNNY_STREAM_LIBRARY_ID}/${videoId}`;
      const directUrl = `https://vz-${BUNNY_STREAM_LIBRARY_ID}.b-cdn.net/${videoId}/playlist.m3u8`;
      
      console.log(`[BunnyStream] Created video slot: ${videoId}, expires: ${expires}`);
      
      res.json({
        success: true,
        videoId,
        libraryId: BUNNY_STREAM_LIBRARY_ID,
        signature,
        expires,
        uploadUrl: "https://video.bunnycdn.com/tusupload",
        playbackUrl,
        directUrl,
      });
    } catch (error: any) {
      console.error("[BunnyStream] create-video error:", error?.message || error);
      res.status(503).json({ success: false, message: error?.message || "Internal error" });
    }
  });

  app.post("/api/videos/upload", async (req, res) => {
    try {
      const { uri } = req.body;
      if (!uri || typeof uri !== "string") {
        return res.status(400).json({ success: false, message: "Video URI is required" });
      }
      const filename = `videos/${randomUUID()}.mp4`;
      console.log(`[Videos] Direct upload fallback: ${filename}`);
      res.json({
        success: true,
        videoId: randomUUID(),
        playbackUrl: uri,
        directUrl: uri,
      });
    } catch (error: any) {
      console.error("[Videos] upload error:", error?.message || error);
      res.status(500).json({ success: false, message: error?.message || "Internal error" });
    }
  });

  // ─── Bunny Stream: Get video encoding status ───
  app.get("/api/bunny/video-status/:videoId", async (req, res) => {
    try {
      if (!bunnyStreamAvailable) {
        return res.status(503).json({ success: false, message: "Bunny Stream not configured" });
      }
      const { videoId } = req.params;
      const response = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`,
        { headers: { AccessKey: BUNNY_STREAM_API_KEY } }
      );
      if (!response.ok) {
        return res.status(502).json({ success: false, message: "Failed to get video status" });
      }
      const data = await response.json() as any;
      res.json({
        success: true,
        status: data.status,
        encodeProgress: data.encodeProgress,
        length: data.length,
        thumbnailUrl: data.thumbnailUrl,
        playbackUrl: `https://iframe.mediadelivery.net/embed/${BUNNY_STREAM_LIBRARY_ID}/${videoId}`,
        directUrl: `https://vz-${BUNNY_STREAM_LIBRARY_ID}.b-cdn.net/${videoId}/playlist.m3u8`,
      });
    } catch (error: any) {
      console.error("[BunnyStream] video-status error:", error?.message || error);
      res.status(500).json({ success: false, message: error?.message || "Internal error" });
    }
  });


  app.post("/api/upload-base64", async (req, res) => {
    try {
      const { base64, mimeType } = req.body;
      if (!base64) {
        return res.status(400).json({ success: false, message: "No image data provided" });
      }
      const ext = (mimeType || "image/jpeg").includes("png") ? ".png" : ".jpg";
      const storageName = `images/${randomUUID()}${ext}`;
      const buffer = Buffer.from(base64, "base64");
      const imageUrl = await uploadToStorage(buffer, storageName);
      console.log(`[Upload] Base64 image saved: ${imageUrl} (${buffer.length} bytes)`);
      return res.json({ success: true, url: imageUrl });
    } catch (error) {
      console.error("[Upload] Base64 error:", error);
      return res.status(500).json({ success: false, message: "Upload failed" });
    }
  });

  // ========== Firebase OTP routes ==========
  app.post("/api/firebase-otp/send-phone", async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ success: false, message: "Phone number required" });
      }

      const cleanPhone = phone.replace(/\D/g, "").slice(-10);
      if (cleanPhone.length !== 10) {
        return res.status(400).json({ success: false, message: "Invalid phone number" });
      }

      const identifier = `+91${cleanPhone}`;
      console.log(`[Firebase SMS OTP] Sending to phone: ${identifier}`);

      // Rate limiting
      const rateCheck = checkOtpRateLimit(identifier);
      if (!rateCheck.allowed) {
        const secondsLeft = Math.ceil(rateCheck.retryAfterMs / 1000);
        return res.status(429).json({
          success: false,
          message: `Too many requests. Wait ${secondsLeft}s`,
          retryAfterSeconds: secondsLeft,
        });
      }

      // Generate OTP and store in database
      const otp = generateOTP();
      const expiresAt = Date.now() + 5 * 60 * 1000;

      await db.delete(otpTokens).where(eq(otpTokens.phone, cleanPhone));
      await db.insert(otpTokens).values({ phone: cleanPhone, otp, expiresAt });

      console.log(`[Firebase SMS OTP] Generated OTP for ${identifier}: ${otp}`);

      // Send OTP via Firebase Admin SDK / GCP SMS service
      try {
        // For now, backend stores OTP - frontend can use Firebase Phone Auth
        // Or backend can send via GCP SMS integration
        console.log(`[Firebase SMS OTP] OTP stored: ${cleanPhone} = ${otp}`);

        res.json({
          success: true,
          message: 'OTP ready. Firebase/GCP will send via SMS.',
          phone: identifier,
          otp: process.env.NODE_ENV === 'development' ? otp : undefined,
        });
      } catch (sendErr: any) {
        console.error(`[Firebase SMS OTP] SMS send failed: ${sendErr?.message}`);
        res.status(500).json({
          success: false,
          message: 'Failed to send OTP via SMS',
        });
      }
    } catch (error: any) {
      console.error('[Firebase SMS OTP] Error:', error);
      res.status(500).json({ success: false, message: error?.message || 'Server error' });
    }
  });

  app.post("/api/firebase-otp/verify-phone", async (req, res) => {
    try {
      const { otp, phone } = req.body;
      if (!otp) {
        return res.status(400).json({ success: false, message: "OTP required" });
      }

      const code = otp.replace(/\D/g, "");
      if (code.length !== 6) {
        return res.status(400).json({ success: false, message: "Invalid OTP format" });
      }

      console.log(`[Firebase SMS OTP] Verifying OTP: ${code}`);

      // Find matching OTP in database
      const otpRecords = await db
        .select()
        .from(otpTokens)
        .where(eq(otpTokens.otp, code))
        .limit(1);

      if (otpRecords.length === 0) {
        console.warn('[Firebase SMS OTP] OTP not found');
        return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
      }

      const record = otpRecords[0];
      if (Date.now() > record.expiresAt) {
        console.warn('[Firebase SMS OTP] OTP expired');
        await db.delete(otpTokens).where(eq(otpTokens.otp, code));
        return res.status(400).json({ success: false, message: "OTP expired" });
      }

      console.log(`[Firebase SMS OTP] OTP verified for ${record.phone || record.email}`);

      // Clean up used OTP
      await db.delete(otpTokens).where(eq(otpTokens.otp, code));

      // NO AUTO-LOGIN - just return verification success
      // Frontend will handle login flow separately after OTP verification
      res.json({
        success: true,
        message: "OTP verified successfully",
        verified: true,
        phone: record.phone ? `+91${record.phone}` : undefined,
        email: record.email,
      });
    } catch (error: any) {
      console.error('[Firebase SMS OTP] Verify error:', error);
      res.status(500).json({ success: false, message: error?.message || 'Server error' });
    }
  });

  // ========== OTP routes ==========
  app.post("/api/otp/send", async (req, res) => {
    try {
      const { phone, email } = req.body;
      
      // Validate input - either phone or email required
      if (!phone && !email) {
        return res.status(400).json({ success: false, message: "Phone number or email is required" });
      }

      const identifier = phone || email;
      const isEmail = !!email;

      // CRITICAL: Rate limiting - max 1 OTP per identifier per 60 seconds
      console.log(`[OTP] Request from ${identifier} (${isEmail ? 'email' : 'phone'}) - checking rate limit`);
      const rateCheck = checkOtpRateLimit(identifier);
      if (!rateCheck.allowed) {
        const secondsLeft = Math.ceil(rateCheck.retryAfterMs / 1000);
        console.warn(`[OTP] Rate limit exceeded for ${identifier}: ${secondsLeft}s remaining`);
        return res.status(429).json({
          success: false,
          message: `Too many OTP requests. Please wait ${secondsLeft} seconds before trying again.`,
          retryAfterSeconds: secondsLeft,
        });
      }

      console.log(`[OTP] Rate limit passed for ${identifier} - proceeding with OTP generation`);

      const otp = generateOTP();
      const expiresAt = Date.now() + 5 * 60 * 1000;

      // Delete old OTP for this identifier
      if (isEmail) {
        await db.delete(otpTokens).where(eq(otpTokens.email, email));
        await db.insert(otpTokens).values({ email, otp, expiresAt });
      } else {
        const cleanPhone = phone.replace(/\D/g, "");
        if (cleanPhone.length < 10) {
          return res.status(400).json({ success: false, message: "Valid phone number is required (at least 10 digits)" });
        }
        await db.delete(otpTokens).where(eq(otpTokens.phone, cleanPhone));
        await db.insert(otpTokens).values({ phone: cleanPhone, otp, expiresAt });
      }

      console.log(`[OTP] GENERATED OTP for ${identifier}: ${otp} (5 min expiry)`);

      let sentSuccess = false;
      let sentError = '';

      if (isEmail) {
        // Send via email
        console.log(`[OTP-EMAIL] Sending OTP to ${email}`);
        const emailResult = await sendOTPEmail(email, otp);
        sentSuccess = emailResult.success;
        if (!sentSuccess) {
          sentError = emailResult.error || 'Email service unavailable';
          if (emailResult.details) {
            sentError += ` (${emailResult.details})`;
          }
          console.error(`[OTP-EMAIL] Detailed error for ${email}:`, emailResult);
        }
      } else {
        // Send via SMS using Fast2SMS
        console.log(`[OTP-SMS] Sending OTP via Fast2SMS to ${phone}`);
        const smsResult = await sendOTPSMS(phone, otp);
        sentSuccess = smsResult.success;
        if (!sentSuccess) {
          sentError = smsResult.error || 'SMS service unavailable';
          console.error(`[OTP-SMS] Error sending to ${phone}:`, smsResult);
        } else {
          console.log(`[OTP-SMS] Successfully sent to ${phone}`);
        }
      }

      // Log final result
      console.log(`[OTP] COMPLETE for ${identifier}: sent=${sentSuccess}, error='${sentError}'`);
      
      return res.json({
        success: true,
        sent: sentSuccess,
        smsSent: sentSuccess && !isEmail,
        message: sentSuccess ? `OTP sent to ${identifier}` : `OTP generated but delivery failed: ${sentError}`,
        otp: otp, // Return OTP in response for dev/testing (frontend can decide what to do)
      });
    } catch (error: any) {
      console.error("[OTP] Send error:", error?.message || error, error?.stack?.split('\n').slice(0,3).join(' '));
      return res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
  });

  app.post("/api/auth/check-email", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ success: false, message: "Email is required" });
      }
      const cleanEmail = email.trim().toLowerCase();
      const allProfilesList = await db.select().from(profiles);
      let existingProfile = allProfilesList.find(p => (p.email || "").toLowerCase() === cleanEmail && p.role === 'admin');
      if (!existingProfile) {
        existingProfile = allProfilesList.find(p => (p.email || "").toLowerCase() === cleanEmail);
      }
      if (existingProfile && existingProfile.blocked === 1) {
        return res.json({ success: false, message: "Your account has been blocked. Please contact admin for support." });
      }
      return res.json({
        success: true,
        exists: !!existingProfile,
        profile: existingProfile || null,
      });
    } catch (error: any) {
      console.error("[CheckEmail] Error:", error?.message);
      return res.status(500).json({ success: false, message: "Failed to check email" });
    }
  });

  // Auto-login endpoint (bypasses OTP)
  app.post("/api/auth/auto-login", async (req, res) => {
    try {
      const { phone, email, deviceId } = req.body;
      const isEmailVerification = !!email && !phone;
      const identifier = isEmailVerification ? `email:${email.trim().toLowerCase()}` : (phone || "").replace(/\D/g, "");

      if (!phone && !email) {
        return res.status(400).json({ success: false, message: "Phone or email is required" });
      }

      const cleanPhone = isEmailVerification ? "" : identifier;
      const cleanEmail = isEmailVerification ? email.trim().toLowerCase() : "";

      const allProfilesList = await db.select().from(profiles);

      let existingProfile;
      if (isEmailVerification) {
        existingProfile = allProfilesList.find(p => (p.email || "").toLowerCase() === cleanEmail && p.role === 'admin');
        if (!existingProfile) {
          existingProfile = allProfilesList.find(p => (p.email || "").toLowerCase() === cleanEmail);
        }
      } else {
        existingProfile = allProfilesList.find(p => p.phone.replace(/\D/g, "") === cleanPhone && p.role === 'admin');
        if (!existingProfile) {
          existingProfile = allProfilesList.find(p => p.phone.replace(/\D/g, "") === cleanPhone);
        }
      }

      // Allow admin bypass phones even if blocked
      const isBypassPhone = (cleanPhone === '8179142535' || cleanPhone === '9398391742');
      
      if (existingProfile && existingProfile.blocked === 1 && !isBypassPhone) {
        return res.json({
          success: false,
          message: "Your account has been blocked. Please contact admin for support.",
        });
      }

      if (existingProfile && deviceId && existingProfile.role === "technician") {
        const currentDeviceId = existingProfile.deviceId || "";
        if (currentDeviceId && currentDeviceId !== deviceId) {
          await db.update(profiles).set({ deviceId }).where(eq(profiles.id, existingProfile.id));
        } else if (!currentDeviceId) {
          await db.update(profiles).set({ deviceId }).where(eq(profiles.id, existingProfile.id));
        }
      }

      // Create session
      const sessionToken = crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).substr(2);
      await db.insert(sessions).values({
        sessionToken,
        phone: isEmailVerification ? cleanEmail : cleanPhone,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      return res.json({
        success: true,
        message: "Auto-login successful",
        sessionToken,
        isNewUser: !existingProfile,
        profile: existingProfile || null,
      });
    } catch (error) {
      console.error("[AutoLogin] Error:", error);
      return res.status(500).json({ success: false, message: "Auto-login failed" });
    }
  });

  app.post("/api/otp/verify", async (req, res) => {
    try {
      const { phone, email, otp, deviceId } = req.body;
      const isEmailVerification = !!email && !phone;
      const identifier = isEmailVerification ? `email:${email.trim().toLowerCase()}` : (phone || "").replace(/\D/g, "");

      if ((!phone && !email) || !otp) {
        return res.status(400).json({ success: false, message: "Phone or email and OTP are required" });
      }

      const cleanPhone = isEmailVerification ? "" : identifier;
      const cleanEmail = isEmailVerification ? email.trim().toLowerCase() : "";
      const lookupKey = isEmailVerification ? `email:${cleanEmail}` : cleanPhone;

      // Bypass OTP for specific test/admin numbers (accepts any OTP)
      const isBypassPhone = (cleanPhone === '8179142535' || cleanPhone === '9398391742');
      const isBypassEmail = (cleanEmail === 'admin@mobi.app');
      const isSuperAdminBypass = (isBypassPhone && !isEmailVerification) || (isBypassEmail && isEmailVerification);

      if (!isSuperAdminBypass) {
        // Normal OTP verification - check database
        let storedRows;
        if (isEmailVerification) {
          storedRows = await db.select().from(otpTokens).where(eq(otpTokens.email, cleanEmail));
        } else {
          storedRows = await db.select().from(otpTokens).where(eq(otpTokens.phone, cleanPhone));
        }
        const stored = storedRows[0];

        if (!stored) {
          return res.status(400).json({ success: false, message: "OTP not found. Please request a new one." });
        }

        if (Date.now() > stored.expiresAt) {
          if (isEmailVerification) {
            await db.delete(otpTokens).where(eq(otpTokens.email, cleanEmail));
          } else {
            await db.delete(otpTokens).where(eq(otpTokens.phone, cleanPhone));
          }
          return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
        }

        if (stored.otp !== otp) {
          return res.status(400).json({ success: false, message: "Invalid OTP. Please try again." });
        }

        if (isEmailVerification) {
          await db.delete(otpTokens).where(eq(otpTokens.email, cleanEmail));
        } else {
          await db.delete(otpTokens).where(eq(otpTokens.phone, cleanPhone));
        }
      } else {
        // Admin/test bypass - skip all OTP checks
        console.log(`[OTP] Admin/test bypass accepted for ${isEmailVerification ? cleanEmail : cleanPhone}`);
      }

      const allProfilesList = await db.select().from(profiles);

      let existingProfile;
      if (isEmailVerification) {
        existingProfile = allProfilesList.find(p => (p.email || "").toLowerCase() === cleanEmail && p.role === 'admin');
        if (!existingProfile) {
          existingProfile = allProfilesList.find(p => (p.email || "").toLowerCase() === cleanEmail);
        }
      } else {
        existingProfile = allProfilesList.find(p => p.phone.replace(/\D/g, "") === cleanPhone && p.role === 'admin');
        if (!existingProfile) {
          existingProfile = allProfilesList.find(p => p.phone.replace(/\D/g, "") === cleanPhone);
        }
      }

      if (existingProfile && existingProfile.blocked === 1) {
        return res.json({
          success: false,
          message: "Your account has been blocked. Please contact admin for support.",
        });
      }

      if (existingProfile && deviceId && existingProfile.role === "technician") {
        const currentDeviceId = existingProfile.deviceId || "";
        if (currentDeviceId && currentDeviceId !== deviceId) {
          await db.update(profiles).set({ deviceId }).where(eq(profiles.id, existingProfile.id));
        } else if (!currentDeviceId) {
          await db.update(profiles).set({ deviceId }).where(eq(profiles.id, existingProfile.id));
        }
      }

      const sessionPhone = isEmailVerification ? (existingProfile?.phone || `email:${cleanEmail}`) : cleanPhone;
      const sessionToken = randomUUID();
      await db.delete(sessions).where(eq(sessions.phone, sessionPhone));
      await db.insert(sessions).values({
        phone: sessionPhone,
        sessionToken,
      });

      const response: any = {
        success: true,
        message: isEmailVerification ? "Email verified successfully" : "Phone number verified successfully",
        sessionToken,
        isEmailVerification,
        ...(isEmailVerification && { emailPhone: sessionPhone }),
      };
      if (existingProfile) {
        response.isNewUser = false;
        response.profile = existingProfile;
      } else {
        response.isNewUser = true;
      }
      return res.json(response);
    } catch (error) {
      console.error("[OTP] Verify error:", error);
      return res.status(500).json({ success: false, message: "Verification failed" });
    }
  });

  app.post("/api/auth/firebase-phone", async (req, res) => {
    try {
      const { idToken, deviceId } = req.body;
      if (!idToken) {
        return res.status(400).json({ success: false, message: "Firebase ID token is required" });
      }

      let decodedToken: any;
      try {
        decodedToken = await getAdminAuth().verifyIdToken(idToken);
      } catch (verifyErr: any) {
        console.error("[Firebase Phone] Token verification failed:", verifyErr?.message);
        return res.status(401).json({ success: false, message: "Invalid Firebase token. Please try again." });
      }

      const firebasePhone = decodedToken.phone_number;
      if (!firebasePhone) {
        return res.status(400).json({ success: false, message: "No phone number found in Firebase token." });
      }

      const cleanPhone = firebasePhone.replace(/\D/g, "").replace(/^91/, "");
      console.log(`[Firebase Phone] Verified phone: ${cleanPhone}`);

      const allProfilesList = await db.select().from(profiles);
      // Prioritize admin role if multiple profiles exist
      let existingProfile = allProfilesList.find(p => p.phone.replace(/\D/g, "") === cleanPhone && p.role === 'admin');
      if (!existingProfile) {
        existingProfile = allProfilesList.find(p => p.phone.replace(/\D/g, "") === cleanPhone);
      }

      if (existingProfile && existingProfile.blocked === 1) {
        return res.json({ success: false, message: "Your account has been blocked. Please contact admin for support." });
      }

      if (existingProfile && deviceId && existingProfile.role === "technician") {
        const currentDeviceId = existingProfile.deviceId || "";
        if (currentDeviceId && currentDeviceId !== deviceId) {
          await db.update(profiles).set({ deviceId }).where(eq(profiles.id, existingProfile.id));
        } else if (!currentDeviceId) {
          await db.update(profiles).set({ deviceId }).where(eq(profiles.id, existingProfile.id));
        }
      }

      const sessionToken = randomUUID();
      await db.delete(sessions).where(eq(sessions.phone, cleanPhone));
      await db.insert(sessions).values({ phone: cleanPhone, sessionToken });

      // Return profile for existing users so frontend can skip registration
      const response: any = { success: true, message: "Phone verified via Firebase", sessionToken };
      if (existingProfile) {
        response.isNewUser = false;
        response.profile = existingProfile;
      } else {
        response.isNewUser = true;
      }
      return res.json(response);
    } catch (error: any) {
      console.error("[Firebase Phone] Error:", error?.message || error);
      return res.status(500).json({ success: false, message: "Firebase verification failed. Please try again." });
    }
  });

  app.post("/api/session/validate", async (req, res) => {
    try {
      const { sessionToken, phone } = req.body;
      if (!sessionToken || !phone) {
        return res.json({ valid: false });
      }
      // Email-link accounts use "email:xxx@xxx.com" as their phone identifier
      const isEmailAccount = phone.includes('@') || phone.startsWith('email:');
      let result;
      if (isEmailAccount) {
        result = await db.select().from(sessions).where(
          and(eq(sessions.sessionToken, sessionToken), eq(sessions.phone, phone))
        );
      } else {
        const cleanPhone = phone.replace(/\D/g, "");
        result = await db.select().from(sessions).where(
          and(eq(sessions.sessionToken, sessionToken), eq(sessions.phone, cleanPhone))
        );
      }
      return res.json({ valid: result.length > 0 });
    } catch (error) {
      console.error("[Session] Validate error:", error);
      return res.json({ valid: false });
    }
  });

  function sendGoogleErrorPage(res: any, errorMsg: string) {
    console.error("[Google Auth] Error:", errorMsg);
    return res.status(400).send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign-in Error</title>
<style>body{background:#0D0D0F;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui,-apple-system,sans-serif}
.c{text-align:center;padding:24px}h2{color:#FF6B35;margin:0 0 12px}p{color:#aaa;margin:0 0 20px;font-size:15px}
.sub{color:#666;font-size:13px}</style></head>
<body><div class="c">
<h2>Sign-in Failed</h2>
<p>${errorMsg}</p>
<p class="sub">Please go back to the Mobi app and try again</p>
</div></body></html>`);
  }

  // ========== Google auth login URL generator ==========
  app.post("/api/auth/google/get-login-url", (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ success: false, message: "Token required" });
      
      const clientId = googleOAuthClientId();
      const redirectUri = googleOAuthRedirectUri();
      if (!clientId || !redirectUri) {
        return res.status(500).json({
          success: false,
          message: "Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_OAUTH_REDIRECT_URI / API_PUBLIC_URL)",
        });
      }
      console.log("[Google Auth] get-login-url configured");
      
      const stateObj = { token };
      const stateStr = Buffer.from(JSON.stringify(stateObj)).toString('base64');
      const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=email%20profile&state=${encodeURIComponent(stateStr)}&prompt=select_account`;
      return res.json({ success: true, url: googleUrl });
    } catch (error) {
      console.error("[Google Auth] get-login-url error:", error);
      return res.status(500).json({ success: false, message: "Failed to generate URL" });
    }
  });

  // ========== Google auth return URL registration ==========
  const googleReturnUrls = new Map<string, string>();

  app.post("/api/auth/google/set-return-url", (req, res) => {
    const { token, returnUrl } = req.body;
    if (token && returnUrl) {
      googleReturnUrls.set(token, returnUrl);
      console.log("[Google Auth] Stored return URL for token:", token.substring(0, 8), "url:", returnUrl.substring(0, 80));
    }
    return res.json({ success: true });
  });

  app.get("/api/admin/chat-settings", async (req, res) => {
    try {
      const settings = await db.select().from(appSettings);
      const repliesSetting = settings.find(s => s.key === "community_replies_enabled");
      const communityEnabled = repliesSetting ? repliesSetting.value !== "false" : true;
      const messageDelay = parseInt(settings.find(s => s.key === "chat_message_delay")?.value || "0");
      return res.json({
        success: true,
        community_replies_enabled: communityEnabled,
        chat_message_delay: messageDelay
      });
    } catch (error) {
      console.error("[Admin] Get chat settings error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch chat settings" });
    }
  });

  app.post("/api/admin/chat-settings", async (req, res) => {
    try {
      const { community_replies_enabled, chat_message_delay } = req.body;
      
      if (community_replies_enabled !== undefined) {
        const val = String(community_replies_enabled === true || community_replies_enabled === "true");
        await db.insert(appSettings)
          .values({ key: "community_replies_enabled", value: val })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: val } });
      }
      
      if (chat_message_delay !== undefined) {
        await db.insert(appSettings)
          .values({ key: "chat_message_delay", value: String(chat_message_delay) })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: String(chat_message_delay) } });
      }
      
      return res.json({ success: true });
    } catch (error) {
      console.error("[Admin] Update chat settings error:", error);
      return res.status(500).json({ success: false, message: "Failed to update chat settings" });
    }
  });
  app.get("/api/auth/google/callback", async (req, res) => {
    try {
      const { code, state, error: googleError } = req.query;
      console.log("[Google Auth] Callback received, code:", !!code, "state:", !!state, "error:", googleError);

      if (googleError) {
        console.error("[Google Auth] Google error:", googleError);
        return sendGoogleErrorPage(res, `Google returned error: ${googleError}`);
      }

      if (!code) {
        console.error("[Google Auth] No code received");
        return sendGoogleErrorPage(res, "No authorization code received from Google.");
      }

      const clientId = googleOAuthClientId();
      const clientSecret = getGoogleClientSecret();
      const redirectUri = googleOAuthRedirectUri();
      if (!clientId || !redirectUri || !clientSecret) {
        return sendGoogleErrorPage(res, "Google OAuth not configured on server.");
      }
      console.log("[Google Auth] Callback: exchanging token");
      console.log("[Google Auth] Callback: clientSecret present:", !!clientSecret);
      console.log("[Google Auth] Callback: redirectUri:", redirectUri);

      console.log("[Google Auth] Exchanging authorization code for token...");
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: code as string,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });

      const tokenData = await tokenRes.json() as any;
      console.log("[Google Auth] Token exchange status:", tokenRes.status);
      
      if (tokenData.error) {
        console.error("[Google Auth] Token exchange error:", tokenData.error, "-", tokenData.error_description);
        return sendGoogleErrorPage(res, tokenData.error_description || tokenData.error || "Failed to authenticate with Google.");
      }

      if (!tokenData.access_token) {
        console.error("[Google Auth] No access_token in response. Response:", JSON.stringify(tokenData).substring(0, 300));
        return sendGoogleErrorPage(res, "Failed to get access token from Google. Please try again.");
      }

      console.log("[Google Auth] Token exchange successful, fetching user info...");
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userInfo = await userInfoRes.json() as any;

      if (!userInfo.email) {
        console.error("[Google Auth] No email in userInfo:", Object.keys(userInfo).join(", "));
        return sendGoogleErrorPage(res, "Could not get email from your Google account.");
      }

      const email = userInfo.email;
      const name = userInfo.name || '';
      const picture = userInfo.picture || '';
      console.log("[Google Auth] Got user email:", email);
      
      // Create or update user in profiles table
      try {
        const existingUser = await db.select().from(profiles).where(eq(profiles.email, email));
        let userId: string;
        
        if (existingUser.length > 0) {
          // Update existing user
          userId = existingUser[0].id;
          await db.update(profiles)
            .set({ name, picture })
            .where(eq(profiles.id, userId));
          console.log("[Google Auth] Updated existing user:", email);
        } else {
          // Create new user
          userId = randomUUID();
          await db.insert(profiles).values({
            id: userId,
            email,
            name,
            picture,
            phone: '',
            role: 'customer', // Default role
            bio: '',
            location: '',
            ratingAverage: 0,
            ratingCount: 0,
            verifiedBadge: false,
            deviceId: '',
            skills: '[]',
          });
          console.log("[Google Auth] Created new user:", email);
        }
      } catch (dbError) {
        console.error("[Google Auth] Database error creating/updating user:", dbError);
        return sendGoogleErrorPage(res, "Failed to create user account. Please try again.");
      }

      // Send welcome email asynchronously
      sendWelcomeEmail(email, name).catch(err => console.error("[Email] Async error:", err));

      let clientToken = randomUUID();
      let returnUrl = '';
      try {
        if (state) {
          const safeState = (state as string).replace(/ /g, '+');
          const stateStr = Buffer.from(safeState, 'base64').toString('utf-8');
          const stateObj = JSON.parse(stateStr);
          if (stateObj.token) clientToken = stateObj.token;
          if (stateObj.returnUrl) returnUrl = stateObj.returnUrl;
        }
      } catch (e) {
        console.error("[Google Auth] State parse error:", e);
      }

      if (!returnUrl && googleReturnUrls.has(clientToken)) {
        returnUrl = googleReturnUrls.get(clientToken)!;
        googleReturnUrls.delete(clientToken);
        console.log("[Google Auth] Got return URL from pre-registered map:", returnUrl.substring(0, 80));
      }
      googleAuthTokens.set(clientToken, { email, name, createdAt: Date.now() });

      if (returnUrl) {
        const separator = returnUrl.includes('?') ? '&' : '?';
        const deepLink = `${returnUrl}${separator}email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`;
        console.log("[Google Auth] Redirecting to deep link:", deepLink);
        return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Returning to Mobi...</title>
<style>body{background:#0D0D0F;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui}
.c{text-align:center;padding:24px}h2{color:#FF6B35;margin:0 0 12px}p{color:#ccc;margin:8px 0}
.spinner{width:40px;height:40px;border:4px solid #333;border-top:4px solid #FF6B35;border-radius:50%;animation:spin 1s linear infinite;margin:20px auto}
@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>
</head><body><div class="c">
<div class="spinner"></div>
<h2>Returning to Mobi...</h2>
<p>If the app doesn't open automatically,<br>tap the button below.</p>
<a href="${deepLink}" style="display:inline-block;margin-top:20px;padding:14px 32px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600">Open Mobi App</a>
</div>
<script>
setTimeout(function(){window.location.href="${deepLink}"},500);
setTimeout(function(){window.location.href="${deepLink}"},2000);
</script>
</body></html>`);
      }

      return res.redirect(`/api/auth/google/success?token=${clientToken}`);
    } catch (error) {
      console.error("[Google Auth] Callback error:", error);
      return sendGoogleErrorPage(res, "An unexpected error occurred during sign-in.");
    }
  });

  // ========== Google auth check ==========
  app.get("/api/auth/google/success", (req, res) => {
    const { token } = req.query;
    if (!token || !googleAuthTokens.has(token as string)) {
      return res.status(400).send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#0D0D0F;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui}
.c{text-align:center}a{color:#FF6B35}</style></head>
<body><div class="c"><p>Session expired. Please try again.</p><a href="/">Go back</a></div></body></html>`);
    }

    return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signed In</title>
<style>body{background:#0D0D0F;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui,-apple-system,sans-serif}
.c{text-align:center;padding:24px}.icon{font-size:56px;margin-bottom:16px;color:#FF6B35}
h2{margin:0 0 12px;font-size:24px;color:#FF6B35}p{color:#ccc;margin:0 0 8px;font-size:16px;line-height:1.5}
.btn{display:inline-block;margin-top:24px;padding:16px 40px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:12px;font-size:18px;font-weight:700}
.sub{color:#888;font-size:13px;margin-top:20px}</style>
</head>
<body><div class="c">
<div class="icon">&#10003;</div>
<h2>Signed in successfully!</h2>
<p>Now switch back to the Mobi app.<br>Your sign-in will complete automatically.</p>
<p style="color:#FF6B35;font-size:18px;font-weight:700;margin-top:24px">Swipe up from the bottom<br>and tap Expo Go in recent apps</p>
<p class="sub">The app will detect your sign-in<br>and continue automatically</p>
</div></body></html>`);
  });

  app.get("/api/auth/google/done", (req, res) => {
    const { email, name: gname } = req.query;
    return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign-in Successful</title>
<style>body{background:#0D0D0F;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui,-apple-system,sans-serif}
.c{text-align:center;padding:24px}.icon{font-size:48px;margin-bottom:16px;color:#FF6B35}
h2{margin:0 0 8px;font-size:22px;color:#FF6B35}p{color:#aaa;margin:0 0 16px;font-size:15px}</style>
</head>
<body><div class="c">
<div class="icon">&#10003;</div>
<h2>Signed in successfully!</h2>
<p>Returning to Mobi app...</p>
</div>
<script>setTimeout(function(){window.close();},800);</script>
</body></html>`);
  });

  app.post("/api/auth/google/process-code", async (req, res) => {
    try {
      const { code, state } = req.body;
      if (!code) {
        return res.status(400).json({ success: false, message: "No authorization code" });
      }

      const clientId = googleOAuthClientId();
      const clientSecret = getGoogleClientSecret();
      const redirectUri = googleOAuthRedirectUri();

      if (!clientId || !clientSecret || !redirectUri) {
        return res.status(500).json({ success: false, message: "Google OAuth not configured" });
      }

      console.log("[Google Auth] process-code redirect_uri:", redirectUri);
      console.log("[Google Auth] process-code code prefix:", code.substring(0, 10));

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: code as string,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });

      const tokenData = await tokenRes.json() as any;
      console.log("[Google Auth] process-code token status:", tokenRes.status, "has access_token:", !!tokenData.access_token);

      if (!tokenData.access_token) {
        console.error("[Google Auth] process-code token failed:", JSON.stringify(tokenData));
        return res.status(400).json({ success: false, message: tokenData.error_description || "Token exchange failed" });
      }

      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userInfo = await userInfoRes.json() as any;

      if (!userInfo.email) {
        return res.status(400).json({ success: false, message: "Could not get email" });
      }

      const email = userInfo.email;
      const name = userInfo.name || '';
      console.log("[Google Auth] process-code success:", email);

      // Send welcome email asynchronously
      sendWelcomeEmail(email, name).catch(err => console.error("[Email] Async error:", err));

      let clientToken = randomUUID();
      try {
        if (state) {
          const stateStr = Buffer.from(state as string, 'base64').toString('utf-8');
          const stateObj = JSON.parse(stateStr);
          if (stateObj.token) clientToken = stateObj.token;
        }
      } catch (e) {}
      googleAuthTokens.set(clientToken, { email, name, createdAt: Date.now() });

      return res.json({ success: true, token: clientToken, email, name });
    } catch (error) {
      console.error("[Google Auth] process-code error:", error);
      return res.status(500).json({ success: false, message: "Server error during authentication" });
    }
  });

  app.post("/api/auth/google/exchange", (req, res) => {
    const { token } = req.body;
    if (!token || !googleAuthTokens.has(token as string)) {
      return res.status(400).json({ success: false, message: "Invalid or expired token" });
    }
    const data = googleAuthTokens.get(token as string)!;
    googleAuthTokens.delete(token as string);
    return res.json({ success: true, email: data.email, name: data.name });
  });

  app.post("/api/auth/send-welcome-email", async (req, res) => {
    try {
      const { email, name } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ success: false, message: "Email is required" });
      }
      sendWelcomeEmail(email, name || "there").catch(err => console.error("[Email] Async welcome error:", err));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Send welcome email error:", error);
      return res.status(500).json({ success: false, message: "Failed to send email" });
    }
  });

  app.post("/api/auth/check-email", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ success: false, message: "Email is required" });
      }
      const allProfiles = await db.select().from(profiles);
      const found = allProfiles.find(p => p.email && p.email.toLowerCase() === email.toLowerCase());

      if (found) {
        let skillsArray = [];
        try {
          skillsArray = found.skills ? JSON.parse(found.skills) : [];
        } catch (e) {
          skillsArray = [];
        }
        return res.json({
          success: true,
          exists: true,
          profile: { ...found, skills: skillsArray },
        });
      }
      return res.json({ success: true, exists: false });
    } catch (error) {
      console.error("[Auth] Check email error:", error);
      return res.status(500).json({ success: false, message: "Failed to check email" });
    }
  });

  app.post("/api/auth/google-phone-login", async (req, res) => {
    try {
      const { email, phone, deviceId } = req.body;
      if (!email || !phone) {
        return res.status(400).json({ success: false, message: "Email and phone are required" });
      }
      const cleanPhone = phone.replace(/\D/g, "");
      if (cleanPhone.length !== 10) {
        return res.status(400).json({ success: false, message: "Please enter a valid 10-digit mobile number" });
      }

      const allProfiles = await db.select().from(profiles);
      const foundByEmail = allProfiles.find(p => p.email && p.email.toLowerCase() === email.toLowerCase());
      const foundByPhone = allProfiles.find(p => p.phone.replace(/\D/g, "") === cleanPhone);

      if (foundByEmail) {
        const sToken = require("crypto").randomBytes(32).toString("hex");
        await db.insert(sessions).values({ phone: foundByEmail.phone, sessionToken: sToken, createdAt: Date.now() });
        let parsedSkills = [];
        try {
          parsedSkills = JSON.parse(foundByEmail.skills || '[]');
        } catch (e) {
          parsedSkills = [];
        }
        return res.json({
          success: true,
          exists: true,
          profile: { ...foundByEmail, skills: parsedSkills },
          sessionToken: sToken,
        });
      }

      if (foundByPhone) {
        if (!foundByPhone.email) {
          await db.update(profiles).set({ email }).where(eq(profiles.id, foundByPhone.id));
        }
        const sToken = require("crypto").randomBytes(32).toString("hex");
        await db.insert(sessions).values({ phone: foundByPhone.phone, sessionToken: sToken, createdAt: Date.now() });
        let parsedSkills = [];
        try {
          parsedSkills = JSON.parse(foundByPhone.skills || '[]');
        } catch (e) {
          parsedSkills = [];
        }
        return res.json({
          success: true,
          exists: true,
          profile: { ...foundByPhone, skills: parsedSkills },
          sessionToken: sToken,
        });
      }

      const sToken = require("crypto").randomBytes(32).toString("hex");
      await db.insert(sessions).values({ phone: cleanPhone, sessionToken: sToken, createdAt: Date.now() });
      return res.json({ success: true, exists: false, sessionToken: sToken });
    } catch (error) {
      console.error("[Auth] Google phone login error:", error);
      return res.status(500).json({ success: false, message: "Failed to process login" });
    }
  });

  // ========== Phone login check ==========
  app.post("/api/auth/check-phone", async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone || typeof phone !== "string") {
        return res.status(400).json({ success: false, message: "Phone number is required" });
      }
      const cleanPhone = phone.replace(/\D/g, "");
      const allProfiles = await db.select().from(profiles);
      const found = allProfiles.find(p => p.phone.replace(/\D/g, "") === cleanPhone);

      if (found) {
        let skillsArray = [];
        try {
          skillsArray = found.skills ? JSON.parse(found.skills) : [];
        } catch (e) {
          skillsArray = [];
        }
        return res.json({
          success: true,
          exists: true,
          profile: { ...found, skills: skillsArray },
        });
      }
      return res.json({ success: true, exists: false });
    } catch (error) {
      console.error("[Auth] Check phone error:", error);
      return res.status(500).json({ success: false, message: "Failed to check phone" });
    }
  });

  // ========== OneSignal Registration ==========
  app.post("/api/onesignal/register", async (req, res) => {
    try {
      const { userId, playerId, oneSignalId } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, message: "userId required" });
      }

      // Require session token — caller must own the userId they are registering (prevents IDOR)
      const sessionToken = req.headers['x-session-token'] as string | undefined;
      if (!sessionToken) {
        return res.status(401).json({ success: false, message: "Session token required" });
      }
      const sessionRows = await db.select({ phone: sessions.phone }).from(sessions).where(eq(sessions.sessionToken, sessionToken));
      if (sessionRows.length === 0) {
        return res.status(401).json({ success: false, message: "Invalid session" });
      }
      const sessionPhone = sessionRows[0].phone;
      const ownerRows = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.phone, sessionPhone));
      if (ownerRows.length === 0 || ownerRows[0].id !== userId) {
        return res.status(403).json({ success: false, message: "Session does not match userId" });
      }

      const pid = playerId || oneSignalId || null;
      const updateData: any = { lastSeen: Date.now() };
      if (pid) updateData.pushToken = pid;
      await db.update(profiles).set(updateData).where(eq(profiles.id, userId));
      console.log('[OneSignal] Registered user:', userId.slice(0, 8) + '...', pid ? `playerId=${pid.slice(0, 8)}...` : '(no playerId)');
      res.json({ success: true });
    } catch (error) {
      console.error("[OneSignal] Registration error:", error);
      res.status(500).json({ success: false, message: "Registration failed" });
    }
  });

  // ========== Profile routes ==========
  app.post("/api/profiles", async (req, res) => {
    try {
      const { id, name, phone, email, role, skills, city, state, experience, shopName, bio, avatar,
              sellType, teachType, shopAddress, gstNumber, aadhaarNumber, panNumber, latitude, longitude, locationSharing, deviceId } = req.body;
      if (!id || !name || !phone || !role) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
      }

      const profileData = {
        name, phone, role,
        email: email || "",
        skills: JSON.stringify(skills || []),
        city: city || "", state: state || "",
        experience: experience || "",
        shopName: shopName || "",
        bio: bio || "",
        avatar: avatar || "",
        sellType: sellType || "",
        teachType: teachType || "",
        shopAddress: shopAddress || "",
        gstNumber: gstNumber || "",
        aadhaarNumber: aadhaarNumber || "",
        panNumber: panNumber || "",
        latitude: latitude || "",
        longitude: longitude || "",
        locationSharing: locationSharing || "true",
      };

      const existing = await db.select().from(profiles).where(eq(profiles.id, id));
      if (existing.length > 0) {
        await db.update(profiles).set(profileData).where(eq(profiles.id, id));
      } else {
        await db.insert(profiles).values({
          id, ...profileData, deviceId: deviceId || "", createdAt: Date.now(),
        });
      }

      return res.json({ success: true });
    } catch (error) {
      console.error("[Profile] Save error:", error);
      return res.status(500).json({ success: false, message: "Failed to save profile" });
    }
  });

  app.get("/api/profiles", async (_req, res) => {
    try {
      const allProfiles = await db.select().from(profiles).where(isNull(profiles.deleted_at));
      const parsed = await Promise.all(allProfiles.map(async (p) => {
        let skillsArray = [];
        try {
          skillsArray = p.skills ? JSON.parse(p.skills) : [];
        } catch (e) {
          skillsArray = [];
        }
        let productCount = 0;
        if (p.role === 'supplier') {
          const countResult = await db.select({ count: sql<number>`cast(count(*) as integer)` }).from(products).where(eq(products.userId, p.id));
          productCount = countResult[0]?.count || 0;
        }
        return { ...p, skills: skillsArray, productCount };
      }));
      return res.json(parsed);
    } catch (error) {
      console.error("[Profile] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get profiles" });
    }
  });

  app.get("/api/profiles/:id", async (req, res) => {
    try {
      const result = await db.select().from(profiles).where(eq(profiles.id, req.params.id));
      if (result.length === 0) {
        return res.status(404).json({ success: false, message: "Profile not found" });
      }
      const p = result[0];
      let skillsArray = [];
      try {
        skillsArray = p.skills ? JSON.parse(p.skills) : [];
      } catch (e) {
        skillsArray = [];
      }
      return res.json({ ...p, skills: skillsArray });
    } catch (error) {
      console.error("[Profile] Get error:", error);
      return res.status(500).json({ success: false, message: "Failed to get profile" });
    }
  });

  app.post("/api/profiles/:id/location", async (req, res) => {
    try {
      const { latitude, longitude } = req.body;
      const id = req.params.id;
      if (!id) return res.status(400).json({ success: false });
      await db.update(profiles).set({ latitude: latitude || "", longitude: longitude || "" }).where(eq(profiles.id, id));
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false });
    }
  });

  app.post("/api/profiles/:id/like", async (req, res) => {
    try {
      const sessionToken = req.headers['x-session-token'] as string | undefined;
      if (!sessionToken) return res.status(401).json({ success: false, message: "Unauthorized: session required" });

      const sessionRows = await db.select().from(sessions).where(eq(sessions.sessionToken, sessionToken));
      if (!sessionRows[0]) return res.status(401).json({ success: false, message: "Invalid session" });

      const actorRows = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.phone, sessionRows[0].phone));
      if (!actorRows[0]) return res.status(401).json({ success: false, message: "Profile not found for session" });
      const actorId = actorRows[0].id;

      const result = await db.select().from(profiles).where(eq(profiles.id, req.params.id));
      if (result.length === 0) return res.status(404).json({ success: false, message: "Profile not found" });

      const prof = result[0];
      let currentLikes: string[] = [];
      try { currentLikes = JSON.parse(prof.profileLikes || "[]"); } catch { currentLikes = []; }

      const idx = currentLikes.indexOf(actorId);
      if (idx >= 0) {
        currentLikes.splice(idx, 1);
      } else {
        currentLikes.push(actorId);
      }

      await db.update(profiles).set({ profileLikes: JSON.stringify(currentLikes) }).where(eq(profiles.id, req.params.id));
      return res.json({ success: true, profileLikes: currentLikes });
    } catch (error) {
      console.error("[Profiles] Like error:", error);
      return res.status(500).json({ success: false, message: "Failed to toggle like" });
    }
  });

  app.put("/api/profiles/:id/rating", adminMiddleware, async (req, res) => {
    try {
      const { rating, ratingCount } = req.body;
      if (rating === undefined || ratingCount === undefined) {
        return res.status(400).json({ success: false, message: "rating and ratingCount required" });
      }
      const ratingVal = parseFloat(String(rating));
      const countVal  = parseInt(String(ratingCount), 10);
      if (isNaN(ratingVal) || ratingVal < 0 || ratingVal > 5) {
        return res.status(400).json({ success: false, message: "rating must be a number between 0 and 5" });
      }
      if (isNaN(countVal) || countVal < 0) {
        return res.status(400).json({ success: false, message: "ratingCount must be a non-negative integer" });
      }

      const result = await db.select().from(profiles).where(eq(profiles.id, req.params.id));
      if (result.length === 0) return res.status(404).json({ success: false, message: "Profile not found" });

      await db.update(profiles).set({ rating: String(ratingVal), ratingCount: String(countVal) }).where(eq(profiles.id, req.params.id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Profiles] Rating error:", error);
      return res.status(500).json({ success: false, message: "Failed to update rating" });
    }
  });

  // Legacy FCM token route — silently accept and ignore (OneSignal handles all push)
  app.post("/api/notifications/token", async (req, res) => {
    return res.json({ success: true });
  });

  // ─── OneSignal clean count + send routes ──────────────────────────────────────
  app.get("/api/notifications/count", async (_req, res) => {
    try {
      const count = await getDeviceCount();
      return res.json({ count });
    } catch (error) {
      console.error('[OneSignal] /api/notifications/count error:', error);
      return res.status(500).json({ count: 0 });
    }
  });

  app.post("/api/notifications/send", async (req, res) => {
    try {
      const { title, message } = req.body;
      if (!title || !message) return res.status(400).json({ success: false, message: "title and message required" });
      const result = await sendNotification(title, message, { type: 'admin_broadcast' });
      return res.json({ success: true, result });
    } catch (error) {
      console.error('[OneSignal] /api/notifications/send error:', error);
      return res.status(500).json({ success: false });
    }
  });

  // Get user's notification history
  app.get("/api/notifications/history", async (req, res) => {
    try {
      const userId = req.headers.authorization?.split(' ')[1] || req.query.userId as string;
      if (!userId) return res.status(401).json({ success: false, message: "User ID required" });
      
      const notifications = await db
        .select()
        .from(adminNotifications)
        .where(eq(adminNotifications.userId, userId))
        .orderBy(desc(adminNotifications.createdAt))
        .limit(50);
      
      return res.json(notifications);
    } catch (error) {
      console.error("[Notifications] History fetch error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch notifications" });
    }
  });

  // Mark notification as read
  app.patch("/api/notifications/:id/read", async (req, res) => {
    try {
      const { id } = req.params;
      await db.update(adminNotifications).set({ read: 1 }).where(eq(adminNotifications.id, id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Notifications] Mark read error:", error);
      return res.status(500).json({ success: false });
    }
  });

  // In-memory live chat presence store: userId -> { name, role, avatar, lastSeen }
  const liveChatPresence = new Map<string, { name: string; role: string; avatar: string; lastSeen: number }>();
  const LIVE_CHAT_PRESENCE_TTL = 45 * 1000; // 45 seconds

  app.post("/api/live-chat/presence", async (req, res) => {
    try {
      const { userId, name, role, avatar } = req.body;
      if (!userId) return res.status(400).json({ success: false });
      liveChatPresence.set(userId, { name: name || '', role: role || '', avatar: avatar || '', lastSeen: Date.now() });
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false });
    }
  });

  app.delete("/api/live-chat/presence", async (req, res) => {
    try {
      const { userId } = req.body;
      if (userId) liveChatPresence.delete(userId);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false });
    }
  });

  app.get("/api/live-chat/online-users", async (_req, res) => {
    try {
      const now = Date.now();
      const active: { id: string; name: string; role: string; avatar: string }[] = [];
      for (const [id, u] of liveChatPresence) {
        if (now - u.lastSeen < LIVE_CHAT_PRESENCE_TTL) {
          active.push({ id, name: u.name, role: u.role, avatar: u.avatar });
        } else {
          liveChatPresence.delete(id);
        }
      }
      return res.json(active);
    } catch (error) {
      return res.status(500).json([]);
    }
  });

  app.post("/api/heartbeat", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ success: false });
      const now = Date.now();
      await db.update(profiles).set({ lastSeen: now }).where(eq(profiles.id, userId));
      return res.json({ success: true, timestamp: now });
    } catch (error) {
      return res.status(500).json({ success: false });
    }
  });

  app.get("/api/stats/online", async (_req, res) => {
    try {
      const allProfiles = await db.select().from(profiles);
      const now = Date.now();
      const ONLINE_THRESHOLD = 5 * 60 * 1000;

      const stats: Record<string, { registered: number; online: number }> = {
        technician: { registered: 0, online: 0 },
        teacher: { registered: 0, online: 0 },
        supplier: { registered: 0, online: 0 },
        job_provider: { registered: 0, online: 0 },
        customer: { registered: 0, online: 0 },
      };

      for (const p of allProfiles) {
        const role = p.role as string;
        if (stats[role]) {
          stats[role].registered++;
          if (p.lastSeen && now - p.lastSeen < ONLINE_THRESHOLD) {
            stats[role].online++;
          }
        }
      }

      return res.json(stats);
    } catch (error) {
      console.error("[Stats] Online stats error:", error);
      return res.status(500).json({ success: false });
    }
  });

  // ========== Subscription Settings routes ==========
  app.get("/api/subscription-settings", async (_req, res) => {
    try {
      const settings = await db.select().from(subscriptionSettings);
      if (settings.length === 0) {
        const defaults = [
          { id: 'sub_technician', role: 'technician', enabled: 0, amount: "99", period: "monthly", commissionPercent: "0" },
          { id: 'sub_teacher', role: 'teacher', enabled: 0, amount: "0", period: "monthly", commissionPercent: "30" },
          { id: 'sub_supplier', role: 'supplier', enabled: 0, amount: "999", period: "monthly", commissionPercent: "0" },
          { id: 'sub_shopkeeper', role: 'shopkeeper', enabled: 0, amount: "999", period: "monthly", commissionPercent: "0" },
        ];
        for (const d of defaults) {
          await db.insert(subscriptionSettings).values({ ...d, updatedAt: Date.now() });
        }
        return res.json(defaults.map(d => ({ ...d, updatedAt: Date.now() })));
      }
      // Ensure shopkeeper row exists for existing databases
      const hasShopkeeper = settings.some(s => s.role === 'shopkeeper');
      if (!hasShopkeeper) {
        const supplierSetting = settings.find(s => s.role === 'supplier');
        const shopkeeperDefault = {
          id: 'sub_shopkeeper', role: 'shopkeeper',
          enabled: supplierSetting?.enabled ?? 0,
          amount: supplierSetting?.amount ?? "999",
          period: supplierSetting?.period ?? "monthly",
          commissionPercent: "0",
          updatedAt: Date.now(),
        };
        await db.insert(subscriptionSettings).values(shopkeeperDefault);
        return res.json([...settings, shopkeeperDefault]);
      }
      return res.json(settings);
    } catch (error) {
      console.error("[Subscription] Get error:", error);
      return res.status(500).json({ success: false });
    }
  });

  app.patch("/api/subscription-settings/:role", async (req, res) => {
    try {
      const { role } = req.params;
      const { enabled, amount, period, commissionPercent } = req.body;
      const id = `sub_${role}`;
      const existing = await db.select().from(subscriptionSettings).where(eq(subscriptionSettings.id, id));
      const updateData: any = { updatedAt: Date.now() };
      if (enabled !== undefined) updateData.enabled = enabled;
      if (amount !== undefined) updateData.amount = amount;
      if (period !== undefined) updateData.period = period;
      if (commissionPercent !== undefined) updateData.commissionPercent = commissionPercent;

      if (existing.length > 0) {
        await db.update(subscriptionSettings).set(updateData).where(eq(subscriptionSettings.id, id));
      } else {
        await db.insert(subscriptionSettings).values({
          id, role, enabled: enabled || 0, amount: amount || "0", period: period || "monthly", commissionPercent: commissionPercent || "0", updatedAt: Date.now(),
        });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error("[Subscription] Update error:", error);
      return res.status(500).json({ success: false });
    }
  });

  // ========== Products/Listings routes ==========
  app.get("/api/products", async (req, res) => {
    try {
      const { userId, supplierId, role } = req.query;
      const filterById = (supplierId || userId) as string | undefined;
      let allProducts;
      if (filterById) {
        allProducts = await db.select().from(products).where(eq(products.userId, filterById)).orderBy(desc(products.createdAt));
      } else if (role) {
        allProducts = await db.select().from(products).where(eq(products.userRole, role as string)).orderBy(desc(products.createdAt));
      } else {
        allProducts = await db.select().from(products).orderBy(desc(products.createdAt));
      }
      const parsed = allProducts.map(p => {
        try {
          return {
            ...p,
            images: p.images ? (typeof p.images === 'string' ? JSON.parse(p.images) : p.images) : [],
            likes: p.likes ? (typeof p.likes === 'string' ? JSON.parse(p.likes) : p.likes) : [],
          };
        } catch (jsonErr) {
          console.error("[Products] JSON parse error for product", p.id, jsonErr);
          return {
            ...p,
            images: [],
            likes: [],
          };
        }
      });
      return res.json(parsed);
    } catch (error) {
      console.error("[Products] Get error:", error);
      return res.status(500).json({ success: false });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const result = await db.select().from(products).where(eq(products.id, req.params.id));
      if (result.length === 0) return res.status(404).json({ success: false, message: "Not found" });
      const p = result[0];
      // Parse JSON fields properly
      return res.json({
        ...p,
        images: typeof p.images === 'string' ? JSON.parse(p.images || '[]') : (Array.isArray(p.images) ? p.images : []),
        likes: typeof p.likes === 'string' ? JSON.parse(p.likes || '[]') : (Array.isArray(p.likes) ? p.likes : []),
      });
    } catch (error) {
      console.error("[Products] Get by ID error:", error);
      return res.status(500).json({ success: false });
    }
  });

  app.post("/api/products", async (req, res) => {
    try {
      const { id, userId, userName, userRole, userAvatar, title, description, price, category, images, thumbnail, city, state, inStock, deliveryInfo, contactPhone, videoUrl } = req.body;
      if (!userId || !title) return res.status(400).json({ success: false, message: "Missing required fields" });
      if (userRole !== 'teacher' && userRole !== 'supplier' && userRole !== 'shopkeeper') return res.status(403).json({ success: false, message: "Only teachers, suppliers and shopkeepers can list products" });

      const productId = id || randomUUID();
      const existing = await db.select().from(products).where(eq(products.id, productId));

      if (existing.length > 0) {
        await db.update(products).set({
          title, description, price: price || "0", category: category || "other",
          images: JSON.stringify(images || []), thumbnail: thumbnail || "", city: city || "", state: state || "",
          inStock: inStock ?? 1, deliveryInfo: deliveryInfo || "", contactPhone: contactPhone || "",
          videoUrl: videoUrl || "",
        }).where(eq(products.id, productId));
      } else {
        await db.insert(products).values({
          id: productId, userId, userName, userRole, userAvatar: userAvatar || "",
          title, description: description || "", price: price || "0", category: category || "other",
          images: JSON.stringify(images || []), thumbnail: thumbnail || "", city: city || "", state: state || "",
          inStock: inStock ?? 1, deliveryInfo: deliveryInfo || "", contactPhone: contactPhone || "",
          videoUrl: videoUrl || "", createdAt: Date.now(),
        });
      }
      return res.json({ success: true, id: productId });
    } catch (error) {
      console.error("[Products] Create error:", error);
      return res.status(500).json({ success: false });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    try {
      const productId = req.params.id;
      const { userId } = req.query as { userId?: string };
      console.log(`[Products] DELETE request for product: ${productId} by user: ${userId}`);
      
      const result = await db.select().from(products).where(eq(products.id, productId));
      
      if (result.length === 0) {
        console.warn(`[Products] Product not found: ${productId}`);
        return res.status(404).json({ success: false, message: 'Product not found' });
      }
      
      // Check if requester owns the product or is an admin
      const product = result[0];
      const isOwner = userId && product.userId === userId;
      const isAdmin = userId === 'admin-55f06aed-5414-45da-a507-9fe355dbb5a7' || userId?.includes('admin');
      
      if (!isOwner && !isAdmin) {
        console.warn(`[Products] Unauthorized delete attempt by user: ${userId} for product: ${productId}`);
        return res.status(403).json({ success: false, message: "Unauthorized - only product owner or admin can delete" });
      }
      
      // Handle image deletion
      try {
        let imgs: string[] = [];
        const imagesRaw = result[0].images || '[]';
        
        // Try parsing as JSON array
        try {
          imgs = JSON.parse(imagesRaw);
        } catch {
          // Fallback: handle comma-separated or plain string
          if (typeof imagesRaw === 'string' && imagesRaw.length > 0) {
            imgs = imagesRaw.includes(',') 
              ? imagesRaw.split(',').filter(url => url.trim().length > 0)
              : [imagesRaw.trim()];
          }
        }
        
        console.log(`[Products] Processing ${imgs.length} images for deletion`);
        
        for (const imgUrl of imgs) {
          if (!imgUrl || typeof imgUrl !== 'string') continue;
          
          if (imgUrl.startsWith('/uploads/')) {
            // Delete local uploads
            const filePath = path.resolve(process.cwd(), imgUrl.slice(1));
            if (fs.existsSync(filePath)) {
              try {
                fs.unlinkSync(filePath);
                console.log(`[Products] Deleted local file: ${filePath}`);
              } catch (e) {
                console.warn(`[Products] Could not delete local file: ${filePath}`, e);
              }
            }
          } else if (imgUrl.includes('bunnycdn.net') || imgUrl.includes('arun-storage')) {
            // Delete from Bunny CDN
            try {
              const urlParts = imgUrl.split('/');
              const filename = urlParts.slice(urlParts.length - 2).join('/');
              if (bunnyAvailable && filename) {
                const deleteUrl = `${BUNNY_STORAGE_ENDPOINT}/${BUNNY_STORAGE_ZONE_NAME}/${filename}`;
                const deleteRes = await fetch(deleteUrl, {
                  method: 'DELETE',
                  headers: { 'AccessKey': BUNNY_STORAGE_API_KEY }
                });
                console.log(`[Products] Bunny delete response: ${deleteRes.status} for ${filename}`);
              }
            } catch (e) {
              console.warn(`[Products] Could not delete Bunny file: ${imgUrl}`, e);
            }
          }
        }
      } catch (e) {
        console.warn(`[Products] Error processing images for deletion:`, e);
      }
      
      // Delete product from database
      await db.delete(products).where(eq(products.id, productId));
      console.log(`[Products] ✅ Successfully deleted product: ${productId}`);
      return res.json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
      console.error(`[Products] ❌ Delete failed:`, error);
      return res.status(500).json({ success: false, message: `Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
  });

  app.post("/api/products/:id/like", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ success: false });
      const result = await db.select().from(products).where(eq(products.id, req.params.id));
      if (result.length === 0) return res.status(404).json({ success: false });
      const likes: string[] = JSON.parse(result[0].likes);
      const idx = likes.indexOf(userId);
      if (idx >= 0) likes.splice(idx, 1); else likes.push(userId);
      await db.update(products).set({ likes: JSON.stringify(likes) }).where(eq(products.id, req.params.id));
      return res.json({ success: true, likes });
    } catch (error) {
      return res.status(500).json({ success: false });
    }
  });

  // ========== Orders routes ==========
  app.post("/api/orders", async (req, res) => {
    try {
      const { productId, productTitle, productPrice, productImage, productCategory, buyerId, buyerName, buyerPhone, buyerCity, buyerState, sellerId, sellerName, sellerRole, quantity, totalAmount, shippingAddress, buyerNotes } = req.body;
      if (!productId || !buyerId || !sellerId) return res.status(400).json({ success: false, message: "Missing required fields" });

      const orderId = randomUUID();
      const now = Date.now();
      await db.insert(orders).values({
        id: orderId, productId, productTitle: productTitle || "", productPrice: productPrice || "0",
        productImage: productImage || "", productCategory: productCategory || "",
        buyerId, buyerName: buyerName || "", buyerPhone: buyerPhone || "",
        buyerCity: buyerCity || "", buyerState: buyerState || "",
        sellerId, sellerName: sellerName || "", sellerRole: sellerRole || "",
        quantity: quantity || 1, totalAmount: totalAmount || "0", status: "pending",
        shippingAddress: shippingAddress || "", buyerNotes: buyerNotes || "", sellerNotes: "",
        updatedAt: now, createdAt: now,
      });
      const created = await db.select().from(orders).where(eq(orders.id, orderId));
      return res.json({ success: true, order: created[0] });
    } catch (error) {
      console.error("[Orders] Create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create order" });
    }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const { buyerId, sellerId } = req.query;
      let result;
      if (buyerId) {
        result = await db.select().from(orders).where(eq(orders.buyerId, buyerId as string)).orderBy(desc(orders.createdAt));
      } else if (sellerId) {
        result = await db.select().from(orders).where(eq(orders.sellerId, sellerId as string)).orderBy(desc(orders.createdAt));
      } else {
        result = await db.select().from(orders).orderBy(desc(orders.createdAt));
      }
      return res.json(result);
    } catch (error) {
      console.error("[Orders] List error:", error);
      return res.status(500).json({ success: false });
    }
  });

  app.get("/api/orders/:id", async (req, res) => {
    try {
      const result = await db.select().from(orders).where(eq(orders.id, req.params.id));
      if (result.length === 0) return res.status(404).json({ success: false, message: "Order not found" });
      return res.json(result[0]);
    } catch (error) {
      return res.status(500).json({ success: false });
    }
  });

  app.patch("/api/orders/:id/status", async (req, res) => {
    try {
      const { status, sellerNotes } = req.body;
      const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'completed', 'cancelled', 'rejected'];
      if (!status || !validStatuses.includes(status)) return res.status(400).json({ success: false, message: "Invalid status" });

      const result = await db.select().from(orders).where(eq(orders.id, req.params.id));
      if (result.length === 0) return res.status(404).json({ success: false, message: "Order not found" });

      const updateData: any = { status, updatedAt: Date.now() };
      if (sellerNotes !== undefined) updateData.sellerNotes = sellerNotes;
      await db.update(orders).set(updateData).where(eq(orders.id, req.params.id));

      const updated = await db.select().from(orders).where(eq(orders.id, req.params.id));
      return res.json({ success: true, order: updated[0] });
    } catch (error) {
      console.error("[Orders] Status update error:", error);
      return res.status(500).json({ success: false });
    }
  });

  // ========== Posts routes ==========
  app.get("/api/posts", async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || '50'), 100);
      const offset = parseInt((req.query.offset as string) || '0');
      console.log(`[Posts] Fetching posts (limit=${limit}, offset=${offset})...`);
      const thirtyDaysAgoMs = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const allPosts = await db.select().from(posts)
        .where(gte(posts.createdAt, thirtyDaysAgoMs))
        .orderBy(desc(posts.createdAt))
        .limit(limit)
        .offset(offset);
      console.log("[Posts] Found", allPosts.length, "posts (within 30 days)");
      const parsed = allPosts.map(p => {
        try {
          return {
            ...p,
            images: JSON.parse(p.images || '[]'),
            likes: JSON.parse(p.likes || '[]'),
            comments: JSON.parse(p.comments || '[]'),
          };
        } catch (parseErr) {
          console.warn("[Posts] Parse error for post", p.id, ":", parseErr);
          return {
            ...p,
            images: [],
            likes: [],
            comments: [],
          };
        }
      });
      console.log("[Posts] Returning", parsed.length, "parsed posts");
      return res.json(parsed);
    } catch (error) {
      console.error("[Posts] List error:", error instanceof Error ? error.message : error);
      console.error("[Posts] Full error:", error);
      return res.status(500).json({ success: false, message: "Failed to get posts", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/posts", async (req, res) => {
    try {
      const { id, userId, userName, userRole, userAvatar, text: postText, images, videoUrl, category } = req.body;
      console.log('[Posts] Create request received:', { userId, imageCount: images?.length || 0, images });
      if (!userId || !userName || !userRole) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
      }

      const postId = id || randomUUID();
      const now = Date.now();
      const BACKEND_BASE = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : apiPublicBase() || "http://127.0.0.1:5000";
      const cleanImages = sanitizeImageUrls(images || []).map(img => {
        if (img.startsWith('http')) return img;
        return `${BACKEND_BASE}${img}`;
      });
      console.log('[Posts] Cleaned images:', { original: images?.length || 0, cleaned: cleanImages.length, urls: cleanImages });
      const cleanVideoUrl = sanitizeImageUrl(videoUrl || "");
      await db.insert(posts).values({
        id: postId,
        userId,
        userName,
        userRole,
        userAvatar: userAvatar || "",
        text: postText || "",
        images: JSON.stringify(cleanImages),
        videoUrl: cleanVideoUrl,
        category: category || "repair",
        likes: "[]",
        comments: "[]",
        createdAt: now,
      });

      const newPost = {
        id: postId,
        userId,
        userName,
        userRole,
        userAvatar: userAvatar || "",
        text: postText || "",
        images: cleanImages,
        videoUrl: cleanVideoUrl,
        category: category || "repair",
        likes: [],
        comments: [],
        createdAt: now,
      };

      notifyNewPost(postText || '', userName, userId).catch(() => {});

      return res.json({ success: true, post: newPost });
    } catch (error) {
      console.error("[Posts] Create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create post" });
    }
  });

  app.patch("/api/posts/:id", async (req, res) => {
    try {
      const { text, images, videoUrl, category, userId } = req.body;
      if (userId) {
        const [post] = await db.select().from(posts).where(eq(posts.id, req.params.id));
        if (!post) return res.status(404).json({ success: false, message: "Post not found" });
        if (post.userId !== userId) return res.status(403).json({ success: false, message: "Unauthorized" });
      }
      const updateData: any = {};
      if (text !== undefined) updateData.text = text;
      if (images !== undefined) updateData.images = images;
      if (videoUrl !== undefined) updateData.videoUrl = videoUrl;
      if (category !== undefined) updateData.category = category;
      await db.update(posts).set(updateData).where(eq(posts.id, req.params.id));
      const updated = await db.select().from(posts).where(eq(posts.id, req.params.id));
      return res.json({ success: true, post: updated[0] || null });
    } catch (error) {
      console.error("[Posts] Update error:", error);
      return res.status(500).json({ success: false, message: "Failed to update post" });
    }
  });

  app.delete("/api/posts/:id", async (req, res) => {
    try {
      const { userId } = req.query as { userId?: string };
      const postId = req.params.id;
      
      // Get the post first
      const [post] = await db.select().from(posts).where(eq(posts.id, postId));
      if (!post) return res.status(404).json({ success: false, message: "Post not found" });
      
      // Check if requester owns the post or is an admin
      const isOwner = userId && post.userId === userId;
      const isAdmin = userId === 'admin-55f06aed-5414-45da-a507-9fe355dbb5a7' || userId?.includes('admin');
      
      if (!isOwner && !isAdmin && userId) {
        return res.status(403).json({ success: false, message: "Unauthorized - only post owner or admin can delete" });
      }
      
      // Delete the post
      await db.delete(posts).where(eq(posts.id, postId));
      return res.json({ success: true, message: "Post deleted successfully" });
    } catch (error) {
      console.error("[Posts] Delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete post" });
    }
  });

  app.post("/api/posts/:id/view", async (req, res) => {
    try {
      const { userId } = req.body;
      const postId = req.params.id;
      const [post] = await db.select().from(posts).where(eq(posts.id, postId));
      if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    } catch (error) {
      console.error("[Posts] View error:", error);
      return res.status(500).json({ success: false, message: "Failed to track view" });
    }
  });

  app.post("/api/posts/:id/like", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ success: false, message: "userId required" });

      const result = await db.select().from(posts).where(eq(posts.id, req.params.id));
      if (result.length === 0) return res.status(404).json({ success: false, message: "Post not found" });

      const post = result[0];
      const currentLikes: string[] = JSON.parse(post.likes);
      const idx = currentLikes.indexOf(userId);
      if (idx >= 0) {
        currentLikes.splice(idx, 1);
      } else {
        currentLikes.push(userId);
      }

      await db.update(posts).set({ likes: JSON.stringify(currentLikes) }).where(eq(posts.id, req.params.id));
      return res.json({ success: true, likes: currentLikes });
    } catch (error) {
      console.error("[Posts] Like error:", error);
      return res.status(500).json({ success: false, message: "Failed to toggle like" });
    }
  });

  app.post("/api/posts/:id/comment", async (req, res) => {
    try {
      const { userId, userName, text: commentText } = req.body;
      if (!userId || !userName || !commentText) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
      }

      const result = await db.select().from(posts).where(eq(posts.id, req.params.id));
      if (result.length === 0) return res.status(404).json({ success: false, message: "Post not found" });

      const post = result[0];
      const currentComments = JSON.parse(post.comments);
      const newComment = {
        id: randomUUID(),
        userId,
        userName,
        text: commentText,
        createdAt: Date.now(),
      };
      currentComments.push(newComment);

      await db.update(posts).set({ comments: JSON.stringify(currentComments) }).where(eq(posts.id, req.params.id));
      return res.json({ success: true, comment: newComment });
    } catch (error) {
      console.error("[Posts] Comment error:", error);
      return res.status(500).json({ success: false, message: "Failed to add comment" });
    }
  });

  // ========== Jobs routes ==========
  app.get("/api/jobs", async (_req, res) => {
    try {
      const allJobs = await db.select().from(jobs).orderBy(desc(jobs.createdAt));
      const parsed = allJobs.map(j => {
        let skillsArray = [];
        try {
          skillsArray = j.skills ? JSON.parse(j.skills) : [];
        } catch (e) {
          skillsArray = [];
        }
        return { ...j, skills: skillsArray };
      });
      return res.json(parsed);
    } catch (error) {
      console.error("[Jobs] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get jobs" });
    }
  });

  app.post("/api/jobs", async (req, res) => {
    try {
      const { id, userId, userName, title, description, city, state, skills, salary, type } = req.body;
      if (!userId || !userName || !title) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
      }

      const jobId = id || randomUUID();
      const now = Date.now();
      await db.insert(jobs).values({
        id: jobId,
        userId,
        userName,
        title,
        description: description || "",
        city: city || "",
        state: state || "",
        skills: JSON.stringify(skills || []),
        salary: salary || "",
        type: type || "full_time",
        createdAt: now,
      });

      const newJob = {
        id: jobId,
        userId,
        userName,
        title,
        description: description || "",
        city: city || "",
        state: state || "",
        skills: skills || [],
        salary: salary || "",
        type: type || "full_time",
        createdAt: now,
      };

      return res.json({ success: true, job: newJob });
    } catch (error) {
      console.error("[Jobs] Create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create job" });
    }
  });

  app.delete("/api/jobs/:id", async (req, res) => {
    try {
      await db.delete(jobs).where(eq(jobs.id, req.params.id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Jobs] Delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete job" });
    }
  });

  // ========== Chat routes ==========
  // ========== Chat: Firebase Firestore backed ==========

  app.get("/api/conversations/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      if (!userId) return res.status(400).json({ success: false, message: "userId required" });
      
      // Try Firestore first
      try {
        const fdb = getFirestore();
        const [snap1, snap2] = await Promise.all([
          fdb.collection('conversations').where('participant1Id', '==', userId).get(),
          fdb.collection('conversations').where('participant2Id', '==', userId).get(),
        ]);
        const seen = new Set<string>();
        const convos: any[] = [];
        for (const snap of [snap1, snap2]) {
          for (const doc of snap.docs) {
            if (!seen.has(doc.id)) {
              seen.add(doc.id);
              convos.push({ id: doc.id, ...doc.data() });
            }
          }
        }
        convos.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
        return res.json(convos);
      } catch (fbError: any) {
        console.warn("[Chat] Firestore unavailable, trying PostgreSQL:", fbError?.message);
        
        // Fallback: Load from PostgreSQL
        try {
          const convos = await db.select().from(conversations)
            .where(or(
              eq(conversations.participant1Id, userId),
              eq(conversations.participant2Id, userId)
            ))
            .orderBy(desc(conversations.lastMessageAt));
          return res.json(convos);
        } catch (dbError: any) {
          console.error("[Chat] PostgreSQL error:", dbError?.message);
          return res.json([]);
        }
      }
    } catch (error) {
      console.error("[Chat] List conversations error:", error);
      return res.json([]);
    }
  });

  app.post("/api/conversations", async (req, res) => {
    try {
      const { participant1Id, participant1Name, participant1Role, participant2Id, participant2Name, participant2Role } = req.body;

      if (!participant1Id || !participant2Id) {
        return res.status(400).json({ success: false, message: "Both participants required" });
      }

      const id = randomUUID();
      const now = Date.now();
      const newConvo = {
        id,
        participant1Id, participant1Name, participant1Role,
        participant2Id, participant2Name, participant2Role,
        lastMessage: "",
        lastMessageSenderId: "",
        lastMessageAt: now,
        createdAt: now,
      };

      // Try Firestore first
      try {
        const fdb = getFirestore();
        // Check for existing conversation between these two users
        const [snap1, snap2] = await Promise.all([
          fdb.collection('conversations')
            .where('participant1Id', '==', participant1Id)
            .where('participant2Id', '==', participant2Id).get(),
          fdb.collection('conversations')
            .where('participant1Id', '==', participant2Id)
            .where('participant2Id', '==', participant1Id).get(),
        ]);
        const existing = [...snap1.docs, ...snap2.docs];
        if (existing.length > 0) {
          return res.json({ success: true, conversation: { id: existing[0].id, ...existing[0].data() } });
        }

        await fdb.collection('conversations').doc(id).set(newConvo);
        return res.json({ success: true, conversation: newConvo });
      } catch (fbError: any) {
        console.warn("[Chat] Firestore unavailable, trying PostgreSQL fallback:", fbError?.message);
        
        // Fallback: Save to PostgreSQL
        try {
          await db.insert(conversations).values(newConvo);
          return res.json({ success: true, conversation: newConvo });
        } catch (dbError: any) {
          console.error("[Chat] PostgreSQL save failed:", dbError?.message);
          return res.json({ success: true, conversation: newConvo });
        }
      }
    } catch (error) {
      console.error("[Chat] Create conversation error:", error);
      return res.status(500).json({ success: false, message: "Failed to create conversation" });
    }
  });

  app.delete("/api/conversations/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      // Try Firestore first
      try {
        const fdb = getFirestore();
        // Delete all messages in this conversation
        const msgsSnap = await fdb.collection('messages').where('conversationId', '==', id).get();
        const batch = fdb.batch();
        msgsSnap.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(fdb.collection('conversations').doc(id));
        await batch.commit();
        return res.json({ success: true });
      } catch (fbError: any) {
        console.warn("[Chat] Firestore unavailable, trying PostgreSQL:", fbError?.message);
        
        // Fallback: Delete from PostgreSQL
        try {
          await db.delete(messages).where(eq(messages.conversationId, id));
          await db.delete(conversations).where(eq(conversations.id, id));
          return res.json({ success: true });
        } catch (dbError: any) {
          console.error("[Chat] PostgreSQL delete failed:", dbError?.message);
          return res.json({ success: true });
        }
      }
    } catch (error) {
      console.error("[Chat] Delete conversation error:", error);
      return res.json({ success: true });
    }
  });

  app.get("/api/messages/:conversationId", async (req, res) => {
    try {
      const { conversationId } = req.params;
      
      // Primary: Try Firestore
      try {
        const fdb = getFirestore();
        const snap = await fdb.collection('messages')
          .where('conversationId', '==', conversationId)
          .orderBy('createdAt', 'asc')
          .get();
        const msgs = snap.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            conversationId: data.conversationId,
            senderId: data.senderId,
            senderName: data.senderName,
            text: data.text || '',
            image: data.image || '',
            video: data.video || '',
            createdAt: data.createdAt || 0,
          };
        });
        return res.json(msgs);
      } catch (fbErr: any) {
        console.warn("[Chat] Firestore unavailable:", fbErr?.message);
        // Fallback to PostgreSQL
        const msgs = await db.select().from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(messages.createdAt);
        return res.json(msgs);
      }
    } catch (error) {
      console.error("[Chat] Get messages error:", error);
      return res.json([]);
    }
  });

  app.post("/api/messages", async (req, res) => {
    try {
      const { conversationId, senderId, senderName, text: msgText, image, video } = req.body;

      if (!conversationId || !senderId || !senderName) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
      }

      const id = randomUUID();
      const now = Date.now();
      const cleanImage = sanitizeImageUrl(image || "");
      const cleanVideo = sanitizeImageUrl(video || "");
      const cleanText = (msgText || "").trim();

      if (!cleanText && !cleanImage && !cleanVideo) {
        return res.json({ success: true, message: { id, conversationId, senderId, senderName, text: "", image: "", video: "", createdAt: now } });
      }

      const newMsg = { id, conversationId, senderId, senderName, text: cleanText, image: cleanImage, video: cleanVideo, createdAt: now };

      // Primary: Try Firestore
      let savedSuccessfully = false;
      try {
        const fdb = getFirestore();
        
        // Save message to Firestore
        await fdb.collection('messages').doc(id).set(newMsg);
        
        // Update conversation metadata
        const lastMsg = cleanImage ? (cleanText || "📷 Photo") : (cleanVideo ? (cleanText || "🎥 Video") : cleanText);
        const convoRef = fdb.collection('conversations').doc(conversationId);
        const convoDoc = await convoRef.get();

        if (convoDoc.exists) {
          await convoRef.update({
            lastMessage: lastMsg,
            lastMessageSenderId: senderId,
            lastMessageAt: now,
          });
          
          const convoData = convoDoc.data();
          if (convoData) {
            const recipientId = convoData.participant1Id === senderId
              ? convoData.participant2Id
              : convoData.participant1Id;
            if (recipientId && recipientId !== senderId) {
              const msgPreview = cleanImage ? (cleanText || '📷 Photo') : (cleanVideo ? (cleanText || '🎥 Video') : cleanText.slice(0, 80));
              notifyUser(recipientId, {
                title: senderName,
                body: msgPreview,
                data: { type: 'chat_message', conversationId },
              }).catch(() => {});
            }
          }
        }
        
        savedSuccessfully = true;
      } catch (fbError: any) {
        console.warn("[Chat] Firestore unavailable, trying PostgreSQL fallback:", fbError?.message);
        
        // Fallback: Save to PostgreSQL
        try {
          await db.insert(messages).values(newMsg);
          savedSuccessfully = true;
        } catch (dbError: any) {
          console.error("[Chat] Both Firestore and PostgreSQL failed:", dbError?.message);
          return res.status(500).json({ success: false, message: "Failed to save message" });
        }
      }

      return res.json({ success: true, message: newMsg });
    } catch (error) {
      console.error("[Chat] Send message error:", error);
      return res.status(500).json({ success: false, message: "Failed to send message" });
    }
  });

  app.get("/api/messages/:conversationId/since/:timestamp", async (req, res) => {
    try {
      const { conversationId, timestamp } = req.params;
      const ts = parseInt(timestamp);
      
      // Try Firestore first
      try {
        const fdb = getFirestore();
        const snap = await fdb.collection('messages')
          .where('conversationId', '==', conversationId)
          .where('createdAt', '>', ts)
          .orderBy('createdAt', 'asc')
          .get();
        const msgs = snap.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            conversationId: data.conversationId,
            senderId: data.senderId,
            senderName: data.senderName,
            text: data.text || '',
            image: data.image || '',
            video: data.video || '',
            createdAt: data.createdAt || 0,
          };
        });
        return res.json(msgs);
      } catch (fbErr: any) {
        console.warn("[Chat] Firestore unavailable in poll, trying PostgreSQL:", fbErr?.message);
        
        // Fallback: Load from PostgreSQL
        const msgs = await db.select().from(messages)
          .where(and(
            eq(messages.conversationId, conversationId),
            gt(messages.createdAt, ts)
          ))
          .orderBy(messages.createdAt);
        return res.json(msgs);
      }
    } catch (error) {
      console.error("[Chat] Poll messages error:", error);
      return res.json([]);
    }
  });

  // ========== Reels ==========
  app.get("/api/reels", async (_req, res) => {
    try {
      const allReels = await db.select().from(reels).orderBy(desc(reels.createdAt));
      const mapped = allReels.map(r => {
        let thumbnailUrl = r.thumbnailUrl || '';
        // Auto-derive Bunny Stream thumbnail if not stored
        if (!thumbnailUrl && r.videoUrl) {
          const cdnMatch = r.videoUrl.match(/b-cdn\.net\/([a-f0-9-]{36})\//);
          const iframeMatch = r.videoUrl.match(/embed\/\d+\/([a-f0-9-]{36})/);
          const mediaMatch = r.videoUrl.match(/mediadelivery\.net\/[^/]+\/([a-f0-9-]{36})/);
          const videoId = (cdnMatch?.[1] || iframeMatch?.[1] || mediaMatch?.[1]) ?? '';
          if (videoId) thumbnailUrl = `https://vz-610561.b-cdn.net/${videoId}/thumbnail.jpg`;
        }
        return {
          ...r,
          thumbnailUrl,
          likes: JSON.parse(r.likes || "[]"),
          comments: JSON.parse(r.comments || "[]"),
        };
      });
      return res.json(mapped);
    } catch (error) {
      console.error("[Reels] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to list reels" });
    }
  });

  app.post("/api/reels", async (req, res) => {
    try {
      const { userId, userName, userAvatar, title, description, videoUrl, thumbnailUrl } = req.body;
      if (!userId || !videoUrl) {
        return res.status(400).json({ success: false, message: "userId and videoUrl required" });
      }

      const id = randomUUID();
      const now = Date.now();

      await db.insert(reels).values({
        id,
        userId,
        userName: userName || "",
        userAvatar: userAvatar || "",
        title: title || "",
        description: description || "",
        videoUrl,
        thumbnailUrl: thumbnailUrl || "",
        likes: "[]",
        comments: "[]",
        createdAt: now,
      });

      const reel = {
        id, userId, userName: userName || "", userAvatar: userAvatar || "",
        title: title || "", description: description || "", videoUrl,
        thumbnailUrl: thumbnailUrl || "", likes: [], comments: [], views: 0,
        createdAt: now,
      };

      // Fire OneSignal push notification for new reel (non-blocking)
      sendNotification(
        '🎬 New Reel',
        `${userName || 'Someone'} posted a new reel${title ? `: ${title}` : ''}`,
        { type: 'new_reel', reelId: id, userId }
      ).catch(e => console.error("[Reels] Push notification error:", e));

      return res.json({ success: true, reel });
    } catch (error) {
      console.error("[Reels] Create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create reel" });
    }
  });

  app.post("/api/reels/:id/view", async (req, res) => {
    try {
      const { id } = req.params;
      const [reel] = await db.select().from(reels).where(eq(reels.id, id));
      if (!reel) return res.status(404).json({ success: false, message: "Reel not found" });
      const newViews = (reel.views || 0) + 1;
      await db.update(reels).set({ views: newViews }).where(eq(reels.id, id));
      return res.json({ success: true, views: newViews });
    } catch (error) {
      console.error("[Reels] View error:", error);
      return res.status(500).json({ success: false, message: "Failed to increment view count" });
    }
  });

  app.post("/api/reels/:id/like", async (req, res) => {
    try {
      const { id } = req.params;
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ success: false, message: "userId required" });

      const [reel] = await db.select().from(reels).where(eq(reels.id, id));
      if (!reel) return res.status(404).json({ success: false, message: "Reel not found" });

      const likesList: string[] = JSON.parse(reel.likes || "[]");
      const idx = likesList.indexOf(userId);
      if (idx >= 0) likesList.splice(idx, 1);
      else likesList.push(userId);

      await db.update(reels).set({ likes: JSON.stringify(likesList) }).where(eq(reels.id, id));
      return res.json({ success: true, likes: likesList });
    } catch (error) {
      console.error("[Reels] Like error:", error);
      return res.status(500).json({ success: false, message: "Failed to like reel" });
    }
  });

  app.post("/api/reels/:id/comment", async (req, res) => {
    try {
      const { userId, userName, text: commentText } = req.body;
      if (!userId || !userName || !commentText) {
        return res.status(400).json({ success: false, message: "userId, userName, text required" });
      }

      const [reel] = await db.select().from(reels).where(eq(reels.id, req.params.id));
      if (!reel) return res.status(404).json({ success: false, message: "Reel not found" });

      const currentComments = JSON.parse(reel.comments || "[]");
      const newComment = {
        id: randomUUID(),
        userId,
        userName,
        text: commentText,
        createdAt: Date.now(),
      };
      currentComments.push(newComment);

      await db.update(reels).set({ comments: JSON.stringify(currentComments) }).where(eq(reels.id, req.params.id));
      return res.json({ success: true, comment: newComment, comments: currentComments });
    } catch (error) {
      console.error("[Reels] Comment error:", error);
      return res.status(500).json({ success: false, message: "Failed to add comment" });
    }
  });

  app.delete("/api/reels/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { userId } = req.body;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      const [reel] = await db.select().from(reels).where(eq(reels.id, id)).limit(1);
      if (!reel) {
        return res.status(404).json({ success: false, message: "Reel not found" });
      }
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const isAdmin = user?.role === "admin";
      if (reel.userId !== userId && !isAdmin) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      await db.delete(reels).where(eq(reels.id, id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Reels] Delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete reel" });
    }
  });

  app.delete("/api/admin/reels/:id", adminMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(reels).where(eq(reels.id, id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Reels] Admin delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete reel" });
    }
  });

  const diskVideoUpload = multer({
    storage: diskStorage,
    limits: { fileSize: 2048 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("video/")) {
        cb(null, true);
      } else {
        cb(new Error("Only video files are allowed"));
      }
    },
  });

  app.post("/api/upload-video", (req, res, next) => {
    diskVideoUpload.single("video")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ success: false, message: "Video file is too large. Maximum size is 2GB." });
        }
        return res.status(400).json({ success: false, message: err.message || "Upload error" });
      }
      next();
    });
  }, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No video file provided" });
      }
      const ext = path.extname(req.file.originalname) || ".mp4";
      const storageName = `videos/${randomUUID()}${ext}`;

      if (bunnyAvailable) {
        const localPath = req.file.path;
        const fileSize = req.file.size;
        console.log(`[Upload] Streaming video to Bunny: ${fileSize} bytes from ${localPath}`);
        if (fileSize === 0) {
          fs.unlink(localPath, () => {});
          return res.status(400).json({ success: false, message: "Video file is empty" });
        }

        const reelStorageName = `reels/${randomUUID()}${ext}`;
        const bunnyUrl = `${BUNNY_STORAGE_ENDPOINT}/${BUNNY_STORAGE_ZONE_NAME}/${reelStorageName}`;

        // Stream file directly to Bunny.net — no in-memory buffering
        const { Readable } = await import("stream");
        const readStream = fs.createReadStream(localPath);
        const webStream = Readable.toWeb(readStream) as ReadableStream;

        const bunnyRes = await fetch(bunnyUrl, {
          method: 'PUT',
          headers: {
            'AccessKey': BUNNY_STORAGE_API_KEY,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(fileSize),
          },
          body: webStream,
          duplex: 'half',
        } as any);

        fs.unlink(localPath, () => {});

        if (!bunnyRes.ok) {
          const errText = await bunnyRes.text().catch(() => '');
          console.error(`[Upload] Bunny upload failed: ${bunnyRes.status} ${errText}`);
          return res.status(500).json({ success: false, message: "Video upload to CDN failed" });
        }

        const videoUrl = `${BUNNY_CDN_URL}/${reelStorageName}`;
        console.log(`[Upload] Video streamed to Bunny: ${videoUrl} (${fileSize} bytes)`);
        return res.json({ success: true, url: videoUrl });
      } else {
        // Return full URL for video stored locally
        const protocol = req.protocol || 'http';
        const host = req.get('host') || 'localhost:5000';
        const videoUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
        console.log(`[Upload] Video saved locally: ${videoUrl} (${req.file.size} bytes)`);
        return res.json({ success: true, url: videoUrl });
      }
    } catch (error) {
      console.error("[Upload] Video error:", error);
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(500).json({ success: false, message: "Video upload failed" });
    }
  });

  // ========== Course routes ==========
  app.get("/api/courses", async (req, res) => {
    try {
      const { teacherId, published } = req.query;
      let allCourses;
      if (teacherId) {
        allCourses = await db.select().from(courses)
          .where(eq(courses.teacherId, teacherId as string))
          .orderBy(desc(courses.createdAt));
      } else if (published === 'true') {
        allCourses = await db.select().from(courses)
          .where(eq(courses.isPublished, 1))
          .orderBy(desc(courses.createdAt));
      } else {
        allCourses = await db.select().from(courses).orderBy(desc(courses.createdAt));
      }
      return res.json(allCourses);
    } catch (error) {
      console.error("[Courses] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get courses" });
    }
  });

  // AI-powered personalized course recommendations
  app.get("/api/courses/personalized-recommendations", async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ error: "userId required" });

      // Fetch user profile
      const [userProfile] = await db.select().from(profiles).where(eq(profiles.id, userId as string));
      if (!userProfile) return res.status(404).json({ error: "User not found" });

      // Fetch enrolled course IDs
      const enrollments = await db.select().from(courseEnrollments)
        .where(eq(courseEnrollments.studentId, userId as string));
      const enrolledIds = new Set(enrollments.map(e => e.courseId));

      // Fetch all published courses not yet enrolled
      const allCourses = await db.select().from(courses)
        .where(eq(courses.isPublished, 1))
        .orderBy(desc(courses.enrollmentCount));

      const unenrolledCourses = allCourses.filter(c => !enrolledIds.has(c.id));

      if (unenrolledCourses.length === 0) {
        return res.json({ recommendations: [] });
      }

      // Parse user skills
      let userSkills: string[] = [];
      try { userSkills = JSON.parse(userProfile.skills || '[]'); } catch {}

      // Build prompt
      const courseList = unenrolledCourses.slice(0, 50).map(c => ({
        id: c.id,
        title: c.title,
        category: c.category,
        teacherName: c.teacherName,
        description: c.description?.slice(0, 100) || '',
        price: c.price,
        totalVideos: c.totalVideos,
        enrollmentCount: c.enrollmentCount,
        language: c.language,
      }));

      const userContext = `
Role: ${userProfile.role}
Skills: ${userSkills.join(', ') || 'none listed'}
Location: ${userProfile.city || 'unknown'}, ${userProfile.state || ''}
Already enrolled in ${enrolledIds.size} courses.
      `.trim();

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a learning advisor for a mobile repair and electronics education platform. 
Recommend courses that are most relevant to the user's background and goals.
Always respond with valid JSON only — no markdown, no explanation outside the JSON.`,
          },
          {
            role: "user",
            content: `User profile:
${userContext}

Available courses (JSON):
${JSON.stringify(courseList, null, 2)}

Pick the top 5 most relevant course IDs for this user. For each, write a short 1-sentence reason (max 12 words) explaining why it suits them.
Respond with this exact JSON format:
[{"id": "...", "reason": "..."}, ...]`,
          },
        ],
        max_tokens: 400,
        temperature: 0.7,
      });

      let picks: { id: string; reason: string }[] = [];
      try {
        const raw = completion.choices[0].message.content || '[]';
        const clean = raw.replace(/```json|```/g, '').trim();
        picks = JSON.parse(clean);
      } catch {
        picks = [];
      }

      // Map picks to full course objects
      const courseMap = new Map(unenrolledCourses.map(c => [c.id, c]));
      const recommendations = picks
        .filter(p => courseMap.has(p.id))
        .map(p => ({ ...courseMap.get(p.id)!, reason: p.reason }))
        .slice(0, 5);

      return res.json({ recommendations });
    } catch (error) {
      console.error("[AI Recommendations] Error:", error);
      return res.status(500).json({ error: "Failed to get recommendations" });
    }
  });

  app.get("/api/courses/:id", async (req, res) => {
    try {
      const [course] = await db.select().from(courses).where(eq(courses.id, req.params.id));
      if (!course) return res.status(404).json({ success: false, message: "Course not found" });

      const chapters = await db.select().from(courseChapters)
        .where(eq(courseChapters.courseId, req.params.id))
        .orderBy(courseChapters.sortOrder);

      const chaptersWithVideos = await Promise.all(chapters.map(async (chapter) => {
        const videos = await db.select().from(courseVideos)
          .where(eq(courseVideos.chapterId, chapter.id))
          .orderBy(courseVideos.sortOrder);
        return { ...chapter, videos };
      }));

      return res.json({ ...course, chapters: chaptersWithVideos });
    } catch (error) {
      console.error("[Courses] Get error:", error);
      return res.status(500).json({ success: false, message: "Failed to get course" });
    }
  });

  app.post("/api/courses", async (req, res) => {
    try {
      const { id, teacherId, teacherName, teacherAvatar, title, description, price, coverImage, category, language, demoDuration, accessDays, isPublished } = req.body;
      if (!teacherId || !title) {
        return res.status(400).json({ success: false, message: "teacherId and title are required" });
      }

      const courseId = id || randomUUID();
      const now = Date.now();

      if (id) {
        const [existing] = await db.select().from(courses).where(eq(courses.id, id));
        if (existing) {
          const updateData: any = {};
          if (title !== undefined) updateData.title = title;
          if (description !== undefined) updateData.description = description;
          if (price !== undefined) updateData.price = price;
          if (coverImage !== undefined) updateData.coverImage = coverImage;
          if (category !== undefined) updateData.category = category;
          if (language !== undefined) updateData.language = language;
          if (demoDuration !== undefined) updateData.demoDuration = demoDuration;
          if (accessDays !== undefined) updateData.accessDays = accessDays;
          if (isPublished !== undefined) updateData.isPublished = isPublished;
          if (teacherName !== undefined) updateData.teacherName = teacherName;
          if (teacherAvatar !== undefined) updateData.teacherAvatar = teacherAvatar;

          await db.update(courses).set(updateData).where(eq(courses.id, id));
          const [updated] = await db.select().from(courses).where(eq(courses.id, id));
          return res.json({ success: true, course: updated });
        }
      }

      await db.insert(courses).values({
        id: courseId,
        teacherId,
        teacherName: teacherName || "",
        teacherAvatar: teacherAvatar || "",
        title,
        description: description || "",
        price: price || "0",
        coverImage: coverImage || "",
        category: category || "course",
        language: language || "hindi",
        demoDuration: demoDuration || 60,
        accessDays: accessDays || 365,
        totalVideos: 0,
        totalDuration: 0,
        enrollmentCount: 0,
        rating: "0",
        isPublished: isPublished || 0,
        createdAt: now,
      });

      const [newCourse] = await db.select().from(courses).where(eq(courses.id, courseId));

      // Notify all users about the new course (fire-and-forget)
      if (newCourse?.isPublished === 1) {
        (async () => {
          try {
            await notifyAllUsers({
              title: `📚 New Course Available!`,
              body: `"${title}" by ${teacherName || 'a teacher'} — Enroll now!`,
              data: { type: 'new_course', courseId },
            }, teacherId);
          } catch (e) { console.warn('[Push] New course notify failed:', e); }
        })();
      }

      return res.json({ success: true, course: newCourse });
    } catch (error) {
      console.error("[Courses] Create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create course" });
    }
  });

  app.put("/api/courses/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { title, description, price, coverImage, category, language, demoDuration, accessDays, isPublished, teacherName, teacherAvatar } = req.body;

      const [existing] = await db.select().from(courses).where(eq(courses.id, id));
      if (!existing) {
        return res.status(404).json({ success: false, message: "Course not found" });
      }

      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (price !== undefined) updateData.price = price;
      if (coverImage !== undefined) updateData.coverImage = coverImage;
      if (category !== undefined) updateData.category = category;
      if (language !== undefined) updateData.language = language;
      if (demoDuration !== undefined) updateData.demoDuration = demoDuration;
      if (accessDays !== undefined) updateData.accessDays = accessDays;
      if (isPublished !== undefined) updateData.isPublished = isPublished;
      if (teacherName !== undefined) updateData.teacherName = teacherName;
      if (teacherAvatar !== undefined) updateData.teacherAvatar = teacherAvatar;

      const wasUnpublished = existing.isPublished !== 1;
      await db.update(courses).set(updateData).where(eq(courses.id, id));
      const [updated] = await db.select().from(courses).where(eq(courses.id, id));

      // Notify all users when a course is newly published
      if (isPublished === 1 && wasUnpublished) {
        (async () => {
          try {
            await notifyAllUsers({
              title: `📚 New Course Available!`,
              body: `"${updated.title}" by ${updated.teacherName || 'a teacher'} — Enroll now!`,
              data: { type: 'new_course', courseId: id },
            }, updated.teacherId || '');
          } catch (e) { console.warn('[Push] Course publish notify failed:', e); }
        })();
      }

      return res.json({ success: true, course: updated });
    } catch (error) {
      console.error("[Courses] Update error:", error);
      return res.status(500).json({ success: false, message: "Failed to update course" });
    }
  });

  app.delete("/api/courses/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const videos = await db.select().from(courseVideos).where(eq(courseVideos.courseId, id));
      for (const video of videos) {
        await db.delete(dubbedVideos).where(eq(dubbedVideos.videoId, video.id));
      }
      await db.delete(courseVideos).where(eq(courseVideos.courseId, id));
      await db.delete(courseChapters).where(eq(courseChapters.courseId, id));
      await db.delete(courseEnrollments).where(eq(courseEnrollments.courseId, id));
      await db.delete(dubbedVideos).where(eq(dubbedVideos.courseId, id));
      await db.delete(courses).where(eq(courses.id, id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Courses] Delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete course" });
    }
  });

  app.post("/api/courses/:courseId/chapters", async (req, res) => {
    try {
      const { courseId } = req.params;
      const { title, description, sortOrder } = req.body;
      if (!title) {
        return res.status(400).json({ success: false, message: "Title is required" });
      }

      const id = randomUUID();
      const now = Date.now();
      await db.insert(courseChapters).values({
        id,
        courseId,
        title,
        description: description || "",
        sortOrder: sortOrder || 0,
        createdAt: now,
      });

      const [chapter] = await db.select().from(courseChapters).where(eq(courseChapters.id, id));
      return res.json({ success: true, chapter });
    } catch (error) {
      console.error("[Courses] Create chapter error:", error);
      return res.status(500).json({ success: false, message: "Failed to create chapter" });
    }
  });

  app.put("/api/courses/:courseId/chapters/:chapterId", async (req, res) => {
    try {
      const { chapterId } = req.params;
      const { title, description, sortOrder } = req.body;
      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

      await db.update(courseChapters).set(updateData).where(eq(courseChapters.id, chapterId));
      const [updated] = await db.select().from(courseChapters).where(eq(courseChapters.id, chapterId));
      return res.json({ success: true, chapter: updated });
    } catch (error) {
      console.error("[Courses] Update chapter error:", error);
      return res.status(500).json({ success: false, message: "Failed to update chapter" });
    }
  });

  app.delete("/api/courses/:courseId/chapters/:chapterId", async (req, res) => {
    try {
      const { chapterId } = req.params;
      const videos = await db.select().from(courseVideos).where(eq(courseVideos.chapterId, chapterId));
      for (const video of videos) {
        await db.delete(dubbedVideos).where(eq(dubbedVideos.videoId, video.id));
      }
      await db.delete(courseVideos).where(eq(courseVideos.chapterId, chapterId));
      await db.delete(courseChapters).where(eq(courseChapters.id, chapterId));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Courses] Delete chapter error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete chapter" });
    }
  });

  app.post("/api/courses/:courseId/chapters/:chapterId/videos", async (req, res) => {
    try {
      const { courseId, chapterId } = req.params;
      const { title, description, videoUrl, thumbnailUrl, duration, sortOrder, isDemo } = req.body;
      if (!title || !videoUrl) {
        return res.status(400).json({ success: false, message: "Title and videoUrl are required" });
      }

      const id = randomUUID();
      const now = Date.now();
      const videoDuration = duration || 0;

      await db.insert(courseVideos).values({
        id,
        courseId,
        chapterId,
        title,
        description: description || "",
        videoUrl,
        thumbnailUrl: thumbnailUrl || "",
        duration: videoDuration,
        sortOrder: sortOrder || 0,
        isDemo: isDemo || 0,
        createdAt: now,
      });

      const allVideos = await db.select().from(courseVideos).where(eq(courseVideos.courseId, courseId));
      const totalVideos = allVideos.length;
      const totalDuration = allVideos.reduce((sum, v) => sum + (v.duration || 0), 0);
      await db.update(courses).set({ totalVideos, totalDuration }).where(eq(courses.id, courseId));

      const [video] = await db.select().from(courseVideos).where(eq(courseVideos.id, id));

      // Auto-dub using actual course source language
      const [courseRow] = await db.select().from(courses).where(eq(courses.id, courseId));
      const sourceLang = courseRow?.language || 'hi';
      const { dubVideo, getSupportedLanguages } = await import("./dubbing");
      const targetLanguages = getSupportedLanguages().filter(lang => lang !== sourceLang);

      (async () => {
        for (const lang of targetLanguages) {
          try {
            console.log(`[Auto-Dub] ${sourceLang} → ${lang} for video ${id}`);
            await dubVideo(id, courseId, lang, sourceLang);
            await new Promise(r => setTimeout(r, 5000));
          } catch (err) {
            console.error(`[Auto-Dub] Failed for video ${id} lang ${lang}:`, err);
          }
        }
      })();

      // Notify all users about new video content (fire-and-forget)
      (async () => {
        try {
          const [courseRow2] = await db.select({ title: courses.title, teacherName: courses.teacherName, teacherId: courses.teacherId, isPublished: courses.isPublished })
            .from(courses).where(eq(courses.id, courseId));
          if (courseRow2?.isPublished === 1) {
            await notifyAllUsers({
              title: `🎬 New Video Added!`,
              body: `"${title}" added to "${courseRow2.title}" by ${courseRow2.teacherName || 'a teacher'}`,
              data: { type: 'new_video', courseId },
            }, courseRow2.teacherId || '');
          }
        } catch (e) {
          console.warn('[Push] Failed to notify about new video:', e);
        }
      })();

      return res.json({ success: true, video });
    } catch (error) {
      console.error("[Courses] Create video error:", error);
      return res.status(500).json({ success: false, message: "Failed to create video" });
    }
  });

  app.delete("/api/courses/:courseId/videos/:videoId", async (req, res) => {
    try {
      const { courseId, videoId } = req.params;
      await db.delete(dubbedVideos).where(eq(dubbedVideos.videoId, videoId));
      await db.delete(courseVideos).where(eq(courseVideos.id, videoId));

      const allVideos = await db.select().from(courseVideos).where(eq(courseVideos.courseId, courseId));
      const totalVideos = allVideos.length;
      const totalDuration = allVideos.reduce((sum, v) => sum + (v.duration || 0), 0);
      await db.update(courses).set({ totalVideos, totalDuration }).where(eq(courses.id, courseId));

      return res.json({ success: true });
    } catch (error) {
      console.error("[Courses] Delete video error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete video" });
    }
  });

  app.post("/api/videos/:videoId/complete", async (req, res) => {
    try {
      const { videoId } = req.params;
      const { userId, courseId } = req.body;
      if (!userId || !videoId) return res.json({ success: true });
      const existing = await db.select().from(courseEnrollments)
        .where(and(eq(courseEnrollments.courseId, courseId || ''), eq(courseEnrollments.studentId, userId)));
      if (existing.length > 0) {
        const enrollment = existing[0];
        const completedVideos: string[] = enrollment.completedVideos ? JSON.parse(enrollment.completedVideos as string) : [];
        if (!completedVideos.includes(videoId)) {
          completedVideos.push(videoId);
          await db.update(courseEnrollments)
            .set({ completedVideos: JSON.stringify(completedVideos) })
            .where(eq(courseEnrollments.id, enrollment.id));
        }
      }
      return res.json({ success: true });
    } catch (error) {
      return res.json({ success: true });
    }
  });

  app.get("/api/videos/:videoId/progress", async (req, res) => {
    try {
      const { videoId } = req.params;
      const { userId } = req.query as { userId: string };
      if (!userId || !videoId) return res.json({ position: 0, duration: 0 });
      const [row] = await db.select().from(videoProgress)
        .where(and(eq(videoProgress.userId, userId), eq(videoProgress.videoId, videoId)));
      return res.json({ position: row?.position ?? 0, duration: row?.duration ?? 0 });
    } catch (error) {
      return res.json({ position: 0, duration: 0 });
    }
  });

  app.post("/api/videos/:videoId/progress", async (req, res) => {
    try {
      const { videoId } = req.params;
      const { userId, position, duration } = req.body;
      if (!userId || !videoId) return res.json({ success: true });
      const existing = await db.select().from(videoProgress)
        .where(and(eq(videoProgress.userId, userId), eq(videoProgress.videoId, videoId)));
      if (existing.length > 0) {
        await db.update(videoProgress)
          .set({ position: Math.floor(position || 0), duration: Math.floor(duration || 0), updatedAt: Date.now() })
          .where(and(eq(videoProgress.userId, userId), eq(videoProgress.videoId, videoId)));
      } else {
        await db.insert(videoProgress).values({
          id: randomUUID(),
          userId,
          videoId,
          position: Math.floor(position || 0),
          duration: Math.floor(duration || 0),
          updatedAt: Date.now(),
        });
      }
      return res.json({ success: true });
    } catch (error) {
      return res.json({ success: true });
    }
  });

  app.get("/api/courses/:courseId/recommendations", async (req, res) => {
    try {
      const { courseId } = req.params;
      const { studentId } = req.query as { studentId: string };

      const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
      if (!course) return res.status(404).json({ error: "Course not found" });

      const chapters = await db.select().from(courseChapters).where(eq(courseChapters.courseId, courseId));
      const videos = await db.select().from(courseVideos).where(eq(courseVideos.courseId, courseId));

      let completedVideoIds: string[] = [];
      if (studentId) {
        const enrollments = await db.select().from(courseEnrollments)
          .where(and(eq(courseEnrollments.courseId, courseId), eq(courseEnrollments.studentId, studentId)));
        if (enrollments.length > 0) {
          try { completedVideoIds = JSON.parse(enrollments[0].completedVideos as string || "[]"); } catch {}
        }
      }

      const totalVideos = videos.length;
      const completedCount = completedVideoIds.length;
      const progressPct = totalVideos > 0 ? Math.round((completedCount / totalVideos) * 100) : 0;
      const sortedVideos = [...videos].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      const nextVideo = sortedVideos.find(v => !completedVideoIds.includes(v.id));

      const chapterProgress = chapters.map(ch => {
        const chVids = videos.filter(v => v.chapterId === ch.id);
        const chCompleted = chVids.filter(v => completedVideoIds.includes(v.id)).length;
        return { chapterTitle: ch.title, total: chVids.length, completed: chCompleted, chapterId: ch.id };
      });

      const completedVideos = sortedVideos.filter(v => completedVideoIds.includes(v.id)).map(v => v.title);
      const remainingVideos = sortedVideos.filter(v => !completedVideoIds.includes(v.id)).map(v => ({ id: v.id, title: v.title, chapterId: v.chapterId }));

      type Recommendation = { type: string; title: string; description: string; videoId?: string; icon: string };
      let recommendations: Recommendation[] = [];

      if (totalVideos === 0) {
        recommendations = [{ type: "start", title: "Course Content Coming Soon", description: "The instructor is preparing video content for this course. Check back soon!", icon: "time" }];
      } else {
        try {
          const openai = new OpenAI({
            apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
            baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
          });

          const prompt = `You are an AI study coach analyzing a student's performance in an online course.

Course: "${course.title}"
Description: ${course.description || "A practical course"}
Total Videos: ${totalVideos}
Progress: ${completedCount} of ${totalVideos} videos completed (${progressPct}%)

Chapter Progress:
${chapterProgress.map(c => `- ${c.chapterTitle}: ${c.completed}/${c.total} completed`).join('\n')}

Recently completed videos:
${completedVideos.slice(-5).length > 0 ? completedVideos.slice(-5).map(t => `- ${t}`).join('\n') : '- None yet'}

Next unwatched videos:
${remainingVideos.slice(0, 5).map(v => `- ${v.title} (id: ${v.id})`).join('\n') || '- None (all completed!)'}

Generate 4 highly personalized study recommendations for this student. Each must be specific, actionable, and motivating — not generic.

Respond ONLY with a valid JSON array (no markdown, no code blocks):
[
  {
    "type": "start|continue|finish|complete|next|focus|goal|review|challenge",
    "title": "Short compelling title (max 8 words)",
    "description": "Specific, helpful advice (2-3 sentences). Reference actual video/chapter names.",
    "videoId": "video-id-from-list-or-null",
    "icon": "one of: rocket|trending-up|star|flag|trophy|play-circle|bulb|calendar-outline|refresh|checkmark-circle|flame|book"
  }
]`;

          const response = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [{ role: "user", content: prompt }],
            max_completion_tokens: 1200,
          });

          const content = response.choices[0]?.message?.content || "[]";
          const cleaned = content.trim().replace(/^```json?\n?/, '').replace(/```$/, '').trim();
          const parsed: Recommendation[] = JSON.parse(cleaned);

          if (Array.isArray(parsed) && parsed.length > 0) {
            recommendations = parsed.map(r => ({
              type: r.type || "next",
              title: r.title || "Study Tip",
              description: r.description || "",
              videoId: r.videoId && r.videoId !== "null" ? r.videoId : undefined,
              icon: r.icon || "bulb",
            }));
          }
        } catch (aiError) {
          console.warn("[Recommendations] AI generation failed, using fallback:", aiError);
          if (progressPct === 0) {
            recommendations = [{ type: "start", title: "Start Your Learning Journey", description: `Begin with the first video of "${course.title}" to build your skills from the ground up.`, videoId: sortedVideos[0]?.id, icon: "rocket" }];
          } else if (progressPct < 100) {
            recommendations = [{ type: "continue", title: "Keep Going!", description: `You're ${progressPct}% done. ${nextVideo ? `Next up: "${nextVideo.title}"` : "Great work!"}`, videoId: nextVideo?.id, icon: "trending-up" }];
          } else {
            recommendations = [{ type: "complete", title: "Course Completed!", description: "Congratulations! You've finished all videos. Consider revisiting chapters to reinforce your learning.", icon: "trophy" }];
          }
          if (nextVideo) {
            const nextChapter = chapters.find(c => c.id === nextVideo.chapterId);
            recommendations.push({ type: "next", title: `Watch Next: ${nextVideo.title}`, description: `Continue from where you left off${nextChapter ? ` in "${nextChapter.title}"` : ""}.`, videoId: nextVideo.id, icon: "play-circle" });
          }
        }
      }

      return res.json({ recommendations, progress: { completed: completedCount, total: totalVideos, percentage: progressPct }, nextVideoId: nextVideo?.id });
    } catch (error) {
      console.error("[Recommendations] Error:", error);
      return res.status(500).json({ error: "Failed to get recommendations" });
    }
  });

  app.post("/api/courses/:courseId/enroll", async (req, res) => {
    try {
      const { courseId } = req.params;
      const { studentId, studentName, studentPhone, teacherId } = req.body;
      if (!studentId || !studentName) {
        return res.status(400).json({ success: false, message: "studentId and studentName are required" });
      }

      const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
      if (!course) return res.status(404).json({ success: false, message: "Course not found" });

      const existing = await db.select().from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.courseId, courseId),
          eq(courseEnrollments.studentId, studentId)
        ));
      if (existing.length > 0) {
        return res.json({ success: true, enrollment: existing[0], message: "Already enrolled" });
      }

      const now = Date.now();
      const accessDays = course.accessDays || 365;
      const expiresAt = now + accessDays * 24 * 60 * 60 * 1000;
      const id = randomUUID();

      await db.insert(courseEnrollments).values({
        id,
        courseId,
        studentId,
        studentName,
        studentPhone: studentPhone || "",
        teacherId: teacherId || course.teacherId,
        status: "active",
        paymentStatus: "pending",
        expiresAt,
        createdAt: now,
      });

      await db.update(courses).set({ enrollmentCount: (course.enrollmentCount || 0) + 1 }).where(eq(courses.id, courseId));

      const [enrollment] = await db.select().from(courseEnrollments).where(eq(courseEnrollments.id, id));
      return res.json({ success: true, enrollment });
    } catch (error) {
      console.error("[Courses] Enroll error:", error);
      return res.status(500).json({ success: false, message: "Failed to enroll" });
    }
  });

  app.get("/api/enrollments", async (req, res) => {
    try {
      const { studentId, teacherId } = req.query;
      let enrollments;
      if (studentId) {
        enrollments = await db.select().from(courseEnrollments)
          .where(eq(courseEnrollments.studentId, studentId as string))
          .orderBy(desc(courseEnrollments.createdAt));
      } else if (teacherId) {
        enrollments = await db.select().from(courseEnrollments)
          .where(eq(courseEnrollments.teacherId, teacherId as string))
          .orderBy(desc(courseEnrollments.createdAt));
      } else {
        enrollments = await db.select().from(courseEnrollments).orderBy(desc(courseEnrollments.createdAt));
      }
      return res.json(enrollments);
    } catch (error) {
      console.error("[Enrollments] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get enrollments" });
    }
  });

  app.get("/api/enrollments/check", async (req, res) => {
    try {
      const { courseId, studentId } = req.query;
      if (!courseId || !studentId) {
        return res.status(400).json({ success: false, message: "courseId and studentId are required" });
      }

      const existing = await db.select().from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.courseId, courseId as string),
          eq(courseEnrollments.studentId, studentId as string)
        ));

      if (existing.length > 0) {
        return res.json({ enrolled: true, enrollment: existing[0] });
      }
      return res.json({ enrolled: false, enrollment: null });
    } catch (error) {
      console.error("[Enrollments] Check error:", error);
      return res.status(500).json({ success: false, message: "Failed to check enrollment" });
    }
  });

  app.delete("/api/orders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { sellerId } = req.query;
      
      if (sellerId) {
        const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.sellerId, sellerId as string)));
        if (!order) {
          return res.status(404).json({ success: false, message: "Order not found or unauthorized" });
        }
      }
      
      await db.delete(orders).where(eq(orders.id, id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Orders] Delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete order" });
    }
  });

  // ========== Repair Bookings ==========
  function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  app.post("/api/repair-bookings", async (req, res) => {
    try {
      const { customerId, customerName, customerPhone, deviceBrand, deviceModel, repairType, price, address, latitude, longitude, bookingDate, bookingTime, notes } = req.body;
      if (!customerId || !customerName || !deviceBrand || !deviceModel || !repairType || !bookingDate || !bookingTime) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
      }
      const id = randomUUID();
      const now = Date.now();
      // Find nearest technician
      let technicianId = '';
      let technicianName = '';
      let technicianPhone = '';
      if (latitude && longitude) {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        const techs = await db.select().from(profiles).where(and(eq(profiles.role, 'technician'), eq(profiles.verified as any, 1)));
        let best: { id: string; name: string; phone: string; dist: number } | null = null;
        for (const t of techs) {
          if (t.availableForJobs === 'false') continue;
          if (!t.latitude || !t.longitude) continue;
          const dist = haversineKm(lat, lng, parseFloat(t.latitude), parseFloat(t.longitude));
          if (dist <= 10 && (!best || dist < best.dist)) {
            best = { id: t.id, name: t.name, phone: t.phone, dist };
          }
        }
        if (best) { technicianId = best.id; technicianName = best.name; technicianPhone = best.phone; }
      }
      const status = technicianId ? 'assigned' : 'pending';
      await db.insert(repairBookings).values({ id, customerId, customerName, customerPhone: customerPhone || '', deviceBrand, deviceModel, repairType, price: price || '0', address: address || '', latitude: latitude || '', longitude: longitude || '', bookingDate, bookingTime, status, technicianId, technicianName, technicianPhone, notes: notes || '', createdAt: now, updatedAt: now });
      // Auto-create a lead so technicians can discover this repair request
      try {
        await db.insert(leads).values({
          customerId: customerId || '',
          customerName: customerName || '',
          title: `${deviceBrand} ${deviceModel} — ${repairType}`,
          description: notes || `${repairType} needed for ${deviceBrand} ${deviceModel}`,
          category: 'repair',
          location: address || '',
          contactNumber: customerPhone || '',
          latitude: latitude || '',
          longitude: longitude || '',
          status: 'open',
          createdAt: now,
          updatedAt: now,
        });
        console.log(`[Leads] Auto-created lead for repair booking ${id}`);
      } catch (leadErr) {
        console.warn('[Leads] Failed to auto-create lead (non-fatal):', leadErr);
      }
      return res.json({ success: true, id, status, technicianId, technicianName, technicianPhone });
    } catch (error) {
      console.error("[RepairBookings] Create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create repair booking" });
    }
  });

  app.get("/api/repair-bookings", async (req, res) => {
    try {
      const { customerId, technicianId, status } = req.query;
      let query = db.select().from(repairBookings);
      const conditions: any[] = [];
      if (customerId) conditions.push(eq(repairBookings.customerId, customerId as string));
      if (technicianId) conditions.push(eq(repairBookings.technicianId, technicianId as string));
      if (status) conditions.push(eq(repairBookings.status, status as string));
      const results = conditions.length > 0
        ? await db.select().from(repairBookings).where(and(...conditions)).orderBy(desc(repairBookings.createdAt))
        : await db.select().from(repairBookings).orderBy(desc(repairBookings.createdAt));
      return res.json(results);
    } catch (error) {
      console.error("[RepairBookings] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get repair bookings" });
    }
  });

  app.get("/api/repair-bookings/:id", async (req, res) => {
    try {
      const [booking] = await db.select().from(repairBookings).where(eq(repairBookings.id, req.params.id));
      if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
      return res.json(booking);
    } catch (error) {
      console.error("[RepairBookings] Get error:", error);
      return res.status(500).json({ success: false, message: "Failed to get booking" });
    }
  });

  app.get("/api/repair-bookings/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [booking] = await db.select().from(repairBookings).where(eq(repairBookings.id, id)).limit(1);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }
      res.json(booking);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/repair-bookings/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, technicianId, technicianName, technicianPhone, notes } = req.body;
      const updates: any = { status, updatedAt: Date.now() };
      if (technicianId !== undefined) updates.technicianId = technicianId;
      if (technicianName !== undefined) updates.technicianName = technicianName;
      if (technicianPhone !== undefined) updates.technicianPhone = technicianPhone;
      if (notes !== undefined) updates.notes = notes;
      await db.update(repairBookings).set(updates).where(eq(repairBookings.id, id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[RepairBookings] Update error:", error);
      return res.status(500).json({ success: false, message: "Failed to update booking" });
    }
  });

  app.delete("/api/repair-bookings/:id", async (req, res) => {
    try {
      await db.delete(repairBookings).where(eq(repairBookings.id, req.params.id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[RepairBookings] Delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete booking" });
    }
  });

  app.get("/api/technicians/nearby", async (req, res) => {
    try {
      const { lat, lng, radius } = req.query;
      if (!lat || !lng) return res.status(400).json({ success: false, message: "lat and lng required" });
      const userLat = parseFloat(lat as string);
      const userLng = parseFloat(lng as string);
      const maxRadius = parseFloat(radius as string) || 10;
      const techs = await db.select().from(profiles).where(eq(profiles.role, 'technician'));
      const results = techs
        .filter(t => t.latitude && t.longitude)
        .map(t => {
          let skills = [];
          try {
            skills = typeof t.skills === 'string' ? JSON.parse(t.skills || '[]') : (t.skills || []);
          } catch (e) {
            console.warn(`[Technicians] Could not parse skills for tech ${t.id}`);
          }
          return {
            ...t,
            skills,
            distance: haversineKm(userLat, userLng, parseFloat(t.latitude!), parseFloat(t.longitude!))
          };
        })
        .filter(t => t.distance <= maxRadius)
        .sort((a, b) => a.distance - b.distance);
      return res.json(results);
    } catch (error) {
      console.error("[Technicians] Nearby error:", error);
      return res.status(500).json({ success: false, message: "Failed to get nearby technicians" });
    }
  });

  /**
   * Viewport-scoped technicians for map clients (Google Maps / Leaflet).
   * - DB-side bounding box + LIMIT keeps payloads small (scales to large country-wide tables).
   * - lat/lng stored as text: validated with a numeric regex before CAST to avoid query errors.
   *
   * Firestore equivalent (if you sync technicians to Firebase): store GeoPoint `location` and either
   * use a geohash field + prefix range queries, or Cloud Functions + GeoFirestore — plain Firestore
   * cannot index inequality on both lat and lng without a geohash composite pattern.
   */
  app.get("/api/technicians/in-bounds", async (req, res) => {
    try {
      const north = parseFloat(String(req.query.north ?? ""));
      const south = parseFloat(String(req.query.south ?? ""));
      const east = parseFloat(String(req.query.east ?? ""));
      const west = parseFloat(String(req.query.west ?? ""));
      let limit = parseInt(String(req.query.limit ?? "150"), 10);
      if (Number.isNaN(limit) || limit < 1) limit = 150;
      limit = Math.min(limit, 200);
      const centerLatRaw = req.query.centerLat != null ? parseFloat(String(req.query.centerLat)) : NaN;
      const centerLngRaw = req.query.centerLng != null ? parseFloat(String(req.query.centerLng)) : NaN;

      if (Number.isNaN(north) || Number.isNaN(south) || Number.isNaN(east) || Number.isNaN(west)) {
        return res.status(400).json({ success: false, message: "north, south, east, west query params required as numbers" });
      }
      if (south > north || west > east) {
        return res.status(400).json({ success: false, message: "Invalid bounds (expect south<=north, west<=east)" });
      }
      // Prevent unbounded scans from a single world-spanning request
      if (north - south > 28 || east - west > 28) {
        return res.status(400).json({ success: false, message: "Viewport too large; zoom in further" });
      }

      const numericCoord = "^[+-]?[0-9]+(\\.[0-9]+)?$";
      const techs = await db
        .select()
        .from(profiles)
        .where(
          and(
            eq(profiles.role, "technician"),
            sql`${profiles.latitude} ~ ${numericCoord}`,
            sql`${profiles.longitude} ~ ${numericCoord}`,
            sql`CAST(${profiles.latitude} AS DOUBLE PRECISION) >= ${south}`,
            sql`CAST(${profiles.latitude} AS DOUBLE PRECISION) <= ${north}`,
            sql`CAST(${profiles.longitude} AS DOUBLE PRECISION) >= ${west}`,
            sql`CAST(${profiles.longitude} AS DOUBLE PRECISION) <= ${east}`,
          ),
        )
        .limit(limit);

      const withSkills = techs.map((t) => {
        let skills: string[] = [];
        try {
          skills = typeof t.skills === "string" ? JSON.parse(t.skills || "[]") : ((t.skills as unknown as string[]) || []);
        } catch {
          skills = [];
        }
        return { ...t, skills };
      });

      const centerOk = !Number.isNaN(centerLatRaw) && !Number.isNaN(centerLngRaw);
      const enriched = centerOk
        ? withSkills
            .map((t) => {
              const la = parseFloat(String(t.latitude));
              const ln = parseFloat(String(t.longitude));
              return {
                ...t,
                distance: haversineKm(centerLatRaw, centerLngRaw, la, ln),
              };
            })
            .sort((a, b) => a.distance - b.distance)
        : withSkills;

      return res.json(enriched);
    } catch (error) {
      console.error("[Technicians] in-bounds error:", error);
      return res.status(500).json({ success: false, message: "Failed to get technicians in viewport" });
    }
  });

  app.patch("/api/profiles/:id/availability", async (req, res) => {
    try {
      const { availableForJobs } = req.body;
      await db.update(profiles).set({ availableForJobs: availableForJobs ? 'true' : 'false' } as any).where(eq(profiles.id, req.params.id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Profiles] Availability error:", error);
      return res.status(500).json({ success: false, message: "Failed to update availability" });
    }
  });

  app.patch("/api/profiles/:id/verify", async (req, res) => {
    try {
      const { verified } = req.body;
      if (verified === undefined) {
        return res.status(400).json({ success: false, message: "verified parameter required" });
      }
      await db.update(profiles).set({ verified: verified ? 1 : 0 } as any).where(eq(profiles.id, req.params.id));
      return res.json({ success: true, message: `User ${verified ? 'verified' : 'unverified'}.` });
    } catch (error) {
      console.error("[Profiles] Verify error:", error);
      return res.status(500).json({ success: false, message: "Failed to verify profile" });
    }
  });

  app.patch("/api/profiles/:id", async (req, res) => {
    try {
      const { name, email, address, profileImage, shopName, bio, city, state, bannerImage } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (email !== undefined) updates.email = email;
      if (address !== undefined) updates.shopAddress = address;
      if (profileImage !== undefined) updates.avatar = profileImage;
      if (shopName !== undefined) updates.shopName = shopName;
      if (bio !== undefined) updates.bio = bio;
      if (city !== undefined) updates.city = city;
      if (state !== undefined) updates.state = state;
      if (bannerImage !== undefined) updates.bannerImage = bannerImage;
      if (Object.keys(updates).length === 0) {
        return res.json({ success: true, profile: await db.query.profiles.findFirst({ where: eq(profiles.id, req.params.id) }) });
      }
      await db.update(profiles).set(updates as any).where(eq(profiles.id, req.params.id));
      const updated = await db.query.profiles.findFirst({ where: eq(profiles.id, req.params.id) });
      return res.json({ success: true, profile: updated });
    } catch (error) {
      console.error("[Profiles] Update error:", error);
      return res.status(500).json({ success: false, message: "Failed to update profile" });
    }
  });

  app.put("/api/profiles/:id", async (req, res) => {
    try {
      const { shopName, bio, city, state, bannerImage, shopThumbnail } = req.body;
      const updates: any = {};
      if (shopName !== undefined) updates.shopName = shopName;
      if (bio !== undefined) updates.bio = bio;
      if (city !== undefined) updates.city = city;
      if (state !== undefined) updates.state = state;
      if (bannerImage !== undefined) updates.bannerImage = bannerImage;
      if (shopThumbnail !== undefined) updates.shopThumbnail = shopThumbnail;
      if (Object.keys(updates).length === 0) {
        return res.json({ success: true, profile: await db.query.profiles.findFirst({ where: eq(profiles.id, req.params.id) }) });
      }
      await db.update(profiles).set(updates as any).where(eq(profiles.id, req.params.id));
      const updated = await db.query.profiles.findFirst({ where: eq(profiles.id, req.params.id) });
      return res.json({ success: true, profile: updated });
    } catch (error) {
      console.error("[Profiles] PUT error:", error);
      return res.status(500).json({ success: false, message: "Failed to update profile" });
    }
  });

  app.post("/api/supplier/upload-thumbnail", async (req, res) => {
    try {
      const sessionToken = req.headers['x-session-token'] as string;
      if (!sessionToken) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const sessionRows = await db.select().from(sessions).where(eq(sessions.sessionToken, sessionToken));
      if (!sessionRows || sessionRows.length === 0) {
        return res.status(401).json({ success: false, message: "Session expired" });
      }

      const phone = sessionRows[0].phone;
      const allProfiles = await db.select().from(profiles);
      const profile = allProfiles.find((p: any) => p.phone && p.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));

      if (!profile || profile.role !== 'supplier') {
        return res.status(403).json({ success: false, message: "Only suppliers can upload thumbnails" });
      }

      const uploadUrl = req.body.uploadUrl;
      if (!uploadUrl) {
        return res.status(400).json({ success: false, message: "No image URL provided" });
      }

      await db.update(profiles).set({ shopThumbnail: uploadUrl }).where(eq(profiles.id, profile.id));
      return res.json({ success: true, url: uploadUrl });
    } catch (error) {
      console.error("[Supplier] Upload thumbnail error:", error);
      return res.status(500).json({ success: false, message: "Failed to upload thumbnail" });
    }
  });

  const razorpayKeyId = process.env.RAZORPAY_KEY_ID || '';
  const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
  const razorpayAvailable = !!(razorpayKeyId && razorpayKeySecret);
  
  let razorpayInstance: any = null;
  if (razorpayAvailable) {
    razorpayInstance = new Razorpay({
      key_id: razorpayKeyId,
      key_secret: razorpayKeySecret,
    });
    console.log(`[Razorpay] Payment gateway initialized (key: ${razorpayKeyId.substring(0, 12)}...)`);
  } else {
    console.log('[Razorpay] Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET');
  }

  app.post("/api/payments/create-order", async (req, res) => {
    try {
      if (!razorpayAvailable || !razorpayInstance) {
        return res.status(503).json({ success: false, message: "Payment gateway not configured" });
      }
      const { courseId, studentId, studentName, studentPhone } = req.body;
      if (!courseId || !studentId || !studentName) {
        return res.status(400).json({ success: false, message: "courseId, studentId, and studentName required" });
      }

      const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
      if (!course) return res.status(404).json({ success: false, message: "Course not found" });

      const existing = await db.select().from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.courseId, courseId),
          eq(courseEnrollments.studentId, studentId)
        ));
      if (existing.length > 0 && existing[0].status === 'active') {
        return res.json({ success: true, alreadyEnrolled: true, enrollment: existing[0] });
      }

      const amountInPaise = Math.round(parseFloat(course.price || '0') * 100);
      if (amountInPaise <= 0) {
        const now = Date.now();
        const accessDays = course.accessDays || 365;
        const expiresAt = now + accessDays * 24 * 60 * 60 * 1000;
        const id = randomUUID();
        await db.insert(courseEnrollments).values({
          id, courseId, studentId, studentName,
          studentPhone: studentPhone || "",
          teacherId: course.teacherId,
          status: "active", paymentStatus: "free", expiresAt, createdAt: now,
        });
        await db.update(courses).set({ enrollmentCount: (course.enrollmentCount || 0) + 1 }).where(eq(courses.id, courseId));
        const [enrollment] = await db.select().from(courseEnrollments).where(eq(courseEnrollments.id, id));
        return res.json({ success: true, free: true, enrollment });
      }

      const options = {
        amount: amountInPaise,
        currency: "INR",
        receipt: `crs_${Date.now()}`,
        notes: {
          courseId, studentId, studentName, courseTitle: course.title, teacherId: course.teacherId,
        },
      };
      const order = await razorpayInstance.orders.create(options);

      const paymentId = randomUUID();
      await db.insert(payments).values({
        id: paymentId,
        razorpayOrderId: order.id,
        courseId, studentId, studentName,
        studentPhone: studentPhone || "",
        teacherId: course.teacherId,
        amount: amountInPaise,
        currency: "INR",
        status: "created",
        createdAt: Date.now(),
      });

      return res.json({
        success: true,
        orderId: order.id,
        amount: amountInPaise,
        currency: "INR",
        keyId: razorpayKeyId,
        courseName: course.title,
        teacherName: course.teacherName,
        paymentRecordId: paymentId,
      });
    } catch (error) {
      console.error("[Razorpay] Create order error:", error);
      return res.status(500).json({ success: false, message: "Failed to create payment order" });
    }
  });

  app.post("/api/payments/verify", async (req, res) => {
    try {
      if (!razorpayAvailable) {
        return res.status(503).json({ success: false, message: "Payment gateway not configured" });
      }
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, courseId, studentId, studentName, studentPhone } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ success: false, message: "Payment verification data missing" });
      }

      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto.createHmac('sha256', razorpayKeySecret).update(body).digest('hex');
      const isValid = expectedSignature === razorpay_signature;

      if (!isValid) {
        await db.update(payments).set({
          status: "failed",
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
        }).where(eq(payments.razorpayOrderId, razorpay_order_id));
        return res.status(400).json({ success: false, message: "Payment verification failed - invalid signature" });
      }

      const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
      if (!course) {
        return res.status(404).json({ success: false, message: "Course not found" });
      }

      // Calculate commission
      const commissionSettings = await db.select().from(subscriptionSettings).where(eq(subscriptionSettings.role, 'teacher'));
      const commissionPct = parseFloat(commissionSettings[0]?.commissionPercent || '30');
      const [paymentRecord] = await db.select().from(payments).where(eq(payments.razorpayOrderId, razorpay_order_id));
      const totalAmountPaise = paymentRecord?.amount || 0;
      const adminCommissionPaise = Math.round(totalAmountPaise * commissionPct / 100);
      const teacherEarningPaise = totalAmountPaise - adminCommissionPaise;

      await db.update(payments).set({
        status: "paid",
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        adminCommission: adminCommissionPaise,
        teacherEarning: teacherEarningPaise,
        commissionPercent: String(commissionPct),
        payoutStatus: "pending",
      }).where(eq(payments.razorpayOrderId, razorpay_order_id));

      const existingEnrollment = await db.select().from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.courseId, courseId),
          eq(courseEnrollments.studentId, studentId)
        ));
      if (existingEnrollment.length > 0) {
        await db.update(courseEnrollments).set({
          status: "active",
          paymentStatus: "paid",
        }).where(eq(courseEnrollments.id, existingEnrollment[0].id));
        const [updated] = await db.select().from(courseEnrollments).where(eq(courseEnrollments.id, existingEnrollment[0].id));
        return res.json({ success: true, enrollment: updated });
      }

      const now = Date.now();
      const accessDays = course.accessDays || 365;
      const expiresAt = now + accessDays * 24 * 60 * 60 * 1000;
      const enrollId = randomUUID();

      await db.insert(courseEnrollments).values({
        id: enrollId, courseId, studentId,
        studentName: studentName || "Student",
        studentPhone: studentPhone || "",
        teacherId: course.teacherId,
        status: "active", paymentStatus: "paid", expiresAt, createdAt: now,
      });
      await db.update(courses).set({ enrollmentCount: (course.enrollmentCount || 0) + 1 }).where(eq(courses.id, courseId));
      await db.update(payments).set({ enrollmentId: enrollId }).where(eq(payments.razorpayOrderId, razorpay_order_id));

      const [enrollment] = await db.select().from(courseEnrollments).where(eq(courseEnrollments.id, enrollId));
      return res.json({ success: true, enrollment });
    } catch (error) {
      console.error("[Razorpay] Verify payment error:", error);
      return res.status(500).json({ success: false, message: "Failed to verify payment" });
    }
  });

  // ==================== SUBSCRIPTION PAYMENT ROUTES ====================
  app.get("/api/subscription/status/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const [user] = await db.select().from(profiles).where(eq(profiles.id, userId));
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      if (user.phone?.replace(/\D/g, '') === '8179142535') {
        return res.json({ active: true, plan: 'admin', end: 4102444800000 });
      }

      const role = user.role;
      const settings = await db.select().from(subscriptionSettings).where(eq(subscriptionSettings.role, role));
      const setting = settings[0];

      if (!setting || !setting.enabled) {
        return res.json({ success: true, required: false, active: true });
      }

      if (role === 'customer') {
        const now = Date.now();
        const isActive = user.subscriptionActive === 1 && (user.subscriptionEnd || 0) > now;
        return res.json({
          success: true, required: true, active: isActive,
          amount: '30', period: 'monthly',
          subscriptionEnd: user.subscriptionEnd || 0, role: 'customer',
        });
      }

      const now = Date.now();
      const isActive = user.subscriptionActive === 1 && (user.subscriptionEnd || 0) > now;

      return res.json({
        success: true,
        required: true,
        active: isActive,
        amount: String(parseInt(setting.amount || '0', 10) || 0),
        period: setting.period,
        subscriptionEnd: user.subscriptionEnd || 0,
        role: role,
      });
    } catch (error) {
      console.error("[Subscription] Status error:", error);
      return res.status(500).json({ success: false, message: "Failed to check subscription" });
    }
  });

  app.post("/api/subscription/create-order", async (req, res) => {
    try {
      if (!razorpayAvailable || !razorpayInstance) {
        return res.status(503).json({ success: false, message: "Payment gateway not configured" });
      }
      const { userId, userName, userPhone } = req.body;
      if (!userId) return res.status(400).json({ success: false, message: "userId required" });

      const [user] = await db.select().from(profiles).where(eq(profiles.id, userId));
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      const role = user.role;
      const settings = await db.select().from(subscriptionSettings).where(eq(subscriptionSettings.role, role));
      const setting = settings[0];
      if (!setting || !setting.enabled || role === 'customer') {
        return res.status(400).json({ success: false, message: "Subscription not required for this role" });
      }

      const amountInPaise = Math.round(parseFloat(setting.amount || '0') * 100);
      if (amountInPaise <= 0) {
        return res.status(400).json({ success: false, message: "Invalid subscription amount" });
      }

      const options = {
        amount: amountInPaise,
        currency: "INR",
        receipt: `sub_${role}_${Date.now()}`,
        notes: { userId, role, type: 'subscription', period: setting.period },
      };
      const order = await razorpayInstance.orders.create(options);

      return res.json({
        success: true,
        orderId: order.id,
        amount: amountInPaise,
        currency: "INR",
        keyId: razorpayKeyId,
        role: role,
        period: setting.period,
        displayAmount: String(parseInt(setting.amount || '0', 10) || 0),
      });
    } catch (error) {
      console.error("[Subscription] Create order error:", error);
      return res.status(500).json({ success: false, message: "Failed to create subscription order" });
    }
  });

  app.post("/api/subscription/verify", async (req, res) => {
    try {
      if (!razorpayAvailable) {
        return res.status(503).json({ success: false, message: "Payment gateway not configured" });
      }
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userId) {
        return res.status(400).json({ success: false, message: "Missing payment data" });
      }

      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto.createHmac('sha256', razorpayKeySecret).update(body).digest('hex');
      const isValid = expectedSignature === razorpay_signature;

      if (!isValid) {
        return res.status(400).json({ success: false, message: "Payment verification failed" });
      }

      const now = Date.now();
      const oneMonthMs = 30 * 24 * 60 * 60 * 1000;
      const subscriptionEnd = now + oneMonthMs;

      await db.update(profiles).set({
        subscriptionActive: 1,
        subscriptionEnd: subscriptionEnd,
        subscriptionOrderId: razorpay_order_id,
      }).where(eq(profiles.id, userId));

      return res.json({
        success: true,
        subscriptionActive: 1,
        subscriptionEnd: subscriptionEnd,
      });
    } catch (error) {
      console.error("[Subscription] Verify error:", error);
      return res.status(500).json({ success: false, message: "Failed to verify subscription" });
    }
  });

  // Customer ₹30/month subscription order
  app.post("/api/customer/subscription/create-order", async (req, res) => {
    try {
      if (!razorpayAvailable || !razorpayInstance) {
        return res.status(503).json({ success: false, message: "Payment gateway not configured" });
      }
      const { userId, mobileModel, imeiNumber } = req.body;
      if (!userId) return res.status(400).json({ success: false, message: "userId required" });
      const [user] = await db.select().from(profiles).where(eq(profiles.id, userId));
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      // Read admin-configured price from appSettings
      const priceRows = await db.select().from(appSettings).where(eq(appSettings.key, 'insurance_plan_price'));
      const adminPrice = priceRows[0] ? parseInt(priceRows[0].value || '50', 10) : 50;
      const planPrice = adminPrice > 0 ? adminPrice : 50;
      const amountInPaise = planPrice * 100;

      const options = {
        amount: amountInPaise, currency: "INR",
        receipt: `cust_sub_${Date.now()}`,
        notes: {
          userId,
          role: 'customer',
          type: 'customer_subscription',
          mobileModel: mobileModel || '',
          imeiNumber: imeiNumber || '',
        },
      };
      const order = await razorpayInstance.orders.create(options);
      return res.json({ success: true, orderId: order.id, amount: amountInPaise, currency: "INR", keyId: razorpayKeyId, displayAmount: String(planPrice) });
    } catch (error) {
      console.error("[Customer Sub] Create order error:", error);
      return res.status(500).json({ success: false, message: "Failed to create order" });
    }
  });

  app.post("/api/customer/subscription/verify", async (req, res) => {
    try {
      if (!razorpayAvailable) return res.status(503).json({ success: false, message: "Payment gateway not configured" });
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userId) {
        return res.status(400).json({ success: false, message: "Missing payment data" });
      }
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSig = crypto.createHmac('sha256', razorpayKeySecret).update(body).digest('hex');
      if (expectedSig !== razorpay_signature) return res.status(400).json({ success: false, message: "Invalid signature" });
      const now = Date.now();
      const subscriptionEnd = now + 30 * 24 * 60 * 60 * 1000;
      await db.update(profiles).set({ subscriptionActive: 1, subscriptionEnd, subscriptionOrderId: razorpay_order_id })
        .where(eq(profiles.id, userId));
      return res.json({ success: true, subscriptionActive: 1, subscriptionEnd });
    } catch (error) {
      console.error("[Customer Sub] Verify error:", error);
      return res.status(500).json({ success: false, message: "Failed to verify" });
    }
  });

  // Manual activate (admin or test use)
  app.post("/api/customer/subscription/activate", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ success: false });
      const now = Date.now();
      const subscriptionEnd = now + 30 * 24 * 60 * 60 * 1000;
      await db.update(profiles).set({ subscriptionActive: 1, subscriptionEnd }).where(eq(profiles.id, userId));
      return res.json({ success: true, subscriptionEnd });
    } catch {
      return res.status(500).json({ success: false });
    }
  });

  // Admin: grant subscription manually for 1, 2, or 3 months
  app.post("/api/admin/grant-subscription", adminMiddleware, async (req, res) => {
    try {
      const { userId, months } = req.body;
      if (!userId || !months || ![1, 2, 3].includes(Number(months))) {
        return res.status(400).json({ success: false, message: "userId and months (1-3) required" });
      }
      const monthMs = Number(months) * 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const [user] = await db.select({ subscriptionEnd: profiles.subscriptionEnd, subscriptionActive: profiles.subscriptionActive, role: profiles.role })
        .from(profiles).where(eq(profiles.id, userId));
      if (!user) return res.status(404).json({ success: false, message: "User not found" });
      const SUB_ROLES = ['technician', 'teacher', 'supplier', 'shopkeeper'];
      if (!SUB_ROLES.includes(user.role)) {
        return res.status(400).json({ success: false, message: `Subscriptions are not applicable for role: ${user.role}` });
      }
      const currentEnd = (user.subscriptionEnd || 0) as number;
      const base = currentEnd > now ? currentEnd : now;
      const subscriptionEnd = base + monthMs;
      await db.update(profiles).set({ subscriptionActive: 1, subscriptionEnd }).where(eq(profiles.id, userId));
      return res.json({ success: true, subscriptionEnd });
    } catch (err) {
      console.error("[Admin Grant Sub] Error:", err);
      return res.status(500).json({ success: false, message: "Internal error" });
    }
  });

  app.post("/api/admin/revoke-subscription", adminMiddleware, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, message: "userId required" });
      }
      await db.update(profiles).set({ subscriptionActive: 0, subscriptionEnd: 0, subscriptionOrderId: "" }).where(eq(profiles.id, userId));
      return res.json({ success: true });
    } catch (err) {
      console.error("[Admin Revoke Sub] Error:", err);
      return res.status(500).json({ success: false, message: "Internal error" });
    }
  });

  app.get("/api/subscription/checkout", (req, res) => {
    const { orderId, amount, keyId, role, displayAmount, userName, userPhone, userEmail, userId } = req.query;
    
    const baseUrl = process.env.APP_DOMAIN || apiPublicBase();

    const roleLabel = role === 'technician' ? 'Technician' : role === 'supplier' ? 'Supplier' : role === 'teacher' ? 'Teacher' : role === 'customer' ? 'Mobile Protection' : String(role);

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Subscribe - ${roleLabel} Plan</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0D0D0D; color: #fff; min-height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 20px;
    }
    .container { text-align: center; max-width: 400px; width: 100%; }
    .logo { font-size: 28px; font-weight: 800; color: #FF6B35; margin-bottom: 24px; }
    .plan-name { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    .plan-desc { color: #999; font-size: 14px; margin-bottom: 24px; }
    .amount { font-size: 36px; font-weight: 700; color: #FF6B35; margin-bottom: 32px; }
    .amount span { font-size: 18px; color: #999; }
    .pay-btn {
      background: #FF6B35; color: #fff; border: none; padding: 16px 48px;
      font-size: 18px; font-weight: 700; border-radius: 12px; cursor: pointer;
      width: 100%; transition: opacity 0.2s;
    }
    .pay-btn:hover { opacity: 0.9; }
    .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 24px; font-size: 14px; color: #999; }
    .success { color: #4CAF50; font-size: 18px; font-weight: 600; }
    .failed { color: #F44336; font-size: 18px; font-weight: 600; }
    .secure { margin-top: 16px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Mobi</div>
    <div class="plan-name">${roleLabel} Monthly Plan</div>
    <div class="plan-desc">Unlock all features for 30 days</div>
    <div class="amount">\\u20B9${displayAmount || '0'} <span>/month</span></div>
    <button class="pay-btn" id="payBtn" onclick="startPayment()">Subscribe Now</button>
    <div class="status" id="status"></div>
    <div class="secure">&#128274; Secured by Razorpay</div>
  </div>
  <script>
    function startPayment() {
      document.getElementById('payBtn').disabled = true;
      document.getElementById('status').textContent = 'Opening payment...';
      
      var options = {
        key: '${keyId}',
        amount: ${amount || 0},
        currency: 'INR',
        name: 'Mobi',
        description: '${roleLabel} Monthly Subscription',
        order_id: '${orderId}',
        prefill: {
          name: '${userName || ''}',
          contact: '${userPhone || ''}',
          email: '${userEmail || ''}'
        },
        theme: { color: '#FF6B35' },
        handler: function(response) {
          document.getElementById('status').innerHTML = '<div class="success">Payment Successful! Activating...</div>';
          fetch('${baseUrl}/api/subscription/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              userId: '${userId}'
            })
          }).then(r => r.json()).then(data => {
            if (data.success) {
              document.getElementById('status').innerHTML = '<div class="success">\\u2705 Subscription Activated! You can close this page.</div>';
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'subscription_success', ...data }));
              }
            } else {
              document.getElementById('status').innerHTML = '<div class="failed">Verification failed. Contact support.</div>';
            }
          }).catch(() => {
            document.getElementById('status').innerHTML = '<div class="failed">Network error. Please try again.</div>';
          });
        },
        modal: {
          ondismiss: function() {
            document.getElementById('payBtn').disabled = false;
            document.getElementById('status').textContent = 'Payment cancelled';
          }
        }
      };
      var rzp = new Razorpay(options);
      rzp.open();
    }
    setTimeout(startPayment, 500);
  <\/script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  app.get("/api/payments/checkout", (req, res) => {
    const { orderId, amount, keyId, courseName, teacherName, studentName, studentPhone, studentEmail, courseId, studentId } = req.query;
    
    const baseUrl = process.env.APP_DOMAIN || apiPublicBase();

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payment - ${courseName || 'Course'}</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0D0D0D; color: #fff; min-height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 20px;
    }
    .container { text-align: center; max-width: 400px; width: 100%; }
    .logo { font-size: 28px; font-weight: 800; color: #FF6B35; margin-bottom: 24px; }
    .course-name { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    .teacher { color: #999; font-size: 14px; margin-bottom: 24px; }
    .amount { font-size: 36px; font-weight: 700; color: #FF6B35; margin-bottom: 32px; }
    .amount span { font-size: 18px; color: #999; }
    .pay-btn {
      background: #FF6B35; color: #fff; border: none; padding: 16px 48px;
      font-size: 18px; font-weight: 700; border-radius: 12px; cursor: pointer;
      width: 100%; transition: opacity 0.2s;
    }
    .pay-btn:hover { opacity: 0.9; }
    .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 24px; font-size: 14px; color: #999; }
    .success { color: #4CAF50; font-size: 18px; font-weight: 600; }
    .failed { color: #F44336; font-size: 18px; font-weight: 600; }
    .spinner { width: 40px; height: 40px; border: 4px solid #333; border-top: 4px solid #FF6B35;
      border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .secure { display: flex; align-items: center; justify-content: center; gap: 6px;
      margin-top: 16px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Mobi</div>
    <div class="course-name">${courseName || 'Course'}</div>
    <div class="teacher">by ${teacherName || 'Teacher'}</div>
    <div class="amount">&#8377;${((parseInt(amount as string) || 0) / 100).toLocaleString('en-IN')} <span>INR</span></div>
    <button class="pay-btn" id="payBtn" onclick="startPayment()">Pay Now</button>
    <div class="status" id="status"></div>
    <div class="secure">&#128274; Secured by Razorpay</div>
  </div>
  <script>
    var paymentDone = false;
    function startPayment() {
      document.getElementById('payBtn').disabled = true;
      document.getElementById('status').innerHTML = '<div class="spinner"></div>Opening payment...';
      var options = {
        key: '${keyId}',
        amount: '${amount}',
        currency: 'INR',
        name: 'Mobi',
        description: '${((courseName as string) || '').replace(/'/g, "\\'")}',
        order_id: '${orderId}',
        prefill: {
          name: '${(studentName as string || '').replace(/'/g, "\\'")}',
          contact: '${studentPhone || ''}',
          email: '${studentEmail || ''}',
        },
        theme: { color: '#FF6B35' },
        handler: function(response) {
          paymentDone = true;
          document.getElementById('status').innerHTML = '<div class="spinner"></div>Verifying payment...';
          document.getElementById('payBtn').style.display = 'none';
          fetch('${baseUrl}/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              courseId: '${courseId}',
              studentId: '${studentId}',
              studentName: '${(studentName as string || '').replace(/'/g, "\\'")}',
              studentPhone: '${studentPhone || ''}',
            }),
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.success) {
              document.getElementById('status').innerHTML = '<div class="success">Payment Successful!</div><p style="color:#999;margin-top:8px">Enrollment confirmed. Go back to the app.</p>';
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'payment_success', enrollment: data.enrollment }));
              }
            } else {
              document.getElementById('status').innerHTML = '<div class="failed">Verification Failed</div><p style="color:#999;margin-top:8px">' + (data.message || 'Please contact support') + '</p>';
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'payment_failed', message: data.message }));
              }
            }
          })
          .catch(function(err) {
            document.getElementById('status').innerHTML = '<div class="failed">Error</div><p style="color:#999;margin-top:8px">Network error. Please try again.</p>';
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'payment_error', message: err.message }));
            }
          });
        },
        modal: {
          ondismiss: function() {
            if (!paymentDone) {
              document.getElementById('payBtn').disabled = false;
              document.getElementById('status').innerHTML = '<p style="color:#F9A825">Payment cancelled</p>';
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'payment_cancelled' }));
              }
            }
          }
        }
      };
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function(response) {
        document.getElementById('payBtn').disabled = false;
        document.getElementById('status').innerHTML = '<div class="failed">Payment Failed</div><p style="color:#999;margin-top:8px">' + (response.error.description || 'Please try again') + '</p>';
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'payment_failed', message: response.error.description }));
        }
      });
      rzp.open();
    }
    setTimeout(startPayment, 500);
  </script>
</body>
</html>`;
    res.type('html').send(html);
  });

  app.get("/api/payments", async (req, res) => {
    try {
      const { studentId, teacherId, courseId } = req.query;
      let result;
      if (studentId) {
        result = await db.select().from(payments).where(eq(payments.studentId, studentId as string)).orderBy(desc(payments.createdAt));
      } else if (teacherId) {
        result = await db.select().from(payments).where(eq(payments.teacherId, teacherId as string)).orderBy(desc(payments.createdAt));
      } else if (courseId) {
        result = await db.select().from(payments).where(eq(payments.courseId, courseId as string)).orderBy(desc(payments.createdAt));
      } else {
        result = await db.select().from(payments).orderBy(desc(payments.createdAt));
      }
      return res.json(result);
    } catch (error) {
      console.error("[Payments] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get payments" });
    }
  });

  // ==================== TEACHER REVENUE & PAYOUTS ====================
  app.get("/api/teacher/revenue/:teacherId", async (req, res) => {
    try {
      const { teacherId } = req.params;
      const allPayments = await db.select().from(payments)
        .where(and(eq(payments.teacherId, teacherId), eq(payments.status, 'paid')))
        .orderBy(desc(payments.createdAt));

      const allEnrollments = await db.select().from(courseEnrollments)
        .where(eq(courseEnrollments.teacherId, teacherId));

      const allCourses = await db.select().from(courses)
        .where(eq(courses.teacherId, teacherId));

      const allPayoutsData = await db.select().from(teacherPayouts)
        .where(eq(teacherPayouts.teacherId, teacherId))
        .orderBy(desc(teacherPayouts.requestedAt));

      const commissionSettings = await db.select().from(subscriptionSettings)
        .where(eq(subscriptionSettings.role, 'teacher'));
      const currentCommissionPct = parseFloat(commissionSettings[0]?.commissionPercent || '30');

      const totalRevenuePaise = allPayments.reduce((s, p) => s + (p.amount || 0), 0);
      const totalCommissionPaise = allPayments.reduce((s, p) => s + (p.adminCommission || 0), 0);
      const totalEarningsPaise = allPayments.reduce((s, p) => s + (p.teacherEarning || 0), 0);

      const paidPayouts = allPayoutsData.filter(p => p.status === 'paid');
      const paidOutPaise = paidPayouts.reduce((s, p) => s + (p.amount || 0), 0);
      const availableForWithdrawal = Math.max(0, totalEarningsPaise - paidOutPaise);

      const recentSales = allPayments.slice(0, 20).map(p => ({
        id: p.id,
        courseId: p.courseId,
        studentName: p.studentName,
        amount: p.amount,
        teacherEarning: p.teacherEarning,
        adminCommission: p.adminCommission,
        commissionPercent: p.commissionPercent,
        createdAt: p.createdAt,
      }));

      return res.json({
        success: true,
        totalRevenue: totalRevenuePaise / 100,
        totalCommission: totalCommissionPaise / 100,
        totalEarnings: totalEarningsPaise / 100,
        availableForWithdrawal: availableForWithdrawal / 100,
        paidOut: paidOutPaise,
        totalSales: allPayments.length,
        totalEnrollments: allEnrollments.length,
        totalCourses: allCourses.length,
        currentCommissionPct,
        payouts: allPayoutsData,
        recentSales,
      });
    } catch (error) {
      console.error("[Teacher Revenue] Error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch revenue" });
    }
  });

  app.post("/api/teacher/payout/request", async (req, res) => {
    try {
      const { teacherId, teacherName, amount, upiId, bankAccount, notes } = req.body;
      if (!teacherId || !amount || amount <= 0) {
        return res.status(400).json({ success: false, message: "teacherId and valid amount required" });
      }
      const payoutId = randomUUID();
      await db.insert(teacherPayouts).values({
        id: payoutId,
        teacherId,
        teacherName: teacherName || 'Unknown',
        amount: Math.round(amount * 100),
        status: 'pending',
        upiId: upiId || '',
        bankAccount: bankAccount || '',
        notes: notes || '',
        requestedAt: Date.now(),
      });
      const [payout] = await db.select().from(teacherPayouts).where(eq(teacherPayouts.id, payoutId));
      return res.json({ success: true, payout });
    } catch (error) {
      console.error("[Payout] Request error:", error);
      return res.status(500).json({ success: false, message: "Failed to request payout" });
    }
  });

  app.get("/api/admin/teacher-payouts", async (_req, res) => {
    try {
      const allPayouts = await db.select().from(teacherPayouts).orderBy(desc(teacherPayouts.requestedAt));
      return res.json(allPayouts);
    } catch (error) {
      console.error("[Admin Payouts] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch payouts" });
    }
  });

  app.patch("/api/admin/teacher-payouts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, adminNotes } = req.body;
      const updateData: any = {};
      if (status) updateData.status = status;
      if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
      if (status === 'paid') updateData.paidAt = Date.now();
      await db.update(teacherPayouts).set(updateData).where(eq(teacherPayouts.id, id));
      const [updated] = await db.select().from(teacherPayouts).where(eq(teacherPayouts.id, id));
      return res.json({ success: true, payout: updated });
    } catch (error) {
      console.error("[Admin Payouts] Update error:", error);
      return res.status(500).json({ success: false, message: "Failed to update payout" });
    }
  });

  // ==================== SECURE VIDEO URL (Enrolled users only) ====================
  app.get("/api/course/secure-url/:videoId", async (req, res) => {
    try {
      const { videoId } = req.params;
      const { studentId } = req.query;

      const [video] = await db.select().from(courseVideos).where(eq(courseVideos.id, videoId));
      if (!video) return res.status(404).json({ success: false, message: "Video not found" });

      if (video.isDemo === 1) {
        return res.json({ success: true, url: video.videoUrl, isDemo: true });
      }

      if (!studentId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      const now = Date.now();
      const [enrollment] = await db.select().from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.courseId, video.courseId),
          eq(courseEnrollments.studentId, studentId as string),
          eq(courseEnrollments.status, 'active'),
          gt(courseEnrollments.expiresAt, now)
        ));

      if (!enrollment) {
        return res.status(403).json({ success: false, message: "Not enrolled or enrollment expired" });
      }

      // Generate Bunny.net signed URL if token key is available
      const BUNNY_TOKEN_KEY = process.env.BUNNY_TOKEN_KEY;
      let secureUrl = video.videoUrl;

      if (BUNNY_TOKEN_KEY && video.videoUrl.includes('b-cdn.net')) {
        const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        const urlPath = new URL(video.videoUrl).pathname;
        const tokenRaw = `${BUNNY_TOKEN_KEY}${urlPath}${expiresAt}`;
        const token = crypto.createHash('sha256').update(tokenRaw).digest('base64url');
        secureUrl = `${video.videoUrl}?token=${token}&expires=${expiresAt}`;
      }

      return res.json({
        success: true,
        url: secureUrl,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
    } catch (error) {
      console.error("[SecureURL] Error:", error);
      return res.status(500).json({ success: false, message: "Failed to get secure URL" });
    }
  });

  // ==================== CHAT CONTACT PERMISSION ====================
  app.get("/api/chat/can-contact/:teacherId", async (req, res) => {
    try {
      const { teacherId } = req.params;
      const { studentId } = req.query;
      if (!studentId) {
        return res.status(400).json({ success: false, message: "studentId query param is required" });
      }

      const now = Date.now();
      const activeEnrollments = await db.select().from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.studentId, studentId as string),
          eq(courseEnrollments.teacherId, teacherId),
          gt(courseEnrollments.expiresAt, now)
        ));

      if (activeEnrollments.length > 0) {
        return res.json({ canContact: true, reason: "Active enrollment found" });
      }
      return res.json({ canContact: false, reason: "No active enrollment with this teacher" });
    } catch (error) {
      console.error("[Chat] Can contact check error:", error);
      return res.status(500).json({ success: false, message: "Failed to check contact permission" });
    }
  });

  app.post("/api/dubbing/start", async (req, res) => {
    try {
      const { videoId, courseId, targetLanguage, sourceLang } = req.body;
      if (!videoId || !courseId || !targetLanguage) {
        return res.status(400).json({ success: false, message: "videoId, courseId, and targetLanguage are required" });
      }

      const existingDubbed = await db.select().from(dubbedVideos)
        .where(and(
          eq(dubbedVideos.videoId, videoId),
          eq(dubbedVideos.language, targetLanguage)
        ));

      if (existingDubbed.length > 0) {
        const existing = existingDubbed[0];
        if (existing.status === "completed") {
          return res.json({ success: true, status: "completed", dubbedVideoUrl: existing.dubbedVideoUrl });
        }
        if (existing.status === "processing") {
          return res.json({ success: true, status: "processing", message: "Dubbing already in progress" });
        }
        await db.delete(dubbedVideos).where(eq(dubbedVideos.id, existing.id));
      }

      // Resolve source language: use request body → course language → fallback 'hi'
      let resolvedSourceLang = sourceLang;
      if (!resolvedSourceLang) {
        const [courseRow] = await db.select().from(courses).where(eq(courses.id, courseId));
        resolvedSourceLang = courseRow?.language || 'hi';
      }

      const { dubVideo } = await import("./dubbing");
      res.json({ success: true, status: "processing", message: "Dubbing started" });

      dubVideo(videoId, courseId, targetLanguage, resolvedSourceLang).then(result => {
        console.log(`[Dubbing] Completed for video ${videoId} to ${targetLanguage}:`, result.success ? "success" : result.error);
      });
    } catch (error) {
      console.error("[Dubbing] Start error:", error);
      return res.status(500).json({ success: false, message: "Failed to start dubbing" });
    }
  });

  app.get("/api/dubbing/status/:videoId", async (req, res) => {
    try {
      const { videoId } = req.params;
      const { language } = req.query;

      let query = db.select().from(dubbedVideos).where(eq(dubbedVideos.videoId, videoId));
      const results = await query;

      if (language) {
        const filtered = results.filter(r => r.language === language);
        if (filtered.length === 0) {
          return res.json({ available: false, status: null });
        }
        return res.json({
          available: filtered[0].status === "completed",
          status: filtered[0].status,
          dubbedVideoUrl: filtered[0].dubbedVideoUrl,
        });
      }

      const langMap: Record<string, { status: string; url: string }> = {};
      for (const d of results) {
        langMap[d.language] = { status: d.status, url: d.dubbedVideoUrl };
      }
      return res.json({ languages: langMap });
    } catch (error) {
      console.error("[Dubbing] Status error:", error);
      return res.status(500).json({ success: false, message: "Failed to get dubbing status" });
    }
  });

  app.get("/api/dubbing/languages", (_req, res) => {
    const languages = [
      { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
      { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
      { code: "te", name: "Telugu", nativeName: "తెలుగు" },
      { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ" },
      { code: "ml", name: "Malayalam", nativeName: "മലയാളം" },
      { code: "bn", name: "Bengali", nativeName: "বাংলা" },
      { code: "mr", name: "Marathi", nativeName: "मराठी" },
      { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી" },
      { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
      { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ" },
      { code: "ur", name: "Urdu", nativeName: "اردو" },
      { code: "en", name: "English", nativeName: "English" },
    ];
    res.json({ languages });
  });

  // ========== Live Classes routes ==========
  app.get("/api/courses/:courseId/live-classes", async (req, res) => {
    try {
      const { courseId } = req.params;
      const classes = await db.select().from(liveClasses)
        .where(eq(liveClasses.courseId, courseId))
        .orderBy(desc(liveClasses.scheduledAt));
      return res.json(classes);
    } catch (error) {
      console.error("[LiveClasses] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get live classes" });
    }
  });

  app.post("/api/courses/:courseId/live-classes", async (req, res) => {
    try {
      const { courseId } = req.params;
      const { teacherId, teacherName, title, description, scheduledAt, duration } = req.body;
      const [lc] = await db.insert(liveClasses).values({
        id: randomUUID(),
        courseId,
        teacherId,
        teacherName,
        title,
        description: description || "",
        scheduledAt,
        duration: duration || 60,
        status: "scheduled",
        createdAt: Date.now(),
      }).returning();
      return res.json({ success: true, liveClass: lc });
    } catch (error) {
      console.error("[LiveClasses] Create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create live class" });
    }
  });

  app.patch("/api/live-classes/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, meetingUrl } = req.body;
      const updates: any = { status };
      if (meetingUrl) updates.meetingUrl = meetingUrl;
      const [updated] = await db.update(liveClasses).set(updates).where(eq(liveClasses.id, id)).returning();
      return res.json({ success: true, liveClass: updated });
    } catch (error) {
      console.error("[LiveClasses] Update error:", error);
      return res.status(500).json({ success: false, message: "Failed to update live class" });
    }
  });

  app.delete("/api/live-classes/:id", async (req, res) => {
    try {
      await db.delete(liveClasses).where(eq(liveClasses.id, req.params.id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[LiveClasses] Delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete live class" });
    }
  });

  // ========== Community Live Streams (Feed) ==========
  // GET all active/recent live streams visible in community feed
  app.get("/api/live-streams", async (req, res) => {
    try {
      const streams = await db.select().from(liveClasses)
        .where(eq(liveClasses.courseId, "community-feed"))
        .orderBy(desc(liveClasses.createdAt))
        .limit(20);
      return res.json(streams);
    } catch (error) {
      console.error("[LiveStreams] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get live streams" });
    }
  });

  // POST teacher goes live in the community feed
  app.post("/api/live-streams/go-live", async (req, res) => {
    try {
      const { teacherId, teacherName, title, streamUrl, avatar } = req.body;
      if (!teacherId || !teacherName || !title) {
        return res.status(400).json({ success: false, message: "teacherId, teacherName, title required" });
      }
      // End any existing live stream by this teacher first
      await db.update(liveClasses)
        .set({ status: "ended" })
        .where(
          and(
            eq(liveClasses.courseId, "community-feed"),
            eq(liveClasses.teacherId, teacherId),
            eq(liveClasses.status, "live")
          )
        );
      const [stream] = await db.insert(liveClasses).values({
        id: randomUUID(),
        courseId: "community-feed",
        teacherId,
        teacherName,
        title,
        description: avatar || "",
        scheduledAt: Date.now(),
        duration: 120,
        status: "live",
        meetingUrl: streamUrl || "",
        createdAt: Date.now(),
      }).returning();
      return res.json({ success: true, stream });
    } catch (error) {
      console.error("[LiveStreams] Go-live error:", error);
      return res.status(500).json({ success: false, message: "Failed to start live stream" });
    }
  });

  // PUT teacher ends their live stream
  app.put("/api/live-streams/:id/end", async (req, res) => {
    try {
      const [updated] = await db.update(liveClasses)
        .set({ status: "ended" })
        .where(eq(liveClasses.id, req.params.id))
        .returning();
      return res.json({ success: true, stream: updated });
    } catch (error) {
      console.error("[LiveStreams] End error:", error);
      return res.status(500).json({ success: false, message: "Failed to end live stream" });
    }
  });

  // ========== Live Polls & Quizzes routes ==========
  app.get("/api/live-classes/:classId/polls", async (req, res) => {
    try {
      const { classId } = req.params;
      const { userId } = req.query;
      const polls = await db.select().from(livePolls)
        .where(eq(livePolls.classId, classId))
        .orderBy(desc(livePolls.createdAt));

      const pollIds = polls.map(p => p.id);
      let votesByPoll: Record<string, number[]> = {};
      let userVotes: Record<string, number> = {};

      if (pollIds.length > 0) {
        for (const pollId of pollIds) {
          const votes = await db.select().from(livePollVotes).where(eq(livePollVotes.pollId, pollId));
          const options = JSON.parse(polls.find(p => p.id === pollId)?.options || '[]');
          const counts = new Array(options.length).fill(0);
          for (const v of votes) {
            if (v.optionIndex >= 0 && v.optionIndex < counts.length) counts[v.optionIndex]++;
          }
          votesByPoll[pollId] = counts;
          if (userId) {
            const myVote = votes.find(v => v.userId === userId);
            if (myVote) userVotes[pollId] = myVote.optionIndex;
          }
        }
      }

      const result = polls.map(p => ({
        ...p,
        options: JSON.parse(p.options),
        voteCounts: votesByPoll[p.id] || [],
        myVote: userVotes[p.id] ?? null,
      }));

      return res.json(result);
    } catch (error) {
      console.error("[Polls] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get polls" });
    }
  });

  app.post("/api/live-classes/:classId/polls", async (req, res) => {
    try {
      const { classId } = req.params;
      const { courseId, teacherId, type, question, options, correctOption, timerSeconds } = req.body;
      if (!courseId || !teacherId || !question || !options || !Array.isArray(options) || options.length < 2) {
        return res.status(400).json({ success: false, message: "Question and at least 2 options are required" });
      }
      const [poll] = await db.insert(livePolls).values({
        id: randomUUID(),
        classId,
        courseId,
        teacherId,
        type: type || 'poll',
        question,
        options: JSON.stringify(options),
        correctOption: type === 'quiz' ? (correctOption ?? 0) : -1,
        status: 'active',
        timerSeconds: Number(timerSeconds) || 0,
        createdAt: Date.now(),
      }).returning();
      const result = { ...poll, options, voteCounts: new Array(options.length).fill(0), myVote: null };
      return res.json({ success: true, poll: result });
    } catch (error) {
      console.error("[Polls] Create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create poll" });
    }
  });

  app.post("/api/polls/:pollId/vote", async (req, res) => {
    try {
      const { pollId } = req.params;
      const { userId, optionIndex } = req.body;
      if (!userId || optionIndex === undefined) {
        return res.status(400).json({ success: false, message: "userId and optionIndex required" });
      }
      const [poll] = await db.select().from(livePolls).where(eq(livePolls.id, pollId));
      if (!poll) return res.status(404).json({ success: false, message: "Poll not found" });
      if (poll.status !== 'active') return res.status(400).json({ success: false, message: "Poll is closed" });

      const existing = await db.select().from(livePollVotes)
        .where(and(eq(livePollVotes.pollId, pollId), eq(livePollVotes.userId, userId)));
      if (existing.length > 0) {
        return res.status(400).json({ success: false, message: "Already voted" });
      }
      await db.insert(livePollVotes).values({
        id: randomUUID(),
        pollId,
        userId,
        optionIndex: Number(optionIndex),
        createdAt: Date.now(),
      });

      const allVotes = await db.select().from(livePollVotes).where(eq(livePollVotes.pollId, pollId));
      const options = JSON.parse(poll.options);
      const counts = new Array(options.length).fill(0);
      for (const v of allVotes) {
        if (v.optionIndex >= 0 && v.optionIndex < counts.length) counts[v.optionIndex]++;
      }
      return res.json({ success: true, voteCounts: counts });
    } catch (error) {
      console.error("[Polls] Vote error:", error);
      return res.status(500).json({ success: false, message: "Failed to vote" });
    }
  });

  app.patch("/api/polls/:pollId/close", async (req, res) => {
    try {
      const { pollId } = req.params;
      const { teacherId } = req.body;
      const [poll] = await db.select().from(livePolls).where(eq(livePolls.id, pollId));
      if (!poll) return res.status(404).json({ success: false, message: "Poll not found" });
      if (poll.teacherId !== teacherId) return res.status(403).json({ success: false, message: "Not authorized" });
      await db.update(livePolls).set({ status: 'closed' }).where(eq(livePolls.id, pollId));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Polls] Close error:", error);
      return res.status(500).json({ success: false, message: "Failed to close poll" });
    }
  });

  app.delete("/api/polls/:pollId", async (req, res) => {
    try {
      const { pollId } = req.params;
      const { teacherId } = req.body;
      const [poll] = await db.select().from(livePolls).where(eq(livePolls.id, pollId));
      if (!poll) return res.status(404).json({ success: false, message: "Poll not found" });
      if (poll.teacherId !== teacherId) return res.status(403).json({ success: false, message: "Not authorized" });
      await db.delete(livePollVotes).where(eq(livePollVotes.pollId, pollId));
      await db.delete(livePolls).where(eq(livePolls.id, pollId));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Polls] Delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete poll" });
    }
  });

  // ========== Course Students routes ==========
  app.get("/api/courses/:courseId/students", async (req, res) => {
    try {
      const { courseId } = req.params;
      const enrollments = await db.select().from(courseEnrollments)
        .where(eq(courseEnrollments.courseId, courseId))
        .orderBy(desc(courseEnrollments.createdAt));
      return res.json(enrollments);
    } catch (error) {
      console.error("[Students] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get students" });
    }
  });

  // ========== Course Notices routes ==========
  app.get("/api/courses/:courseId/notices", async (req, res) => {
    try {
      const { courseId } = req.params;
      const notices = await db.select().from(courseNotices)
        .where(eq(courseNotices.courseId, courseId))
        .orderBy(desc(courseNotices.createdAt));
      return res.json(notices);
    } catch (error) {
      console.error("[Notices] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to get notices" });
    }
  });

  app.post("/api/courses/:courseId/notices", async (req, res) => {
    try {
      const { courseId } = req.params;
      const { teacherId, teacherName, title, message } = req.body;
      const [notice] = await db.insert(courseNotices).values({
        id: randomUUID(),
        courseId,
        teacherId,
        teacherName,
        title,
        message: message || "",
        createdAt: Date.now(),
      }).returning();
      return res.json({ success: true, notice });
    } catch (error) {
      console.error("[Notices] Create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create notice" });
    }
  });

  app.delete("/api/notices/:id", async (req, res) => {
    try {
      await db.delete(courseNotices).where(eq(courseNotices.id, req.params.id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Notices] Delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete notice" });
    }
  });

  app.get("/api/ads", async (_req, res) => {
    try {
      const allAds = await db.select().from(ads).orderBy(ads.sortOrder);
      res.json(allAds);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch ads" });
    }
  });

  app.get("/api/ads/active", async (_req, res) => {
    try {
      const activeAds = await db.select().from(ads).where(eq(ads.isActive, 1)).orderBy(ads.sortOrder);
      res.json(activeAds);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch active ads" });
    }
  });

  app.post("/api/ads", upload.single("image"), async (req, res) => {
    try {
      const { title, description, videoUrl, linkUrl, sortOrder } = req.body;
      let imageUrl = req.body.imageUrl || "";
      if (req.file) {
        const ext = path.extname(req.file.originalname);
        const filename = `images/ad-${randomUUID()}${ext}`;
        imageUrl = await uploadToStorage(req.file.buffer, filename);
      }
      const [ad] = await db.insert(ads).values({
        id: randomUUID(),
        title: title || "",
        description: description || "",
        imageUrl,
        videoUrl: videoUrl || "",
        linkUrl: linkUrl || "",
        sortOrder: parseInt(sortOrder) || 0,
        createdAt: Date.now(),
      }).returning();
      res.json(ad);
    } catch (error) {
      console.error("Error creating ad:", error);
      res.status(500).json({ error: "Failed to create ad" });
    }
  });

  app.patch("/api/ads/:id", upload.single("image"), async (req, res) => {
    try {
      const { id } = req.params;
      const updates: any = {};
      if (req.body.title !== undefined) updates.title = req.body.title;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.videoUrl !== undefined) updates.videoUrl = req.body.videoUrl;
      if (req.body.linkUrl !== undefined) updates.linkUrl = req.body.linkUrl;
      if (req.body.isActive !== undefined) updates.isActive = parseInt(req.body.isActive);
      if (req.body.sortOrder !== undefined) updates.sortOrder = parseInt(req.body.sortOrder);
      if (req.file) {
        const ext = path.extname(req.file.originalname);
        const filename = `images/ad-${randomUUID()}${ext}`;
        updates.imageUrl = await uploadToStorage(req.file.buffer, filename);
      } else if (req.body.imageUrl !== undefined) {
        updates.imageUrl = req.body.imageUrl;
      }
      const [updated] = await db.update(ads).set(updates).where(eq(ads.id, id as string)).returning();
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update ad" });
    }
  });

  app.delete("/api/ads/:id", async (req, res) => {
    try {
      await db.delete(ads).where(eq(ads.id, req.params.id as string));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete ad" });
    }
  });


  // ─── Insurance / Pro Plan Settings ───────────────────────────────────────
  app.get('/api/settings/insurance', async (_req, res) => {
    try {
      const rows = await db.select().from(appSettings).where(
        sql`key IN ('insurance_plan_name','insurance_plan_price','insurance_plan_price_yearly','insurance_plan_price_monthly','insurance_repair_discount','insurance_plan_status','insurance_savings_text','insurance_plan_features','insurance_min_months','insurance_plan_tagline','insurance_button_text')`
      );
      const map: Record<string, string> = {};
      rows.forEach(r => { map[r.key] = r.value; });
      console.log('[Insurance Settings] DB values:', map);
      
      const yearlyPrice = parseInt(map['insurance_plan_price_yearly'] || map['insurance_plan_price'] || '1499', 10);
      const monthlyPrice = parseInt(map['insurance_plan_price_monthly'] || map['insurance_plan_price'] || '249', 10);
      const featuresRaw = map['insurance_plan_features'] || 'Screen damage,Doorstep service';
      const features = featuresRaw.split(',').map(f => f.trim()).filter(Boolean);
      console.log('[Insurance Settings] Returning:', { yearlyPrice, monthlyPrice });
      
      return res.json({
        success: true,
        settings: {
          planName: map['insurance_plan_name'] || 'Mobile Protection Plan',
          planTagline: map['insurance_plan_tagline'] || 'Protect Your Phone',
          protectionPlanPrice: parseInt(map['insurance_plan_price'] || '50', 10),
          yearlyPrice,
          monthlyPrice,
          minMonths: parseInt(map['insurance_min_months'] || '3', 10),
          repairDiscount: parseInt(map['insurance_repair_discount'] || '500', 10),
          savingsText: map['insurance_savings_text'] || 'Save up to ₹4000 on repairs',
          features,
          buttonText: map['insurance_button_text'] || 'Get Protection',
          status: (map['insurance_plan_status'] || 'active') as 'active' | 'disabled',
        }
      });
    } catch (err) {
      console.error('[Insurance Settings] Get error:', err);
      return res.status(500).json({ success: false, message: 'Failed to fetch insurance settings' });
    }
  });

  app.put('/api/admin/settings/insurance', async (req, res) => {
    try {
      const { planName, planTagline, protectionPlanPrice, yearlyPrice, monthlyPrice, minMonths, repairDiscount, savingsText, features, buttonText, status } = req.body;
      console.log('[Insurance Settings] Saving:', { planName, planTagline, yearlyPrice, monthlyPrice, minMonths, savingsText, features, buttonText, status });
      
      const saveSetting = async (key: string, value: string) => {
        const now = Date.now();
        await db.execute(sql`
          INSERT INTO app_settings (id, key, value, updated_at)
          VALUES (gen_random_uuid(), ${key}, ${value}, ${now})
          ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = ${now}
        `);
      };
      
      if (planName !== undefined) await saveSetting('insurance_plan_name', String(planName));
      if (planTagline !== undefined) await saveSetting('insurance_plan_tagline', String(planTagline));
      if (protectionPlanPrice !== undefined) await saveSetting('insurance_plan_price', String(protectionPlanPrice));
      if (yearlyPrice !== undefined) await saveSetting('insurance_plan_price_yearly', String(yearlyPrice));
      if (monthlyPrice !== undefined) await saveSetting('insurance_plan_price_monthly', String(monthlyPrice));
      if (minMonths !== undefined) await saveSetting('insurance_min_months', String(minMonths));
      if (repairDiscount !== undefined) await saveSetting('insurance_repair_discount', String(repairDiscount));
      if (savingsText !== undefined) await saveSetting('insurance_savings_text', String(savingsText));
      if (features !== undefined) {
        const featStr = Array.isArray(features) ? features.join(',') : String(features);
        await saveSetting('insurance_plan_features', featStr);
      }
      if (buttonText !== undefined) await saveSetting('insurance_button_text', String(buttonText));
      if (status !== undefined) await saveSetting('insurance_plan_status', String(status));
      
      return res.json({ success: true });
    } catch (err) {
      console.error('[Insurance Settings] Update error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update insurance settings' });
    }
  });

  app.get('/api/admin/links', async (_req, res) => {
    try {
      const links = await db.select().from(appSettings).where(
        sql`key IN ('upload_video_link', 'learn_link', 'whatsapp_support_link', 'email_support_link')`
      );
      const result: Record<string, string> = {};
      links.forEach(s => { result[s.key] = s.value; });
      return res.json(result);
    } catch (err) {
      console.error('[Admin Links] Get error:', err);
      return res.status(500).json({ error: 'Failed to fetch links' });
    }
  });

  app.put('/api/admin/links', async (req, res) => {
    try {
      const { upload_video_link, learn_link, whatsapp_support_link, email_support_link } = req.body;
      
      const saveSetting = async (key: string, value: string) => {
        const now = Date.now();
        await db.execute(sql`
          INSERT INTO app_settings (id, key, value, updated_at)
          VALUES (gen_random_uuid(), ${key}, ${value}, ${now})
          ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = ${now}
        `);
      };
      
      if (upload_video_link !== undefined) await saveSetting('upload_video_link', String(upload_video_link));
      if (learn_link !== undefined) await saveSetting('learn_link', String(learn_link));
      if (whatsapp_support_link !== undefined) await saveSetting('whatsapp_support_link', String(whatsapp_support_link));
      if (email_support_link !== undefined) await saveSetting('email_support_link', String(email_support_link));
      
      return res.json({ success: true });
    } catch (err) {
      console.error('[Admin Links] Update error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update links' });
    }
  });

  app.get('/api/app-settings', async (_req, res) => {
    try {
      const settings = await db.select().from(appSettings);
      const result: Record<string, string> = {};
      settings.forEach(s => { result[s.key] = s.value; });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  app.get('/api/app-settings/:key', async (req, res) => {
    try {
      const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, req.params.key));
      res.json({ value: setting?.value || '' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch setting' });
    }
  });

  app.put('/api/app-settings/:key', async (req, res) => {
    try {
      const { value } = req.body;
      const key = req.params.key;
      const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key));
      if (existing) {
        await db.update(appSettings).set({ value: value || '', updatedAt: Date.now() }).where(eq(appSettings.key, key));
      } else {
        await db.insert(appSettings).values({ key, value: value || '', updatedAt: Date.now() });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update setting' });
    }
  });

  // Alias routes used by user-profile screen
  app.get('/api/settings/:key', async (req, res) => {
    try {
      const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, req.params.key));
      res.json({ value: setting?.value || '' });
    } catch {
      res.status(500).json({ error: 'Failed to fetch setting' });
    }
  });

  app.post('/api/settings', async (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key) return res.status(400).json({ error: 'key required' });
      const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key));
      if (existing) {
        await db.update(appSettings).set({ value: value || '', updatedAt: Date.now() }).where(eq(appSettings.key, key));
      } else {
        await db.insert(appSettings).values({ key, value: value || '', updatedAt: Date.now() });
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to update setting' });
    }
  });

  // ========== Device Change Payment ==========
  app.post("/api/device-change/create-order", async (req, res) => {
    try {
      const { phone, deviceId } = req.body;
      if (!phone || !deviceId) {
        return res.status(400).json({ success: false, message: "Phone and deviceId required" });
      }
      const cleanPhone = phone.replace(/\D/g, "");
      
      const priceSettings = await db.select().from(appSettings).where(eq(appSettings.key, "device_lock_price"));
      const price = priceSettings.length > 0 ? parseInt(priceSettings[0].value) || 100 : 100;

      const Razorpay = (await import("razorpay")).default;
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID || "",
        key_secret: process.env.RAZORPAY_KEY_SECRET || "",
      });

      const order = await razorpay.orders.create({
        amount: price * 100,
        currency: "INR",
        receipt: `device_change_${cleanPhone}_${Date.now()}`,
        notes: { phone: cleanPhone, deviceId, type: "device_change" },
      });

      return res.json({ success: true, orderId: order.id, amount: price, currency: "INR" });
    } catch (error) {
      console.error("[DeviceChange] Create order error:", error);
      return res.status(500).json({ success: false, message: "Failed to create payment order" });
    }
  });

  app.post("/api/device-change/verify-payment", async (req, res) => {
    try {
      const { phone, deviceId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
      if (!phone || !deviceId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return res.status(400).json({ success: false, message: "Missing payment details" });
      }
      
      const crypto = await import("crypto");
      const expectedSignature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest("hex");
      
      if (expectedSignature !== razorpaySignature) {
        return res.status(400).json({ success: false, message: "Payment verification failed" });
      }

      const cleanPhone = phone.replace(/\D/g, "");
      const allProfilesList = await db.select().from(profiles);
      // Prioritize admin role if multiple profiles exist
      let existingProfile = allProfilesList.find(p => p.phone.replace(/\D/g, "") === cleanPhone && p.role === 'admin');
      if (!existingProfile) {
        existingProfile = allProfilesList.find(p => p.phone.replace(/\D/g, "") === cleanPhone);
      }
      
      if (!existingProfile) {
        return res.status(404).json({ success: false, message: "Profile not found" });
      }

      await db.update(profiles).set({
        deviceId: deviceId,
        deviceChangeCount: (existingProfile.deviceChangeCount || 0) + 1,
      }).where(eq(profiles.id, existingProfile.id));

      const sessionToken = randomUUID();
      await db.delete(sessions).where(eq(sessions.phone, cleanPhone));
      await db.insert(sessions).values({ phone: cleanPhone, sessionToken });

      let skillsArray = [];
      try {
        skillsArray = existingProfile.skills ? JSON.parse(existingProfile.skills) : [];
      } catch (e) {
        skillsArray = [];
      }
      return res.json({
        success: true,
        message: "Device changed successfully",
        sessionToken,
        profile: { ...existingProfile, deviceId, skills: skillsArray },
      });
    } catch (error) {
      console.error("[DeviceChange] Verify payment error:", error);
      return res.status(500).json({ success: false, message: "Payment verification failed" });
    }
  });

  app.post("/api/admin/reset-device", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ success: false, message: "userId required" });
      
      await db.update(profiles).set({ deviceId: "", deviceChangeCount: 0 }).where(eq(profiles.id, userId));
      return res.json({ success: true, message: "Device reset successfully" });
    } catch (error) {
      console.error("[Admin] Reset device error:", error);
      return res.status(500).json({ success: false, message: "Failed to reset device" });
    }
  });

  app.get("/api/admin/export-users", async (_req, res) => {
    try {
      const allProfiles = await db.select().from(profiles).orderBy(profiles.createdAt);
      const rows = [[
        'Name', 
        'Phone', 
        'Role', 
        'City', 
        'State',
        'Shop Name',
        'Shop Address',
        'Experience',
        'GST Number',
        'Aadhaar',
        'PAN',
        'Registered', 
        'Blocked', 
        'Subscription Active',
        'Subscription End',
        'Device ID',
        'Joined Date',
        'Joined Time'
      ]];
      
      allProfiles.forEach(u => {
        const createdAt = u.createdAt ? new Date(u.createdAt) : null;
        const subEnd = u.subscriptionEnd ? new Date(u.subscriptionEnd) : null;
        
        rows.push([
          u.name || '',
          u.phone || '',
          u.role || '',
          u.city || '',
          u.state || '',
          u.shopName || '',
          u.shopAddress || '',
          u.experience || '',
          u.gstNumber || '',
          u.aadhaarNumber || '',
          u.panNumber || '',
          u.subscriptionActive ? 'Yes' : 'No',
          u.blocked ? 'Yes' : 'No',
          u.subscriptionActive ? 'Active' : 'Inactive',
          subEnd ? subEnd.toISOString().slice(0, 10) : 'N/A',
          u.deviceId || '',
          createdAt ? createdAt.toISOString().slice(0, 10) : '',
          createdAt ? createdAt.toLocaleTimeString('en-IN', { hour12: false }) : '',
        ]);
      });
      const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const filename = `mobi-users-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (error) {
      console.error("[Admin] Export users error:", error);
      return res.status(500).json({ success: false, message: "Export failed" });
    }
  });

  // ── USER: Delete own account ────────────────────────────────────────────
  app.post("/api/user/delete-account", async (req, res) => {
    try {
      const userId = req.header("x-user-id") || (req.body as any).userId;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      // Delete user's posts
      await db.delete(posts).where(eq(posts.userId, userId));
      // Delete user profile
      await db.delete(profiles).where(eq(profiles.id, userId));
      
      return res.json({ success: true, message: "Account deleted successfully" });
    } catch (error) {
      console.error("[User] Delete account error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete account" });
    }
  });

  // ── USER: Block another user ────────────────────────────────────────────
  app.post("/api/user/block-user", async (req, res) => {
    try {
      const userId = req.header("x-user-id") || (req.body as any).currentUserId;
      const { targetUserId } = req.body;
      
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (!targetUserId) return res.status(400).json({ success: false, message: "targetUserId required" });
      
      // Check if blocked users list exists
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId));
      if (!profile) return res.status(404).json({ success: false, message: "User not found" });
      
      const blockedList = profile.blockedUsers ? JSON.parse(String(profile.blockedUsers)) : [];
      if (!blockedList.includes(targetUserId)) {
        blockedList.push(targetUserId);
        await db.update(profiles).set({ blockedUsers: JSON.stringify(blockedList) }).where(eq(profiles.id, userId));
      }
      
      return res.json({ success: true, message: "User blocked successfully" });
    } catch (error) {
      console.error("[User] Block user error:", error);
      return res.status(500).json({ success: false, message: "Failed to block user" });
    }
  });

  // ── USER: Unblock a user ────────────────────────────────────────────
  app.post("/api/user/unblock-user", async (req, res) => {
    try {
      const userId = req.header("x-user-id") || (req.body as any).currentUserId;
      const { targetUserId } = req.body;
      
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (!targetUserId) return res.status(400).json({ success: false, message: "targetUserId required" });
      
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId));
      if (!profile) return res.status(404).json({ success: false, message: "User not found" });
      
      const blockedList = profile.blockedUsers ? JSON.parse(String(profile.blockedUsers)) : [];
      const index = blockedList.indexOf(targetUserId);
      if (index > -1) {
        blockedList.splice(index, 1);
        await db.update(profiles).set({ blockedUsers: JSON.stringify(blockedList) }).where(eq(profiles.id, userId));
      }
      
      return res.json({ success: true, message: "User unblocked successfully" });
    } catch (error) {
      console.error("[User] Unblock user error:", error);
      return res.status(500).json({ success: false, message: "Failed to unblock user" });
    }
  });

  app.post("/api/admin/unblock-user", adminMiddleware, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ success: false, message: "userId required" });
      await db.update(profiles).set({ blocked: 0 }).where(eq(profiles.id, userId));
      return res.json({ success: true, message: "User unlocked" });
    } catch (error) {
      console.error("[Admin] Unblock user error:", error);
      return res.status(500).json({ success: false, message: "Failed to unlock user" });
    }
  });

  app.post("/api/admin/block-user", adminMiddleware, async (req, res) => {
    try {
      const { userId, blocked } = req.body;
      if (!userId) return res.status(400).json({ success: false, message: "userId required" });
      console.log(`[Admin] ${blocked ? 'Blocking' : 'Unblocking'} user: ${userId}`);
      
      if (blocked) {
        // Soft block - set blocked_at timestamp
        await db.execute(sql`UPDATE profiles SET blocked_at = NOW() WHERE id = ${userId}`);
      } else {
        // Unblock - clear blocked_at
        await db.execute(sql`UPDATE profiles SET blocked_at = NULL WHERE id = ${userId}`);
      }
      
      console.log(`[Admin] User ${userId} ${blocked ? 'blocked' : 'unblocked'}`);
      return res.json({ success: true, message: blocked ? "User blocked" : "User unblocked" });
    } catch (error) {
      console.error("[Admin] Block user error:", error);
      return res.status(500).json({ success: false, message: "Failed to update user block status" });
    }
  });

  app.post("/api/admin/delete-user", adminMiddleware, async (req, res) => {
    try {
      const { userId } = req.body;
      console.log("[Admin Delete] Request received:", { userId });
      
      if (!userId) {
        return res.status(400).json({ success: false, message: "userId required" });
      }

      // Get user info
      const userRows = await db.execute(sql`SELECT phone, name FROM profiles WHERE id = ${userId}`);
      const userRow = (userRows as any).rows?.[0] || (Array.isArray(userRows) ? userRows[0] : null);
      
      if (!userRow) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      
      console.log("[Admin Delete] Soft-deleting user:", { userId, name: userRow.name });
      
      // Soft delete - mark user as deleted with timestamp
      await db.execute(sql`UPDATE profiles SET deleted_at = NOW() WHERE id = ${userId}`);
      console.log("[Admin Delete] ✅ User marked as deleted:", userId);
      
      return res.json({ success: true, message: "User deleted successfully", userId });
    } catch (error) {
      console.error("[Admin Delete] ❌ Error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete user", error: (error as any).message });
    }
  });

  app.get("/api/admin/deleted-users", adminMiddleware, async (_req, res) => {
    try {
      const deletedUsers = await db.execute(sql`SELECT * FROM profiles WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`);
      const rows = (deletedUsers as any).rows || (Array.isArray(deletedUsers) ? deletedUsers : []);
      return res.json(rows);
    } catch (error) {
      console.error("[Admin] Get deleted users error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch deleted users" });
    }
  });

  app.get("/api/admin/blocked-users", adminMiddleware, async (_req, res) => {
    try {
      const blockedUsers = await db.execute(sql`SELECT * FROM profiles WHERE blocked_at IS NOT NULL ORDER BY blocked_at DESC`);
      const rows = (blockedUsers as any).rows || (Array.isArray(blockedUsers) ? blockedUsers : []);
      return res.json(rows);
    } catch (error) {
      console.error("[Admin] Get blocked users error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch blocked users" });
    }
  });

  // Permanently delete a user from deleted users
  app.post("/api/admin/permanently-delete-user", adminMiddleware, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, message: "userId required" });
      }

      console.log("[Admin Permanent Delete] Permanently deleting user:", userId);
      
      // Hard delete from profiles
      await db.execute(sql`DELETE FROM profiles WHERE id = ${userId}`);
      
      console.log("[Admin Permanent Delete] ✅ User permanently deleted:", userId);
      return res.json({ success: true, message: "User permanently deleted" });
    } catch (error) {
      console.error("[Admin Permanent Delete] ❌ Error:", error);
      return res.status(500).json({ success: false, message: "Failed to permanently delete user" });
    }
  });

  // Restore a deleted user
  app.post("/api/admin/restore-user", adminMiddleware, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, message: "userId required" });
      }

      console.log("[Admin Restore] Restoring user:", userId);
      
      // Clear deleted_at timestamp
      await db.execute(sql`UPDATE profiles SET deleted_at = NULL WHERE id = ${userId}`);
      
      console.log("[Admin Restore] ✅ User restored:", userId);
      return res.json({ success: true, message: "User restored successfully" });
    } catch (error) {
      console.error("[Admin Restore] ❌ Error:", error);
      return res.status(500).json({ success: false, message: "Failed to restore user" });
    }
  });

  // Unblock a user (clear blocked_at)
  app.post("/api/admin/unblock-user-restore", adminMiddleware, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, message: "userId required" });
      }

      console.log("[Admin Unblock] Unblocking user:", userId);
      
      // Clear blocked_at timestamp
      await db.execute(sql`UPDATE profiles SET blocked_at = NULL WHERE id = ${userId}`);
      
      console.log("[Admin Unblock] ✅ User unblocked:", userId);
      return res.json({ success: true, message: "User unblocked successfully" });
    } catch (error) {
      console.error("[Admin Unblock] ❌ Error:", error);
      return res.status(500).json({ success: false, message: "Failed to unblock user" });
    }
  });

  app.post("/api/admin/seed-suppliers", adminMiddleware, async (req, res) => {
    try {
      const testSuppliers = [
        { name: "Raj Mobile Parts", phone: "9911001001", city: "Delhi", state: "Delhi", shopName: "Raj Mobile Parts Store", shopAddress: "Nehru Place, New Delhi", sellType: "Spare Parts", skills: ["iPhone Parts", "Samsung Parts", "Screen Replacement", "Battery"], gstNumber: "07AABCU9603R1ZP" },
        { name: "Chennai Spare Hub", phone: "9922002002", city: "Chennai", state: "Tamil Nadu", shopName: "Chennai Spare Hub", shopAddress: "Richie Street, Chennai", sellType: "Spare Parts", skills: ["All Brands", "OEM Parts", "Tools", "Accessories"] },
        { name: "Mumbai Tech Supplies", phone: "9933003003", city: "Mumbai", state: "Maharashtra", shopName: "Mumbai Tech Supplies", shopAddress: "Lamington Road, Mumbai", sellType: "Accessories", skills: ["Chargers", "Cables", "Cases", "Screen Guards"] },
        { name: "Hyderabad Electronics", phone: "9944004004", city: "Hyderabad", state: "Telangana", shopName: "Hyderabad Electronics", shopAddress: "Abids, Hyderabad", sellType: "Tools", skills: ["Repair Tools", "Soldering", "BGA Tools", "Test Equipment"] },
        { name: "Bangalore Spare World", phone: "9955005005", city: "Bangalore", state: "Karnataka", shopName: "Bangalore Spare World", shopAddress: "SP Road, Bangalore", sellType: "Spare Parts", skills: ["Motherboard Repair", "IC Chips", "Components", "Flex Cables"] },
        { name: "Kolkata Mobile Zone", phone: "9966006006", city: "Kolkata", state: "West Bengal", shopName: "Kolkata Mobile Zone", shopAddress: "Chandni Chowk, Kolkata", sellType: "Spare Parts", skills: ["Nokia", "Samsung", "Oppo", "Vivo Parts"] },
        { name: "Pune Parts Palace", phone: "9977007007", city: "Pune", state: "Maharashtra", shopName: "Pune Parts Palace", shopAddress: "FC Road, Pune", sellType: "Accessories", skills: ["Back Panels", "Frames", "Batteries", "Charging Ports"] },
        { name: "Jaipur Tech Trader", phone: "9988008008", city: "Jaipur", state: "Rajasthan", shopName: "Jaipur Tech Trader", shopAddress: "MI Road, Jaipur", sellType: "Spare Parts", skills: ["Apple Parts", "Chinese Brand Parts", "Refurbished Screens"] },
        { name: "Ahmedabad Spares Co", phone: "9999009009", city: "Ahmedabad", state: "Gujarat", shopName: "Ahmedabad Spares Co", shopAddress: "Raipur Gate, Ahmedabad", sellType: "Tools", skills: ["Hot Air Guns", "Ultrasonic Cleaners", "Power Supplies", "Microscopes"] },
        { name: "Lucknow Mobile Mart", phone: "9800100200", city: "Lucknow", state: "Uttar Pradesh", shopName: "Lucknow Mobile Mart", shopAddress: "Aminabad, Lucknow", sellType: "Spare Parts", skills: ["All Models", "Bulk Orders", "OEM Screens", "Camera Modules"] },
      ];
      let created = 0;
      let skipped = 0;
      for (const sup of testSuppliers) {
        const existing = await db.select().from(profiles).where(eq(profiles.phone, sup.phone));
        if (existing.length > 0) { skipped++; continue; }
        const newId = "supplier-seed-" + randomUUID();
        await db.insert(profiles).values({
          id: newId,
          name: sup.name,
          phone: sup.phone,
          role: "supplier",
          city: sup.city,
          state: sup.state,
          shopName: sup.shopName,
          shopAddress: sup.shopAddress,
          sellType: sup.sellType,
          skills: JSON.stringify(sup.skills),
          gstNumber: (sup as any).gstNumber || "",
          createdAt: Date.now() - Math.floor(Math.random() * 30 * 24 * 3600 * 1000),
          verified: 1,
        } as any);
        created++;
      }
      return res.json({ success: true, created, skipped, message: `Seeded ${created} suppliers (${skipped} already existed)` });
    } catch (error) {
      console.error("[Admin] Seed suppliers error:", error);
      return res.status(500).json({ success: false, message: "Failed to seed suppliers" });
    }
  });

  app.delete("/api/admin/products/:id", adminMiddleware, async (req, res) => {
    try {
      await db.delete(products).where(eq(products.id, req.params.id));
      return res.json({ success: true, message: "Product deleted" });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to delete product" });
    }
  });

  app.delete("/api/admin/posts/:id", adminMiddleware, async (req, res) => {
    try {
      await db.delete(posts).where(eq(posts.id, req.params.id));
      return res.json({ success: true, message: "Post deleted" });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to delete post" });
    }
  });

  app.get("/api/device-change/checkout", (req, res) => {
    const { orderId, amount, phone, deviceId } = req.query;
    
    const baseUrl = process.env.APP_DOMAIN || apiPublicBase();
    const keyId = process.env.RAZORPAY_KEY_ID || '';

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Device Change Payment - Mobi</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0D0D0D; color: #fff; min-height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 20px;
    }
    .container { text-align: center; max-width: 400px; width: 100%; }
    .logo { font-size: 28px; font-weight: 800; color: #FF6B35; margin-bottom: 24px; }
    .title { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    .subtitle { color: #999; font-size: 14px; margin-bottom: 24px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    .amount { font-size: 36px; font-weight: 700; color: #FF6B35; margin-bottom: 32px; }
    .amount span { font-size: 18px; color: #999; }
    .pay-btn {
      background: #FF6B35; color: #fff; border: none; padding: 16px 48px;
      font-size: 18px; font-weight: 700; border-radius: 12px; cursor: pointer;
      width: 100%; transition: opacity 0.2s;
    }
    .pay-btn:hover { opacity: 0.9; }
    .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 24px; font-size: 14px; color: #999; }
    .success { color: #4CAF50; font-size: 18px; font-weight: 600; }
    .failed { color: #F44336; font-size: 18px; font-weight: 600; }
    .spinner { width: 40px; height: 40px; border: 4px solid #333; border-top: 4px solid #FF6B35;
      border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .secure { display: flex; align-items: center; justify-content: center; gap: 6px;
      margin-top: 16px; color: #666; font-size: 12px; }
    .info { background: #1A1A1A; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: left; }
    .info-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .info-label { color: #999; font-size: 13px; }
    .info-value { color: #fff; font-size: 13px; font-weight: 500; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Mobi</div>
    <div class="icon">&#128274;</div>
    <div class="title">Device Change</div>
    <div class="subtitle">One-time payment to login from a new device</div>
    <div class="info">
      <div class="info-row"><span class="info-label">Phone</span><span class="info-value">+91 ${phone || ''}</span></div>
      <div class="info-row"><span class="info-label">Purpose</span><span class="info-value">Device Change Fee</span></div>
    </div>
    <div class="amount">&#8377;${((parseInt(amount as string) || 0) / 100).toLocaleString('en-IN')} <span>INR</span></div>
    <button class="pay-btn" id="payBtn" onclick="startPayment()">Pay Now</button>
    <div class="status" id="status"></div>
    <div class="secure">&#128274; Secured by Razorpay</div>
  </div>
  <script>
    var paymentDone = false;
    function startPayment() {
      document.getElementById('payBtn').disabled = true;
      document.getElementById('status').innerHTML = '<div class="spinner"></div>Opening payment...';
      var options = {
        key: '${keyId}',
        amount: '${amount}',
        currency: 'INR',
        name: 'Mobi',
        description: 'Device Change Fee',
        order_id: '${orderId}',
        prefill: { contact: '${phone || ''}' },
        theme: { color: '#FF6B35' },
        handler: function(response) {
          paymentDone = true;
          document.getElementById('status').innerHTML = '<div class="spinner"></div>Verifying payment...';
          document.getElementById('payBtn').style.display = 'none';
          fetch('${baseUrl}/api/device-change/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: '${phone}',
              deviceId: '${deviceId}',
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            })
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.success) {
              document.getElementById('status').innerHTML = '<p class="success">&#10003; Device changed successfully!</p><p style="color:#999;margin-top:8px">You can now login from this device. Please go back and login again.</p>';
              try {
                if (window.parent && window.parent !== window) {
                  window.parent.postMessage(JSON.stringify({ type: 'device_payment_success', sessionToken: data.sessionToken, profile: data.profile }), '*');
                }
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'device_payment_success', sessionToken: data.sessionToken, profile: data.profile }));
                }
              } catch(e) {}
            } else {
              document.getElementById('status').innerHTML = '<p class="failed">&#10007; ' + (data.message || 'Payment verification failed') + '</p>';
              document.getElementById('payBtn').style.display = 'block';
              document.getElementById('payBtn').disabled = false;
            }
          })
          .catch(function() {
            document.getElementById('status').innerHTML = '<p class="failed">&#10007; Network error. Please try again.</p>';
            document.getElementById('payBtn').style.display = 'block';
            document.getElementById('payBtn').disabled = false;
          });
        },
        modal: {
          ondismiss: function() {
            if (!paymentDone) {
              document.getElementById('payBtn').disabled = false;
              document.getElementById('status').innerHTML = '<p style="color:#999">Payment cancelled. Try again when ready.</p>';
              try {
                if (window.parent && window.parent !== window) {
                  window.parent.postMessage(JSON.stringify({ type: 'device_payment_failed', message: 'Payment cancelled' }), '*');
                }
              } catch(e) {}
            }
          }
        }
      };
      var rzp = new Razorpay(options);
      rzp.open();
    }
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  // ========== Admin Revenue & Subscription Reports ==========
  app.get("/api/admin/revenue", async (_req, res) => {
    try {
      const allProfilesList = await db.select().from(profiles);
      const allPaymentsList = await db.select().from(payments);
      const allEnrollmentsList = await db.select().from(courseEnrollments);
      const allCoursesList = await db.select().from(courses);
      const allSubSettings = await db.select().from(subscriptionSettings);
      const now = Date.now();

      const activeSubscribers = allProfilesList.filter(p =>
        p.subscriptionActive === 1 && (p.subscriptionEnd || 0) > now
      );

      const capturedPayments = allPaymentsList.filter(p =>
        p.status === 'captured' || p.status === 'paid'
      );
      const totalCourseRevenue = capturedPayments.reduce((sum, p) => sum + (p.amount || 0), 0) / 100;

      const teacherRevenueMap: Record<string, { name: string; amount: number; enrollments: number; courseCount: number }> = {};
      capturedPayments.forEach(p => {
        if (!teacherRevenueMap[p.teacherId]) {
          teacherRevenueMap[p.teacherId] = { name: '', amount: 0, enrollments: 0, courseCount: 0 };
        }
        teacherRevenueMap[p.teacherId].amount += (p.amount || 0) / 100;
        teacherRevenueMap[p.teacherId].enrollments += 1;
      });
      allProfilesList.forEach(p => {
        if (teacherRevenueMap[p.id]) teacherRevenueMap[p.id].name = p.name;
      });
      allCoursesList.forEach(c => {
        if (teacherRevenueMap[c.teacherId]) teacherRevenueMap[c.teacherId].courseCount += 1;
      });

      const subRevByRole: Record<string, number> = { technician: 0, teacher: 0, supplier: 0 };
      activeSubscribers.forEach(p => {
        const setting = allSubSettings.find(s => s.role === p.role);
        if (setting && subRevByRole[p.role] !== undefined) {
          subRevByRole[p.role] += parseInt(setting.amount || '0');
        }
      });
      const totalSubRevenue = Object.values(subRevByRole).reduce((s, v) => s + v, 0);

      const commissionSettings = allSubSettings.find(s => s.role === 'teacher');
      const commissionPercent = parseFloat(commissionSettings?.commissionPercent || '30') / 100;
      const platformCourseRevenue = totalCourseRevenue * commissionPercent;

      res.json({
        success: true,
        activeSubscribers: activeSubscribers.length,
        activeSubscribersByRole: {
          technician: activeSubscribers.filter(p => p.role === 'technician').length,
          teacher: activeSubscribers.filter(p => p.role === 'teacher').length,
          supplier: activeSubscribers.filter(p => p.role === 'supplier').length,
        },
        subscriptionRevenue: totalSubRevenue,
        subscriptionRevenueByRole: subRevByRole,
        courseRevenue: totalCourseRevenue,
        platformCourseRevenue,
        totalRevenue: totalSubRevenue + platformCourseRevenue,
        totalEnrollments: allEnrollmentsList.filter(e => e.paymentStatus === 'paid').length,
        freeEnrollments: allEnrollmentsList.filter(e => e.paymentStatus === 'free').length,
        teacherRevenue: Object.entries(teacherRevenueMap)
          .map(([id, r]) => ({ teacherId: id, ...r }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 20),
        courseCount: allCoursesList.length,
        publishedCourses: allCoursesList.filter(c => c.isPublished === 1).length,
        totalPayments: capturedPayments.length,
        commissionPercent: commissionPercent * 100,
        totalAdminCommission: capturedPayments.reduce((s, p) => s + (p.adminCommission || 0), 0) / 100,
        totalTeacherEarnings: capturedPayments.reduce((s, p) => s + (p.teacherEarning || 0), 0) / 100,
      });
    } catch (error) {
      console.error("[Admin] Revenue error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch revenue" });
    }
  });

  app.get("/api/admin/active-subscriptions", async (_req, res) => {
    try {
      const allProfilesList = await db.select().from(profiles);
      const now = Date.now();
      const activeSubs = allProfilesList.filter(p =>
        p.subscriptionActive === 1 && (p.subscriptionEnd || 0) > now
      );
      res.json(activeSubs.map(p => ({
        id: p.id,
        name: p.name,
        phone: p.phone,
        role: p.role,
        avatar: p.avatar,
        city: p.city,
        subscriptionEnd: p.subscriptionEnd,
      })));
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to fetch subscriptions" });
    }
  });

  app.post("/api/admin/notify-all", adminMiddleware, async (req, res) => {
    try {
      const { title, body } = req.body;
      if (!title || !body) return res.status(400).json({ success: false, message: "Title and body required" });

      console.log('[OneSignal] Admin notify-all:', title);
      const sent = await notifyUsersByRole('all', { title, body, data: { type: 'admin_broadcast' } });
      console.log('[OneSignal] notify-all sent:', sent);

      res.json({ success: true, sent });
    } catch (error: any) {
      console.error("[Admin] Notify all error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to send notifications" });
    }
  });

  app.post("/api/admin/notify-role", adminMiddleware, async (req, res) => {
    try {
      const { title, body, role } = req.body;
      if (!title || !body) return res.status(400).json({ success: false, message: "Title and body required" });

      const targetRole = role || 'all';
      console.log('[OneSignal] Admin notify-role:', targetRole, title);

      // For role-targeted sends: query user IDs from DB and pass to notifyUsersByRole
      // OneSignal.login(userId) links userId as external_id — use include_aliases to target them
      let externalUserIds: string[] | undefined;
      if (targetRole !== 'all') {
        const roleUsers = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.role, targetRole));
        externalUserIds = roleUsers.map((u) => u.id);
        console.log(`[OneSignal] Role=${targetRole} found ${externalUserIds.length} users`);
      }

      const sent = await notifyUsersByRole(targetRole, { title, body, data: { type: 'admin_broadcast', role: targetRole } }, externalUserIds);
      console.log('[OneSignal] notify-role sent:', sent);

      res.json({ success: true, sent });
    } catch (error: any) {
      console.error("[Admin] Notify role error:", error);
      res.status(500).json({ success: false, message: error?.message || "Failed to send notifications" });
    }
  });

  app.post("/api/admin/send-sms", adminMiddleware, async (req, res) => {
    try {
      const { message } = req.body;
      
      if (!message?.trim()) {
        return res.status(400).json({ success: false, message: "Message required" });
      }

      const apiHomeKey = process.env.API_HOME_API_KEY;
      if (!apiHomeKey) {
        console.error('[Admin-SMS] API Home key not configured');
        return res.status(500).json({ success: false, message: "SMS service not configured" });
      }

      const adminPhone = '8179142535';
      console.log(`[Admin-SMS] Sending SMS to admin: ${adminPhone}`);
      
      // Send SMS via API Home
      // Extract digits from message or generate a test code
      const otpCode = message.replace(/\D/g, '').substring(0, 8) || '123456';
      
      // API Home endpoint: https://apihome.in/panel/api/bulksms/?key=KEY&mobile=MOBILE&otp=OTP
      const url = new URL('https://apihome.in/panel/api/bulksms/');
      url.searchParams.append('key', apiHomeKey);
      url.searchParams.append('mobile', adminPhone);
      url.searchParams.append('otp', otpCode);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json() as any;
      console.log(`[Admin-SMS] API Home response:`, data);

      if (!response.ok || (data.success !== true && data.status !== 'success' && data.status !== 1 && data.status !== 'Sent')) {
        const errorMsg = data.remark || data.message || data.error || 'Failed to send SMS';
        console.error(`[Admin-SMS] Failed:`, errorMsg);
        return res.status(500).json({ success: false, message: errorMsg });
      }

      console.log(`[Admin-SMS] ✓ SMS sent successfully`);
      return res.json({ 
        success: true, 
        message: `SMS sent to admin: ${adminPhone}`,
      });
    } catch (error: any) {
      console.error("[Admin-SMS] error:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to send SMS" });
    }
  });

  function buildMarketingEmailHtml(userName: string, subject: string, message: string, userEmail: string, appDomain: string) {
    const unsubscribeUrl = `${appDomain}/unsubscribe?email=${encodeURIComponent(userEmail)}`;
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:#FF6B35;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:26px;font-weight:700;letter-spacing:1px;">Mobi App</h1>
            <p style="color:#FFD0B5;margin:4px 0 0;font-size:13px;">Connecting Technicians, Teachers & Suppliers</p>
          </td>
        </tr>
        <tr>
          <td style="background:#fff;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e8e8e8;border-top:none;">
            <p style="color:#333;font-size:16px;margin:0 0 8px;">Hello ${userName || 'Mobi User'},</p>
            <h2 style="color:#FF6B35;font-size:22px;margin:0 0 20px;font-weight:700;">${subject}</h2>
            <div style="color:#555;font-size:15px;line-height:1.7;white-space:pre-line;">${message.replace(/\n/g, '<br/>')}</div>
            <div style="margin:28px 0;text-align:center;">
              <a href="https://play.google.com/store" style="background:#FF6B35;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Open Mobi App</a>
            </div>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
            <p style="font-size:12px;color:#aaa;margin:0;text-align:center;">
              You received this because you registered with Mobi App.<br/>
              <a href="${unsubscribeUrl}" style="color:#aaa;">Unsubscribe</a> from marketing emails.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  async function executeBulkEmailSend(campaignId: string, users: { email: string; name: string }[], subject: string, message: string, appDomain: string) {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY!);
    const BATCH_SIZE = 50;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (user) => {
          try {
            const html = buildMarketingEmailHtml(user.name, subject, message, user.email, appDomain);
            await resend.emails.send({
              from: "Mobi App <onboarding@resend.dev>",
              to: user.email.trim(),
              subject: subject.trim(),
              html,
            });
            sent++;
          } catch (err: any) {
            console.error(`[Email] Failed ${user.email}:`, err.message);
            failed++;
          }
        })
      );
      if (i + BATCH_SIZE < users.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    await db.update(emailCampaigns)
      .set({ sent, failed, status: 'sent', sentAt: Date.now() })
      .where(eq(emailCampaigns.id, campaignId));

    console.log(`[Email] Campaign ${campaignId} complete: sent=${sent}, failed=${failed}`);
    return { sent, failed };
  }

  app.get("/unsubscribe", async (req, res) => {
    const { email } = req.query as { email?: string };
    if (!email || !email.includes('@')) {
      return res.status(400).send('<h2>Invalid unsubscribe link.</h2>');
    }
    try {
      await db.update(profiles).set({ allowMarketing: 0 }).where(eq(profiles.email, email.trim()));
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;">
  <div style="text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 16px #0001;max-width:400px;">
    <div style="font-size:48px;margin-bottom:16px;">✅</div>
    <h2 style="color:#333;margin:0 0 12px;">Unsubscribed Successfully</h2>
    <p style="color:#666;margin:0;">You have been unsubscribed from Mobi App marketing emails.<br/>You will no longer receive promotional emails.</p>
  </div>
</body></html>`);
    } catch (err: any) {
      console.error("[Landing] Error:", err);
      res.status(500).send(`<h2>Something went wrong. Error: ${err?.message || 'Unknown error'}</h2>`);
    }
  });

  app.get("/api/admin/email-stats", async (req, res) => {
    try {
      const allProfiles = await db.select({
        email: profiles.email,
        allowMarketing: profiles.allowMarketing,
      }).from(profiles);

      const withEmail = allProfiles.filter(p => p.email && p.email.trim().includes('@'));
      const subscribed = withEmail.filter(p => p.allowMarketing !== 0);
      const unsubscribed = withEmail.filter(p => p.allowMarketing === 0);

      const campaigns = await db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt)).limit(20);

      res.json({
        success: true,
        stats: {
          totalWithEmail: withEmail.length,
          subscribed: subscribed.length,
          unsubscribed: unsubscribed.length,
        },
        campaigns,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/admin/send-email", async (req, res) => {
    try {
      const { subject, message, role, scheduledAt } = req.body;
      if (!subject?.trim()) return res.status(400).json({ success: false, message: "Subject required" });
      if (!message?.trim()) return res.status(400).json({ success: false, message: "Message required" });

      if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ success: false, message: "RESEND_API_KEY not configured. Add it in Replit Secrets." });
      }

      const appDomain = 'https://atozmobilerepair.in';

      let query = db.select({ email: profiles.email, name: profiles.name })
        .from(profiles)
        .where(eq(profiles.allowMarketing, 1));

      let userRows: { email: string | null; name: string }[];
      if (!role || role === 'all') {
        userRows = await db.select({ email: profiles.email, name: profiles.name }).from(profiles)
          .where(eq(profiles.allowMarketing, 1));
      } else if (role === 'paid') {
        userRows = await db.select({ email: profiles.email, name: profiles.name }).from(profiles)
          .where(and(eq(profiles.allowMarketing, 1), eq(profiles.subscriptionActive, 1)));
      } else {
        userRows = await db.select({ email: profiles.email, name: profiles.name }).from(profiles)
          .where(and(eq(profiles.allowMarketing, 1), eq(profiles.role, role)));
      }

      const validUsers = userRows.filter(r => r.email && r.email.trim().includes('@')) as { email: string; name: string }[];

      if (validUsers.length === 0) {
        return res.json({ success: true, sent: 0, failed: 0, total: 0, message: 'No subscribed email addresses found for this target' });
      }

      const campaignId = `camp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      if (scheduledAt && scheduledAt > Date.now()) {
        await db.insert(emailCampaigns).values({
          id: campaignId,
          subject: subject.trim(),
          message: message.trim(),
          targetRole: role || 'all',
          status: 'scheduled',
          total: validUsers.length,
          scheduledAt,
        });
        return res.json({ success: true, scheduled: true, campaignId, total: validUsers.length, message: `Campaign scheduled for ${new Date(scheduledAt).toLocaleString()}` });
      }

      await db.insert(emailCampaigns).values({
        id: campaignId,
        subject: subject.trim(),
        message: message.trim(),
        targetRole: role || 'all',
        status: 'sending',
        total: validUsers.length,
      });

      res.json({ success: true, sent: 0, total: validUsers.length, campaignId, message: `Sending to ${validUsers.length} users in batches...` });

      executeBulkEmailSend(campaignId, validUsers, subject.trim(), message.trim(), appDomain).catch(err => {
        console.error('[Email] Background send failed:', err);
      });
    } catch (error: any) {
      console.error("[Admin] send-email error:", error);
      res.status(500).json({ success: false, message: error.message || "Failed to send emails" });
    }
  });

  app.get("/api/admin/email-campaigns", async (req, res) => {
    try {
      const campaigns = await db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt)).limit(50);
      res.json({ success: true, campaigns });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.delete("/api/admin/email-campaigns/:id", async (req, res) => {
    try {
      await db.delete(emailCampaigns).where(eq(emailCampaigns.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  function normalizeFirestoreMsg(doc: any) {
    const data = typeof doc.data === 'function' ? doc.data() : doc;
    const docId = doc.id || data.id;
    let createdAt: number;
    if (typeof data.createdAt === 'number') {
      createdAt = data.createdAt;
    } else if (data.createdAt?._seconds != null) {
      createdAt = data.createdAt._seconds * 1000;
    } else if (data.createdAt?.seconds != null) {
      createdAt = data.createdAt.seconds * 1000;
    } else {
      createdAt = Date.now();
    }
    return { ...data, id: docId || data.id, createdAt };
  }

  app.get("/api/live-chat/messages", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const after = parseInt(req.query.after as string) || 0;
      const before = req.query.before ? parseInt(req.query.before as string) : 0;
      
      // Primary: Load from PostgreSQL (always available, especially on Cloud Run)
      let rows;
      if (after > 0) {
        rows = await db.select().from(liveChatMessages)
          .where(gt(liveChatMessages.createdAt, after))
          .orderBy(liveChatMessages.createdAt)
          .limit(limit);
      } else if (before > 0) {
        rows = await db.select().from(liveChatMessages)
          .where(lt(liveChatMessages.createdAt, before))
          .orderBy(desc(liveChatMessages.createdAt))
          .limit(limit);
        rows = rows.reverse();
      } else {
        rows = await db.select().from(liveChatMessages)
          .orderBy(desc(liveChatMessages.createdAt))
          .limit(limit);
        rows = rows.reverse();
      }
      
      return res.json(rows);
    } catch (error) {
      console.error("[API] Get live messages error:", error);
      return res.status(500).json({ error: "Failed to load messages" });
    }
  });

  app.post("/api/live-chat/messages", async (req, res) => {
    try {
      const { senderId, senderName, senderRole, senderAvatar, message, image, video } = req.body;
      if (!senderId) return res.status(400).json({ success: false, error: "senderId required" });
      if (!message && !image && !video) return res.status(400).json({ success: false, error: "message, image or video required" });
      
      const messageId = randomUUID();
      const msgData = {
        id: messageId,
        senderId,
        senderName: senderName || "",
        senderRole: senderRole || "",
        senderAvatar: senderAvatar || "",
        message: message || "",
        image: image || "",
        video: video || "",
        createdAt: Date.now(),
      };

      // Try Firestore, but fall back to database if it fails (Cloud Run)
      try {
        const firestore = getFirestore();
        await firestore.collection("live_chat_messages").doc(messageId).set(msgData);
      } catch (fbError: any) {
        console.warn("[LiveChat] Firestore unavailable, continuing with database only:", fbError?.message);
        // Firestore not available - continue with database storage
      }

      await db.insert(liveChatMessages).values(msgData);

      // Notify all users about the live chat message
      notifyLiveChat(msgData.senderName, msgData.message, senderId).catch(() => {});

      res.json({ success: true, message: msgData });
    } catch (error) {
      console.error("[API] Post live message error:", error);
      res.status(500).json({ success: false });
    }
  });


  // Admin redact a single live chat message
  app.delete("/api/live-chat/messages/:id", adminMiddleware, async (req, res) => {
    try {
      const { id } = req.params;

      const deletedText = "This message was deleted by Arun sir";
      await db.update(liveChatMessages)
        .set({ message: deletedText, image: "", video: "" })
        .where(eq(liveChatMessages.id, id));

      try {
        const firestore = getFirestore();
        await firestore.collection("live_chat_messages").doc(id).update({
          message: deletedText, image: "", video: ""
        });
      } catch (fsErr) {
        console.warn("[LiveChat] Firestore delete sync error:", fsErr);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[LiveChat] Delete single message error:", error);
      res.status(500).json({ success: false });
    }
  });

  app.delete("/api/live-chat/clear", adminMiddleware, async (req, res) => {
    try {
      // Clear from PostgreSQL
      await db.delete(liveChatMessages);
      // Clear from Firestore
      try {
        const firestore = getFirestore();
        const snapshot = await firestore.collection("live_chat_messages").limit(500).get();
        if (!snapshot.empty) {
          const batch = firestore.batch();
          snapshot.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
      } catch (fsErr) {
        console.warn("[Clear Chat] Firestore delete error:", fsErr);
      }
      return res.json({ success: true, message: "All chat messages cleared" });
    } catch (error) {
      console.error("[Clear Chat] Error:", error);
      return res.status(500).json({ success: false, message: "Failed to clear chat" });
    }
  });

  app.get("/api/community/stats", async (_req, res) => {
    try {
      const result = await db.select({ count: sql<number>`count(*)` }).from(profiles);
      res.json({ totalMembers: result[0]?.count || 0 });
    } catch (error) {
      res.status(500).json({ totalMembers: 0 });
    }
  });

  // ========== Teacher Live Sessions ==========
  app.get("/api/teacher/live-sessions", async (req, res) => {
    try {
      const sessions = await db.select().from(liveSessions)
        .where(eq(liveSessions.isLive, 1))
        .orderBy(desc(liveSessions.startedAt));
      return res.json({ success: true, sessions });
    } catch (error: any) {
      console.error("[Live] Fetch sessions error:", error?.message || error);
      return res.status(500).json({ success: false, sessions: [], message: error?.message });
    }
  });

  app.post("/api/teacher/go-live", async (req, res) => {
    try {
      const { teacherId, teacherName, teacherAvatar, title, description, platform, link, thumbnailUrl } = req.body;
      if (!teacherId || !link) {
        return res.status(400).json({ success: false, message: "teacherId and link are required" });
      }

      const finalTitle = (title || "Live Session").trim();
      const sessionId = randomUUID();
      const now = Date.now();

      // End any existing live session for this teacher first
      await db.update(liveSessions)
        .set({ isLive: 0, endedAt: now })
        .where(and(eq(liveSessions.teacherId, teacherId), eq(liveSessions.isLive, 1)));

      // Create new live session in database
      const newSession = await db.insert(liveSessions).values({
        id: sessionId,
        teacherId,
        teacherName: teacherName || "",
        teacherAvatar: teacherAvatar || "",
        title: finalTitle,
        description: description || "",
        platform: platform || "other",
        link,
        thumbnailUrl: thumbnailUrl || "",
        isLive: 1,
        startedAt: now,
        viewerCount: 0,
      }).returning();

      console.log(`[Live] Session saved to DB: ${sessionId}`);

      // Send push notification (non-blocking)
      try {
        const platformEmoji: Record<string, string> = {
          youtube: "▶️", zoom: "📹", meet: "🎥", other: "🔴"
        };
        const emoji = platformEmoji[platform] || "🔴";
        await notifyAllUsers({
          title: `${emoji} ${teacherName} is LIVE now!`,
          body: finalTitle,
          data: { type: 'teacher_live', sessionId, link, platform },
        }, teacherId);
      } catch (notifyErr: any) {
        console.error("[Live] Notify error (non-blocking):", notifyErr?.message || notifyErr);
      }

      console.log(`[Live] ${teacherName} went live: ${finalTitle}`);
      return res.json({ success: true, session: newSession?.[0] });
    } catch (error: any) {
      console.error("[Live] Go live error:", error?.message || error);
      return res.status(500).json({ success: false, message: error?.message || "Failed to save live session" });
    }
  });

  app.post("/api/teacher/end-live", async (req, res) => {
    try {
      const { teacherId, sessionId } = req.body;
      if (!teacherId) return res.status(400).json({ success: false, message: "teacherId required" });
      
      const now = Date.now();
      if (sessionId) {
        await db.update(liveSessions)
          .set({ isLive: 0, endedAt: now })
          .where(eq(liveSessions.id, sessionId));
      } else {
        await db.update(liveSessions)
          .set({ isLive: 0, endedAt: now })
          .where(and(eq(liveSessions.teacherId, teacherId), eq(liveSessions.isLive, 1)));
      }
      
      return res.json({ success: true });
    } catch (error: any) {
      console.error("[Live] End live error:", error?.message || error);
      return res.status(500).json({ success: false, message: "Failed to end live session" });
    }
  });

  // Camera streaming (RTMP)
  app.post("/api/teacher/camera-stream/start", async (req, res) => {
    try {
      const { teacherId, teacherName, teacherAvatar, title, description } = req.body;
      if (!teacherId || !title) {
        return res.status(400).json({ success: false, message: "teacherId and title required" });
      }
      const sessionId = randomUUID();
      const firestore = getFirestore();
      
      // End any existing camera streams by this teacher
      const existing = await firestore.collection("teacher_live_sessions")
        .where("teacherId", "==", teacherId)
        .where("isLive", "==", true)
        .get();
      for (const doc of existing.docs) {
        await doc.ref.update({ isLive: false, endedAt: Date.now() });
      }
      
      // Generate RTMP URL using Bunny Stream
      const rtmpUrl = `rtmp://live.bunnystream.io/live/${BUNNY_STREAM_LIBRARY_ID}?accessKey=${BUNNY_STREAM_API_KEY}`;
      
      const sessionData = {
        id: sessionId,
        teacherId,
        teacherName: teacherName || "",
        teacherAvatar: teacherAvatar || "",
        title,
        description: description || "",
        platform: "camera",
        link: rtmpUrl,
        isLive: true,
        startedAt: Date.now(),
        viewerCount: 0,
      };
      
      await firestore.collection("teacher_live_sessions").doc(sessionId).set(sessionData);
      
      // Notify all users
      await notifyAllUsers({
        title: `🎥 ${teacherName} is streaming LIVE now!`,
        body: title,
        data: { type: 'teacher_live', sessionId, link: rtmpUrl, platform: 'camera' },
      }, teacherId);
      
      console.log(`[CameraStream] ${teacherName} started camera stream: ${title}`);
      return res.json({ success: true, session: sessionData, rtmpUrl });
    } catch (error) {
      console.error("[CameraStream] Start error:", error);
      return res.status(500).json({ success: false, message: "Failed to start camera stream" });
    }
  });

  // Bunny Stream Live – create a live stream channel and return RTMP credentials
  app.post("/api/teacher/bunny-live/start", async (req, res) => {
    try {
      const { teacherId, teacherName, teacherAvatar, title, description } = req.body;
      if (!teacherId || !title) {
        return res.status(400).json({ success: false, message: "teacherId and title required" });
      }
      if (!bunnyStreamAvailable) {
        return res.status(503).json({ success: false, message: "Bunny Stream not configured" });
      }

      const firestore = getFirestore();

      // End any existing live sessions for this teacher
      const existing = await firestore.collection("teacher_live_sessions")
        .where("teacherId", "==", teacherId)
        .where("isLive", "==", true)
        .get();
      for (const doc of existing.docs) {
        // Also delete the Bunny live stream if it has a bunnyStreamId
        const docData = doc.data();
        if (docData.bunnyStreamId) {
          try {
            await fetch(
              `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/live-streams/${docData.bunnyStreamId}`,
              { method: 'DELETE', headers: { AccessKey: BUNNY_STREAM_API_KEY } }
            );
          } catch (delErr) {
            console.warn("[BunnyLive] Failed to delete old stream:", delErr);
          }
        }
        await doc.ref.update({ isLive: false, endedAt: Date.now() });
      }

      // Create a Bunny Stream live channel
      const createRes = await fetch(
        `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/live-streams`,
        {
          method: 'POST',
          headers: {
            'AccessKey': BUNNY_STREAM_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: title, record: false }),
        }
      );

      if (!createRes.ok) {
        const errTxt = await createRes.text();
        console.error(`[BunnyLive] Create live stream failed: ${createRes.status} ${errTxt}`);
        return res.status(502).json({ success: false, message: "Failed to create Bunny live stream" });
      }

      const bunnyData: any = await createRes.json();
      const streamKey  = bunnyData.streamKey || bunnyData.StreamKey || bunnyData.id;
      const bunnyId    = bunnyData.guid || bunnyData.id || streamKey;
      const rtmpUrl    = `rtmp://live.bunnynet.com/live/${streamKey}`;
      const embedUrl   = `https://iframe.mediadelivery.net/live/${BUNNY_STREAM_LIBRARY_ID}/${streamKey}`;

      const sessionId  = randomUUID();
      const sessionData = {
        id: sessionId,
        teacherId,
        teacherName: teacherName || "",
        teacherAvatar: teacherAvatar || "",
        title,
        description: description || "",
        platform: "bunny",
        link: embedUrl,
        streamKey,
        bunnyStreamId: bunnyId,
        rtmpUrl,
        isLive: true,
        startedAt: Date.now(),
        viewerCount: 0,
      };

      try {
        await firestore.collection("teacher_live_sessions").doc(sessionId).set(sessionData);
      } catch (firestoreErr: any) {
        console.warn("[BunnyLive] Firestore save warning (continuing):", firestoreErr?.message);
        // Continue even if Firestore fails - the session is still valid
      }

      // Notify all users (don't fail if notifications error)
      try {
        await notifyAllUsers({
          title: `🎥 ${teacherName} is LIVE now!`,
          body: title,
          data: { type: 'teacher_live', sessionId, link: embedUrl, platform: 'bunny' },
        }, teacherId);
      } catch (notifyErr: any) {
        console.warn("[BunnyLive] Notification error:", notifyErr?.message);
      }

      console.log(`[BunnyLive] ${teacherName} started: ${title}, streamKey=${streamKey}`);
      return res.json({ success: true, session: sessionData, rtmpUrl, streamKey, embedUrl });
    } catch (error: any) {
      console.error("[BunnyLive] Start error:", error?.message || error);
      return res.status(500).json({ success: false, message: error?.message || "Failed to start Bunny live stream" });
    }
  });

  // Bunny Stream Live – end a live stream and clean up Bunny channel
  app.post("/api/teacher/bunny-live/end", async (req, res) => {
    try {
      const { teacherId, sessionId } = req.body;
      if (!teacherId) return res.status(400).json({ success: false, message: "teacherId required" });
      const firestore = getFirestore();

      const query = sessionId
        ? [await firestore.collection("teacher_live_sessions").doc(sessionId).get()].filter(d => d.exists).map(d => ({ ref: d.ref, data: d.data() }))
        : (await firestore.collection("teacher_live_sessions")
            .where("teacherId", "==", teacherId)
            .where("isLive", "==", true)
            .get()).docs.map(d => ({ ref: d.ref, data: d.data() }));

      for (const { ref, data } of query) {
        if (data?.bunnyStreamId) {
          try {
            await fetch(
              `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/live-streams/${data.bunnyStreamId}`,
              { method: 'DELETE', headers: { AccessKey: BUNNY_STREAM_API_KEY } }
            );
          } catch {}
        }
        await ref.update({ isLive: false, endedAt: Date.now() });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error("[BunnyLive] End error:", error);
      return res.status(500).json({ success: false, message: "Failed to end live stream" });
    }
  });

  app.post("/api/teacher/live-session/upload-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        console.log("[Live Session Upload] No file in request");
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }
      const { sessionId, sessionLink, teacherName } = req.body;
      if (!sessionId) {
        console.log("[Live Session Upload] No sessionId in request body");
        return res.status(400).json({ success: false, message: "Session ID required" });
      }

      console.log(`[Live Session Upload] Received file: ${req.file.originalname}, size: ${req.file.buffer.length}, sessionId: ${sessionId}`);
      const filename = `images/${randomUUID()}${path.extname(req.file.originalname)}`;
      const url = await uploadToStorage(req.file.buffer, filename);
      
      // Storage returns absolute URL from Bunny CDN - use it as-is
      const absoluteUrl = url;

      // Build message text — include the join link so viewers can tap it
      const displayName = teacherName || "Teacher";
      const linkText = sessionLink ? `\nJoin Live: ${sessionLink}` : "";
      const messageText = `📸 ${displayName} shared a photo from the live session${linkText}`;

      // Add to live chat so all technicians/suppliers see it
      const messageId = randomUUID();
      const msgData = {
        id: messageId,
        senderId: "system",
        senderName: displayName,
        senderRole: "teacher",
        senderAvatar: "",
        message: messageText,
        image: absoluteUrl,
        video: "",
        createdAt: Date.now(),
      };

      try {
        const firestore = getFirestore();
        if (firestore) {
          try {
            await firestore.collection("live_chat_messages").doc(messageId).set(msgData);
            console.log("[Live Session Upload] Message added to Firestore live_chat_messages, id:", messageId);
          } catch (chatErr: any) {
            console.warn("[Live Session Upload] Firestore chat error (continuing):", chatErr?.message);
          }
          
          // Also update the live session document so Mobi Live card shows latest photo
          try {
            await firestore.collection("teacher_live_sessions").doc(sessionId).update({
              latestImage: absoluteUrl,
              latestImageAt: Date.now(),
            });
            console.log("[Live Session Upload] Updated teacher_live_sessions latestImage for:", sessionId);
          } catch (sessErr: any) {
            console.warn("[Live Session Upload] Could not update session latestImage:", sessErr?.message);
          }
        }
      } catch (firestoreErr: any) {
        console.warn("[Live Session Upload] Firestore error (continuing):", firestoreErr?.message);
      }

      res.json({ success: true, url: absoluteUrl });
    } catch (error) {
      console.error("[Live Session Upload] Error:", error);
      res.status(500).json({ success: false, message: "Upload failed" });
    }
  });

  app.post("/api/teacher/live-session/upload-thumbnail", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ success: false, message: "Session ID required" });
      }

      const filename = `images/${randomUUID()}${path.extname(req.file.originalname || '.jpg')}`;
      const url = await uploadToStorage(req.file.buffer, filename);

      // Storage returns absolute URL from Bunny CDN - use it as-is
      const absoluteUrl = url;

      console.log(`[Live Thumbnail] Uploaded for session ${sessionId}: ${absoluteUrl}`);

      const firestore = getFirestore();
      if (firestore) {
        try {
          await firestore.collection("teacher_live_sessions").doc(sessionId).update({
            thumbnailUrl: absoluteUrl,
          });
          console.log("[Live Thumbnail] Updated Firestore session thumbnailUrl for:", sessionId);
        } catch (sessErr) {
          console.warn("[Live Thumbnail] Could not update session thumbnailUrl:", sessErr);
        }
      }

      res.json({ success: true, url: absoluteUrl });
    } catch (error) {
      console.error("[Live Thumbnail] Error:", error);
      res.status(500).json({ success: false, message: "Thumbnail upload failed" });
    }
  });

  app.get("/api/admin/push-stats", adminMiddleware, async (req, res) => {
    try {
      // Use OneSignal's player count as the authoritative subscriber count
      const withToken = await getDeviceCount();
      const allProfilesList = await db.select({ role: profiles.role }).from(profiles).where(isNull(profiles.deleted_at));
      const total = allProfilesList.length;
      const byRole: Record<string, number> = {};
      allProfilesList.forEach(p => {
        byRole[p.role] = (byRole[p.role] || 0) + 1;
      });
      res.json({ total, withToken, byRole });
    } catch (error) {
      res.status(500).json({ success: false });
    }
  });

  // REST endpoint for admin to delete (redact) a live chat message
  app.post("/api/live-chat/delete-message", adminMiddleware, async (req, res) => {
    try {
      const { messageId } = req.body;
      if (!messageId) return res.status(400).json({ success: false, message: "messageId required" });

      const deletedText = "This message was deleted by Arun sir";
      await db.update(liveChatMessages)
        .set({ message: deletedText, image: "", video: "" })
        .where(eq(liveChatMessages.id, messageId));

      try {
        const firestore = getFirestore();
        await firestore.collection("live_chat_messages").doc(messageId).update({
          message: deletedText, image: "", video: ""
        });
      } catch (fsErr) {
        console.error("[LiveChat] Firestore delete sync error:", fsErr);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[LiveChat] Delete message error:", error);
      res.status(500).json({ success: false });
    }
  });

  // ─── Security Check Endpoint ───
  app.post("/api/security/check", async (req, res) => {
    // Security check disabled - all accounts have full access
    res.json({ success: true, status: 'ok', supportNumber: '+918179142535', whatsappLink: 'https://wa.me/918179142535' });
  });

  // ─── Admin: Get lock notifications ───
  app.get("/api/admin/lock-notifications", adminMiddleware, async (req, res) => {
    try {
      const notifications = await db.select().from(adminNotifications).orderBy(desc(adminNotifications.createdAt)).limit(100);
      res.json({ success: true, notifications });
    } catch (error) {
      res.status(500).json({ success: false });
    }
  });

  // ─── Admin: Mark notification as read ───

  // ─── Admin: Unlock user ───
  app.post("/api/admin/unlock-user", adminMiddleware, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ success: false, message: "userId required" });
      await db.update(profiles).set({ blocked: 0, deviceChangeCount: 0, deviceId: '' }).where(eq(profiles.id, userId));
      res.json({ success: true, message: "User unlocked successfully" });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to unlock user" });
    }
  });

  // ─── Admin: Get/Set support number ───
  app.get("/api/admin/support-info", adminMiddleware, async (req, res) => {
    try {
      const rows = await db.select().from(appSettings).where(or(eq(appSettings.key, 'support_number'), eq(appSettings.key, 'whatsapp_link')));
      const result: Record<string, string> = {};
      rows.forEach(r => { result[r.key] = r.value; });
      res.json({ success: true, supportNumber: result['support_number'] || '+918179142535', whatsappLink: result['whatsapp_link'] || 'https://wa.me/918179142535' });
    } catch (error) {
      res.status(500).json({ success: false });
    }
  });

  // Temporary endpoints for admin cleanup
  
  // Bulk delete users endpoint
  // Unblock a user account
  app.post("/api/admin/unblock-user", adminMiddleware, async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ success: false, message: "Phone is required" });
      }

      const cleanPhone = phone.replace(/\D/g, '');
      const result = await db.update(profiles).set({ blocked: 0 }).where(
        sql`phone LIKE ${`%${cleanPhone}%`}`
      );

      return res.json({
        success: true,
        message: `Unblocked users with phone containing ${cleanPhone}`,
      });
    } catch (error: any) {
      console.error("[Admin] Unblock error:", error);
      return res.status(500).json({ success: false, message: "Failed to unblock user" });
    }
  });

  app.post("/api/admin/bulk-delete-users", adminMiddleware, async (req, res) => {
    try {
      const { keepPhones } = req.body;
      if (!keepPhones || !Array.isArray(keepPhones)) {
        return res.status(400).json({ success: false, message: "keepPhones array required" });
      }

      // Build WHERE clause: block all users EXCEPT those matching any of the keepPhones patterns
      // Block everyone first, then unblock the admin(s)
      const keepPhonePatterns = keepPhones
        .map((phone: string) => `'%${phone.replace(/'/g, "''")}'`)
        .join(',');
      
      const query = keepPhones.length > 0 
        ? `UPDATE profiles SET blocked = 1 WHERE phone NOT LIKE ANY(ARRAY[${keepPhonePatterns}])`
        : `UPDATE profiles SET blocked = 1`;
      
      await db.execute(sql.raw(query));

      // Get count of affected and remaining
      const countResult = await db.execute(sql.raw(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN blocked = 1 THEN 1 END) as blocked,
          COUNT(CASE WHEN blocked = 0 THEN 1 END) as active
        FROM profiles
      `));

      const stats = countResult.rows?.[0] || { total: 0, blocked: 0, active: 0 };

      return res.json({
        success: true,
        message: `Bulk delete completed`,
        stats,
      });
    } catch (error) {
      console.error("[Admin] Bulk delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to bulk delete users" });
    }
  });

  // Cleanup posts and products
  app.post("/api/admin/cleanup-posts-products", adminMiddleware, async (req, res) => {
    try {
      // Delete all posts
      const postsResult = await db.delete(posts);
      
      // Delete all products
      const productsResult = await db.delete(products);

      return res.json({
        success: true,
        message: "Cleanup completed",
        deletedPosts: postsResult.rowCount || 0,
        deletedProducts: productsResult.rowCount || 0,
      });
    } catch (error) {
      console.error("[Admin] Cleanup error:", error);
      return res.status(500).json({ success: false, message: "Failed to cleanup" });
    }
  });

  // COMPLETE WIPE: Delete everything except admin account and required system data
  app.post("/api/admin/complete-wipe", adminMiddleware, async (req, res) => {
    try {
      const { confirm } = req.body;
      if (confirm !== "CONFIRM_COMPLETE_WIPE") {
        return res.status(400).json({ success: false, message: "Must confirm with 'CONFIRM_COMPLETE_WIPE'" });
      }

      // Get admin ID(s) to preserve
      const adminProfiles = await db.select().from(profiles).where(sql`phone LIKE '%8179142535%'`);
      const adminIds = adminProfiles.map(p => p.id);

      // Delete everything in dependency order
      try { await db.delete(videoProgress); } catch(e) { console.log("videoProgress:", e); }
      try { await db.delete(courseVideos); } catch(e) { console.log("courseVideos:", e); }
      try { await db.delete(courseChapters); } catch(e) { console.log("courseChapters:", e); }
      try { await db.delete(courseEnrollments); } catch(e) { console.log("courseEnrollments:", e); }
      try { await db.delete(courseNotices); } catch(e) { console.log("courseNotices:", e); }
      try { await db.delete(courses); } catch(e) { console.log("courses:", e); }
      try { await db.delete(livePollVotes); } catch(e) { console.log("livePollVotes:", e); }
      try { await db.delete(livePolls); } catch(e) { console.log("livePolls:", e); }
      try { await db.delete(liveChatMessages); } catch(e) { console.log("liveChatMessages:", e); }
      try { await db.delete(liveClasses); } catch(e) { console.log("liveClasses:", e); }
      try { await db.delete(dubbedVideos); } catch(e) { console.log("dubbedVideos:", e); }
      try { await db.delete(reels); } catch(e) { console.log("reels:", e); }
      try { await db.delete(messages); } catch(e) { console.log("messages:", e); }
      try { await db.delete(conversations); } catch(e) { console.log("conversations:", e); }
      try { await db.delete(comments); } catch(e) { console.log("comments:", e); }
      try { await db.delete(likes); } catch(e) { console.log("likes:", e); }
      try { await db.delete(posts); } catch(e) { console.log("posts:", e); }
      try { await db.delete(orders); } catch(e) { console.log("orders:", e); }
      try { await db.delete(products); } catch(e) { console.log("products:", e); }
      try { await db.delete(jobs); } catch(e) { console.log("jobs:", e); }
      try { await db.delete(repairBookings); } catch(e) { console.log("repairBookings:", e); }
      try { await db.delete(ads); } catch(e) { console.log("ads:", e); }
      try { await db.delete(teacherPayouts); } catch(e) { console.log("teacherPayouts:", e); }
      try { await db.delete(payments); } catch(e) { console.log("payments:", e); }
      
      // Delete all users EXCEPT admin(s)
      if (adminIds.length > 0) {
        await db.delete(profiles).where(
          sql`id NOT IN (${sql.join(adminIds, ',')})`
        );
      } else {
        await db.delete(profiles);
      }

      return res.json({
        success: true,
        message: "Complete database wipe successful. Only admin account(s) remain.",
        adminPreserved: adminIds.length,
      });
    } catch (error) {
      console.error("[Admin] Complete wipe error:", error);
      return res.status(500).json({ success: false, message: "Failed to complete wipe" });
    }
  });

  // Admin endpoint to end all live sessions
  app.post("/api/admin/end-all-live", adminMiddleware, async (req, res) => {
    try {
      const firestore = getFirestore();
      
      // Get all active live sessions
      const sessions = await firestore.collection("teacher_live_sessions")
        .where("isLive", "==", true)
        .get();
      
      let endedCount = 0;
      const batch = firestore.batch();
      
      // End all active sessions
      for (const doc of sessions.docs) {
        batch.update(doc.ref, {
          isLive: false,
          endedAt: Date.now(),
        });
        endedCount++;
      }
      
      // Commit batch
      if (endedCount > 0) {
        await batch.commit();
      }
      
      console.log(`[Admin] Ended all ${endedCount} live sessions`);
      return res.json({ success: true, endedCount });
    } catch (error: any) {
      console.error("[Admin End All Live] Error:", error?.message);
      return res.status(500).json({ success: false, message: "Failed to end live sessions" });
    }
  });

  app.post("/api/admin/support-info", adminMiddleware, async (req, res) => {
    try {
      const { supportNumber, whatsappLink } = req.body;
      if (supportNumber) {
        const existing = await db.select().from(appSettings).where(eq(appSettings.key, 'support_number'));
        if (existing.length > 0) {
          await db.update(appSettings).set({ value: supportNumber, updatedAt: Date.now() }).where(eq(appSettings.key, 'support_number'));
        } else {
          await db.insert(appSettings).values({ key: 'support_number', value: supportNumber });
        }
      }
      if (whatsappLink) {
        const existing2 = await db.select().from(appSettings).where(eq(appSettings.key, 'whatsapp_link'));
        if (existing2.length > 0) {
          await db.update(appSettings).set({ value: whatsappLink, updatedAt: Date.now() }).where(eq(appSettings.key, 'whatsapp_link'));
        } else {
          await db.insert(appSettings).values({ key: 'whatsapp_link', value: whatsappLink });
        }
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false });
    }
  });

  // ─── Public: get support info (for lock popups) ───
  app.get("/api/support-info", async (req, res) => {
    try {
      const rows = await db.select().from(appSettings).where(or(eq(appSettings.key, 'support_number'), eq(appSettings.key, 'whatsapp_link')));
      const result: Record<string, string> = {};
      rows.forEach(r => { result[r.key] = r.value; });
      res.json({ supportNumber: result['support_number'] || '+918179142535', whatsappLink: result['whatsapp_link'] || 'https://wa.me/918179142535' });
    } catch (error) {
      res.status(500).json({ supportNumber: '+918179142535', whatsappLink: 'https://wa.me/918179142535' });
    }
  });

  app.get("/download/:filename", (req, res) => {
    const filename = req.params.filename;
    // Basic security check to prevent directory traversal
    if (filename.includes("..") || filename.includes("/")) {
      return res.status(403).send("Forbidden");
    }
    const filePath = path.join(process.cwd(), "public", "download", filename);
    res.download(filePath, (err) => {
      if (err) {
        console.error(`[Download] Error sending ${filename}:`, err);
        res.status(404).send("File not found");
      }
    });
  });

  // ─── AI Repair Assistant ─────────────────────────────────────────────────────

  function createOpenAIClient() {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const isLocalModelfarm = baseURL && baseURL.includes('localhost');
    if (!apiKey || apiKey === '_DUMMY_API_KEY_') {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY.');
    }
    return new OpenAI({
      apiKey,
      ...(isLocalModelfarm && process.env.OPENAI_API_KEY ? {} : isLocalModelfarm ? { baseURL } : {}),
    });
  }

  function createNvidiaClient() {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      throw new Error('NVIDIA API key not configured. Please set NVIDIA_API_KEY.');
    }
    return new OpenAI({
      apiKey,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    });
  }

  app.post("/api/ai/repair/chat", async (req, res) => {
    try {
      const { messages } = req.body;
      let nvidia: OpenAI;
      try {
        nvidia = createNvidiaClient();
      } catch (keyErr: any) {
        console.error('[AI Chat] Config error:', keyErr.message);
        return res.status(503).json({ error: keyErr.message });
      }

      const systemPrompt = `You are an expert mobile phone hardware repair technician AI with 20+ years of experience. You specialize ONLY in diagnosing and repairing mobile phone hardware issues.

Your expertise:
- No power / Dead device diagnosis
- Charging IC, USB port, charging circuit issues
- Battery problems (not charging, fast drain, swollen)
- Display and touchscreen faults (LCD, OLED, digitizer)
- Backlight circuit failures
- Network/RF IC problems (no signal, no network)
- Audio IC issues (no sound, mic not working)
- Motherboard short circuits and damaged traces
- Water damage assessment and repair
- Component-level repair (soldering, hot air, reballing)

Response format:
🔍 POSSIBLE CAUSE: [Hardware root cause]
🛠️ REPAIR STEPS: [Numbered step-by-step guide]
⚠️ SAFETY PRECAUTIONS: [Important warnings]
🔧 TOOLS NEEDED: [Required tools]

Be concise, practical, and specific. Only answer mobile hardware repair questions.`;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const stream = await nvidia.chat.completions.create({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        stream: true,
        max_tokens: 800,
        temperature: 0.4,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      console.error('[AI Repair Chat] Error:', error?.message, '| code:', error?.code, '| status:', error?.status, '| type:', error?.type);
      if (!res.headersSent) {
        const userMsg = error?.status === 401 ? 'Invalid NVIDIA API key.' :
                        error?.status === 429 ? 'NVIDIA API rate limit reached. Please try again shortly.' :
                        error?.message || 'AI service unavailable';
        res.status(500).json({ error: userMsg });
      }
    }
  });

  app.post("/api/ai/repair/analyze", async (req, res) => {
    try {
      const { imageBase64, mimeType = 'image/jpeg' } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ error: 'No image provided' });
      }

      let nvidia: OpenAI;
      try {
        nvidia = createNvidiaClient();
      } catch (keyErr: any) {
        console.error('[AI Analyze] Config error:', keyErr.message);
        return res.status(503).json({ error: keyErr.message });
      }

      const response = await nvidia.chat.completions.create({
        model: 'microsoft/phi-3-vision-128k-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are an expert mobile phone motherboard repair specialist. Analyze this image and provide a structured diagnosis.

Respond in this EXACT format:

📋 OVERVIEW
[What you can see - board type, visible components, condition]

🔴 POSSIBLE FAULTY COMPONENTS
[List specific ICs, capacitors, or components that appear damaged, corroded, burned, or missing]

❓ POSSIBLE CAUSE
[Why these components may have failed - water damage, power surge, physical damage, etc.]

🛠️ REPAIR STEPS
1. [First step]
2. [Second step]
3. [Continue...]

🔧 TOOLS REQUIRED
[List specific tools: hot air station, soldering iron, multimeter, etc.]

⚡ DIFFICULTY LEVEL
[Beginner / Intermediate / Advanced / Expert - with brief explanation]

Be specific about component locations and names. If image quality is poor or not a motherboard, state that clearly.`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      });

      const analysis = response.choices[0]?.message?.content || 'Analysis failed';
      res.json({ analysis });
    } catch (error: any) {
      console.error('[AI Motherboard Analyze] Error:', error?.message, '| code:', error?.code, '| status:', error?.status);
      const userMsg = error?.status === 401 ? 'Invalid NVIDIA API key.' :
                      error?.status === 429 ? 'NVIDIA API rate limit reached. Please try again shortly.' :
                      error?.message || 'Image analysis failed. Please try again.';
      res.status(500).json({ error: userMsg });
    }
  });

  // ─── STT for AI Chat (Speech-to-Text via OpenAI Whisper) ─────────────────────
  app.post("/api/ai/repair/stt", async (req, res) => {
    try {
      const { audioBase64, mimeType } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: 'No audio provided' });
      }

      console.log('[STT] Request received, audio length:', audioBase64.length, 'mime:', mimeType);

      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        console.warn('[STT] OPENAI_API_KEY not configured');
        return res.status(503).json({ error: 'STT service not available' });
      }

      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const ext = (mimeType || '').includes('m4a') ? 'm4a'
        : (mimeType || '').includes('3gp') ? '3gp'
        : (mimeType || '').includes('webm') ? 'webm'
        : 'm4a';
      const filename = `recording.${ext}`;
      const contentType = mimeType || 'audio/m4a';

      console.log('[STT] Sending to OpenAI Whisper, file:', filename, 'size:', audioBuffer.length);

      const form = new FormData();
      const blob = new Blob([audioBuffer], { type: contentType });
      form.append('file', blob, filename);
      form.append('model', 'whisper-1');
      form.append('language', 'en');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}` },
        body: form,
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error('[STT] OpenAI error:', response.status, errBody);
        return res.status(502).json({ error: 'Whisper transcription failed' });
      }

      const data: any = await response.json();
      const transcript = (data.text || '').trim();
      console.log('[STT] Transcript:', transcript.substring(0, 80));

      res.json({ transcript });
    } catch (error: any) {
      console.error('[STT] Error:', error?.message);
      res.status(500).json({ error: 'Failed to transcribe audio: ' + error?.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // ─── MOBILE PROTECTION PLAN ROUTES ────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════════

  // Migrate tables on startup
  (async () => {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS protection_plans (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL,
          user_name TEXT NOT NULL DEFAULT '',
          user_phone TEXT DEFAULT '',
          imei TEXT NOT NULL,
          brand TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          model_number TEXT NOT NULL DEFAULT '',
          plan_type TEXT NOT NULL DEFAULT 'monthly',
          price INTEGER NOT NULL DEFAULT 0,
          front_image TEXT DEFAULT '',
          back_image TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending_verification',
          claim_used INTEGER NOT NULL DEFAULT 0,
          payment_id TEXT DEFAULT '',
          razorpay_order_id TEXT DEFAULT '',
          plan_start_date BIGINT DEFAULT 0,
          rejection_reason TEXT DEFAULT '',
          created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
          updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS protection_claims (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          plan_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          imei TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          model_number TEXT NOT NULL DEFAULT '',
          issue TEXT NOT NULL DEFAULT '',
          description TEXT DEFAULT '',
          damage_image TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'claim_pending',
          technician_id TEXT DEFAULT '',
          technician_name TEXT DEFAULT '',
          service_fee_paid INTEGER DEFAULT 0,
          rejection_reason TEXT DEFAULT '',
          admin_notes TEXT DEFAULT '',
          created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
          updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
        )
      `);
      // Add missing columns to existing tables (safe migrations)
      await db.execute(sql`ALTER TABLE protection_plans ADD COLUMN IF NOT EXISTS devices TEXT DEFAULT '[]'`);
      await db.execute(sql`ALTER TABLE protection_plans ADD COLUMN IF NOT EXISTS plan_start_date BIGINT DEFAULT 0`);
      await db.execute(sql`ALTER TABLE protection_plans ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT ''`);
      await db.execute(sql`ALTER TABLE protection_plans ADD COLUMN IF NOT EXISTS payment_id TEXT DEFAULT ''`);
      await db.execute(sql`ALTER TABLE protection_plans ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT DEFAULT ''`);
      await db.execute(sql`ALTER TABLE protection_claims ADD COLUMN IF NOT EXISTS admin_notes TEXT DEFAULT ''`);
      await db.execute(sql`ALTER TABLE protection_claims ADD COLUMN IF NOT EXISTS service_fee_paid INTEGER DEFAULT 0`);
      console.log('[Protection] Tables ready');
    } catch (e: any) { console.warn('[Protection] Table migration:', e.message); }
  })();

  // ── Apply for a Protection Plan ──────────────────────────────────────────────
  app.post('/api/protection/apply', async (req, res) => {
    try {
      console.log('[Protection] Apply endpoint called');
      console.log('[Protection] Request body keys:', Object.keys(req.body));
      
      const { userId, userName, userPhone, imei, brand, model, modelNumber, planType, frontImage, backImage, devices } = req.body;
      console.log('[Protection] Extracted fields:', { 
        userId: !!userId, 
        userName: !!userName, 
        userPhone: !!userPhone, 
        imei: !!imei, 
        brand: !!brand, 
        model: !!model, 
        modelNumber: !!modelNumber, 
        planType: !!planType,
        devicesCount: devices?.length || 0
      });
      
      if (!userId || !imei || !brand || !model || !modelNumber || !planType) {
        console.warn('[Protection] Missing required fields:', { userId, imei, brand, model, modelNumber, planType });
        return res.status(400).json({ error: 'Missing required fields: userId, imei, brand, model, modelNumber, planType' });
      }
      if (!/^\d{15}$/.test(imei)) {
        console.warn('[Protection] Invalid IMEI format:', imei);
        return res.status(400).json({ error: 'IMEI must be exactly 15 digits' });
      }
      if (!['monthly', 'yearly'].includes(planType)) {
        console.warn('[Protection] Invalid plan type:', planType);
        return res.status(400).json({ error: 'Invalid plan type. Must be monthly or yearly' });
      }

      // Validate and filter IMEIs in devices array (remove duplicates gracefully)
      const allImeis = [imei];
      let validatedDevices = [];
      if (devices && Array.isArray(devices)) {
        for (const device of devices) {
          if (device.imei) {
            // Validate IMEI format
            if (!/^\d{15}$/.test(device.imei)) {
              return res.status(400).json({ error: `Invalid IMEI format in additional device: ${device.imei}` });
            }
            // Skip if duplicate (same as main IMEI or other additional devices)
            if (allImeis.includes(device.imei)) {
              console.log('[Protection] Skipping duplicate IMEI in devices:', device.imei);
              continue;
            }
            allImeis.push(device.imei);
            validatedDevices.push(device);
          } else {
            // If device doesn't have IMEI but has other fields, keep it
            validatedDevices.push(device);
          }
        }
      }

      // Fetch dynamic prices from admin settings
      const settingsRows = await db.select().from(appSettings).where(
        sql`key IN ('insurance_plan_price_yearly','insurance_plan_price_monthly')`
      );
      const settingsMap: Record<string, string> = {};
      settingsRows.forEach(r => { settingsMap[r.key] = r.value; });
      const yearlyPrice = parseInt(settingsMap['insurance_plan_price_yearly'] || '1499', 10);
      const monthlyPrice = parseInt(settingsMap['insurance_plan_price_monthly'] || '149', 10);
      const price = planType === 'yearly' ? yearlyPrice : monthlyPrice;
      const devicesJson = JSON.stringify(validatedDevices);

      // Always CREATE new plan (don't overwrite old ones)
      const id = randomUUID();
      console.log('[Protection] Creating new protection plan...');
      console.log('[Protection] Inserting with fields:', { 
        id, userId, userName, userPhone, imei, brand, model, modelNumber, planType, price, devicesCount: devices?.length || 0
      });

      await db.insert(protectionPlans).values({
        id,
        userId,
        userName: userName || '',
        userPhone: userPhone || '',
        imei,
        brand,
        model,
        modelNumber,
        devices: devicesJson,
        planType,
        price,
        frontImage: frontImage || '',
        backImage: backImage || '',
        status: 'pending_verification',
        claimUsed: 0,
        paymentId: '',
        razorpayOrderId: '',
        planStartDate: 0,
        rejectionReason: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      console.log('[Protection] Plan created successfully:', id);
      return res.json({ success: true, planId: id, isUpdate: false, message: 'Application submitted successfully' });
    } catch (e: any) {
      console.error('[Protection] Apply error:', e.message, 'Full error:', e);
      console.error('[Protection] Stack:', e.stack);
      return res.status(500).json({ error: 'Failed to submit application: ' + e.message });
    }
  });

  // ── Get user's protection plan ───────────────────────────────────────────────
  app.get('/api/protection/my-plan/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      
      // Priority: Active, then approved_pending_payment, then pending_verification, then rejected
      // This ensures we show the user their current/latest plan, not an old rejected one
      const statuses = ['active', 'approved_pending_payment', 'pending_verification', 'rejected'];
      let plan = null;
      
      for (const status of statuses) {
        const results = await db.select().from(protectionPlans)
          .where(and(eq(protectionPlans.userId, userId), eq(protectionPlans.status, status)))
          .orderBy(desc(protectionPlans.createdAt))
          .limit(1);
        
        if (results.length > 0) {
          plan = results[0];
          break;
        }
      }

      if (!plan) return res.json({ plan: null });

      let claim = null;
      if (plan.status === 'active') {
        const claims = await db.select().from(protectionClaims)
          .where(eq(protectionClaims.planId, plan.id))
          .orderBy(desc(protectionClaims.createdAt))
          .limit(1);
        if (claims.length > 0) claim = claims[0];
      }
      console.log('[Protection] Returning plan for user:', userId, 'Plan ID:', plan.id, 'Status:', plan.status);
      return res.json({ plan, claim });
    } catch (e: any) {
      console.error('[Protection] Get plan error:', e.message);
      return res.status(500).json({ error: 'Failed to get plan' });
    }
  });

  // ── Get ALL protection plans for a user ─────────────────────────────────────
  app.get('/api/protection/all-plans/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      console.log('[Protection] Fetching all plans for userId:', userId);
      
      // Try direct ID match first
      let plans = await db.select().from(protectionPlans)
        .where(eq(protectionPlans.userId, userId))
        .orderBy(desc(protectionPlans.createdAt));
      console.log('[Protection] Direct userId match found:', plans.length, 'plans');
      
      // If no plans found, try alternative lookups
      if (plans.length === 0) {
        console.log('[Protection] No direct plans found by userId:', userId);
        
        // For non-UUID userIds (like "t4y5"), search for profile by name match
        if (!userId.includes('-')) {
          try {
            console.log('[Protection] userId is not a UUID, searching for matching profile by name...');
            
            // Get the profile with this ID (might not exist)
            let profileName = null;
            const profileById = await db.select().from(profiles).where(eq(profiles.id, userId));
            
            if (profileById && profileById.length > 0 && profileById[0]?.name) {
              profileName = profileById[0].name;
              console.log('[Protection] Found profile by ID, name:', profileName);
            } else {
              // Profile doesn't exist with this ID, search by name (case-insensitive)
              console.log('[Protection] No profile found with ID:', userId, '- searching all profiles for name match');
              const allProfiles = await db.select().from(profiles);
              const matched = allProfiles.find(p => p.name && p.name.toUpperCase() === userId.toUpperCase());
              
              if (matched?.name) {
                profileName = matched.name;
                console.log('[Protection] Found profile by name match:', profileName);
              }
            }
            
            // Now search for plans using the found profile name
            if (profileName) {
              plans = await db.select().from(protectionPlans)
                .where(eq(protectionPlans.userName, profileName))
                .orderBy(desc(protectionPlans.createdAt));
              console.log('[Protection] Found plans by userName:', profileName, 'count:', plans.length);
            } else {
              console.log('[Protection] No matching profile found for userId:', userId);
            }
          } catch (fallbackErr) {
            console.log('[Protection] Fallback search error:', fallbackErr);
          }
        }
      }

      const plansWithClaims = await Promise.all(plans.map(async (plan) => {
        if (plan.status === 'active') {
          const claims = await db.select().from(protectionClaims)
            .where(eq(protectionClaims.planId, plan.id))
            .orderBy(desc(protectionClaims.createdAt))
            .limit(1);
          return { ...plan, claim: claims[0] || null };
        }
        return { ...plan, claim: null };
      }));

      console.log('[Protection] All plans for user:', userId, 'Count:', plans.length);
      return res.json({ plans: plansWithClaims });
    } catch (e: any) {
      console.error('[Protection] Get all plans error:', e.message);
      return res.status(500).json({ error: 'Failed to get plans' });
    }
  });

  // ── Create Razorpay payment order for Protection Plan ──────────────────────
  app.post('/api/protection/payment/create-order', async (req, res) => {
    try {
      const { planId, userId } = req.body;
      if (!planId || !userId) return res.status(400).json({ error: 'Missing planId or userId' });

      const plans = await db.select().from(protectionPlans)
        .where(and(eq(protectionPlans.id, planId), eq(protectionPlans.userId, userId)))
        .limit(1);
      if (plans.length === 0) return res.status(404).json({ error: 'Plan not found' });

      const plan = plans[0];
      if (plan.status !== 'approved_pending_payment') {
        return res.status(400).json({ error: 'Plan is not approved for payment' });
      }

      if (!razorpayAvailable || !razorpayInstance) {
        return res.status(503).json({ error: 'Payment gateway not available' });
      }

      // Fetch CURRENT prices from admin settings (not stored price)
      const settingsRows = await db.select().from(appSettings).where(
        sql`key IN ('insurance_plan_price_yearly','insurance_plan_price_monthly')`
      );
      const settingsMap: Record<string, string> = {};
      settingsRows.forEach(r => { settingsMap[r.key] = r.value; });
      const yearlyPrice = parseInt(settingsMap['insurance_plan_price_yearly'] || '1499', 10);
      const monthlyPrice = parseInt(settingsMap['insurance_plan_price_monthly'] || '149', 10);
      
      // Use CURRENT price based on plan type, not stored price
      const currentPrice = plan.planType === 'yearly' ? yearlyPrice : monthlyPrice;
      const amount = currentPrice * 100; // paise
      
      const order = await razorpayInstance.orders.create({
        amount,
        currency: 'INR',
        receipt: `prot_${planId.slice(0, 8)}`,
        notes: { planId, userId, type: 'protection_plan' },
      });

      await db.update(protectionPlans).set({ 
        razorpayOrderId: order.id, 
        price: currentPrice,
        updatedAt: Date.now() 
      }).where(eq(protectionPlans.id, planId));

      return res.json({
        success: true,
        orderId: order.id,
        amount,
        keyId: razorpayKeyId,
        displayAmount: currentPrice,
        planType: plan.planType,
      });
    } catch (e: any) {
      console.error('[Protection] Create order error:', e.message);
      return res.status(500).json({ error: 'Failed to create payment order' });
    }
  });

  // ── Verify Protection Plan payment ────────────────────────────────────────
  app.post('/api/protection/payment/verify', async (req, res) => {
    try {
      const { planId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;
      if (!planId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
        return res.status(400).json({ error: 'Missing payment details' });
      }

      if (!razorpayAvailable) return res.status(503).json({ error: 'Payment gateway not available' });

      const body = razorpayOrderId + '|' + razorpayPaymentId;
      const expectedSig = crypto.createHmac('sha256', razorpayKeySecret).update(body).digest('hex');
      if (expectedSig !== razorpaySignature) {
        return res.status(400).json({ error: 'Invalid payment signature' });
      }

      const now = Date.now();
      await db.update(protectionPlans).set({
        status: 'active',
        paymentId: razorpayPaymentId,
        planStartDate: now,
        updatedAt: now,
      }).where(eq(protectionPlans.id, planId));

      return res.json({ success: true, message: 'Payment verified, plan is now active' });
    } catch (e: any) {
      console.error('[Protection] Verify payment error:', e.message);
      return res.status(500).json({ error: 'Failed to verify payment' });
    }
  });

  // ── Raise a Claim ────────────────────────────────────────────────────────────
  app.post('/api/protection/claim/raise', async (req, res) => {
    try {
      const { planId, userId, issue, description, damageImage } = req.body;
      if (!planId || !userId || !issue) return res.status(400).json({ error: 'Missing required fields' });

      const plans = await db.select().from(protectionPlans)
        .where(and(eq(protectionPlans.id, planId), eq(protectionPlans.userId, userId)))
        .limit(1);
      if (plans.length === 0) return res.status(404).json({ error: 'Plan not found' });

      const plan = plans[0];
      if (plan.status !== 'active') return res.status(400).json({ error: 'Plan is not active' });
      if (plan.claimUsed) return res.status(400).json({ error: 'Claim already used for this plan year' });

      // Waiting period check
      const waitDays = plan.planType === 'yearly' ? 7 : 30;
      const waitMs = waitDays * 24 * 60 * 60 * 1000;
      const startDate = plan.planStartDate || plan.createdAt;
      if (Date.now() - startDate < waitMs) {
        const daysLeft = Math.ceil((waitMs - (Date.now() - startDate)) / (24 * 60 * 60 * 1000));
        return res.status(400).json({ error: `Waiting period not complete. ${daysLeft} day(s) remaining.` });
      }

      // Check no pending/approved claim exists
      const existingClaims = await db.select().from(protectionClaims)
        .where(and(eq(protectionClaims.planId, planId), ne(protectionClaims.status, 'rejected')))
        .limit(1);
      if (existingClaims.length > 0) {
        return res.status(409).json({ error: 'A claim already exists for this plan' });
      }

      const claimId = randomUUID();
      await db.insert(protectionClaims).values({
        id: claimId,
        planId,
        userId,
        imei: plan.imei,
        model: plan.model,
        modelNumber: plan.modelNumber,
        issue,
        description: description || '',
        damageImage: damageImage || '',
        status: 'claim_pending',
        technicianId: '',
        technicianName: '',
        serviceFeePaid: 0,
        rejectionReason: '',
        adminNotes: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return res.json({ success: true, claimId, message: 'Claim submitted successfully' });
    } catch (e: any) {
      console.error('[Protection] Raise claim error:', e.message);
      return res.status(500).json({ error: 'Failed to raise claim' });
    }
  });

  // ── Get claim for a plan ──────────────────────────────────────────────────────
  app.get('/api/protection/claim/:planId', async (req, res) => {
    try {
      const { planId } = req.params;
      const claims = await db.select().from(protectionClaims)
        .where(eq(protectionClaims.planId, planId))
        .orderBy(desc(protectionClaims.createdAt))
        .limit(1);
      return res.json({ claim: claims[0] || null });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to get claim' });
    }
  });

  // ── Upload image for protection plan (base64) ─────────────────────────────
  app.post('/api/protection/upload-image', async (req, res) => {
    try {
      console.log('[Protection] Image upload endpoint called');
      const { base64, filename } = req.body;
      
      if (!base64) {
        console.error('[Protection] Missing base64 in request');
        return res.status(400).json({ error: 'Missing base64 data' });
      }
      if (!filename) {
        console.error('[Protection] Missing filename in request');
        return res.status(400).json({ error: 'Missing filename' });
      }

      console.log('[Protection] Converting base64 to buffer for:', filename);
      const buffer = Buffer.from(base64, 'base64');
      console.log('[Protection] Buffer size:', buffer.length, 'bytes');
      
      if (buffer.length === 0) {
        console.error('[Protection] Base64 buffer is empty');
        return res.status(400).json({ error: 'Invalid base64 data' });
      }

      const uniqueName = `protection/${Date.now()}_${filename}`;
      console.log('[Protection] Uploading to Bunny CDN storage via uploadToStorage:', uniqueName);
      
      const cdnUrl = await uploadToStorage(buffer, uniqueName);
      
      if (!cdnUrl) {
        console.error('[Protection] uploadToStorage returned empty URL for:', uniqueName);
        return res.status(500).json({ error: 'Image upload failed: no URL returned from storage' });
      }
      console.log('[Protection] Image uploaded successfully to CDN:', cdnUrl);
      return res.json({ success: true, url: cdnUrl });
    } catch (e: any) {
      console.error('[Protection] Image upload error:', e.message, 'Stack:', e.stack);
      return res.status(500).json({ error: 'Image upload failed: ' + (e.message || 'Unknown error') });
    }
  });

  // ── ADMIN: Get all protection plans ─────────────────────────────────────────
  app.get('/api/admin/protection/plans', async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      console.log('[Protection] Fetching plans with status:', status);
      
      let conditions = [];
      if (status && status !== 'all') {
        conditions.push(eq(protectionPlans.status, status));
      }
      
      const query = db.select().from(protectionPlans);
      const plans = conditions.length > 0 
        ? await query.where(and(...conditions)).orderBy(desc(protectionPlans.createdAt))
        : await query.orderBy(desc(protectionPlans.createdAt));
      
      // Parse devices JSON string to array before returning
      const parsedPlans = plans.map(p => ({
        ...p,
        devices: (() => { try { return typeof p.devices === 'string' ? JSON.parse(p.devices) : (p.devices || []); } catch { return []; } })()
      }));
      
      console.log('[Protection] Fetched plans:', parsedPlans.length);
      return res.json(parsedPlans);
    } catch (e: any) {
      console.error('[Protection] Error fetching plans:', e.message, e.stack);
      return res.status(500).json({ error: 'Failed to get plans', details: e.message });
    }
  });

  // ── ADMIN: Approve or Reject a plan ──────────────────────────────────────────
  app.put('/api/admin/protection/plan/:planId', async (req, res) => {
    try {
      const { planId } = req.params;
      const { action, rejectionReason } = req.body;
      if (!action || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
      }

      const newStatus = action === 'approve' ? 'approved_pending_payment' : 'rejected';
      await db.update(protectionPlans).set({
        status: newStatus,
        rejectionReason: rejectionReason || '',
        updatedAt: Date.now(),
      }).where(eq(protectionPlans.id, planId));

      return res.json({ success: true, status: newStatus });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to update plan' });
    }
  });

  // ── ADMIN: Get all claims ─────────────────────────────────────────────────────
  app.get('/api/admin/protection/claims', async (req, res) => {
    try {
      const { status } = req.query;
      if (status && status !== 'all') {
        const claims = await db.select().from(protectionClaims)
          .where(eq(protectionClaims.status, status as string))
          .orderBy(desc(protectionClaims.createdAt));
        return res.json(claims);
      }
      const claims = await db.select().from(protectionClaims)
        .orderBy(desc(protectionClaims.createdAt));
      return res.json(claims);
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to get claims' });
    }
  });

  // ── ADMIN: Update claim status ────────────────────────────────────────────────
  app.put('/api/admin/protection/claim/:claimId', async (req, res) => {
    try {
      const { claimId } = req.params;
      const { action, technicianId, technicianName, adminNotes, rejectionReason } = req.body;
      if (!action) return res.status(400).json({ error: 'Missing action' });

      const statusMap: Record<string, string> = {
        under_review: 'under_review',
        approve: 'approved',
        reject: 'rejected',
        assign: 'assigned',
        complete: 'completed',
      };
      const newStatus = statusMap[action] || action;

      const updateData: any = {
        status: newStatus,
        adminNotes: adminNotes || '',
        updatedAt: Date.now(),
      };
      if (rejectionReason) updateData.rejectionReason = rejectionReason;
      if (technicianId) updateData.technicianId = technicianId;
      if (technicianName) updateData.technicianName = technicianName;

      await db.update(protectionClaims).set(updateData).where(eq(protectionClaims.id, claimId));

      // If completed, mark claimUsed = 1 on the plan
      if (newStatus === 'completed') {
        const claims = await db.select().from(protectionClaims)
          .where(eq(protectionClaims.id, claimId)).limit(1);
        if (claims.length > 0) {
          await db.update(protectionPlans).set({ claimUsed: 1, updatedAt: Date.now() })
            .where(eq(protectionPlans.id, claims[0].planId));
        }
      }

      return res.json({ success: true, status: newStatus });
    } catch (e: any) {
      console.error('[Protection] Update claim error:', e.message);
      return res.status(500).json({ error: 'Failed to update claim' });
    }
  });

  // ─── TTS for AI Chat (Using OpenAI fallback) ──────────────────────────────────
  app.post("/api/ai/repair/tts", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: 'No text provided' });

      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        console.warn('[TTS] OPENAI_API_KEY not configured');
        return res.status(503).json({ error: 'TTS service not available' });
      }

      try {
        console.log('[TTS] Using OpenAI TTS for:', text.substring(0, 50) + '...');
        
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: text,
            voice: 'alloy', // Neutral voice
            response_format: 'mp3',
          }),
        });

        if (!response.ok) {
          const errData = await response.text();
          console.error('[TTS] OpenAI error:', response.status, errData);
          return res.status(response.status).json({ error: 'TTS service error: ' + response.statusText });
        }

        const buffer = await response.arrayBuffer();
        console.log('[TTS] Success! Audio size:', buffer.byteLength);

        // Return MP3 audio
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(buffer));
      } catch (err: any) {
        console.error('[TTS] Error:', err.message || err);
        return res.status(503).json({ error: 'TTS service error: ' + (err.message || err) });
      }
    } catch (error: any) {
      console.error('[TTS] Error:', error?.message || error);
      res.status(500).json({ error: 'Failed to generate speech' });
    }
  });

  // ========== Leads ==========

  // Helper: resolve authenticated profile from x-session-token header
  async function getLeadProfile(req: any): Promise<{ id: string; phone: string; name: string; role: string } | null> {
    let sessionToken: string | undefined =
      req.headers["x-session-token"] || req.body?.sessionToken || req.query?.sessionToken;
    if (Array.isArray(sessionToken)) sessionToken = sessionToken[0];
    if (sessionToken != null && typeof sessionToken !== "string") sessionToken = String(sessionToken);
    sessionToken = sessionToken?.trim();
    if (!sessionToken) return null;
    try {
      const sessionRows = await db.select().from(sessions).where(eq(sessions.sessionToken, sessionToken as string));
      if (!sessionRows[0]) return null;
      const profileRows = await db.select().from(profiles).where(eq(profiles.phone, sessionRows[0].phone));
      return (profileRows[0] as any) || null;
    } catch { return null; }
  }

  /** Same as admin panel — full contacts on /api/leads/my-leads etc. */
  function isLeadAdmin(profile: any): boolean {
    return isServerAdminProfile(profile);
  }

  // Helper: get lead price from settings (default 50)
  async function getLeadPrice(): Promise<number> {
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, 'lead_price'));
    return setting ? Math.max(1, parseInt(setting.value) || 50) : 50;
  }

  // Helper: parse purchasedBy JSON safely
  function parsePurchasedBy(raw: string | null | undefined): string[] {
    try { return JSON.parse(raw || '[]') || []; } catch { return []; }
  }

  // GET /api/leads/price - return current lead price
  app.get("/api/leads/price", async (_req, res) => {
    try {
      const price = await getLeadPrice();
      return res.json({ price });
    } catch { return res.json({ price: 50 }); }
  });

  // GET /api/leads/my-leads — technicians; admins get all leads with full contact
  app.get("/api/leads/my-leads", async (req, res) => {
    try {
      const profile = await getLeadProfile(req);
      if (!profile) return res.status(401).json({ success: false, message: "Authentication required" });
      const isAdmin = isLeadAdmin(profile);
      if (profile.role !== "technician" && !isAdmin) {
        return res.status(403).json({ success: false, message: "Only technicians can access purchased leads" });
      }
      const allLeads = await db.select().from(leads).orderBy(desc(leads.createdAt));
      if (isAdmin) {
        const rows = allLeads.map((l) => {
          const pb = parsePurchasedBy(l.purchasedBy);
          return { ...l, purchasedBy: pb, purchased: true, buyerCount: pb.length, isFull: pb.length >= l.maxBuyers };
        });
        return res.json(rows);
      }
      const myLeads = allLeads
        .filter(l => parsePurchasedBy(l.purchasedBy).includes(profile.id))
        .map(l => {
          const pb = parsePurchasedBy(l.purchasedBy);
          return { ...l, purchasedBy: pb, purchased: true, buyerCount: pb.length };
        });
      return res.json(myLeads);
    } catch (error) {
      console.error("[Leads] My leads error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch purchased leads" });
    }
  });

  // Legacy: GET /api/leads/my-claims (backward compat)
  app.get("/api/leads/my-claims", async (req, res) => {
    try {
      const profile = await getLeadProfile(req);
      if (!profile) return res.status(401).json({ success: false, message: "Authentication required" });
      const isAdmin = isLeadAdmin(profile);
      if (profile.role !== "technician" && !isAdmin) {
        return res.status(403).json({ success: false, message: "Only technicians can access claimed leads" });
      }
      const allLeads = await db.select().from(leads).orderBy(desc(leads.createdAt));
      if (isAdmin) {
        const rows = allLeads.map((l) => {
          const pb = parsePurchasedBy(l.purchasedBy);
          return { ...l, purchasedBy: pb, purchased: true, claimed: true, buyerCount: pb.length, isFull: pb.length >= l.maxBuyers };
        });
        return res.json(rows);
      }
      const myLeads = allLeads
        .filter(l => parsePurchasedBy(l.purchasedBy).includes(profile.id))
        .map(l => {
          const pb = parsePurchasedBy(l.purchasedBy);
          return { ...l, purchasedBy: pb, purchased: true, claimed: true, buyerCount: pb.length };
        });
      return res.json(myLeads);
    } catch (error) {
      console.error("[Leads] My claims error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch claimed leads" });
    }
  });

  // GET /api/leads/checkout - Razorpay checkout page for buying a lead
  app.get("/api/leads/checkout", (req, res) => {
    const { orderId, amount, keyId, leadTitle, technicianName, technicianPhone, technicianEmail, leadId, technicianId, sessionToken } = req.query;
    const baseUrl = process.env.APP_DOMAIN || apiPublicBase();

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Get Lead - Mobi</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0D0D0D; color: #fff; min-height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
    .container { text-align: center; max-width: 400px; width: 100%; }
    .logo { font-size: 28px; font-weight: 800; color: #4F46E5; margin-bottom: 24px; }
    .label { font-size: 13px; color: #999; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
    .lead-title { font-size: 18px; font-weight: 600; margin-bottom: 24px; color: #fff; line-height: 1.4; }
    .amount { font-size: 40px; font-weight: 700; color: #4F46E5; margin-bottom: 8px; }
    .amount-sub { color: #666; font-size: 13px; margin-bottom: 32px; }
    .pay-btn { background: #4F46E5; color: #fff; border: none; padding: 16px 48px;
      font-size: 18px; font-weight: 700; border-radius: 12px; cursor: pointer; width: 100%; transition: opacity 0.2s; }
    .pay-btn:hover { opacity: 0.9; }
    .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 24px; font-size: 14px; color: #999; }
    .success { color: #4CAF50; font-size: 18px; font-weight: 600; }
    .failed { color: #F44336; font-size: 18px; font-weight: 600; }
    .spinner { width: 40px; height: 40px; border: 4px solid #333; border-top: 4px solid #4F46E5;
      border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .secure { display: flex; align-items: center; justify-content: center; gap: 6px;
      margin-top: 16px; color: #555; font-size: 12px; }
    .info-box { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 10px;
      padding: 12px 16px; margin-bottom: 24px; text-align: left; }
    .info-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 6px; font-size: 13px; color: #aaa; }
    .info-row:last-child { margin-bottom: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Mobi</div>
    <div class="label">Lead Box</div>
    <div class="lead-title">${(leadTitle as string || 'Service Lead').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    <div class="info-box">
      <div class="info-row">&#128274; Pay once to unlock full customer contact details</div>
      <div class="info-row">&#128222; Call & WhatsApp the customer directly</div>
      <div class="info-row">&#9989; Secure payment via Razorpay</div>
    </div>
    <div class="amount">&#8377;${((parseInt(amount as string) || 0) / 100).toLocaleString('en-IN')}</div>
    <div class="amount-sub">One-time unlock fee</div>
    <button class="pay-btn" id="payBtn" onclick="startPayment()">Pay &amp; Get Lead</button>
    <div class="status" id="status"></div>
    <div class="secure">&#128274; Secured by Razorpay</div>
  </div>
  <script>
    var paymentDone = false;
    function startPayment() {
      document.getElementById('payBtn').disabled = true;
      document.getElementById('status').innerHTML = '<div class="spinner"></div>Opening payment...';
      var options = {
        key: '${keyId}',
        amount: '${amount}',
        currency: 'INR',
        name: 'Mobi Lead Box',
        description: '${((leadTitle as string) || '').replace(/'/g, "\\'").replace(/\n/g, ' ')}',
        order_id: '${orderId}',
        prefill: {
          name: '${(technicianName as string || '').replace(/'/g, "\\'")}',
          contact: '${technicianPhone || ''}',
          email: '${technicianEmail || ''}',
        },
        theme: { color: '#4F46E5' },
        handler: function(response) {
          paymentDone = true;
          document.getElementById('status').innerHTML = '<div class="spinner"></div>Verifying payment...';
          document.getElementById('payBtn').style.display = 'none';
          fetch('${baseUrl}/api/leads/${leadId}/buy-verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-session-token': '${sessionToken || ''}' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.success) {
              document.getElementById('status').innerHTML = '<div class="success">&#9989; Lead Unlocked!</div><p style="color:#999;margin-top:8px">Go back to app to view contact details.</p>';
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'lead_purchased', lead: data.lead }));
              }
            } else {
              document.getElementById('status').innerHTML = '<div class="failed">Verification Failed</div><p style="color:#999;margin-top:8px">' + (data.message || 'Please contact support') + '</p>';
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'lead_purchase_failed', message: data.message }));
              }
              document.getElementById('payBtn').disabled = false;
              document.getElementById('payBtn').style.display = '';
            }
          })
          .catch(function(err) {
            document.getElementById('status').innerHTML = '<div class="failed">Network Error</div><p style="color:#999;margin-top:8px">Please check connection and try again.</p>';
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'lead_purchase_failed', message: 'Network error' }));
            }
            document.getElementById('payBtn').disabled = false;
            document.getElementById('payBtn').style.display = '';
          });
        },
        modal: {
          ondismiss: function() {
            if (!paymentDone) {
              document.getElementById('payBtn').disabled = false;
              document.getElementById('status').innerHTML = '';
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'lead_purchase_cancelled' }));
              }
            }
          }
        }
      };
      var rzp = new Razorpay(options);
      rzp.open();
    }
    window.onload = function() { setTimeout(startPayment, 300); };
  </script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  // GET /api/leads — technicians + same legacy admins as admin panel (full contacts, no payment)
  app.get("/api/leads", async (req, res) => {
    try {
      const profile = await getLeadProfile(req);
      if (!profile) return res.status(401).json({ success: false, message: "Authentication required" });
      const adminViewer = isServerAdminProfile(profile);
      if (profile.role !== 'technician' && !adminViewer) {
        return res.status(403).json({ success: false, message: "Only technicians can browse leads" });
      }

      const { category, sort } = req.query;
      let allLeads = await db.select().from(leads).orderBy(
        sort === 'oldest' ? leads.createdAt : desc(leads.createdAt)
      );
      if (category && category !== 'all') {
        allLeads = allLeads.filter(l => l.category === category);
      }
      const result = allLeads.map(lead => {
        const pb = parsePurchasedBy(lead.purchasedBy);
        // Technicians: name + phone only after payment. Admins (adminViewer): full row.
        const purchased = pb.includes(profile.id) || adminViewer;
        return {
          ...lead,
          purchasedBy: pb,
          buyerCount: pb.length,
          purchased,
          isFull: pb.length >= lead.maxBuyers,
          contactNumber: purchased ? lead.contactNumber : '',
          customerName: purchased ? lead.customerName : '',
        };
      });
      return res.json(result);
    } catch (error) {
      console.error("[Leads] List error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch leads" });
    }
  });

  // POST /api/leads - create a lead (customer facing)
  app.post("/api/leads", async (req, res) => {
    try {
      const { customerId, customerName, title, description, category, location, contactNumber } = req.body;
      if (!title) return res.status(400).json({ success: false, message: "Title is required" });
      const price = await getLeadPrice();
      const now = Date.now();
      const [lead] = await db.insert(leads).values({
        customerId: customerId || '',
        customerName: customerName || '',
        title,
        description: description || '',
        category: category || 'repair',
        location: location || '',
        contactNumber: contactNumber || '',
        status: 'open',
        purchasedBy: '[]',
        maxBuyers: 5,
        price,
        createdAt: now,
        updatedAt: now,
      }).returning();
      return res.json({ success: true, lead });
    } catch (error) {
      console.error("[Leads] Create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create lead" });
    }
  });

  // POST /api/leads/:id/buy-order - create Razorpay order to buy a lead
  app.post("/api/leads/:id/buy-order", async (req, res) => {
    try {
      const { id } = req.params;
      const profile = await getLeadProfile(req);
      if (!profile) return res.status(401).json({ success: false, message: "Authentication required" });
      if (profile.role !== 'technician') return res.status(403).json({ success: false, message: "Only technicians can buy leads" });

      const [lead] = await db.select().from(leads).where(eq(leads.id, id));
      if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

      const pb = parsePurchasedBy(lead.purchasedBy);
      if (pb.includes(profile.id)) {
        return res.json({ success: true, alreadyPurchased: true, contactNumber: lead.contactNumber, lead: { ...lead, purchasedBy: pb, purchased: true, buyerCount: pb.length } });
      }
      if (pb.length >= lead.maxBuyers) {
        return res.status(400).json({ success: false, message: "This lead is full (max buyers reached)" });
      }

      const price = lead.price || await getLeadPrice();
      const amountPaise = price * 100;

      if (!razorpayInstance) {
        return res.status(503).json({ success: false, message: "Payment gateway not configured" });
      }

      const order = await razorpayInstance.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: `lead_${id.slice(0, 8)}_${Date.now()}`,
        notes: { leadId: id, technicianId: profile.id },
      });

      return res.json({
        success: true,
        orderId: order.id,
        amount: amountPaise,
        keyId: process.env.RAZORPAY_KEY_ID,
        leadId: id,
        leadTitle: lead.title,
        price,
      });
    } catch (error) {
      console.error("[Leads] Buy order error:", error);
      return res.status(500).json({ success: false, message: "Failed to create payment order" });
    }
  });

  // POST /api/leads/:id/buy-verify - verify payment and add technician to purchasedBy
  app.post("/api/leads/:id/buy-verify", async (req, res) => {
    try {
      const { id } = req.params;
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
      const profile = await getLeadProfile(req);
      if (!profile) return res.status(401).json({ success: false, message: "Authentication required" });
      if (profile.role !== 'technician') return res.status(403).json({ success: false, message: "Only technicians can buy leads" });

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ success: false, message: "Payment verification data required" });
      }
      const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = require('crypto').createHmac('sha256', razorpayKeySecret).update(body).digest('hex');
      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: "Invalid payment signature" });
      }

      const [lead] = await db.select().from(leads).where(eq(leads.id, id));
      if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

      const pb = parsePurchasedBy(lead.purchasedBy);
      if (!pb.includes(profile.id)) {
        pb.push(profile.id);
        await db.update(leads).set({ purchasedBy: JSON.stringify(pb), updatedAt: Date.now() }).where(eq(leads.id, id));
        // Also record in lead_claims for audit
        await db.insert(leadClaims).values({
          leadId: id,
          technicianId: profile.id,
          technicianName: profile.name || '',
          amountPaid: lead.price || 50,
          createdAt: Date.now(),
        }).catch(() => {});
      }

      const updatedLead = { ...lead, purchasedBy: pb, purchased: true, buyerCount: pb.length, isFull: pb.length >= lead.maxBuyers };
      return res.json({ success: true, lead: updatedLead });
    } catch (error) {
      console.error("[Leads] Buy verify error:", error);
      return res.status(500).json({ success: false, message: "Failed to verify payment" });
    }
  });

  // POST /api/leads/:id/claim - legacy claim (without payment, kept for admin use)
  app.post("/api/leads/:id/claim", async (req, res) => {
    try {
      const { id } = req.params;
      const profile = await getLeadProfile(req);
      if (!profile) return res.status(401).json({ success: false, message: "Authentication required" });
      if (profile.role !== 'technician') return res.status(403).json({ success: false, message: "Only technicians can claim leads" });

      const [lead] = await db.select().from(leads).where(eq(leads.id, id));
      if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

      const pb = parsePurchasedBy(lead.purchasedBy);
      if (pb.includes(profile.id)) {
        return res.json({ success: true, contactNumber: lead.contactNumber, alreadyClaimed: true, lead: { ...lead, purchasedBy: pb, purchased: true } });
      }
      return res.status(402).json({ success: false, message: "Payment required to claim this lead", requiresPayment: true });
    } catch (error) {
      console.error("[Leads] Claim error:", error);
      return res.status(500).json({ success: false, message: "Failed to claim lead" });
    }
  });

  app.delete("/api/leads/:id", adminMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(leadClaims).where(eq(leadClaims.leadId, id));
      await db.delete(leads).where(eq(leads.id, id));
      return res.json({ success: true });
    } catch (error) {
      console.error("[Leads] Delete error:", error);
      return res.status(500).json({ success: false, message: "Failed to delete lead" });
    }
  });

  app.get("/api/admin/leads", adminMiddleware, async (req, res) => {
    try {
      const allLeads = await db.select().from(leads).orderBy(desc(leads.createdAt));
      const allClaims = await db.select().from(leadClaims).orderBy(desc(leadClaims.createdAt));
      const claimsMap = new Map<string, any[]>();
      allClaims.forEach(c => {
        if (!claimsMap.has(c.leadId)) claimsMap.set(c.leadId, []);
        claimsMap.get(c.leadId)!.push(c);
      });
      const price = await getLeadPrice();
      const result = allLeads.map(l => {
        const pb = parsePurchasedBy(l.purchasedBy);
        return { ...l, purchasedBy: pb, buyerCount: pb.length, claims: claimsMap.get(l.id) || [] };
      });
      return res.json({ leads: result, price });
    } catch (error) {
      console.error("[Leads] Admin list error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch leads" });
    }
  });

  app.post("/api/admin/leads/price", adminMiddleware, async (req, res) => {
    try {
      const { price } = req.body;
      const priceNum = parseInt(price);
      if (!priceNum || priceNum < 1) return res.status(400).json({ success: false, message: "Invalid price" });
      // Save global price setting
      const existing = await db.select().from(appSettings).where(eq(appSettings.key, 'lead_price'));
      if (existing.length > 0) {
        await db.update(appSettings).set({ value: String(priceNum) }).where(eq(appSettings.key, 'lead_price'));
      } else {
        await db.insert(appSettings).values({ key: 'lead_price', value: String(priceNum) });
      }
      // Also update ALL existing leads to use the new price
      await db.update(leads).set({ price: priceNum });
      return res.json({ success: true, price: priceNum });
    } catch (error) {
      console.error("[Leads] Price update error:", error);
      return res.status(500).json({ success: false, message: "Failed to update lead price" });
    }
  });

  app.post("/api/admin/leads/create", adminMiddleware, async (req, res) => {
    try {
      const { title, description, category, location, contactNumber, customerName, price: priceOverride } = req.body;
      if (!title) return res.status(400).json({ success: false, message: "Title is required" });
      const defaultPrice = await getLeadPrice();
      const price = priceOverride && parseInt(priceOverride) > 0 ? parseInt(priceOverride) : defaultPrice;
      const now = Date.now();
      const [lead] = await db.insert(leads).values({
        customerId: 'admin',
        customerName: customerName || 'Admin',
        title,
        description: description || '',
        category: category || 'repair',
        location: location || '',
        contactNumber: contactNumber || '',
        status: 'open',
        purchasedBy: '[]',
        maxBuyers: 5,
        price,
        createdAt: now,
        updatedAt: now,
      }).returning();
      return res.json({ success: true, lead });
    } catch (error) {
      console.error("[Leads] Admin create error:", error);
      return res.status(500).json({ success: false, message: "Failed to create lead" });
    }
  });

  // Batch create leads from CSV data
  app.post("/api/admin/leads/batch-create", adminMiddleware, async (req, res) => {
    try {
      const { rows } = req.body; // array of {title,customerName,contactNumber,location,category,description,price}
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ success: false, message: "No rows provided" });
      if (rows.length > 500)
        return res.status(400).json({ success: false, message: "Maximum 500 leads per batch" });
      const defaultPrice = await getLeadPrice();
      const now = Date.now();
      const values = rows.map((row: any) => ({
        customerId: 'admin',
        customerName: row.customerName || 'Admin',
        title: row.title || 'Untitled Lead',
        description: row.description || '',
        category: row.category || 'repair',
        location: row.location || '',
        contactNumber: (row.contactNumber || '').replace(/\D/g, ''),
        status: 'open',
        purchasedBy: '[]',
        maxBuyers: 5,
        price: row.price && parseInt(row.price) > 0 ? parseInt(row.price) : defaultPrice,
        createdAt: now + Math.random(), // slight offset to preserve order
        updatedAt: now,
      }));
      const created = await db.insert(leads).values(values).returning();
      return res.json({ success: true, count: created.length, leads: created });
    } catch (error) {
      console.error("[Leads] Batch create error:", error);
      return res.status(500).json({ success: false, message: "Failed to batch create leads" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────

  const httpServer = createServer(app);
  return httpServer;
}
