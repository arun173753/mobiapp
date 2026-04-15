import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import type { DirectoryMapProps, MapMarkerData, MapLatLngBoundsLiteral } from './DirectoryMap';
import { loadGoogleMaps, resolveGoogleMapsMapConstructor } from '@/src/utils/googleMapsLoader';

export type { MapMarkerData, MapLatLngBoundsLiteral };

const MAX_MARKERS = 150;
const IDLE_DEBOUNCE_MS = 400;
const INDIA = { lat: 20.5937, lng: 78.9629 };
const PLACEHOLDER_MAPS_KEY = 'YOUR_GOOGLE_MAPS_API_KEY_HERE';

function isUnusableGoogleMapsKey(k: string) {
  const t = String(k || '').trim();
  return !t || t.includes(PLACEHOLDER_MAPS_KEY);
}

/*
 * Bounds-based loading (e.g. Firestore): pass `onMapBoundsChange` from the parent.
 * Example (simplified — production apps often use geohash or a geoquery library):
 *
 *   onMapBoundsChange={(b, zoom) => {
 *     const q = query(
 *       collection(db, 'profiles'),
 *       where('lat', '>=', b.south),
 *       where('lat', '<=', b.north),
 *     );
 *     getDocs(q).then((snap) => { ... merge into markers state, cap at 150 ... });
 *   }}
 */

function pointInBounds(lat: number, lng: number, bounds: google.maps.LatLngBounds): boolean {
  const maps = typeof window !== 'undefined' ? window.google?.maps : undefined;
  if (!maps) return false;
  return bounds.contains(new maps.LatLng(lat, lng));
}

function toBoundsLiteral(bounds: google.maps.LatLngBounds): MapLatLngBoundsLiteral {
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  return {
    north: ne.lat(),
    east: ne.lng(),
    south: sw.lat(),
    west: sw.lng(),
  };
}

function getInitials(name: string) {
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

type AvatarIconCache = Map<string, Promise<string> | string>;
const avatarIconCache: AvatarIconCache = new Map();

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
        const size = 30;
        const ring = 3;
        const canvas = document.createElement('canvas');
        canvas.width = size + ring * 2;
        canvas.height = size + ring * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No canvas context'));
          return;
        }

        // Ring
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2, (size / 2) + ring, 0, Math.PI * 2);
        ctx.fillStyle = ringColor;
        ctx.fill();

        // Clip circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        // Draw image cover
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

