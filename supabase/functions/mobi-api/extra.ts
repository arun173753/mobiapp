import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handlePaymentRoutes, ensureTechnicianSubscriptionPlans } from "./payments.ts";
import { handleSpareCatalogRoutes } from "./spare.ts";
import { handleSolutionsAdminRoutes } from "./solutions-admin.ts";
import { createStreamDirectUpload, createStreamDirectUploadOrFree, isStreamQuotaError } from "./stream-quota.ts";
import { encodeR2ObjectKey, getBufferFromR2, getR2ObjectResponse, isR2UploadConfigured, sanitizeR2ObjectKey, signR2PutUrl } from "./r2-upload.ts";
import { r2CompleteMultipartUpload, r2CreateMultipartUpload, r2UploadPart } from "./r2-multipart.ts";
import { handlePushRoutes, notifyUser, sendNotification, broadcastPush, notifyUsersByRole, subscriptionCongrats, resolveNotificationImage, notifyNewCourse } from "./push.ts";
import { listNearbyProviders } from "./nearby.ts";

type JsonFn = (body: unknown, status?: number) => Response;

export function camelKeys(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!row) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = v;
  }
  return out;
}

function toSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const snake = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    out[snake] = v;
  }
  return out;
}

const LIVE_PRESENCE_TTL_MS = 45_000;
const LIVE_PRESENCE_KEY_PREFIX = "live_presence:";

function livePresenceSettingKey(userId: string): string {
  return `${LIVE_PRESENCE_KEY_PREFIX}${userId}`;
}

async function saveLiveChatPresence(
  db: SupabaseClient,
  user: { id: string; name: string; role: string; avatar: string },
): Promise<void> {
  const now = Date.now();
  const row = {
    user_id: user.id,
    name: user.name,
    role: user.role,
    avatar: user.avatar,
    last_seen: now,
  };
  const { error } = await db.from("live_chat_presence").upsert(row, { onConflict: "user_id" });
  if (!error) {
    await db.from("profiles").update({ last_seen: now }).eq("id", user.id);
    return;
  }
  const key = livePresenceSettingKey(user.id);
  const value = JSON.stringify({
    id: user.id,
    name: user.name,
    role: user.role,
    avatar: user.avatar,
    lastSeen: now,
  });
  const { data: existing } = await db.from("app_settings").select("id").eq("key", key).maybeSingle();
  if (existing?.id) {
    await db.from("app_settings").update({ value, updated_at: now }).eq("id", existing.id);
  } else {
    await db.from("app_settings").insert({ id: crypto.randomUUID(), key, value, updated_at: now });
  }
  await db.from("profiles").update({ last_seen: now }).eq("id", user.id);
}

async function removeLiveChatPresence(db: SupabaseClient, userId: string): Promise<void> {
  const id = String(userId || "").trim();
  if (!id) return;
  await db.from("live_chat_presence").delete().eq("user_id", id);
  await db.from("app_settings").delete().eq("key", livePresenceSettingKey(id));
}

async function listLiveChatOnline(db: SupabaseClient): Promise<{ id: string; name: string; role: string; avatar: string }[]> {
  const since = Date.now() - LIVE_PRESENCE_TTL_MS;
  const { data, error } = await db
    .from("live_chat_presence")
    .select("user_id,name,role,avatar,last_seen")
    .gte("last_seen", since)
    .limit(200);
  if (!error) {
    return (data || []).map((r) => ({
      id: String((r as { user_id?: string }).user_id || ""),
      name: String((r as { name?: string }).name || ""),
      role: String((r as { role?: string }).role || ""),
      avatar: String((r as { avatar?: string }).avatar || ""),
    })).filter((u) => u.id);
  }
  const { data: settings } = await db
    .from("app_settings")
    .select("key,value")
    .like("key", `${LIVE_PRESENCE_KEY_PREFIX}%`)
    .limit(300);
  const fromSettings: { id: string; name: string; role: string; avatar: string }[] = [];
  for (const row of settings || []) {
    try {
      const u = JSON.parse(String((row as { value?: string }).value || "{}")) as Record<string, unknown>;
      if (Date.now() - Number(u.lastSeen || 0) > LIVE_PRESENCE_TTL_MS) continue;
      const id = String(u.id || "").trim();
      if (!id) continue;
      fromSettings.push({
        id,
        name: String(u.name || ""),
        role: String(u.role || ""),
        avatar: String(u.avatar || ""),
      });
    } catch {
      /* ignore bad rows */
    }
  }
  if (fromSettings.length) return fromSettings;
  const { data: profs } = await db
    .from("profiles")
    .select("id,name,role,avatar")
    .gte("last_seen", Date.now() - 2 * 60 * 1000)
    .limit(80);
  return (profs || []).map((r) => ({
    id: String((r as { id?: string }).id || ""),
    name: String((r as { name?: string }).name || ""),
    role: String((r as { role?: string }).role || ""),
    avatar: String((r as { avatar?: string }).avatar || ""),
  })).filter((u) => u.id);
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const raw = key instanceof Uint8Array ? key : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mimeFromFilename(name: string, mime = "", kind = ""): string {
  const stored = String(mime || "").trim().toLowerCase();
  if (stored && stored !== "application/octet-stream" && stored !== "binary/octet-stream") return stored;
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".bmp")) return "image/bmp";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".avif")) return "image/avif";
  if (/\.(tif|tiff)$/.test(n)) return "image/tiff";
  if (/\.(jpe?g|jfif|pjpeg|pjp)$/.test(n)) return "image/jpeg";
  if (n.endsWith(".pdf") || kind === "pdf") return "application/pdf";
  if (kind === "image") return "image/jpeg";
  return stored || "application/octet-stream";
}

function inferSolutionsFileKind(name: string, mime = "", stored = ""): string {
  const k = String(stored || "").toLowerCase().trim();
  if (k === "pdf" || k === "image" || k === "video") return k;
  const n = String(name || "").toLowerCase();
  const m = String(mime || "").toLowerCase();
  if (m.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (
    m.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|bmp|tiff?|jfif|pjpeg|pjp|svg|avif|heic|heif|ico)$/i.test(n)
  ) {
    return "image";
  }
  if (m.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(n)) return "video";
  return k || "other";
}

async function signR2GetUrl(
  keyRaw: string,
  expiresInSeconds = 3600,
  opts?: { responseContentType?: string; inline?: boolean },
): Promise<string> {
  const key = String(keyRaw || "").trim();
  if (!key) return "";
  if (/^https?:\/\//i.test(key)) return key;
  const accountId = String(Deno.env.get("CLOUDFLARE_ACCOUNT_ID") || "").trim();
  const accessKeyId = String(Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID") || "").trim();
  const secretAccessKey = String(Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") || "").trim();
  const bucket = String(Deno.env.get("CLOUDFLARE_R2_BUCKET") || "").trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return "";
  try {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const credential = `${accessKeyId}/${dateStamp}/auto/s3/aws4_request`;
  const encodedKey = encodeR2ObjectKey(key);
  const canonicalUri = `/${bucket}/${encodedKey}`;
  const qs: string[][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(Math.max(30, Math.min(expiresInSeconds, 24 * 3600)))],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const ct = String(opts?.responseContentType || "").trim();
  if (ct) qs.push(["response-content-type", ct]);
  if (opts?.inline) qs.push(["response-content-disposition", "inline"]);
  const canonicalQuery = qs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join("&");
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const hash = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalRequest)));
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, `${dateStamp}/auto/s3/aws4_request`, hash].join("\n");
  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, "auto");
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  } catch {
    return "";
  }
}

async function signSolutionsContentToken(fileId: string, exp: number): Promise<string> {
  const secret = String(
    Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      "",
  ).trim();
  if (!secret) return "";
  return toHex(await hmacSha256(new TextEncoder().encode(secret), `${fileId}.${exp}`));
}

async function solutionsContentTokenOk(fileId: string, expRaw: string, sigRaw: string): Promise<boolean> {
  const exp = Number(expRaw || 0);
  const sig = String(sigRaw || "").trim().toLowerCase();
  if (!fileId || !sig || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await signSolutionsContentToken(fileId, exp);
  return !!expected && expected === sig;
}

type FolderCat = { name: string; files: { id: string; name: string; mime: string; kind: string; thumbnailKey: string }[]; folderImageKey: string; folderId: string };
type FolderModel = { name: string; categories: Map<string, FolderCat>; brandImageKey: string; isDemo: boolean; fileCount: number };

function solutionsModelKey(name: unknown): string {
  return String(name || "").trim().toLowerCase();
}

function solutionsDemoOn(v: unknown): boolean {
  if (v === true || v === 1 || v === "1") return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "on";
}

async function isSolutionsModelDemo(
  db: SupabaseClient,
  library: string,
  modelName: string,
): Promise<boolean> {
  const wanted = solutionsModelKey(modelName);
  if (!wanted) return false;
  const lib = String(library || "hardware").trim().toLowerCase() || "hardware";
  try {
    const { data, error } = await db
      .from("solutions_folders")
      .select("is_demo,model")
      .eq("content_library", lib)
      .limit(4000);
    if (!error) {
      return ((data || []) as { is_demo?: unknown; model?: unknown }[]).some(
        (r) => solutionsModelKey(r.model) === wanted && solutionsDemoOn(r.is_demo),
      );
    }
  } catch {
    /* fall through */
  }
  try {
    const { data: rows } = await db
      .from("solutions_folders")
      .select("is_demo,model")
      .eq("content_library", lib)
      .ilike("model", String(modelName || "").trim())
      .limit(400);
    return ((rows || []) as { is_demo?: unknown }[]).some((r) => solutionsDemoOn(r.is_demo));
  } catch {
    return false;
  }
}

function cfThumbUrl(uid: string): string {
  const id = String(uid || "").trim();
  if (!id || /^https?:\/\//i.test(id)) return "";
  const host = cfCustomerHost() || "videodelivery.net";
  return `https://${host}/${id}/thumbnails/thumbnail.jpg`;
}

function fileThumbKey(r: Record<string, unknown>): string {
  const custom = String(r.thumbnail_url || "").trim();
  if (custom) return custom;
  const ub = String(r.uploaded_by || "");
  const marker = "\nTHUMB:";
  const i = ub.indexOf(marker);
  if (i >= 0) return ub.slice(i + marker.length).trim().split(/\s/)[0];
  if (String(r.kind || "").toLowerCase() === "video") {
    const provider = String(r.provider || "").toLowerCase();
    const uid = String(r.object_key || r.storage_path || "").trim();
    if (provider === "cloudflare_stream" && uid) return cfThumbUrl(uid);
  }
  return "";
}

function mobiPublicApiBase(): string {
  const explicit = String(Deno.env.get("MOBI_API_PUBLIC_URL") || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const sup = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  return sup ? `${sup}/functions/v1/mobi-api` : "";
}

function fileThumbPublicUrl(id: string, key: string): string {
  const base = mobiPublicApiBase();
  const fileId = String(id || "").trim();
  const raw = String(key || "").trim();
  if (!fileId || !raw || !base) return "";
  return `${base}/file/${encodeURIComponent(fileId)}/thumb?v=${encodeURIComponent(raw.slice(-40))}`;
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[8] === 0x57) return "image/webp";
  return "image/jpeg";
}

async function solutionsFolderTree(db: SupabaseClient, library: string) {
  const wanted = String(library || "hardware").trim().toLowerCase() || "hardware";
  const matchLib = (row: Record<string, unknown>) => {
    const lib = String(row.content_library || "hardware").trim().toLowerCase() || "hardware";
    return lib === wanted;
  };
  let files: Record<string, unknown>[] = [];
  let folders: Record<string, unknown>[] = [];
  try {
    const [allFiles, allFolders] = await Promise.all([
      pageAllRows(db, "solutions_files", "id,model,category,filename,mime_type,kind,thumbnail_url,uploaded_by,provider,object_key,storage_path,public_url,content_library,created_at").catch(() => pageAllRows(db, "solutions_files", "*")),
      pageAllRows(db, "solutions_folders", "id,model,category,brand_image_url,folder_image_url,content_library,is_demo,created_at").catch(() => pageAllRows(db, "solutions_folders", "*")),
    ]);
    files = allFiles.filter(matchLib);
    folders = allFolders.filter(matchLib);
  } catch (e) {
    console.warn("[solutions tree]", e instanceof Error ? e.message : e);
    const [{ data: filesRaw }, { data: foldersRaw }] = await Promise.all([
      db.from("solutions_files").select("*").order("created_at", { ascending: false }).limit(1000),
      db.from("solutions_folders").select("*").order("created_at", { ascending: false }).limit(1000),
    ]);
    files = ((filesRaw || []) as Record<string, unknown>[]).filter(matchLib);
    folders = ((foldersRaw || []) as Record<string, unknown>[]).filter(matchLib);
  }
  const modelMap = new Map<string, FolderModel>();
  const folderIdByKey = new Map<string, string>();
  const nameFileCounts = new Map<string, number>();
  const ensureModel = (mName: string): FolderModel => {
    const key = solutionsModelKey(mName);
    if (!modelMap.has(key)) {
      modelMap.set(key, { name: mName, categories: new Map(), brandImageKey: "", isDemo: false, fileCount: 0 });
    }
    return modelMap.get(key)!;
  };
  for (const fr of folders || []) {
    const row = fr as Record<string, unknown>;
    const mName = String(row.model || "").trim();
    const cName = String(row.category || "").trim();
    if (!mName || !cName) continue;
    const m = ensureModel(mName);
    if (solutionsDemoOn(row.is_demo)) m.isDemo = true;
    const brandKey = String(row.brand_image_url || "").trim();
    if (brandKey && !m.brandImageKey) m.brandImageKey = brandKey;
    if (cName === "__brand__") continue;
    const catKey = `${solutionsModelKey(mName)}\0${cName.trim().toLowerCase()}`;
    folderIdByKey.set(catKey, String(row.id || ""));
    const cKey = cName.trim().toLowerCase();
    if (!m.categories.has(cKey)) {
      m.categories.set(cKey, {
        name: cName,
        files: [],
        folderImageKey: String(row.folder_image_url || "").trim(),
        folderId: String(row.id || ""),
      });
    } else if (!m.categories.get(cKey)!.folderId) {
      m.categories.get(cKey)!.folderId = String(row.id || "");
    }
  }
  for (const raw of files || []) {
    const r = raw as Record<string, unknown>;
    const mName = String(r.model || "").trim();
    const cName = String(r.category || "").trim();
    if (!mName || !cName) continue;
    const m = ensureModel(mName);
    const cKey = cName.trim().toLowerCase();
    const catKey = `${solutionsModelKey(mName)}\0${cKey}`;
    if (!m.categories.has(cKey)) {
      m.categories.set(cKey, {
        name: cName,
        files: [],
        folderImageKey: "",
        folderId: folderIdByKey.get(catKey) || "",
      });
    }
    const c = m.categories.get(cKey)!;
    if (!c.folderId) c.folderId = folderIdByKey.get(catKey) || c.folderId;
    c.files.push({
      id: String(r.id),
      name: String(r.filename || ""),
      mime: String(r.mime_type || ""),
      kind: inferSolutionsFileKind(String(r.filename || ""), String(r.mime_type || ""), String(r.kind || "")),
      thumbnailKey: fileThumbKey(r),
    });
    m.fileCount += 1;
    nameFileCounts.set(mName, (nameFileCounts.get(mName) || 0) + 1);
  }
  for (const [key, m] of modelMap) {
    let bestName = m.name;
    let best = -1;
    for (const [rawName, count] of nameFileCounts) {
      if (solutionsModelKey(rawName) !== key) continue;
      if (count > best) {
        best = count;
        bestName = rawName;
      }
    }
    m.name = bestName;
  }
  const signMaybe = async (key: string) => {
    const raw = String(key || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return signR2GetUrl(raw, 24 * 3600);
  };
  const models = await Promise.all(
    [...modelMap.values()].map(async (m) => ({
      name: m.name,
      brandImageUrl: await signMaybe(m.brandImageKey),
      isDemo: Boolean(m.isDemo),
      categories: await Promise.all(
        [...m.categories.values()].map(async (c) => ({
          name: c.name,
          folderId: c.folderId,
          folderImageUrl: await signMaybe(c.folderImageKey),
          files: await Promise.all(
            c.files.map(async (f) => ({
              id: f.id,
              name: f.name,
              mime: f.mime,
              kind: f.kind,
              thumbnailUrl: fileThumbPublicUrl(f.id, f.thumbnailKey) || (await signMaybe(f.thumbnailKey)),
            })),
          ),
        })),
      ),
    })),
  );
  return { models };
}

const EDGE_ADMIN_PHONES = new Set(["8179142535", "9876543210"]);

function isEdgeAdminProfile(p: Record<string, unknown> | null | undefined): boolean {
  if (!p) return false;
  const phone = last10Phone(String(p.phone || ""));
  if (phone && EDGE_ADMIN_PHONES.has(phone)) return true;
  return String(p.role || "").toLowerCase() === "admin";
}

function isApprovedTeacherEdge(p: Record<string, unknown> | null | undefined): boolean {
  if (!p) return false;
  if (isEdgeAdminProfile(p)) return true;
  if (Number(p.is_teacher ?? p.isTeacher ?? 0) === 1) return true;
  if (String((p.teacher_status ?? p.teacherStatus) || "").toLowerCase() === "approved") return true;
  return String(p.role || "").toLowerCase() === "teacher";
}

function packTeacherStatus(me: Record<string, unknown>, application?: Record<string, unknown> | null) {
  const approved = isApprovedTeacherEdge(me);
  let status = String(me.teacher_status ?? me.teacherStatus ?? "").toLowerCase();
  if (!status && String(me.role || "").toLowerCase() === "teacher") status = "approved";
  if (!status && Number(me.is_teacher ?? me.isTeacher ?? 0) === 1) status = "approved";
  if (!status && application?.status) status = String(application.status);
  if (!status) status = "none";
  return {
    success: true,
    isTeacher: approved ? 1 : 0,
    teacherStatus: approved ? "approved" : status,
    teacherBio: String(me.teacher_bio ?? me.teacherBio ?? application?.bio ?? ""),
    teacherIntro: String(me.teacher_intro ?? me.teacherIntro ?? application?.intro ?? ""),
    application: application ? camelKeys(application) : null,
  };
}

async function latestTeacherApplication(
  db: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from("teacher_applications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[teacher] applications lookup", error.message);
    return null;
  }
  return ((data?.[0] as Record<string, unknown>) || null);
}

async function upsertTeacherApplication(
  db: SupabaseClient,
  profile: Record<string, unknown>,
  opts: {
    status: string;
    name?: string;
    bio?: string;
    intro?: string;
    reviewedBy?: string;
    adminNote?: string;
  },
): Promise<void> {
  const userId = String(profile.id || "");
  if (!userId) return;
  const now = Date.now();
  const existing = await latestTeacherApplication(db, userId);
  const row = {
    user_id: userId,
    user_name: String(profile.name || opts.name || ""),
    user_phone: String(profile.phone || ""),
    user_role: String(profile.role || ""),
    name: String(opts.name || profile.name || "Teacher"),
    bio: String(opts.bio ?? profile.teacher_bio ?? ""),
    intro: String(opts.intro ?? profile.teacher_intro ?? ""),
    status: opts.status,
    reviewed_by: String(opts.reviewedBy || ""),
    reviewed_at: opts.reviewedBy ? now : 0,
    admin_note: String(opts.adminNote || ""),
  };
  if (existing?.id) {
    const { error } = await db.from("teacher_applications").update(row).eq("id", String(existing.id));
    if (error) console.warn("[teacher] application update", error.message);
    return;
  }
  const { error } = await db.from("teacher_applications").insert({
    id: crypto.randomUUID(),
    ...row,
    created_at: now,
  });
  if (error) console.warn("[teacher] application insert", error.message);
}

async function setProfileTeacherAccess(
  db: SupabaseClient,
  userId: string,
  opts: { approved: boolean; bio?: string; intro?: string; pending?: boolean },
): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = {
    is_teacher: opts.approved ? 1 : 0,
    teacher_status: opts.approved ? "approved" : opts.pending ? "pending" : "none",
  };
  if (opts.bio !== undefined) patch.teacher_bio = opts.bio;
  if (opts.intro !== undefined) patch.teacher_intro = opts.intro;
  const { error } = await db.from("profiles").update(patch).eq("id", userId);
  return { error: error?.message || null };
}

function toPublishedInt(v: unknown): number {
  if (v === true || v === 1 || v === "1") return 1;
  return 0;
}

async function awaitPush(work: Promise<unknown>) {
  try {
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 8000))]);
  } catch (e) {
    console.warn("[push] course notify", e instanceof Error ? e.message : e);
  }
}

async function notifyIfPublishedCourseVideo(
  db: SupabaseClient,
  courseId: string,
  image?: string | null,
) {
  const { count } = await db.from("course_videos").select("id", { count: "exact", head: true }).eq("course_id", courseId);
  if ((count || 0) > 1) return;
  const { data: course } = await db
    .from("courses")
    .select("is_published,title,teacher_name,cover_image,created_at")
    .eq("id", courseId)
    .maybeSingle();
  if (!course || toPublishedInt(course.is_published) !== 1) return;
  const createdAt = Number((course as { created_at?: number }).created_at) || 0;
  if (createdAt && Date.now() - createdAt < 180_000) return;
  await awaitPush(
    notifyNewCourse(db, {
      title: String((course as { title?: string }).title || "New course"),
      teacherName: String((course as { teacher_name?: string }).teacher_name || ""),
      courseId,
      coverImage: image || String((course as { cover_image?: string }).cover_image || ""),
    }),
  );
}

