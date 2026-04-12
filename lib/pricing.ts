// Central pricing configuration - single source of truth
export const PRICES = {
  // Mobile Protection Plan
  PROTECTION_PLAN_MONTHLY: 50,
  PROTECTION_PLAN_DISCOUNT: 500, // Discount on repairs
  
  // Repair services
  SCREEN_REPLACEMENT: 199,
  BATTERY_REPLACEMENT: 199,
  CAMERA_REPAIR: 299,
  SOFTWARE_FLASHING: 99,
  
  // For Razorpay: multiply by 100 to convert to paise
  toRazorpay: (amountInRupees: number) => amountInRupees * 100,
};

// Human readable format
export const formatPrice = (amount: number): string => `₹${amount}`;
