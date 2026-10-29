import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { broadcastPush, notifyUser, subscriptionCongrats, resolveNotificationImage } from "./push.ts";

type JsonFn = (body: unknown, status?: number) => Response;
type ProfileFn = (db: SupabaseClient, req: Request) => Promise<Record<string, unknown> | null>;

const SUB_ROLES = new Set([
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
  "hotel_owner",
  "restaurant_owner",
]);
const PAY_ROLES = new Set([...SUB_ROLES, "customer"]);
const TAP_START_TRIAL_PLAN = "tap_start_trial";
const LEAD_ROLES = new Set([
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
  "job_provider",
]);
const SPARE_SELLER_ID = "mobi-spare-parts";
const SPARE_SELLER_NAME = "Mobi Spare Parts";

function camelKeys(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!row) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = v;
  }
  return out;
}

function razorpayKeys() {
  const keyId = String(Deno.env.get("RAZORPAY_KEY_ID") || "").trim();
  const keySecret = String(Deno.env.get("RAZORPAY_KEY_SECRET") || Deno.env.get("RAZORPAY_SECRET_KEY") || "").trim();
  return { keyId, keySecret, ok: Boolean(keyId && keySecret) };
}

function basicAuth(keyId: string, keySecret: string) {
  return btoa(`${keyId}:${keySecret}`);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rzCreateOrder(opts: {
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<{ id: string; amount: number; keyId: string } | { error: string; status: number }> {
  const { keyId, keySecret, ok } = razorpayKeys();
  if (!ok) return { error: "Payment gateway not configured", status: 503 };
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(keyId, keySecret)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: opts.amountPaise,
      currency: "INR",
      receipt: opts.receipt.slice(0, 40),
      notes: opts.notes,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; amount?: number; error?: { description?: string } };
  if (!res.ok || !data.id) {
    return { error: data.error?.description || "Failed to create Razorpay order", status: 502 };
  }
  return { id: data.id, amount: Number(data.amount || opts.amountPaise), keyId };
}

async function rzFetchOrder(orderId: string): Promise<Record<string, unknown> | null> {
  const { keyId, keySecret, ok } = razorpayKeys();
  if (!ok || !orderId) return null;
  const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Basic ${basicAuth(keyId, keySecret)}` },
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

async function verifySig(orderId: string, paymentId: string, signature: string): Promise<boolean> {
  const { keySecret } = razorpayKeys();
  const expected = await hmacHex(keySecret, `${orderId}|${paymentId}`);
  return expected === signature;
}

function parseIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v)).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p.map((v) => String(v)).filter(Boolean);
    } catch {
      /* ignore */
    }
  }
  return [];
}

function epochMs(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? Math.round(n * 1000) : n;
}

/** Profile dates plus purchase history, including another profile that shares this phone. */
async function linkedSubscriptionEndMs(db: SupabaseClient, user: Record<string, unknown>): Promise<number> {
  const ids = new Set<string>();
  const own = String(user.id || "").trim();
  if (own) ids.add(own);
  const phone = String(user.phone || "").replace(/\D/g, "").slice(-10);
  if (phone.length === 10) {
    const variants = [phone, `91${phone}`, `+91${phone}`, `0${phone}`];
    try {
      const { data } = await db.from("profiles").select("id").in("phone", variants).limit(20);
      for (const row of (data || []) as { id?: string }[]) {
        const id = String(row.id || "").trim();
        if (id) ids.add(id);
      }
    } catch {
      /* ignore */
    }
  }
  if (!ids.size) return 0;
  const idList = [...ids];
  let best = 0;
  try {
    const { data } = await db.from("profiles").select("subscription_end,trial_end").in("id", idList);
    for (const row of (data || []) as Record<string, unknown>[]) {
      best = Math.max(best, epochMs(row.subscription_end), epochMs(row.trial_end));
    }
  } catch {
    /* ignore */
  }
  try {
    const { data } = await db.from("user_subscriptions").select("end_date").in("user_id", idList).limit(40);
    for (const row of (data || []) as Record<string, unknown>[]) {
      best = Math.max(best, epochMs(row.end_date));
    }
  } catch {
    /* ignore */
  }
  return best;
}

function isActiveFlag(v: unknown): boolean {
  if (v === 1 || v === true || v === "1") return true;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
  }
  return false;
}

function resolveTrialDays(cfg: Record<string, unknown> | null | undefined, content: Record<string, unknown>): number {
  const fromCfg = parseInt(String(cfg?.trial_days ?? cfg?.trialDays ?? ""), 10);
  if (Number.isFinite(fromCfg) && fromCfg > 0) return fromCfg;
  const fromContent = parseInt(String(content.trial_days ?? content.trialDays ?? ""), 10);
  return Number.isFinite(fromContent) && fromContent > 0 ? fromContent : 0;
}

async function grantTapStartTrial(
  db: SupabaseClient,
  user: Record<string, unknown>,
  payRole: string,
): Promise<{ ok: true; trialStart: number; trialEnd: number; trialDays: number } | { ok: false; message: string; status: number }> {
  const { data: cfg } = await db.from("subscription_role_configs").select("*").eq("role", payRole).maybeSingle();
  const { data: contentRow } = await db.from("subscription_content").select("*").limit(1).maybeSingle();
  const content = contentRow ? camelKeys(contentRow as Record<string, unknown>) : {};
  const trialEnabled = isActiveFlag((cfg as { trial_enabled?: unknown } | null)?.trial_enabled ?? content.trialEnabled ?? content.trial_enabled);
  const trialDays = resolveTrialDays((cfg as Record<string, unknown> | null) || null, content);
  if (!trialEnabled || trialDays <= 0) return { ok: false, message: "Trial is disabled", status: 400 };

  const now = Date.now();
  const subEnd = Number(user.subscription_end || 0);
  const existingTrialEnd = Number(user.trial_end || 0);
  const looksLikeTrial = existingTrialEnd > 0 && subEnd > 0 && Math.abs(subEnd - existingTrialEnd) < 180_000;
  const isPaid = Number(user.subscription_active || 0) === 1 && subEnd > now && !looksLikeTrial;
  const trialUsed = Number(user.trial_used || 0) === 1;
  if (isPaid) return { ok: false, message: "Subscription already active", status: 400 };
  if (existingTrialEnd > now) return { ok: false, message: "Trial already active", status: 400 };
  if (trialUsed) return { ok: false, message: "Trial already used", status: 400 };

  const trialStart = now;
  const trialEnd = now + trialDays * 24 * 60 * 60 * 1000;
  const { error } = await db.from("profiles").update({
    trial_used: 1,
    trial_start: trialStart,
    trial_end: trialEnd,
    subscription_active: 1,
    subscription_end: trialEnd,
  }).eq("id", String(user.id));
  if (error) return { ok: false, message: error.message, status: 500 };
  const { error: histErr } = await db.from("user_subscriptions").insert({
    id: crypto.randomUUID(),
    user_id: String(user.id),
    plan_id: TAP_START_TRIAL_PLAN,
    months: 1,
    start_date: trialStart,
    end_date: trialEnd,
    payment_id: TAP_START_TRIAL_PLAN,
    razorpay_order_id: "",
    created_at: now,
  });
  if (histErr) console.warn("[trial-start] history", histErr.message);
  try {
    await notifyUser(db, String(user.id), {
      title: `${trialDays}-day trial started`,
      body: `Your Mobi trial is on for ${trialDays} day${trialDays === 1 ? "" : "s"}. Directory, Learn, Solutions, Leads and Jobs work as usual.`,
      data: { type: "trial_started", path: "/", trialDays: String(trialDays) },
    });
  } catch {
    /* ignore */
  }
  return { ok: true, trialStart, trialEnd, trialDays };
}

export async function ensureTechnicianSubscriptionPlans(db: SupabaseClient) {
  const now = Date.now();
  const { data: cfg } = await db.from("subscription_role_configs").select("role,video_url,show_video").eq("role", "technician").maybeSingle();
  if (!cfg) {
    await db.from("subscription_role_configs").insert({
      role: "technician",
      enabled: 1,
      trial_enabled: 0,
      trial_days: 1,
      video_url: "",
      show_video: 0,
      updated_at: now,
    });
  } else if (!String((cfg as { video_url?: string }).video_url || "").trim()) {
    /* keep existing empty video; admin can upload */
  }
  const { data: rows } = await db.from("subscription_role_plans").select("*").eq("role", "technician");
  const list = (rows || []) as Record<string, unknown>[];
  const byKey = new Map(list.map((p) => [String(p.key || ""), p]));
  const monthly = byKey.get("monthly");
  const three = byKey.get("threeMonths");
  if (monthly && !three) {
    await db.from("subscription_role_plans").update({
      key: "threeMonths",
      duration: "3 Months",
      months: 3,
      sort_order: 1,
      updated_at: now,
    }).eq("id", String(monthly.id));
  } else if (!three) {
    await db.from("subscription_role_plans").upsert({
      id: "sub_technician_threeMonths",
      role: "technician",
      key: "threeMonths",
      duration: "3 Months",
      months: 3,
      price: 599,
      is_active: 1,
      is_popular: 0,
      sort_order: 1,
      updated_at: now,
    }, { onConflict: "id" });
  }
  const six = byKey.get("sixMonths");
  if (!six) {
    await db.from("subscription_role_plans").upsert({
      id: "sub_technician_sixMonths",
      role: "technician",
      key: "sixMonths",
      duration: "6 Months",
      months: 6,
      price: 599,
      is_active: 1,
      is_popular: 0,
      sort_order: 2,
      updated_at: now,
    }, { onConflict: "id" });
  }
  const year = byKey.get("yearly");
  if (!year) {
    await db.from("subscription_role_plans").upsert({
      id: "sub_technician_yearly",
      role: "technician",
      key: "yearly",
      duration: "12 Months",
      months: 12,
      price: 999,
      is_active: 1,
      is_popular: 1,
      sort_order: 3,
      updated_at: now,
    }, { onConflict: "id" });
  }
}

async function settingValue(db: SupabaseClient, key: string, fallback = ""): Promise<string> {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value != null ? String(data.value) : fallback;
}

function publicLead(row: Record<string, unknown>, buyerId: string) {
  const pb = parseIds(row.purchased_by ?? row.purchasedBy);
  const max = Number(row.max_buyers ?? row.maxBuyers ?? 5) || 5;
  const purchased = pb.includes(buyerId);
  return {
    ...row,
    id: row.id,
    title: row.title,
    contactNumber: purchased ? row.contact_number || row.contactNumber || "" : "",
    purchasedBy: pb,
    purchased,
    buyerCount: pb.length,
    isFull: pb.length >= max,
    maxBuyers: max,
    price: Number(row.price || 50) || 50,
  };
}

async function recordLeadPurchase(
  db: SupabaseClient,
  lead: Record<string, unknown>,
  profile: Record<string, unknown>,
  amountPaid: number,
) {
  const pb = parseIds(lead.purchased_by ?? lead.purchasedBy);
  const id = String(lead.id);
  if (!pb.includes(String(profile.id))) {
    pb.push(String(profile.id));
    await db.from("leads").update({ purchased_by: JSON.stringify(pb), updated_at: Date.now() }).eq("id", id);
    await db.from("lead_claims").insert({
      id: crypto.randomUUID(),
      lead_id: id,
      technician_id: String(profile.id),
      technician_name: String(profile.name || ""),
      amount_paid: amountPaid,
      created_at: Date.now(),
    }).then(() => undefined, () => undefined);
  }
  const { data } = await db.from("leads").select("*").eq("id", id).maybeSingle();
  return publicLead((data || lead) as Record<string, unknown>, String(profile.id));
}

async function loadPlan(db: SupabaseClient, payRole: string, planId: string) {
  if (SUB_ROLES.has(payRole)) {
    const { data } = await db.from("subscription_role_plans").select("*").eq("id", planId).maybeSingle();
    return data as Record<string, unknown> | null;
  }
  const { data } = await db.from("subscription_plans").select("*").eq("id", planId).maybeSingle();
  return data as Record<string, unknown> | null;
}

async function grantCourse(
  db: SupabaseClient,
  opts: {
    course: Record<string, unknown>;
    studentId: string;
    studentName: string;
    studentPhone: string;
    paymentId?: string;
    razorpayOrderId?: string;
    amountPaise: number;
  },
) {
  const now = Date.now();
  const courseId = String(opts.course.id);
  const { data: existingPurchase } = await db
    .from("course_purchases")
    .select("*")
    .eq("user_id", opts.studentId)
    .eq("course_id", courseId)
    .maybeSingle();
  let purchaseId = String(existingPurchase?.id || crypto.randomUUID());
  if (existingPurchase) {
    await db
      .from("course_purchases")
      .update({
        status: "active",
        payment_id: opts.paymentId || existingPurchase.payment_id || "",
        razorpay_order_id: opts.razorpayOrderId || existingPurchase.razorpay_order_id || "",
        amount_paise: opts.amountPaise,
      })
      .eq("id", purchaseId);
  } else {
    await db.from("course_purchases").insert({
      id: purchaseId,
      user_id: opts.studentId,
      course_id: courseId,
      payment_id: opts.paymentId || "",
      razorpay_order_id: opts.razorpayOrderId || "",
      amount_paise: opts.amountPaise,
      status: "active",
      created_at: now,
    });
  }
  const { data: existingEnroll } = await db
    .from("course_enrollments")
    .select("*")
    .eq("course_id", courseId)
    .eq("student_id", opts.studentId)
    .maybeSingle();
  let enrollment = existingEnroll as Record<string, unknown> | null;
  if (enrollment) {
    await db
      .from("course_enrollments")
      .update({ status: "active", payment_status: opts.amountPaise > 0 ? "paid" : "free" })
      .eq("id", String(enrollment.id));
    const { data } = await db.from("course_enrollments").select("*").eq("id", String(enrollment.id)).maybeSingle();
    enrollment = data as Record<string, unknown>;
  } else {
    const enrollId = crypto.randomUUID();
    const accessDays = Number(opts.course.access_days || opts.course.accessDays || 365) || 365;
    await db.from("course_enrollments").insert({
      id: enrollId,
      course_id: courseId,
      student_id: opts.studentId,
      student_name: opts.studentName || "Student",
      student_phone: opts.studentPhone || "",
      teacher_id: String(opts.course.teacher_id || opts.course.teacherId || ""),
      status: "active",
      payment_status: opts.amountPaise > 0 ? "paid" : "free",
      expires_at: now + accessDays * 24 * 60 * 60 * 1000,
      created_at: now,
      completed_videos: "[]",
    });
    await db
      .from("courses")
      .update({ enrollment_count: Number(opts.course.enrollment_count || opts.course.enrollmentCount || 0) + 1 })
      .eq("id", courseId);
    const { data } = await db.from("course_enrollments").select("*").eq("id", enrollId).maybeSingle();
    enrollment = data as Record<string, unknown>;
  }
  const { data: purchase } = await db.from("course_purchases").select("*").eq("id", purchaseId).maybeSingle();
  return { enrollment, purchase };
}

async function fulfillSpare(
  db: SupabaseClient,
  opts: { checkoutId: string; userId: string; paymentId: string; razorpayOrderId: string },
) {
  const { data: checkout } = await db.from("spare_checkouts").select("*").eq("id", opts.checkoutId).maybeSingle();
  if (!checkout) return { success: false, message: "Checkout not found" };
  if (String(checkout.user_id) !== opts.userId) return { success: false, message: "Not your checkout" };
  if (String(checkout.status) === "paid" || String(checkout.status) === "cod") {
    return { success: true, alreadyPaid: true, orderIds: [] as string[] };
  }
  const isCod = opts.paymentId === "cod";
  let items: Array<{ partId: string; quantity: number; title: string; price: number; image: string }> = [];
  try {
    items = JSON.parse(String(checkout.items_json || "[]"));
  } catch {
    items = [];
  }
  const now = Date.now();
  const orderIds: string[] = [];
  for (const item of items) {
    const partId = String(item.partId || (item as { productId?: string }).productId || "");
    const { data: part } = await db.from("spare_parts").select("*").eq("id", partId).maybeSingle();
    const extra = item as Record<string, unknown>;
    const orderId = crypto.randomUUID();
    const pin = String(checkout.pincode || "").replace(/\D/g, "").slice(0, 6);
    const addr = String(checkout.shipping_address || "").trim();
    const city = String(checkout.city || "").trim();
    const shipping = [addr, city, pin ? `PIN ${pin}` : ""].filter(Boolean).join(", ");
    await db.from("orders").insert({
      id: orderId,
      product_id: partId,
      product_title: String(item.title || ""),
      product_price: String(item.price),
      product_image: String(item.image || ""),
      product_category: String(extra.category || (part ? "spare_part" : "product")),
      buyer_id: opts.userId,
      buyer_name: checkout.buyer_name || "",
      buyer_phone: checkout.buyer_phone || "",
      buyer_city: city,
      buyer_state: "",
      seller_id: String(extra.sellerId || (part ? SPARE_SELLER_ID : "")),
      seller_name: String(extra.sellerName || (part ? SPARE_SELLER_NAME : "")),
      seller_role: part ? "admin" : "supplier",
      quantity: item.quantity,
      total_amount: String(Number(item.price) * Number(item.quantity)),
      status: isCod ? "pending" : "confirmed",
      shipping_address: shipping,
      delivery_latitude: checkout.delivery_latitude || "",
      delivery_longitude: checkout.delivery_longitude || "",
      buyer_notes: isCod
        ? `${String(checkout.buyer_notes || "").trim()} | Cash on delivery`.replace(/^\s\|\s/, "")
        : checkout.buyer_notes || "",
      updated_at: now,
      created_at: now,
    });
    orderIds.push(orderId);
    if (part) {
      await db
        .from("spare_parts")
        .update({ in_stock: Math.max(0, Number((part as { in_stock?: number }).in_stock || 0) - item.quantity) })
        .eq("id", partId);
    }
  }
  await db
    .from("spare_checkouts")
    .update({
      status: isCod ? "cod" : "paid",
      payment_id: opts.paymentId,
      razorpay_order_id: opts.razorpayOrderId,
    })
    .eq("id", opts.checkoutId);
  return { success: true, orderIds };
}

async function subscriptionStatus(db: SupabaseClient, userId: string, forRole: string, json: JsonFn) {
  const { data: user } = await db.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!user) return json({ success: false, message: "User not found" }, 404);
  const roleNorm = String(user.role || "").trim().toLowerCase();
  const billingRole = forRole && PAY_ROLES.has(forRole) ? forRole : roleNorm;
  const phoneLast10 = String(user.phone || "").replace(/\D/g, "").slice(-10);
  const now = Date.now();
  const trialEnd = epochMs(user.trial_end);
  let subEnd = epochMs(user.subscription_end);
  const linkedEnd = await linkedSubscriptionEndMs(db, user as Record<string, unknown>);
  if (linkedEnd > subEnd) subEnd = linkedEnd;
  const { data: trialAccessRow } = await db.from("app_settings").select("value").eq("key", "trial_access_enabled").maybeSingle();
  const trialAccessRaw = trialAccessRow ? String((trialAccessRow as { value?: string }).value ?? "1").trim().toLowerCase() : "1";
  const trialsAllowed = trialAccessRaw !== "0" && trialAccessRaw !== "false" && trialAccessRaw !== "off";
  const trialGrant = trialEnd > 0 && subEnd > 0 && Math.abs(subEnd - trialEnd) < 180_000;
  const paidOnHistory = linkedEnd > now && Math.abs(linkedEnd - trialEnd) >= 180_000;
  const isPaid = paidOnHistory || (isActiveFlag(user.subscription_active) && subEnd > now && !trialGrant);
  const trialUsed = Number(user.trial_used || 0) === 1;
  let plans: Record<string, unknown>[] = [];
  let cfg: Record<string, unknown> | null = null;
  if (billingRole === "technician") {
    await ensureTechnicianSubscriptionPlans(db);
  }
  if (SUB_ROLES.has(billingRole)) {
    const { data: c } = await db.from("subscription_role_configs").select("*").eq("role", billingRole).maybeSingle();
    cfg = (c as Record<string, unknown>) || null;
    const { data: p } = await db.from("subscription_role_plans").select("*").eq("role", billingRole).order("sort_order", { ascending: true });
    plans = ((p || []) as Record<string, unknown>[])
      .filter((row) => isActiveFlag(row.is_active ?? row.isActive))
      .map((row) => camelKeys(row));
  } else if (billingRole === "customer") {
    const { data: p } = await db.from("subscription_plans").select("*").order("sort_order", { ascending: true });
    plans = ((p || []) as Record<string, unknown>[])
      .filter((row) => isActiveFlag(row.is_active ?? row.isActive))
      .map((row) => camelKeys(row));
  }
  const { data: contentRow } = await db.from("subscription_content").select("*").limit(1).maybeSingle();
  const content = (contentRow
    ? camelKeys(contentRow as Record<string, unknown>)
    : {
        title: "Subscription Required",
        trialEnabled: 1,
        trialDays: 3,
      }) as Record<string, unknown>;
  const rawImages = content.imageUrls ?? (contentRow as { image_urls?: unknown } | null)?.image_urls;
  if (Array.isArray(rawImages)) {
    content.imageUrls = rawImages.map((u) => String(u || "").trim()).filter(Boolean);
  } else if (typeof rawImages === "string" && rawImages.trim()) {
    try {
      const parsed = JSON.parse(rawImages);
      content.imageUrls = Array.isArray(parsed) ? parsed.map((u) => String(u || "").trim()).filter(Boolean) : [];
    } catch {
      content.imageUrls = /^https?:\/\//i.test(rawImages.trim()) ? [rawImages.trim()] : [];
    }
  } else {
    content.imageUrls = [];
  }
  const roleVideo = String(cfg?.video_url || cfg?.videoUrl || "").trim();
  if (roleVideo) {
    content.videoUrl = roleVideo;
    content.showVideo = 1;
  }
  content.trialWhatsappShareEnabled = 0;
  const trialEnabledNow = isActiveFlag(cfg?.trial_enabled ?? cfg?.trialEnabled ?? content.trial_enabled ?? content.trialEnabled);
  const trialDaysNow = resolveTrialDays(cfg, content);
  content.trialEnabled = trialEnabledNow ? 1 : 0;
  content.trialDays = trialDaysNow;
  const trialActive = !isPaid && trialEnd > now && (trialEnabledNow || trialsAllowed);
  const isAdminPhone = phoneLast10 === "8179142535" || phoneLast10 === "9876543210";
  // Admin preview of /subscription-paywall must still receive trial fields.
  // Eligibility for admins follows the role toggle (paid bypass must not hide Start trial).
  const trialEligible = trialEnabledNow && trialDaysNow > 0 && !(trialEnd > now) &&
    (isAdminPhone || (!isPaid && !trialUsed));
  const trialPayload = {
    trialEnabled: trialEnabledNow,
    trialDays: trialDaysNow,
    trialActive,
    trialEligible,
    trialUsed,
    trialStart: Number(user.trial_start || 0),
    trialEnd,
    trialEndsAt: trialEnd,
  };
  if (trialEnabledNow && trialDaysNow > 0 && !plans.some((p) => String(p.id || p.key || "") === TAP_START_TRIAL_PLAN)) {
    plans = [
      {
        id: TAP_START_TRIAL_PLAN,
        role: billingRole,
        key: "trial",
        duration: `${trialDaysNow}-Day Free Trial`,
        months: 0,
        price: 0,
        isActive: 1,
        isPopular: 1,
        sortOrder: -1,
        isTrial: true,
      },
      ...plans,
    ];
  }
  if (isAdminPhone) {
    return json({
      success: true,
      active: true,
      accessAllowed: true,
      required: false,
      roleEnabled: true,
      role: billingRole,
      profileRole: roleNorm,
      plans,
      content,
      subscriptionEnd: 4102444800000,
      plan: "admin",
      ...trialPayload,
    });
  }
  if (billingRole === "customer" || roleNorm === "customer") {
    return json({
      success: true,
      required: false,
      active: isPaid,
      subscriptionActive: isPaid,
      accessAllowed: true,
      roleEnabled: true,
      amount: "30",
      period: "monthly",
      subscriptionEnd: subEnd,
      role: "customer",
      profileRole: roleNorm,
      plans,
      content,
      ...trialPayload,
      trialEligible: false,
    });
  }
  const enabled = cfg ? isActiveFlag(cfg.enabled) : Boolean(plans.length);
  if (!enabled && billingRole !== "customer") {
    return json({
      success: true,
      role: billingRole,
      profileRole: roleNorm,
      roleEnabled: true,
      required: false,
      active: true,
      accessAllowed: true,
      subscriptionActive: true,
      subscriptionEnd: user.subscription_end || 0,
      plans,
      content,
      ...trialPayload,
    });
  }
  return json({
    success: true,
    required: true,
    active: isPaid,
    subscriptionActive: isPaid,
    roleEnabled: true,
    ...trialPayload,
    accessAllowed: isPaid || trialActive,
    amount: billingRole === "customer" ? "30" : undefined,
    period: "monthly",
    subscriptionEnd: subEnd,
    role: billingRole,
    profileRole: roleNorm,
    plans,
    content,
  });
}

export async function handlePaymentRoutes(opts: {
  db: SupabaseClient;
  req: Request;
  method: string;
  path: string;
  url: URL;
  json: JsonFn;
  sessionProfile: ProfileFn;
}): Promise<Response | null> {
  const { db, req, method, path, url, json, sessionProfile } = opts;

  if (method === "GET" && path.startsWith("/api/subscription/status/")) {
    const userId = decodeURIComponent(path.slice("/api/subscription/status/".length).split("/")[0] || "");
    const forRole = String(url.searchParams.get("forRole") || "").trim().toLowerCase();
    return await subscriptionStatus(db, userId, forRole, json);
  }

  if (method === "POST" && path === "/api/subscription/trial/start") {
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Authentication required" }, 401);
    const body = (await req.json().catch(() => ({}))) as { forRole?: string };
    const userRole = String(me.role || "").toLowerCase();
    const payRole = String(body.forRole || userRole).toLowerCase();
    if (!SUB_ROLES.has(payRole)) return json({ success: false, message: "Trial not available for this role" }, 400);

    const { data: user } = await db.from("profiles").select("*").eq("id", me.id).maybeSingle();
    if (!user) return json({ success: false, message: "User not found" }, 404);
    const granted = await grantTapStartTrial(db, user as Record<string, unknown>, payRole);
    if (!granted.ok) return json({ success: false, message: granted.message }, granted.status);
    return json({
      success: true,
      trialStart: granted.trialStart,
      trialEnd: granted.trialEnd,
      trialDays: granted.trialDays,
      trialActive: true,
      accessAllowed: true,
    });
  }

  if (method === "POST" && path === "/api/spare-parts/website/create-order") {
    const { ok, keyId } = razorpayKeys();
    if (!ok) return json({ success: false, message: "Payment gateway not configured" }, 503);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const checkoutId = String(body.checkoutId || "").trim();
    const buyerPhone = String(body.buyerPhone || body.phone || "").replace(/\D/g, "").slice(-10);
    if (!checkoutId) return json({ success: false, message: "checkoutId required" }, 400);
    const { data: checkout } = await db.from("spare_checkouts").select("*").eq("id", checkoutId).maybeSingle();
    if (!checkout) return json({ success: false, message: "Checkout not found" }, 404);
    if (!String(checkout.user_id || "").startsWith("web-spare-")) {
      return json({ success: false, message: "Not a website checkout" }, 403);
    }
    if (String(checkout.buyer_phone || "").replace(/\D/g, "").slice(-10) !== buyerPhone) {
      return json({ success: false, message: "Phone does not match this checkout" }, 403);
    }
    if (String(checkout.status) === "paid") {
      return json({ success: true, alreadyPaid: true, id: "", amount: 0, currency: "INR", keyId });
    }
    const total = parseFloat(String(checkout.total || "0")) || 0;
    if (total <= 0) return json({ success: false, message: "Invalid checkout amount" }, 400);
    const created = await rzCreateOrder({
      amountPaise: Math.round(total * 100),
      receipt: `websp_${checkoutId.slice(0, 8)}_${Date.now()}`,
      notes: { checkoutId, userId: String(checkout.user_id), type: "spare_part_website" },
    });
    if ("error" in created) return json({ success: false, message: created.error }, created.status);
    await db.from("spare_checkouts").update({ razorpay_order_id: created.id }).eq("id", checkoutId);
    return json({ success: true, id: created.id, amount: created.amount, currency: "INR", keyId: created.keyId });
  }

  if (method === "POST" && path === "/api/spare-parts/website/verify") {
    const { ok } = razorpayKeys();
    if (!ok) return json({ success: false, message: "Payment gateway not configured" }, 503);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const checkoutId = String(b.checkoutId || b.referenceId || "").trim();
    const buyerPhone = String(b.buyerPhone || b.phone || "").replace(/\D/g, "").slice(-10);
    const orderId = String(b.razorpay_order_id || "").trim();
    const paymentId = String(b.razorpay_payment_id || "").trim();
    const signature = String(b.razorpay_signature || "").trim();
    if (!checkoutId || !orderId || !paymentId || !signature) {
      return json({ success: false, message: "Payment verification data missing" }, 400);
    }
    if (!(await verifySig(orderId, paymentId, signature))) {
      return json({ success: false, message: "Invalid payment signature" }, 400);
    }
    const { data: checkout } = await db.from("spare_checkouts").select("*").eq("id", checkoutId).maybeSingle();
    if (!checkout) return json({ success: false, message: "Checkout not found" }, 404);
    if (String(checkout.buyer_phone || "").replace(/\D/g, "").slice(-10) !== buyerPhone) {
      return json({ success: false, message: "Phone does not match this checkout" }, 403);
    }
    const result = await fulfillSpare(db, {
      checkoutId,
      userId: String(checkout.user_id),
      paymentId,
      razorpayOrderId: orderId,
    });
    if (!result.success) return json({ success: false, message: result.message || "Fulfillment failed" }, 400);
    return json({ success: true, orderIds: result.orderIds, message: "Payment successful. Your spare parts order is confirmed." });
  }

  if (method === "POST" && path === "/api/payment/cod") {
    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Authentication required" }, 401);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const type = String(body.type || "").trim();
    const referenceId = String(body.referenceId || "").trim();
    if (type !== "spare_part" && type !== "product") {
      return json({ success: false, message: "COD is only for product orders" }, 400);
    }
    if (!referenceId) return json({ success: false, message: "referenceId (checkout id) required" }, 400);
    const { data: checkout } = await db.from("spare_checkouts").select("*").eq("id", referenceId).maybeSingle();
    if (!checkout) return json({ success: false, message: "Checkout not found" }, 404);
    if (String(checkout.user_id) !== String(me.id)) return json({ success: false, message: "Not your checkout" }, 403);
    if (String(checkout.status) === "paid" || String(checkout.status) === "cod") {
      return json({ success: true, alreadyPaid: true, orderIds: [] });
    }
    const { data: minRow } = await db.from("app_settings").select("value").eq("key", "cod_min_amount").maybeSingle();
    const minAmount = Math.max(0, parseFloat(String(minRow?.value || "99")) || 0);
    const total = parseFloat(String(checkout.total || "0")) || 0;
    if (total < minAmount) {
      return json({ success: false, message: `Cash on delivery needs a minimum order of ₹${minAmount}` }, 400);
    }
    const result = await fulfillSpare(db, {
      checkoutId: referenceId,
      userId: String(me.id),
      paymentId: "cod",
      razorpayOrderId: "cod",
    });
    if (!result.success) return json({ success: false, message: result.message || "Could not place COD order" }, 400);
    return json({ success: true, orderIds: result.orderIds, message: "Order placed. Pay cash on delivery." });
  }

  if (method === "POST" && (path === "/api/payments/create-order" || path === "/api/customer/subscription/create-order" || path === "/api/payment/create-order")) {
    const { ok } = razorpayKeys();
    if (!ok) return json({ success: false, message: "Payment gateway not configured" }, 503);

    if (path === "/api/payments/create-order") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const courseId = String(body.courseId || "").trim();
      const studentId = String(body.studentId || "").trim();
      const studentName = String(body.studentName || "").trim();
      const studentPhone = String(body.studentPhone || "");
      if (!courseId || !studentId || !studentName) {
        return json({ success: false, message: "courseId, studentId, and studentName required" }, 400);
      }
      const { data: course } = await db.from("courses").select("*").eq("id", courseId).maybeSingle();
      if (!course) return json({ success: false, message: "Course not found" }, 404);
      const { data: existing } = await db
        .from("course_enrollments")
        .select("*")
        .eq("course_id", courseId)
        .eq("student_id", studentId)
        .maybeSingle();
      if (existing && String(existing.status) === "active") {
        return json({ success: true, alreadyEnrolled: true, enrollment: existing });
      }
      const amountInPaise = Math.round(parseFloat(String(course.price || "0")) * 100);
      if (amountInPaise <= 0) {
        const granted = await grantCourse(db, {
          course: course as Record<string, unknown>,
          studentId,
          studentName,
          studentPhone,
          amountPaise: 0,
        });
        return json({ success: true, free: true, enrollment: granted.enrollment, purchase: granted.purchase });
      }
      const created = await rzCreateOrder({
        amountPaise: amountInPaise,
        receipt: `crs_${Date.now()}`,
        notes: { courseId, studentId, studentName, type: "course" },
      });
      if ("error" in created) return json({ success: false, message: created.error }, created.status);
      const paymentId = crypto.randomUUID();
      await db.from("payments").insert({
        id: paymentId,
        razorpay_order_id: created.id,
        course_id: courseId,
        student_id: studentId,
        student_name: studentName,
        student_phone: studentPhone,
        teacher_id: String(course.teacher_id || ""),
        amount: amountInPaise,
        currency: "INR",
        status: "created",
        created_at: Date.now(),
      });
      return json({
        success: true,
        orderId: created.id,
        amount: created.amount,
        currency: "INR",
        keyId: created.keyId,
        courseName: course.title,
        teacherName: course.teacher_name,
        paymentRecordId: paymentId,
      });
    }

    if (path === "/api/customer/subscription/create-order") {
      const me = await sessionProfile(db, req);
      if (!me?.id) return json({ success: false, message: "Authentication required" }, 401);
      const price = parseInt(await settingValue(db, "insurance_plan_price", "30"), 10) || 30;
      const amountPaise = Math.max(1, price) * 100;
      const created = await rzCreateOrder({
        amountPaise,
        receipt: `sub_customer_${Date.now()}`,
        notes: { userId: String(me.id), role: "customer", type: "subscription", planId: "legacy_1m", months: "1" },
      });
      if ("error" in created) return json({ success: false, message: created.error }, created.status);
      return json({
        success: true,
        orderId: created.id,
        id: created.id,
        amount: created.amount,
        currency: "INR",
        keyId: created.keyId,
      });
    }

    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Authentication required" }, 401);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const type = String(body.type || "").trim();
    const referenceId = String(body.referenceId || "").trim();
    const roleParam = String(body.role || "").trim().toLowerCase();
    const keyId = razorpayKeys().keyId;

    if (type === "lead") {
      if (!referenceId) return json({ success: false, message: "referenceId (lead id) required" }, 400);
      const role = String(me.role || "").toLowerCase();
      if (!LEAD_ROLES.has(role)) return json({ success: false, message: "Only service providers can buy leads" }, 403);
      const { data: lead } = await db.from("leads").select("*").eq("id", referenceId).maybeSingle();
      if (!lead) return json({ success: false, message: "Lead not found" }, 404);
      const pb = parseIds(lead.purchased_by);
      if (pb.includes(String(me.id))) {
        return json({
          success: true,
          alreadyPurchased: true,
          id: "",
          amount: 0,
          currency: "INR",
          keyId,
          contactNumber: lead.contact_number,
          lead: publicLead(lead as Record<string, unknown>, String(me.id)),
        });
      }
      if (pb.length >= Number(lead.max_buyers || 5)) {
        return json({ success: false, message: "This lead is full (max buyers reached)" }, 400);
      }
      const requiredRaw = (await settingValue(db, "lead_payment_required", "1")).toLowerCase();
      const paymentRequired = requiredRaw !== "0" && requiredRaw !== "false" && requiredRaw !== "off";
      if (!paymentRequired) {
        const updated = await recordLeadPurchase(db, lead as Record<string, unknown>, me, 0);
        return json({
          success: true,
          paymentRequired: false,
          freeUnlock: true,
          alreadyPurchased: false,
          id: "",
          amount: 0,
          currency: "INR",
          keyId,
          contactNumber: updated.contactNumber,
          lead: updated,
        });
      }
      const fallback = parseInt(await settingValue(db, "lead_price", "50"), 10) || 50;
      const price = Number(lead.price || fallback) || fallback;
      const amountPaise = price * 100;
      const created = await rzCreateOrder({
        amountPaise,
        receipt: `lead_${referenceId.slice(0, 8)}_${Date.now()}`,
        notes: { leadId: referenceId, buyerId: String(me.id), type: "lead" },
      });
      if ("error" in created) return json({ success: false, message: created.error }, created.status);
      return json({
        success: true,
        id: created.id,
        amount: created.amount,
        currency: "INR",
        keyId: created.keyId,
        leadTitle: lead.title,
      });
    }

    if (type === "subscription") {
      const userRole = String(me.role || "").toLowerCase();
      const planId = String(body.planId || "plan_1m").trim() || "plan_1m";
      const payRole = roleParam && PAY_ROLES.has(roleParam) ? roleParam : userRole;
      if (planId === TAP_START_TRIAL_PLAN || planId === "trial") {
        if (!SUB_ROLES.has(payRole)) return json({ success: false, message: "Trial not available for this role" }, 400);
        const { data: user } = await db.from("profiles").select("*").eq("id", me.id).maybeSingle();
        if (!user) return json({ success: false, message: "User not found" }, 404);
        const granted = await grantTapStartTrial(db, user as Record<string, unknown>, payRole);
        if (!granted.ok) return json({ success: false, message: granted.message }, granted.status);
        return json({
          success: true,
          trialStarted: true,
          skipCheckout: true,
          id: TAP_START_TRIAL_PLAN,
          amount: 0,
          currency: "INR",
          keyId: "",
          trialStart: granted.trialStart,
          trialEnd: granted.trialEnd,
          trialDays: granted.trialDays,
          message: `Your ${granted.trialDays}-day free trial is now on.`,
        });
      }
      if (roleParam && roleParam !== userRole && payRole !== "hotel_owner" && payRole !== "restaurant_owner") {
        return json({ success: false, message: "role does not match signed-in user" }, 400);
      }
      if (!PAY_ROLES.has(payRole)) {
        return json({ success: false, message: "Subscription not available for this account type" }, 400);
      }
      const plan = await loadPlan(db, payRole, planId);
      if (plan && SUB_ROLES.has(payRole) && String(plan.role || "").toLowerCase() !== payRole) {
        return json({ success: false, message: "Selected plan does not match your role" }, 400);
      }
      if (plan && !isActiveFlag(plan.is_active ?? plan.isActive)) {
        return json({ success: false, message: "Selected subscription plan is not active" }, 400);
      }
      let amountInPaise = plan ? Math.round(Number(plan.price || 0) * 100) : 0;
      if (!plan && payRole === "customer") {
        const adminPrice = parseInt(await settingValue(db, "insurance_plan_price", "50"), 10) || 50;
        amountInPaise = Math.max(1, adminPrice) * 100;
      } else if (!plan) {
        const { data: setting } = await db.from("subscription_settings").select("*").eq("role", payRole).maybeSingle();
        if (!setting || !isActiveFlag(setting.enabled)) {
          return json({ success: false, message: "Subscription not required for this role" }, 400);
        }
        amountInPaise = Math.round(parseFloat(String(setting.amount || "0")) * 100);
      }
      if (amountInPaise <= 0) return json({ success: false, message: "Invalid subscription amount" }, 400);
      const created = await rzCreateOrder({
        amountPaise: amountInPaise,
        receipt: `sub_${payRole}_${Date.now()}`,
        notes: {
          userId: String(me.id),
          role: payRole,
          type: "subscription",
          planId: String(plan?.id || "legacy_1m"),
          months: String(plan?.months || 1),
        },
      });
      if ("error" in created) return json({ success: false, message: created.error }, created.status);
      return json({
        success: true,
        id: created.id,
        amount: created.amount,
        currency: "INR",
        keyId: created.keyId,
        planId: plan?.id || "legacy_1m",
        months: plan?.months || 1,
      });
    }

    if (type === "protection_plan") {
      if (!referenceId) return json({ success: false, message: "referenceId (plan id) required" }, 400);
      const { data: plan } = await db
        .from("protection_plans")
        .select("*")
        .eq("id", referenceId)
        .eq("user_id", String(me.id))
        .maybeSingle();
      if (!plan) return json({ success: false, message: "Plan not found" }, 404);
      if (String(plan.status) !== "approved_pending_payment") {
        return json({ success: false, message: "Plan is not approved for payment" }, 400);
      }
      const yearly = parseInt(await settingValue(db, "insurance_plan_price_yearly", "1499"), 10) || 1499;
      const monthly = parseInt(await settingValue(db, "insurance_plan_price_monthly", "149"), 10) || 149;
      const currentPrice = String(plan.plan_type) === "yearly" ? yearly : monthly;
      const amount = currentPrice * 100;
      const created = await rzCreateOrder({
        amountPaise: amount,
        receipt: `prot_${referenceId.slice(0, 8)}`,
        notes: { planId: referenceId, userId: String(me.id), type: "protection_plan" },
      });
      if ("error" in created) return json({ success: false, message: created.error }, created.status);
      await db
        .from("protection_plans")
        .update({ razorpay_order_id: created.id, price: currentPrice, updated_at: Date.now() })
        .eq("id", referenceId);
      return json({
        success: true,
        id: created.id,
        amount: created.amount,
        currency: "INR",
        keyId: created.keyId,
        planType: plan.plan_type,
      });
    }

    if (type === "bike_ride") {
      if (!referenceId) return json({ success: false, message: "referenceId (ride id) required" }, 400);
      const { data: ride } = await db.from("rides").select("*").eq("id", referenceId).maybeSingle();
      if (!ride) return json({ success: false, message: "Ride not found" }, 404);
      if (String(ride.customer_id) !== String(me.id)) return json({ success: false, message: "Not your ride" }, 403);
      if (String(ride.payment_method || "cash") !== "upi") {
        return json({ success: false, message: "This ride is not set for UPI payment" }, 400);
      }
      if (ride.razorpay_payment_id) {
        return json({ success: true, alreadyPaid: true, id: "", amount: 0, currency: "INR", keyId });
      }
      const price = parseFloat(String(ride.final_price || ride.estimated_price || "0")) || 0;
      if (price <= 0) return json({ success: false, message: "Invalid ride amount" }, 400);
      const amountPaise = Math.round(price * 100);
      const created = await rzCreateOrder({
        amountPaise,
        receipt: `bike_${referenceId.slice(0, 8)}_${Date.now()}`,
        notes: { rideId: referenceId, userId: String(me.id), type: "bike_ride" },
      });
      if ("error" in created) return json({ success: false, message: created.error }, created.status);
      await db.from("rides").update({ razorpay_order_id: created.id }).eq("id", referenceId);
      return json({ success: true, id: created.id, amount: created.amount, currency: "INR", keyId: created.keyId });
    }

    if (type === "spare_part" || type === "product") {
      if (!referenceId) return json({ success: false, message: "referenceId (checkout id) required" }, 400);
      const { data: checkout } = await db.from("spare_checkouts").select("*").eq("id", referenceId).maybeSingle();
      if (!checkout) return json({ success: false, message: "Checkout not found" }, 404);
      if (String(checkout.user_id) !== String(me.id)) return json({ success: false, message: "Not your checkout" }, 403);
      if (String(checkout.status) === "paid") {
        return json({ success: true, alreadyPaid: true, id: "", amount: 0, currency: "INR", keyId });
      }
      const total = parseFloat(String(checkout.total || "0")) || 0;
      if (total <= 0) return json({ success: false, message: "Invalid checkout amount" }, 400);
      const amountPaise = Math.round(total * 100);
      const created = await rzCreateOrder({
        amountPaise,
        receipt: `${type}_${referenceId.slice(0, 8)}_${Date.now()}`,
        notes: { checkoutId: referenceId, userId: String(me.id), type },
      });
      if ("error" in created) return json({ success: false, message: created.error }, created.status);
      await db.from("spare_checkouts").update({ razorpay_order_id: created.id }).eq("id", referenceId);
      return json({ success: true, id: created.id, amount: created.amount, currency: "INR", keyId: created.keyId });
    }

    return json({ success: false, message: "type must be lead, subscription, protection_plan, spare_part, product, or bike_ride" }, 400);
  }

  if (method === "POST" && (path === "/api/payments/verify" || path === "/api/payment/verify")) {
    const { ok } = razorpayKeys();
    if (!ok) return json({ success: false, message: "Payment gateway not configured" }, 503);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const orderId = String(b.razorpay_order_id || "").trim();
    const paymentId = String(b.razorpay_payment_id || "").trim();
    const signature = String(b.razorpay_signature || "").trim();
    if (!orderId || !paymentId || !signature) {
      return json({ success: false, message: "Payment verification data missing" }, 400);
    }
    if (!(await verifySig(orderId, paymentId, signature))) {
      return json({ success: false, message: "Invalid payment signature" }, 400);
    }

    if (path === "/api/payments/verify") {
      const courseId = String(b.courseId || "").trim();
      const studentId = String(b.studentId || "").trim();
      const { data: course } = await db.from("courses").select("*").eq("id", courseId).maybeSingle();
      if (!course) return json({ success: false, message: "Course not found" }, 404);
      const { data: paymentRecord } = await db.from("payments").select("*").eq("razorpay_order_id", orderId).maybeSingle();
      const totalAmountPaise = Number(paymentRecord?.amount || 0);
      await db
        .from("payments")
        .update({
          status: "paid",
          razorpay_payment_id: paymentId,
          razorpay_signature: signature,
          admin_commission: 0,
          teacher_earning: totalAmountPaise,
          commission_percent: "0",
          payout_status: "pending",
        })
        .eq("razorpay_order_id", orderId);
      const granted = await grantCourse(db, {
        course: course as Record<string, unknown>,
        studentId,
        studentName: String(b.studentName || "Student"),
        studentPhone: String(b.studentPhone || ""),
        paymentId,
        razorpayOrderId: orderId,
        amountPaise: totalAmountPaise,
      });
      if (granted.enrollment?.id) {
        await db.from("payments").update({ enrollment_id: String(granted.enrollment.id) }).eq("razorpay_order_id", orderId);
      }
      return json({ success: true, enrollment: granted.enrollment, purchase: granted.purchase });
    }

    const me = await sessionProfile(db, req);
    if (!me?.id) return json({ success: false, message: "Authentication required" }, 401);
    const type = String(b.type || "").trim();
    const referenceId = String(b.referenceId || "").trim();

    if (type === "lead") {
      if (!referenceId) return json({ success: false, message: "referenceId (lead id) required" }, 400);
      const { data: lead } = await db.from("leads").select("*").eq("id", referenceId).maybeSingle();
      if (!lead) return json({ success: false, message: "Lead not found" }, 404);
      const fallback = parseInt(await settingValue(db, "lead_price", "50"), 10) || 50;
      const amountPaid = Number(lead.price || fallback) || fallback;
      const updated = await recordLeadPurchase(db, lead as Record<string, unknown>, me, amountPaid);
      return json({ success: true, lead: updated });
    }

    if (type === "subscription") {
      const now = Date.now();
      const planId = String(b.planId || "plan_1m").trim() || "plan_1m";
      const roleFromBody = String(b.role || "").trim().toLowerCase();
      let payRole = String(me.role || "").trim().toLowerCase();
      const order = await rzFetchOrder(orderId);
      const noteRole = String((order?.notes as Record<string, string> | undefined)?.role || "").toLowerCase();
      if (noteRole && PAY_ROLES.has(noteRole)) payRole = noteRole;
      if (roleFromBody && PAY_ROLES.has(roleFromBody)) payRole = roleFromBody;
      const plan = await loadPlan(db, payRole, planId);
      if (plan && !isActiveFlag(plan.is_active ?? plan.isActive)) {
        return json({ success: false, message: "Selected subscription plan is not active" }, 400);
      }
      if (plan && order) {
        const paidAmount = Number(order.amount || 0);
        const expectedAmount = Math.round(Number(plan.price || 0) * 100);
        const orderPlanId = String((order.notes as Record<string, string> | undefined)?.planId || "");
        if (expectedAmount > 0 && paidAmount !== expectedAmount) {
          return json({ success: false, message: "Payment amount does not match selected plan" }, 400);
        }
        if (orderPlanId && orderPlanId !== String(plan.id)) {
          return json({ success: false, message: "Payment amount does not match selected plan" }, 400);
        }
      }
      const months = Math.max(1, Number(plan?.months || 1));
      const startDate = Math.max(now, Number(me.subscription_end || 0), Number(me.trial_end || 0));
      const subscriptionEnd = startDate + months * 30 * 24 * 60 * 60 * 1000;
      const profilePatch: Record<string, unknown> = {
        subscription_active: 1,
        subscription_end: subscriptionEnd,
        subscription_order_id: orderId,
      };
      if ((payRole === "hotel_owner" || payRole === "restaurant_owner") && String(me.role || "").toLowerCase() !== payRole) {
        profilePatch.role = payRole;
      }
      const profileIds = new Set<string>([String(me.id || "")].filter(Boolean));
      if (referenceId) profileIds.add(referenceId);
      const payPhone = String(me.phone || "").replace(/\D/g, "").slice(-10);
      if (payPhone.length === 10) {
        const { data: twins } = await db
          .from("profiles")
          .select("id")
          .in("phone", [payPhone, `91${payPhone}`, `+91${payPhone}`, `0${payPhone}`])
          .limit(20);
        for (const row of (twins || []) as { id?: string }[]) {
          const id = String(row.id || "").trim();
          if (id) profileIds.add(id);
        }
      }
      let profileUpdated = false;
      let profileUpdateError = "";
      for (const id of profileIds) {
        const { error } = await db.from("profiles").update(profilePatch).eq("id", id);
        if (error) profileUpdateError = error.message;
        else profileUpdated = true;
      }
      if (!profileUpdated && profileUpdateError) {
        return json({ success: false, message: profileUpdateError }, 500);
      }
      await db.from("user_subscriptions").insert({
        id: crypto.randomUUID(),
        user_id: String(me.id),
        plan_id: String(plan?.id || "legacy_1m"),
        months,
        start_date: startDate,
        end_date: subscriptionEnd,
        payment_id: paymentId,
        razorpay_order_id: orderId,
        created_at: now,
      }).then(() => undefined, () => undefined);
      const congrats = subscriptionCongrats(String(me.name || "Member"), months);
      const image = await resolveNotificationImage(db);
      try {
        await db.from("admin_notifications").insert({
          id: crypto.randomUUID(),
          type: "SUBSCRIPTION",
          user_id: String(me.id),
          user_name: String(me.name || ""),
          phone: String(me.phone || ""),
          reason: `${months} month purchase`,
          title: congrats.title,
          body: congrats.memberBody,
          image,
          read: 0,
          created_at: now,
        });
      } catch {
        /* inbox optional */
      }
      void broadcastPush(db, congrats.title, congrats.broadcastBody, {
        type: "new_subscription",
        userId: String(me.id),
        path: "/profile",
        image,
      }, image);
      return json({ success: true, subscriptionActive: 1, subscriptionEnd });
    }

    if (type === "protection_plan") {
      if (!referenceId) return json({ success: false, message: "referenceId (plan id) required" }, 400);
      const { data: plan } = await db
        .from("protection_plans")
        .select("*")
        .eq("id", referenceId)
        .eq("user_id", String(me.id))
        .maybeSingle();
      if (!plan) return json({ success: false, message: "Plan not found" }, 404);
      if (plan.razorpay_order_id && String(plan.razorpay_order_id) !== orderId) {
        return json({ success: false, message: "Order does not match this plan" }, 400);
      }
      const now = Date.now();
      await db
        .from("protection_plans")
        .update({ status: "active", payment_id: paymentId, plan_start_date: now, updated_at: now })
        .eq("id", referenceId);
      return json({ success: true, message: "Payment verified, plan is now active" });
    }

    if (type === "bike_ride") {
      if (!referenceId) return json({ success: false, message: "referenceId (ride id) required" }, 400);
      const { data: ride } = await db.from("rides").select("*").eq("id", referenceId).maybeSingle();
      if (!ride) return json({ success: false, message: "Ride not found" }, 404);
      if (String(ride.customer_id) !== String(me.id)) return json({ success: false, message: "Not your ride" }, 403);
      if (ride.razorpay_order_id && String(ride.razorpay_order_id) !== orderId) {
        return json({ success: false, message: "Order does not match this ride" }, 400);
      }
      await db
        .from("rides")
        .update({
          razorpay_payment_id: paymentId,
          razorpay_order_id: orderId,
          final_price: ride.final_price || ride.estimated_price || "0",
        })
        .eq("id", referenceId);
      return json({ success: true, message: "Ride payment verified" });
    }

    if (type === "spare_part" || type === "product") {
      if (!referenceId) return json({ success: false, message: "referenceId (checkout id) required" }, 400);
      const { data: checkout } = await db.from("spare_checkouts").select("*").eq("id", referenceId).maybeSingle();
      if (!checkout) return json({ success: false, message: "Checkout not found" }, 404);
      if (checkout.razorpay_order_id && String(checkout.razorpay_order_id) !== orderId) {
        return json({ success: false, message: "Order does not match this checkout" }, 400);
      }
      const result = await fulfillSpare(db, {
        checkoutId: referenceId,
        userId: String(me.id),
        paymentId,
        razorpayOrderId: orderId,
      });
      if (!result.success) return json({ success: false, message: result.message || "Fulfillment failed" }, 400);
      return json({ success: true, orderIds: result.orderIds, message: "Payment verified, order placed" });
    }

    return json({ success: false, message: "type must be lead, subscription, protection_plan, spare_part, product, or bike_ride" }, 400);
  }

  return null;
}
