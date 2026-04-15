/**
 * Robust HTTP client: timeouts, retries, optional reachability probe, clearer errors for "fetch failed".
 */
import { fetch as _expoFetch } from "expo/fetch";
import { Platform } from "react-native";
import { API_URL } from "@/lib/api-config";
import { getSessionToken } from "@/lib/storage";

const browserFetch =
  Platform.OS === "web" && typeof globalThis.fetch === "function"
    ? (globalThis.fetch as typeof fetch)
    : _expoFetch;

let loggedBase = false;
let reachabilityPromise: Promise<boolean> | null = null;

function logBaseOnce(base: string) {
  if (loggedBase) return;
  loggedBase = true;
  console.log("API URL:", base);
}

/** One-shot GET /health before first API call (cached). Logs warning if unreachable; does not block forever. */
export async function ensureApiReachableOnce(): Promise<void> {
  const base = API_URL;
  logBaseOnce(base);
  if (reachabilityPromise) {
    await reachabilityPromise;
    return;
  }
  reachabilityPromise = (async () => {
    const healthUrl = new URL("/health", base).toString();
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12_000);
    try {
      const r = await browserFetch(healthUrl, { method: "GET", signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) {
        console.warn("[API] Health check non-OK:", r.status, healthUrl);
        return false;
      }
      return true;
    } catch (e: any) {
      clearTimeout(t);
      console.warn(
        "[API] Backend may be unreachable (health check failed):",
        e?.message || e,
        "—",
        healthUrl,
      );
      return false;
    }
  })();
  await reachabilityPromise;
}

export type RobustFetchInit = RequestInit & { timeoutMs?: number };

function normalizeNetworkError(route: string, err: unknown): Error {
  const name = err && typeof err === "object" && "name" in err ? String((err as any).name) : "";
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : err != null
          ? String(err)
          : "unknown error";
  if (name === "AbortError" || msg.toLowerCase().includes("abort")) {
    return new Error(`Request timeout or aborted on ${route}`);
  }
  if (
    msg.includes("fetch failed") ||
    msg.includes("Failed to fetch") ||
    msg.includes("Network request failed") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ECONNRESET")
  ) {
    return new Error(
      `Network error on ${route}: ${msg}. Check EXPO_PUBLIC_API_URL (${API_URL}) and device connectivity.`,
    );
  }
  return err instanceof Error ? err : new Error(`Network error on ${route}: ${msg}`);
}

export async function robustFetch(
  url: string,
  init: RobustFetchInit = {},
  options?: { retries?: number },
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 120_000;
  const retries = options?.retries ?? 2;
  const maxAttempts = 1 + retries;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const { signal: userSignal, timeoutMs: _tm, ...rest } = init;
    if (userSignal) {
      if (userSignal.aborted) controller.abort();
      else {
        userSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await (browserFetch as (input: string, init?: RequestInit) => Promise<Response>)(
        url,
        { ...rest, signal: controller.signal },
      );
      clearTimeout(timeoutId);
      const retryableStatus = res.status === 502 || res.status === 503 || res.status === 504;
      if (retryableStatus && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timeoutId);
      lastErr = normalizeNetworkError(url, e);
      const msg = lastErr.message || "";
      const isTimeout = msg.includes("timeout") || msg.includes("Timeout") || msg.includes("aborted");
      const isNetwork =
        msg.includes("Network error") ||
        msg.includes("Failed to fetch") ||
        msg.includes("fetch failed") ||
        msg.includes("Network request failed");
      if (attempt < maxAttempts - 1 && (isTimeout || isNetwork)) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr || new Error("robustFetch failed");
}

export type ApiRequestOptions = {
  timeoutMs?: number;
  retries?: number;
  skipReachability?: boolean;
};

export async function apiRequestRaw(
  method: string,
  route: string,
  data?: unknown,
  options?: ApiRequestOptions,
): Promise<Response> {
  if (!options?.skipReachability) {
    await ensureApiReachableOnce();
  } else {
    logBaseOnce(API_URL);
  }

  const url = new URL(route, API_URL).toString();
  const isFormData = data instanceof FormData;
  const sessionToken = (await getSessionToken())?.trim() || null;

  const headers: Record<string, string> = {};
  if (!isFormData && data !== undefined && data !== null) {
    headers["Content-Type"] = "application/json";
  }
  if (sessionToken) {
    headers["x-session-token"] = sessionToken;
    headers["Authorization"] = `Bearer ${sessionToken}`;
  }

  const timeoutMs = options?.timeoutMs ?? 120_000;
  const retries = options?.retries ?? 2;

  return robustFetch(
    url,
    {
      method,
      headers,
      body:
        isFormData ? (data as FormData) : data !== undefined && data !== null
          ? JSON.stringify(data)
          : undefined,
      timeoutMs,
    },
    { retries },
  );
}
