import { getApiUrl } from "@/lib/api-base";

/**
 * Central API config used throughout the Expo app.
 * Locked to EXPO_PUBLIC_API_URL (Cloud Run origin).
 */
export const API_URL = getApiUrl();

