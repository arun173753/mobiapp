/**
 * Full-screen technician map (web / Google Maps JS).
 *
 * Zoom tiers (per product spec):
 * - zoom < 8: tiny green dots with pure CSS pulse (OverlayView — classic Marker icons cannot use CSS).
 * - zoom 8–13: lightweight google.maps.Marker circles + optional 1–2 letter initials (no images).
 * - zoom >= 14: circular profile photo (~36px) with green/gray ring; opens bottom sheet on tap.
 *
 * Lifecycle: single `gMarkers` array + `pulseOverlays` array. Before each redraw we call
 * setMap(null) on every overlay/marker and clear clusterer when used. Updates are debounced
 * on `idle` + `zoom_changed` to avoid flicker.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import type { DirectoryMapProps, MapMarkerData, MapLatLngBoundsLiteral } from './DirectoryMap';
import {
  loadGoogleMaps,
  resolveGoogleMapsMapConstructor,
} from '@/src/utils/googleMapsLoader';

const MAX_MARKERS = 150;
const IDLE_DEBOUNCE_MS = 400;
const INDIA = { lat: 20.5937, lng: 78.9629 };
const PLACEHOLDER_MAPS_KEY = 'YOUR_GOOGLE_MAPS_API_KEY_HERE';

const ZOOM_DOT = 8;
const ZOOM_AVATAR = 14;

/** Role-based marker colors (blink / dots / legend). */
function markerFillFor(data: MapMarkerData): string {
  const k = String(data.roleKey || '').toLowerCase();
  if (data.color && /^#/.test(data.color)) return data.color;
  if (k === 'technician') return '#22C55E';
  if (k === 'supplier') return '#2563EB';
  if (k === 'teacher') return '#EAB308';
  if (k === 'shopkeeper') return '#EF4444';
  return '#22C55E';
}

function isUnusableGoogleMapsKey(k: string) {
  const t = String(k || '').trim();
  return !t || t.includes(PLACEHOLDER_MAPS_KEY);
}

function pointInBounds(lat: number, lng: number, bounds: google.maps.LatLngBounds): boolean {
  const maps = typeof window !== 'undefined' ? window.google?.maps : undefined;
  if (!maps) return false;
  return bounds.contains(new maps.LatLng(lat, lng));
}

function toBoundsLiteral(bounds: google.maps.LatLngBounds): MapLatLngBoundsLiteral {
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  return { north: ne.lat(), east: ne.lng(), south: sw.lat(), west: sw.lng() };
}

function getInitials(name: string) {
  if (!name) return '';
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

function resolveAvatarUrl(raw: string | undefined) {
  if (!raw) return '';
  const u = String(raw).trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  const extra = Constants.expoConfig?.extra as { publicApiUrl?: string } | undefined;
  const base = (extra?.publicApiUrl || '').replace(/\/+$/, '');
  if (!base) return u;
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
}

/** Injected once: CSS keyframes run on OverlayView dots (zoom < 8). */
function ensurePulseKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('mobi-fs-technician-map-pulse')) return;
  const st = document.createElement('style');
  st.id = 'mobi-fs-technician-map-pulse';
  st.textContent = `
@keyframes mobiFsTechnicianPulse {
  0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  50% { transform: translate(-50%, -50%) scale(1.3); opacity: 0.6; }
}
.mobi-fs-technician-pulse-dot {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
  animation: mobiFsTechnicianPulse 1.4s ease-in-out infinite;
  pointer-events: auto;
  cursor: pointer;
  z-index: 1;
}
`;
  document.head.appendChild(st);
}

/**
 * OverlayView for low-zoom pulse dots — must be created only after `loadGoogleMaps()` (never extend `google.maps` at module scope).
 */