export default React.memo(function DirectoryMap({
  markers,
  onMarkerPress,
  onChatPress,
  onMapBoundsChange,
}: DirectoryMapProps) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const gMarkersRef = useRef<google.maps.Marker[]>([]);
  const markersPropRef = useRef<MapMarkerData[]>(markers);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulsePhaseRef = useRef(false);
  const onBoundsCbRef = useRef(onMapBoundsChange);
  onBoundsCbRef.current = onMapBoundsChange;

  const [selected, setSelected] = useState<MapMarkerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    const v = ex?.googleMapsWebMapId ? String(ex.googleMapsWebMapId).trim() : '';
    return v;
  }, []);

  useEffect(() => {
    markersPropRef.current = markers;
  }, [markers]);

  const disposeMarkers = useCallback(() => {
    gMarkersRef.current.forEach((m) => {
      try {
        const ev = typeof window !== 'undefined' ? window.google?.maps?.event : undefined;
        if (ev) {
          ev.clearInstanceListeners(m);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m as any).map = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m as any).setMap?.(null);
      } catch {
        /* ignore */
      }
    });
    gMarkersRef.current = [];
  }, []);

  /**
   * Step 1 (safe): always render markers directly on the map.
   * (No clustering yet — per request.)
   */
  const applyMarkers = useCallback(() => {
    const map = mapRef.current;
    const maps = typeof window !== 'undefined' ? window.google?.maps : undefined;
    if (!map || !maps) return;

    const bounds = map.getBounds();
    const zoom = map.getZoom() ?? 5;
    const source = markersPropRef.current;

    // `getBounds()` is often null on the first few frames / before tiles layout.
    // Previously we bailed out entirely, which meant zero markers forever on some web loads.
    let inView: MapMarkerData[];
    if (bounds) {
      onBoundsCbRef.current?.(toBoundsLiteral(bounds), zoom);
      inView = source.filter((m) => pointInBounds(m.latitude, m.longitude, bounds));
    } else {
      inView = source;
    }
    const capped = inView.slice(0, MAX_MARKERS);

    disposeMarkers();

    // Pulse phase (very lightweight): toggled by a single interval (see effect below).
    const pulse = pulsePhaseRef.current ? 1.3 : 1.0;

    const baseDotScale = zoom < 8 ? 3.6 : zoom < 11 ? 4.6 : 5.4;
    const markerScale = baseDotScale * pulse;
    const dotOpacity = pulsePhaseRef.current ? 0.65 : 1;

    const dotIcon = (color: string, scale: number): google.maps.Symbol => ({
      path: maps.SymbolPath.CIRCLE,
      fillColor: color,
      fillOpacity: dotOpacity,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      scale,
    });

    const newGMarkers: google.maps.Marker[] = capped.map((data) => {
      const isOnline = !!data.isOnline;
      const ringColor = isOnline ? '#10B981' : '#9CA3AF';

      const gm = new maps.Marker({
        position: { lat: data.latitude, lng: data.longitude },
        icon: dotIcon('#22C55E', markerScale), // lightweight green dots by default
        optimized: true,
        title: data.name,
        label:
          zoom >= 10 && zoom < 12
            ? {
                text: getInitials(data.name || ''),
                color: '#111827',
                fontSize: '10px',
                fontWeight: '700',
              }
            : undefined,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gm as any).__mobiKind = 'dot';
      gm.addListener('click', () => {
        try {
          map.panTo({ lat: data.latitude, lng: data.longitude });
          const z = map.getZoom() ?? 5;
          if (z < 12) map.setZoom(12);
        } catch {
          /* ignore */
        }
        setSelected(data);
      });
      gm.setMap(map);

      // Apply avatar icon async for zoomed-in.
      if (zoom >= 12) {
        const avatar = resolveAvatarUrl(data.avatar);
        if (avatar && typeof document !== 'undefined') {
          void getAvatarIconDataUrl(avatar, ringColor)
            .then((dataUrl) => {
              try {
                gm.setIcon({
                  url: dataUrl,
                  scaledSize: new maps.Size(36, 36),
                } as any);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (gm as any).__mobiKind = 'avatar';
              } catch {
                /* ignore */
              }
            })
            .catch(() => {});
        }
      }

      return gm;
    });

    gMarkersRef.current = newGMarkers;

    console.debug('[DirectoryMap.web] render', {
      markersTotal: source.length,
      markersRendered: capped.length,
      hasBounds: !!bounds,
      zoom,
    });
  }, [disposeMarkers]);

  const updatePulseIcons = useCallback(() => {
    const map = mapRef.current;
    const maps = typeof window !== 'undefined' ? window.google?.maps : undefined;
    if (!map || !maps) return;
    const zoom = map.getZoom() ?? 5;
    const pulse = pulsePhaseRef.current ? 1.3 : 1.0;
    const baseDotScale = zoom < 8 ? 3.6 : zoom < 11 ? 4.6 : 5.4;
    const markerScale = baseDotScale * pulse;
    const dotOpacity = pulsePhaseRef.current ? 0.65 : 1;
    const icon: google.maps.Symbol = {
      path: maps.SymbolPath.CIRCLE,
      fillColor: '#22C55E',
      fillOpacity: dotOpacity,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      scale: markerScale,
    };

    gMarkersRef.current.forEach((m) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kind = (m as any).__mobiKind;
      if (kind !== 'dot') return;
      try {
        m.setIcon(icon as any);
      } catch {
        /* ignore */
      }
    });
  }, []);

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
        'Set EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY in .env (Maps JavaScript API browser key; HTTP referrer restrictions must include this origin). Restart Metro after changing .env.',
      );
      setLoading(false);
      return;
    }
    const el = mapDivRef.current;
    if (!el) return;

    let cancelled = false;
    let dispose: (() => void) | null = null;
    const prevGmAuthFailure = (window as unknown as { gm_authFailure?: () => void }).gm_authFailure;

    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      try {
        prevGmAuthFailure?.();
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      setError(
        'Google Maps could not authenticate this site. In Google Cloud Console, add an HTTP referrer like https://arunmobi-app.web.app/* for this key, enable Maps JavaScript API, then hard refresh.',
      );
      setLoading(false);
    };

    (async () => {
      try {
        await loadGoogleMaps(apiKey);
        if (cancelled || !mapDivRef.current) return;

        const gmaps = window.google?.maps;
        console.log('[DirectoryMap.web] init map', {
          elHeight: mapDivRef.current.getBoundingClientRect().height,
          elWidth: mapDivRef.current.getBoundingClientRect().width,
          hasGoogle: !!window.google,
          hasMaps: !!gmaps,
          hasImportLibrary: !!(gmaps as any)?.importLibrary,
        });

        const mapOptions: google.maps.MapOptions = {
          center: INDIA,
          zoom: 5,
          gestureHandling: 'greedy',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        };
        if (mapId) (mapOptions as any).mapId = mapId;

        let map: google.maps.Map;
        try {
          const MapCtor = await resolveGoogleMapsMapConstructor();
          map = new MapCtor(mapDivRef.current, mapOptions);
        } catch (e) {
          const gm = window.google?.maps;
          console.error('[DirectoryMap.web] Map init failed', e, {
            hasGoogle: !!window.google,
            hasMaps: !!gm,
            hasImportLibrary: !!(gm as any)?.importLibrary,
            hasMapCtor: !!(gm as any)?.Map,
          });
          throw e;
        }
        mapRef.current = map;
        console.log('[DirectoryMap.web] Map initialized');

        map.addListener('idle', () => scheduleApply());
        map.addListener('zoom_changed', () => scheduleApply());
        map.addListener('click', () => setSelected(null));

        // Lightweight global pulse (single timer). Updates existing dot marker icons only.
        const pulseTimer = setInterval(() => {
          pulsePhaseRef.current = !pulsePhaseRef.current;
          updatePulseIcons();
        }, 900);

        setLoading(false);
        scheduleApply();
        // RN-web often sizes the map container after first paint; nudge Google Maps to recalc.
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
        dispose = () => {
          clearInterval(pulseTimer);
        };
      } catch {
        if (!cancelled) {
          setError('Map unavailable. Check EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY, Maps JavaScript API, and HTTP referrer restrictions, then rebuild.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = prevGmAuthFailure;
      try { dispose?.(); } catch {}
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      disposeMarkers();
      mapRef.current = null;
    };
  }, [apiKey, disposeMarkers, scheduleApply, updatePulseIcons]);

  useEffect(() => {
    if (!mapRef.current || loading) return;
    scheduleApply();
  }, [markers, loading, scheduleApply]);

  const requestMyLocation = useCallback(() => {
    if (!('geolocation' in navigator) || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const m = mapRef.current;
        if (!m) return;
        m.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        m.setZoom(12);
      },
      () => {},
      { enableHighAccuracy: true },
    );
  }, []);

  return (
    <View style={styles.container}>
      <View
        collapsable={false}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={mapDivRef as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({ id: 'mobi-directory-map' } as any)}
        style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
      />

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Loading map…</Text>
        </View>
      )}

      {!loading && !error && markers.length === 0 && (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>
            No map pins yet. Profiles need a saved latitude/longitude (and customers need location sharing on) to appear here.
          </Text>
        </View>
      )}

      {error && (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Pressable style={styles.locBtn} onPress={requestMyLocation}>
        <Ionicons name="locate" size={22} color="#333" />
      </Pressable>

      {selected && (
        <View style={[styles.card, styles.cardShow]}>
          <Pressable style={styles.closeBtn} onPress={() => setSelected(null)}>
            <Ionicons name="close" size={20} color="#888" />
          </Pressable>
          <View style={[styles.cardAvatar, { borderColor: selected.isOnline ? '#10B981' : '#9CA3AF' }]}>
            {resolveAvatarUrl(selected.avatar) ? (
              <Image
                source={{ uri: resolveAvatarUrl(selected.avatar) }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.cardAvatarFill, { backgroundColor: selected.color }]}>
                <Text style={styles.cardInitialsText}>{getInitials(selected.name)}</Text>
              </View>
            )}
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={1}>
              {selected.name}
            </Text>
            <Text style={[styles.cardRole, { color: selected.isOnline ? '#10B981' : '#6B7280' }]}>
              {selected.role || 'Technician'}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {[selected.city, selected.isOnline ? 'Online' : 'Offline', (selected.skills || []).slice(0, 2).join(', ')]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <View style={styles.cardActions}>
            <Pressable
              style={styles.btnProfile}
              onPress={() => {
                const id = selected.id;
                setSelected(null);
                onMarkerPress?.(id);
              }}
            >
              <Text style={styles.btnProfileText}>Profile</Text>
            </Pressable>
            <Pressable
              style={styles.btnChat}
              onPress={() => {
                const id = selected.id;
                setSelected(null);
                onChatPress?.(id);
              }}
            >
              <Text style={styles.btnChatText}>Chat</Text>
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
    ...(Platform.OS === 'web'
      ? ({
          width: '100%',
          // Critical: ensure the container has a real height on web.
          // If height collapses to 0, Google Maps will render a blank area.
          height: '100vh',
          minHeight: 420,
          alignSelf: 'stretch',
        } as Record<string, unknown>)
      : {}),
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
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
    top: 72,
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 12,
  },
  emptyWrap: {
    position: 'absolute',
    top: 88,
    left: 12,
    right: 12,
    zIndex: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  emptyText: { color: '#4B5563', fontSize: 13, lineHeight: 18 },
  errorText: { color: '#991B1B', fontSize: 13 },
  locBtn: {
    position: 'absolute',
    bottom: 88,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    zIndex: 20,
    boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
  } as any,
  card: {
    position: 'absolute',
    bottom: 56,
    left: 12,
    right: 12,
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    zIndex: 30,
    boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
    transform: [{ translateY: 24 }],
    opacity: 0,
  } as any,
  cardShow: {
    transform: [{ translateY: 0 }],
    opacity: 1,
    transitionProperty: 'transform, opacity',
    transitionDuration: '240ms',
    transitionTimingFunction: 'cubic-bezier(.2,.9,.2,1)',
  } as any,
  closeBtn: {
    position: 'absolute',
    top: 8,
    right: 10,
    zIndex: 1,
    padding: 4,
  },
  cardAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    overflow: 'hidden',
  },
  cardAvatarFill: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
  },
  cardInitialsText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  cardInfo: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  cardRole: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  cardMeta: { fontSize: 11, color: '#6B7280', marginTop: 4 },
  cardActions: { flexDirection: 'column', gap: 6 },
  btnProfile: {
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  btnProfileText: { fontSize: 12, fontWeight: '700', color: '#333' },
  btnChat: {
    backgroundColor: '#FF2D55',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  btnChatText: { fontSize: 12, fontWeight: '700', color: '#fff' },
});
