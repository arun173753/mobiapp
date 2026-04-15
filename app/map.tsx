/**
 * Dedicated full-screen directory map (/map).
 * Stack route (outside tabs) — no bottom tab bar.
 *
 * Web: Maps JS is injected via `src/utils/googleMapsLoader.ts` (script + callback)
 * before any `google.maps` use. This file never touches `google`.
 * Native: `FullScreenTechnicianMap` → `react-native-maps` (no browser `google` global).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import FullScreenTechnicianMap from '@/components/FullScreenTechnicianMap';
import { useApp } from '@/lib/context';
import { ROLE_LABELS, UserRole } from '@/lib/types';

const DARK = '#111827';
const GRAY = '#6B7280';
const BG_TOP = 'rgba(255,255,255,0.96)';

const MAP_ROLES = new Set<UserRole>(['technician', 'teacher', 'supplier', 'shopkeeper']);

const ROLE_MAP_COLORS: Record<string, string> = {
  technician: '#22C55E',
  teacher: '#EAB308',
  supplier: '#2563EB',
  shopkeeper: '#EF4444',
  customer: '#FF2D55',
  job_provider: '#5E8BFF',
};

function parseCoord(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export default function FullScreenMapScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { allProfiles, profile, startConversation } = useApp();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatOpening, setChatOpening] = useState(false);

  const topPad = Platform.OS === 'web' ? 12 : insets.top + 8;

  useEffect(() => {
    console.log('[map] FullScreenMapScreen mounted (professionals with coordinates)');
  }, []);

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/directory');
    }
  }, [navigation]);

  const mapMarkers = useMemo(() => {
    const now = Date.now();
    const THR = 5 * 60 * 1000;
    const q = search.trim().toLowerCase();

    const list = allProfiles.filter((p) => MAP_ROLES.has(p.role as UserRole));

    return list
      .map((p) => {
        const lat = parseCoord((p as { latitude?: unknown }).latitude);
        const lng = parseCoord((p as { longitude?: unknown }).longitude);
        const isOnline = !!(p as { lastSeen?: number }).lastSeen && now - (p as { lastSeen: number }).lastSeen < THR;
        return {
          id: p.id,
          name: p.name || '',
          role: ROLE_LABELS[p.role] || p.role,
          roleKey: p.role,
          city: p.city || '',
          skills: Array.isArray(p.skills) ? p.skills : [],
          avatar: p.avatar || '',
          isOnline,
          lastSeen: 0,
          latitude: lat,
          longitude: lng,
          color: ROLE_MAP_COLORS[p.role] || '#22C55E',
        };
      })
      .filter((row) => {
        if (row.latitude == null || row.longitude == null || Number.isNaN(row.latitude) || Number.isNaN(row.longitude)) {
          return false;
        }
        if (!q) return true;
        return (
          row.name.toLowerCase().includes(q) ||
          row.city.toLowerCase().includes(q) ||
          row.skills.some((s) => typeof s === 'string' && s.toLowerCase().includes(q))
        );
      })
      .map((p) => ({
        id: p.id,
        latitude: p.latitude!,
        longitude: p.longitude!,
        name: p.name,
        role: p.role,
        roleKey: p.roleKey,
        city: p.city,
        skills: p.skills,
        color: p.color,
        avatar: p.avatar,
        isOnline: p.isOnline,
        lastSeen: p.lastSeen,
      }));
  }, [allProfiles, search]);

  const handleMapChat = useCallback(
    async (id: string) => {
      const p = allProfiles.find((x) => x.id === id);
      if (!p || p.id === profile?.id) {
        Alert.alert('Chat', 'You cannot start a chat with yourself.');
        throw new Error('Invalid recipient');
      }
      if (!profile) {
        Alert.alert('Chat', 'Please sign in to send messages.');
        throw new Error('Not signed in');
      }
      setChatOpening(true);
      try {
        const c = await startConversation(p.id, p.name, p.role as UserRole);
        if (!c) {
          throw new Error('Could not start conversation. Check your connection and try again.');
        }
        router.push({ pathname: '/chat/[id]', params: { id: c } });
      } finally {
        setChatOpening(false);
      }
    },
    [allProfiles, profile, startConversation],
  );

  const openProfile = useCallback(
    (id: string) => {
      const p = allProfiles.find((x) => x.id === id);
      if (p?.role === 'supplier' || p?.role === 'teacher' || p?.role === 'shopkeeper') {
        router.push({
          pathname: '/shop/[supplierId]',
          params: { supplierId: id, supplierName: p.name || '' },
        } as any);
      } else {
        router.push({ pathname: '/user-profile', params: { id } });
      }
    },
    [allProfiles],
  );

  return (
    <View style={[styles.root, Platform.OS === 'web' && styles.rootWeb]}>
      <FullScreenTechnicianMap
        markers={mapMarkers}
        onMarkerPress={openProfile}
        onChatPress={handleMapChat}
        isChatOpening={chatOpening}
        onMapBoundsChange={(b, z) => {
          if (__DEV__) console.log('[map] bounds', b, 'zoom', z, 'markers', mapMarkers.length);
        }}
      />

      <View style={[styles.chrome, { paddingTop: topPad }]} pointerEvents="box-none">
        <View style={styles.chromeTopRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={goBack}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={22} color={DARK} />
          </Pressable>
          {!searchOpen ? (
            <Pressable
              style={styles.searchChip}
              onPress={() => setSearchOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Open search"
            >
              <Ionicons name="search" size={18} color={GRAY} />
              <Text style={styles.searchChipText} numberOfLines={1}>
                Search technicians, teachers, suppliers…
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.doneSearchBtn}
              onPress={() => setSearchOpen(false)}
              hitSlop={8}
            >
              <Text style={styles.doneSearchTxt}>Done</Text>
            </Pressable>
          )}
        </View>
        {searchOpen && (
          <View style={styles.searchRow}>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color={GRAY} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name, city, or skill…"
                placeholderTextColor={GRAY}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={GRAY} />
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>

      {__DEV__ && (
        <View style={styles.debugPill} pointerEvents="none">
          <Text style={styles.debugText}>
            markers {mapMarkers.length} · mappable roles in context{' '}
            {allProfiles.filter((p) => MAP_ROLES.has(p.role as UserRole)).length}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#E5E7EB',
    margin: 0,
    padding: 0,
  },
  rootWeb: {
    width: '100%',
    height: '100vh',
    minHeight: '100vh',
    maxHeight: '100vh',
    overflow: 'hidden',
  } as Record<string, unknown>,
  chrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 60,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: BG_TOP,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
    gap: 8,
  },
  chromeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
  } as any,
  searchChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  searchChipText: {
    flex: 1,
    fontSize: 14,
    color: GRAY,
    fontWeight: '500',
  },
  doneSearchBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#E5E7EB',
  },
  doneSearchTxt: { fontSize: 14, fontWeight: '700', color: DARK },
  searchRow: {
    width: '100%',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: DARK,
    padding: 0,
    outlineStyle: 'none',
  } as any,
  debugPill: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    zIndex: 55,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  debugText: { color: '#FFF', fontSize: 11, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
});
