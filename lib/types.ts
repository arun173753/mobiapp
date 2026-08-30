export type UserRole =
  | 'technician'
  | 'teacher'
  | 'supplier'
  | 'shopkeeper'
  | 'job_provider'
  | 'customer'
  | 'admin'
  | 'doctor'
  | 'lawyer'
  | 'software_developer'
  | 'digital_marketer'
  | 'driver'
  | 'delivery_partner'
  | 'freelancer'
  | 'service_provider'
  | 'labour'
  | 'cleaner'
  | 'mechanic'
  | 'electrician'
  | 'plumber'
  | 'carpenter'
  | 'painter'
  | 'welder'
  | 'hotel_owner'
  | 'restaurant_owner';

/**
 * All "I provide a service" roles. Customers and admins are excluded.
 * Used by directory, leads, and the unified provider tab layout.
 */
export const PROVIDER_ROLES: readonly UserRole[] = [
  'technician',
  'teacher',
  'supplier',
  'shopkeeper',
  'doctor',
  'lawyer',
  'software_developer',
  'digital_marketer',
  'driver',
  'delivery_partner',
  'freelancer',
  'service_provider',
  'labour',
  'cleaner',
  'mechanic',
  'electrician',
  'plumber',
  'carpenter',
  'painter',
  'welder',
] as const;

/** Same as PROVIDER_ROLES — unified subscription (1/6/12 month, trial, video) for all providers. */
export const SUBSCRIPTION_ROLES = PROVIDER_ROLES;

export function isProviderRole(role?: string | null): boolean {
  if (!role) return false;
  return (PROVIDER_ROLES as readonly string[]).includes(String(role));
}

/** Drivers and delivery partners — accept rides via service bookings + ride pool. */
export function isRidePartnerRole(role?: string | null): boolean {
  const r = String(role || '').toLowerCase();
  return r === 'driver' || r === 'delivery_partner';
}

/** Book bike taxi — available for every role except technician. */
export function canBookRide(role?: string | null): boolean {
  return String(role || '').toLowerCase() !== 'technician';
}

export function isHospitalityOwnerRole(role?: string | null): boolean {
  return role === 'hotel_owner' || role === 'restaurant_owner';
}

export function isSubscriptionGatedRole(role?: string | null): boolean {
  return isProviderRole(role) || isHospitalityOwnerRole(role);
}

/** Courses + Solutions tabs (technician, teacher, shopkeeper only). */
export const COURSES_SOLUTIONS_ROLES: readonly UserRole[] = [
  'technician',
  'teacher',
  'shopkeeper',
] as const;

export function hasCoursesAndSolutionsAccess(role?: string | null): boolean {
  if (!role) return false;
  return (COURSES_SOLUTIONS_ROLES as readonly string[]).includes(String(role));
}

/** Roles users may switch to themselves (Settings → Switch Role). Excludes admin unless admin/super-admin. */
export const SELF_SERVICE_SWITCHABLE_ROLES: readonly UserRole[] = [
  'customer',
  'job_provider',
  'hotel_owner',
  'restaurant_owner',
  ...PROVIDER_ROLES,
] as const;

/** Every role an admin can assign via Admin → Users → Change Role. */
export const ADMIN_ASSIGNABLE_ROLES: readonly UserRole[] = [
  'customer',
  'job_provider',
  'hotel_owner',
  'restaurant_owner',
  ...PROVIDER_ROLES,
  'admin',
] as const;

export interface UserProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: UserRole;
  skills: string[];
  city: string;
  state: string;
  experience: string;
  shopName?: string;
  avatar?: string;
  bio?: string;
  sellType?: string;
  teachType?: string;
  shopAddress?: string;
  gstNumber?: string;
  aadhaarNumber?: string;
  panNumber?: string;
  latitude?: string;
  longitude?: string;
  locationSharing?: string;
  subscriptionActive?: number;
  subscriptionEnd?: number;
  subscriptionOrderId?: string;
  deviceId?: string;
  deviceChangeCount?: number;
  availableForJobs?: string;
  verified?: number;
  rating?: string;
  ratingCount?: string;
  profileLikes?: string;
  lastSeen?: number;
  createdAt: number;
}

export interface SubscriptionSetting {
  id: string;
  role: string;
  enabled: number;
  amount: string;
  period: string;
  commissionPercent: string;
  updatedAt: number;
}

export type PostCategory = 'repair' | 'job' | 'training' | 'supplier' | 'sell';

