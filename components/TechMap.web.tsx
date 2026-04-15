import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TechMapProps } from './TechMap';

const PRIMARY = '#FF6B2C';
const CARD = '#FFFFFF';
const BORDER = '#E8E8E8';
const MUTED = '#888888';
const SUCCESS = '#34C759';
const WARN = '#FF9F0A';

function DistanceBadge({ distance }: { distance: number | null | undefined }) {
  if (distance == null) return null;
  const color = distance < 5 ? SUCCESS : distance < 10 ? PRIMARY : WARN;
  return (
    <View style={[styles.distBadge, { borderColor: color }]}>
      <Ionicons name="navigate" size={11} color={color} />
      <Text style={[styles.distBadgeText, { color }]}>
        {distance.toFixed(1)} km away
      </Text>
    </View>
  );
}

function TechCard({
  tech,
  onCall,
  onChat,
}: {
  tech: any;
  onCall: (phone: string) => void;
  onChat?: (tech: any) => void;
}) {
  const isAvailable = tech.availableForJobs === 'true';
  const skills: string[] = Array.isArray(tech.skills) ? tech.skills : [];

  return (
    <View style={[styles.techCard, !isAvailable && styles.techCardBusy]}>
      <View style={styles.techCardTop}>
        <View style={[styles.avatar, { backgroundColor: isAvailable ? '#E8F9EE' : '#F5F5F5' }]}>
          <Ionicons name="person" size={22} color={isAvailable ? SUCCESS : MUTED} />
        </View>
        <View style={styles.techInfo}>
          <View style={styles.techNameRow}>
            <Text style={styles.techName} numberOfLines={1}>{tech.name}</Text>
            {tech.verified === 1 && (
              <Ionicons name="checkmark-circle" size={15} color={SUCCESS} />
            )}
          </View>
          <Text style={styles.techSkills} numberOfLines={1}>
            {skills.slice(0, 2).join(' • ') || 'Mobile Technician'}
          </Text>
          <View style={styles.techMetaRow}>
            <View style={styles.statusPill}>
              <View style={[styles.statusDot, { backgroundColor: isAvailable ? SUCCESS : MUTED }]} />
              <Text style={[styles.statusTxt, { color: isAvailable ? SUCCESS : MUTED }]}>
                {isAvailable ? 'Available' : 'Busy'}
              </Text>
            </View>
            <DistanceBadge distance={tech.distance} />
          </View>
        </View>
      </View>

      {(tech.city || tech.state) && (
        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={12} color={MUTED} />
          <Text style={styles.locationTxt} numberOfLines={1}>
            {[tech.city, tech.state].filter(Boolean).join(', ')}
          </Text>
        </View>
      )}

      <View style={styles.actionRow}>
        {tech.phone && (
          <Pressable style={[styles.actionBtn, styles.callBtn]} onPress={() => onCall(tech.phone)}>
            <Ionicons name="call" size={16} color="#FFF" />
            <Text style={styles.callBtnTxt}>Call</Text>
          </Pressable>
        )}
        {onChat && (
          <Pressable style={[styles.actionBtn, styles.chatBtn]} onPress={() => onChat(tech)}>
            <Ionicons name="chatbubble-ellipses" size={16} color={PRIMARY} />
            <Text style={styles.chatBtnTxt}>Chat</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function WebMapEmbed({ location, radiusKm }: { location: { coords: { latitude: number; longitude: number } } | null; radiusKm: number }) {
  const lat = location?.coords.latitude ?? 17.3850;
  const lng = location?.coords.longitude ?? 78.4867;
  const delta = (radiusKm / 111).toFixed(4);
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - parseFloat(delta)},${lat - parseFloat(delta)},${lng + parseFloat(delta)},${lat + parseFloat(delta)}&layer=mapnik&marker=${lat},${lng}`;

  return (
    <View style={styles.mapBanner}>
      <View style={styles.webMapFrame}>
        <iframe
          src={mapUrl}
          style={{ width: '100%', height: 200, border: 'none' } as any}
          title="Nearby Technicians Map"
        />
      </View>
      <View style={styles.mapRadiusBadge}>
        <Ionicons name="radio" size={12} color="#FFF" />
        <Text style={styles.mapRadiusTxt}>{radiusKm} km radius</Text>
      </View>
    </View>
  );
}

export default function TechMap({
  techs,
  location,
  loading,
  errorMsg,
  bottomInset,
  onChat,
  radiusKm = 20,
}: TechMapProps) {
  const [filter, setFilter] = useState<'all' | 'available'>('available');

  const handleCall = (phone: string) => {
    if (!phone) return;
    if (Platform.OS === 'web') {
      try { (window as any).location.href = `tel:${phone}`; } catch { /* ignore */ }
    } else {
      Linking.openURL(`tel:${phone}`).catch(() => {});
    }
  };

  const availableTechs = techs.filter((t) => t.availableForJobs === 'true');
  const displayed = filter === 'available' ? availableTechs : techs;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset + 20 }]}
    >
      <WebMapEmbed location={location} radiusKm={radiusKm} />

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{availableTechs.length}</Text>
          <Text style={styles.statLabel}>Available</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{techs.length}</Text>
          <Text style={styles.statLabel}>Nearby</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{radiusKm}</Text>
          <Text style={styles.statLabel}>km radius</Text>
        </View>
      </View>

      {!!errorMsg && (
        <View style={styles.errorBanner}>
          <Ionicons name="information-circle-outline" size={16} color={PRIMARY} />
          <Text style={styles.errorBannerTxt}>{errorMsg}</Text>
        </View>
      )}

      <View style={styles.filterRow}>
        <Pressable
          style={[styles.filterChip, filter === 'available' && styles.filterChipActive]}
          onPress={() => setFilter('available')}
        >
          <View style={[styles.filterDot, { backgroundColor: filter === 'available' ? '#FFF' : SUCCESS }]} />
          <Text style={[styles.filterChipTxt, filter === 'available' && styles.filterChipTxtActive]}>
            Available ({availableTechs.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterChipTxt, filter === 'all' && styles.filterChipTxtActive]}>
            All ({techs.length})
          </Text>
        </Pressable>
      </View>

      {!loading && displayed.length === 0 && (
        <View style={styles.emptyBox}>
          <Ionicons name="people-outline" size={56} color={MUTED} />
          <Text style={styles.emptyTitle}>
            {filter === 'available' ? 'No available technicians' : 'No technicians found'}
          </Text>
          <Text style={styles.emptyTxt}>
            {filter === 'available'
              ? 'All technicians are busy. Try again soon.'
              : `No technicians within ${radiusKm} km`}
          </Text>
          {filter === 'available' && techs.length > 0 && (
            <Pressable style={styles.showAllBtn} onPress={() => setFilter('all')}>
              <Text style={styles.showAllTxt}>Show all {techs.length} technicians</Text>
            </Pressable>
          )}
        </View>
      )}

      {displayed.map((tech) => (
        <TechCard key={tech.id} tech={tech} onCall={handleCall} onChat={onChat} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: 16, gap: 12 },

  mapBanner: { marginBottom: 4, borderRadius: 12, overflow: 'hidden' as const, position: 'relative' as const },
  webMapFrame: { height: 200, borderRadius: 12, overflow: 'hidden' as const, backgroundColor: '#E5E7EB' },
  mapRadiusBadge: {
    position: 'absolute' as const, bottom: 10, left: 10,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  mapRadiusTxt: { color: '#FFF', fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  statCard: {
    flex: 1, backgroundColor: CARD, borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: BORDER,
  },
  statNum: { fontSize: 22, fontFamily: 'Inter_700Bold', color: PRIMARY },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF1EC', borderRadius: 10, padding: 12, marginBottom: 4,
  },
  errorBannerTxt: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: '#7C2D12' },

  filterRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  filterChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFF',
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  filterChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  filterChipTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: PRIMARY },
  filterChipTxtActive: { color: '#FFF' },
  filterDot: { width: 8, height: 8, borderRadius: 4 },

  emptyBox: { alignItems: 'center', justifyContent: 'center', padding: 16, gap: 6 },
  emptyTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#111827', marginTop: 8 },
  emptyTxt: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center' },
  showAllBtn: { marginTop: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#FFF1EC' },
  showAllTxt: { color: PRIMARY, fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  techCard: { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14 },
  techCardBusy: { opacity: 0.92 },
  techCardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  techInfo: { flex: 1 },
  techNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  techName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#111827', flex: 1 },
  techSkills: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  techMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' as const },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: BORDER },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  distBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, backgroundColor: '#FFF' },
  distBadgeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  locationTxt: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: BORDER },
  callBtn: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  callBtnTxt: { color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 13 },
  chatBtn: { backgroundColor: '#FFF1EC' },
  chatBtnTxt: { color: PRIMARY, fontFamily: 'Inter_700Bold', fontSize: 13 },
});

