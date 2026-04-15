/**
 * Web-only: load Google Maps JavaScript API via a direct <script> tag + callback
 * (same mechanism as Google's docs). Does NOT use @googlemaps/js-api-loader.
 *
 * Set EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY (Maps JavaScript API + HTTP referrer restrictions).
 */
const PLACEHOLDER = "YOUR_GOOGLE_MAPS_API_KEY_HERE";

function isPlaceholderKey(k: string): boolean {
  const t = String(k || "").trim();
  return !t || t.includes(PLACEHOLDER);
}

function getGoogleGlobal(): typeof google | undefined {
  if (typeof globalThis === "undefined") return undefined;
  return (globalThis as unknown as { google?: typeof google }).google;
}

/** Maps JavaScript API browser key — Expo inlines EXPO_PUBLIC_* at build. */
export function readExpoPublicGoogleMapsWebApiKey(): string {
  if (typeof process === "undefined") return "";
  return String(
    (process.env as Record<string, string | undefined>).EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ?? "",
  ).trim();
}

/** @deprecated use readExpoPublicGoogleMapsWebApiKey */
export function readGoogleMapsApiKeyFromEnv(): string {
  return readExpoPublicGoogleMapsWebApiKey();
}

const loaders = new Map<string, Promise<typeof google>>();

function attachGmAuthFailureHandler(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { gm_authFailure?: () => void };
  const prev = w.gm_authFailure;
  w.gm_authFailure = () => {
    try {
      prev?.();
    } catch {
      /* ignore */
    }
    console.error(
      "[GoogleMaps] gm_authFailure — key/API/referrer issue. Enable Maps JavaScript API, set HTTP referrers (e.g. https://arunmobi-app.web.app/*), billing enabled.",
    );
  };
}

function waitForMapsReady(timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const maps = getGoogleGlobal()?.maps as { Map?: unknown; importLibrary?: (s: string) => Promise<unknown> } | undefined;
      if (maps && (maps.Map || typeof maps.importLibrary === "function")) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Timed out waiting for google.maps after script callback"));
        return;
      }
      setTimeout(tick, 30);
    };
    tick();
  });
}

/**
 * Injects https://maps.googleapis.com/maps/api/js?key=...&libraries=places,marker&callback=...
 * Resolves when `google` / `google.maps` is usable.
 */
export function loadGoogleMaps(apiKey?: string): Promise<typeof google> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps: window is undefined"));
  }

  if (typeof process !== "undefined") {
    // Verifies Metro/Expo inlined EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY at bundle time (web debug).
    console.log("MAP KEY:", process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY);
  }

  const key = (apiKey ?? readExpoPublicGoogleMapsWebApiKey()).trim();
  if (!key || isPlaceholderKey(key)) {
    const err = new Error(
      "Google Maps API key missing: set EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY in .env (browser key with HTTP referrer restrictions).",
    );
    console.error("[GoogleMaps]", err.message);
    return Promise.reject(err);
  }

  const cached = loaders.get(key);
  if (cached) return cached;

  attachGmAuthFailureHandler();

  const promise = new Promise<typeof google>((resolve, reject) => {
    const existing = getGoogleGlobal();
    if (existing?.maps && ((existing.maps as { Map?: unknown }).Map || typeof (existing.maps as { importLibrary?: unknown }).importLibrary === "function")) {
      console.log("Maps API Loaded:", typeof existing, "(already on window)");
      resolve(existing);
      return;
    }

    const cbName = `mobiGmapsCb_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
    (window as unknown as Record<string, (() => void) | undefined>)[cbName] = () => {
      void (async () => {
        try {
          delete (window as unknown as Record<string, unknown>)[cbName];
        } catch {
          /* ignore */
        }
        try {
          await waitForMapsReady();
          const g = getGoogleGlobal();
          if (!g?.maps) {
            reject(new Error("Google Maps script ran but google.maps is missing"));
            return;
          }
          console.log("Maps API Loaded:", typeof g);
          resolve(g);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      })();
    };

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.setAttribute("data-mobi-maps-js", "1");
    const params = new URLSearchParams({
      key,
      v: "weekly",
      libraries: "places,marker",
      callback: cbName,
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.onerror = () => {
      try {
        delete (window as unknown as Record<string, unknown>)[cbName];
      } catch {
        /* ignore */
      }
      reject(new Error("Failed to load Google Maps script (network or blocked URL)"));
    };
    document.head.appendChild(script);
  });

  const tracked = promise.catch((err) => {
    loaders.delete(key);
    console.error("[GoogleMaps] Load failed:", err);
    throw err;
  });

  loaders.set(key, tracked);
  return tracked;
}

/** Prefer `importLibrary('maps')` when available; else wait for global `Map`. */
export async function resolveGoogleMapsMapConstructor(): Promise<any> {
  const g = getGoogleGlobal()?.maps as any;
  if (!g) {
    throw new Error("google.maps not available — await loadGoogleMaps() first");
  }

  if (typeof g.importLibrary === "function") {
    try {
      const lib = await g.importLibrary("maps");
      if (lib?.Map) return lib.Map;
    } catch (e) {
      console.warn("[googleMapsLoader] importLibrary('maps') failed, using global Map", e);
    }
  }

  const start = Date.now();
  const timeoutMs = 15000;
  while (Date.now() - start < timeoutMs) {
    if (g.Map) return g.Map;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for google.maps.Map");
}