export interface Post {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  userAvatar?: string;
  /** Aggregate author rating when backend enriches posts */
  authorRating?: string;
  authorRatingCount?: string;
  text: string;
  images: string[];
  videoUrl?: string;
  category: PostCategory;
  likes: string[];
  comments: Comment[];
  createdAt: number;
}

export interface Comment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: number;
}

export interface Job {
  id: string;
  userId: string;
  userName: string;
  title: string;
  description: string;
  city: string;
  state: string;
  skills: string[];
  salary?: string;
  type: 'full_time' | 'part_time' | 'contract' | 'freelance';
  category?: string;
  location?: string;
  contactPhone?: string;
  image?: string;
  companyName?: string;
  status?: string;
  approved?: number;
  featured?: number;
  saved?: boolean;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  image?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  participantNames: string[];
  participantRoles: UserRole[];
  lastMessage?: string;
  lastMessageSenderId?: string;
  lastMessageAt: number;
  messages: ChatMessage[];
  unreadCount: number;
}

export type ProductCategory = 'course' | 'tutorial' | 'ebook' | 'spare_part' | 'tool' | 'component' | 'accessory' | 'other';

export interface Product {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  userAvatar?: string;
  title: string;
  description: string;
  price: string;
  category: ProductCategory;
  images: string[];
  videoUrl?: string;
  city: string;
  state: string;
  inStock: number;
  deliveryInfo?: string;
  contactPhone?: string;
  views: number;
  likes: string[];
  createdAt: number;
}

export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'completed' | 'cancelled' | 'rejected';

export type RepairStatus = 'pending' | 'assigned' | 'on_the_way' | 'repair_started' | 'completed' | 'cancelled' | 'timed_out';

export interface RepairBooking {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  deviceBrand: string;
  deviceModel: string;
  repairType: string;
  price: string;
  address?: string;
  latitude?: string;
  longitude?: string;
  bookingDate: string;
  bookingTime: string;
  status: RepairStatus;
  technicianId?: string;
  technicianName?: string;
  technicianPhone?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  pending: 'Finding Technician',
  assigned: 'Technician Assigned',
  on_the_way: 'Technician On The Way',
  repair_started: 'Repair in Progress',
  completed: 'Repair Completed',
  cancelled: 'Cancelled',
  timed_out: 'Timed Out',
};

export const REPAIR_STATUS_COLORS: Record<RepairStatus, string> = {
  pending: '#FF9F0A',
  assigned: '#5E5CE6',
  on_the_way: '#0A84FF',
  repair_started: '#32D74B',
  completed: '#34C759',
  cancelled: '#FF453A',
  timed_out: '#8E8E93',
};

export interface Order {
  id: string;
  productId: string;
  productTitle: string;
  productPrice: string;
  productImage?: string;
  productCategory?: string;
  buyerId: string;
  buyerName: string;
  buyerPhone?: string;
  buyerCity?: string;
  buyerState?: string;
  sellerId: string;
  sellerName: string;
  sellerRole: string;
  quantity: number;
  totalAmount: string;
  status: OrderStatus;
  shippingAddress?: string;
  deliveryLatitude?: string;
  deliveryLongitude?: string;
  buyerNotes?: string;
  sellerNotes?: string;
  updatedAt: number;
  createdAt: number;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  pending: '#FF9F0A',
  confirmed: '#30D158',
  shipped: '#5E5CE6',
  delivered: '#32D74B',
  completed: '#34C759',
  cancelled: '#FF453A',
  rejected: '#FF3B30',
};

export const TEACHER_CATEGORIES: { key: ProductCategory; label: string }[] = [
  { key: 'course', label: 'Full Course' },
  { key: 'tutorial', label: 'Tutorial' },
  { key: 'ebook', label: 'E-Book / PDF' },
  { key: 'other', label: 'Other' },
];

