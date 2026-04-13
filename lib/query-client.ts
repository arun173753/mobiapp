import { fetch as _expoFetch } from "expo/fetch";
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  DEFAULT_PRODUCTION_API_ORIGIN,
  isUnusableProductionApiOrigin,
  normalizeApiOrigin,
} from "@/lib/api-base";

// On web use native browser fetch so custom headers (x-session-token) are
// always sent reliably. expo/fetch on deployed web builds can silently drop them.
const fetch: typeof _expoFetch = Platform.OS === "web" && typeof globalThis.fetch === "function"
  ? (globalThis.fetch as any)
  : _expoFetch;

const SESSION_KEY = "mobi_session_token_v2";

export function getApiUrl(): string {
  const dev = typeof __DEV__ !== "undefined" && __DEV__;
  const envCandidates = [
    process.env.EXPO_PUBLIC_API_URL,
    process.env.EXPO_PUBLIC_DOMAIN,
    process.env.VITE_API_URL,
    process.env.REACT_APP_API_URL,
  ];
  for (const raw of envCandidates) {
    const n = normalizeApiOrigin(raw);
    if (!n) continue;
    if (dev) {
      console.log("[getApiUrl] Using env API URL:", n);
      return n;
    }
    if (!isUnusableProductionApiOrigin(n)) return n;
  }

  const extra = Constants.expoConfig?.extra as { publicApiUrl?: string } | undefined;
  const fromExtra = normalizeApiOrigin(extra?.publicApiUrl);
  if (fromExtra) {
    if (dev) return fromExtra;
    if (!isUnusableProductionApiOrigin(fromExtra)) return fromExtra;
  }

  if (dev) {
    console.warn(
      "[getApiUrl] Set EXPO_PUBLIC_API_URL in .env — defaulting to http://127.0.0.1:5000",
    );
    return "http://127.0.0.1:5000";
  }
  return DEFAULT_PRODUCTION_API_ORIGIN;
}

async function getSessionToken(): Promise<string | null> {
  try {
    // On web, try localStorage first (more reliable than AsyncStorage)
    if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage) {
      const token = window.localStorage.getItem(SESSION_KEY);
      if (token) return token;
    }
    // Fall back to AsyncStorage
    const token = await AsyncStorage.getItem(SESSION_KEY);
    if (token) return token;
    const legacyToken = await AsyncStorage.getItem("mobi_session_token");
    if (legacyToken) {
      await AsyncStorage.setItem(SESSION_KEY, legacyToken);
    }
    return legacyToken;
  } catch {
    return null;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    try {
      const json = JSON.parse(text);
      const msg = json.message || json.error || text;
      throw new Error(msg);
    } catch (e: any) {
      if (e.message && !e.message.includes('JSON')) throw e;
      throw new Error(text || `Request failed (${res.status})`);
    }
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const isFormData = data instanceof FormData;
  const sessionToken = await getSessionToken();

  const headers: Record<string, string> = {};
  if (!isFormData && data) headers["Content-Type"] = "application/json";
  if (sessionToken) headers["x-session-token"] = sessionToken;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for production
  
  const fetchOptions = {
    method,
    headers,
    body: isFormData ? (data as any) : (data ? JSON.stringify(data) : undefined),
    signal: controller.signal,
  };

  if (Platform.OS === "web") {
    // Removed credentials: "include" as it was causing 401 Invalid Session errors on web 
    // when the browser doesn't have the session cookie, but we are manually sending 
    // the x-session-token header.
  }

  if (__DEV__) console.log('[API Request]', method, url.toString(), 'Platform:', Platform.OS);
  
  let res: Response;
  try {
    res = await fetch(url.toString(), fetchOptions);
    clearTimeout(timeoutId);
    if (__DEV__) console.log('[API Response]', route, 'Status:', res.status, 'OK:', res.ok);
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout on ${route} (15s)`);
    }
    console.error('[API Fetch Error]', route, 'Error:', error.message);
    throw new Error(`Network error on ${route}: ${error.message}`);
  }

  if (res.status === 401 && !route.includes('/api/otp/') && !route.includes('/api/auth/')) {
    if (__DEV__) console.log('[API] 401 Unauthorized for', route);
    try {
      const cloned = res.clone();
      const body = await cloned.json();
      if (body.message === 'Invalid session') {
        await AsyncStorage.removeItem(SESSION_KEY);
        if (__DEV__) console.log('[API] Cleared stale session token');
      }
    } catch {}
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const sessionToken = await getSessionToken();
    const headers: Record<string, string> = {};
    if (sessionToken) headers["x-session-token"] = sessionToken;

    const fetchOptions = { headers };
    if (Platform.OS === "web") {
      // Removed credentials: "include" to match apiRequest behavior
    }

    const res = await fetch(url.toString(), fetchOptions);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 300000,
      retry: 1,
      retryDelay: () => 500,
      gcTime: 300000,
    },
    mutations: {
      retry: 1,
    },
  },
});
