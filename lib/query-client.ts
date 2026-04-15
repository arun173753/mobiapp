import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { apiRequestRaw } from "@/lib/api-client";
import { clearSessionToken, getSessionToken } from "@/lib/storage";

export { getApiUrl } from "@/lib/api-base";
export { API_URL } from "@/lib/api-config";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    try {
      // Surface server error payloads in console for easier debugging on Hosting.
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const isJson = ct.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[");
      const parsed = isJson ? JSON.parse(text) : null;
      if (parsed && typeof parsed === "object") {
        const errorId = (parsed as any)?.errorId;
        const detail = (parsed as any)?.detail || (parsed as any)?.message || (parsed as any)?.error;
        console.error("[API] Non-OK response payload:", {
          status: res.status,
          errorId: typeof errorId === "string" ? errorId : undefined,
          detail: typeof detail === "string" ? detail.slice(0, 800) : undefined,
        });
      } else {
        console.error("[API] Non-OK response text:", { status: res.status, text: String(text).slice(0, 800) });
      }
    } catch (e) {
      console.error("[API] Non-OK response (parse failed):", { status: res.status });
    }
    try {
      const json = JSON.parse(text);
      let msg = String(json.message || json.detail || json.error || "").trim();
      if (!msg) msg = text;
      if (typeof json.bunnyError === "string" && json.bunnyError.trim()) {
        msg = `${msg || "Request failed"} — ${String(json.bunnyError).slice(0, 600)}`;
      }
      throw new Error(typeof msg === "string" ? msg : text);
    } catch (e: any) {
      if (e.message && !e.message.includes("JSON")) throw e;
      throw new Error(text || `Request failed (${res.status})`);
    }
  }
}

/** Optional tuning for slow routes (uploads, Bunny, large JSON). */
export type ApiRequestOptions = {
  timeoutMs?: number;
  /** Extra attempts after the first (default 3 retries = 4 tries total). */
  retries?: number;
  /** Skip GET /health probe (e.g. if you already verified reachability). */
  skipReachability?: boolean;
};

const DEFAULT_API_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 2;

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
  options?: ApiRequestOptions,
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? Math.max(DEFAULT_API_TIMEOUT_MS, 120_000);
  const retries = options?.retries ?? DEFAULT_RETRIES;
  const skipReachability = options?.skipReachability;

  const sessionToken = (await getSessionToken())?.trim() || null;

  const res = await apiRequestRaw(method, route, data, {
    timeoutMs,
    retries,
    skipReachability,
  });

  if (
    res.status === 401 &&
    sessionToken &&
    !route.includes("/api/otp/") &&
    !route.includes("/api/auth/")
  ) {
    if (__DEV__) console.log("[API] 401 Unauthorized for", route);
    try {
      const cloned = res.clone();
      const body = await cloned.json();
      const msg = body?.message || body?.error;
      if (
        msg === "Invalid session" ||
        msg === "Authentication required" ||
        msg === "Unauthorized: Session token required"
      ) {
        await clearSessionToken();
        if (__DEV__) console.log("[API] Cleared stale session token");
      }
    } catch {
      /* ignore */
    }
  }

  await throwIfResNotOk(res);
  if (__DEV__) console.log("[API Response]", route, "Status:", res.status, "OK:", res.ok);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const path = queryKey.join("/") as string;
    const sessionToken = (await getSessionToken())?.trim() || null;

    const res = await apiRequestRaw("GET", path, undefined, {
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      retries: DEFAULT_RETRIES,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (
      res.status === 401 &&
      sessionToken &&
      !path.includes("/api/otp/") &&
      !path.includes("/api/auth/")
    ) {
      try {
        const cloned = res.clone();
        const body = await cloned.json();
        const msg = body?.message || body?.error;
        if (
          msg === "Invalid session" ||
          msg === "Authentication required" ||
          msg === "Unauthorized: Session token required"
        ) {
          await clearSessionToken();
        }
      } catch {
        /* ignore */
      }
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