export const SUPPLIER_CATEGORIES: { key: ProductCategory; label: string }[] = [
  { key: 'spare_part', label: 'Spare Part' },
  { key: 'tool', label: 'Tool' },
  { key: 'component', label: 'Component' },
  { key: 'accessory', label: 'Accessory' },
  { key: 'other', label: 'Other' },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  technician: 'Technician',
  teacher: 'Teacher',
  supplier: 'Supplier',
  shopkeeper: 'Shopkeeper',
  job_provider: 'Job Provider',
  customer: 'Customer',
  admin: 'Admin',
  doctor: 'Doctor',
  lawyer: 'Lawyer',
  software_developer: 'Software Developer',
  digital_marketer: 'Digital Marketer',
  driver: 'Driver',
  delivery_partner: 'Delivery Partner',
  freelancer: 'Freelancer',
  service_provider: 'Service Provider',
  labour: 'Labour',
  cleaner: 'Cleaner',
  mechanic: 'Mechanic',
  electrician: 'Electrician',
  plumber: 'Plumber',
  carpenter: 'Carpenter',
  painter: 'Painter',
  welder: 'Welder',
  hotel_owner: 'Hotel Owner',
  restaurant_owner: 'Restaurant Owner',
};

export const SHOPKEEPER_SELL_TYPES = ['Mobile Accessories', 'Phone Cases', 'Chargers & Cables', 'Screen Protectors', 'Earphones', 'Power Banks', 'Spare Parts', 'Other'];

export const CATEGORY_LABELS: Record<PostCategory, string> = {
  repair: 'Repair Work',
  job: 'Job',
  training: 'Training',
  supplier: 'Supplier',
  sell: 'For Sale',
};

export const SUPPLIER_SELL_TYPES = ['Spare Parts', 'Accessories', 'Tools', 'Software'];

export const TEACHER_TEACH_TYPES = ['Software', 'Hardware'];

/** Primary super-admin line (10 digits, or last 10 of +91…). Only this account may use the admin panel. */
export const ADMIN_PHONE = '8179142535';

/**
 * Admin panel / super-admin affordances in the app. Intentionally **phone-only** so a stale
 * `role: 'admin'` row, test numbers, or email cannot open admin UI after a glitch.
 */
export function isAdminUser(profile: { role?: string; phone?: string; email?: string } | null | undefined): boolean {
  if (!profile?.phone) return false;
  const digits = String(profile.phone).replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return last10 === ADMIN_PHONE;
}

export const SKILLS_LIST = [
  'Mobile Repair', 'Laptop Repair', 'AC Repair', 'TV Repair',
  'Refrigerator Repair', 'Washing Machine Repair', 'Microwave Repair',
  'Printer Repair', 'CCTV Installation', 'Electrical Wiring',
  'Plumbing', 'Carpentry', 'Painting', 'Welding',
  'Auto Mechanic', 'Computer Hardware', 'Networking',
  'Solar Panel Installation', 'PCB Repair', 'Chip Level Repair',
];

export type CourseCategory = 'course' | 'tutorial' | 'workshop';

export const INDIAN_LANGUAGES = [
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'en', name: 'English', nativeName: 'English' },
];

export interface Course {
  id: string;
  teacherId: string;
  teacherName: string;
  teacherAvatar?: string;
  title: string;
  description: string;
  price: string;
  coverImage?: string;
  category: CourseCategory;
  language: string;
  demoDuration: number;
  accessDays: number;
  totalVideos: number;
  totalDuration: number;
  enrollmentCount: number;
  rating: string;
  isPublished: number;
  createdAt: number;
  chapters?: CourseChapter[];
}

export interface CourseChapter {
  id: string;
  courseId: string;
  title: string;
  description: string;
  sortOrder: number;
  videos?: CourseVideo[];
  createdAt: number;
}

export interface CourseVideo {
  id: string;
  courseId: string;
  chapterId: string;
  title: string;
  description: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration: number;
  sortOrder: number;
  isDemo: number;
  createdAt: number;
}

export interface CourseEnrollment {
  id: string;
  courseId: string;
  studentId: string;
  studentName: string;
  studentPhone?: string;
  teacherId: string;
  status: 'active' | 'expired' | 'cancelled';
  paymentStatus: 'pending' | 'paid' | 'refunded';
  expiresAt: number;
  createdAt: number;
}

export interface LiveClass {
  id: string;
  courseId: string;
  teacherId: string;
  teacherName: string;
  title: string;
  description: string;
  scheduledAt: number;
  duration: number;
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';
  meetingUrl: string;
  createdAt: number;
}

export interface CourseNotice {
  id: string;
  courseId: string;
  teacherId: string;
  teacherName: string;
  title: string;
  message: string;
  createdAt: number;
}

export const COURSE_CATEGORIES: { key: CourseCategory; label: string }[] = [
  { key: 'course', label: 'Full Course' },
  { key: 'tutorial', label: 'Tutorial' },
  { key: 'workshop', label: 'Workshop' },
];

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra',
  'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Chandigarh',
];
