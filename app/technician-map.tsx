import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { apiRequest } from '@/lib/query-client';
import { useApp } from '@/lib/context';
import { ROLE_LABELS, UserRole } from '@/lib/types';
import { normalizeRole } from '@/lib/map-helpers';
import TechMap from '@/components/TechMap';

const PRIMARY = '#FF6B2C';
const BG = '#F5F5F5';
const CARD = '#FFFFFF';
const BORDER = '#E8E8E8';
const FORE = '#1A1A1A';
const MUTED = '#888888';
const SUCCESS = '#34C759';

const RADIUS_KM = 20;
const POLL_INTERVAL_MS = 30000;
const LOCATION_TIMEOUT_MS = 15000;
const PRECISE_ACCURACY_METERS = 100;
const FALLBACK_LOCATION = { latitude: 17.3850, longitude: 78.4867 };

function isPreciseLocation(loc: Location.LocationObject | null) {
  const accuracy = loc?.coords?.accuracy;
  return typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy <= PRECISE_ACCURACY_METERS;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Location timeout')), timeoutMs)),
  ]);
}

export default function TechnicianMapScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const { role: roleParam } = useLocalSearchParams<{ role?: string }>();
  const providerRole = normalizeRole(roleParam || 'technician') || 'technician';
  const roleLabel = ROLE_LABELS[providerRole as UserRole] || 'Technician';
  const roleLabelPlural = `${roleLabel}s`;
  const [customerLocation, setCustomerLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [techs, setTechs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [distanceReliable, setDistanceReliable] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const latRef = useRef<number>(FALLBACK_LOCATION.latitude);
  const lngRef = useRef<number>(FALLBACK_LOCATION.longitude);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const botInset = Platform.OS === 'web' ? 34 : insets.bottom;

  const fetchNearbyTechs = useCallback(async (lat: number, lng: number) => {
    try {
      const res = await apiRequest(
        'GET',
        `/api/providers/nearby?lat=${lat}&lng=${lng}&radius=${RADIUS_KM}&role=${encodeURIComponent(providerRole)}`,
      );
      const data = await res.json();
      setTechs(Array.isArray(data) ? data : (data.technicians ?? []));
      setLastRefreshed(new Date());
    } catch (err) {
      console.error('[TechMap] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [providerRole]);

  useEffect(() => {
    let mounted = true;

    const initLocation = async () => {
      try {
        if (Platform.OS === 'web') {
          // Use browser geolocation API on web (works on mobile browsers too)
          if (typeof navigator !== 'undefined' && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                if (!mounted) return;
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const precise = typeof pos.coords.accuracy === 'number' && pos.coords.accuracy <= PRECISE_ACCURACY_METERS;
                latRef.current = lat;
                lngRef.current = lng;
                setCustomerLocation({ coords: { latitude: lat, longitude: lng, altitude: null, accuracy: pos.coords.accuracy, altitudeAccuracy: null, heading: null, speed: null }, timestamp: pos.timestamp } as any);
                setDistanceReliable(precise);
                setErrorMsg(precise ? null : 'Location is approximate. Enable precise location for correct distance.');
                fetchNearbyTechs(lat, lng);
              },
              () => {
                if (!mounted) return;
                setErrorMsg('Location access denied. Showing nearby providers near Hyderabad.');
                setLocationDenied(true);
                setDistanceReliable(false);
                fetchNearbyTechs(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
              },
              { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 }
            );
          } else {
            setErrorMsg('Could not read GPS. Showing nearby providers near Hyderabad.');
            setDistanceReliable(false);
            fetchNearbyTechs(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
          }
          return;
        }
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setErrorMsg('Location permission denied. Showing nearby providers near Hyderabad.');
          setLocationDenied(true);
          setDistanceReliable(false);
          fetchNearbyTechs(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
          return;
        }

        if (Platform.OS === 'android') {
          try {
            await Location.enableNetworkProviderAsync();
          } catch {
            setErrorMsg('Turn on GPS / High accuracy location for correct technician distance.');
          }
        }

        let loc;
        try {
          loc = await withTimeout(
            Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.BestForNavigation,
              mayShowUserSettingsDialog: true,
            } as Location.LocationOptions),
            LOCATION_TIMEOUT_MS,
          );
        } catch (e) {
          console.warn('[TechMap] High accuracy location timed out or failed:', e);
          loc = null;
        }

        if (!mounted) return;

        if (loc) {
          const precise = isPreciseLocation(loc);
          setCustomerLocation(loc);
          setDistanceReliable(precise);
          setLocationDenied(false);
          setErrorMsg(precise ? null : 'Approximate location detected. Select “Precise” in Android location permission for correct distance.');
          latRef.current = loc.coords.latitude;
          lngRef.current = loc.coords.longitude;
          fetchNearbyTechs(loc.coords.latitude, loc.coords.longitude);
        } else {
          setDistanceReliable(false);
          setErrorMsg('Could not get GPS location after 15 seconds. Showing nearby providers near Hyderabad.');
          fetchNearbyTechs(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
        }

        try {
          locationSubRef.current = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.BestForNavigation,
              distanceInterval: 10,
              timeInterval: 5000,
              mayShowUserSettingsDialog: true,
            } as Location.LocationOptions,
            (pos) => {
              if (!mounted) return;
              const precise = isPreciseLocation(pos);
              setCustomerLocation(pos);
              setDistanceReliable(precise);
              setErrorMsg(precise ? null : 'Approximate location detected. Select “Precise” in Android location permission for correct distance.');
              latRef.current = pos.coords.latitude;
              lngRef.current = pos.coords.longitude;
              if (precise) {
                fetchNearbyTechs(pos.coords.latitude, pos.coords.longitude);
              }
            }
          );
        } catch (watchErr) {
          console.warn('[TechMap] Could not start location watch:', watchErr);
        }
      } catch (e) {
        if (!mounted) return;
        setDistanceReliable(false);
        setErrorMsg('Could not get GPS location. Showing nearby providers near Hyderabad.');
        fetchNearbyTechs(FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude);
      }
    };

    initLocation();

    pollTimerRef.current = setInterval(() => {
      fetchNearbyTechs(latRef.current, lngRef.current);
    }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (locationSubRef.current) locationSubRef.current.remove();
    };
  }, [fetchNearbyTechs]);

  const handleOpenTechProfile = useCallback((tech: any) => {
    if (!profile) {
      router.push('/onboarding' as any);
      return;
    }
    if (!tech?.id) return;
    router.push({ pathname: '/user-profile', params: { id: String(tech.id) } });
  }, [profile]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    fetchNearbyTechs(latRef.current, lngRef.current);
  }, [fetchNearbyTechs]);

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={FORE} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Nearby {roleLabelPlural}</Text>
          {lastRefreshed && (
            <Text style={styles.headerSub}>
              {techs.length} within {RADIUS_KM} km
            </Text>
          )}
        </View>
        <Pressable style={styles.refreshBtn} onPress={handleRefresh} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color={PRIMARY} />
            : <Ionicons name="refresh" size={22} color={PRIMARY} />
          }
        </Pressable>
      </View>

      {locationDenied && (
        <Pressable
          style={styles.locationBanner}
          onPress={() => {
            if (Platform.OS === 'web') {
              Alert.alert(
                'Enable Location',
                'To see technicians near you, allow location access in your browser settings for this site, then refresh the page.',
                [{ text: 'OK' }]
              );
            } else {
              Linking.openSettings();
            }
          }}
        >
          <Ionicons name="location-outline" size={16} color="#fff" />
          <Text style={styles.locationBannerTxt}>
            {Platform.OS === 'web' ? 'Allow location in browser to find technicians near you' : 'Tap to enable location in Settings'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </Pressable>
      )}

      {loading && techs.length === 0 ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={styles.loadingTxt}>Finding {roleLabelPlural.toLowerCase()} near you...</Text>
          <Text style={styles.loadingSubTxt}>Searching within {RADIUS_KM} km radius</Text>
        </View>
      ) : (
        <TechMap
          techs={techs}
          location={customerLocation}
          loading={loading}
          errorMsg={locationDenied ? null : errorMsg}
          distanceReliable={distanceReliable}
          bottomInset={botInset}
          onProfilePress={handleOpenTechProfile}
          providerRoleLabel={roleLabel}
          providerRoleLabelPlural={roleLabelPlural}
          radiusKm={RADIUS_KM}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER,
    gap: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: FORE },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  refreshBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingTxt: { fontSize: 15, fontFamily: 'Inter_500Medium', color: FORE },
  loadingSubTxt: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  locationBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1A73E8',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  locationBannerTxt: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: '#fff' },
});
