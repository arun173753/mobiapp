import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Linking, FlatList } from 'react-native';
import MapView, { Marker, Callout, Circle, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import type { TechMapProps } from './TechMap';

const PRIMARY = '#FF6B2C';
const CARD = '#FFFFFF';
const BORDER = '#E8E8E8';
const FORE = '#1A1A1A';
const MUTED = '#888888';
const SUCCESS = '#34C759';
const WARN = '#FF9F0A';
const BG = '#F5F5F5';

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
  onPressMap,
}: {
  tech: any;
  onCall: (phone: string) => void;
  onChat?: (tech: any) => void;
  onPressMap?: (tech: any) => void;
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
        {onPressMap && tech.latitude && tech.longitude && (
          <Pressable style={styles.mapPinBtn} onPress={() => onPressMap(tech)} hitSlop={8}>
            <Ionicons name="location" size={18} color={PRIMARY} />
          </Pressable>
        )}
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

export default function TechMap({ techs, location, loading, errorMsg, bottomInset, onChat, radiusKm = 20 }: TechMapProps) {
  const mapRef = useRef<MapView>(null);
  const [filter, setFilter] = useState<'available' | 'all'>('available');

  const handleCall = (phone: string) => { if (phone) Linking.openURL(`tel:${phone}`); };

  const availableTechs = techs.filter(t => t.availableForJobs === 'true');
  const displayed = filter === 'available' ? availableTechs : techs;

  const centerOnTech = (tech: any) => {
    if (!mapRef.current || !tech.latitude || !tech.longitude) return;
    mapRef.current.animateToRegion({
      latitude: parseFloat(tech.latitude),
      longitude: parseFloat(tech.longitude),
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }, 500);
  };

  const userLat = location?.coords.latitude ?? 17.3850;
  const userLng = location?.coords.longitude ?? 78.4867;

  return (
    <View style={styles.flex}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: userLat,
          longitude: userLng,
          latitudeDelta: radiusKm * 0.018,
          longitudeDelta: radiusKm * 0.018,
        }}
        showsUserLocation={location !== null}
        showsMyLocationButton={location !== null}
      >
        {techs.map(tech => {
          const lat = parseFloat(tech.latitude);
          const lng = parseFloat(tech.longitude);
          if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;
          const isAvail = tech.availableForJobs === 'true';
          return (
            <Marker
              key={tech.id}
              coordinate={{ latitude: lat, longitude: lng }}
              pinColor={isAvail ? SUCCESS : MUTED}
            >
              <Callout tooltip>
                <View style={styles.callout}>
                  <Text style={styles.calloutName}>{tech.name}</Text>
                  <Text style={styles.calloutSkills} numberOfLines={1}>
                    {(Array.isArray(tech.skills) ? tech.skills[0] : null) || 'Technician'}
                  </Text>
                  <View style={styles.calloutMeta}>
                    <View style={[styles.calloutDot, { backgroundColor: isAvail ? SUCCESS : MUTED }]} />
                    <Text style={[styles.calloutStatus, { color: isAvail ? SUCCESS : MUTED }]}>
                      {isAvail ? 'Available' : 'Busy'}
                    </Text>
                    {tech.distance != null && (
                      <Text style={styles.calloutDist}>  •  {tech.distance.toFixed(1)} km</Text>
                    )}
                  </View>
                  {tech.verified === 1 && (
                    <Text style={styles.calloutVerified}>✓ Verified Technician</Text>
                  )}
                  {tech.phone && (
                    <Pressable style={styles.calloutCallBtn} onPress={() => handleCall(tech.phone)}>
                      <Ionicons name="call" size={14} color="#FFF" />
                      <Text style={styles.calloutCallTxt}>Call Now</Text>
                    </Pressable>
                  )}
                </View>
              </Callout>
            </Marker>
          );
        })}
        <Circle
          center={{ latitude: userLat, longitude: userLng }}
          radius={radiusKm * 1000}
          fillColor="rgba(255, 107, 44, 0.07)"
          strokeColor="rgba(255, 107, 44, 0.25)"
          strokeWidth={1.5}
        />
      </MapView>

      <View style={[styles.bottomSheet, { paddingBottom: Math.max(bottomInset, 16) }]}>
        <View style={styles.handle} />

        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.sheetTitle}>
              {availableTechs.length} {availableTechs.length === 1 ? 'technician' : 'technicians'} available
            </Text>
            <Text style={styles.sheetSub}>Within {radiusKm} km • Updates every 30s</Text>
          </View>
          <View style={styles.filterRowSmall}>
            <Pressable
              style={[styles.filterChip, filter === 'available' && styles.filterChipActive]}
              onPress={() => setFilter('available')}
            >
              <View style={[styles.filterDot, { backgroundColor: filter === 'available' ? '#FFF' : SUCCESS }]} />
              <Text style={[styles.filterTxt, filter === 'available' && styles.filterTxtActive]}>
                {availableTechs.length}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
              onPress={() => setFilter('all')}
            >
              <Text style={[styles.filterTxt, filter === 'all' && styles.filterTxtActive]}>All {techs.length}</Text>
            </Pressable>
          </View>
        </View>

        {errorMsg && (
          <View style={styles.errorBanner}>
            <Ionicons name="information-circle-outline" size={14} color={PRIMARY} />
            <Text style={styles.errorTxt}>{errorMsg}</Text>
          </View>
        )}

        {displayed.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="people-outline" size={36} color={MUTED} />
            <Text style={styles.emptyTxt}>
              {filter === 'available' ? 'No available techs right now' : `No technicians within ${radiusKm} km`}
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cardsList}
          >
            {displayed.map(tech => (
              <TechCard
                key={tech.id}
                tech={tech}
                onCall={handleCall}
                onChat={onChat}
                onPressMap={centerOnTech}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  map: { flex: 1 },

  callout: {
    backgroundColor: CARD, borderRadius: 12, padding: 12, width: 200,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8,
  },
  calloutName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FORE, marginBottom: 2 },
  calloutSkills: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 6 },
  calloutMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  calloutDot: { width: 7, height: 7, borderRadius: 4, marginRight: 4 },
  calloutStatus: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  calloutDist: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  calloutVerified: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: SUCCESS, marginBottom: 8 },
  calloutCallBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: PRIMARY, borderRadius: 8, paddingVertical: 7,
  },
  calloutCallTxt: { color: '#FFF', fontSize: 13, fontFamily: 'Inter_700Bold' },

  bottomSheet: {
    backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 10,
  },
  handle: { width: 40, height: 4, backgroundColor: BORDER, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sheetTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FORE },
  sheetSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  filterRowSmall: { flexDirection: 'row', gap: 6 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
    backgroundColor: '#F0F0F0', borderWidth: 1.5, borderColor: '#E0E0E0',
  },
  filterChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  filterDot: { width: 6, height: 6, borderRadius: 3 },
  filterTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: FORE },
  filterTxtActive: { color: '#FFF' },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF1EC', borderRadius: 8, padding: 8, marginBottom: 8,
  },
  errorTxt: { color: PRIMARY, fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },

  emptyBox: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  emptyTxt: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },

  cardsList: { gap: 10, paddingBottom: 4, paddingTop: 4 },
  techCard: {
    width: 260, backgroundColor: CARD, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  techCardBusy: { opacity: 0.75 },
  techCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  techInfo: { flex: 1, minWidth: 0 },
  techNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 },
  techName: { fontSize: 14, fontFamily: 'Inter_700Bold', color: FORE, flex: 1 },
  techSkills: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 5 },
  techMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' as const },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  distBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2,
  },
  distBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  locationRow: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    marginTop: 7, paddingTop: 7, borderTopWidth: 1, borderTopColor: BORDER,
  },
  locationTxt: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, flex: 1 },
  mapPinBtn: { padding: 4 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 9, borderRadius: 10, gap: 5,
  },
  callBtn: { backgroundColor: PRIMARY },
  callBtnTxt: { color: '#FFF', fontSize: 13, fontFamily: 'Inter_700Bold' },
  chatBtn: { backgroundColor: '#FFF1EC', borderWidth: 1.5, borderColor: PRIMARY },
  chatBtnTxt: { color: PRIMARY, fontSize: 13, fontFamily: 'Inter_700Bold' },
});
