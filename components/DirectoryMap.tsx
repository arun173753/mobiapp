import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, PROVIDER_DEFAULT, Region } from 'react-native-maps';

export interface MapMarkerData {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  role: string;
  roleKey: string;
  city?: string;
  skills?: string[];
  color: string;
  avatar?: string;
  isOnline: boolean;
  lastSeen?: number;
}

interface DirectoryMapProps {
  markers: MapMarkerData[];
  onMarkerPress?: (id: string) => void;
  onChatPress?: (id: string) => void;
}

const INDIA_CENTER = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 25,
  longitudeDelta: 25,
};

const ZOOM_THRESHOLD_DELTA = 3;

const ROLE_COLORS_LEGEND = [
  { role: 'Technician', color: '#34C759' },
  { role: 'Teacher', color: '#FFD60A' },
  { role: 'Supplier', color: '#FF6B2C' },
];

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

function getTimeAgo(ts?: number) {
  if (!ts) return 'Never seen';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Active now';
  if (mins < 60) return `Active ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Active ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `Active ${days}d ago`;
}

const DotMarker = React.memo(function DotMarker({ marker }: { marker: MapMarkerData }) {
  return (
    <View style={[styles.dotMarker, { backgroundColor: marker.color }]}>
      {marker.isOnline && <View style={styles.dotOnline} />}
    </View>
  );
});

const AvatarMarker = React.memo(function AvatarMarker({ marker }: { marker: MapMarkerData }) {
  return (
    <View style={[styles.avatarMarker, { borderColor: marker.color }]}>
      {marker.avatar ? (
        <Image source={{ uri: marker.avatar }} style={styles.avatarImage} />
      ) : (
        <View style={[styles.avatarInitials, { backgroundColor: marker.color }]}>
          <Text style={styles.initialsText}>{getInitials(marker.name)}</Text>
        </View>
      )}
      {marker.isOnline && <View style={styles.onlineDot} />}
    </View>
  );
});

export default function DirectoryMap({ markers, onMarkerPress, onChatPress }: DirectoryMapProps) {
  const [selected, setSelected] = useState<MapMarkerData | null>(null);
  const [isZoomedIn, setIsZoomedIn] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const handleRegionChange = useCallback((region: Region) => {
    setIsZoomedIn(region.latitudeDelta < ZOOM_THRESHOLD_DELTA);
  }, []);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={INDIA_CENTER}
        showsUserLocation={false}
        showsMyLocationButton={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={handleRegionChange}
        onPress={() => setSelected(null)}
      >
        {markers.map(p => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            onPress={() => setSelected(p)}
            tracksViewChanges={false}
          >
            {isZoomedIn ? <AvatarMarker marker={p} /> : <DotMarker marker={p} />}
          </Marker>
        ))}
      </MapView>

      {!selected && mapReady && (
        <View style={styles.legend}>
          {ROLE_COLORS_LEGEND.map(r => (
            <View key={r.role} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: r.color }]} />
              <Text style={styles.legendText}>{r.role}</Text>
            </View>
          ))}
        </View>
      )}

      {mapReady && (
        <View style={styles.mapCount}>
          <Ionicons name="location" size={14} color="#007AFF" />
          <Text style={styles.mapCountText}>{markers.length} on map</Text>
        </View>
      )}

      {mapReady && selected && (
        <View style={styles.userCard}>
          <Pressable style={styles.closeBtn} onPress={() => setSelected(null)}>
            <Ionicons name="close" size={18} color="#888" />
          </Pressable>

          <View style={[styles.cardAvatar, { borderColor: selected.color }]}>
            {selected.avatar ? (
              <Image source={{ uri: selected.avatar }} style={styles.cardAvatarImage} />
            ) : (
              <View style={[styles.cardAvatarInitials, { backgroundColor: selected.color }]}>
                <Text style={styles.cardInitialsText}>{getInitials(selected.name)}</Text>
              </View>
            )}
          </View>

          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={1}>{selected.name}</Text>
            <Text style={[styles.cardRole, { color: selected.color }]}>{selected.role}</Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {[
                selected.city,
                selected.isOnline ? '🟢 Online' : getTimeAgo(selected.lastSeen),
                selected.skills?.slice(0, 2).join(', '),
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>

          <View style={styles.cardActions}>
            <Pressable
              style={styles.btnProfile}
              onPress={() => { setSelected(null); onMarkerPress?.(selected.id); }}
            >
              <Text style={styles.btnProfileText}>Profile</Text>
            </Pressable>
            <Pressable
              style={styles.btnChat}
              onPress={() => { setSelected(null); onChatPress?.(selected.id); }}
            >
              <Text style={styles.btnChatText}>Chat</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  dotMarker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  dotOnline: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34C759',
    borderWidth: 1,
    borderColor: '#FFF',
  },
  avatarMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    overflow: 'hidden',
    backgroundColor: '#333',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 19,
  },
  avatarInitials: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
  },
  initialsText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#34C759',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  legend: {
    position: 'absolute',
    bottom: 100,
    left: 12,
    backgroundColor: 'rgba(28,28,30,0.92)',
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '500',
  },
  mapCount: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(28,28,30,0.92)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mapCountText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  userCard: {
    position: 'absolute',
    bottom: 100,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
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
    backgroundColor: '#444',
  },
  cardAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 21,
  },
  cardAvatarInitials: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
  },
  cardInitialsText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  cardRole: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  cardMeta: {
    color: '#AAA',
    fontSize: 12,
  },
  cardActions: {
    flexDirection: 'column',
    gap: 6,
  },
  btnProfile: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignItems: 'center',
  },
  btnProfileText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  btnChat: {
    backgroundColor: '#FFD60A',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignItems: 'center',
  },
  btnChatText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
});
