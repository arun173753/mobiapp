import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, bigint, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const profiles = pgTable("profiles", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").default(""),
  role: text("role").notNull(),
  skills: text("skills").notNull().default("[]"),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  experience: text("experience").notNull().default(""),
  shopName: text("shop_name").default(""),
  bio: text("bio").default(""),
  avatar: text("avatar").default(""),
  sellType: text("sell_type").default(""),
  teachType: text("teach_type").default(""),
  shopAddress: text("shop_address").default(""),
  gstNumber: text("gst_number").default(""),
  aadhaarNumber: text("aadhaar_number").default(""),
  panNumber: text("pan_number").default(""),
  latitude: text("latitude").default(""),
  longitude: text("longitude").default(""),
  locationSharing: text("location_sharing").default("true"),
  lastSeen: bigint("last_seen", { mode: "number" }).default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  subscriptionActive: integer("subscription_active").default(0),
  subscriptionEnd: bigint("subscription_end", { mode: "number" }).default(0),
  subscriptionOrderId: text("subscription_order_id").default(""),
  deviceId: text("device_id").default(""),
  deviceChangeCount: integer("device_change_count").default(0),
  pushToken: text("push_token").default(""),
  blocked: integer("blocked").default(0),
  allowMarketing: integer("allow_marketing").default(1),
  notificationPrefs: text("notification_prefs").default(JSON.stringify({
    orders: true,
    messages: true,
    marketing: true,
    system: true
  })),
  availableForJobs: text("available_for_jobs").default("true"),
  verified: integer("verified").default(0),
  bannerImage: text("banner_image").default(""),
  shopThumbnail: text("shop_thumbnail").default(""),
  rating: text("rating").default("0"),
  ratingCount: text("rating_count").default("0"),
  profileLikes: text("profile_likes").default("[]"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  deleted_at: timestamp("deleted_at"),
  blocked_at: timestamp("blocked_at"),
});