function createPulseDotOverlayClass(g: typeof google) {
  class PulseDotOverlay extends g.maps.OverlayView {
    private readonly latLng: google.maps.LatLng;
    private div: HTMLDivElement | null = null;
    private readonly onTap: () => void;
    private readonly dotColor: string;

    constructor(lat: number, lng: number, onTap: () => void, dotColor: string) {
      super();
      this.latLng = new g.maps.LatLng(lat, lng);
      this.onTap = onTap;
      this.dotColor = dotColor;
    }

    onAdd(): void {
      ensurePulseKeyframes();
      const div = document.createElement('div');
      div.className = 'mobi-fs-technician-pulse-dot';
      div.style.background = this.dotColor;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onTap();
      });
      this.div = div;
      const panes = this.getPanes();
      panes?.overlayMouseTarget.appendChild(div);
    }

    draw(): void {
      if (!this.div) return;
      const projection = this.getProjection();
      if (!projection) return;
      const pt = projection.fromLatLngToDivPixel(this.latLng);
      if (!pt) return;
      this.div.style.left = `${Math.round(pt.x)}px`;
      this.div.style.top = `${Math.round(pt.y)}px`;
    }

    onRemove(): void {
      if (this.div?.parentElement) {
        this.div.parentElement.removeChild(this.div);
      }
      this.div = null;
    }
  }
  return PulseDotOverlay;
}

type AvatarIconCache = Map<string, Promise<string> | string>;
const avatarIconCache: AvatarIconCache = new Map();

/** Canvas-based circular icon — only called when zoom >= ZOOM_AVATAR (no network until then). */
function getAvatarIconDataUrl(avatarUrl: string, ringColor: string) {
  const key = `${avatarUrl}__${ringColor}`;
  const cached = avatarIconCache.get(key);
  if (typeof cached === 'string') return Promise.resolve(cached);
  if (cached) return cached as Promise<string>;

  const p = new Promise<string>((resolve, reject) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const size = 34;
        const ring = 3;
        const canvas = document.createElement('canvas');
        canvas.width = size + ring * 2;
        canvas.height = size + ring * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No canvas context'));
          return;
        }
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2, (size / 2) + ring, 0, Math.PI * 2);
        ctx.fillStyle = ringColor;
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, ring, ring, size, size);
        ctx.restore();
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Avatar load failed'));
      img.src = avatarUrl;
    } catch (e) {
      reject(e as Error);
    }
  });

  avatarIconCache.set(key, p);
  void p.then((dataUrl) => avatarIconCache.set(key, dataUrl)).catch(() => avatarIconCache.delete(key));
  return p;
}

