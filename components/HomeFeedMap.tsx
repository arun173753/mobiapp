import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { ROLE_LABELS, UserRole } from '@/lib/types';
import DirectoryMap from '@/components/DirectoryMap';
import { apiRequest } from '@/lib/query-client';

const C = Colors.dark;
const { width: SCREEN_W } = Dimensions.get('window');

const ROLE_COLORS: Record<string, string> = {
  technician: '#34C759',
  teacher: '#FFD60A',
  supplier: '#FF6B2C',
  job_provider: '#5856D6',
  customer: '#FF2D55',
};

const ONLINE_THRESHOLD = 5 * 60 * 1000;

type OnlineStats = Record<string, { registered: number; online: number }>;

const STAT_ROLES = [
  { key: 'technician', label: 'Technicians', short: 'Tech', icon: 'construct' as const, color: '#34C759' },
  { key: 'teacher', label: 'Teachers', short: 'Teach', icon: 'school' as const, color: '#FFD60A' },
  { key: 'supplier', label: 'Suppliers', short: 'Supply', icon: 'cube' as const, color: '#FF6B2C' },
  { key: 'customer', label: 'Customers', short: 'Cust', icon: 'person' as const, color: '#FF2D55' },
];

export default function HomeFeedMap() {
  const { allProfiles, startConversation } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [stats, setStats] = useState<OnlineStats | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await apiRequest('GET', '/api/stats/online');
        const data = await res.json();
        setStats(data);
      } catch (e) {}
    };
    fetch();
    const interval = setInterval(fetch, 10000);
    return () => clearInterval(interval);
  }, []);

  const mapMarkers = useMemo(() => {
    const now = Date.now();
    return allProfiles
      .filter(p => {
        const lat = (p as any).latitude ? parseFloat((p as any).latitude) : null;
        const lng = (p as any).longitude ? parseFloat((p as any).longitude) : null;
        if (!lat || !lng || isNaN(lat) || isNaN(lng)) return false;
        if (p.role === 'customer' && (p as any).locationSharing !== 'true') return false;
        return true;
      })
      .map(p => ({
        id: p.id,
        latitude: parseFloat((p as any).latitude),
        longitude: parseFloat((p as any).longitude),
        name: p.name,
        role: ROLE_LABELS[p.role as UserRole] || p.role,
        roleKey: p.role,
        city: p.city || '',
        skills: Array.isArray(p.skills) ? p.skills : [],
        color: ROLE_COLORS[p.role] || '#007AFF',
        avatar: p.avatar || '',
        isOnline: !!(p as any).lastSeen && (now - (p as any).lastSeen) < ONLINE_THRESHOLD,
        lastSeen: (p as any).lastSeen || 0,
      }));
  }, [allProfiles]);

  const handleChat = useCallback(async (id: string) => {
    const p = allProfiles.find(u => u.id === id);
    if (p) {
      const convoId = await startConversation(p.id, p.name, p.role);
      if (convoId) router.push({ pathname: '/chat/[id]', params: { id: convoId } });
    }
  }, [allProfiles, startConversation]);

  const handleProfile = useCallback((id: string) => {
    router.push({ pathname: '/user-profile', params: { id } });
  }, []);

  const totalOnline = stats ? Object.values(stats).reduce((sum, s) => sum + s.online, 0) : 0;
  const totalRegistered = stats ? Object.values(stats).reduce((sum, s) => sum + s.registered, 0) : 0;

  return (
    <View style={styles.wrapper}>
      <Pressable style={styles.titleBar} onPress={() => setExpanded(!expanded)}>
        <View style={styles.titleLeft}>
          <View style={styles.snapIcon}>
            <Ionicons name="location" size={18} color="#FFF" />
          </View>
          <View>
            <Text style={styles.snapTitle}>Snap Map</Text>
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{totalOnline} live now</Text>
            </View>
          </View>
        </View>
        <View style={styles.titleRight}>
          <View style={styles.totalBadge}>
            <Text style={styles.totalBadgeText}>{mapMarkers.length}</Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={C.textSecondary}
          />
        </View>
      </Pressable>

      {stats && (
        <View style={styles.statsRow}>
          {STAT_ROLES.map(r => {
            const s = stats[r.key];
            if (!s) return null;
            return (
              <View key={r.key} style={styles.statPill}>
                <View style={[styles.statPillDot, { backgroundColor: r.color }]} />
                <Text style={styles.statPillCount}>{s.registered}</Text>
                <Text style={styles.statPillSep}>/</Text>
                <View style={styles.statPillLive}>
                  <View style={[styles.statPillLiveDot, { backgroundColor: '#34C759' }]} />
                  <Text style={[styles.statPillOnline, { color: '#34C759' }]}>{s.online}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={[styles.mapContainer, { height: expanded ? 400 : 200 }]}>
        <DirectoryMap
          markers={mapMarkers}
          onMarkerPress={handleProfile}
          onChatPress={handleChat}
        />

        <View style={styles.mapOverlayTop}>
          <View style={styles.mapBadge}>
            <Ionicons name="people" size={12} color="#FFF" />
            <Text style={styles.mapBadgeText}>{totalRegistered} registered</Text>
          </View>
        </View>

        <View style={styles.mapLegendOverlay}>
          {STAT_ROLES.map(r => (
            <View key={r.key} style={styles.legendItem}>
              <View style={[styles.legendDotInner, { backgroundColor: r.color }]} />
              <Text style={styles.legendLabel}>{r.short}</Text>
            </View>
          ))}
        </View>

        {!expanded && (
          <Pressable style={styles.expandBtn} onPress={() => setExpanded(true)}>
            <Ionicons name="expand-outline" size={14} color="#FFF" />
            <Text style={styles.expandBtnText}>Expand</Text>
          </Pressable>
        )}
      </View>

      {expanded && (
        <Pressable
          style={styles.fullMapLink}
          onPress={() => router.push('/(tabs)/directory')}
        >
          <Ionicons name="compass-outline" size={16} color="#007AFF" />
          <Text style={styles.fullMapLinkText}>Open full directory map</Text>
          <Ionicons name="chevron-forward" size={14} color="#007AFF" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 12,
    marginBottom: 14,
    borderRadius: 20,
    backgroundColor: '#1C1C1E',
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 24px rgba(0,0,0,0.4)' } as any : {}),
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  titleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  snapIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapTitle: {
    color: '#FFF',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#34C759',
  },
  liveText: {
    color: '#34C759',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  titleRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  totalBadge: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  totalBadgeText: {
    color: '#FFF',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 6,
  },
  statPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 3,
  },
  statPillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statPillCount: {
    color: '#FFF',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  statPillSep: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  statPillLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  statPillLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statPillOnline: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  mapContainer: {
    width: '100%',
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
    marginHorizontal: 0,
  },
  mapOverlayTop: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 10,
  },
  mapBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  mapBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  mapLegendOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    gap: 6,
    zIndex: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  legendDotInner: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  legendLabel: {
    color: '#FFF',
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  expandBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,122,255,0.85)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 10,
  },
  expandBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  fullMapLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  fullMapLinkText: {
    color: '#007AFF',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