function cfCustomerHost(): string {
  let host = String(Deno.env.get("CLOUDFLARE_STREAM_CUSTOMER_HOST") || Deno.env.get("CLOUDFLARE_STREAM_PLAYBACK_HOST") || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!host) return "";
  if (!host.endsWith(".cloudflarestream.com")) host = `customer-${host}.cloudflarestream.com`;
  if (!host.startsWith("customer-") && host.endsWith(".cloudflarestream.com")) host = `customer-${host}`;
  return host;
}

async function createCfDirectUpload(
  opts: { name?: string; maxDurationSeconds?: number; db?: SupabaseClient },
): Promise<{ uploadURL: string; uid: string }> {
  if (opts.db) return createStreamDirectUploadOrFree(opts.db, opts);
  return createStreamDirectUpload(opts);
}

function guessCourseVideoMime(filename: string, fallback = "video/mp4"): string {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  return fallback || "video/mp4";
}

function r2ObjectKeyFromCourseVideo(v: Record<string, unknown>): string {
  const uid = String(v.cfStreamUid ?? v.cf_stream_uid ?? "").trim();
  const url = String(v.videoUrl ?? v.video_url ?? "").trim();
  if (uid.startsWith("r2:")) return uid.slice(3);
  if (url.startsWith("r2:")) return url.slice(3);
  return "";
}

async function withSignedCourseVideo(v: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = r2ObjectKeyFromCourseVideo(v);
  if (!key) return v;
  const signed = await signR2GetUrl(key, 12 * 3600);
  return signed ? { ...v, videoUrl: signed } : v;
}

async function startTeacherR2Upload(opts: { courseId: string; folderId: string; filename: string }) {
  if (!isR2UploadConfigured()) throw new Error("Cloudflare R2 not configured");
  const safeName = opts.filename.replace(/^.*[\\/]/, "").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(0, 120) || "video.mp4";
  const objectKey = sanitizeR2ObjectKey(`teacher-courses/${opts.courseId}/${opts.folderId}/${Date.now()}-${safeName}`);
  const mime = guessCourseVideoMime(opts.filename);
  const uploadURL = await signR2PutUrl({ key: objectKey, contentType: mime, expiresInSeconds: 12 * 3600 });
  return {
    success: true as const,
    id: crypto.randomUUID(),
    uid: "",
    uploadURL,
    uploadMethod: "PUT" as const,
    provider: "r2",
    objectKey,
    contentType: mime,
    folderId: opts.folderId,
    courseId: opts.courseId,
  };
}

async function startTeacherR2Multipart(opts: { courseId: string; folderId: string; filename: string }) {
  if (!isR2UploadConfigured()) throw new Error("Cloudflare R2 not configured");
  const safeName = opts.filename.replace(/^.*[\\/]/, "").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(0, 120) || "video.mp4";
  const objectKey = sanitizeR2ObjectKey(`teacher-courses/${opts.courseId}/${opts.folderId}/${Date.now()}-${safeName}`);
  const mime = guessCourseVideoMime(opts.filename);
  const uploadId = await r2CreateMultipartUpload(objectKey, mime);
  return {
    success: true as const,
    id: crypto.randomUUID(),
    uid: "",
    uploadURL: "",
    uploadMethod: "MULTIPART" as const,
    provider: "r2-multipart",
    objectKey,
    uploadId,
    contentType: mime,
    folderId: opts.folderId,
    courseId: opts.courseId,
    partSize: 5 * 1024 * 1024,
  };
}

async function loadCourseWithChapters(db: SupabaseClient, id: string): Promise<Record<string, unknown> | null> {
  const { data } = await db.from("courses").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const course = camelKeys(data as Record<string, unknown>);
  const { data: chRows } = await db.from("course_chapters").select("*").eq("course_id", id).order("sort_order", { ascending: true });
  const { data: vidRows } = await db.from("course_videos").select("*").eq("course_id", id).order("sort_order", { ascending: true });
  const videos = await Promise.all((vidRows || []).map((r) => withSignedCourseVideo(camelKeys(r as Record<string, unknown>))));
  const chapters = (chRows || []).map((ch) => {
    const c = camelKeys(ch as Record<string, unknown>);
    return { ...c, videos: videos.filter((v) => String(v.chapterId) === String(c.id)) };
  });
  return { ...course, chapters };
}

async function requireCourseOwner(
  db: SupabaseClient,
  req: Request,
  courseId: string,
): Promise<{ error: { success: false; message: string } | null; status: number; me: Record<string, unknown> | null }> {
  const me = await sessionProfile(db, req);
  if (!me?.id) return { error: { success: false, message: "Sign in required" }, status: 401, me: null };
  if (!isApprovedTeacherEdge(me)) {
    return { error: { success: false, message: "Only approved teachers can manage courses" }, status: 403, me };
  }
  const { data } = await db.from("courses").select("teacher_id").eq("id", courseId).maybeSingle();
  if (!data) return { error: { success: false, message: "Course not found" }, status: 404, me };
  if (String(data.teacher_id) !== String(me.id) && !isEdgeAdminProfile(me)) {
    return { error: { success: false, message: "Not your course" }, status: 403, me };
  }
  return { error: null, status: 200, me };
}

async function refreshCourseTotals(db: SupabaseClient, courseId: string) {
  const { data } = await db.from("course_videos").select("duration").eq("course_id", courseId);
  const rows = data || [];
  const totalVideos = rows.length;
  const totalDuration = rows.reduce((sum, v) => sum + (Number((v as { duration?: number }).duration) || 0), 0);
  await db.from("courses").update({ total_videos: totalVideos, total_duration: totalDuration }).eq("id", courseId);
}

function authorContactPayload(p: Record<string, unknown>) {
  const now = Date.now();
  const paid = isPaidActiveNow(p, now);
  const trial = isTrialActiveNow(p, now);
  return {
    userId: String(p.id || ""),
    phone: String(p.phone || "").trim(),
    whatsapp: String(p.whatsapp || "").trim(),
    subscribed: paid,
    trialActive: trial,
    trialEnd: numVal(p.trial_end ?? p.trialEnd),
    status: paid ? "paid" : trial ? "trial" : "none",
    subscriptionEnd: Number(p.subscription_end ?? p.subscriptionEnd ?? 0) || 0,
  };
}

function last10Phone(raw: string): string {
  return String(raw || "").replace(/\D/g, "").replace(/^91/, "").slice(-10);
}

function isDeletedProfile(p: Record<string, unknown> | null | undefined): boolean {
  if (!p) return true;
  return Boolean(p.deleted_at || p.deletedAt);
}

/** Look up an existing member by profile id or Indian mobile. Never creates a row. */
async function findExistingMemberProfile(
  db: SupabaseClient,
  userId: string,
  targetPhone?: string,
): Promise<Record<string, unknown> | null> {
  const id = String(userId || "").trim();
  if (id) {
    const { data } = await db.from("profiles").select("*").eq("id", id).maybeSingle();
    if (data && !isDeletedProfile(data as Record<string, unknown>)) {
      return data as Record<string, unknown>;
    }
  }
  const phoneRaw = String(targetPhone || "").trim();
  const idLooksLikePhone = /^\+?\d{10,15}$/.test(id.replace(/[\s-]/g, ""));
  const phone = last10Phone(phoneRaw || (idLooksLikePhone ? id : ""));
  if (phone.length !== 10) return null;
  const variants = [phone, `91${phone}`, `+91${phone}`, `0${phone}`];
  const { data } = await db.from("profiles").select("*").in("phone", variants).limit(20);
  const exact = (data || []).find((p) => !isDeletedProfile(p as Record<string, unknown>));
  if (exact) return exact as Record<string, unknown>;
  const { data: fuzzy } = await db.from("profiles").select("*").ilike("phone", `%${phone}%`).limit(20);
  const hit = (fuzzy || []).find((p) => {
    if (isDeletedProfile(p as Record<string, unknown>)) return false;
    return last10Phone(String((p as { phone?: string }).phone || "")) === phone;
  });
  return (hit as Record<string, unknown>) || null;
}

async function requireEdgeAdmin(
  db: SupabaseClient,
  req: Request,
  json: JsonFn,
  phoneOverride?: string,
): Promise<Response | null> {
  const url = new URL(req.url);
  const headerPhone = req.headers.get("x-mobi-phone") || "";
  const qPhone = last10Phone(
    phoneOverride || url.searchParams.get("phone") || url.searchParams.get("adminPhone") || headerPhone || "",
  );
  if (qPhone && EDGE_ADMIN_PHONES.has(qPhone)) return null;
  const me = await sessionProfile(db, req);
  if (!me?.id) return json({ success: false, message: "Unauthorized: Session token required" }, 401);
  const role = String(me.role || "").toLowerCase();
  const mePhone = last10Phone(String(me.phone || ""));
  if (role !== "admin" && !EDGE_ADMIN_PHONES.has(mePhone)) {
    return json({ success: false, message: "Admin only" }, 403);
  }
  return null;
}

async function pageRows(
  db: SupabaseClient,
  table: string,
  columns: string,
  build?: (q: any) => any,
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    let q: any = db.from(table).select(columns);
    if (build) q = build(q);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) {
      console.warn(`[admin subscribers] ${table} page ${from}:`, error.message || error);
      break;
    }
    const batch = (data || []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
    if (from >= 50000) break;
  }
  return rows;
}

function flagOn(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || Number(v) === 1;
}

