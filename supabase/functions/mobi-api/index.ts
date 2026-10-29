import { createClient } from "npm:@supabase/supabase-js@2";
import { camelKeys, handleExtraRoutes } from "./extra.ts";
import { notifyNewPost } from "./push.ts";
import {
  cfCustomerHost,
  createStreamDirectUploadOrFree,
  extractStreamUid,
  resolveReelStreamLifecycle,
} from "./stream-quota.ts";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-session-token, x-mobi-phone, x-firebase-id-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function otpEmailHtml(otp: string): string {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:24px">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;text-align:center">
  <h2 style="margin:0 0 8px;color:#111">AtoZ Mobile Repair</h2>
  <p style="color:#555;margin:0 0 24px">Your login verification code</p>
  <div style="font-size:32px;letter-spacing:8px;font-weight:700;color:#2563eb;background:#eff6ff;padding:16px;border-radius:8px">${otp}</div>
  <p style="color:#888;font-size:13px;margin:24px 0 0">This code expires in 10 minutes. If you did not request it, ignore this email.</p>
</div></body></html>`;
}

async function sendOtpEmail(to: string, otp: string): Promise<{ ok: boolean; error?: string }> {
  const subject = "Your AtoZ verification code";
  const text = `Your AtoZ Mobile Repair verification code is ${otp}. It expires in 10 minutes.`;
  const html = otpEmailHtml(otp);

  const resendKey = String(Deno.env.get("RESEND_API_KEY") || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "");
  const fromRaw = String(Deno.env.get("RESEND_FROM_EMAIL") || "").trim();
  const from = fromRaw.includes("<") && fromRaw.includes(">")
    ? fromRaw
    : fromRaw.includes("@")
    ? `Mobi App <${fromRaw}>`
    : "Mobi App <noreply@atozmobilerepair.in>";

  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
      });
      const data = await res.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
      if (res.ok && data?.id) return { ok: true };
      const err = String(data?.message || data?.name || `Resend HTTP ${res.status}`);
      console.error("[otp-email] Resend failed:", err);
      if (!String(Deno.env.get("MAILERSEND_API_KEY") || "").trim()) {
        return { ok: false, error: err };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[otp-email] Resend error:", msg);
      if (!String(Deno.env.get("MAILERSEND_API_KEY") || "").trim()) {
        return { ok: false, error: msg };
      }
    }
  }

  const mailerKey = String(Deno.env.get("MAILERSEND_API_KEY") || "").trim();
  const mailerFrom = String(
    Deno.env.get("MAILERSEND_FROM_EMAIL") || Deno.env.get("RESEND_FROM_EMAIL") || "noreply@atozmobilerepair.in",
  ).trim().replace(/^.*<([^>]+)>.*$/, "$1");
  if (!mailerKey) {
    return { ok: false, error: "Email service not configured (need RESEND_API_KEY)" };
  }
  try {
    const res = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mailerKey}`,
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        from: { email: mailerFrom, name: "AtoZ Mobile Repair" },
        to: [{ email: to }],
        subject,
        html,
        text,
      }),
    });
    if (res.ok || res.status === 202) return { ok: true };
    const data = await res.json().catch(() => ({})) as { message?: string };
    return { ok: false, error: String(data?.message || `MailerSend HTTP ${res.status}`) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function digits10(phone: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  return d.replace(/^91/, "").slice(-10);
}

const ADMIN_SECRET_OTP_PHONE = "8179142535";
const ADMIN_SECRET_OTP = "000111";

function isAdminSecretOtp(phone: string, code: string): boolean {
  return digits10(phone) === ADMIN_SECRET_OTP_PHONE && otpDigitsOnly(code).slice(-6) === ADMIN_SECRET_OTP;
}

function cfStreamThumb(url: string): string {
  try {
    const u = new URL(String(url || "").trim());
    const host = u.hostname.toLowerCase();
    if (!host.includes("cloudflarestream") && host !== "videodelivery.net") return "";
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (!id) return "";
    return `${u.protocol}//${u.host}/${id}/thumbnails/thumbnail.jpg`;
  } catch {
    return "";
  }
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const OTP_TTL_MS = 10 * 60 * 1000;

function normalizeEmailAddr(v: string): string {
  return String(v || "").trim().toLowerCase();
}

function isEmailSessionKey(v: string): boolean {
  const s = String(v || "").trim();
  return s.startsWith("email:") || s.includes("@");
}

function emailFromSessionKey(v: string): string {
  const s = String(v || "").trim();
  return normalizeEmailAddr(s.startsWith("email:") ? s.slice(6) : s);
}

function otpDigitsOnly(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function expiryMs(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function fillApiHomePlaceholders(template: string, value: string): string {
  return String(template || "")
    .replace(/\{otp\}/gi, value)
    .replace(/\{message\}/gi, value)
    .replace(/\{#var#\}/gi, value)
    .replace(/\{\{#var#\}\}/gi, value)
    .replace(/\bText2\b/g, value)
    .replace(/\bText1\b/g, value)
    .replace(/\btext2\b/g, value)
    .replace(/\btext1\b/g, value);
}

function applyApiHomeVarParams(params: URLSearchParams, value: string): void {
  const trimmed = String(value || "").trim();
  if (!trimmed) return;
  params.set("Text1", trimmed);
  params.set("Text2", trimmed);
  params.set("text1", trimmed);
  params.set("text2", trimmed);
  params.set("var1", trimmed);
  params.set("var2", trimmed);
  params.set("variables_values", trimmed);
}

function extractProviderOtp(data: Record<string, unknown>): string {
  const candidates = [
    data.otp,
    data.OTP,
    data.code,
    data.otpcode,
    data.otp_code,
    data.otpCode,
    (data.data as Record<string, unknown> | undefined)?.otp,
    (data.result as Record<string, unknown> | undefined)?.otp,
  ];
  for (const c of candidates) {
    const digits = String(c ?? "").replace(/\D/g, "");
    if (digits.length === 6) return digits;
  }
  return "";
}

function apiHomeLooksSuccessful(data: Record<string, unknown>, responseOk: boolean, raw: string): boolean {
  if (!responseOk) return false;
  const rawTrim = String(raw || "").trim();
  if (!rawTrim || rawTrim.startsWith("<") || /<!doctype html/i.test(rawTrim)) return false;
  const remark = String(data.remark || data.message || data.status || "").toLowerCase();
  if (!remark && data.success !== true && data.status !== 1 && data.status !== "1") return false;
  if (remark.includes("invalid") || remark.includes("error") || remark.includes("fail") || remark.includes("unauthor") || remark.includes("insufficient") || remark.includes("balance")) {
    return false;
  }
  return (
    data.success === true ||
    data.status === "success" ||
    data.status === "Success" ||
    data.status === 1 ||
    data.status === "1" ||
    data.status === "Sent" ||
    remark === "success" ||
    remark === "ok" ||
    remark === "sent" ||
    remark.includes("sms sent") ||
    remark.includes("successfully")
  );
}

async function callApiHome(params: URLSearchParams, method: "GET" | "POST"): Promise<{ ok: boolean; remark: string; providerOtp?: string }> {
  const url = new URL("https://apihome.online/panel/api/bulksms/");
  const init: RequestInit = { method, headers: { "Content-Type": "application/x-www-form-urlencoded" } };
  if (method === "GET") {
    params.forEach((v, k) => url.searchParams.set(k, v));
  } else {
    init.body = params.toString();
  }
  const res = await fetch(url.toString(), init);
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(raw) as Record<string, unknown>; } catch { data = { remark: raw.slice(0, 400) }; }
  const remark = String(data.remark || data.message || data.status || data.error || raw.slice(0, 160));
  const providerOtp = extractProviderOtp(data) || undefined;
  const ok = apiHomeLooksSuccessful(data, res.ok, raw);
  console.log("[otp-sms] API Home", method, "http", res.status, "ok", ok, "remark", remark.slice(0, 160));
  return { ok, remark, providerOtp };
}

async function sendOtpViaApiHome(phone: string, otp: string): Promise<{ ok: boolean; providerOtp?: string; error?: string; remark?: string }> {
  const apiHomeKey = String(Deno.env.get("API_HOME_API_KEY") || "").trim();
  if (!apiHomeKey) return { ok: false, error: "API Home key missing" };
  const sender = String(Deno.env.get("API_HOME_SENDER") || "").trim();
  const template = String(Deno.env.get("API_HOME_TEMPLATE") || Deno.env.get("API_HOME_DLT_TEMPLATE") || "").trim();
  const message = fillApiHomePlaceholders(
    String(Deno.env.get("API_HOME_MESSAGE") || "Dear Customer Your Login otp is {otp}"),
    otp,
  );

  // Same payload the Cloud Run sender uses: otp plus the DLT message body.
  const otpParams = new URLSearchParams();
  otpParams.set("key", apiHomeKey);
  otpParams.set("mobile", phone);
  otpParams.set("otp", otp);
  otpParams.set("message", message);
  otpParams.set("sms", message);
  otpParams.set("text", message);
  otpParams.set("country", "91");
  applyApiHomeVarParams(otpParams, otp);
  if (sender) otpParams.set("sender", sender);
  if (template) {
    otpParams.set("template", template);
    otpParams.set("DLT_TE_ID", template);
  }

  try {
    const sent = await callApiHome(otpParams, "POST");
    if (sent.ok) return { ok: true, providerOtp: sent.providerOtp, remark: sent.remark };
    return { ok: false, error: sent.remark || "API Home failed", providerOtp: sent.providerOtp, remark: sent.remark };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "API Home error";
    console.error("[otp-sms] API Home network:", msg);
    return { ok: false, error: msg };
  }
}

async function sendOtpViaFast2Sms(phone: string, otp: string): Promise<{ ok: boolean; error?: string }> {
  const fastKey = String(Deno.env.get("FAST2SMS_API_KEY") || "").trim();
  if (!fastKey) return { ok: false, error: "Fast2SMS key missing" };
  try {
    const fr = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: { authorization: fastKey, "Content-Type": "application/json" },
      body: JSON.stringify({ route: "otp", variables_values: otp, numbers: phone }),
    });
    const fj = await fr.json().catch(() => ({})) as { return?: boolean | string; message?: unknown };
    const msg = String(Array.isArray(fj.message) ? fj.message.join(" ") : fj.message || "").toLowerCase();
    if (msg.includes("invalid") || msg.includes("error") || msg.includes("fail") || msg.includes("dlt")) {
      return { ok: false, error: String(fj.message || "Fast2SMS rejected") };
    }
    if (fr.ok && (fj.return === true || fj.return === "true")) {
      console.log("[otp-sms] Fast2SMS delivered");
      return { ok: true };
    }
    return { ok: false, error: String(fj.message || "Fast2SMS failed") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Fast2SMS error" };
  }
}

type OtpRow = { otp?: string; expires_at?: number; created_at?: number; email?: string };

async function loadEmailOtpRows(
  db: NonNullable<ReturnType<typeof adminClient>>,
  email: string,
): Promise<{ rows: OtpRow[]; error: { message?: string } | null }> {
  const { data, error } = await db
    .from("otp_tokens")
    .select("otp,expires_at,created_at,email")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(10);
  return { rows: (data || []) as OtpRow[], error };
}

type ProfileLite = {
  id?: string;
  name?: string;
  avatar?: string;
  phone?: string;
  email?: string;
  role?: string;
  deleted_at?: unknown;
  blocked?: unknown;
};

function activeProfile(rows: ProfileLite[]): ProfileLite | null {
  const list = rows || [];
  return (
    list.find((p) => (p.deleted_at == null || p.deleted_at === "") && String(p.role || "").toLowerCase() === "admin") ||
    list.find((p) => p.deleted_at == null || p.deleted_at === "") ||
    list[0] ||
    null
  );
}

async function findProfileForSession(
  db: NonNullable<ReturnType<typeof adminClient>>,
  sessionPhone: string,
  clientPhone = "",
): Promise<ProfileLite | null> {
  const select = "id,name,avatar,phone,email,role,deleted_at,blocked";
  const s = String(sessionPhone || "").trim();
  if (isEmailSessionKey(s)) {
    const em = emailFromSessionKey(s);
    if (em) {
      const { data } = await db.from("profiles").select(select).ilike("email", em).limit(20);
      const p = activeProfile((data || []) as ProfileLite[]);
      if (p) return p;
    }
  }
  const key = digits10(s);
  if (key) {
    const { data } = await db.from("profiles").select(select).in("phone", [key, `91${key}`, `+91${key}`, s]).limit(20);
    const p = activeProfile((data || []) as ProfileLite[]);
    if (p) return p;
  } else if (s && !isEmailSessionKey(s)) {
    const { data } = await db.from("profiles").select(select).eq("phone", s).limit(5);
    const p = activeProfile((data || []) as ProfileLite[]);
    if (p) return p;
  }
  const clientKey = digits10(clientPhone);
  if (clientKey) {
    const { data } = await db.from("profiles").select(select).in("phone", [clientKey, `91${clientKey}`, `+91${clientKey}`, clientPhone]).limit(20);
    const p = activeProfile((data || []) as ProfileLite[]);
    if (p) return p;
  }
  return null;
}

async function rebindSessionToPhone(
  db: NonNullable<ReturnType<typeof adminClient>>,
  opts: { sessionToken?: string; email?: string; phone?: string },
) {
  const newPhone = String(opts.phone || "").trim();
  if (!newPhone || newPhone.startsWith("email:")) return;
  const sessionTok = String(opts.sessionToken || "").trim();
  if (sessionTok) {
    await db.from("sessions").update({ phone: newPhone }).eq("session_token", sessionTok);
  }
  const email = normalizeEmailAddr(opts.email || "");
  if (email) {
    await db.from("sessions").update({ phone: newPhone }).eq("phone", `email:${email}`);
  }
}

const UPSTREAM = String(Deno.env.get("MOBI_UPSTREAM_API") || "").replace(/\/+$/, "");

async function proxyUpstream(req: Request, path: string): Promise<Response | null> {
  if (!UPSTREAM) return null;
  const incoming = new URL(req.url);
  const target = `${UPSTREAM}${path}${incoming.search}`;
  const headers = new Headers(req.headers);
  headers.delete("host");
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    (init as { duplex?: string }).duplex = "half";
  }
  try {
    const res = await fetch(target, init);
    const out = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(res.body, { status: res.status, headers: out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ success: false, message: `Upstream failed: ${msg}` }, 502);
  }
}

function parseJobSkills(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x || "").trim()).filter(Boolean);
    } catch {
      /* comma-separated fallback */
    }
    return raw.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function mapJobRow(r: Record<string, unknown>) {
  const mapped = camelKeys(r);
  return { ...mapped, skills: parseJobSkills(mapped.skills) };
}

function mapReel(r: Record<string, unknown>) {
  const t = Number(r.created_at);
  const statusRaw = String(r.stream_status || "ready").trim();
  const status =
    statusRaw === "processing" || statusRaw === "ready" || statusRaw === "error" ? statusRaw : "ready";
  return {
    id: r.id,
    user_id: r.user_id,
    user_display_name: r.user_display_name || "",
    user_avatar: r.user_avatar || "",
    video_url: r.video_url,
    thumbnail_url: r.thumbnail_url,
    caption: r.caption || "",
    status,
    created_at: new Date(Number.isFinite(t) ? t : Date.now()).toISOString(),
    views_count: r.views_count ?? 0,
    likes_count: r.likes_count ?? 0,
    comments_count: r.comments_count ?? 0,
  };
}

function routePath(req: Request): { method: string; path: string; url: URL } {
  const url = new URL(req.url);
  let path = url.pathname.replace(/\/+$/, "") || "/";
  const marker = "/mobi-api";
  const idx = path.indexOf(marker);
  if (idx >= 0) path = path.slice(idx + marker.length) || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  return { method: req.method.toUpperCase(), path, url };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const { method, path, url } = routePath(req);
  const db = adminClient();
  if (!db) return json({ success: false, message: "Supabase not configured" }, 500);

  try {
    if (path === "/" || path === "" || path === "/health" || path === "/healthz" || path === "/_healthz") {
      return json({
        success: true,
        backend: "supabase-mobi-api",
        health: "/health",
        hint: "App APIs are under /api/... e.g. /api/posts",
      });
    }

    if (method === "GET" && path === "/api/app/intro") {
      const { data } = await db
        .from("app_settings")
        .select("key,value")
        .in("key", ["app_intro_enabled", "app_intro_video_url", "app_intro_duration_seconds"]);
      const map: Record<string, string> = {};
      (data || []).forEach((r: { key?: string; value?: string }) => {
        if (r.key) map[r.key] = String(r.value || "");
      });
      const videoUrl = String(map.app_intro_video_url || "").trim();
      const explicitlyOff = map.app_intro_enabled === "false";
      const enabled = (map.app_intro_enabled === "true" || (Boolean(videoUrl) && !explicitlyOff)) && Boolean(videoUrl);
      return json({
        enabled,
        videoUrl,
        durationSeconds: Math.max(0, Math.floor(Number(map.app_intro_duration_seconds) || 0)) || undefined,
      });
    }

    if (method === "GET" && path === "/api/app-version") {
      const { data: verRows } = await db
        .from("app_settings")
        .select("key,value")
        .in("key", ["app_latest_version_name", "app_latest_version_code", "app_min_version_code"]);
      const map: Record<string, string> = {};
      for (const r of verRows || []) {
        if (r?.key) map[String(r.key)] = String(r.value || "");
      }
      const versionName =
        String(map.app_latest_version_name || Deno.env.get("APP_LATEST_VERSION_NAME") || "14.21").trim() || "14.21";
      const versionCode =
        Number(map.app_latest_version_code || Deno.env.get("APP_LATEST_VERSION_CODE") || "225") || 225;
      const minVersionCode =
        Number(map.app_min_version_code || Deno.env.get("APP_MIN_VERSION_CODE") || "0") || 0;
      return json({
        versionName,
        versionCode,
        minVersionCode,
        storeUrl: "https://play.google.com/store/apps/details?id=com.arunmobi.app",
        packageName: "com.arunmobi.app",
      });
    }

    if (method === "GET" && path === "/api/app-settings") {
      const { data } = await db.from("app_settings").select("key,value").limit(80);
      const out: Record<string, string> = {};
      (data || []).forEach((r: { key?: string; value?: string }) => {
        if (r.key) out[r.key] = String(r.value || "");
      });
      return json(out);
    }

    if (method === "GET" && path === "/api/posts") {
      const limit = Math.min(Number(url.searchParams.get("limit") || "40") || 40, 80);
      const offset = Math.max(0, Number(url.searchParams.get("offset") || "0") || 0);
      const photosFlag = String(url.searchParams.get("photos") || "").trim().toLowerCase();
      const photosOnly = photosFlag === "1" || photosFlag === "true";
      const categoryRaw = String(url.searchParams.get("category") || "").trim().toLowerCase();
      const userRoleRaw = String(
        url.searchParams.get("userRole") || url.searchParams.get("role") || "",
      ).trim().toLowerCase();
      const allowedCategories = new Set(["repair", "job", "training", "supplier", "sell"]);
      const allowedRoles = new Set(["technician", "customer", "teacher", "supplier", "job_provider"]);
      const category = allowedCategories.has(categoryRaw) ? categoryRaw : "";
      const userRole = allowedRoles.has(userRoleRaw) ? userRoleRaw : "";
      const cols = "id,user_id,user_name,user_role,user_avatar,text,images,video_url,category,views,created_at,likes,comments";
      const parseJsonArray = (raw: unknown): unknown[] => {
        if (Array.isArray(raw)) return raw;
        if (typeof raw === "string" && raw.trim() && raw.trim() !== "[]") {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }
        return [];
      };
      const mapRow = (p: Record<string, unknown>) => {
        let images: string[] = [];
        try {
          const raw = p.images;
          if (Array.isArray(raw)) images = raw.map((u) => String(u || "").trim()).filter(Boolean);
          else if (typeof raw === "string" && raw.trim() && raw.trim() !== "[]") {
            if (raw.trim().startsWith("[")) {
              const parsedImages = JSON.parse(raw);
              if (Array.isArray(parsedImages)) images = parsedImages.map((u) => String(u || "").trim()).filter(Boolean);
            } else {
              images = [raw.trim()];
            }
          }
        } catch {
          images = [];
        }
        return {
          id: p.id,
          userId: p.user_id,
          userName: p.user_name,
          userRole: p.user_role,
          userAvatar: p.user_avatar,
          text: p.text,
          images,
          videoUrl: p.video_url,
          category: p.category,
          views: p.views,
          createdAt: p.created_at,
          likes: parseJsonArray(p.likes).map((x) => String(x || "")).filter(Boolean),
          comments: parseJsonArray(p.comments),
        };
      };
      const hasImages = (row: { images?: string[]; videoUrl?: unknown }) =>
        (Array.isArray(row.images) && row.images.length > 0) || Boolean(String(row.videoUrl || "").trim());
      const buildQuery = (withPhotoSql: boolean) => {
        let q = db.from("posts").select(cols).order("created_at", { ascending: false, nullsFirst: false });
        if (category) q = q.eq("category", category);
        if (userRole) q = q.eq("user_role", userRole);
        if (withPhotoSql) q = q.neq("images", "[]");
        return q;
      };

      if (photosOnly) {
        const scan = Math.min(Math.max(offset + limit * 25, 300), 1500);
        const { data: scanRows, error: scanErr } = await buildQuery(false).range(0, scan - 1);
        const mapped = !scanErr
          ? (scanRows || [])
            .map((row) => mapRow(row as Record<string, unknown>))
            .filter(hasImages)
            .slice(offset, offset + limit)
          : [];
        return json(mapped);
      }

      const { data, error } = await buildQuery(false).range(offset, offset + limit - 1);
      if (error) return json([]);
      return json((data || []).map((row) => mapRow(row as Record<string, unknown>)));
    }

    if (method === "GET" && (path === "/api/profiles" || path.startsWith("/api/profiles/"))) {
      const mapProfile = (p: Record<string, unknown>) => {
        let skills: unknown[] = [];
        try {
          skills = p.skills ? JSON.parse(String(p.skills)) : [];
        } catch {
          skills = [];
        }
        const c = camelKeys(p);
        return {
          ...c,
          shopName: c.shopName ?? p.shop_name,
          lastSeen: c.lastSeen ?? p.last_seen,
          createdAt: c.createdAt ?? p.created_at,
          ratingCount: c.ratingCount ?? p.rating_count,
          skills,
          productCount: 0,
        };
      };
        const cols =
        "id,name,phone,email,role,city,state,experience,shop_name,avatar,bio,latitude,longitude,last_seen,created_at,verified,rating,rating_count,is_teacher,teacher_status,subscription_active,subscription_end,trial_end";
      if (path === "/api/profiles") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "3000") || 3000, 1), 5000);
        const offset = Math.max(0, Number(url.searchParams.get("offset") || "0") || 0);
        const role = String(url.searchParams.get("role") || "").trim();
        const pageSize = 1000;
        const rows: Record<string, unknown>[] = [];
        let got = 0;
        while (got < limit) {
          const chunk = Math.min(pageSize, limit - got);
          const from = offset + got;
          let q = db
            .from("profiles")
            .select(cols)
            .is("deleted_at", null);
          if (role) q = q.ilike("role", role);
          const { data, error } = await q
            .order("created_at", { ascending: false, nullsFirst: false })
            .range(from, from + chunk - 1);
          if (error) {
            if (!rows.length) return json([]);
            break;
          }
          const batch = (data || []) as Record<string, unknown>[];
          rows.push(...batch);
          got += batch.length;
          if (batch.length < chunk) break;
        }
        return json(rows.map((p) => mapProfile(p)));
      }
      const id = path.slice("/api/profiles/".length).split("/")[0];
      if (id) {
        const { data, error } = await db.from("profiles").select(cols).eq("id", id).maybeSingle();
        if (error || !data) return json({ success: false, message: "Profile not found" }, 404);
        return json(mapProfile(data as Record<string, unknown>));
      }
    }

    if (method === "GET" && path === "/api/jobs") {
      const { data, error } = await db
        .from("jobs")
        .select("*")
        .eq("approved", 1)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) {
        const fallback = await db.from("jobs").select("*").order("created_at", { ascending: false }).limit(40);
        const rows = fallback.data || [];
        return json(rows.map(mapJobRow));
      }
      return json((data || []).map(mapJobRow));
    }

    if (method === "POST" && path === "/api/heartbeat") {
      const body = await req.json().catch(() => ({})) as { userId?: string };
      if (!body.userId) return json({ success: false }, 400);
      await db.from("profiles").update({ last_seen: Date.now() }).eq("id", body.userId);
      return json({ success: true, timestamp: Date.now() });
    }

    if (method === "POST" && path === "/api/session/validate") {
      const body = await req.json().catch(() => ({})) as { sessionToken?: string; phone?: string };
      const sessionToken = String(body.sessionToken || "").trim();
      const phone = String(body.phone || "").trim();
      if (!sessionToken || !phone) {
        return json({ valid: false, reason: "missing", message: null, userId: null, userName: null, userAvatar: null });
      }
      const { data: sessionRows, error: sErr } = await db
        .from("sessions")
        .select("phone")
        .eq("session_token", sessionToken)
        .limit(1);
      if (sErr) {
        return json({ valid: true, reason: "error_fail_open", message: null, userId: null, userName: null, userAvatar: null });
      }
      if (!sessionRows?.[0]) {
        return json({ valid: false, reason: "no_session", message: null, userId: null, userName: null, userAvatar: null });
      }
      const sessionPhone = String(sessionRows[0].phone || "");
      const p = await findProfileForSession(db, sessionPhone, phone);
      if (!p) {
        return json({
          valid: false,
          reason: "account_removed",
          message: "This account was removed. Please sign in again.",
          userId: null,
          userName: null,
          userAvatar: null,
        });
      }
      if (isEmailSessionKey(sessionPhone) && digits10(String(p.phone || ""))) {
        await rebindSessionToPhone(db, {
          sessionToken,
          email: emailFromSessionKey(sessionPhone) || String(p.email || ""),
          phone: String(p.phone || ""),
        });
      }
      return json({
        valid: true,
        reason: null,
        message: null,
        userId: String(p.id || ""),
        userName: String(p.name || ""),
        userAvatar: p.avatar != null ? String(p.avatar) : "",
      });
    }

    if (method === "GET" && (path === "/api/reels/feed" || path === "/api/reels")) {
      const cursor = url.searchParams.get("cursor") || "";
      const t = cursor ? Date.parse(cursor) : NaN;
      const pageSize = 50;
      let q = db.from("mobi_reels").select("*").order("created_at", { ascending: false }).limit(pageSize + 1);
      if (Number.isFinite(t)) q = q.lt("created_at", t);
      const { data, error } = await q;
      if (error) return json({ reels: [], nextCursor: null, deferred: true });
      const rows = data || [];
      const hasMore = rows.length > pageSize;
      const page = hasMore ? rows.slice(0, pageSize) : rows;
      const last = page[page.length - 1] as { created_at?: number } | undefined;
      const nextCursor =
        hasMore && last?.created_at != null ? new Date(Number(last.created_at)).toISOString() : null;
      const stuck = page
        .map((raw) => raw as Record<string, unknown>)
        .filter((r) => String(r.stream_status || "").trim() === "processing")
        .slice(0, 3);
      const flipped = new Map<string, string>();
      await Promise.all(stuck.map(async (r) => {
        const uid = extractStreamUid(r.cf_stream_uid) || extractStreamUid(r.video_url) || String(r.cf_stream_uid || "");
        const next = await resolveReelStreamLifecycle({ uid, videoUrl: String(r.video_url || "") });
        if (next === "processing") return;
        const id = String(r.id || "");
        if (!id) return;
        await db.from("mobi_reels").update({ stream_status: next }).eq("id", id);
        flipped.set(id, next);
      }));
      const refreshed = page.map((raw) => {
        const r = raw as Record<string, unknown>;
        const next = flipped.get(String(r.id || ""));
        return next ? { ...r, stream_status: next } : r;
      });
      return json({ reels: refreshed.map((r) => mapReel(r as Record<string, unknown>)), nextCursor });
    }

    if (method === "GET" && path === "/api/products") {
      const userId = url.searchParams.get("supplierId") || url.searchParams.get("userId") || "";
      const role = url.searchParams.get("role") || "";
      let q = db.from("products").select("*").order("created_at", { ascending: false }).limit(500);
      if (userId) q = q.eq("user_id", userId);
      else if (role) q = q.eq("user_role", role);
      const { data, error } = await q;
      if (error) return json([]);
      const parsed = (data || []).map((p: Record<string, unknown>) => {
        let images: unknown[] = [];
        let likes: unknown[] = [];
        try {
          images = typeof p.images === "string" ? JSON.parse(p.images) : p.images || [];
        } catch {
          images = [];
        }
        try {
          likes = typeof p.likes === "string" ? JSON.parse(String(p.likes)) : p.likes || [];
        } catch {
          likes = [];
        }
        return { ...camelKeys(p), images, likes };
      });
      return json(parsed);
    }

    if (method === "POST" && path === "/api/otp/verify") {
      const body = (await req.json().catch(() => ({}))) as {
        phone?: string;
        email?: string;
        otp?: string;
        deviceId?: string;
        supabaseAccessToken?: string;
      };
      const email = normalizeEmailAddr(String(body.email || ""));
      const phone = digits10(String(body.phone || ""));
      const otpCode = otpDigitsOnly(body.otp).slice(-6);
      const isEmail = Boolean(email) && !phone;
      if (!phone && !email) return json({ success: false, message: "Phone or email required" }, 400);
      if (otpCode.length !== 6 && !(email === "admin@mobi.app" && isEmail) && !body.supabaseAccessToken) {
        return json({ success: false, message: "Enter the 6-digit code from your email." }, 400);
      }

      let verified = email === "admin@mobi.app" && isEmail;
      if (!verified && !isEmail && isAdminSecretOtp(phone, otpCode)) verified = true;
      if (!verified && isEmail && body.supabaseAccessToken) {
        const { data } = await db.auth.getUser(String(body.supabaseAccessToken));
        const tokenEmail = normalizeEmailAddr(String(data?.user?.email || ""));
        if (tokenEmail && (!email || tokenEmail === email)) verified = true;
      }
      if (!verified && otpCode.length === 6) {
        if (isEmail) {
          const { rows, error } = await loadEmailOtpRows(db, email);
          if (error) return json({ success: false, message: error.message || "Could not check OTP" }, 500);
          const now = Date.now();
          const unexpired = rows.filter((r) => expiryMs(r.expires_at) >= now);
          if (!unexpired.length) {
            return json({
              success: false,
              message: rows.length
                ? "OTP has expired. Please request a new one."
                : "OTP not found or already used. Request a new code.",
            }, 400);
          }
          verified = unexpired.some((r) => otpDigitsOnly(r.otp).slice(-6) === otpCode);
        } else {
          const { data: rows } = await db.from("otp_tokens").select("otp,expires_at,phone").eq("phone", phone).limit(5);
          const row = (rows || [])[0] as { otp?: string; expires_at?: number } | undefined;
          const stored = otpDigitsOnly(row?.otp).slice(-6);
          if (row && stored === otpCode && expiryMs(row.expires_at) >= Date.now()) verified = true;
        }
      }
      if (!verified) return json({ success: false, message: "Invalid OTP. Please try again." }, 400);

      let existingProfile: Record<string, unknown> | null = null;
      if (isEmail) {
        let pq = db.from("profiles").select("*").ilike("email", email).limit(20);
        let { data: profiles, error: pErr } = await pq;
        if (pErr && /deleted_at/i.test(pErr.message || "")) {
          const retry = await db.from("profiles").select("*").ilike("email", email).limit(20);
          profiles = retry.data;
          pErr = retry.error;
        }
        if (pErr) return json({ success: false, message: pErr.message }, 500);
        const active = (profiles || []).filter((p: Record<string, unknown>) => p.deleted_at == null || p.deleted_at === "");
        existingProfile = (active[0] || null) as Record<string, unknown> | null;
      } else {
        const { data: profiles } = await db
          .from("profiles")
          .select("*")
          .in("phone", [phone, `91${phone}`, `+91${phone}`])
          .limit(20);
        existingProfile = ((profiles || [])[0] || null) as Record<string, unknown> | null;
      }
      const rawPhone = existingProfile ? String(existingProfile.phone || "").trim() : "";
      const sessionPhone = isEmail ? (rawPhone || `email:${email}`) : phone;
      const sessionToken = crypto.randomUUID();
      const { error: delSessErr } = await db.from("sessions").delete().eq("phone", sessionPhone);
      if (delSessErr) console.error("[otp-verify] session delete", delSessErr.message);
      const { error: sessErr } = await db.from("sessions").insert({ phone: sessionPhone, session_token: sessionToken });
      if (sessErr) return json({ success: false, message: `Verified but session failed: ${sessErr.message}` }, 500);
      if (isEmail) await db.from("otp_tokens").delete().ilike("email", email);
      else await db.from("otp_tokens").delete().eq("phone", phone);
      return json({
        success: true,
        message: isEmail ? "Email verified successfully" : "Phone number verified successfully",
        sessionToken,
        isEmailVerification: isEmail,
        isNewUser: !existingProfile,
        profile: existingProfile ? camelKeys(existingProfile) : null,
      });
    }

    if (method === "POST" && path === "/api/otp/send") {
      const body = (await req.json().catch(() => ({}))) as { phone?: string; email?: string; forceResend?: boolean };
      const email = normalizeEmailAddr(String(body.email || ""));
      const phone = digits10(String(body.phone || ""));
      if (!phone && !email) return json({ success: false, sent: false, message: "Phone number or email is required" }, 400);
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = Date.now() + OTP_TTL_MS;
      const tokenRow: Record<string, unknown> = { otp, expires_at: expiresAt, created_at: Date.now() };
    if (email) {
      const forceResend = body.forceResend === true;
      let otpToSend = otp;
      if (!forceResend) {
        const { rows } = await loadEmailOtpRows(db, email);
        const live = rows.find((r) => expiryMs(r.expires_at) >= Date.now() && otpDigitsOnly(r.otp).length >= 6);
        if (live) otpToSend = otpDigitsOnly(live.otp).slice(-6);
      }
      if (otpToSend === otp) {
        await db.from("otp_tokens").delete().ilike("email", email);
        const { error } = await db.from("otp_tokens").insert({ ...tokenRow, email, otp: otpToSend });
        if (error) return json({ success: false, sent: false, message: error.message }, 500);
      } else {
        await db.from("otp_tokens").update({ expires_at: expiresAt }).ilike("email", email);
      }
      const mailed = await sendOtpEmail(email, otpToSend);
      if (!mailed.ok) {
        await db.from("otp_tokens").delete().ilike("email", email);
        return json({
          success: false,
          sent: false,
          message: mailed.error || "Failed to send OTP email. Try again.",
        }, 502);
      }
      return json({ success: true, sent: true, smsSent: false, message: "OTP sent. Check your email." });
    }
      await db.from("otp_tokens").delete().eq("phone", phone);
      const { error } = await db.from("otp_tokens").insert({ ...tokenRow, phone });
      if (error) return json({ success: false, sent: false, message: error.message }, 500);

      const apiHomeKey = String(Deno.env.get("API_HOME_API_KEY") || "").trim();
      const fastKey = String(Deno.env.get("FAST2SMS_API_KEY") || "").trim();
      let delivered = false;
      let providerOtp = otp;
      let sendErr = "";
      let provider = "";

      if (apiHomeKey) {
        const home = await sendOtpViaApiHome(phone, otp);
        provider = "apihome";
        if (home.ok) {
          delivered = true;
          if (home.providerOtp) providerOtp = home.providerOtp;
        } else {
          sendErr = home.error || "API Home failed";
          if (home.providerOtp) providerOtp = home.providerOtp;
          console.warn("[otp-sms] API Home failed, trying Fast2SMS:", sendErr.slice(0, 180));
        }
      }
      if (!delivered && fastKey) {
        const fast = await sendOtpViaFast2Sms(phone, otp);
        if (fast.ok) {
          delivered = true;
          provider = "fast2sms";
          providerOtp = otp;
          sendErr = "";
        } else if (!sendErr) {
          sendErr = fast.error || "Fast2SMS failed";
        } else {
          sendErr = `${sendErr}; Fast2SMS: ${fast.error || "failed"}`;
        }
      }

      if (providerOtp !== otp) {
        await db.from("otp_tokens").update({ otp: providerOtp }).eq("phone", phone);
      }

      if (!delivered) {
        if (!fastKey && !apiHomeKey) {
          return json({
            success: false,
            sent: false,
            smsSent: false,
            message: "SMS is not configured on Supabase. Set API_HOME_API_KEY (or FAST2SMS_API_KEY) as an Edge secret.",
          }, 502);
        }
        await db.from("otp_tokens").delete().eq("phone", phone);
        if (phone === ADMIN_SECRET_OTP_PHONE) {
          return json({
            success: true,
            sent: true,
            smsSent: false,
            provider,
            message: `OTP sent to ${phone}`,
          });
        }
        return json({
          success: false,
          sent: false,
          smsSent: false,
          provider,
          message: `Could not deliver OTP: ${String(sendErr || "SMS failed").replace(/\b\d{6}\b/g, "").slice(0, 180)}`,
        }, 502);
      }

      return json({
        success: true,
        sent: true,
        smsSent: true,
        provider,
        message: `OTP sent to ${phone}`,
      });
    }

    if (method === "POST" && path === "/api/posts") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const id = crypto.randomUUID();
      const rawImages = body.images;
      let imageList: string[] = [];
      if (Array.isArray(rawImages)) {
        imageList = rawImages.map((u) => String(u || "").trim()).filter(Boolean);
      } else if (typeof rawImages === "string" && rawImages.trim() && rawImages.trim() !== "[]") {
        try {
          const parsed = JSON.parse(rawImages);
          if (Array.isArray(parsed)) imageList = parsed.map((u) => String(u || "").trim()).filter(Boolean);
          else imageList = [rawImages.trim()];
        } catch {
          imageList = [rawImages.trim()];
        }
      }
      const images = JSON.stringify(imageList);
      const row = {
        id,
        user_id: String(body.userId || ""),
        user_name: String(body.userName || ""),
        user_role: String(body.userRole || ""),
        user_avatar: String(body.userAvatar || ""),
        text: String(body.text || ""),
        images,
        video_url: String(body.videoUrl || ""),
        category: String(body.category || "repair"),
        views: 0,
        created_at: Date.now(),
      };
      const thumbFromBody = String(body.thumbnailUrl || "").trim();
      const firstPhoto =
        imageList.find((u) => /^https:\/\//i.test(u))
        || (/^https:\/\//i.test(thumbFromBody) ? thumbFromBody : "")
        || cfStreamThumb(String(row.video_url || ""))
        || "";
      const { error } = await db.from("posts").insert(row);
      if (error) return json({ success: false, message: error.message }, 500);
      await Promise.race([
        notifyNewPost(
          db,
          row.text,
          row.user_name,
          row.user_id,
          firstPhoto,
          id,
          row.video_url ? "video" : firstPhoto ? "photo" : "",
        ),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
      return json({
        success: true,
        post: {
          id,
          userId: row.user_id,
          userName: row.user_name,
          userRole: row.user_role,
          userAvatar: row.user_avatar,
          text: row.text,
          images: imageList,
          videoUrl: row.video_url,
          category: row.category,
          views: 0,
          createdAt: row.created_at,
          likes: [],
          comments: [],
        },
      });
    }

    if (method === "POST" && path === "/api/profiles") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const id = String(body.id || crypto.randomUUID());
      const { error } = await db.from("profiles").upsert({
        id,
        name: body.name,
        phone: body.phone,
        email: body.email,
        role: body.role,
        city: body.city,
        state: body.state,
        experience: body.experience,
        shop_name: body.shopName,
        bio: body.bio,
        avatar: body.avatar,
        latitude: body.latitude,
        longitude: body.longitude,
      });
      if (error) return json({ success: false, message: error.message }, 500);
      await rebindSessionToPhone(db, {
        sessionToken: String(req.headers.get("x-session-token") || body.sessionToken || ""),
        email: String(body.email || ""),
        phone: String(body.phone || ""),
      });
      return json({ success: true, id });
    }

    if (method === "POST" && (path === "/api/upload" || path === "/api/upload-image" || path === "/api/upload-base64" || path === "/api/admin/upload-push-image")) {
      const bucket = (Deno.env.get("SUPABASE_STORAGE_BUCKET") || "media").trim();
      const supUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
      let bytes: Uint8Array | null = null;
      let contentType = "image/jpeg";
      let ext = "jpg";
      const headerCt = (req.headers.get("content-type") || "").toLowerCase();
      const asBase64 = async (rawB64: string, mime: string) => {
        const b64 = String(rawB64 || "").replace(/^data:[^;]+;base64,/, "");
        if (!b64) return;
        if (b64.length > 4_500_000) throw new Error("Image is too large. Please choose a smaller photo.");
        const bin = atob(b64);
        bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        contentType = mime || "image/jpeg";
        if (contentType.includes("png")) ext = "png";
        else if (contentType.includes("webp")) ext = "webp";
        else ext = "jpg";
      };
      try {
        if (path === "/api/upload-base64" || headerCt.includes("application/json")) {
          const body = (await req.json().catch(() => ({}))) as { base64?: string; mimeType?: string; image?: string };
          await asBase64(String(body.base64 || body.image || ""), String(body.mimeType || "image/jpeg"));
        } else {
          const form = await req.formData();
          let file: File | Blob | null = null;
          let fileName = "photo.jpg";
          for (const [key, value] of form.entries()) {
            if (typeof value === "string") {
              if (!bytes && (key === "base64" || key === "image") && value.length > 80) {
                await asBase64(value, "image/jpeg");
              }
              continue;
            }
            file = value as File;
            fileName = (value as File).name || key || fileName;
            break;
          }
          if (!bytes && file) {
            bytes = new Uint8Array(await file.arrayBuffer());
            contentType = (file as File).type || "image/jpeg";
            const named = String(fileName || "photo.jpg");
            ext = (named.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not read photo";
        return json({ success: false, message: msg }, msg.includes("too large") ? 413 : 400);
      }
      if (!bytes?.length) return json({ success: false, message: "No photo received. Please pick the image again." }, 400);
      if (bytes.length > 4 * 1024 * 1024) {
        return json({ success: false, message: "Image is too large. Please choose a smaller photo." }, 413);
      }
      if (!contentType || contentType === "application/octet-stream") contentType = "image/jpeg";
      if (!["jpg", "jpeg", "png", "webp", "gif"].includes(ext.toLowerCase())) ext = "jpg";
      const folder = path === "/api/upload-image" ? "images" : "uploads";
      const key = `${folder}/${crypto.randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;
      const { error } = await db.storage.from(bucket).upload(key, bytes, { contentType, upsert: true });
      if (error) return json({ success: false, message: error.message || "Storage upload failed" }, 500);
      const publicUrl = `${supUrl}/storage/v1/object/public/${bucket}/${key}`;
      return json({ success: true, url: publicUrl });
    }

    if (method === "POST" && (path === "/api/storage/signed-upload" || path === "/api/upload-sign")) {
      const bucket = (Deno.env.get("SUPABASE_STORAGE_BUCKET") || "media").trim();
      const supUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
      const key = `images/${crypto.randomUUID()}.jpg`;
      const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(key);
      if (error || !data?.signedUrl) {
        return json({ success: false, message: error?.message || "Could not start photo upload" }, 500);
      }
      return json({
        success: true,
        path: key,
        token: data.token,
        signedUrl: data.signedUrl,
        publicUrl: `${supUrl}/storage/v1/object/public/${bucket}/${key}`,
      });
    }

    if (method === "POST" && path === "/api/reels/like-toggle") {
      const body = (await req.json().catch(() => ({}))) as { reelId?: string; phone?: string };
      const reelId = String(body.reelId || "").trim();
      const sessionTok = req.headers.get("x-session-token") || "";
      const { data: sess } = await db.from("sessions").select("phone").eq("session_token", sessionTok).maybeSingle();
      const phone = digits10(String(sess?.phone || body.phone || ""));
      const { data: prof } = await db.from("profiles").select("id").in("phone", [phone, `91${phone}`]).limit(1);
      const uid = String(prof?.[0]?.id || "");
      if (!uid || !reelId) return json({ error: "Unauthorized" }, 401);
      const { data: existing } = await db.from("mobi_reel_likes").select("id").eq("reel_id", reelId).eq("user_id", uid).maybeSingle();
      if (existing) {
        await db.from("mobi_reel_likes").delete().eq("reel_id", reelId).eq("user_id", uid);
        return json({ success: true, liked: false });
      }
      await db.from("mobi_reel_likes").insert({ user_id: uid, reel_id: reelId });
      return json({ success: true, liked: true });
    }

    if (method === "POST" && (path === "/api/reels/cf-direct-upload" || path === "/api/reels/direct-upload")) {
      try {
        const started = await createStreamDirectUploadOrFree(db, { maxDurationSeconds: 21600 });
        const host = cfCustomerHost();
        const uid = started.uid;
        const playbackUrl = host ? `https://${host}/${uid}/manifest/video.m3u8` : "";
        const thumbnailUrl = host ? `https://${host}/${uid}/thumbnails/thumbnail.jpg` : "";
        return json({
          success: true,
          id: crypto.randomUUID(),
          uid,
          uploadURL: started.uploadURL,
          playbackUrl,
          thumbnailUrl,
        });
      } catch (e) {
        return json({
          success: false,
          message: e instanceof Error ? e.message : "Could not start Cloudflare upload",
        }, 502);
      }
    }

    if (method === "POST" && (path === "/api/reels/finalize" || path === "/api/reels/cf-finalize" || path === "/api/reels/direct-finalize")) {
      const body = (await req.json().catch(() => ({}))) as { uid?: string; phone?: string; caption?: string };
      const uid = String(body.uid || "").trim();
      const host = cfCustomerHost();
      if (!uid || !host) return json({ success: false, message: "uid required / CLOUDFLARE_STREAM_CUSTOMER_HOST missing" }, 400);
      const playbackUrl = `https://${host}/${uid}/manifest/video.m3u8`;
      const thumbUrl = `https://${host}/${uid}/thumbnails/thumbnail.jpg`;
      const sessionTok = req.headers.get("x-session-token") || "";
      const { data: sess } = await db.from("sessions").select("phone").eq("session_token", sessionTok).maybeSingle();
      const phone = digits10(String(sess?.phone || body.phone || ""));
      const { data: prof } = await db.from("profiles").select("id,name,avatar").in("phone", [phone, `91${phone}`]).limit(1);
      const u = prof?.[0];
      if (!u) return json({ error: "Unauthorized" }, 401);
      const streamStatus = await resolveReelStreamLifecycle({ uid, videoUrl: playbackUrl });
      const { data: inserted, error } = await db.from("mobi_reels").insert({
        user_id: u.id,
        user_display_name: u.name || "User",
        user_avatar: u.avatar || "",
        video_url: playbackUrl,
        thumbnail_url: thumbUrl,
        caption: String(body.caption || "").slice(0, 2000),
        cf_stream_uid: uid,
        stream_status: streamStatus,
      }).select("*").single();
      if (error) return json({ error: error.message }, 500);
      return json({
        success: true,
        videoId: uid,
        playbackUrl,
        thumbnailUrl: thumbUrl,
        streamStatus,
        reel: mapReel(inserted as Record<string, unknown>),
      });
    }

    if (method === "GET" && /\/api\/reels\/[^/]+\/stream-status$/.test(path)) {
      const id = path.split("/")[3];
      const { data } = await db.from("mobi_reels").select("*").eq("id", id).maybeSingle();
      if (!data) return json({ error: "Not found" }, 404);
      const row = data as Record<string, unknown>;
      const statusRaw = String(row.stream_status || "ready").trim();
      if (statusRaw === "ready" || statusRaw === "error") {
        return json({ reel: mapReel(row) });
      }
      const uid = extractStreamUid(row.cf_stream_uid) || extractStreamUid(row.video_url) || String(row.cf_stream_uid || "");
      const next = await resolveReelStreamLifecycle({
        uid,
        videoUrl: String(row.video_url || ""),
      });
      if (next !== statusRaw) {
        await db.from("mobi_reels").update({ stream_status: next }).eq("id", id);
        const { data: updated } = await db.from("mobi_reels").select("*").eq("id", id).maybeSingle();
        console.log("[reels] stream-status updated", { id, from: statusRaw, to: next, uid });
        return json({ reel: mapReel((updated || row) as Record<string, unknown>) });
      }
      return json({ reel: mapReel(row) });
    }

    try {
      const extra = await handleExtraRoutes({ db, req, method, path, url, json });
      if (extra) return extra;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ success: false, message: msg }, 500);
    }

    const proxied = await proxyUpstream(req, path);
    if (proxied) return proxied;

    return json({ success: false, message: "Not found", path }, 404);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (path === "/api/session/validate") {
      return json({ valid: true, reason: "error_fail_open", message: null, userId: null, userName: null, userAvatar: null });
    }
    return json({ success: false, message: msg, deferred: true }, 200);
  }
});
