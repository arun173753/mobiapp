import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, Animated, ActivityIndicator, Platform, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';

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

export type MapLatLngBoundsLiteral = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export interface DirectoryMapProps {
  markers: MapMarkerData[];
  onMarkerPress?: (id: string) => void;
  /** Return a Promise so the map can show a spinner until navigation completes. */
  onChatPress?: (id: string) => void | Promise<void>;
  /** Web: debounced map idle — use for bounds-based API / Firestore loads. */
  onMapBoundsChange?: (bounds: MapLatLngBoundsLiteral, zoom: number) => void;
  /** When true, native map disables the Chat action and shows a spinner. */
  isChatOpening?: boolean;
}

const INDIA_CENTER = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 25,
  longitudeDelta: 25,
};

const ZOOM_THRESHOLD_DELTA = 3;

const ROLE_COLORS_LEGEND = [
  { role: 'Technician', color: '#22C55E' },
  { role: 'Teacher', color: '#EAB308' },
  { role: 'Supplier', color: '#2563EB' },
  { role: 'Shopkeeper', color: '#EF4444' },
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
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={{ opacity: pulse, transform: [{ scale: pulse }] }}>
      <View style={[styles.dotMarker, { backgroundColor: marker.color }]}>
        {marker.isOnline && <View style={styles.dotOnline} />}
      </View>
    </Animated.View>
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

export default function DirectoryMap({
  markers,
  onMarkerPress,
  onChatPress,
  isChatOpening,
}: DirectoryMapProps) {
  const [selected, setSelected] = useState<MapMarkerData | null>(null);
  const [isZoomedIn, setIsZoomedIn] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapView>(null);
  const [myCoords, setMyCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locLoading, setLocLoading] = useState(false);

  const mapsKey = useMemo(() => {
    const k = (Constants.expoConfig?.android?.config as any)?.googleMaps?.apiKey || '';
    return String(k || '');
  }, []);
  const likelyMissingKey = mapsKey.includes('YOUR_GOOGLE_MAPS_API_KEY_HERE') || !mapsKey.trim();

  const handleRegionChange = useCallback((region: Region) => {
    setIsZoomedIn(region.latitudeDelta < ZOOM_THRESHOLD_DELTA);
  }, []);

  const goToMyLocation = useCallback(async () => {
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location', 'Permission is required to show your position on the map.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      const { latitude, longitude } = pos.coords;
      setMyCoords({ latitude, longitude });
      mapRef.current?.animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        },
        500,
      );
    } catch (e: any) {
      Alert.alert('Location', e?.message || 'Could not read GPS.');
    } finally {
      setLocLoading(false);
    }
  }, []);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        // Avoid hard-crashing on Android when Google Maps key isn't embedded in the APK/AAB.
        // Fall back to default provider so the screen still renders (with a warning banner).
        provider={(
          Constants.platform?.android && !likelyMissingKey
            ? PROVIDER_GOOGLE
            : PROVIDER_DEFAULT
        ) as any}
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
        {myCoords && (
          <Marker coordinate={myCoords} title="You are here" pinColor="#2563EB" />
        )}
      </MapView>

      <Pressable
        style={[styles.myLocBtn, locLoading && { opacity: 0.7 }]}
        onPress={goToMyLocation}
        disabled={locLoading}
        accessibilityLabel="Center map on my location"
      >
        {locLoading ? (
          <ActivityIndicator size="small" color="#111827" />
        ) : (
          <Ionicons name="locate" size={22} color="#111827" />
        )}
      </Pressable>

      {mapReady && likelyMissingKey && (
        <View style={styles.mapsKeyBanner} pointerEvents="none">
          <Ionicons name="warning-outline" size={14} color="#92400E" />
          <Text style={styles.mapsKeyBannerText}>Google Maps key missing — map may be blank in APK.</Text>
        </View>
      )}

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
              style={[styles.btnChat, (isChatOpening) && { opacity: 0.65 }]}
              disabled={!!isChatOpening}
              onPress={async () => {
                const id = selected.id;
                try {
                  await onChatPress?.(id);
                  setSelected(null);
                } catch (e: any) {
                  Alert.alert('Chat', e?.message || 'Could not open chat.');
                }
              }}
            >
              {isChatOpening ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={styles.btnChatText}>Chat</Text>
              )}
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
  mapsKeyBanner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapsKeyBannerText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
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
  myLocBtn: {
    position: 'absolute',
    bottom: 100,
    right: 14,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    zIndex: 25,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6 },
      android: { elevation: 4 },
    }),
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
    bottom: 96,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxHeight: 118,
  },
  closeBtn: {
    position: 'absolute',
    top: 8,
    right: 10,
    zIndex: 1,
    padding: 4,
  },
  cardAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
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
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 1,
  },
  cardRole: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 1,
  },
  cardMeta: {
    color: '#AAA',
    fontSize: 11,
  },
  cardActions: {
    flexDirection: 'column',
    gap: 5,
  },
  btnProfile: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  btnProfileText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  btnChat: {
    backgroundColor: '#FFD60A',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 72,
  },
  btnChatText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '600',
  },
});