export default React.memo(function FullScreenTechnicianMap({
  markers,
  onMarkerPress,
  onChatPress,
  onMapBoundsChange,
}: DirectoryMapProps) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const gMarkersRef = useRef<google.maps.Marker[]>([]);
  const overlaysRef = useRef<google.maps.OverlayView[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const userLocMarkerRef = useRef<google.maps.Marker | null>(null);
  const pulseCtorRef = useRef<ReturnType<typeof createPulseDotOverlayClass> | null>(null);
  const markersPropRef = useRef<MapMarkerData[]>(markers);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBoundsCbRef = useRef(onMapBoundsChange);
  onBoundsCbRef.current = onMapBoundsChange;

  const [selected, setSelected] = useState<MapMarkerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);

  const apiKey = useMemo(() => {
    const ex = Constants.expoConfig?.extra as { googleMapsWebApiKey?: string } | undefined;
    const candidates = [
      ex?.googleMapsWebApiKey,
      typeof process !== 'undefined' ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY : '',
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      if (!isUnusableGoogleMapsKey(c)) return String(c).trim();
    }
    return '';
  }, []);

  const mapId = useMemo(() => {
    const ex = Constants.expoConfig?.extra as { googleMapsWebMapId?: string } | undefined;
    return ex?.googleMapsWebMapId ? String(ex.googleMapsWebMapId).trim() : '';
  }, []);

  useEffect(() => {
    markersPropRef.current = markers;
  }, [markers]);

  const disposeAll = useCallback(() => {
    if (clustererRef.current) {
      try {
        clustererRef.current.clearMarkers();
      } catch {
        /* ignore */
      }
      clustererRef.current = null;
    }

    overlaysRef.current.forEach((o) => {
      try {
        o.setMap(null);
      } catch {
        /* ignore */
      }
    });
    overlaysRef.current = [];

    gMarkersRef.current.forEach((m) => {
      try {
        const ev = typeof window !== 'undefined' ? window.google?.maps?.event : undefined;
        if (ev) {
          ev.clearInstanceListeners(m);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m as any).setMap?.(null);
      } catch {
        /* ignore */
      }
    });
    gMarkersRef.current = [];
  }, []);

  const handleMarkerOpen = useCallback((map: google.maps.Map, data: MapMarkerData) => {
    try {
      map.panTo({ lat: data.latitude, lng: data.longitude });
      const z = map.getZoom() ?? 5;
      // Slight zoom-in only (Uber-style); avatar icons appear naturally once user crosses zoom14.
      map.setZoom(Math.min(z + 1, 17));
    } catch {
      /* ignore */
    }
    setSelected(data);
  }, []);

  /**
   * Core redraw: bounds-filter, cap count, dedupe by id, then branch on zoom tier.
   */
  const applyMarkers = useCallback(() => {
    const map = mapRef.current;
    const maps = typeof window !== 'undefined' ? window.google?.maps : undefined;
    if (!map || !maps) return;

    const bounds = map.getBounds();
    const zoom = map.getZoom() ?? 5;
    const source = markersPropRef.current;

    if (bounds) {
      onBoundsCbRef.current?.(toBoundsLiteral(bounds), zoom);
    }

    const seen = new Set<string>();
    let inView: MapMarkerData[] = [];
    for (const m of source) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      if (bounds && !pointInBounds(m.latitude, m.longitude, bounds)) continue;
      inView.push(m);
    }
    inView = inView.slice(0, MAX_MARKERS);

    disposeAll();

    let tier: 'pulse' | 'mid' | 'avatar';
    if (zoom < ZOOM_DOT) tier = 'pulse';
    else if (zoom < ZOOM_AVATAR) tier = 'mid';
    else tier = 'avatar';

    console.log('[FullScreenTechnicianMap.web] applyMarkers', {
      tier,
      zoom,
      total: source.length,
      rendered: inView.length,
      hasBounds: !!bounds,
    });

    if (tier === 'pulse') {
      const PulseCtor = pulseCtorRef.current;
      if (!PulseCtor) return;
      inView.forEach((data) => {
        const fill = markerFillFor(data);
        const ov = new PulseCtor(data.latitude, data.longitude, () => handleMarkerOpen(map, data), fill);
        ov.setMap(map);
        overlaysRef.current.push(ov);
      });
      return;
    }

    const dotIcon = (scale: number, withLabel: boolean, data: MapMarkerData): google.maps.MarkerOptions => {
      const fill = markerFillFor(data);
      const base: google.maps.MarkerOptions = {
        position: { lat: data.latitude, lng: data.longitude },
        optimized: true,
        title: data.name,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          fillColor: fill,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          scale,
        } as google.maps.Symbol,
      };
      if (withLabel) {
        const initials = getInitials(data.name || '');
        if (initials) {
          base.label = {
            text: initials,
            color: '#111827',
            fontSize: '9px',
            fontWeight: '700',
          };
        }
      }
      return base;
    };

    if (tier === 'mid') {
      const newMarkers: google.maps.Marker[] = inView.map((data) => {
        const opts = dotIcon(5.2, true, data);
        const gm = new maps.Marker({ ...opts, map: undefined } as google.maps.MarkerOptions);
        gm.addListener('click', () => handleMarkerOpen(map, data));
        return gm;
      });
      gMarkersRef.current = newMarkers;
      clustererRef.current = new MarkerClusterer({ map, markers: newMarkers });
      return;
    }

    const newMarkers: google.maps.Marker[] = inView.map((data) => {
      const opts = dotIcon(5, false, data);
      const gm = new maps.Marker(opts);
      gm.addListener('click', () => handleMarkerOpen(map, data));
      gm.setMap(map);

      const avatar = resolveAvatarUrl(data.avatar);
      const ringColor = data.isOnline ? '#10B981' : '#9CA3AF';
      if (avatar) {
        void getAvatarIconDataUrl(avatar, ringColor)
          .then((dataUrl) => {
            try {
              gm.setIcon({
                url: dataUrl,
                scaledSize: new maps.Size(40, 40),
              } as google.maps.Icon);
            } catch {
              /* ignore */
            }
          })
          .catch(() => {});
      }

      return gm;
    });

    gMarkersRef.current = newMarkers;
  }, [disposeAll, handleMarkerOpen]);

  const scheduleApply = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      requestAnimationFrame(() => applyMarkers());
    }, IDLE_DEBOUNCE_MS);
  }, [applyMarkers]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;
    if (!apiKey) {
      setError(
        'Set EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY (Maps JavaScript API browser key). Restart Metro after .env changes.',
      );
      setLoading(false);
      return;
    }
    const el = mapDivRef.current;
    if (!el) return;

    let cancelled = false;
    let prevGmAuthFailure = (window as unknown as { gm_authFailure?: () => void }).gm_authFailure;

    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      try {
        prevGmAuthFailure?.();
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      setError(
        'Google Maps could not authenticate. Check API key HTTP referrers and Maps JavaScript API.',
      );
      setLoading(false);
    };

    (async () => {
      try {
        const g = await loadGoogleMaps(apiKey);
        if (cancelled || !mapDivRef.current) return;
        pulseCtorRef.current = createPulseDotOverlayClass(g);

        const mapOptions: google.maps.MapOptions = {
          center: INDIA,
          zoom: 5,
          gestureHandling: 'greedy',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        };
        if (mapId) (mapOptions as google.maps.MapOptions & { mapId?: string }).mapId = mapId;

        const MapCtor = await resolveGoogleMapsMapConstructor();
        const map = new MapCtor(mapDivRef.current, mapOptions);
        mapRef.current = map;
        console.log('[FullScreenTechnicianMap.web] map ready');

        map.addListener('idle', () => scheduleApply());
        map.addListener('zoom_changed', () => scheduleApply());
        map.addListener('click', () => setSelected(null));

        setLoading(false);
        scheduleApply();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const m = mapRef.current;
            const ev = window.google?.maps?.event;
            if (m && ev) {
              ev.trigger(m, 'resize');
              scheduleApply();
            }
          });
        });
      } catch (e) {
        console.error('[FullScreenTechnicianMap.web] init error', e);
        if (!cancelled) {
          setError('Map unavailable. Check EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY, Maps JavaScript API, and HTTP referrer restrictions, then rebuild.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = prevGmAuthFailure;
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      try {
        userLocMarkerRef.current?.setMap(null);
      } catch {
        /* ignore */
      }
      userLocMarkerRef.current = null;
      disposeAll();
      mapRef.current = null;
    };
  }, [apiKey, mapId, disposeAll, scheduleApply]);

  useEffect(() => {
    if (!mapRef.current || loading) return;
    scheduleApply();
  }, [markers, loading, scheduleApply]);

  const requestMyLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator) || !mapRef.current) {
      Alert.alert('Location', 'Geolocation is not available in this browser.');
      return;
    }
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const m = mapRef.current;
        const maps = window.google?.maps;
        if (!m || !maps) {
          setLocBusy(false);
          return;
        }
        m.panTo({ lat, lng });
        m.setZoom(14);
        try {
          if (userLocMarkerRef.current) {
            userLocMarkerRef.current.setPosition({ lat, lng });
          } else {
            userLocMarkerRef.current = new maps.Marker({
              map: m,
              position: { lat, lng },
              title: 'You are here',
              zIndex: 999999,
              icon: {
                path: maps.SymbolPath.CIRCLE,
                fillColor: '#2563EB',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 3,
                scale: 9,
              } as google.maps.Symbol,
            });
          }
        } catch {
          /* ignore */
        }
        setLocBusy(false);
      },
      (err) => {
        setLocBusy(false);
        Alert.alert('Location', err?.message || 'Could not read your position.');
      },
      { enableHighAccuracy: true, timeout: 22000, maximumAge: 0 },
    );
  }, []);

  return (
    <View style={styles.container}>
      <View
        // Google Maps JS needs a real DOM node; on web, View renders to a <div>.
        collapsable={false}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={mapDivRef as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({ id: 'mobi-fullscreen-map' } as any)}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          inset: 0,
          margin: 0,
          padding: 0,
        }}
      />

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Loading map…</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!loading && !error && (
        <Pressable
          style={[styles.locBtn, locBusy && { opacity: 0.75 }]}
          onPress={requestMyLocation}
          disabled={locBusy}
          accessibilityLabel="My location"
        >
          {locBusy ? (
            <ActivityIndicator size="small" color="#111827" />
          ) : (
            <Ionicons name="locate" size={22} color="#111827" />
          )}
        </Pressable>
      )}

      {selected && (
        <View style={[styles.sheet, styles.sheetVisible]} pointerEvents="box-none">
          <Pressable style={styles.sheetClose} onPress={() => setSelected(null)} hitSlop={12}>
            <Ionicons name="close" size={22} color="#6B7280" />
          </Pressable>
          <View style={styles.sheetRow}>
            <View style={[styles.sheetAvatar, { borderColor: selected.isOnline ? '#10B981' : '#9CA3AF' }]}>
              {resolveAvatarUrl(selected.avatar) ? (
                <Image
                  source={{ uri: resolveAvatarUrl(selected.avatar) }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.sheetAvatarFallback, { backgroundColor: selected.color }]}>
                  <Text style={styles.sheetAvatarInitials}>{getInitials(selected.name)}</Text>
                </View>
              )}
            </View>
            <View style={styles.sheetInfo}>
              <Text style={styles.sheetName} numberOfLines={1}>
                {selected.name}
              </Text>
              <Text style={[styles.sheetRole, { color: markerFillFor(selected) }]} numberOfLines={1}>
                {selected.role || selected.roleKey}
              </Text>
              <Text style={styles.sheetLocation} numberOfLines={2}>
                {[selected.city, selected.isOnline ? 'Online' : 'Offline'].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
          <View style={styles.sheetActions}>
            <Pressable
              style={styles.btnSecondary}
              onPress={() => {
                const id = selected.id;
                setSelected(null);
                onMarkerPress?.(id);
              }}
            >
              <Text style={styles.btnSecondaryText}>View Profile</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, chatBusy && { opacity: 0.75 }]}
              disabled={chatBusy}
              onPress={async () => {
                const id = selected.id;
                setChatBusy(true);
                try {
                  await onChatPress?.(id);
                  setSelected(null);
                } catch (e: any) {
                  Alert.alert('Chat', e?.message || 'Could not open chat.');
                } finally {
                  setChatBusy(false);
                }
              }}
            >
              {chatBusy ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="chatbubble-outline" size={18} color="#FFF" />
                  <Text style={styles.btnPrimaryText}>Chat</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web'
      ? ({
          width: '100%',
          height: '100vh',
          minHeight: '100vh',
          margin: 0,
          padding: 0,
          alignSelf: 'stretch',
        } as Record<string, unknown>)
      : {}),
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.65)',
    zIndex: 5,
    gap: 12,
  },
  loadingText: {
    marginTop: 4,
    fontSize: 14,
    color: '#374151',
    fontWeight: '600',
  },
  errorWrap: {
    position: 'absolute',
    top: 56,
    left: 12,
    right: 12,
    zIndex: 20,
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 12,
  },
  errorText: { color: '#991B1B', fontSize: 13 },
  locBtn: {
    position: 'absolute',
    bottom: 148,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    zIndex: 45,
    boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
  } as any,
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
    transform: [{ translateY: 220 }],
    opacity: 0,
  } as any,
  sheetVisible: {
    transform: [{ translateY: 0 }],
    opacity: 1,
    transitionProperty: 'transform, opacity',
    transitionDuration: '280ms',
    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
  } as any,
  sheetClose: {
    position: 'absolute',
    top: 10,
    right: 14,
    zIndex: 2,
    padding: 4,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    paddingRight: 32,
  },
  sheetAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    overflow: 'hidden',
  },
  sheetAvatarFallback: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetAvatarInitials: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  sheetInfo: { flex: 1, minWidth: 0 },
  sheetName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  sheetRole: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 2,
    letterSpacing: 0.4,
  },
  sheetLocation: { fontSize: 12, color: '#6B7280', marginTop: 4, lineHeight: 16 },
  sheetActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  btnSecondary: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: { fontSize: 13, fontWeight: '700', color: '#374151' },
  btnPrimary: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnPrimaryText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
});