function numVal(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function looksLikeTrialGrant(p: Record<string, unknown>): boolean {
  const trialEnd = numVal(p.trial_end ?? p.trialEnd);
  const subEnd = numVal(p.subscription_end ?? p.subscriptionEnd);
  if (trialEnd <= 0) return false;
  return subEnd > 0 && Math.abs(subEnd - trialEnd) < 180_000;
}

function isPaidActiveNow(p: Record<string, unknown>, now = Date.now()): boolean {
  const end = numVal(p.subscription_end ?? p.subscriptionEnd);
  return flagOn(p.subscription_active ?? p.subscriptionActive) && end > now && !looksLikeTrialGrant(p);
}

function isTrialActiveNow(p: Record<string, unknown>, now = Date.now()): boolean {
  const trialEnd = numVal(p.trial_end ?? p.trialEnd);
  return trialEnd > now && !isPaidActiveNow(p, now);
}

function tookTrial(p: Record<string, unknown>): boolean {
  return flagOn(p.trial_used ?? p.trialUsed)
    || numVal(p.trial_start ?? p.trialStart) > 0
    || numVal(p.trial_end ?? p.trialEnd) > 0;
}

async function broadcastTrialAvailable(db: SupabaseClient, days: number) {
  const image = await resolveNotificationImage(db);
  const n = Math.max(1, Math.round(Number(days) || 1));
  return await broadcastPush(
    db,
    `${n}-day free trial is on`,
    `Start your ${n}-day free trial in Subscription. Full access, once per user.`,
    { type: "trial_available", path: "/subscription-paywall", image },
    image,
  );
}

function isAdminGrantSub(row: Record<string, unknown>): boolean {
  const planId = String(row.plan_id ?? row.planId ?? "").trim().toLowerCase();
  const paymentId = String(row.payment_id ?? row.paymentId ?? "").trim().toLowerCase();
  return planId === "admin_grant" || paymentId === "admin_grant";
}

async function buildAdminRevenue(db: SupabaseClient) {
  const now = Date.now();
  const [
    profilesPage,
    allPayments,
    allEnrollments,
    allCourses,
    allPurchases,
    rolePlans,
    legacyPlans,
    coursePurchases,
    spareCheckouts,
  ] = await Promise.all([
    pageRows(db, "profiles", "id, name, role, subscription_active, subscription_end, trial_used, trial_start, trial_end, deleted_at"),
    pageRows(db, "payments", "id, teacher_id, amount, status, admin_commission, teacher_earning, commission_percent"),
    pageRows(db, "course_enrollments", "id, payment_status"),
    pageRows(db, "courses", "id, teacher_id, is_published"),
    pageRows(db, "user_subscriptions", "*"),
    pageRows(db, "subscription_role_plans", "id, role, price, months"),
    pageRows(db, "subscription_plans", "id, price, months"),
    pageRows(db, "course_purchases", "id, amount_paise, status"),
    pageRows(db, "spare_checkouts", "id, total, status"),
  ]);

  let profiles = profilesPage;
  if (profiles.length === 0) {
    profiles = await pageRows(db, "profiles", "id, name, role, subscription_active, subscription_end, trial_used, trial_start, trial_end");
  }

  const profileById = new Map<string, Record<string, unknown>>();
  for (const p of profiles) {
    if (p.deleted_at || p.deletedAt) continue;
    const id = String(p.id || "");
    if (id) profileById.set(id, p);
  }

  const activeSubscribers = [...profileById.values()].filter((p) => isPaidActiveNow(p, now));
  const trialMembers = [...profileById.values()].filter((p) => tookTrial(p));
  const trialActiveMembers = [...profileById.values()].filter((p) => isTrialActiveNow(p, now));

  const capturedPayments = allPayments.filter((p) => {
    const s = String(p.status || "").toLowerCase();
    return s === "captured" || s === "paid";
  });

  let totalCourseRevenue = capturedPayments.reduce((sum, p) => sum + numVal(p.amount), 0) / 100;
  if (totalCourseRevenue === 0 && coursePurchases.length) {
    totalCourseRevenue =
      coursePurchases
        .filter((p) => String(p.status || "").toLowerCase() === "active" && numVal(p.amount_paise ?? p.amountPaise) > 0)
        .reduce((sum, p) => sum + numVal(p.amount_paise ?? p.amountPaise), 0) / 100;
  }

  const teacherRevenueMap: Record<string, { name: string; amount: number; enrollments: number; courseCount: number }> = {};
  for (const p of capturedPayments) {
    const tid = String(p.teacher_id ?? p.teacherId ?? "");
    if (!tid) continue;
    if (!teacherRevenueMap[tid]) teacherRevenueMap[tid] = { name: "", amount: 0, enrollments: 0, courseCount: 0 };
    teacherRevenueMap[tid].amount += numVal(p.amount) / 100;
    teacherRevenueMap[tid].enrollments += 1;
  }
  for (const [id, row] of profileById) {
    if (teacherRevenueMap[id]) teacherRevenueMap[id].name = String(row.name || "");
  }
  for (const c of allCourses) {
    const tid = String(c.teacher_id ?? c.teacherId ?? "");
    if (teacherRevenueMap[tid]) teacherRevenueMap[tid].courseCount += 1;
  }

  const planPriceById = new Map<string, { price: number; role: string }>();
  for (const p of [...legacyPlans, ...rolePlans]) {
    const id = String(p.id || "");
    if (!id) continue;
    planPriceById.set(id, { price: numVal(p.price), role: String(p.role || "").toLowerCase() });
  }

  const subRevByRole: Record<string, number> = {};
  let paidSubscriptionCount = 0;
  let adminGrantCount = 0;
  for (const row of allPurchases) {
    if (isAdminGrantSub(row)) {
      adminGrantCount += 1;
      continue;
    }
    const planId = String(row.plan_id ?? row.planId ?? "");
    const meta = planPriceById.get(planId);
    const amount = meta ? meta.price : 0;
    const uid = String(row.user_id ?? row.userId ?? "");
    const role = String(profileById.get(uid)?.role || meta?.role || "unknown").toLowerCase() || "unknown";
    subRevByRole[role] = (subRevByRole[role] || 0) + amount;
    paidSubscriptionCount += 1;
  }
  const totalSubRevenue = Object.values(subRevByRole).reduce((s, v) => s + v, 0);

  const activeByRole: Record<string, number> = {};
  for (const p of activeSubscribers) {
    const role = String(p.role || "unknown").toLowerCase() || "unknown";
    activeByRole[role] = (activeByRole[role] || 0) + 1;
  }

  const totalAdminCommission = capturedPayments.reduce((s, p) => s + numVal(p.admin_commission ?? p.adminCommission), 0) / 100;
  const totalTeacherEarnings = capturedPayments.reduce((s, p) => s + numVal(p.teacher_earning ?? p.teacherEarning), 0) / 100;
  const percents = capturedPayments.map((p) => numVal(p.commission_percent ?? p.commissionPercent)).filter((n) => n > 0);
  const commissionPercent = percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : 0;

  let marketplaceRevenue = 0;
  let paidMarketplaceOrders = 0;
  for (const row of spareCheckouts) {
    if (String(row.status || "").toLowerCase() !== "paid") continue;
    marketplaceRevenue += numVal(row.total);
    paidMarketplaceOrders += 1;
  }

  return {
    success: true,
    activeSubscribers: activeSubscribers.length,
    trialMembers: trialMembers.length,
    trialActiveMembers: trialActiveMembers.length,
    activeSubscribersByRole: activeByRole,
    subscriptionRevenue: totalSubRevenue,
    subscriptionRevenueByRole: subRevByRole,
    paidSubscriptionCount,
    adminGrantCount,
    courseRevenue: totalCourseRevenue,
    marketplaceRevenue,
    paidMarketplaceOrders,
    platformCourseRevenue: totalAdminCommission,
    totalRevenue: totalSubRevenue + totalCourseRevenue + marketplaceRevenue,
    totalEnrollments: allEnrollments.filter((e) => String(e.payment_status ?? e.paymentStatus) === "paid").length,
    freeEnrollments: allEnrollments.filter((e) => String(e.payment_status ?? e.paymentStatus) === "free").length,
    teacherRevenue: Object.entries(teacherRevenueMap)
      .map(([id, r]) => ({ teacherId: id, ...r }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20),
    courseCount: allCourses.length,
    publishedCourses: allCourses.filter((c) => flagOn(c.is_published ?? c.isPublished)).length,
    totalPayments: capturedPayments.length,
    commissionPercent,
    totalAdminCommission,
    totalTeacherEarnings,
  };
}

function monthsPlanLabel(months: number): string {
  const m = Math.max(0, Number(months) || 0);
  if (m === 1) return "1 Month";
  if (m === 12) return "1 Year";
  if (m > 0) return `${m} Months`;
  return "";
}

function mapAdminSubscriberRow(
  p: Record<string, unknown>,
  purchase: Record<string, unknown> | undefined,
  planById: Map<string, { duration: string; months: number }>,
  now: number,
) {
  const end = Number(p.subscription_end ?? p.subscriptionEnd ?? 0) || 0;
  const paidActive = isPaidActiveNow(p, now);
  const trialEnd = Number(p.trial_end ?? p.trialEnd ?? 0) || 0;
  const trialStart = Number(p.trial_start ?? p.trialStart ?? 0) || 0;
  const trialActive = isTrialActiveNow(p, now);
  const trialUsed = flagOn(p.trial_used ?? p.trialUsed);
  const orderId = String(p.subscription_order_id ?? p.subscriptionOrderId ?? "").trim();
  const planId = String(purchase?.plan_id || purchase?.planId || "");
  const planMeta = planId ? planById.get(planId) : undefined;
  const months = Number(purchase?.months ?? planMeta?.months ?? 0) || 0;
  const plan = planMeta?.duration
    || monthsPlanLabel(months)
    || (paidActive || end > 0 || orderId || planId ? "Subscription" : trialUsed || trialStart ? "Trial" : "");
  let status = "Inactive";
  if (paidActive) status = "Active";
  else if (trialActive) status = "Trial";
  else if (end > 0) status = "Expired";
  else if (planId || orderId) status = "Cancelled";
  else if (trialUsed || trialStart > 0) status = "Trial ended";
  const startDate = Number(purchase?.start_date ?? purchase?.startDate ?? trialStart ?? 0) || 0;
  return {
    id: String(p.id || ""),
    name: String(p.name || ""),
    phone: String(p.phone || ""),
    role: String(p.role || ""),
    avatar: String(p.avatar || ""),
    city: String(p.city || ""),
    subscriptionActive: paidActive ? 1 : 0,
    subscriptionEnd: end,
    plan,
    planId,
    months,
    status,
    startDate,
    endDate: end || trialEnd || 0,
    trialStart,
    trialEnd,
    trialActive,
  };
}

function everTookSubscription(p: Record<string, unknown>, hasPurchase: boolean): boolean {
  if (hasPurchase) return true;
  if (flagOn(p.subscription_active ?? p.subscriptionActive)) return true;
  if (Number(p.subscription_end ?? p.subscriptionEnd ?? 0) > 0) return true;
  if (flagOn(p.trial_used ?? p.trialUsed)) return true;
  if (Number(p.trial_start ?? p.trialStart ?? 0) > 0) return true;
  if (Number(p.trial_end ?? p.trialEnd ?? 0) > 0) return true;
  if (String(p.subscription_order_id ?? p.subscriptionOrderId ?? "").trim()) return true;
  return false;
}

function csvCell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function csvJoin(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function formatIndianPhone(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return s;
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+91${digits}`;
}

function csvWhen(v: unknown): { date: string; time: string } {
  if (v == null || v === "") return { date: "", time: "" };
  const n = Number(v);
  const d = Number.isFinite(n) && n > 0
    ? new Date(n < 1e12 ? n * 1000 : n)
    : new Date(String(v));
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return { date: "", time: "" };
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 19),
  };
}

const USER_EXPORT_COLS_FULL =
  "id,name,phone,whatsapp,email,role,skills,city,state,experience,shop_name,bio,sell_type,teach_type,shop_address,gst_number,aadhaar_number,pan_number,latitude,longitude,last_seen,subscription_active,subscription_end,subscription_order_id,trial_used,trial_start,trial_end,device_id,device_change_count,blocked,verified,rating,rating_count,is_teacher,teacher_status,available_for_jobs,created_at,deleted_at";

const USER_EXPORT_COLS_SAFE =
  "id,name,phone,email,role,city,state,experience,shop_name,shop_address,gst_number,aadhaar_number,pan_number,subscription_active,subscription_end,trial_used,trial_start,trial_end,device_id,blocked,verified,created_at,deleted_at";

async function pageAllRows(
  db: SupabaseClient,
  table: string,
  columns: string,
  build?: (q: any) => any,
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    let q: any = db.from(table).select(columns);
    if (build) q = build(q);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data || []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
    if (from >= 200000) break;
  }
  return rows;
}

async function loadProfilesForExport(db: SupabaseClient): Promise<Record<string, unknown>[]> {
  const tries = [USER_EXPORT_COLS_FULL, USER_EXPORT_COLS_SAFE, "id,name,phone,role,city,created_at"];
  let lastErr: unknown = null;
  for (const cols of tries) {
    try {
      return await pageAllRows(db, "profiles", cols);
    } catch (e) {
      lastErr = e;
      console.warn("[admin export] profiles select failed", cols, e instanceof Error ? e.message : e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not load profiles");
}

function csvYesNo(v: unknown): string {
  return flagOn(v) ? "Yes" : "No";
}

function csvSkills(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean).join("; ");
  const s = String(v ?? "").trim();
  if (!s) return "";
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x || "").trim()).filter(Boolean).join("; ");
  } catch {
    /* keep raw */
  }
  return s;
}

async function buildUsersExportCsv(db: SupabaseClient): Promise<{ csv: string; count: number }> {
  const [profiles, purchases] = await Promise.all([
    loadProfilesForExport(db),
    pageAllRows(db, "user_subscriptions", "user_id,plan_id,payment_id,end_date,created_at").catch(() => [] as Record<string, unknown>[]),
  ]);
  const latestSub = new Map<string, Record<string, unknown>>();
  for (const row of purchases) {
    const uid = String(row.user_id || "");
    if (!uid) continue;
    const prev = latestSub.get(uid);
    if (!prev || Number(row.created_at || 0) > Number(prev.created_at || 0)) latestSub.set(uid, row);
  }
  const headers = [
    "User ID",
    "Name",
    "Phone",
    "WhatsApp",
    "Email",
    "Role",
    "City",
    "State",
    "Shop Name",
    "Shop Address",
    "Bio",
    "Experience",
    "Skills",
    "GST Number",
    "Aadhaar",
    "PAN",
    "Latitude",
    "Longitude",
    "Verified",
    "Blocked",
    "Deleted",
    "Registered",
    "Subscription Active",
    "Subscription End",
    "Subscription Order ID",
    "Last Plan",
    "Last Payment ID",
    "Trial Used",
    "Trial Start",
    "Trial End",
    "Device ID",
    "Device Changes",
    "Available For Jobs",
    "Teacher",
    "Teacher Status",
    "Sell Type",
    "Teach Type",
    "Rating",
    "Rating Count",
    "Last Seen Date",
    "Last Seen Time",
    "Joined Date",
    "Joined Time",
  ];
  const rows: unknown[][] = [];
  for (const u of profiles) {
    const created = csvWhen(u.created_at ?? u.createdAt);
    const lastSeen = csvWhen(u.last_seen ?? u.lastSeen);
    const subEnd = csvWhen(u.subscription_end ?? u.subscriptionEnd);
    const trialStart = csvWhen(u.trial_start ?? u.trialStart);
    const trialEnd = csvWhen(u.trial_end ?? u.trialEnd);
    const subOn = flagOn(u.subscription_active ?? u.subscriptionActive);
    const sub = latestSub.get(String(u.id || ""));
    rows.push([
      u.id || "",
      u.name || "",
      formatIndianPhone(u.phone),
      formatIndianPhone(u.whatsapp),
      u.email || "",
      u.role || "",
      u.city || "",
      u.state || "",
      u.shop_name ?? u.shopName ?? "",
      u.shop_address ?? u.shopAddress ?? "",
      u.bio || "",
      u.experience || "",
      csvSkills(u.skills),
      u.gst_number ?? u.gstNumber ?? "",
      u.aadhaar_number ?? u.aadhaarNumber ?? "",
      u.pan_number ?? u.panNumber ?? "",
      u.latitude || "",
      u.longitude || "",
      csvYesNo(u.verified),
      csvYesNo(u.blocked),
      u.deleted_at || u.deletedAt ? "Yes" : "No",
      subOn ? "Yes" : "No",
      subOn ? "Active" : "Inactive",
      subEnd.date || "",
      u.subscription_order_id ?? u.subscriptionOrderId ?? "",
      sub?.plan_id || "",
      sub?.payment_id || "",
      csvYesNo(u.trial_used ?? u.trialUsed),
      trialStart.date,
      trialEnd.date,
      u.device_id ?? u.deviceId ?? "",
      u.device_change_count ?? u.deviceChangeCount ?? 0,
      String(u.available_for_jobs ?? u.availableForJobs ?? ""),
      csvYesNo(u.is_teacher ?? u.isTeacher),
      u.teacher_status ?? u.teacherStatus ?? "",
      u.sell_type ?? u.sellType ?? "",
      u.teach_type ?? u.teachType ?? "",
      u.rating || "",
      u.rating_count ?? u.ratingCount ?? "",
      lastSeen.date,
      lastSeen.time,
      created.date,
      created.time,
    ]);
  }
  return { csv: csvJoin(headers, rows), count: rows.length };
}

async function buildSubscribersExportCsv(db: SupabaseClient): Promise<string> {
  const list = await buildAdminSubscriberRows(db, false);
  const headers = [
    "Name",
    "Phone",
    "Role",
    "City",
    "Plan",
    "Status",
    "Start Date",
    "Subscription End",
    "Trial Start",
    "Trial End",
  ];
  const rows = list.map((row) => [
    row.name || "",
    formatIndianPhone(row.phone),
    row.role || "",
    row.city || "",
    row.plan || "",
    row.status || "",
    csvWhen(row.startDate).date,
    csvWhen(row.subscriptionEnd || row.endDate).date,
    csvWhen(row.trialStart).date,
    csvWhen(row.trialEnd).date,
  ]);
  return csvJoin(headers, rows);
}

async function buildAdminSubscriberRows(db: SupabaseClient, onlyActive: boolean) {
  const now = Date.now();
  const [purchases, rolePlans, legacyPlans] = await Promise.all([
    pageRows(db, "user_subscriptions", "*"),
    pageRows(db, "subscription_role_plans", "id, duration, months"),
    pageRows(db, "subscription_plans", "id, duration, months"),
  ]);
  let allProfiles = await pageRows(
    db,
    "profiles",
    "id, name, phone, role, avatar, city, subscription_active, subscription_end, subscription_order_id, trial_used, trial_start, trial_end, deleted_at",
  );
  if (allProfiles.length === 0) {
    allProfiles = await pageRows(
      db,
      "profiles",
      "id, name, phone, role, avatar, city, subscription_active, subscription_end, trial_used, trial_start, trial_end",
    );
  }

  const planById = new Map<string, { duration: string; months: number }>();
  for (const p of [...legacyPlans, ...rolePlans]) {
    const id = String(p.id || "");
    if (!id) continue;
    planById.set(id, { duration: String(p.duration || ""), months: Number(p.months || 0) || 0 });
  }

  const latestPurchase = new Map<string, Record<string, unknown>>();
  for (const row of purchases) {
    const uid = String(row.user_id || row.userId || "");
    if (!uid) continue;
    const prev = latestPurchase.get(uid);
    if (!prev || Number(row.created_at || row.createdAt || 0) > Number(prev.created_at || prev.createdAt || 0)) {
      latestPurchase.set(uid, row);
    }
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const p of allProfiles) {
    if (p.deleted_at || p.deletedAt) continue;
    const id = String(p.id || "");
    if (!id) continue;
    if (everTookSubscription(p, latestPurchase.has(id))) byId.set(id, p);
  }

  const missingIds = [...latestPurchase.keys()].filter((id) => !byId.has(id));
  for (let i = 0; i < missingIds.length; i += 100) {
    const chunk = missingIds.slice(i, i + 100);
    const { data } = await db.from("profiles").select("*").in("id", chunk);
    for (const p of (data || []) as Record<string, unknown>[]) {
      if (p.deleted_at || p.deletedAt) continue;
      const id = String(p.id || "");
      if (id) byId.set(id, p);
    }
  }

  const rows = [...byId.values()]
    .map((p) => mapAdminSubscriberRow(p, latestPurchase.get(String(p.id || "")), planById, now))
    .filter((row) => row.id);

  if (onlyActive) {
    return rows
      .filter((row) => row.subscriptionActive === 1 && Number(row.subscriptionEnd || 0) > now)
      .sort((a, b) => Number(a.subscriptionEnd || 0) - Number(b.subscriptionEnd || 0));
  }
  return rows.sort((a, b) => Number(b.startDate || b.subscriptionEnd || b.trialStart || 0) - Number(a.startDate || a.subscriptionEnd || a.trialStart || 0));
}

export async function sessionProfile(db: SupabaseClient, req: Request): Promise<Record<string, unknown> | null> {
  const url = new URL(req.url);
  const sessionTok = req.headers.get("x-session-token") || url.searchParams.get("sessionToken") || "";
  let rawPhone = "";
  if (sessionTok) {
    const { data: sess } = await db.from("sessions").select("phone").eq("session_token", sessionTok).maybeSingle();
    rawPhone = String(sess?.phone || "");
  }
  if (!rawPhone) rawPhone = req.headers.get("x-mobi-phone") || url.searchParams.get("phone") || "";
  if (rawPhone.startsWith("email:") || rawPhone.includes("@")) {
    const email = (rawPhone.startsWith("email:") ? rawPhone.slice(6) : rawPhone).trim().toLowerCase();
    if (!email) return null;
    const { data: byEmail } = await db.from("profiles").select("*").ilike("email", email).limit(1);
    return (byEmail?.[0] as Record<string, unknown>) || null;
  }
  const row = await findExistingMemberProfile(db, "", rawPhone);
  const phone = last10Phone(rawPhone);
  if (row && EDGE_ADMIN_PHONES.has(phone)) {
    const needsTeacher = Number(row.is_teacher ?? 0) !== 1 || String(row.teacher_status || "") !== "approved";
    if (needsTeacher) {
      await db.from("profiles").update({ is_teacher: 1, teacher_status: "approved" }).eq("id", String(row.id));
      row.is_teacher = 1;
      row.teacher_status = "approved";
    }
  }
  return row;
}

function epochMs(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? Math.round(n * 1000) : n;
}

async function profileCanOpenHardwareSolutions(
  db: SupabaseClient,
  me: Record<string, unknown> | null | undefined,
): Promise<boolean> {
  if (!me) return false;
  if (isEdgeAdminProfile(me)) return true;
  const now = Date.now();
  const ids = new Set<string>();
  const own = String(me.id || "").trim();
  if (own) ids.add(own);
  const phone = last10Phone(String(me.phone || ""));
  if (phone.length === 10) {
    try {
      const { data } = await db
        .from("profiles")
        .select("id,subscription_active,subscription_end,trial_end")
        .in("phone", [phone, `91${phone}`, `+91${phone}`, `0${phone}`])
        .limit(20);
      for (const row of (data || []) as Record<string, unknown>[]) {
        const id = String(row.id || "").trim();
        if (id) ids.add(id);
        const end = epochMs(row.subscription_end);
        const trialEnd = epochMs(row.trial_end);
        if ((flagOn(row.subscription_active) && end > now) || end > now || trialEnd > now) return true;
      }
    } catch {
      /* fall through to this profile */
    }
  }
  const end = epochMs(me.subscription_end ?? me.subscriptionEnd);
  const trialEnd = epochMs(me.trial_end ?? me.trialEnd);
  if ((flagOn(me.subscription_active ?? me.subscriptionActive) && end > now) || end > now || trialEnd > now) return true;
  if (!ids.size) return false;
  try {
    const { data: subs } = await db.from("user_subscriptions").select("end_date").in("user_id", [...ids]).limit(40);
    return (subs || []).some((s) => epochMs((s as { end_date?: unknown }).end_date) > now);
  } catch {
    return false;
  }
}

function parsePhotos(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 20);
  }
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return parsePhotos(parsed);
    } catch {
      /* ignore */
    }
  }
  return [];
}

function repairRecordJson(row: Record<string, unknown>) {
  const c = camelKeys(row);
  return { ...c, photos: parsePhotos(c.photos ?? row.photos) };
}

function maskPhone(v: string): string {
  const digits = String(v || "").replace(/\D/g, "");
  if (digits.length <= 4) return digits.replace(/./g, "•");
  return `••••${digits.slice(-4)}`;
}

function maskName(v: string): string {
  const trimmed = String(v || "").trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\s+/)
    .map((p, idx) => (idx === 0 ? (p.length <= 1 ? p : p[0] + p.slice(1).replace(/./g, "•")) : `${p[0]}.`))
    .join(" ");
}

async function requireTechnician(db: SupabaseClient, req: Request) {
  const me = await sessionProfile(db, req);
  const role = String(me?.role || "").toLowerCase();
  if (!me?.id) return { error: { success: false, message: "Sign in required" }, status: 401 as const, me: null };
  if (role !== "technician" && role !== "admin") {
    return { error: { success: false, message: "Only technicians can use the mobile saver" }, status: 403 as const, me: null };
  }
  return { error: null, status: 200 as const, me };
}

const TRIAL_SHARE_DAYS = 5;
const TRIAL_SHARE_MIN_IMAGES = 4;

type TrialProof = {
  id: string;
  userId: string;
  userName: string;
  userPhone: string;
  images: string[];
  sharedAt: number;
  status: string;
  createdAt: number;
  reviewedAt: number;
  trialStart: number;
  trialEnd: number;
};

function trialProofKey(userId: string) {
  return `trial_proof:${userId}`;
}

function parseTrialImages(raw: unknown): string[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    try {
      v = JSON.parse(s);
    } catch {
      return /^https:\/\//i.test(s) ? [s] : [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.map((u) => String(u || "").trim()).filter((u) => /^https:\/\//i.test(u));
}

function parseTrialProof(raw: unknown): TrialProof | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const images = parseTrialImages(r.images);
  const userId = String(r.userId || r.user_id || "").trim();
  if (!userId) return null;
  return {
    id: String(r.id || userId),
    userId,
    userName: String(r.userName || r.user_name || ""),
    userPhone: String(r.userPhone || r.user_phone || ""),
    images,
    sharedAt: Number(r.sharedAt ?? r.shared_at ?? 0) || 0,
    status: String(r.status || "pending"),
    createdAt: Number(r.createdAt ?? r.created_at ?? 0) || 0,
    reviewedAt: Number(r.reviewedAt ?? r.reviewed_at ?? 0) || 0,
    trialStart: Number(r.trialStart ?? r.trial_start ?? 0) || 0,
    trialEnd: Number(r.trialEnd ?? r.trial_end ?? 0) || 0,
  };
}

async function loadTrialProof(db: SupabaseClient, userId: string): Promise<TrialProof | null> {
  const { data } = await db.from("trial_share_proofs").select("*").eq("user_id", userId).maybeSingle();
  if (data) return parseTrialProof(camelKeys(data as Record<string, unknown>));
  const { data: setting } = await db.from("app_settings").select("value").eq("key", trialProofKey(userId)).maybeSingle();
  const raw = String((setting as { value?: string } | null)?.value || "").trim();
  if (!raw) return null;
  try {
    return parseTrialProof(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function saveTrialProof(db: SupabaseClient, proof: TrialProof): Promise<void> {
  const row = {
    id: proof.id,
    user_id: proof.userId,
    user_name: proof.userName,
    user_phone: proof.userPhone,
    images: proof.images,
    shared_at: proof.sharedAt,
    status: proof.status,
    created_at: proof.createdAt,
    reviewed_at: proof.reviewedAt,
    trial_start: proof.trialStart,
    trial_end: proof.trialEnd,
  };
  const { error } = await db.from("trial_share_proofs").upsert(row, { onConflict: "id" });
  if (!error) return;
  const now = Date.now();
  const key = trialProofKey(proof.userId);
  const value = JSON.stringify(proof);
  const { data: existing } = await db.from("app_settings").select("id").eq("key", key).maybeSingle();
  if (existing?.id) {
    await db.from("app_settings").update({ value, updated_at: now }).eq("id", existing.id);
  } else {
    await db.from("app_settings").insert({ id: crypto.randomUUID(), key, value, updated_at: now });
  }
}

function isTrialGrantRow(row: Record<string, unknown>): boolean {
  const plan = String(row.plan_id ?? row.planId ?? "").toLowerCase();
  const pay = String(row.payment_id ?? row.paymentId ?? "").toLowerCase();
  return (
    plan === "whatsapp_share_trial" ||
    pay === "whatsapp_share_trial" ||
    plan === "tap_start_trial" ||
    pay === "tap_start_trial"
  );
}

async function hasPaidSubscription(db: SupabaseClient, userId: string, now: number): Promise<boolean> {
  const { data } = await db.from("user_subscriptions").select("plan_id,payment_id,end_date").eq("user_id", userId);
  return ((data || []) as Record<string, unknown>[]).some((row) => {
    if (isTrialGrantRow(row)) return false;
    const pay = String(row.payment_id ?? row.paymentId ?? "");
    const plan = String(row.plan_id ?? row.planId ?? "").toLowerCase();
    if (plan === "admin_grant" || pay === "admin_grant") return Number(row.end_date ?? row.endDate ?? 0) > now;
    if (!pay) return false;
    return Number(row.end_date ?? row.endDate ?? 0) > now;
  });
}

async function revokeTrialAccess(db: SupabaseClient, userId: string): Promise<void> {
  const now = Date.now();
  const { data: user } = await db.from("profiles").select("id,subscription_active,subscription_end,trial_end").eq("id", userId).maybeSingle();
  if (!user) return;
  const paid = await hasPaidSubscription(db, userId, now);
  const trialEnd = Number((user as { trial_end?: number }).trial_end || 0);
  const subEnd = Number((user as { subscription_end?: number }).subscription_end || 0);
  const looksLikeTrial = trialEnd > 0 && subEnd > 0 && Math.abs(subEnd - trialEnd) < 180_000;
  const { data: trialRows } = await db
    .from("user_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .in("plan_id", ["whatsapp_share_trial", "tap_start_trial"])
    .gt("end_date", now)
    .limit(1);
  const patch: Record<string, unknown> = {
    trial_start: 0,
    trial_end: 0,
  };
  if (!paid && (looksLikeTrial || Boolean(trialRows?.length))) {
    patch.subscription_active = 0;
    patch.subscription_end = 0;
  }
  await db.from("profiles").update(patch).eq("id", userId);
  await db.from("user_subscriptions").update({ end_date: now }).eq("user_id", userId).in("plan_id", ["whatsapp_share_trial", "tap_start_trial"]);
}

async function deleteTrialProof(db: SupabaseClient, userId: string): Promise<void> {
  await db.from("trial_share_proofs").delete().eq("user_id", userId);
  await db.from("trial_share_proofs").delete().eq("id", userId);
  await db.from("app_settings").delete().eq("key", trialProofKey(userId));
}

async function collectTrialUserIds(db: SupabaseClient): Promise<string[]> {
  const now = Date.now();
  const ids = new Set<string>();
  for (const p of await listTrialProofs(db)) {
    if (String(p.status || "") === "activated" || Number(p.trialEnd || 0) > now) ids.add(p.userId);
  }
  const trialSubs = await pageRows(db, "user_subscriptions", "user_id,end_date,plan_id", (q: any) =>
    q.in("plan_id", ["whatsapp_share_trial", "tap_start_trial"]),
  );
  for (const row of trialSubs) {
    if (Number(row.end_date || 0) > now) ids.add(String(row.user_id || ""));
  }
  const trialProfiles = await pageRows(db, "profiles", "id,trial_end", (q: any) => q.gt("trial_end", now));
  for (const row of trialProfiles) {
    const id = String(row.id || "");
    if (id) ids.add(id);
  }
  return [...ids].filter(Boolean);
}

async function cancelAllTrials(db: SupabaseClient): Promise<number> {
  const ids = await collectTrialUserIds(db);
  const now = Date.now();
  for (const id of ids) {
    await revokeTrialAccess(db, id);
    const proof = await loadTrialProof(db, id);
    if (proof && proof.status === "activated") {
      proof.trialEnd = 0;
      proof.reviewedAt = now;
      await saveTrialProof(db, proof);
    }
  }
  return ids.length;
}

async function listTrialProofs(db: SupabaseClient): Promise<TrialProof[]> {
  const { data, error } = await db
    .from("trial_share_proofs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (!error && data?.length) {
    return (data as Record<string, unknown>[]).map((r) => parseTrialProof(camelKeys(r))).filter(Boolean) as TrialProof[];
  }
  const { data: settings } = await db.from("app_settings").select("key,value").like("key", "trial_proof:%").limit(300);
  const out: TrialProof[] = [];
  for (const row of settings || []) {
    try {
      const parsed = parseTrialProof(JSON.parse(String((row as { value?: string }).value || "")));
      if (parsed) out.push(parsed);
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

function packRoleSubscription(cfg: Record<string, unknown>, plans: Record<string, unknown>[]) {
  const c = camelKeys(cfg);
  return {
    role: String(c.role || ""),
    enabled: Number(c.enabled ?? 0) ? 1 : 0,
    trialEnabled: (c.trialEnabled === true || c.trialEnabled === 1 || c.trialEnabled === "1" || c.trialEnabled === "true") ? 1 : 0,
    trialDays: Number(c.trialDays || 0),
    videoUrl: String(c.videoUrl || ""),
    showVideo: Number(c.showVideo ?? 0) ? 1 : 0,
    updatedAt: Number(c.updatedAt || 0),
    plans: plans.map((p) => {
      const x = camelKeys(p);
      return {
        id: String(x.id || ""),
        role: String(x.role || c.role || ""),
        key: String(x.key || ""),
        duration: String(x.duration || ""),
        months: Number(x.months || 0),
        price: Number(x.price || 0),
        isActive: Number(x.isActive ?? 0) ? 1 : 0,
        isPopular: Number(x.isPopular ?? 0) ? 1 : 0,
        sortOrder: Number(x.sortOrder || 0),
      };
    }),
  };
}

function parsePaywallImageUrls(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((u) => String(u || "").trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 12);
  }
  if (typeof raw === "string" && raw.trim()) {
    const t = raw.trim();
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) return parsePaywallImageUrls(parsed);
    } catch {
      /* ignore */
    }
    if (/^https?:\/\//i.test(t)) return [t];
  }
  return [];
}

function packPaywallContent(row: Record<string, unknown> | null | undefined) {
  const c = camelKeys(row || {});
  return {
    id: String(c.id || "main"),
    title: String(c.title ?? ""),
    subtitle: String(c.subtitle ?? ""),
    buttonText: String(c.buttonText ?? ""),
    videoUrl: String(c.videoUrl || ""),
    showVideo: Number(c.showVideo || 0) ? 1 : 0,
    trialEnabled: Number(c.trialEnabled || 0) ? 1 : 0,
    trialDays: Number(c.trialDays || 0),
    bodyText: String(c.bodyText || ""),
    featuresText: String(c.featuresText || ""),
    imageUrls: parsePaywallImageUrls(c.imageUrls ?? row?.image_urls),
    updatedAt: Number(c.updatedAt || Date.now()),
  };
}

async function loadPaywallContent(db: SupabaseClient) {
  const { data } = await db.from("subscription_content").select("*").limit(1).maybeSingle();
  return packPaywallContent((data || { id: "main" }) as Record<string, unknown>);
}

async function upsertPaywallContent(
  db: SupabaseClient,
  packed: ReturnType<typeof packPaywallContent>,
) {
  const row = {
    id: packed.id || "main",
    title: packed.title,
    subtitle: packed.subtitle,
    button_text: packed.buttonText,
    video_url: packed.videoUrl,
    show_video: packed.showVideo,
    trial_enabled: packed.trialEnabled,
    trial_days: packed.trialDays,
    body_text: packed.bodyText,
    features_text: packed.featuresText,
    image_urls: JSON.stringify(packed.imageUrls || []),
    updated_at: Date.now(),
  };
  const { error } = await db.from("subscription_content").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
  return packPaywallContent(row as Record<string, unknown>);
}

export async function handleExtraRoutes(opts: {
  db: SupabaseClient;
  req: Request;
  method: string;
  path: string;
  url: URL;
  json: JsonFn;
}): Promise<Response | null> {
  const { db, req, method, path, url, json } = opts;

  const paid = await handlePaymentRoutes({ db, req, method, path, url, json, sessionProfile });
  if (paid) return paid;

  const spare = await handleSpareCatalogRoutes({ db, req, method, path, url, json });
  if (spare) return spare;

  const solutionsAdmin = await handleSolutionsAdminRoutes({ db, req, method, path, json });
  if (solutionsAdmin) return solutionsAdmin;

  const push = await handlePushRoutes({ db, req, method, path, url, json });
  if (push) return push;

  if (method === "GET" && (path === "/api/providers/nearby" || path === "/api/technicians/nearby")) {
    const lat = parseFloat(String(url.searchParams.get("lat") || ""));
    const lng = parseFloat(String(url.searchParams.get("lng") || ""));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ success: false, message: "lat and lng required" }, 400);
    }
    const radius = parseFloat(String(url.searchParams.get("radius") || "50")) || 50;
    const role = String(url.searchParams.get("role") || "technician").trim().toLowerCase() || "technician";
    const rows = await listNearbyProviders(db, { lat, lng, radiusKm: radius, role });
    return json(rows);
  }

  if (method === "GET" && path === "/api/admin/subscription-settings") {
    const auth = await requireEdgeAdmin(db, req, json, url.searchParams.get("phone") || "");
    if (auth) return auth;
    const content = await loadPaywallContent(db);
    return json({ success: true, content });
  }

  if (method === "PUT" && path === "/api/admin/subscription-settings/content") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await requireEdgeAdmin(
      db,
      req,
      json,
      String(body.phone || url.searchParams.get("phone") || ""),
    );
    if (auth) return auth;
    try {
      const existing = await loadPaywallContent(db);
      const next = {
        ...existing,
        title: body.title !== undefined ? String(body.title ?? "") : existing.title,
        subtitle: body.subtitle !== undefined ? String(body.subtitle ?? "") : existing.subtitle,
        buttonText: body.buttonText !== undefined ? String(body.buttonText ?? "") : existing.buttonText,
        videoUrl: body.videoUrl !== undefined ? String(body.videoUrl || "").trim() : existing.videoUrl,
        showVideo: body.showVideo !== undefined ? (body.showVideo ? 1 : 0) : existing.showVideo,
        trialEnabled: body.trialEnabled !== undefined ? (body.trialEnabled ? 1 : 0) : existing.trialEnabled,
        trialDays: body.trialDays !== undefined
          ? Math.max(0, parseInt(String(body.trialDays || "0"), 10) || 0)
          : existing.trialDays,
        bodyText: body.bodyText !== undefined ? String(body.bodyText || "") : existing.bodyText,
        featuresText: body.featuresText !== undefined ? String(body.featuresText || "") : existing.featuresText,
        imageUrls: body.imageUrls !== undefined ? parsePaywallImageUrls(body.imageUrls) : existing.imageUrls,
        updatedAt: Date.now(),
      };
      const content = await upsertPaywallContent(db, next);
      return json({ success: true, content });
    } catch (e) {
      return json({ success: false, message: e instanceof Error ? e.message : "Failed to save matter" }, 500);
    }
  }

  if (method === "POST" && path === "/api/admin/subscription-settings/photo") {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ success: false, message: "Could not read photo upload." }, 400);
    }
    const auth = await requireEdgeAdmin(db, req, json, String(form.get("phone") || ""));
    if (auth) return auth;
    let file: File | null = null;
    for (const [, value] of form.entries()) {
      if (typeof value !== "string") {
        file = value as File;
        break;
      }
    }
    if (!file) return json({ success: false, message: "No photo file received (field name must be \"file\")." }, 400);
    try {
      const existing = await loadPaywallContent(db);
      if (existing.imageUrls.length >= 12) {
        return json({ success: false, message: "Maximum 12 photos on the subscription screen." }, 400);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!bytes.length) return json({ success: false, message: "Photo file is empty." }, 400);
      if (bytes.length > 6 * 1024 * 1024) {
        return json({ success: false, message: "Photo is too large (max 6MB). Choose a smaller image." }, 413);
      }
      const named = String(file.name || "photo.jpg").toLowerCase();
      let ext = (named.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
      let contentType = file.type || "image/jpeg";
      if (!["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) ext = "jpg";
      if (contentType === "application/octet-stream") contentType = ext === "png" ? "image/png" : "image/jpeg";
      const bucket = (Deno.env.get("SUPABASE_STORAGE_BUCKET") || "media").trim();
      const supUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
      const key = `subscription/photos/${crypto.randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;
      const { error } = await db.storage.from(bucket).upload(key, bytes, { contentType, upsert: true });
      if (error) return json({ success: false, message: error.message || "Storage upload failed" }, 500);
      const photoUrl = `${supUrl}/storage/v1/object/public/${bucket}/${key}`;
      const content = await upsertPaywallContent(db, {
        ...existing,
        imageUrls: [...existing.imageUrls, photoUrl],
        updatedAt: Date.now(),
      });
      return json({ success: true, url: photoUrl, content });
    } catch (e) {
      return json({ success: false, message: e instanceof Error ? e.message : "Failed to upload photo" }, 500);
    }
  }

  if (method === "GET" && path === "/api/subscriptions") {
    await ensureTechnicianSubscriptionPlans(db);
    const { data: cfg } = await db.from("subscription_role_configs").select("*").eq("role", "technician").maybeSingle();
    const { data: planRows } = await db.from("subscription_role_plans").select("*").eq("role", "technician").order("sort_order", { ascending: true });
    const technician = packRoleSubscription((cfg || { role: "technician" }) as Record<string, unknown>, (planRows || []) as Record<string, unknown>[]);
    return json({ success: true, subscriptions: { technician } });
  }

  if (method === "PUT" && /^\/api\/subscriptions\/[^/]+$/.test(path)) {
    const role = decodeURIComponent(path.split("/")[3] || "").trim().toLowerCase();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    if (role !== "technician") {
      return json({ success: false, message: "Only technician subscription can be edited." }, 400);
    }
    await ensureTechnicianSubscriptionPlans(db);
    const now = Date.now();
    const { data: prevCfg } = await db.from("subscription_role_configs").select("trial_enabled, trial_days").eq("role", role).maybeSingle();
    const prevTrialOn = Number((prevCfg as { trial_enabled?: unknown } | null)?.trial_enabled || 0) === 1;
    const cfgPatch: Record<string, unknown> = { updated_at: now };
    if (body.enabled !== undefined) cfgPatch.enabled = body.enabled ? 1 : 0;
    if (body.trialEnabled !== undefined) {
      cfgPatch.trial_enabled = body.trialEnabled === true || body.trialEnabled === 1 || body.trialEnabled === "1" || body.trialEnabled === "true" ? 1 : 0;
    }
    if (body.trialDays !== undefined) cfgPatch.trial_days = Math.max(0, parseInt(String(body.trialDays || "0"), 10) || 0);
    if (cfgPatch.trial_enabled === 1 && (cfgPatch.trial_days === 0 || (body.trialDays === undefined && body.trialEnabled))) {
      const existingDays = parseInt(String((await db.from("subscription_role_configs").select("trial_days").eq("role", role).maybeSingle()).data?.trial_days ?? "0"), 10) || 0;
      if ((Number(cfgPatch.trial_days) || existingDays) <= 0) cfgPatch.trial_days = 1;
    }
    if (cfgPatch.trial_enabled === 1) {
      const { data: existingAccess } = await db.from("app_settings").select("id").eq("key", "trial_access_enabled").maybeSingle();
      if (existingAccess?.id) {
        await db.from("app_settings").update({ value: "1", updated_at: now }).eq("id", existingAccess.id);
      } else {
        await db.from("app_settings").insert({ id: crypto.randomUUID(), key: "trial_access_enabled", value: "1", updated_at: now });
      }
    }
    if (body.videoUrl !== undefined) cfgPatch.video_url = String(body.videoUrl || "").trim();
    if (body.showVideo !== undefined) cfgPatch.show_video = body.showVideo ? 1 : 0;
    await db.from("subscription_role_configs").update(cfgPatch).eq("role", role);
    const incoming = Array.isArray(body.plans) ? body.plans : [];
    for (const raw of incoming) {
      const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const id = String(p.id || "").trim();
      if (!id) continue;
      await db.from("subscription_role_plans").update({
        duration: String(p.duration || ""),
        months: Math.max(1, parseInt(String(p.months || "1"), 10) || 1),
        price: Math.max(0, parseInt(String(p.price || "0"), 10) || 0),
        is_active: p.isActive === true || p.isActive === 1 || p.isActive === "1" ? 1 : 0,
        is_popular: p.isPopular ? 1 : 0,
        sort_order: Number(p.sortOrder || 0),
        updated_at: now,
      }).eq("id", id).eq("role", role);
    }
    const { data: cfg } = await db.from("subscription_role_configs").select("*").eq("role", role).maybeSingle();
    const { data: plans } = await db.from("subscription_role_plans").select("*").eq("role", role).order("sort_order", { ascending: true });
    const packed = packRoleSubscription((cfg || { role }) as Record<string, unknown>, (plans || []) as Record<string, unknown>[]);
    let notified = 0;
    let notifyWarning = "";
    const trialJustOn = cfgPatch.trial_enabled === 1 && !prevTrialOn;
    if (trialJustOn) {
      const days = Number(packed.trialDays || cfgPatch.trial_days || 1);
      try {
        const push = await broadcastTrialAvailable(db, days);
        notified = Number(push.recipients || 0);
        if (push.id) notified = Math.max(notified, 1);
        if (!notified && push.warning) notifyWarning = push.warning;
      } catch (e) {
        notifyWarning = e instanceof Error ? e.message : String(e);
      }
    }
    return json({ success: true, config: packed, plans: packed.plans, notified, warning: notifyWarning || undefined });
  }

  if (method === "POST" && /^\/api\/subscriptions\/[^/]+\/video\/cf-finalize$/.test(path)) {
    const body = (await req.json().catch(() => ({}))) as { uid?: string; phone?: string };
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const role = decodeURIComponent(path.split("/")[3] || "").trim().toLowerCase();
    if (role !== "technician") return json({ success: false, message: "Only technician video can be updated." }, 400);
    const uid = String(body.uid || "").trim();
    const host = cfCustomerHost();
    if (!uid || !host) return json({ success: false, message: "uid required / Cloudflare Stream host missing" }, 400);
    const playbackUrl = `https://${host}/${uid}/manifest/video.m3u8`;
    await db.from("subscription_role_configs").update({
      video_url: playbackUrl,
      show_video: 1,
      updated_at: Date.now(),
    }).eq("role", role);
    return json({ success: true, url: playbackUrl });
  }

  if (method === "GET" && /^\/api\/app-settings\/[^/]+$/.test(path)) {
    const key = decodeURIComponent(path.split("/")[3] || "").trim();
    if (!key) return json({ value: "" });
    const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
    let value = String((data as { value?: string } | null)?.value || "");
    if (key === "default_push_notification_image" && /storage\.googleapis\.com/i.test(value)) {
      value = "https://arunmobi-app.web.app/notification-default.png";
    }
    return json({ value });
  }

  if (method === "PUT" && /^\/api\/app-settings\/[^/]+$/.test(path)) {
    const key = decodeURIComponent(path.split("/")[3] || "").trim();
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(key)) return json({ success: false, message: "Invalid key" }, 400);
    const body = (await req.json().catch(() => ({}))) as { value?: unknown; phone?: string };
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const value = String(body.value ?? "");
    const now = Date.now();
    const { data: existing } = await db.from("app_settings").select("id").eq("key", key).maybeSingle();
    if (existing?.id) {
      const { error } = await db.from("app_settings").update({ value, updated_at: now }).eq("id", existing.id);
      if (error) return json({ success: false, message: error.message }, 500);
    } else {
      const { error } = await db.from("app_settings").insert({ id: crypto.randomUUID(), key, value, updated_at: now });
      if (error) return json({ success: false, message: error.message }, 500);
    }
    return json({ success: true, key, value });
  }

  if (method === "POST" && path === "/api/profile/change-role") {
    const body = (await req.json().catch(() => ({}))) as { newRole?: string; userPhone?: string };
    const newRole = String(body.newRole || "").trim().toLowerCase();
    const assignable = new Set([
      "customer",
      "job_provider",
      "hotel_owner",
      "restaurant_owner",
      "technician",
      "teacher",
      "supplier",
      "shopkeeper",
      "doctor",
      "lawyer",
      "software_developer",
      "digital_marketer",
      "driver",
      "delivery_partner",
      "freelancer",
      "service_provider",
      "labour",
      "cleaner",
      "mechanic",
      "electrician",
      "plumber",
      "carpenter",
      "painter",
      "welder",
      "admin",
    ]);
    const selfService = new Set([...assignable].filter((r) => r !== "admin"));
    if (!assignable.has(newRole)) return json({ success: false, message: "Invalid role" }, 400);

    let me = await sessionProfile(db, req);
    const rawPhone = String(body.userPhone || "").trim();
    if (!me && rawPhone) {
      if (rawPhone.startsWith("email:")) {
        const { data } = await db.from("profiles").select("*").eq("phone", rawPhone).is("deleted_at", null).limit(1);
        me = (data?.[0] as Record<string, unknown>) || null;
        if (!me) {
          const email = rawPhone.slice(6);
          const { data: byEmail } = await db.from("profiles").select("*").eq("email", email).is("deleted_at", null).limit(1);
          me = (byEmail?.[0] as Record<string, unknown>) || null;
        }
      } else {
        const digits = rawPhone.replace(/\D/g, "");
        const phone = digits.replace(/^91/, "").slice(-10);
        if (phone.length >= 10) {
          const { data } = await db
            .from("profiles")
            .select("*")
            .is("deleted_at", null)
            .in("phone", [phone, `91${phone}`, `+91${phone}`, rawPhone])
            .limit(1);
          me = (data?.[0] as Record<string, unknown>) || null;
        }
      }
    }
    if (!me?.id) {
      return json({ success: false, message: "Session expired. Please log out and log in again." }, 401);
    }

    const currentRole = String(me.role || "").toLowerCase();
    const phoneDigits = String(me.phone || "").replace(/\D/g, "").slice(-10);
    const isSuperAdmin = phoneDigits === "8179142535" || phoneDigits === "9876543210";
    const isAdmin = currentRole === "admin" || isSuperAdmin;
    if (!isAdmin) {
      if (newRole === "admin") {
        return json({ success: false, message: "Only admins can switch to the admin role." }, 403);
      }
      if (newRole === "customer" && phoneDigits !== "8179142535") {
        return json({ success: false, message: "Only admin 8179142535 can switch to customer." }, 403);
      }
      if (!selfService.has(newRole)) return json({ success: false, message: "Invalid role" }, 400);
    } else if (newRole === "customer" && phoneDigits !== "8179142535") {
      return json({ success: false, message: "Only admin 8179142535 can switch to customer." }, 403);
    }

    const { error } = await db.from("profiles").update({ role: newRole }).eq("id", String(me.id));
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, message: "Role updated successfully", role: newRole, id: me.id });
  }

  if (method === "POST" && path === "/api/admin/change-role") {
    const body = (await req.json().catch(() => ({}))) as { userId?: string; newRole?: string; phone?: string };
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const adminMe = await sessionProfile(db, req);
    const adminPhone = last10Phone(String(adminMe?.phone || body.phone || ""));
    const newRole = String(body.newRole || "").trim().toLowerCase();
    const userId = String(body.userId || "").trim();
    if (!userId || !newRole) return json({ success: false, message: "userId and newRole required" }, 400);
    if (newRole === "customer" && adminPhone !== "8179142535") {
      return json({ success: false, message: "Only admin 8179142535 can switch to customer." }, 403);
    }
    const { error } = await db.from("profiles").update({ role: newRole }).eq("id", userId);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, message: "Role updated successfully" });
  }

  if (method === "GET" && path === "/api/trial-share/mine") {
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Sign in required" }, 401);
    const proof = await loadTrialProof(db, String(me.id));
    return json({ success: true, proof });
  }

  if (method === "POST" && path === "/api/trial-share/shared") {
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Sign in required" }, 401);
    const now = Date.now();
    const existing = await loadTrialProof(db, String(me.id));
    const proof: TrialProof = existing || {
      id: String(me.id),
      userId: String(me.id),
      userName: String(me.name || ""),
      userPhone: String(me.phone || ""),
      images: [],
      sharedAt: now,
      status: "pending",
      createdAt: now,
      reviewedAt: 0,
      trialStart: 0,
      trialEnd: 0,
    };
    proof.sharedAt = now;
    proof.userName = String(me.name || proof.userName);
    proof.userPhone = String(me.phone || proof.userPhone);
    if (proof.status === "rejected") proof.status = "pending";
    await saveTrialProof(db, proof);
    return json({ success: true, proof });
  }

  if (method === "POST" && path === "/api/trial-share/submit") {
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Sign in required" }, 401);
    const now = Date.now();
    if (Number(me.subscription_active || 0) === 1 && Number(me.subscription_end || 0) > now) {
      return json({ success: false, message: "Subscription already active" }, 400);
    }
    if (Number(me.trial_end || 0) > now) {
      return json({ success: false, message: "Trial already active" }, 400);
    }
    const body = (await req.json().catch(() => ({}))) as { images?: unknown };
    const images = (Array.isArray(body.images) ? body.images : [])
      .map((u) => String(u || "").trim())
      .filter((u) => /^https:\/\//i.test(u))
      .slice(0, 12);
    if (images.length < TRIAL_SHARE_MIN_IMAGES) {
      return json({ success: false, message: `Upload at least ${TRIAL_SHARE_MIN_IMAGES} WhatsApp screenshots` }, 400);
    }
    const existing = await loadTrialProof(db, String(me.id));
    if (!existing?.sharedAt) {
      return json({ success: false, message: "Tap Share now first, then upload WhatsApp screenshots" }, 400);
    }
    const proof: TrialProof = {
      id: String(me.id),
      userId: String(me.id),
      userName: String(me.name || ""),
      userPhone: String(me.phone || ""),
      images,
      sharedAt: existing.sharedAt,
      status: "pending",
      createdAt: existing.createdAt || now,
      reviewedAt: 0,
      trialStart: 0,
      trialEnd: 0,
    };
    await saveTrialProof(db, proof);
    return json({ success: true, proof, message: "Submitted. Admin will check your WhatsApp screenshots and give 5 days trial." });
  }

  if (method === "GET" && path === "/api/admin/trial-share-proofs") {
    const auth = await requireEdgeAdmin(db, req, json);
    if (auth) return auth;
    const proofs = await listTrialProofs(db);
    return json({ success: true, proofs });
  }

  if (method === "POST" && path === "/api/admin/trial-share-proofs/review") {
    const body = (await req.json().catch(() => ({}))) as { userId?: string; action?: string; phone?: string };
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const userId = String(body.userId || "").trim();
    const action = String(body.action || "").trim().toLowerCase();
    if (!userId || !["approve", "reject", "activate", "cancel", "remove"].includes(action)) {
      return json({ success: false, message: "userId and action (approve|reject|activate|cancel|remove) required" }, 400);
    }
    const proof = await loadTrialProof(db, userId);
    if (!proof && action !== "cancel") return json({ success: false, message: "Proof not found" }, 404);
    const now = Date.now();
    if (action === "remove") {
      if (proof) await revokeTrialAccess(db, userId);
      await deleteTrialProof(db, userId);
      return json({ success: true, removed: true, userId });
    }
    if (action === "cancel") {
      await revokeTrialAccess(db, userId);
      if (proof) {
        proof.trialEnd = 0;
        proof.reviewedAt = now;
        await saveTrialProof(db, proof);
      }
      return json({ success: true, cancelled: true, userId, proof });
    }
    if (!proof) return json({ success: false, message: "Proof not found" }, 404);
    if (action === "reject") {
      proof.status = "rejected";
      proof.reviewedAt = now;
      await saveTrialProof(db, proof);
      return json({ success: true, proof });
    }
    if (action === "approve") {
      if (proof.images.length < TRIAL_SHARE_MIN_IMAGES) {
        return json({ success: false, message: "Need at least 4 screenshots before approve" }, 400);
      }
      proof.status = "approved";
      proof.reviewedAt = now;
      await saveTrialProof(db, proof);
      return json({ success: true, proof });
    }
    const { data: accessFlag } = await db.from("app_settings").select("value").eq("key", "trial_access_enabled").maybeSingle();
    const accessRaw = accessFlag ? String((accessFlag as { value?: string }).value ?? "1").trim().toLowerCase() : "1";
    if (accessRaw === "0" || accessRaw === "false" || accessRaw === "off") {
      return json({ success: false, message: "Trials are turned off. Turn All trials ON first." }, 400);
    }
    if (proof.status !== "approved" && proof.status !== "activated") {
      return json({ success: false, message: "Approve the WhatsApp proof first, then tap Activate." }, 400);
    }
    const trialStart = now;
    const trialEnd = now + TRIAL_SHARE_DAYS * 24 * 60 * 60 * 1000;
    proof.status = "activated";
    proof.reviewedAt = now;
    proof.trialStart = trialStart;
    proof.trialEnd = trialEnd;
    await saveTrialProof(db, proof);
    const { error: profileErr } = await db.from("profiles").update({
      trial_used: 1,
      trial_start: trialStart,
      trial_end: trialEnd,
      subscription_active: 1,
      subscription_end: trialEnd,
    }).eq("id", userId);
    if (profileErr) return json({ success: false, message: profileErr.message }, 500);
    const { error: histErr } = await db.from("user_subscriptions").insert({
      id: crypto.randomUUID(),
      user_id: userId,
      plan_id: "whatsapp_share_trial",
      months: 1,
      start_date: trialStart,
      end_date: trialEnd,
      payment_id: "whatsapp_share_trial",
      razorpay_order_id: "",
      created_at: now,
    });
    if (histErr) console.warn("[trial-activate] history", histErr.message);
    try {
      await notifyUser(db, userId, {
        title: "5-day trial activated",
        body: "Your Mobi trial is on. Directory, Learn, Solutions, Leads, Jobs and the rest work as usual for 5 days.",
        data: { type: "trial_started", path: "/" },
      });
    } catch {
      /* ignore */
    }
    return json({ success: true, proof, trialStart, trialEnd });
  }

  if (method === "POST" && path === "/api/admin/trial-share-proofs/cancel-all") {
    const body = (await req.json().catch(() => ({}))) as { phone?: string };
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const cancelled = await cancelAllTrials(db);
    const now = Date.now();
    const { data: existing } = await db.from("app_settings").select("id").eq("key", "trial_access_enabled").maybeSingle();
    if (existing?.id) {
      await db.from("app_settings").update({ value: "0", updated_at: now }).eq("id", existing.id);
    } else {
      await db.from("app_settings").insert({ id: crypto.randomUUID(), key: "trial_access_enabled", value: "0", updated_at: now });
    }
    return json({ success: true, cancelled, trialAccessEnabled: 0 });
  }

  if (method === "POST" && path === "/api/chat/send-check") {
    return json({ allowed: true });
  }

  if (method === "POST" && path === "/api/auth/auto-login") {
    const body = (await req.json().catch(() => ({}))) as { phone?: string; email?: string };
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
    if (!phone && !email) return json({ success: false, message: "Phone or email is required" }, 400);
    let existing: Record<string, unknown> | null = null;
    if (email) {
      const { data } = await db.from("profiles").select("*").eq("email", email).is("deleted_at", null).limit(1);
      existing = (data?.[0] as Record<string, unknown>) || null;
    }
    if (!existing && phone) {
      const { data } = await db.from("profiles").select("*").is("deleted_at", null).in("phone", [phone, `91${phone}`, `+91${phone}`]).limit(1);
      existing = (data?.[0] as Record<string, unknown>) || null;
    }
    if (existing && phone && EDGE_ADMIN_PHONES.has(phone)) {
      await db.from("profiles").update({ is_teacher: 1, teacher_status: "approved" }).eq("id", String(existing.id));
      existing.is_teacher = 1;
      existing.teacher_status = "approved";
    }
    const sessionPhone = email && !phone ? (String(existing?.phone || `email:${email}`)) : phone;
    const sessionToken = crypto.randomUUID();
    await db.from("sessions").delete().eq("phone", sessionPhone);
    const { error } = await db.from("sessions").insert({ phone: sessionPhone, session_token: sessionToken, created_at: Date.now() });
    if (error) return json({ success: false, message: error.message }, 500);
    return json({
      success: true,
      message: "Auto-login successful",
      sessionToken,
      isNewUser: !existing,
      profile: existing ? camelKeys(existing) : null,
    });
  }

  if (method === "POST" && path === "/api/auth/google-phone-login") {
    const body = (await req.json().catch(() => ({}))) as { email?: string; phone?: string };
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
    if (!email || phone.length !== 10) return json({ success: false, message: "Email and 10-digit phone required" }, 400);
    const { data: byEmail } = await db.from("profiles").select("*").eq("email", email).limit(1);
    const { data: byPhone } = await db.from("profiles").select("*").in("phone", [phone, `91${phone}`]).limit(1);
    const found = (byEmail?.[0] || byPhone?.[0] || null) as Record<string, unknown> | null;
    const sessionToken = crypto.randomUUID();
    const sessionPhone = String(found?.phone || phone);
    await db.from("sessions").insert({ phone: sessionPhone, session_token: sessionToken, created_at: Date.now() });
    if (found && !found.email && email) await db.from("profiles").update({ email }).eq("id", found.id);
    return json({
      success: true,
      exists: Boolean(found),
      sessionToken,
      profile: found ? camelKeys(found) : null,
    });
  }

  if (method === "POST" && path === "/api/auth/check-email") {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return json({ success: false, message: "Email is required" }, 400);
    const { data } = await db.from("profiles").select("*").eq("email", email).is("deleted_at", null).limit(1);
    const existing = data?.[0] || null;
    return json({ success: true, exists: Boolean(existing), profile: existing ? camelKeys(existing as Record<string, unknown>) : null });
  }

  if (method === "POST" && path === "/api/auth/check-phone") {
    const body = (await req.json().catch(() => ({}))) as { phone?: string };
    const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
    if (!phone) return json({ success: false, message: "Phone number is required" }, 400);
    const { data } = await db.from("profiles").select("*").in("phone", [phone, `91${phone}`]).is("deleted_at", null).limit(1);
    const existing = data?.[0] || null;
    return json({ success: true, exists: Boolean(existing), profile: existing ? camelKeys(existing as Record<string, unknown>) : null });
  }

  if (method === "POST" && path === "/api/auth/link-contact") {
    const body = (await req.json().catch(() => ({}))) as { sessionToken?: string; phone?: string; email?: string; whatsapp?: string };
    const sessionToken = String(req.headers.get("x-session-token") || body.sessionToken || "").trim();
    if (!sessionToken) return json({ success: false, message: "Session required" }, 401);
    const { data: sess } = await db.from("sessions").select("phone").eq("session_token", sessionToken).maybeSingle();
    if (!sess) return json({ success: false, message: "Session expired. Please login again." }, 401);
    const sessionPhone = String(sess.phone || "");
    const digits = sessionPhone.replace(/\D/g, "").slice(-10);
    const { data: profs } = sessionPhone.startsWith("email:")
      ? await db.from("profiles").select("*").eq("email", sessionPhone.slice(6)).limit(1)
      : await db.from("profiles").select("*").in("phone", [digits, `91${digits}`, sessionPhone]).limit(1);
    const profile = profs?.[0] as Record<string, unknown> | undefined;
    if (!profile) return json({ success: false, message: "Profile not found" }, 404);
    const patch: Record<string, unknown> = {};
    if (body.email) patch.email = String(body.email).trim().toLowerCase();
    if (body.phone) patch.phone = String(body.phone).replace(/\D/g, "").slice(-10);
    if (body.whatsapp) patch.whatsapp = String(body.whatsapp);
    if (Object.keys(patch).length) await db.from("profiles").update(patch).eq("id", profile.id);
    const { data: updated } = await db.from("profiles").select("*").eq("id", profile.id).maybeSingle();
    const next = (updated || profile) as Record<string, unknown>;
    const newPhone = String(next.phone || patch.phone || "").trim();
    if (newPhone && !newPhone.startsWith("email:")) {
      await db.from("sessions").update({ phone: newPhone }).eq("session_token", sessionToken);
      if (sessionPhone.startsWith("email:")) {
        await db.from("sessions").update({ phone: newPhone }).eq("phone", sessionPhone);
      }
    }
    return json({ success: true, profile: camelKeys(next) });
  }

  if (method === "GET" && path === "/api/settings/insurance") {
    const { data } = await db.from("app_settings").select("key,value").in("key", [
      "insurance_plan_name",
      "insurance_plan_price",
      "insurance_plan_price_yearly",
      "insurance_plan_price_monthly",
      "insurance_repair_discount",
      "insurance_plan_status",
      "insurance_savings_text",
      "insurance_plan_features",
      "insurance_min_months",
      "insurance_plan_tagline",
      "insurance_button_text",
    ]);
    const map: Record<string, string> = {};
    for (const r of data || []) map[String((r as { key: string }).key)] = String((r as { value: string }).value || "");
    const yearlyPrice = parseInt(map.insurance_plan_price_yearly || map.insurance_plan_price || "1499", 10);
    const monthlyPrice = parseInt(map.insurance_plan_price_monthly || map.insurance_plan_price || "249", 10);
    const features = (map.insurance_plan_features || "Screen damage,Doorstep service").split(",").map((f) => f.trim()).filter(Boolean);
    return json({
      success: true,
      settings: {
        planName: map.insurance_plan_name || "Mobile Protection Plan",
        planTagline: map.insurance_plan_tagline || "Protect Your Phone",
        protectionPlanPrice: parseInt(map.insurance_plan_price || "50", 10),
        yearlyPrice,
        monthlyPrice,
        minMonths: parseInt(map.insurance_min_months || "3", 10),
        repairDiscount: parseInt(map.insurance_repair_discount || "500", 10),
        savingsText: map.insurance_savings_text || "Save up to ₹4000 on repairs",
        features,
        buttonText: map.insurance_button_text || "Get Protection",
        status: (map.insurance_plan_status || "active") as "active" | "disabled",
      },
    });
  }

  if (method === "GET" && path === "/api/categories") {
    const { data } = await db.from("service_categories").select("*").eq("is_active", 1).order("sort_order", { ascending: true });
    return json({ success: true, categories: (data || []).map((r) => camelKeys(r as Record<string, unknown>)) });
  }

  if (method === "GET" && path === "/api/ads/active") {
    const { data } = await db.from("ads").select("*").eq("is_active", 1).order("sort_order", { ascending: true }).limit(20);
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "GET" && path === "/api/stats/online") {
    const since = Date.now() - 15 * 60 * 1000;
    const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).gte("last_seen", since);
    return json({ online: count || 0, success: true });
  }

  if (method === "GET" && path === "/api/nearby") {
    const lat = Number(url.searchParams.get("lat") || "0");
    const lng = Number(url.searchParams.get("lng") || "0");
    const radius = Number(url.searchParams.get("radius") || "25") || 25;
    const roles = String(url.searchParams.get("roles") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let q = db.from("profiles").select("id,name,role,city,skills,latitude,longitude,avatar,rating,rating_count").is("deleted_at", null).limit(400);
    if (roles.length === 1) q = q.eq("role", roles[0]);
    const { data } = await q;
    const out = [];
    for (const raw of data || []) {
      const p = camelKeys(raw as Record<string, unknown>);
      const plat = Number(p.latitude);
      const plng = Number(p.longitude);
      if (!Number.isFinite(plat) || !Number.isFinite(plng) || !Number.isFinite(lat)) {
        continue;
      }
      const distance = haversineKm(lat, lng, plat, plng);
      if (distance > radius) continue;
      if (roles.length > 1 && !roles.includes(String(p.role || ""))) continue;
      out.push({ ...p, distance });
    }
    out.sort((a, b) => Number(a.distance) - Number(b.distance));
    return json(out.slice(0, 80));
  }

  if (method === "GET" && path === "/api/search") {
    const qtxt = String(url.searchParams.get("q") || "").trim();
    if (qtxt.length < 2) {
      return json({ success: true, query: qtxt, results: { profiles: [], products: [], courses: [], categories: [] } });
    }
    const like = `%${qtxt}%`;
    const [{ data: profiles }, { data: products }, { data: courses }, { data: categories }] = await Promise.all([
      db.from("profiles").select("id,name,role,city,avatar").ilike("name", like).limit(12),
      db.from("products").select("*").or(`title.ilike.${like},description.ilike.${like}`).limit(12),
      db.from("courses").select("*").ilike("title", like).limit(8),
      db.from("service_categories").select("*").ilike("name", like).limit(8),
    ]);
    return json({
      success: true,
      query: qtxt,
      results: {
        profiles: (profiles || []).map((d) => ({ type: "profile", data: camelKeys(d as Record<string, unknown>) })),
        products: (products || []).map((d) => ({ type: "product", data: camelKeys(d as Record<string, unknown>) })),
        courses: (courses || []).map((d) => ({ type: "course", data: camelKeys(d as Record<string, unknown>) })),
        categories: (categories || []).map((d) => ({ type: "category", data: camelKeys(d as Record<string, unknown>) })),
      },
    });
  }

  if (method === "GET" && path.startsWith("/api/conversations/")) {
    const userId = decodeURIComponent(path.slice("/api/conversations/".length).split("/")[0] || "");
    if (!userId) return json([]);
    const { data: a } = await db.from("conversations").select("*").eq("participant1_id", userId).order("last_message_at", { ascending: false }).limit(200);
    const { data: b } = await db.from("conversations").select("*").eq("participant2_id", userId).order("last_message_at", { ascending: false }).limit(200);
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of [...(a || []), ...(b || [])]) {
      if (row?.id) byId.set(String(row.id), camelKeys(row as Record<string, unknown>));
    }
    return json([...byId.values()]);
  }

  if (method === "POST" && path === "/api/conversations") {
    const body = (await req.json().catch(() => ({}))) as Record<string, string>;
    const p1 = String(body.participant1Id || "");
    const p2 = String(body.participant2Id || "");
    if (!p1 || !p2) return json({ success: false, message: "participants required" }, 400);
    const { data: existing } = await db
      .from("conversations")
      .select("*")
      .or(`and(participant1_id.eq.${p1},participant2_id.eq.${p2}),and(participant1_id.eq.${p2},participant2_id.eq.${p1})`)
      .limit(1);
    if (existing?.[0]) return json({ success: true, conversation: camelKeys(existing[0] as Record<string, unknown>) });
    const now = Date.now();
    const row = {
      id: crypto.randomUUID(),
      participant1_id: p1,
      participant1_name: String(body.participant1Name || ""),
      participant1_role: String(body.participant1Role || ""),
      participant2_id: p2,
      participant2_name: String(body.participant2Name || ""),
      participant2_role: String(body.participant2Role || ""),
      last_message: "",
      last_message_at: now,
      created_at: now,
    };
    const { error } = await db.from("conversations").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, conversation: camelKeys(row) });
  }

  if (method === "DELETE" && path.startsWith("/api/conversations/")) {
    const id = decodeURIComponent(path.slice("/api/conversations/".length));
    await db.from("messages").delete().eq("conversation_id", id);
    await db.from("conversations").delete().eq("id", id);
    return json({ success: true });
  }

  if (method === "GET" && path.startsWith("/api/messages/") && path.includes("/since/")) {
    const parts = path.split("/");
    const conversationId = decodeURIComponent(parts[3] || "");
    const since = Number(parts[5] || 0) || 0;
    const { data } = await db.from("messages").select("*").eq("conversation_id", conversationId).gt("created_at", since).order("created_at", { ascending: true }).limit(200);
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "GET" && path.startsWith("/api/messages/")) {
    const conversationId = decodeURIComponent(path.slice("/api/messages/".length).split("/")[0] || "");
    const { data } = await db.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(400);
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "POST" && path === "/api/messages") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = Date.now();
    const conversationId = String(body.conversationId || body.convoId || "");
    const row = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      sender_id: String(body.senderId || ""),
      sender_name: String(body.senderName || ""),
      text: String(body.text || ""),
      image: String(body.image || ""),
      created_at: now,
    };
    const { error } = await db.from("messages").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    await db.from("conversations").update({ last_message: row.text || "[image]", last_message_sender_id: row.sender_id, last_message_at: now }).eq("id", conversationId);
    try {
      const { data: convo } = await db.from("conversations").select("participant1_id, participant2_id").eq("id", conversationId).maybeSingle();
      const p1 = String(convo?.participant1_id || "");
      const p2 = String(convo?.participant2_id || "");
      const other = p1 && p1 === row.sender_id ? p2 : p1;
      if (other) {
        const preview = row.text || (row.image ? "Sent a photo" : "New message");
        void notifyUser(db, other, {
          title: row.sender_name || "New message",
          body: preview.slice(0, 120),
          data: { type: "chat_message", conversationId, path: `/chat/${conversationId}` },
        });
      }
    } catch {
      /* ignore */
    }
    return json({ success: true, message: camelKeys(row) });
  }

  if (method === "POST" && /^\/api\/posts\/[^/]+\/view$/.test(path)) {
    const id = path.split("/")[3];
    const { data } = await db.from("posts").select("views").eq("id", id).maybeSingle();
    if (!data) return json({ success: false, message: "Post not found" }, 404);
    const views = Number(data.views || 0) + 1;
    await db.from("posts").update({ views }).eq("id", id);
    return json({ success: true, views });
  }

  if (method === "GET" && path.startsWith("/api/admin/author-contact/")) {
    const userId = decodeURIComponent(path.slice("/api/admin/author-contact/".length).split("/")[0] || "");
    const auth = await requireEdgeAdmin(db, req, json);
    if (auth) return auth;
    if (!userId) return json({ success: false, message: "userId required" }, 400);
    const { data: row } = await db
      .from("profiles")
      .select("id, phone, whatsapp, subscription_active, subscription_end, trial_used, trial_start, trial_end")
      .eq("id", userId)
      .maybeSingle();
    const payload = authorContactPayload((row as Record<string, unknown>) || { id: userId });
    return json({ success: true, ...payload });
  }

  if (method === "POST" && path === "/api/admin/author-contacts") {
    const body = (await req.json().catch(() => ({}))) as { userIds?: unknown[]; phone?: string };
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const userIds = [...new Set((body.userIds || []).map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 80);
    if (!userIds.length) return json({ success: true, contacts: [] });
    const { data: rows } = await db
      .from("profiles")
      .select("id, phone, whatsapp, subscription_active, subscription_end, trial_used, trial_start, trial_end")
      .in("id", userIds);
    const contacts = (rows || []).map((r) => authorContactPayload(r as Record<string, unknown>));
    return json({ success: true, contacts });
  }

  if (method === "POST" && (path === "/api/admin/grant-subscription" || path === "/api/admin/subscriptions")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const userId = String(body.userId || body.targetUserId || "").trim();
    // body.phone is admin auth (always overwritten by the admin UI). Never treat it as the member.
    const targetPhone = String(body.targetPhone || body.userPhone || "").trim();
    const months = Number(body.months) || 12;
    if ((!userId && !targetPhone) || ![1, 12].includes(months)) {
      return json({ success: false, message: "userId and months (1 or 12) required" }, 400);
    }
    const user = await findExistingMemberProfile(db, userId, targetPhone);
    if (!user?.id) return json({ success: false, message: "User not found" }, 404);
    const now = Date.now();
    const currentEnd = Number(user.subscription_end ?? user.subscriptionEnd ?? 0) || 0;
    const base = currentEnd > now ? currentEnd : now;
    const subscriptionEnd = base + months * 30 * 24 * 60 * 60 * 1000;
    const { error } = await db
      .from("profiles")
      .update({
        subscription_active: 1,
        subscription_end: subscriptionEnd,
      })
      .eq("id", String(user.id));
    if (error) return json({ success: false, message: error.message }, 500);
    const { error: histErr } = await db.from("user_subscriptions").insert({
      id: crypto.randomUUID(),
      user_id: String(user.id),
      plan_id: "admin_grant",
      months,
      start_date: base,
      end_date: subscriptionEnd,
      payment_id: "admin_grant",
      razorpay_order_id: "",
      created_at: now,
    });
    if (histErr) console.warn("[grant-subscription] history insert", histErr.message);
    const name = String(user.name || "A member").trim() || "A member";
    const congrats = subscriptionCongrats(name, months);
    const image = await resolveNotificationImage(db);
    try {
      await db.from("admin_notifications").insert({
        id: crypto.randomUUID(),
        type: "SUBSCRIPTION",
        user_id: String(user.id),
        user_name: String(user.name || ""),
        phone: String(user.phone || ""),
        reason: `${months} month grant`,
        title: congrats.title,
        body: congrats.memberBody,
        image,
        read: 0,
        created_at: now,
      });
    } catch (e) {
      console.warn("[grant-subscription] inbox", e instanceof Error ? e.message : e);
    }
    let notified = 0;
    let notifyWarning = "";
    try {
      const broadcast = await broadcastPush(
        db,
        congrats.title,
        congrats.broadcastBody,
        { type: "new_subscription", userId: String(user.id), path: "/profile", image },
        image,
      );
      notified += Number(broadcast.recipients || 0);
      if (broadcast.id) notified = Math.max(notified, 1);
      if (!notified && broadcast.warning) notifyWarning = broadcast.warning;
    } catch (e) {
      notifyWarning = e instanceof Error ? e.message : String(e);
    }
    return json({
      success: true,
      subscriptionEnd,
      userId: String(user.id),
      phone: String(user.phone || ""),
      notified,
      warning: notifyWarning || undefined,
    });
  }

  if (method === "POST" && path === "/api/admin/revoke-subscription") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const userId = String(body.userId || body.targetUserId || "").trim();
    const targetPhone = String(body.targetPhone || body.userPhone || "").trim();
    if (!userId && !targetPhone) return json({ success: false, message: "userId required" }, 400);
    const user = await findExistingMemberProfile(db, userId, targetPhone);
    if (!user?.id) return json({ success: false, message: "User not found" }, 404);
    const { error } = await db
      .from("profiles")
      .update({
        subscription_active: 0,
        subscription_end: 0,
        subscription_order_id: "",
        trial_used: 0,
        trial_start: 0,
        trial_end: 0,
      })
      .eq("id", String(user.id));
    if (error) return json({ success: false, message: error.message }, 500);
    const { error: histErr } = await db.from("user_subscriptions").delete().eq("user_id", String(user.id));
    if (histErr) console.warn("[revoke-subscription] history delete", histErr.message);
    return json({ success: true, userId: String(user.id) });
  }

  if (method === "POST" && path === "/api/admin/trial/notify-all") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const { data: cfg } = await db.from("subscription_role_configs").select("trial_enabled, trial_days").eq("role", "technician").maybeSingle();
    const days = Math.max(1, parseInt(String((cfg as { trial_days?: unknown } | null)?.trial_days ?? "1"), 10) || 1);
    try {
      const push = await broadcastTrialAvailable(db, days);
      let notified = Number(push.recipients || 0);
      if (push.id) notified = Math.max(notified, 1);
      return json({ success: true, notified, warning: push.warning || undefined, days });
    } catch (e) {
      return json({ success: false, message: e instanceof Error ? e.message : "Failed to notify" }, 500);
    }
  }

  if (method === "GET" && (path === "/api/admin/subscribers" || path === "/api/admin/active-subscriptions" || path === "/api/admin/trial-activations")) {
    const auth = await requireEdgeAdmin(db, req, json);
    if (auth) return auth;
    try {
      if (path === "/api/admin/trial-activations") {
        const all = await buildAdminSubscriberRows(db, false);
        const trials = all
          .filter((row) => Number(row.trialStart || 0) > 0 || Number(row.trialEnd || 0) > 0 || String(row.plan || "") === "Trial" || String(row.status || "").toLowerCase().includes("trial"))
          .map((row) => ({
            ...row,
            whatsapp: row.phone,
            startDate: row.trialStart || row.startDate,
            subscriptionEnd: row.trialEnd || row.subscriptionEnd,
            plan: "Trial",
            status: row.trialActive ? "Trial" : "Trial ended",
          }))
          .sort((a, b) => Number(b.trialActive ? 1 : 0) - Number(a.trialActive ? 1 : 0) || Number(b.trialStart || 0) - Number(a.trialStart || 0));
        return json(trials);
      }
      const wantAll = path === "/api/admin/subscribers" || String(url.searchParams.get("all") || "") === "1";
      const rows = await buildAdminSubscriberRows(db, !wantAll);
      return json(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[admin subscribers]", msg);
      return json([]);
    }
  }

  if (method === "GET" && (path === "/api/admin/export-users" || path === "/api/admin/export-subscribers")) {
    const auth = await requireEdgeAdmin(db, req, json);
    if (auth) return auth;
    try {
      if (path === "/api/admin/export-subscribers") {
        const csv = await buildSubscribersExportCsv(db);
        const filename = `mobi-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
        const count = Math.max(0, csv.split(/\r?\n/).length - 1);
        return json({ success: true, csv, filename, count });
      }
      const exported = await buildUsersExportCsv(db);
      const filename = `mobi-users-${new Date().toISOString().slice(0, 10)}.csv`;
      return json({ success: true, csv: exported.csv, filename, count: exported.count });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[admin export]", msg);
      return json({ success: false, message: msg || "Export failed" }, 500);
    }
  }

  if (method === "GET" && path === "/api/admin/revenue") {
    const auth = await requireEdgeAdmin(db, req, json);
    if (auth) return auth;
    try {
      const payload = await buildAdminRevenue(db);
      return json(payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[admin revenue]", msg);
      return json({ success: false, message: "Failed to fetch revenue" }, 500);
    }
  }

  if (method === "POST" && /^\/api\/posts\/[^/]+\/like$/.test(path)) {
    const id = path.split("/")[3];
    const body = (await req.json().catch(() => ({}))) as { userId?: string };
    const { data } = await db.from("posts").select("likes").eq("id", id).maybeSingle();
    let likes: string[] = [];
    try {
      likes = JSON.parse(String(data?.likes || "[]"));
    } catch {
      likes = [];
    }
    const uid = String(body.userId || "");
    if (uid) {
      likes = likes.includes(uid) ? likes.filter((x) => x !== uid) : [...likes, uid];
      await db.from("posts").update({ likes: JSON.stringify(likes) }).eq("id", id);
    }
    return json({ success: true, likes });
  }

  if (method === "POST" && /^\/api\/posts\/[^/]+\/comment$/.test(path)) {
    const id = path.split("/")[3];
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = String(body.text || "").trim();
    if (!text) return json({ success: false, message: "Missing comment text" }, 400);
    const { data } = await db.from("posts").select("comments").eq("id", id).maybeSingle();
    let comments: unknown[] = [];
    try {
      comments = JSON.parse(String(data?.comments || "[]"));
    } catch {
      comments = [];
    }
    const newComment = {
      id: crypto.randomUUID(),
      userId: body.userId,
      userName: body.userName,
      text,
      createdAt: Date.now(),
    };
    comments.push(newComment);
    await db.from("posts").update({ comments: JSON.stringify(comments) }).eq("id", id);
    return json({ success: true, comment: newComment, comments });
  }

  if (method === "DELETE" && path.startsWith("/api/posts/")) {
    const id = path.slice("/api/posts/".length);
    await db.from("posts").delete().eq("id", id);
    return json({ success: true });
  }

  if (method === "POST" && path === "/api/jobs") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const row = {
      id: crypto.randomUUID(),
      user_id: String(body.userId || ""),
      user_name: String(body.userName || ""),
      title: String(body.title || ""),
      description: String(body.description || ""),
      city: String(body.city || ""),
      state: String(body.state || ""),
      skills: typeof body.skills === "string" ? body.skills : JSON.stringify(body.skills || []),
      salary: String(body.salary || ""),
      type: String(body.type || "full_time"),
      category: String(body.category || "Other"),
      location: String(body.location || body.city || ""),
      contact_phone: String(body.contactPhone || ""),
      image: String(body.image || ""),
      company_name: String(body.companyName || ""),
      status: "active",
      approved: 1,
      featured: 0,
      created_at: Date.now(),
    };
    const { error } = await db.from("jobs").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, job: camelKeys(row) });
  }

  if (method === "DELETE" && path.startsWith("/api/jobs/")) {
    const id = path.slice("/api/jobs/".length).split("/")[0];
    await db.from("jobs").delete().eq("id", id);
    return json({ success: true });
  }

  if (method === "PUT" && /^\/api\/profiles\/[^/]+$/.test(path)) {
    const id = path.split("/")[3];
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch = toSnake(body);
    delete patch.id;
    const { error } = await db.from("profiles").update(patch).eq("id", id);
    if (error) return json({ success: false, message: error.message }, 500);
    const { data } = await db.from("profiles").select("*").eq("id", id).maybeSingle();
    return json({ success: true, profile: camelKeys(data as Record<string, unknown>) });
  }

  if (method === "POST" && /\/api\/profiles\/[^/]+\/location$/.test(path)) {
    const id = path.split("/")[3];
    const body = (await req.json().catch(() => ({}))) as { latitude?: string; longitude?: string };
    await db.from("profiles").update({ latitude: body.latitude, longitude: body.longitude }).eq("id", id);
    return json({ success: true });
  }

  if (method === "GET" && /^\/api\/products\/[^/]+$/.test(path)) {
    const id = path.slice("/api/products/".length).split("/")[0];
    const { data } = await db.from("products").select("*").eq("id", id).maybeSingle();
    if (!data) return json({ success: false, message: "Product not found" }, 404);
    const row = data as Record<string, unknown>;
    let images: unknown[] = [];
    try {
      images = typeof row.images === "string" ? JSON.parse(String(row.images)) : row.images || [];
    } catch {
      images = [];
    }
    return json({ ...camelKeys(row), images, success: true });
  }

  if (method === "POST" && path === "/api/products") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = String(body.userId || "").trim();
    const title = String(body.title || "").trim();
    if (!userId || !title) return json({ success: false, message: "Missing required fields" }, 400);
    const userRole = String(body.userRole || "supplier").toLowerCase() || "supplier";
    const images = Array.isArray(body.images) ? JSON.stringify(body.images) : String(body.images || "[]");
    const productId = String(body.id || crypto.randomUUID());
    const row = {
      id: productId,
      user_id: userId,
      user_name: String(body.userName || ""),
      user_role: userRole,
      user_avatar: String(body.userAvatar || ""),
      title,
      description: String(body.description || ""),
      price: String(body.price || "0"),
      category: String(body.category || "other"),
      images,
      thumbnail: String(body.thumbnail || ""),
      city: String(body.city || ""),
      state: String(body.state || ""),
      in_stock: Number(body.inStock ?? 1) ? 1 : 0,
      video_url: String(body.videoUrl || ""),
      delivery_info: String(body.deliveryInfo || ""),
      contact_phone: String(body.contactPhone || ""),
      views: 0,
      likes: "[]",
      created_at: Date.now(),
    };
    const { data: existing } = await db.from("products").select("id").eq("id", productId).maybeSingle();
    if (existing) {
      const { error } = await db.from("products").update({
        title: row.title,
        description: row.description,
        price: row.price,
        category: row.category,
        images: row.images,
        thumbnail: row.thumbnail,
        city: row.city,
        state: row.state,
        in_stock: row.in_stock,
        video_url: row.video_url,
        delivery_info: row.delivery_info,
        contact_phone: row.contact_phone,
      }).eq("id", productId);
      if (error) return json({ success: false, message: error.message }, 500);
    } else {
      const { error } = await db.from("products").insert(row);
      if (error) return json({ success: false, message: error.message }, 500);
    }
    return json({ success: true, id: productId, product: camelKeys({ ...row, images: JSON.parse(images) }) });
  }

  if (method === "DELETE" && path.startsWith("/api/products/")) {
    const id = path.slice("/api/products/".length).split("/")[0];
    await db.from("products").delete().eq("id", id);
    return json({ success: true });
  }

  if (method === "GET" && path === "/api/orders") {
    const sellerId = url.searchParams.get("sellerId") || "";
    const buyerId = url.searchParams.get("buyerId") || "";
    let q = db.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
    if (sellerId) q = q.eq("seller_id", sellerId);
    if (buyerId) q = q.eq("buyer_id", buyerId);
    const { data } = await q;
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "GET" && /^\/api\/orders\/[^/]+$/.test(path)) {
    const id = path.slice("/api/orders/".length);
    const { data } = await db.from("orders").select("*").eq("id", id).maybeSingle();
    if (!data) return json({ success: false, message: "Not found" }, 404);
    return json(camelKeys(data as Record<string, unknown>));
  }

  if (method === "POST" && path === "/api/orders") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = Date.now();
    const row = {
      id: crypto.randomUUID(),
      product_id: String(body.productId || ""),
      product_title: String(body.productTitle || ""),
      product_price: String(body.productPrice || "0"),
      product_image: String(body.productImage || ""),
      product_category: String(body.productCategory || ""),
      buyer_id: String(body.buyerId || ""),
      buyer_name: String(body.buyerName || ""),
      buyer_phone: String(body.buyerPhone || ""),
      buyer_city: String(body.buyerCity || ""),
      buyer_state: String(body.buyerState || ""),
      buyer_pincode: String(body.buyerPincode || ""),
      seller_id: String(body.sellerId || ""),
      seller_name: String(body.sellerName || ""),
      seller_role: String(body.sellerRole || ""),
      quantity: Number(body.quantity || 1) || 1,
      total_amount: String(body.totalAmount || "0"),
      status: "pending",
      shipping_address: String(body.shippingAddress || ""),
      delivery_latitude: String(body.deliveryLatitude || ""),
      delivery_longitude: String(body.deliveryLongitude || ""),
      buyer_notes: String(body.buyerNotes || ""),
      seller_notes: "",
      updated_at: now,
      created_at: now,
    };
    const { error } = await db.from("orders").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, order: camelKeys(row) });
  }

  if (method === "PATCH" && /\/api\/orders\/[^/]+\/status$/.test(path)) {
    const id = path.split("/")[3];
    const body = (await req.json().catch(() => ({}))) as { status?: string };
    await db.from("orders").update({ status: String(body.status || ""), updated_at: Date.now() }).eq("id", id);
    return json({ success: true });
  }

  if (method === "GET" && path === "/api/leads") {
    const { data } = await db.from("leads").select("*").order("created_at", { ascending: false }).limit(80);
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "GET" && path === "/api/leads/my-leads") {
    const me = await sessionProfile(db, req);
    if (!me) return json([]);
    const { data } = await db.from("leads").select("*").eq("customer_id", String(me.id)).order("created_at", { ascending: false }).limit(80);
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "POST" && path === "/api/leads") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = Date.now();
    const targetRole = String(body.targetRole || body.selectedRole || body.category || "technician")
      .trim()
      .toLowerCase() || "technician";
    const row = {
      id: crypto.randomUUID(),
      customer_id: String(body.customerId || ""),
      customer_name: String(body.customerName || ""),
      title: String(body.title || ""),
      description: String(body.description || ""),
      category: targetRole,
      city: String(body.city || ""),
      location: String(body.location || body.city || ""),
      contact_number: String(body.contactNumber || body.phoneNumber || ""),
      latitude: String(body.latitude ?? body.lat ?? ""),
      longitude: String(body.longitude ?? body.lng ?? ""),
      status: "open",
      purchased_by: "[]",
      max_buyers: 5,
      price: Number(body.price || 50) || 50,
      created_at: now,
      updated_at: now,
    };
    const { error } = await db.from("leads").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);

    const preview = `${targetRole.replace(/_/g, " ")} lead — ${row.title || "New request"} — ${row.customer_name || "Customer"}`.slice(0, 120);
    const notifyData = { type: "new_lead", leadId: row.id, path: "/leads", targetRole };
    void (async () => {
      try {
        const { data: roleUsers } = await db
          .from("profiles")
          .select("id")
          .ilike("role", targetRole)
          .is("deleted_at", null)
          .limit(4000);
        const roleIds = (roleUsers || [])
          .map((p) => String((p as { id?: string }).id || ""))
          .filter(Boolean);
        const out = await notifyUsersByRole(
          db,
          targetRole,
          { title: "New lead in Lead Box", body: preview, data: notifyData },
          roleIds,
        );
        await sendNotification("New lead in Lead Box", preview, notifyData, ["8179142535", "9876543210"]);
        const inboxIds = roleIds.slice(0, 80);
        if (inboxIds.length) {
          await db.from("admin_notifications").insert(
            inboxIds.map((uid) => ({
              id: crypto.randomUUID(),
              type: "NEW_LEAD",
              user_id: uid,
              user_name: "",
              phone: "",
              reason: JSON.stringify(notifyData),
              title: "New lead in Lead Box",
              body: preview,
              image: "",
              read: 0,
              created_at: now,
            })),
          );
        }
        console.log("[leads] notify", targetRole, "users=", roleIds.length, "push=", out.recipients, out.id || "-", out.warning || "");
      } catch (e) {
        console.warn("[leads] notify failed", e instanceof Error ? e.message : e);
      }
    })();

    return json({ success: true, lead: camelKeys(row) });
  }

  if (method === "POST" && /\/api\/leads\/[^/]+\/claim$/.test(path)) {
    return json({ success: true, message: "Lead claim recorded. Payment is not processed on Edge yet." });
  }

  if (method === "GET" && path === "/api/community/stats") {
    const { count } = await db.from("profiles").select("id", { count: "exact", head: true });
    return json({ totalMembers: Number(count || 0), success: true });
  }

  if (method === "POST" && path === "/api/live-chat/presence") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const me = await sessionProfile(db, req);
    const userId = String(me?.id || body.userId || "").trim();
    if (!userId) return json({ success: false, message: "userId required" }, 400);
    await saveLiveChatPresence(db, {
      id: userId,
      name: String(body.name || me?.name || "").trim(),
      role: String(body.role || me?.role || "").trim(),
      avatar: String(body.avatar || me?.avatar || "").trim(),
    });
    return json({ success: true });
  }

  if (method === "DELETE" && path === "/api/live-chat/presence") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const me = await sessionProfile(db, req);
    const userId = String(me?.id || body.userId || "").trim();
    if (userId) await removeLiveChatPresence(db, userId);
    return json({ success: true });
  }

  if (method === "GET" && path === "/api/live-chat/online-users") {
    const users = await listLiveChatOnline(db);
    return json(users);
  }

  if (method === "GET" && path === "/api/live-chat/messages") {
    const limit = Math.min(Number(url.searchParams.get("limit") || "30") || 30, 80);
    const after = Number(url.searchParams.get("after") || "0") || 0;
    let q = db.from("live_chat_messages").select("*").order("created_at", { ascending: false }).limit(limit);
    if (after) q = q.gt("created_at", after);
    const { data } = await q;
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)).reverse());
  }

  if (method === "POST" && path === "/api/live-chat/messages") {
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, allowed: false, reason: "Sign in required." }, 401);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const senderId = String(me.id);
    if (body.senderId && String(body.senderId).trim() && String(body.senderId).trim() !== senderId) {
      return json({
        success: false,
        allowed: false,
        reason: "You can only send messages as your signed-in account.",
      }, 403);
    }
    const message = String(body.message || body.text || "").trim();
    const image = String(body.image || "").trim();
    const video = String(body.video || "").trim();
    if (!message && !image && !video) {
      return json({ success: false, allowed: false, reason: "message, image or video required" }, 400);
    }
    const row = {
      id: crypto.randomUUID(),
      sender_id: senderId,
      sender_name: String(body.senderName || me.name || "").trim(),
      sender_role: String(body.senderRole || me.role || "").trim(),
      sender_avatar: String(body.senderAvatar || me.avatar || "").trim(),
      message,
      image,
      video,
      created_at: Date.now(),
    };
    const { error } = await db.from("live_chat_messages").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    const preview = message
      ? message.slice(0, 80)
      : image
        ? "sent a photo"
        : video
          ? "sent a video"
          : "sent a message";
    void (async () => {
      const pushImage = await resolveNotificationImage(db, image.startsWith("https://") ? image : "");
      await broadcastPush(
        db,
        "Live Chat",
        `${row.sender_name || "Member"}: ${preview}`,
        { type: "live_chat", senderId, path: "/live-chat" },
        pushImage,
      );
    })().catch((e) => console.warn("[live-chat] notify", e instanceof Error ? e.message : e));
    return json({ success: true, allowed: true, message: camelKeys(row) });
  }

  if (method === "DELETE" && path === "/api/live-chat/clear") {
    const auth = await requireEdgeAdmin(db, req, json, url.searchParams.get("adminPhone") || url.searchParams.get("phone") || "");
    if (auth) return auth;
    const { error } = await db.from("live_chat_messages").delete().gte("created_at", 0);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, message: "Live chat cleared" });
  }

  if (method === "DELETE" && path.startsWith("/api/live-chat/messages/")) {
    const auth = await requireEdgeAdmin(db, req, json, url.searchParams.get("phone") || url.searchParams.get("adminPhone") || "");
    if (auth) return auth;
    const id = decodeURIComponent(path.slice("/api/live-chat/messages/".length).split("/")[0] || "").trim();
    if (!id) return json({ success: false, message: "Message id required" }, 400);
    const deletedText = "This message was deleted by Arun sir";
    const { error } = await db
      .from("live_chat_messages")
      .update({ message: deletedText, image: "", video: "" })
      .eq("id", id);
    if (error) {
      const del = await db.from("live_chat_messages").delete().eq("id", id);
      if (del.error) return json({ success: false, message: del.error.message }, 500);
    }
    return json({ success: true });
  }

  if (method === "GET" && path === "/api/teacher/status") {
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Sign in required" }, 401);
    const application = await latestTeacherApplication(db, String(me.id));
    return json(packTeacherStatus(me, application));
  }

  if (method === "POST" && path === "/api/teacher/apply") {
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Sign in required" }, 401);
    if (isApprovedTeacherEdge(me)) return json(packTeacherStatus(me));
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name || me.name || "").trim().slice(0, 80);
    const bio = String(body.bio || "").trim().slice(0, 2000);
    const intro = String(body.intro || "").trim().slice(0, 2000);
    if (!name || name.length < 2) return json({ success: false, message: "Name is required" }, 400);
    const saved = await setProfileTeacherAccess(db, String(me.id), { approved: false, pending: true, bio, intro });
    if (saved.error) return json({ success: false, message: saved.error }, 500);
    await upsertTeacherApplication(db, me, { status: "pending", name, bio, intro });
    const application = await latestTeacherApplication(db, String(me.id));
    return json({
      success: true,
      isTeacher: 0,
      teacherStatus: "pending",
      teacherBio: bio,
      teacherIntro: intro,
      application: application ? camelKeys(application) : null,
    });
  }

  if (method === "GET" && path === "/api/admin/teacher-applications") {
    const auth = await requireEdgeAdmin(db, req, json, url.searchParams.get("phone") || "");
    if (auth) return auth;
    const status = String(url.searchParams.get("status") || "pending").trim();
    let q: any = db.from("teacher_applications").select("*");
    if (status && status !== "all") q = q.eq("status", status);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
    if (error) return json({ success: false, message: error.message, applications: [] }, 200);
    return json({
      success: true,
      applications: (data || []).map((r) => camelKeys(r as Record<string, unknown>)),
    });
  }

  if (method === "POST" && /^\/api\/admin\/teacher-applications\/[^/]+\/(approve|reject)$/.test(path)) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const parts = path.split("/");
    const id = decodeURIComponent(parts[4] || "").trim();
    const nextStatus = parts[5] === "approve" ? "approved" : "rejected";
    const { data: application, error: loadErr } = await db.from("teacher_applications").select("*").eq("id", id).maybeSingle();
    if (loadErr) return json({ success: false, message: loadErr.message }, 500);
    if (!application) return json({ success: false, message: "Application not found" }, 404);
    const now = Date.now();
    const { error: upErr } = await db.from("teacher_applications").update({
      status: nextStatus,
      admin_note: String(body.adminNote || body.note || "").trim().slice(0, 500),
      reviewed_by: String(body.reviewedBy || "admin"),
      reviewed_at: now,
    }).eq("id", id);
    if (upErr) return json({ success: false, message: upErr.message }, 500);
    const userId = String((application as { user_id?: string }).user_id || "");
    if (userId) {
      await setProfileTeacherAccess(db, userId, {
        approved: nextStatus === "approved",
        bio: String((application as { bio?: string }).bio || ""),
        intro: String((application as { intro?: string }).intro || ""),
      });
    }
    const { data: updated } = await db.from("teacher_applications").select("*").eq("id", id).maybeSingle();
    return json({ success: true, application: camelKeys((updated || application) as Record<string, unknown>) });
  }

  if (method === "POST" && /^\/api\/admin\/users\/[^/]+\/grant-teacher$/.test(path)) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const userId = decodeURIComponent(path.split("/")[4] || "").trim() || String(body.userId || "").trim();
    const profile = await findExistingMemberProfile(db, userId, String(body.targetPhone || ""));
    if (!profile?.id) return json({ success: false, message: "User not found" }, 404);
    const bio = String(body.bio || profile.teacher_bio || "").trim().slice(0, 2000);
    const intro = String(body.intro || profile.teacher_intro || "").trim().slice(0, 2000);
    const saved = await setProfileTeacherAccess(db, String(profile.id), { approved: true, bio, intro });
    if (saved.error) return json({ success: false, message: saved.error }, 500);
    await upsertTeacherApplication(db, profile, {
      status: "approved",
      name: String(profile.name || "Teacher"),
      bio,
      intro,
      reviewedBy: String(body.reviewedBy || "admin"),
      adminNote: "Granted via admin panel",
    });
    return json({ success: true, isTeacher: 1, teacherStatus: "approved" });
  }

  if (method === "POST" && /^\/api\/admin\/users\/[^/]+\/revoke-teacher$/.test(path)) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await requireEdgeAdmin(db, req, json, String(body.phone || ""));
    if (auth) return auth;
    const userId = decodeURIComponent(path.split("/")[4] || "").trim() || String(body.userId || "").trim();
    const profile = await findExistingMemberProfile(db, userId, String(body.targetPhone || ""));
    if (!profile?.id) return json({ success: false, message: "User not found" }, 404);
    const saved = await setProfileTeacherAccess(db, String(profile.id), { approved: false });
    if (saved.error) return json({ success: false, message: saved.error }, 500);
    await upsertTeacherApplication(db, profile, {
      status: "rejected",
      reviewedBy: String(body.reviewedBy || "admin"),
      adminNote: "Revoked via admin panel",
    });
    return json({ success: true, isTeacher: 0, teacherStatus: "none" });
  }

  if (method === "GET" && path === "/api/courses") {
    const { data } = await db.from("courses").select("*").order("created_at", { ascending: false }).limit(80);
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "GET" && path === "/api/teacher-courses/mine") {
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Sign in required" }, 401);
    if (!isApprovedTeacherEdge(me)) {
      return json({ success: false, message: "Only approved teachers can list courses" }, 403);
    }
    const { data } = await db.from("courses").select("*").eq("teacher_id", String(me.id)).order("created_at", { ascending: false }).limit(200);
    return json({ success: true, courses: (data || []).map((r) => camelKeys(r as Record<string, unknown>)) });
  }

  if (method === "GET" && path === "/api/teacher-courses") {
    const { data } = await db.from("courses").select("*").eq("is_published", 1).order("created_at", { ascending: false }).limit(80);
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "GET" && /^\/api\/courses\/[^/]+$/.test(path)) {
    const id = path.slice("/api/courses/".length);
    const packed = await loadCourseWithChapters(db, id);
    if (!packed) return json({ success: false, message: "Not found" }, 404);
    return json(packed);
  }

  if (method === "POST" && path === "/api/courses") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const teacherId = String(body.teacherId || "").trim();
    const title = String(body.title || "").trim();
    if (!teacherId || !title) return json({ success: false, message: "teacherId and title are required" }, 400);
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Sign in as the course owner to create or edit" }, 401);
    if (String(me.id) !== teacherId && !isEdgeAdminProfile(me)) {
      return json({ success: false, message: "Sign in as the course owner to create or edit" }, 401);
    }
    if (!isApprovedTeacherEdge(me)) {
      return json({ success: false, message: "Only approved teachers can create courses" }, 403);
    }
    const now = Date.now();
    const courseId = String(body.id || crypto.randomUUID());
    const published = toPublishedInt(body.isPublished);
    const row = {
      id: courseId,
      teacher_id: teacherId,
      teacher_name: String(body.teacherName || me.name || ""),
      teacher_avatar: String(body.teacherAvatar || me.avatar || ""),
      title,
      description: String(body.description || ""),
      price: String(body.price || "0"),
      cover_image: String(body.coverImage || ""),
      category: String(body.category || "course"),
      language: String(body.language || "hindi"),
      demo_duration: Number(body.demoDuration) || 60,
      access_days: Number(body.accessDays) || 365,
      total_videos: 0,
      total_duration: 0,
      enrollment_count: 0,
      rating: "0",
      is_published: published,
      created_at: now,
    };
    const { error } = await db.from("courses").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    if (published === 1) {
      await awaitPush(
        notifyNewCourse(db, {
          title,
          teacherName: row.teacher_name,
          courseId,
          coverImage: row.cover_image,
        }),
      );
    }
    return json({ success: true, course: camelKeys(row) });
  }

  if (method === "PUT" && /^\/api\/courses\/[^/]+$/.test(path)) {
    const id = path.slice("/api/courses/".length);
    const me = await sessionProfile(db, req);
    const { data: existing } = await db.from("courses").select("*").eq("id", id).maybeSingle();
    if (!existing) return json({ success: false, message: "Course not found" }, 404);
    if (!me?.id) return json({ success: false, message: "Sign in required" }, 401);
    if (String(existing.teacher_id) !== String(me.id) && !isEdgeAdminProfile(me)) {
      return json({ success: false, message: "Not your course" }, 403);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.description !== undefined) patch.description = String(body.description);
    if (body.price !== undefined) patch.price = String(body.price);
    if (body.coverImage !== undefined) patch.cover_image = String(body.coverImage);
    if (body.category !== undefined) patch.category = String(body.category);
    if (body.language !== undefined) patch.language = String(body.language);
    if (body.demoDuration !== undefined) patch.demo_duration = Number(body.demoDuration) || 0;
    if (body.accessDays !== undefined) patch.access_days = Number(body.accessDays) || 365;
    if (body.isPublished !== undefined) patch.is_published = toPublishedInt(body.isPublished);
    if (body.teacherName !== undefined) patch.teacher_name = String(body.teacherName);
    if (body.teacherAvatar !== undefined) patch.teacher_avatar = String(body.teacherAvatar);
    const wasUnpublished = toPublishedInt(existing.is_published) !== 1;
    if (Object.keys(patch).length) {
      const { error } = await db.from("courses").update(patch).eq("id", id);
      if (error) return json({ success: false, message: error.message }, 500);
    }
    const packed = await loadCourseWithChapters(db, id);
    const nowPublished = toPublishedInt(patch.is_published !== undefined ? patch.is_published : existing.is_published) === 1;
    if (nowPublished && wasUnpublished) {
      await awaitPush(
        notifyNewCourse(db, {
          title: String(patch.title ?? existing.title ?? ""),
          teacherName: String(patch.teacher_name ?? existing.teacher_name ?? ""),
          courseId: id,
          coverImage: String(patch.cover_image ?? existing.cover_image ?? ""),
        }),
      );
    }
    return json({ success: true, course: packed });
  }

  if (method === "DELETE" && /^\/api\/courses\/[^/]+$/.test(path)) {
    const id = path.slice("/api/courses/".length);
    const me = await sessionProfile(db, req);
    const { data: existing } = await db.from("courses").select("teacher_id").eq("id", id).maybeSingle();
    if (!existing) return json({ success: false, message: "Course not found" }, 404);
    if (!me?.id || (String(existing.teacher_id) !== String(me.id) && !isEdgeAdminProfile(me))) {
      return json({ success: false, message: "Not your course" }, 403);
    }
    await db.from("course_videos").delete().eq("course_id", id);
    await db.from("course_chapters").delete().eq("course_id", id);
    await db.from("courses").delete().eq("id", id);
    return json({ success: true });
  }

  if (method === "POST" && /^\/api\/courses\/[^/]+\/chapters$/.test(path)) {
    const courseId = path.split("/")[3];
    const owned = await requireCourseOwner(db, req, courseId);
    if (owned.error) return json(owned.error, owned.status);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(body.title || "").trim();
    if (!title) return json({ success: false, message: "Title is required" }, 400);
    const row = {
      id: crypto.randomUUID(),
      course_id: courseId,
      title,
      description: String(body.description || ""),
      thumbnail_url: String(body.thumbnailUrl || ""),
      sort_order: Number(body.sortOrder) || 0,
      created_at: Date.now(),
    };
    const { error } = await db.from("course_chapters").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, chapter: camelKeys(row) });
  }

  if (method === "PUT" && /^\/api\/courses\/[^/]+\/chapters\/[^/]+$/.test(path)) {
    const parts = path.split("/");
    const courseId = parts[3];
    const chapterId = parts[5];
    const owned = await requireCourseOwner(db, req, courseId);
    if (owned.error) return json(owned.error, owned.status);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.description !== undefined) patch.description = String(body.description);
    if (body.sortOrder !== undefined) patch.sort_order = Number(body.sortOrder) || 0;
    if (body.thumbnailUrl !== undefined) patch.thumbnail_url = String(body.thumbnailUrl);
    if (Object.keys(patch).length) await db.from("course_chapters").update(patch).eq("id", chapterId);
    const { data } = await db.from("course_chapters").select("*").eq("id", chapterId).maybeSingle();
    return json({ success: true, chapter: camelKeys(data as Record<string, unknown>) });
  }

  if (method === "DELETE" && /^\/api\/courses\/[^/]+\/chapters\/[^/]+$/.test(path)) {
    const parts = path.split("/");
    const courseId = parts[3];
    const chapterId = parts[5];
    const owned = await requireCourseOwner(db, req, courseId);
    if (owned.error) return json(owned.error, owned.status);
    await db.from("course_videos").delete().eq("chapter_id", chapterId);
    await db.from("course_chapters").delete().eq("id", chapterId);
    return json({ success: true });
  }

  if (method === "POST" && /^\/api\/courses\/[^/]+\/chapters\/[^/]+\/videos$/.test(path)) {
    const parts = path.split("/");
    const courseId = parts[3];
    const chapterId = parts[5];
    const owned = await requireCourseOwner(db, req, courseId);
    if (owned.error) return json(owned.error, owned.status);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(body.title || "").trim();
    const videoUrl = String(body.videoUrl || "").trim();
    if (!title || !videoUrl) return json({ success: false, message: "Title and videoUrl are required" }, 400);
    const row = {
      id: crypto.randomUUID(),
      course_id: courseId,
      chapter_id: chapterId,
      title,
      description: String(body.description || ""),
      video_url: videoUrl,
      thumbnail_url: String(body.thumbnailUrl || ""),
      duration: Number(body.duration) || 0,
      sort_order: Number(body.sortOrder) || 0,
      is_demo: body.isDemo ? 1 : 0,
      cf_stream_uid: String(body.cfStreamUid || ""),
      stream_status: String(body.streamStatus || (body.cfStreamUid ? "processing" : "")),
      created_at: Date.now(),
    };
    const { error } = await db.from("course_videos").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    await refreshCourseTotals(db, courseId);
    await notifyIfPublishedCourseVideo(db, courseId, row.thumbnail_url);
    return json({ success: true, video: camelKeys(row) });
  }

  if (method === "DELETE" && /^\/api\/courses\/[^/]+\/videos\/[^/]+$/.test(path)) {
    const parts = path.split("/");
    const courseId = parts[3];
    const videoId = parts[5];
    const owned = await requireCourseOwner(db, req, courseId);
    if (owned.error) return json(owned.error, owned.status);
    await db.from("course_videos").delete().eq("id", videoId);
    await refreshCourseTotals(db, courseId);
    return json({ success: true });
  }

  if (method === "POST" && /^\/api\/teacher-courses\/[^/]+\/folders$/.test(path)) {
    const courseId = path.split("/")[3];
    const owned = await requireCourseOwner(db, req, courseId);
    if (owned.error) return json(owned.error, owned.status);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(body.title || "").trim();
    if (!title) return json({ success: false, message: "Folder title is required" }, 400);
    const row = {
      id: crypto.randomUUID(),
      course_id: courseId,
      title,
      description: String(body.description || ""),
      thumbnail_url: String(body.thumbnailUrl || ""),
      sort_order: Number(body.sortOrder) || 0,
      created_at: Date.now(),
    };
    const { error } = await db.from("course_chapters").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    const chapter = camelKeys(row);
    return json({ success: true, folder: chapter, chapter });
  }

  if (method === "POST" && /^\/api\/teacher-courses\/[^/]+\/folders\/[^/]+\/cf-direct-upload$/.test(path)) {
    const parts = path.split("/");
    const courseId = parts[3];
    const folderId = parts[5];
    const owned = await requireCourseOwner(db, req, courseId);
    if (owned.error) return json(owned.error, owned.status);
    const { data: folder } = await db.from("course_chapters").select("id,course_id").eq("id", folderId).maybeSingle();
    if (!folder || String(folder.course_id) !== courseId) return json({ success: false, message: "Folder not found" }, 404);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const filename = String(body.filename || body.name || "video.mp4").trim() || "video.mp4";
    const title = String(body.title || filename).trim();
    const fileSize = Number(body.fileSize || body.size || 0);
    const platform = String(body.platform || "").toLowerCase();
    const preferStream = platform === "web" || /^(1|true|web)$/i.test(String(body.preferStream || ""));
    const forceMultipart = /^(1|true|r2-multipart)$/i.test(String(body.forceMultipart || body.uploadVia || ""));
    const preferR2 = !preferStream && (platform === "android" || platform === "ios") && fileSize >= 80 * 1024 * 1024;
    try {
      if ((preferStream || forceMultipart) && isR2UploadConfigured()) {
        return json(await startTeacherR2Multipart({ courseId, folderId, filename }));
      }
      if (preferR2 && isR2UploadConfigured()) {
        return json(await startTeacherR2Upload({ courseId, folderId, filename }));
      }
      const started = await createCfDirectUpload({
        name: title || filename,
        maxDurationSeconds: Number(body.maxDurationSeconds) || 7200,
        db,
      });
      return json({
        success: true,
        id: crypto.randomUUID(),
        uid: started.uid,
        uploadURL: started.uploadURL,
        uploadMethod: "POST",
        provider: "cloudflare_stream",
        folderId,
        courseId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start upload";
      if (preferStream && isR2UploadConfigured()) {
        try {
          return json(await startTeacherR2Multipart({ courseId, folderId, filename }));
        } catch (e2) {
          return json({ success: false, message: e2 instanceof Error ? e2.message : msg }, 503);
        }
      }
      if (isR2UploadConfigured() && !preferStream && (platform === "android" || platform === "ios") && (isStreamQuotaError(msg) || /not configured/i.test(msg))) {
        try {
          return json(await startTeacherR2Upload({ courseId, folderId, filename }));
        } catch (e2) {
          return json({ success: false, message: e2 instanceof Error ? e2.message : msg }, 503);
        }
      }
      return json({ success: false, message: msg }, 503);
    }
  }

  if (method === "POST" && /^\/api\/teacher-courses\/[^/]+\/videos\/upload-part$/.test(path)) {
    const courseId = path.split("/")[3];
    const owned = await requireCourseOwner(db, req, courseId);
    if (owned.error) return json(owned.error, owned.status);
    const MAX_CHUNK_BYTES = Math.floor(5.5 * 1024 * 1024);
    const form = await req.formData();
    let chunk: File | null = null;
    const fields: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        fields[key] = value;
        continue;
      }
      if (!chunk) chunk = value as File;
    }
    if (!chunk) return json({ success: false, message: 'Missing chunk (field "chunk").' }, 400);
    if (!isR2UploadConfigured()) return json({ success: false, message: "Cloudflare R2 not configured" }, 500);
    const partNumber = Math.max(1, parseInt(String(fields.partNumber || "0"), 10) || 0);
    const totalParts = Math.max(1, parseInt(String(fields.totalParts || "0"), 10) || 0);
    const objectKey = sanitizeR2ObjectKey(String(fields.objectKey || "").trim());
    const uploadId = String(fields.uploadId || "").trim();
    if (!objectKey || !uploadId || partNumber > totalParts) {
      return json({ success: false, message: "objectKey, uploadId, partNumber, totalParts required" }, 400);
    }
    const bytes = new Uint8Array(await chunk.arrayBuffer());
    if (bytes.length > MAX_CHUNK_BYTES) return json({ success: false, message: "Chunk too large" }, 413);
    let etag = "";
    try {
      etag = await r2UploadPart({ objectKey, uploadId, partNumber, bytes });
    } catch (e) {
      return json({ success: false, message: e instanceof Error ? e.message : "Chunk upload failed" }, 500);
    }
    if (partNumber < totalParts) {
      return json({ success: true, etag, uploadId, partNumber, complete: false });
    }
    let parts: Array<{ partNumber: number; etag: string }> = [];
    try {
      const parsed = JSON.parse(String(fields.partsJson || "[]"));
      if (Array.isArray(parsed)) {
        parts = parsed
          .map((p: { partNumber?: number; etag?: string }) => ({
            partNumber: Number(p.partNumber) || 0,
            etag: String(p.etag || ""),
          }))
          .filter((p: { partNumber: number; etag: string }) => p.partNumber > 0 && p.etag);
      }
    } catch {
      parts = [];
    }
    parts = [...parts.filter((p) => p.partNumber !== partNumber), { partNumber, etag }];
    try {
      await r2CompleteMultipartUpload({ objectKey, uploadId, parts });
    } catch (e) {
      return json({ success: false, message: e instanceof Error ? e.message : "Could not complete upload" }, 500);
    }
    return json({ success: true, etag, uploadId, objectKey, complete: true });
  }

  if (method === "POST" && /^\/api\/teacher-courses\/[^/]+\/videos\/cf-finalize$/.test(path)) {
    const courseId = path.split("/")[3];
    const owned = await requireCourseOwner(db, req, courseId);
    if (owned.error) return json(owned.error, owned.status);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const uid = String(body.uid || "").trim();
    const objectKey = String(body.objectKey || body.object_key || "").trim();
    const provider = String(body.provider || "").trim().toLowerCase();
    const folderId = String(body.folderId || body.chapterId || "").trim();
    const title = String(body.title || "Untitled video").trim();
    const videoId = String(body.id || body.videoId || crypto.randomUUID()).trim();
    const { data: existingVideos } = await db.from("course_videos").select("id").eq("chapter_id", folderId);
    const useR2 = provider === "r2" || provider === "r2-multipart" || (!!objectKey && !uid);
    if (useR2) {
      if (!objectKey || !folderId) return json({ success: false, message: "objectKey and folderId required" }, 400);
      const signed = await signR2GetUrl(objectKey, 12 * 3600);
      const row = {
        id: videoId,
        course_id: courseId,
        chapter_id: folderId,
        title,
        description: String(body.description || ""),
        video_url: signed || `r2:${objectKey}`,
        thumbnail_url: String(body.thumbnailUrl || ""),
        duration: Number(body.duration) || 0,
        sort_order: (existingVideos || []).length + 1,
        is_demo: body.isDemo ? 1 : 0,
        cf_stream_uid: `r2:${objectKey}`,
        stream_status: "ready",
        created_at: Date.now(),
      };
      const { error } = await db.from("course_videos").insert(row);
      if (error) return json({ success: false, message: error.message }, 500);
      await refreshCourseTotals(db, courseId);
      await notifyIfPublishedCourseVideo(db, courseId, row.thumbnail_url);
      return json({ success: true, video: await withSignedCourseVideo(camelKeys(row)), ready: true });
    }
    if (!uid || !folderId) return json({ success: false, message: "uid and folderId required" }, 400);
    const host = cfCustomerHost();
    if (!host) return json({ success: false, message: "CLOUDFLARE_STREAM_CUSTOMER_HOST missing" }, 500);
    const playbackUrl = `https://${host}/${uid}/manifest/video.m3u8`;
    const thumbnail = `https://${host}/${uid}/thumbnails/thumbnail.jpg`;
    const row = {
      id: videoId,
      course_id: courseId,
      chapter_id: folderId,
      title,
      description: String(body.description || ""),
      video_url: playbackUrl,
      thumbnail_url: String(body.thumbnailUrl || thumbnail),
      duration: Number(body.duration) || 0,
      sort_order: (existingVideos || []).length + 1,
      is_demo: body.isDemo ? 1 : 0,
      cf_stream_uid: uid,
      stream_status: "processing",
      created_at: Date.now(),
    };
    const { error } = await db.from("course_videos").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    await refreshCourseTotals(db, courseId);
    await notifyIfPublishedCourseVideo(db, courseId, row.thumbnail_url);
    return json({ success: true, video: camelKeys(row), ready: false });
  }

  if (method === "GET" && /^\/api\/teacher-courses\/[^/]+\/playback\/[^/]+$/.test(path)) {
    const courseId = path.split("/")[3];
    const videoId = path.split("/")[5];
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Sign in required" }, 401);
    const { data: video } = await db.from("course_videos").select("*").eq("id", videoId).maybeSingle();
    if (!video || String((video as { course_id?: string }).course_id) !== courseId) {
      return json({ success: false, message: "Video not found" }, 404);
    }
    const packed = await withSignedCourseVideo(camelKeys(video as Record<string, unknown>));
    return json({
      success: true,
      url: String(packed.videoUrl || ""),
      duration: Number(packed.duration || 0),
      title: String(packed.title || ""),
      thumbnailUrl: String(packed.thumbnailUrl || ""),
    });
  }

  if (method === "GET" && path === "/api/hospitality/venues") {
    const { data } = await db.from("hospitality_venues").select("*").order("created_at", { ascending: false }).limit(80);
    return json({ venues: (data || []).map((r) => camelKeys(r as Record<string, unknown>)) });
  }

  if (method === "GET" && path.startsWith("/api/enrollments/check")) {
    return json({ enrolled: false, success: true });
  }

  if (method === "GET" && path === "/api/service-bookings") {
    const as = url.searchParams.get("as") || "customer";
    const me = await sessionProfile(db, req);
    if (!me) return json([]);
    const col = as === "provider" ? "provider_id" : "customer_id";
    const { data } = await db.from("service_bookings").select("*").eq(col, String(me.id)).order("created_at", { ascending: false }).limit(80);
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "GET" && path === "/api/service-bookings/open") {
    const { data } = await db.from("service_bookings").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(80);
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "POST" && path === "/api/service-bookings") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const me = await sessionProfile(db, req);
    const row = {
      id: crypto.randomUUID(),
      customer_id: String(me?.id || body.customerId || ""),
      category_id: String(body.categoryId || ""),
      title: String(body.title || ""),
      description: String(body.description || ""),
      status: "pending",
      pickup_lat: String(body.pickupLat || ""),
      pickup_lng: String(body.pickupLng || ""),
      pickup_address: String(body.pickupAddress || ""),
      otp: String(Math.floor(1000 + Math.random() * 9000)),
      created_at: Date.now(),
    };
    const { error } = await db.from("service_bookings").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, booking: camelKeys(row) });
  }

  if (method === "PATCH" && /\/api\/service-bookings\/[^/]+\/(accept|status)$/.test(path)) {
    const id = path.split("/")[3];
    const action = path.split("/")[4];
    const me = await sessionProfile(db, req);
    const body = (await req.json().catch(() => ({}))) as { status?: string };
    const patch: Record<string, unknown> = action === "accept"
      ? { status: "accepted", provider_id: me?.id }
      : { status: String(body.status || "accepted") };
    await db.from("service_bookings").update(patch).eq("id", id);
    return json({ success: true });
  }

  if (method === "POST" && path === "/api/reviews") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const me = await sessionProfile(db, req);
    const row = {
      id: crypto.randomUUID(),
      booking_id: String(body.bookingId || "") || null,
      reviewer_id: String(me?.id || body.reviewerId || ""),
      reviewee_id: String(body.revieweeId || ""),
      rating: Number(body.rating || 5) || 5,
      comment: String(body.comment || ""),
      created_at: Date.now(),
    };
    const { error } = await db.from("reviews").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, review: camelKeys(row) });
  }

  if (method === "POST" && path === "/api/rides/estimate") {
    return json({ success: true, estimatedPrice: "80", distanceKm: "5" });
  }

  if (method === "POST" && path === "/api/rides") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const me = await sessionProfile(db, req);
    const row = {
      id: crypto.randomUUID(),
      customer_id: String(me?.id || ""),
      vehicle_type: String(body.vehicleType || "bike"),
      pickup_lat: String(body.pickupLat || ""),
      pickup_lng: String(body.pickupLng || ""),
      pickup_address: String(body.pickupAddress || ""),
      drop_lat: String(body.dropLat || ""),
      drop_lng: String(body.dropLng || ""),
      drop_address: String(body.dropAddress || ""),
      estimated_price: String(body.estimatedPrice || "80"),
      status: "searching",
      otp: String(Math.floor(1000 + Math.random() * 9000)),
      created_at: Date.now(),
    };
    const { error } = await db.from("rides").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, ride: camelKeys(row) });
  }

  if (method === "GET" && path === "/api/rides/mine") {
    const me = await sessionProfile(db, req);
    if (!me) return json([]);
    const { data } = await db.from("rides").select("*").or(`customer_id.eq.${me.id},driver_id.eq.${me.id}`).order("created_at", { ascending: false }).limit(40);
    return json((data || []).map((r) => camelKeys(r as Record<string, unknown>)));
  }

  if (method === "GET" && (path.startsWith("/api/reels/") && path.endsWith("/comments"))) {
    const reelId = path.split("/")[3];
    const { data } = await db.from("mobi_reel_comments").select("*").eq("reel_id", reelId).order("created_at", { ascending: false }).limit(50);
    return json({
      comments: (data || []).map((r) => {
        const c = camelKeys(r as Record<string, unknown>);
        return {
          id: c.id,
          user_id: c.userId,
          user_display_name: c.userDisplayName,
          reel_id: c.reelId,
          comment: c.comment,
          created_at: new Date(Number(c.createdAt) || Date.now()).toISOString(),
        };
      }),
    });
  }

  if (method === "POST" && /\/api\/reels\/[^/]+\/comments$/.test(path)) {
    const reelId = path.split("/")[3];
    const body = (await req.json().catch(() => ({}))) as { text?: string; phone?: string };
    const me = await sessionProfile(db, req);
    if (!me) return json({ error: "Unauthorized" }, 401);
    const { data, error } = await db
      .from("mobi_reel_comments")
      .insert({
        reel_id: reelId,
        user_id: me.id,
        user_display_name: me.name || "User",
        comment: String(body.text || "").slice(0, 1000),
      })
      .select("*")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ comment: data });
  }

  if (method === "POST" && /\/api\/reels\/[^/]+\/view$/.test(path)) {
    const reelId = path.split("/")[3];
    const { data } = await db.from("mobi_reels").select("views_count").eq("id", reelId).maybeSingle();
    const next = Number(data?.views_count || 0) + 1;
    await db.from("mobi_reels").update({ views_count: next }).eq("id", reelId);
    return json({ success: true, views: next });
  }

  if (method === "GET" && path.startsWith("/api/reels/liked-ids")) {
    const me = await sessionProfile(db, req);
    if (!me) return json({ ids: [] });
    const { data } = await db.from("mobi_reel_likes").select("reel_id").eq("user_id", String(me.id)).limit(500);
    return json({ ids: (data || []).map((r) => String((r as { reel_id: string }).reel_id)) });
  }

  if (method === "GET" && (path === "/folders" || path === "/api/solutions/folders" || path === "/api/folders")) {
    const libRaw = String(url.searchParams.get("library") || "hardware").trim().toLowerCase();
    const library = libRaw === "course" ? "course" : "hardware";
    const tree = await solutionsFolderTree(db, library);
    return json(tree);
  }

  if (method === "GET" && /^\/(?:api\/)?file\/[^/]+\/content$/.test(path)) {
    const id = decodeURIComponent(path.replace(/^\/api/, "").slice("/file/".length).split("/")[0] || "");
    if (!id) return json({ success: false, message: "id required" }, 400);
    const { data } = await db.from("solutions_files").select("*").eq("id", id).maybeSingle();
    if (!data) return json({ success: false, message: "File not found" }, 404);
    const f = data as Record<string, unknown>;
    const filename = String(f.filename || "file");
    const kind = inferSolutionsFileKind(filename, String(f.mime_type || ""), String(f.kind || ""));
    const tokenOk = await solutionsContentTokenOk(
      id,
      String(url.searchParams.get("exp") || ""),
      String(url.searchParams.get("sig") || ""),
    );
    const lib = String(f.content_library || "hardware").trim().toLowerCase() || "hardware";
    const modelName = String(f.model || "").trim();
    const isDemo = modelName ? await isSolutionsModelDemo(db, lib, modelName) : false;
    if (!tokenOk && !isDemo && lib !== "course") {
      const me = await sessionProfile(db, req);
      if (!me) return json({ success: false, message: "Sign in to open this file.", isDemo: false }, 401);
      const paid = await profileCanOpenHardwareSolutions(db, me);
      if (!paid) return json({ success: false, message: "Subscribe to open this model.", isDemo: false }, 403);
    }
    const key = String(f.object_key || f.storage_path || "").trim();
    const publicUrl = String(f.public_url || "").trim();
    try {
      let upstream: Response;
      if (key && !/^https?:\/\//i.test(key)) {
        upstream = await getR2ObjectResponse(key);
      } else {
        const src = /^https?:\/\//i.test(key) ? key : publicUrl;
        if (!src) return json({ success: false, message: "Missing file URL" }, 502);
        upstream = await fetch(src);
      }
      if (!upstream.ok && upstream.status !== 206) {
        const text = await upstream.text().catch(() => "");
        return json({ success: false, message: `File fetch failed (${upstream.status}) ${text.slice(0, 120)}` }, 502);
      }
      const ct = mimeFromFilename(filename, String(f.mime_type || upstream.headers.get("content-type") || ""), kind);
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Content-Type": ct,
          "Content-Disposition": "inline",
          "Cache-Control": "private, max-age=120",
        },
      });
    } catch (e) {
      return json({ success: false, message: e instanceof Error ? e.message : "File fetch failed" }, 502);
    }
  }

  if (method === "GET" && /^\/(?:api\/)?file\/[^/]+\/(?:thumb|thumbnail)$/.test(path)) {
    const id = decodeURIComponent(path.replace(/^\/api/, "").slice("/file/".length).split("/")[0] || "");
    if (!id) return json({ success: false, message: "id required" }, 400);
    const { data } = await db.from("solutions_files").select("*").eq("id", id).maybeSingle();
    if (!data) return json({ success: false, message: "File not found" }, 404);
    const key = fileThumbKey(data as Record<string, unknown>);
    if (!key) return json({ success: false, message: "No thumbnail" }, 404);
    try {
      let bytes: Uint8Array;
      let contentType = "image/jpeg";
      if (/^https?:\/\//i.test(key)) {
        const img = await fetch(key);
        if (!img.ok) return json({ success: false, message: "Thumbnail fetch failed" }, 502);
        bytes = new Uint8Array(await img.arrayBuffer());
        contentType = img.headers.get("content-type") || sniffImageMime(bytes);
      } else {
        bytes = await getBufferFromR2(key);
        contentType = sniffImageMime(bytes);
      }
      return new Response(bytes, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (e) {
      return json({ success: false, message: e instanceof Error ? e.message : "Thumbnail failed" }, 502);
    }
  }

  if (method === "GET" && (path.startsWith("/file/") || path.startsWith("/api/file/"))) {
    const id = decodeURIComponent(path.replace(/^\/api/, "").slice("/file/".length).split("/")[0] || "");
    if (!id) return json({ success: false, message: "id required" }, 400);
    const { data } = await db.from("solutions_files").select("*").eq("id", id).maybeSingle();
    if (!data) return json({ success: false, message: "File not found" }, 404);
    const f = data as Record<string, unknown>;
    const provider = String(f.provider || "r2").trim().toLowerCase();
    const key = String(f.object_key || f.storage_path || "").trim();
    const filename = String(f.filename || "file");
    const kind = inferSolutionsFileKind(filename, String(f.mime_type || ""), String(f.kind || ""));
    const openMime = mimeFromFilename(filename, String(f.mime_type || ""), kind);
    let fileUrl = "";
    if (provider === "link") {
      fileUrl = String(f.public_url || f.object_key || "").trim();
    } else if (provider === "cloudflare_stream") {
      fileUrl = String(f.public_url || "").trim();
    } else {
      // Solutions files live on Cloudflare R2.
      // Force a browser-displayable MIME + inline so <img> / PDF viewers actually open the bytes.
      fileUrl = await signR2GetUrl(key, kind === "video" ? 4 * 3600 : 3600, {
        responseContentType: kind === "image" || kind === "pdf" ? openMime : undefined,
        inline: kind === "image" || kind === "pdf",
      });
      if (!fileUrl) fileUrl = String(f.public_url || "").trim();
    }
    if (!fileUrl) return json({ success: false, message: "Missing file URL" }, 502);
    const lib = String(f.content_library || "hardware").trim().toLowerCase() || "hardware";
    const modelName = String(f.model || "").trim();
    const isDemo = modelName ? await isSolutionsModelDemo(db, lib, modelName) : false;
    if (!isDemo && lib !== "course") {
      const me = await sessionProfile(db, req);
      if (!me) {
        return json({ success: false, message: "Sign in to open this file.", isDemo: false }, 401);
      }
      const paid = await profileCanOpenHardwareSolutions(db, me);
      if (!paid) {
        return json({ success: false, message: "Subscribe to open this model.", isDemo: false }, 403);
      }
    }
    const exp = Math.floor(Date.now() / 1000) + 2 * 3600;
    const sig = await signSolutionsContentToken(id, exp);
    const publicBase = mobiPublicApiBase();
    const contentUrl =
      publicBase && sig
        ? `${publicBase}/file/${encodeURIComponent(id)}/content?exp=${exp}&sig=${sig}`
        : "";
    return json({
      success: true,
      url: fileUrl,
      signedUrl: fileUrl,
      contentUrl,
      kind,
      mime: openMime,
      name: filename,
      isDemo,
    });
  }

  if (method === "GET" && path === "/api/repair-records/mine") {
    const auth = await requireTechnician(db, req);
    if (auth.error || !auth.me) return json(auth.error, auth.status);
    const { data, error } = await db
      .from("customer_repair_records")
      .select("*")
      .eq("technician_id", String(auth.me.id))
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return json({ success: false, message: error.message }, 500);
    const statusFilter = String(url.searchParams.get("status") || "").trim().toLowerCase();
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    let records = (data || []).map((r) => repairRecordJson(r as Record<string, unknown>));
    if (["in_progress", "repaired", "delivered", "cancelled"].includes(statusFilter)) {
      records = records.filter((r) => String(r.status || "") === statusFilter);
    }
    if (q) {
      records = records.filter((r) =>
        [r.customerName, r.customerPhone, r.deviceBrand, r.deviceModel, r.issueNote]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return json({ success: true, records });
  }

  if (method === "GET" && path.startsWith("/api/repair-records/share/")) {
    const token = decodeURIComponent(path.slice("/api/repair-records/share/".length));
    if (!token) return json({ success: false, message: "Invalid link" }, 400);
    const { data } = await db.from("customer_repair_records").select("*").eq("share_token", token).maybeSingle();
    if (!data) return json({ success: false, message: "Record not found" }, 404);
    const record = repairRecordJson(data as Record<string, unknown>);
    return json({
      success: true,
      record: {
        id: record.id,
        technicianName: record.technicianName || "",
        customerPhoneMasked: maskPhone(String(record.customerPhone || "")),
        customerNameMasked: maskName(String(record.customerName || "")),
        deviceBrand: record.deviceBrand || "",
        deviceModel: record.deviceModel || "",
        issueNote: record.issueNote || "",
        photos: record.photos || [],
        status: record.status || "in_progress",
        handedOverAt: record.handedOverAt || 0,
        repairedAt: record.repairedAt || 0,
        createdAt: record.createdAt || 0,
        updatedAt: record.updatedAt || 0,
      },
    });
  }

  if (method === "POST" && path === "/api/repair-records") {
    const auth = await requireTechnician(db, req);
    if (auth.error || !auth.me) return json(auth.error, auth.status);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const customerPhone = String(body.customerPhone || "").replace(/[^\d+]/g, "").slice(0, 32);
    if (customerPhone.replace(/\D/g, "").length < 6) {
      return json({ success: false, message: "Valid customer phone is required" }, 400);
    }
    const now = Date.now();
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const shareToken = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const row = {
      id: crypto.randomUUID(),
      technician_id: String(auth.me.id),
      technician_name: String(auth.me.name || ""),
      customer_phone: customerPhone,
      customer_name: String(body.customerName || "").trim().slice(0, 120),
      device_brand: String(body.deviceBrand || "").trim().slice(0, 80),
      device_model: String(body.deviceModel || "").trim().slice(0, 120),
      issue_note: String(body.issueNote || "").trim().slice(0, 2000),
      photos: JSON.stringify(parsePhotos(body.photos)),
      status: "in_progress",
      share_token: shareToken,
      handed_over_at: Number(body.handedOverAt) || now,
      repaired_at: 0,
      created_at: now,
      updated_at: now,
    };
    const { error } = await db.from("customer_repair_records").insert(row);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, record: repairRecordJson(row) });
  }

  if ((method === "PATCH" || method === "DELETE") && /^\/api\/repair-records\/[^/]+$/.test(path)) {
    const auth = await requireTechnician(db, req);
    if (auth.error || !auth.me) return json(auth.error, auth.status);
    const id = path.slice("/api/repair-records/".length);
    const { data: existing } = await db
      .from("customer_repair_records")
      .select("*")
      .eq("id", id)
      .eq("technician_id", String(auth.me.id))
      .maybeSingle();
    if (!existing && method === "PATCH") return json({ success: false, message: "Record not found" }, 404);
    if (method === "DELETE") {
      await db.from("customer_repair_records").delete().eq("id", id).eq("technician_id", String(auth.me.id));
      return json({ success: true });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (typeof body.customerName === "string") patch.customer_name = body.customerName.trim().slice(0, 120);
    if (typeof body.customerPhone === "string") patch.customer_phone = String(body.customerPhone).replace(/[^\d+]/g, "").slice(0, 32);
    if (typeof body.deviceBrand === "string") patch.device_brand = body.deviceBrand.trim().slice(0, 80);
    if (typeof body.deviceModel === "string") patch.device_model = body.deviceModel.trim().slice(0, 120);
    if (typeof body.issueNote === "string") patch.issue_note = body.issueNote.trim().slice(0, 2000);
    if (Array.isArray(body.photos)) patch.photos = JSON.stringify(parsePhotos(body.photos));
    if (typeof body.handedOverAt === "number") patch.handed_over_at = body.handedOverAt;
    if (typeof body.status === "string") {
      const s = body.status.trim().toLowerCase();
      if (!["in_progress", "repaired", "delivered", "cancelled"].includes(s)) {
        return json({ success: false, message: "Invalid status" }, 400);
      }
      patch.status = s;
      if (s === "repaired" || s === "delivered") {
        patch.repaired_at = Number((existing as { repaired_at?: number })?.repaired_at || 0) || Date.now();
      }
      if (s === "in_progress") patch.repaired_at = 0;
    }
    const { error } = await db.from("customer_repair_records").update(patch).eq("id", id);
    if (error) return json({ success: false, message: error.message }, 500);
    const { data } = await db.from("customer_repair_records").select("*").eq("id", id).maybeSingle();
    return json({ success: true, record: repairRecordJson((data || existing || {}) as Record<string, unknown>) });
  }

  if (method === "POST" && path.endsWith("/cf-direct-upload")) {
    try {
      const started = await createCfDirectUpload({ maxDurationSeconds: 21600, db });
      return json({ success: true, id: crypto.randomUUID(), uid: started.uid, uploadURL: started.uploadURL });
    } catch (e) {
      return json({ success: false, message: e instanceof Error ? e.message : "Failed to start upload" }, 503);
    }
  }

  if (method === "POST" && path.startsWith("/api/ai/")) {
    return json({ success: false, message: "Set NVIDIA_API_KEY as a Supabase Edge secret to enable AI." }, 503);
  }

  return null;
}