export const repairBookings = pgTable("repair_bookings", {
  id: varchar("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").default(""),
  deviceBrand: text("device_brand").notNull(),
  deviceModel: text("device_model").notNull(),
  repairType: text("repair_type").notNull(),
  price: text("price").notNull().default("0"),
  address: text("address").default(""),
  latitude: text("latitude").default(""),
  longitude: text("longitude").default(""),
  bookingDate: text("booking_date").notNull(),
  bookingTime: text("booking_time").notNull(),
  status: text("status").notNull().default("pending"),
  technicianId: text("technician_id").default(""),
  technicianName: text("technician_name").default(""),
  technicianPhone: text("technician_phone").default(""),
  notes: text("notes").default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const posts = pgTable("posts", {
  id: varchar("id").primaryKey(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  userRole: text("user_role").notNull(),
  userAvatar: text("user_avatar").default(""),
  text: text("text").notNull().default(""),
  images: text("images").notNull().default("[]"),
  videoUrl: text("video_url").default(""),
  category: text("category").notNull().default("repair"),
  likes: text("likes").notNull().default("[]"),
  comments: text("comments").notNull().default("[]"),
  views: integer("views").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  skills: text("skills").notNull().default("[]"),
  salary: text("salary").default(""),
  type: text("type").notNull().default("full_time"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey(),
  participant1Id: text("participant1_id").notNull(),
  participant1Name: text("participant1_name").notNull(),
  participant1Role: text("participant1_role").notNull(),
  participant2Id: text("participant2_id").notNull(),
  participant2Name: text("participant2_name").notNull(),
  participant2Role: text("participant2_role").notNull(),
  lastMessage: text("last_message").default(""),
  lastMessageSenderId: text("last_message_sender_id").default(""),
  lastMessageAt: bigint("last_message_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const messages = pgTable("messages", {
  id: varchar("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  senderId: text("sender_id").notNull(),
  senderName: text("sender_name").notNull(),
  text: text("text").notNull().default(""),
  image: text("image").default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const reels = pgTable("reels", {
  id: varchar("id").primaryKey(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  userAvatar: text("user_avatar").default(""),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  videoUrl: text("video_url").notNull(),
  thumbnailUrl: text("thumbnail_url").default(""),
  likes: text("likes").notNull().default("[]"),
  comments: text("comments").notNull().default("[]"),
  views: integer("views").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const products = pgTable("products", {
  id: varchar("id").primaryKey(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  userRole: text("user_role").notNull(),
  userAvatar: text("user_avatar").default(""),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  price: text("price").notNull().default("0"),
  category: text("category").notNull().default("other"),
  images: text("images").notNull().default("[]"),
  thumbnail: text("thumbnail").default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  inStock: integer("in_stock").notNull().default(1),
  videoUrl: text("video_url").default(""),
  deliveryInfo: text("delivery_info").default(""),
  contactPhone: text("contact_phone").default(""),
  views: integer("views").notNull().default(0),
  likes: text("likes").notNull().default("[]"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const orders = pgTable("orders", {
  id: varchar("id").primaryKey(),
  productId: text("product_id").notNull(),
  productTitle: text("product_title").notNull(),
  productPrice: text("product_price").notNull().default("0"),
  productImage: text("product_image").default(""),
  productCategory: text("product_category").default(""),
  buyerId: text("buyer_id").notNull(),
  buyerName: text("buyer_name").notNull(),
  buyerPhone: text("buyer_phone").default(""),
  buyerCity: text("buyer_city").default(""),
  buyerState: text("buyer_state").default(""),
  sellerId: text("seller_id").notNull(),
  sellerName: text("seller_name").notNull(),
  sellerRole: text("seller_role").notNull(),
  quantity: integer("quantity").notNull().default(1),
  totalAmount: text("total_amount").notNull().default("0"),
  status: text("status").notNull().default("pending"),
  shippingAddress: text("shipping_address").default(""),
  buyerNotes: text("buyer_notes").default(""),
  sellerNotes: text("seller_notes").default(""),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const subscriptionSettings = pgTable("subscription_settings", {
  id: varchar("id").primaryKey(),
  role: text("role").notNull(),
  enabled: integer("enabled").notNull().default(0),
  amount: text("amount").notNull().default("0"),
  period: text("period").notNull().default("monthly"),
  commissionPercent: text("commission_percent").notNull().default("0"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const courses = pgTable("courses", {
  id: varchar("id").primaryKey(),
  teacherId: text("teacher_id").notNull(),
  teacherName: text("teacher_name").notNull(),
  teacherAvatar: text("teacher_avatar").default(""),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  price: text("price").notNull().default("0"),
  coverImage: text("cover_image").default(""),
  category: text("category").notNull().default("course"),
  language: text("language").notNull().default("hindi"),
  demoDuration: integer("demo_duration").notNull().default(60),
  accessDays: integer("access_days").notNull().default(365),
  totalVideos: integer("total_videos").notNull().default(0),
  totalDuration: integer("total_duration").notNull().default(0),
  enrollmentCount: integer("enrollment_count").notNull().default(0),
  rating: text("rating").notNull().default("0"),
  isPublished: integer("is_published").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const courseChapters = pgTable("course_chapters", {
  id: varchar("id").primaryKey(),
  courseId: text("course_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const courseVideos = pgTable("course_videos", {
  id: varchar("id").primaryKey(),
  courseId: text("course_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  videoUrl: text("video_url").notNull(),
  thumbnailUrl: text("thumbnail_url").default(""),
  duration: integer("duration").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  isDemo: integer("is_demo").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const courseEnrollments = pgTable("course_enrollments", {
  id: varchar("id").primaryKey(),
  courseId: text("course_id").notNull(),
  studentId: text("student_id").notNull(),
  studentName: text("student_name").notNull(),
  studentPhone: text("student_phone").default(""),
  teacherId: text("teacher_id").notNull(),
  status: text("status").notNull().default("active"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  completedVideos: text("completed_videos").default("[]"),
});

export const videoProgress = pgTable("video_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  videoId: text("video_id").notNull(),
  position: integer("position").notNull().default(0),
  duration: integer("duration").notNull().default(0),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const dubbedVideos = pgTable("dubbed_videos", {
  id: varchar("id").primaryKey(),
  videoId: text("video_id").notNull(),
  courseId: text("course_id").notNull(),
  language: text("language").notNull(),
  dubbedVideoUrl: text("dubbed_video_url").notNull(),
  status: text("status").notNull().default("processing"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const ads = pgTable("ads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull().default(""),
  description: text("description").default(""),
  imageUrl: text("image_url").default(""),
  videoUrl: text("video_url").default(""),
  linkUrl: text("link_url").default(""),
  isActive: integer("is_active").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const liveChatMessages = pgTable("live_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderId: text("sender_id").notNull(),
  senderName: text("sender_name").notNull().default(""),
  senderRole: text("sender_role").notNull().default(""),
  senderAvatar: text("sender_avatar").default(""),
  message: text("message").notNull().default(""),
  image: text("image").default(""),
  video: text("video").default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const liveClasses = pgTable("live_classes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  courseId: text("course_id").notNull(),
  teacherId: text("teacher_id").notNull(),
  teacherName: text("teacher_name").notNull(),
  title: text("title").notNull(),
  description: text("description").default(""),
  scheduledAt: bigint("scheduled_at", { mode: "number" }).notNull(),
  duration: integer("duration").notNull().default(60),
  status: text("status").notNull().default("scheduled"),
  meetingUrl: text("meeting_url").default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const liveSessions = pgTable("live_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  teacherId: text("teacher_id").notNull(),
  teacherName: text("teacher_name").default(""),
  teacherAvatar: text("teacher_avatar").default(""),
  title: text("title").notNull(),
  description: text("description").default(""),
  platform: text("platform").notNull().default("other"),
  link: text("link").notNull(),
  thumbnailUrl: text("thumbnail_url").default(""),
  isLive: integer("is_live").notNull().default(1),
  startedAt: bigint("started_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  endedAt: bigint("ended_at", { mode: "number" }).default(0),
  viewerCount: integer("viewer_count").default(0),
});

export const livePolls = pgTable("live_polls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  classId: text("class_id").notNull(),
  courseId: text("course_id").notNull(),
  teacherId: text("teacher_id").notNull(),
  type: text("type").notNull().default("poll"), // "poll" or "quiz"
  question: text("question").notNull(),
  options: text("options").notNull(), // JSON array of strings
  correctOption: integer("correct_option").default(-1), // index, -1 for polls
  status: text("status").notNull().default("active"), // "active" | "closed"
  timerSeconds: integer("timer_seconds").default(0), // 0 = no timer
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const livePollVotes = pgTable("live_poll_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pollId: text("poll_id").notNull(),
  userId: text("user_id").notNull(),
  optionIndex: integer("option_index").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const courseNotices = pgTable("course_notices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  courseId: text("course_id").notNull(),
  teacherId: text("teacher_id").notNull(),
  teacherName: text("teacher_name").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull().default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  razorpayOrderId: text("razorpay_order_id").notNull(),
  razorpayPaymentId: text("razorpay_payment_id").default(""),
  razorpaySignature: text("razorpay_signature").default(""),
  courseId: text("course_id").notNull(),
  studentId: text("student_id").notNull(),
  studentName: text("student_name").notNull(),
  studentPhone: text("student_phone").default(""),
  teacherId: text("teacher_id").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("created"),
  enrollmentId: text("enrollment_id").default(""),
  adminCommission: integer("admin_commission").default(0),
  teacherEarning: integer("teacher_earning").default(0),
  commissionPercent: text("commission_percent").default("30"),
  payoutStatus: text("payout_status").default("pending"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const teacherPayouts = pgTable("teacher_payouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  teacherId: text("teacher_id").notNull(),
  teacherName: text("teacher_name").notNull(),
  amount: integer("amount").notNull().default(0),
  status: text("status").notNull().default("pending"),
  upiId: text("upi_id").default(""),
  bankAccount: text("bank_account").default(""),
  notes: text("notes").default(""),
  adminNotes: text("admin_notes").default(""),
  requestedAt: bigint("requested_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  paidAt: bigint("paid_at", { mode: "number" }).default(0),
});

export const sessions = pgTable("sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phone: text("phone").notNull(),
  sessionToken: text("session_token").notNull().unique(),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const otpTokens = pgTable("otp_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phone: text("phone"),
  email: text("email"),
  otp: text("otp").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const appSettings = pgTable("app_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull().default(""),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const adminNotifications = pgTable("admin_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull().default("ACCOUNT_LOCKED"),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull().default(""),
  phone: text("phone").notNull().default(""),
  reason: text("reason").notNull().default(""),
  title: text("title").default(""), // Push notification title
  body: text("body").default(""), // Push notification body
  image: text("image").default(""), // Push notification image URL
  read: integer("read").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

/** Admin megaphone / broadcast pushes (OneSignal) for audit trail. */
export const broadcastPushLogs = pgTable("broadcast_push_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  body: text("body").notNull(),
  image: text("image").default(""),
  openPath: text("open_path").default(""),
  audience: text("audience").notNull().default("all"),
  targetRole: text("target_role").default(""),
  recipientCount: integer("recipient_count").notNull().default(0),
  oneSignalId: text("onesignal_id").default(""),
  error: text("error").default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const emailCampaigns = pgTable("email_campaigns", {
  id: varchar("id").primaryKey(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  targetRole: text("target_role").default("all"),
  status: text("status").default("pending"),
  sent: integer("sent").default(0),
  failed: integer("failed").default(0),
  total: integer("total").default(0),
  scheduledAt: bigint("scheduled_at", { mode: "number" }),
  sentAt: bigint("sent_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const protectionPlans = pgTable("protection_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  userPhone: text("user_phone").default(""),
  imei: text("imei").notNull(),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  modelNumber: text("model_number").notNull(),
  devices: text("devices").default("[]"), // JSON array of devices
  planType: text("plan_type").notNull().default("monthly"),
  price: integer("price").notNull().default(0),
  frontImage: text("front_image").default(""),
  backImage: text("back_image").default(""),
  status: text("status").notNull().default("pending_verification"),
  claimUsed: integer("claim_used").notNull().default(0),
  paymentId: text("payment_id").default(""),
  razorpayOrderId: text("razorpay_order_id").default(""),
  planStartDate: bigint("plan_start_date", { mode: "number" }).default(0),
  rejectionReason: text("rejection_reason").default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const protectionClaims = pgTable("protection_claims", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: text("plan_id").notNull(),
  userId: text("user_id").notNull(),
  imei: text("imei").notNull(),
  model: text("model").notNull(),
  modelNumber: text("model_number").notNull(),
  issue: text("issue").notNull(),
  description: text("description").default(""),
  damageImage: text("damage_image").default(""),
  status: text("status").notNull().default("claim_pending"),
  technicianId: text("technician_id").default(""),
  technicianName: text("technician_name").default(""),
  serviceFeePaid: integer("service_fee_paid").default(0),
  rejectionReason: text("rejection_reason").default(""),
  adminNotes: text("admin_notes").default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: text("customer_id").notNull().default(""),
  customerName: text("customer_name").notNull().default(""),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("repair"),
  location: text("location").notNull().default(""),
  contactNumber: text("contact_number").notNull().default(""),
  latitude: text("latitude").default(""),
  longitude: text("longitude").default(""),
  status: text("status").notNull().default("open"),
  purchasedBy: text("purchased_by").notNull().default("[]"),
  maxBuyers: integer("max_buyers").notNull().default(5),
  price: integer("price").notNull().default(50),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const leadClaims = pgTable("lead_claims", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: text("lead_id").notNull(),
  technicianId: text("technician_id").notNull(),
  technicianName: text("technician_name").notNull().default(""),
  amountPaid: integer("amount_paid").notNull().default(50),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type DbPost = typeof posts.$inferSelect;
export type DbJob = typeof jobs.$inferSelect;
export type DbConversation = typeof conversations.$inferSelect;
export type DbMessage = typeof messages.$inferSelect;
export type DbReel = typeof reels.$inferSelect;
export type DbProduct = typeof products.$inferSelect;
export type DbOrder = typeof orders.$inferSelect;
export type DbRepairBooking = typeof repairBookings.$inferSelect;
export type DbCourse = typeof courses.$inferSelect;
export type DbCourseChapter = typeof courseChapters.$inferSelect;
export type DbCourseVideo = typeof courseVideos.$inferSelect;
export type DbCourseEnrollment = typeof courseEnrollments.$inferSelect;
export type DbDubbedVideo = typeof dubbedVideos.$inferSelect;
export type DbAd = typeof ads.$inferSelect;
export type DbLiveChatMessage = typeof liveChatMessages.$inferSelect;
export type DbLiveClass = typeof liveClasses.$inferSelect;
export type DbLiveSession = typeof liveSessions.$inferSelect;
export type DbCourseNotice = typeof courseNotices.$inferSelect;
export type DbPayment = typeof payments.$inferSelect;
export type DbTeacherPayout = typeof teacherPayouts.$inferSelect;
export type DbSession = typeof sessions.$inferSelect;
export type DbAppSetting = typeof appSettings.$inferSelect;
export type DbVideoProgress = typeof videoProgress.$inferSelect;
export type DbLivePoll = typeof livePolls.$inferSelect;
export type DbLivePollVote = typeof livePollVotes.$inferSelect;
export type DbEmailCampaign = typeof emailCampaigns.$inferSelect;
export type DbProtectionPlan = typeof protectionPlans.$inferSelect;
export type DbProtectionClaim = typeof protectionClaims.$inferSelect;
export type DbLead = typeof leads.$inferSelect;
export type DbLeadClaim = typeof leadClaims.$inferSelect;
