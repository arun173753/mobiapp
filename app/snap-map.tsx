import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { UserRole, ROLE_LABELS } from '@/lib/types';
import DirectoryMap from '@/components/DirectoryMap';
import { apiRequest } from '@/lib/query-client';
import { getCityCoords } from '@/lib/indian-cities';

const C = Colors.light;

const ROLE_COLORS: Record<string, string> = {
  technician: '#34C759',
  teacher: '#FFD60A',
  supplier: '#FF6B2C',
  job_provider: '#5856D6',
  customer: '#FF2D55',
};

type OnlineStats = Record<string, { registered: number; online: number }>;

function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  return ((hash & 0x7fffffff) % 1000) / 1000;
}

export default function SnapMapScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { allProfiles, profile, startConversation } = useApp();
  const [stats, setStats] = useState<OnlineStats | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [fetchedProfiles, setFetchedProfiles] = useState<any[]>([]);
  const statsLoaded = useRef(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await apiRequest('GET', '/api/stats/online');
        const data = await res.json();
        setStats(data);
        statsLoaded.current = true;
      } catch (e) {}
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!allProfiles || allProfiles.length === 0) {
      const fetchProfiles = async () => {
        try {
          const res = await apiRequest('GET', '/api/profiles');
          const data = await res.json();
          if (Array.isArray(data)) setFetchedProfiles(data);
        } catch (e) {}
      };
      fetchProfiles();
    }
  }, []);

  const profiles = allProfiles && allProfiles.length > 0 ? allProfiles : fetchedProfiles;

  const allMapProfiles = useMemo(() => {
    const now = Date.now();
    const THRESHOLD = 5 * 60 * 1000;
    const results: any[] = [];

    for (const p of profiles) {
      let lat = (p as any).latitude ? parseFloat((p as any).latitude) : NaN;
      let lng = (p as any).longitude ? parseFloat((p as any).longitude) : NaN;

      if (isNaN(lat) || isNaN(lng) || !lat || !lng) {
        const cityCoords = getCityCoords(p.city || '', (p as any).state || '');
        if (cityCoords) {
          const r1 = seededRandom(p.id + 'lat');
          const r2 = seededRandom(p.id + 'lng');
          lat = cityCoords.lat + (r1 - 0.5) * 0.05;
          lng = cityCoords.lng + (r2 - 0.5) * 0.05;
        } else {
          continue;
        }
      }

      results.push({
        id: p.id,
        latitude: lat,
        longitude: lng,
        name: p.name,
        role: ROLE_LABELS[p.role as UserRole] || p.role,
        roleKey: p.role,
        city: p.city || '',
        skills: Array.isArray(p.skills) ? p.skills : [],
        color: ROLE_COLORS[p.role] || '#007AFF',
        avatar: p.avatar || '',
        isOnline: !!(p as any).lastSeen && (now - (p as any).lastSeen) < THRESHOLD,
        lastSeen: (p as any).lastSeen || 0,
      });
    }

    return results;
  }, [profiles]);

  const mapProfiles = useMemo(() => {
    if (selectedRole === 'all') return allMapProfiles;
    return allMapProfiles.filter(p => p.roleKey === selectedRole);
  }, [allMapProfiles, selectedRole]);

  const handleMapChat = useCallback(async (id: string) => {
    const src = allProfiles && allProfiles.length > 0 ? allProfiles : fetchedProfiles;
    const p = src.find(pr => pr.id === id);
    if (p) {
      const convoId = await startConversation(p.id, p.name, p.role);
      if (convoId) router.push({ pathname: '/chat/[id]', params: { id: convoId } });
    }
  }, [allProfiles, fetchedProfiles, startConversation]);

  const totalOnline = stats ? Object.values(stats).reduce((sum, s) => sum + s.online, 0) : 0;

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of profiles) {
      counts[p.role] = (counts[p.role] || 0) + 1;
    }
    return counts;
  }, [profiles]);

  return (
    <View style={styles.container}>
      <View style={styles.mapContainer}>
        <DirectoryMap
          markers={mapProfiles}
          onMarkerPress={(id: string) => router.push({ pathname: '/user-profile', params: { id } })}
          onChatPress={handleMapChat}
        />
      </View>

      <View style={[styles.topBar, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]} pointerEvents="box-none">
        <Pressable style={styles.backBtn} onPress={() => {
          if (navigation.canGoBack()) {
            router.back();
          } else {
            router.replace('/');
          }
        }}>
          <Ionicons name="arrow-back" size={22} color="#333" />
        </Pressable>

        <View style={styles.titleArea}>
          <Text style={styles.titleText}>Mobi Map</Text>
          {totalOnline > 0 && (
            <View style={styles.liveTag}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{totalOnline} live</Text>
            </View>
          )}
        </View>

        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.rolePills, { top: (Platform.OS === 'web' ? webTopInset : insets.top) + 56 }]} pointerEvents="box-none">
        <RolePill label="All" color="#007AFF" selected={selectedRole === 'all'} count={mapProfiles.length} onPress={() => setSelectedRole('all')} />
        <RolePill label="Tech" color="#34C759" selected={selectedRole === 'technician'} count={roleCounts['technician'] || 0} onPress={() => setSelectedRole(selectedRole === 'technician' ? 'all' : 'technician')} />
        <RolePill label="Teacher" color="#FFD60A" selected={selectedRole === 'teacher'} count={roleCounts['teacher'] || 0} onPress={() => setSelectedRole(selectedRole === 'teacher' ? 'all' : 'teacher')} />
        <RolePill label="Supplier" color="#FF6B2C" selected={selectedRole === 'supplier'} count={roleCounts['supplier'] || 0} onPress={() => setSelectedRole(selectedRole === 'supplier' ? 'all' : 'supplier')} />
        <RolePill label="Customer" color="#FF2D55" selected={selectedRole === 'customer'} count={roleCounts['customer'] || 0} onPress={() => setSelectedRole(selectedRole === 'customer' ? 'all' : 'customer')} />
      </View>

      <View style={[styles.bottomInfo, { paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 12 }]} pointerEvents="none">
        <View style={styles.bottomStats}>
          <Ionicons name="people" size={16} color="#333" />
          <Text style={styles.bottomStatsText}>{mapProfiles.length} users on map</Text>
        </View>
      </View>
    </View>
  );
}

const RolePill = React.memo(function RolePill({ label, color, selected, count, onPress }: {
  label: string; color: string; selected: boolean; count: number; onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.pill,
        selected && { backgroundColor: color, borderColor: color },
      ]}
      onPress={onPress}
    >
      <View style={[styles.pillDot, { backgroundColor: selected ? '#FFF' : color }]} />
      <Text style={[styles.pillLabel, selected && { color: '#FFF' }]}>{label}</Text>
      {count > 0 && (
        <Text style={[styles.pillCount, selected && { color: 'rgba(255,255,255,0.8)' }]}>{count}</Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  mapContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 100,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 2px 12px rgba(0,0,0,0.15)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 },
    }),
  },
  titleArea: {
    alignItems: 'center',
  },
  titleText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1C1C1E',
    fontFamily: 'Inter_700Bold',
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    backgroundColor: 'rgba(52,199,89,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34C759',
  },
  liveText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#34C759',
  },
  rolePills: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 6,
    zIndex: 99,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.1)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
    }),
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  pillCount: {
    fontSize: 11,
    fontWeight: '700',
    color: '#999',
  },
  bottomInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 12,
    zIndex: 99,
  },
  bottomStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    ...Platform.select({
      web: { boxShadow: '0 2px 12px rgba(0,0,0,0.15)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 },
    }),
  },
  bottomStatsText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
});