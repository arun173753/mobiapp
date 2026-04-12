import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Alert, Platform, KeyboardAvoidingView, ActivityIndicator, Modal, Linking,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import Colors from '@/constants/colors';
import { T } from '@/constants/techTheme';
import { openLink } from '@/lib/open-link';
import { useApp } from '@/lib/context';
import { getApiUrl, apiRequest } from '@/lib/query-client';
import { ROLE_LABELS, SKILLS_LIST, UserRole, ADMIN_PHONE } from '@/lib/types';

const SUPER_ADMIN_EMAIL = 'atozmobilerepaircourse@gmail.com';

function parseSellPost(text: string): { title: string; price: string; condition: string; description: string } | null {
  try {
    const lines = text.split('\n');
    const data: any = {};
    for (const line of lines) {
      if (line.startsWith('SELL_TITLE:')) data.title = line.replace('SELL_TITLE:', '').trim();
      else if (line.startsWith('SELL_PRICE:')) data.price = line.replace('SELL_PRICE:', '').trim();
      else if (line.startsWith('SELL_CONDITION:')) data.condition = line.replace('SELL_CONDITION:', '').trim();
      else if (line.startsWith('SELL_DESC:')) data.description = line.replace('SELL_DESC:', '').trim();
    }
    if (data.title) return data;
    return null;
  } catch { return null; }
}

function formatSellText(title: string, price: string, condition: string, description: string): string {
  return `SELL_TITLE:${title}\nSELL_PRICE:${price}\nSELL_CONDITION:${condition}\nSELL_DESC:${description}`;
}

function getImageUri(img: string): string {
  if (img.startsWith('/')) return `${getApiUrl()}${img}`;
  return img;
}

const CONDITIONS = ['Like New', 'Good', 'Fair', 'Used'];

const C = Colors.light;

// ── Role switching rules ──────────────────────────────────────
// ONLY ADMIN can switch ANY user's role
// Non-admin users CANNOT switch roles
function isSuperAdmin(userPhone?: string, userEmail?: string): boolean {
  const cleanPhone = userPhone?.replace(/\D/g, '') || '';
  const last10 = cleanPhone.slice(-10);
  if (last10 === '8179142535' || last10 === '9876543210') return true;
  if (userEmail === SUPER_ADMIN_EMAIL) return true;
  return false;
}

function getAllowedRoles(currentRole: UserRole, userPhone?: string, userEmail?: string): UserRole[] {
  if (currentRole === 'admin' || isSuperAdmin(userPhone, userEmail)) {
    return ['admin', 'teacher', 'technician', 'supplier', 'shopkeeper', 'customer', 'job_provider'];
  }
  return [];
}

type ListingItem = {
  id: string;
  title: string;
  price: string;
  condition: string;
  description: string;
  image?: string;
  createdAt: number;
};

const ListingCard = React.memo(function ListingCard({
  listing, onEdit, onDelete, isDeleting,
}: {
  listing: ListingItem;
  onEdit: (listing: ListingItem) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  return (
    <View style={styles.listingCard}>
      <View style={styles.listingRow}>
        {listing.image ? (
          <Image source={{ uri: listing.image }} style={styles.listingThumb} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.listingThumb, styles.listingThumbPlaceholder]}>
            <Ionicons name="image-outline" size={20} color={T.muted} />
          </View>
        )}
        <View style={styles.listingInfo}>
          <Text style={styles.listingTitle} numberOfLines={1}>{listing.title}</Text>
          <Text style={styles.listingPrice}>₹{listing.price}</Text>
          {listing.condition ? (
            <Text style={styles.listingCondition}>{listing.condition}</Text>
          ) : null}
        </View>
        <View style={styles.listingActions}>
          <Pressable style={styles.listingActionBtn} onPress={() => onEdit(listing)}>
            <Ionicons name="create-outline" size={18} color="#5E8BFF" />
          </Pressable>
          <Pressable style={styles.listingActionBtn} onPress={() => onDelete(listing.id)} disabled={isDeleting}>
            {isDeleting ? (
              <ActivityIndicator size="small" color="#FF3B30" />
            ) : (
              <Ionicons name="trash-outline" size={18} color="#FF3B30" />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
});

const ROLE_COLORS: Record<UserRole, string> = {
  technician: '#34C759',
  teacher: '#FFD60A',
  supplier: '#FF6B2C',
  job_provider: '#5E8BFF',
  customer: '#FF2D55',
  admin: '#8B5CF6',
};

function getInitials(name: string | undefined): string {
  if (!name || typeof name !== 'string') return 'U';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';
}

// ── Customer-specific profile screen (matches Mobix design) ───────────────
function CustomerProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profile, logout, setProfile } = useApp();
  const [subStatus, setSubStatus] = useState<{ active: boolean; subscriptionEnd?: number } | null>(null);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [changingRole, setChangingRole] = useState(false);
  const [availableForJobs, setAvailableForJobs] = useState(profile?.availableForJobs === 'true');
  const [updatingAvailability, setUpdatingAvailability] = useState(false);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopLocationTracking = useCallback(() => {
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }
    if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
    }
  }, []);

  const startLocationTracking = useCallback(async (profileId: string) => {
    if (Platform.OS === 'web') return;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const sendLocation = async (lat: number, lng: number) => {
        try {
          await apiRequest('POST', `/api/profiles/${profileId}/location`, {
            latitude: lat.toString(),
            longitude: lng.toString(),
          });
        } catch {}
      };

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await sendLocation(loc.coords.latitude, loc.coords.longitude);

      locationWatcherRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 20000 },
        async (pos) => {
          await sendLocation(pos.coords.latitude, pos.coords.longitude);
        }
      );
    } catch (e) {
      console.warn('[Profile] Location tracking error:', e);
    }
  }, []);

  useEffect(() => {
    if (profile?.role !== 'technician') return;
    if (availableForJobs && profile?.id) {
      startLocationTracking(profile.id);
    } else {
      stopLocationTracking();
    }
    return () => stopLocationTracking();
  }, [availableForJobs, profile?.id, profile?.role, startLocationTracking, stopLocationTracking]);

  const toggleAvailability = async (value: boolean) => {
    if (!profile?.id || updatingAvailability) return;
    try {
      setUpdatingAvailability(true);
      const res = await apiRequest('PATCH', `/api/profiles/${profile.id}/availability`, { 
        availableForJobs: value ? 'true' : 'false' 
      });
      const data = await res.json();
      if (data.success) {
        setAvailableForJobs(value);
        if (setProfile) {
          await setProfile({ ...profile, availableForJobs: value ? 'true' : 'false' });
        }
      }
    } catch (e) {
      console.error('[Profile] Toggle availability error:', e);
    } finally {
      setUpdatingAvailability(false);
    }
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom + 16;

  const ORANGE = '#E8704A';

  useEffect(() => {
    if (!profile?.id) return;
    apiRequest('GET', `/api/subscription/status/${profile.id}`)
      .then(r => r.json())
      .then(data => { if (data.success) setSubStatus(data); })
      .catch(() => {});
  }, [profile?.id]);

  const handleChangeRole = async (newRole: string) => {
    if (!profile?.id || changingRole) return;

    if (newRole === 'admin') {
      setShowRolePicker(false);
      router.push('/admin' as any);
      return;
    }

    const allowed = getAllowedRoles(profile.role, profile.phone, profile.email);
    if (!allowed.includes(newRole as UserRole)) {
      Alert.alert(
        'Cannot Switch',
        `You can only switch between: Teacher ↔ Technician or Supplier ↔ Technician`,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setChangingRole(true);
      setShowRolePicker(false);
      const res = await apiRequest('POST', '/api/profile/change-role', { newRole, userPhone: profile.phone });
      const data = await res.json();
      if (data.success) {
        // Clear role-specific fields when switching roles
        const updatedProfile = { 
          ...profile, 
          role: newRole as UserRole,
          // Clear supplier-specific data
          ...(newRole !== 'supplier' && { sellType: undefined }),
          // Clear teacher-specific data
          ...(newRole !== 'teacher' && { teachType: undefined }),
          // Clear technician-specific data (skills)
          ...(newRole !== 'technician' && { skills: [] }),
        };
        await setProfile(updatedProfile);
        if (Platform.OS === 'web') {
          window.alert(`Role changed to ${ROLE_LABELS[newRole as UserRole] || newRole}`);
        } else {
          Alert.alert('Role Updated', `Switched to ${ROLE_LABELS[newRole as UserRole] || newRole}`);
        }
      } else {
        throw new Error(data.message || 'Failed to change role');
      }
    } catch (e: any) {
      if (Platform.OS === 'web') {
        window.alert(e.message || 'Failed to change role');
      } else {
        Alert.alert('Error', e.message || 'Failed to change role');
      }
    } finally {
      setChangingRole(false);
    }
  };

  if (!profile) return null;

  const ini = getInitials(profile.name);
  const validTill = subStatus?.subscriptionEnd
    ? new Date(subStatus.subscriptionEnd).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : 'Mar 2025';

  function MenuItem({ icon, label, badge, onPress }: { icon: string; label: string; badge?: string; onPress?: () => void }) {
    return (
      <Pressable
        onPress={onPress}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Ionicons name={icon as any} size={18} color="#555" />
        </View>
        <Text style={{ flex: 1, fontSize: 15, color: '#1A1A1A' }}>{label}</Text>
        {badge ? (
          <View style={{ backgroundColor: ORANGE, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 2, marginRight: 8 }}>
            <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>{badge}</Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={16} color="#BDBDBD" />
      </Pressable>
    );
  }

  const ALL_ROLES: UserRole[] = ['technician', 'teacher', 'supplier', 'shopkeeper', 'job_provider', 'customer', 'admin'];

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: topPad + 12, paddingBottom: botPad + 100, paddingHorizontal: 16 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Title ───────────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#1A1A1A' }}>Profile</Text>
        <Pressable onPress={() => router.push('/notification-preferences' as any)}>
          <Ionicons name="settings-outline" size={22} color="#555" />
        </Pressable>
      </View>

      {/* ── User Card ───────────────────────────────────────────────────── */}
      <View style={{ backgroundColor: '#FFF', borderRadius: 16, padding: 18, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }}>
        {profile.role === 'technician' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' }}>
            <View>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#1A1A1A' }}>Available for Jobs</Text>
              <Text style={{ fontSize: 12, color: '#888' }}>{availableForJobs ? 'You are visible to customers' : 'Go online to receive bookings'}</Text>
            </View>
            <Switch
              value={availableForJobs}
              onValueChange={toggleAvailability}
              trackColor={{ false: '#D1D1D6', true: '#34C759' }}
              thumbColor={Platform.OS === 'ios' ? undefined : '#FFF'}
            />
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {profile.profileImage ? (
            <Image source={{ uri: profile.profileImage }} style={{ width: 54, height: 54, borderRadius: 27, borderWidth: 2, borderColor: ORANGE, marginRight: 14 }} contentFit="cover" />
          ) : (
            <View style={{ width: 54, height: 54, borderRadius: 27, borderWidth: 2, borderColor: ORANGE, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1EC', marginRight: 14 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: ORANGE }}>{ini}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: profile.role === 'technician' ? (availableForJobs ? '#34C759' : '#FF9F0A') : '#34C759' }} />
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#1A1A1A' }}>{profile.name}</Text>
              {profile.role === 'technician' && profile.verified === 1 && (
                <Ionicons name="checkmark-circle" size={16} color="#34C759" />
              )}
              <View style={{ borderWidth: 1, borderColor: ORANGE, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: ORANGE }}>Premium</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <Text style={{ fontSize: 13, color: '#555' }}>+91 {profile.phone?.replace(/\D/g, '').slice(-10)}</Text>
            </View>
            {profile.email ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 13, color: '#555' }}>{profile.email}</Text>
              </View>
            ) : null}
          </View>
          <Pressable onPress={() => router.push('/edit-profile' as any)}>
            <Ionicons name="pencil-outline" size={18} color="#888" />
          </Pressable>
        </View>
      </View>

      {/* ── Stats ───────────────────────────────────────────────────────── */}
      <View style={{ backgroundColor: '#FFF', borderRadius: 16, flexDirection: 'row', marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }}>
        {[
          { val: '0', label: 'Total Orders' },
          { val: '₹0', label: 'Saved', valColor: ORANGE },
          { val: '0', label: 'Reward Points' },
        ].map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && <View style={{ width: 1, backgroundColor: '#F0F0F0', marginVertical: 16 }} />}
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 18 }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: s.valColor ?? '#1A1A1A', marginBottom: 4 }}>{s.val}</Text>
              <Text style={{ fontSize: 12, color: '#888' }}>{s.label}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {/* ── Active Protection ───────────────────────────────────────────── */}
      <Pressable
        style={{ backgroundColor: ORANGE, borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 22, shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 }}
        onPress={() => router.push('/insurance' as any)}
      >
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
          <Ionicons name="shield-checkmark-outline" size={22} color="#FFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginBottom: 2 }}>Active Protection</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFF', marginBottom: 2 }}>Mobile Protection Plan</Text>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>Valid till {validTill}</Text>
        </View>
        <View style={{ backgroundColor: '#FFF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: ORANGE }}>View</Text>
        </View>
      </Pressable>

      {/* ── TECHNICIAN TOOLS ─────────────────────────────────────────────── */}
      {profile.role === 'technician' && (
        <>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#888', letterSpacing: 1, marginBottom: 8, marginLeft: 4 }}>TECHNICIAN TOOLS</Text>
          <View style={{ backgroundColor: '#FFF', borderRadius: 16, marginBottom: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }}>
            <MenuItem icon="construct-outline" label="Skills & Services" onPress={() => router.push('/skills-services' as any)} />
            <View style={{ height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 }} />
            <MenuItem icon="wrench.and.screwdriver" label="Repair Jobs" onPress={() => router.push('/(tabs)/technician-jobs' as any)} />
            <View style={{ height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 }} />
            <MenuItem icon="cash-outline" label="My Earnings" onPress={() => router.push('/technician-earnings')} />
            <View style={{ height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 }} />
            <MenuItem icon="time-outline" label="Service Requests" onPress={() => router.push('/(tabs)/orders' as any)} />
          </View>
        </>
      )}

      {/* ── MY ACTIVITY ─────────────────────────────────────────────────── */}
      <Text style={{ fontSize: 11, fontWeight: '700', color: '#888', letterSpacing: 1, marginBottom: 8, marginLeft: 4 }}>MY ACTIVITY</Text>
      <View style={{ backgroundColor: '#FFF', borderRadius: 16, marginBottom: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }}>
        <MenuItem icon="document-outline" label="My Posts" onPress={() => router.push('/my-posts' as any)} />
        <View style={{ height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 }} />
        <MenuItem icon="clipboard-outline" label="My Orders" onPress={() => router.push('/my-orders')} />
        <View style={{ height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 }} />
        <MenuItem icon="time-outline" label="Service History" onPress={() => router.push('/(tabs)/orders' as any)} />
      </View>

      {/* ── ACCOUNT ─────────────────────────────────────────────────────── */}
      <Text style={{ fontSize: 11, fontWeight: '700', color: '#888', letterSpacing: 1, marginBottom: 8, marginLeft: 4 }}>ACCOUNT</Text>
      <View style={{ backgroundColor: '#FFF', borderRadius: 16, marginBottom: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }}>
        <MenuItem icon="person-outline" label="Edit Profile" onPress={() => router.push('/edit-profile' as any)} />
        <View style={{ height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 }} />
        <MenuItem icon="location-outline" label="Saved Addresses" />
        <View style={{ height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 }} />
        <MenuItem icon="notifications-outline" label="Notifications" onPress={() => router.push('/notification-preferences' as any)} />
        <View style={{ height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 }} />
        <Pressable
          onPress={() => setShowRolePicker(true)}
          disabled={changingRole}
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}
        >
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3ECFF', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <Ionicons name="swap-horizontal-outline" size={18} color="#AF52DE" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, color: '#1A1A1A' }}>{changingRole ? 'Switching...' : 'Switch Role'}</Text>
            <Text style={{ fontSize: 12, color: '#888', marginTop: 1 }}>Current: Customer</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#BDBDBD" />
        </Pressable>
      </View>

      {/* ── PROTECTION ──────────────────────────────────────────────────── */}
      <Text style={{ fontSize: 11, fontWeight: '700', color: '#888', letterSpacing: 1, marginBottom: 8, marginLeft: 4 }}>PROTECTION</Text>
      <View style={{ backgroundColor: '#FFF', borderRadius: 16, marginBottom: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }}>
        <MenuItem icon="shield-outline" label="Insurance Plans" onPress={() => router.push('/insurance' as any)} />
        <View style={{ height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 16 }} />
        <MenuItem icon="scan-outline" label="Run Diagnostics" onPress={() => router.push('/diagnose' as any)} />
      </View>

      {/* ── Logout ──────────────────────────────────────────────────────── */}
      <Pressable
        style={{ backgroundColor: '#FFF', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }}
        onPress={() => {
          if (Platform.OS === 'web') {
            if (window.confirm('Are you sure you want to log out?')) logout();
          } else {
            Alert.alert('Log Out', 'Are you sure you want to log out?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Log Out', style: 'destructive', onPress: logout },
            ]);
          }
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '600', color: '#FF3B30' }}>Log Out</Text>
      </Pressable>
    </ScrollView>

    <Modal visible={showRolePicker} transparent animationType="slide" onRequestClose={() => setShowRolePicker(false)}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setShowRolePicker(false)}>
        <View style={{ backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: botPad + 20 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDD', alignSelf: 'center', marginTop: 10, marginBottom: 4 }} />
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#1A1A1A', textAlign: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>Switch Role</Text>
          {(() => {
            const allowed = getAllowedRoles(profile?.role || 'customer', profile?.phone, profile?.email);
            const availableRoles = allowed.length > 0 ? allowed : [profile?.role || 'customer'];
            return availableRoles.map(r => (
              <Pressable
                key={r}
                onPress={() => handleChangeRole(r)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F5F5F5', backgroundColor: profile?.role === r ? '#FFF1EC' : '#FFF' }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Ionicons
                    name={r === 'admin' ? 'shield-outline' : r === 'technician' ? 'construct-outline' : r === 'teacher' ? 'school-outline' : r === 'supplier' ? 'cube-outline' : r === 'shopkeeper' ? 'storefront-outline' : r === 'job_provider' ? 'briefcase-outline' : 'person-outline'}
                    size={20}
                    color={profile?.role === r ? ORANGE : '#555'}
                  />
                  <Text style={{ fontSize: 15, color: '#1A1A1A', fontWeight: profile?.role === r ? '700' : '400' }}>{ROLE_LABELS[r] || r}</Text>
                </View>
                {profile?.role === r && <Ionicons name="checkmark-circle" size={20} color={ORANGE} />}
              </Pressable>
            ));
          })()}
        </View>
      </Pressable>
    </Modal>
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profile, setProfile, posts, logout, refreshData } = useApp();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(profile?.name || '');
  const [editEmail, setEditEmail] = useState(profile?.email || '');
  const [editBio, setEditBio] = useState(profile?.bio || '');
  const [editCity, setEditCity] = useState(profile?.city || '');
  const [editExperience, setEditExperience] = useState(profile?.experience || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [editListingVisible, setEditListingVisible] = useState(false);
  const [editListingId, setEditListingId] = useState<string | null>(null);
  const [editListingTitle, setEditListingTitle] = useState('');
  const [editListingPrice, setEditListingPrice] = useState('');
  const [editListingCondition, setEditListingCondition] = useState('Like New');
  const [editListingDesc, setEditListingDesc] = useState('');
  const [editListingSaving, setEditListingSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [subStatus, setSubStatus] = useState<{ active: boolean; required: boolean; subscriptionEnd?: number; amount?: string; period?: string; commission?: string } | null>(null);
  const [updatingLocation, setUpdatingLocation] = useState(false);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'success' | 'denied'>('idle');
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [changingRole, setChangingRole] = useState(false);

  const handleChangeRole = async (newRole: string) => {
    if (!profile?.id || changingRole) return;

    if (newRole === 'admin') {
      setShowRolePicker(false);
      router.push('/admin' as any);
      return;
    }

    const allowed = getAllowedRoles(profile.role, profile.phone, profile.email);
    if (!allowed.includes(newRole as UserRole)) {
      Alert.alert(
        'Cannot Switch',
        `You can only switch between: Teacher ↔ Technician or Supplier ↔ Technician`,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setChangingRole(true);
      setShowRolePicker(false);
      const res = await apiRequest('POST', '/api/profile/change-role', { newRole, userPhone: profile.phone });
      const data = await res.json();
      if (data.success) {
        // Clear role-specific fields when switching roles
        const updatedProfile = { 
          ...profile, 
          role: newRole as UserRole,
          // Clear supplier-specific data
          ...(newRole !== 'supplier' && { sellType: undefined }),
          // Clear teacher-specific data
          ...(newRole !== 'teacher' && { teachType: undefined }),
          // Clear technician-specific data (skills)
          ...(newRole !== 'technician' && { skills: [] }),
        };
        await setProfile(updatedProfile);
        if (Platform.OS === 'web') {
          window.alert(`Role changed to ${ROLE_LABELS[newRole as UserRole] || newRole}`);
        } else {
          Alert.alert('Role Updated', `Switched to ${ROLE_LABELS[newRole as UserRole] || newRole}`);
        }
      } else {
        throw new Error(data.message || 'Failed to change role');
      }
    } catch (e: any) {
      if (Platform.OS === 'web') {
        window.alert(e.message || 'Failed to change role');
      } else {
        Alert.alert('Error', e.message || 'Failed to change role');
      }
    } finally {
      setChangingRole(false);
    }
  };

  useEffect(() => {
    if (!profile?.id) return;
    apiRequest('GET', `/api/subscription/status/${profile.id}`)
      .then(r => r.json())
      .then(data => { if (data.success) setSubStatus(data); })
      .catch(() => {});
  }, [profile?.id]);

  const myPosts = posts.filter(p => p.userId === profile?.id);
  const totalLikes = myPosts.reduce((sum, p) => sum + p.likes.length, 0);

  const myListings = useMemo(() => {
    return posts
      .filter(p => p.userId === profile?.id && p.category === 'sell')
      .map(p => {
        const parsed = parseSellPost(p.text);
        return {
          id: p.id,
          title: parsed?.title || 'Untitled',
          price: parsed?.price || '0',
          condition: parsed?.condition || '',
          description: parsed?.description || '',
          image: p.images && p.images.length > 0 ? getImageUri(p.images[0]) : undefined,
          createdAt: p.createdAt,
        };
      });
  }, [posts, profile?.id]);

  const handleDeleteListing = async (postId: string) => {
    const doDelete = async () => {
      try {
        setDeletingId(postId);
        const res = await apiRequest('DELETE', `/api/posts/${postId}?userId=${profile?.id}`);
        const data = await res.json();
        console.log('[Profile] Delete listing response:', { status: res.status, data });
        
        if (data.success || res.status === 404) {
          if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Success', 'Listing deleted successfully');
          await refreshData();
        } else {
          Alert.alert('Error', data.message || 'Could not delete listing. Please try again.');
        }
      } catch (e) {
        console.error('[Profile] Delete listing error:', e);
        Alert.alert('Error', 'Could not delete listing. Please try again.');
      } finally {
        setDeletingId(null);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to delete this listing?')) doDelete();
    } else {
      Alert.alert('Delete Listing', 'Are you sure you want to delete this listing?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const handleEditListing = (listing: typeof myListings[0]) => {
    setEditListingId(listing.id);
    setEditListingTitle(listing.title);
    setEditListingPrice(listing.price);
    setEditListingCondition(listing.condition || 'Like New');
    setEditListingDesc(listing.description);
    setEditListingVisible(true);
  };

  const handleSaveListing = async () => {
    if (!editListingId || !editListingTitle.trim()) return;
    try {
      setEditListingSaving(true);
      const baseUrl = getApiUrl();
      const newText = formatSellText(editListingTitle.trim(), editListingPrice.trim(), editListingCondition, editListingDesc.trim());
      await fetch(`${baseUrl}/api/posts/${editListingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText }),
      });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditListingVisible(false);
      await refreshData();
    } catch (e) {
      console.error('[Profile] Update listing error:', e);
      Alert.alert('Error', 'Could not update listing. Please try again.');
    } finally {
      setEditListingSaving(false);
    }
  };
  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const handleChangeAvatar = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      
      if (result.canceled || !result.assets?.[0]) return;
      
      setUploadingAvatar(true);
      const asset = result.assets[0];
      
      const formData = new FormData();
      const filename = asset.uri.split('/').pop() || 'avatar.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';
      
      if (Platform.OS === 'web') {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        formData.append('image', blob, filename);
      } else {
        formData.append('image', { uri: asset.uri, name: filename, type } as unknown as Blob);
      }
      
      const baseUrl = getApiUrl();
      const uploadRes = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      
      const uploadData = await uploadRes.json();
      if (uploadData.url) {
        const updatedProfile = { ...profile!, avatar: uploadData.url };
        await setProfile(updatedProfile);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      console.error('[Profile] Avatar upload error:', e);
      Alert.alert('Upload Failed', 'Could not update your profile picture. Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    if (!profile) return;
    if (!editName.trim()) {
      Alert.alert('Name required', 'Please enter your name.');
      return;
    }
    await setProfile({
      ...profile,
      name: editName.trim(),
      email: editEmail.trim(),
      bio: editBio.trim(),
      city: editCity.trim(),
      experience: editExperience.trim(),
    });
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsEditing(false);
  };

  const updateLiveLocation = async () => {
    if (!profile?.id || updatingLocation) return;
    setUpdatingLocation(true);
    setLocationStatus('idle');
    try {
      let lat: string | null = null;
      let lng: string | null = null;
      if (Platform.OS === 'web') {
        if (navigator.geolocation) {
          const position = await new Promise<GeolocationPosition | null>((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve(pos),
              () => resolve(null),
              { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
            );
          });
          if (position) {
            lat = position.coords.latitude.toString();
            lng = position.coords.longitude.toString();
          }
        }
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = loc.coords.latitude.toString();
          lng = loc.coords.longitude.toString();
        }
      }
      if (lat && lng) {
        await apiRequest('POST', `/api/profiles/${profile.id}/location`, { latitude: lat, longitude: lng });
        setLocationStatus('success');
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => setLocationStatus('idle'), 3000);
      } else {
        setLocationStatus('denied');
        setTimeout(() => setLocationStatus('idle'), 3000);
      }
    } catch (e) {
      console.warn('[Profile] Location update failed:', e);
      setLocationStatus('denied');
      setTimeout(() => setLocationStatus('idle'), 3000);
    } finally {
      setUpdatingLocation(false);
    }
  };

  if (!profile) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="person-outline" size={48} color={T.muted} />
        <Text style={styles.emptyTitle}>No profile yet</Text>
        <Text style={styles.emptyText}>Complete onboarding to create your profile</Text>
      </View>
    );
  }

  const roleColor = ROLE_COLORS[profile.role];
  const isCustomer = profile.role === 'customer';

  if (isCustomer) return <CustomerProfileScreen />;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 16,
            paddingBottom: Platform.OS === 'web' ? 84 + 34 : 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <Text style={styles.pageTitle}>Profile</Text>
          <Pressable onPress={() => isEditing ? handleSave() : setIsEditing(true)}>
            <Ionicons
              name={isEditing ? 'checkmark-circle' : 'create-outline'}
              size={24}
              color={isEditing ? T.green : T.textSub}
            />
          </Pressable>
        </View>

        <View style={styles.profileHeader}>
          <Pressable onPress={handleChangeAvatar} disabled={uploadingAvatar}>
            <View>
              {profile.avatar ? (
                <Image source={{ uri: profile.avatar }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.avatar, { backgroundColor: roleColor + '20' }]}>
                  <Text style={[styles.avatarText, { color: roleColor }]}>
                    {getInitials(profile.name)}
                  </Text>
                </View>
              )}
              <View style={styles.avatarEditBadge}>
                {uploadingAvatar ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Ionicons name="camera" size={14} color="#FFF" />
                )}
              </View>
            </View>
          </Pressable>
          {isEditing ? (
            <TextInput
              style={styles.nameInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Your name"
              placeholderTextColor={T.muted}
            />
          ) : (
            <Text style={styles.profileName}>{profile.name}</Text>
          )}
          <View style={[styles.roleBadge, { backgroundColor: roleColor + '20' }]}>
            <Text style={[styles.roleBadgeText, { color: roleColor }]}>
              {ROLE_LABELS[profile.role]}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{myPosts.length}</Text>
            <Text style={styles.statLabel}>Posts</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{totalLikes}</Text>
            <Text style={styles.statLabel}>Likes</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{Array.isArray(profile.skills) ? profile.skills.length : 0}</Text>
            <Text style={styles.statLabel}>Skills</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          {isEditing ? (
            <TextInput
              style={styles.bioInput}
              value={editBio}
              onChangeText={setEditBio}
              placeholder="Tell others about yourself..."
              placeholderTextColor={T.muted}
              multiline
              maxLength={200}
            />
          ) : (
            <Text style={styles.bioText}>
              {profile.bio || 'No bio yet. Tap the edit icon to add one.'}
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={18} color={T.textSub} />
            {isEditing ? (
              <TextInput
                style={styles.detailInput}
                value={editCity}
                onChangeText={setEditCity}
                placeholder="City"
                placeholderTextColor={T.muted}
              />
            ) : (
              <Text style={styles.detailText}>{profile.city}, {profile.state}</Text>
            )}
          </View>
          <Pressable
            onPress={updateLiveLocation}
            disabled={updatingLocation}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 4, opacity: updatingLocation ? 0.6 : 1 }}
          >
            {updatingLocation ? (
              <ActivityIndicator size="small" color={T.accent} />
            ) : (
              <Ionicons
                name={locationStatus === 'success' ? 'checkmark-circle' : locationStatus === 'denied' ? 'alert-circle-outline' : 'navigate-outline'}
                size={18}
                color={locationStatus === 'success' ? '#34C759' : locationStatus === 'denied' ? '#FF3B30' : T.accent}
              />
            )}
            <Text style={{ fontSize: 14, fontFamily: 'Inter_500Medium', color: locationStatus === 'success' ? '#34C759' : locationStatus === 'denied' ? '#FF3B30' : T.accent }}>
              {updatingLocation ? 'Updating location...' : locationStatus === 'success' ? 'Location updated!' : locationStatus === 'denied' ? 'Location access denied' : 'Update Live Location'}
            </Text>
          </Pressable>
          {!isCustomer && (
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={18} color={T.textSub} />
              {isEditing ? (
                <TextInput
                  style={styles.detailInput}
                  value={editExperience}
                  onChangeText={setEditExperience}
                  placeholder="Experience (e.g. 5 years)"
                  placeholderTextColor={T.muted}
                />
              ) : (
                <Text style={styles.detailText}>{profile.experience || 'Not specified'}</Text>
              )}
            </View>
          )}
          {profile.shopName && (
            <View style={styles.detailRow}>
              <Ionicons name="storefront-outline" size={18} color={T.textSub} />
              <Text style={styles.detailText}>{profile.shopName}</Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Ionicons name="mail-outline" size={18} color={T.textSub} />
            {isEditing ? (
              <TextInput
                style={styles.detailInput}
                value={editEmail}
                onChangeText={setEditEmail}
                placeholder="Gmail Address"
                placeholderTextColor={T.muted}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            ) : (
              <Text style={styles.detailText}>{profile.email || 'No email added'}</Text>
            )}
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="call-outline" size={18} color={T.textSub} />
            <Text style={styles.detailText}>{profile.phone}</Text>
          </View>
          {profile.sellType ? (
            <View style={styles.detailRow}>
              <Ionicons name="cube-outline" size={18} color={T.textSub} />
              <Text style={styles.detailText}>Sells: {profile.sellType}</Text>
            </View>
          ) : null}
          {profile.teachType ? (
            <View style={styles.detailRow}>
              <Ionicons name="school-outline" size={18} color={T.textSub} />
              <Text style={styles.detailText}>Teaches: {profile.teachType}</Text>
            </View>
          ) : null}
          {profile.shopAddress ? (
            <View style={styles.detailRow}>
              <Ionicons name="business-outline" size={18} color={T.textSub} />
              <Text style={styles.detailText}>{profile.shopAddress}</Text>
            </View>
          ) : null}
          {profile.gstNumber ? (
            <View style={styles.detailRow}>
              <Ionicons name="document-text-outline" size={18} color={T.textSub} />
              <Text style={styles.detailText}>GST: {profile.gstNumber}</Text>
            </View>
          ) : null}
        </View>

        {Array.isArray(profile.skills) && profile.skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skills</Text>
            <View style={styles.skillsGrid}>
              {profile.skills.map((skill, i) => (
                <View key={i} style={[styles.skillChip, { backgroundColor: roleColor + '12' }]}>
                  <Text style={[styles.skillChipText, { color: roleColor }]}>{skill}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <Pressable
            style={styles.supportRow}
            onPress={() => router.push('/my-posts' as any)}
          >
            <Ionicons name="document-outline" size={20} color="#8B5CF6" />
            <Text style={styles.detailText}>My Posts</Text>
            <Ionicons name="chevron-forward" size={16} color={T.muted} style={{ marginLeft: 'auto' }} />
          </Pressable>
          <Pressable
            style={[styles.supportRow, { marginTop: 8 }]}
            onPress={() => router.push('/(tabs)/jobs' as any)}
          >
            <Ionicons name="briefcase-outline" size={20} color="#5E8BFF" />
            <Text style={styles.detailText}>Jobs</Text>
            <Ionicons name="chevron-forward" size={16} color={T.muted} style={{ marginLeft: 'auto' }} />
          </Pressable>
          <Pressable
            style={[styles.supportRow, { marginTop: 8 }]}
            onPress={() => router.push('/notification-preferences')}
          >
            <Ionicons name="notifications-outline" size={20} color="#FF9F0A" />
            <Text style={styles.detailText}>Notifications</Text>
            <Ionicons name="chevron-forward" size={16} color={T.muted} style={{ marginLeft: 'auto' }} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>
          <Pressable
            style={styles.supportRow}
            onPress={async () => {
              const defaultUrl = 'https://wa.me/918179142535';
              try {
                const res = await apiRequest('GET', '/api/settings/whatsapp_support_link');
                const { value } = await res.json();
                const url = value || defaultUrl;
                openLink(url, 'Support');
              } catch (e) {
                console.error('[Support] Link error:', e);
                openLink(defaultUrl, 'Support');
              }
            }}
          >
            <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
            <Text style={styles.detailText}>Help & Support</Text>
            <Ionicons name="chevron-forward" size={16} color={T.muted} style={{ marginLeft: 'auto' }} />
          </Pressable>
        </View>

        {isEditing && (
          <Pressable
            style={styles.cancelBtn}
            onPress={() => {
              setIsEditing(false);
              setEditName(profile.name);
              setEditEmail(profile.email || '');
              setEditBio(profile.bio || '');
              setEditCity(profile.city);
              setEditExperience(profile.experience);
            }}
          >
            <Text style={styles.cancelText}>Cancel editing</Text>
          </Pressable>
        )}

        {myListings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Listings ({myListings.length})</Text>
            {myListings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onEdit={handleEditListing}
                onDelete={handleDeleteListing}
                isDeleting={deletingId === listing.id}
              />
            ))}
          </View>
        )}

        <Modal visible={editListingVisible} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Edit Listing</Text>
                <Pressable onPress={() => setEditListingVisible(false)}>
                  <Ionicons name="close" size={24} color={T.text} />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll}>
                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  style={styles.modalInput}
                  value={editListingTitle}
                  onChangeText={setEditListingTitle}
                  placeholder="Item name"
                  placeholderTextColor={T.muted}
                />
                <Text style={styles.fieldLabel}>Price (₹)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={editListingPrice}
                  onChangeText={setEditListingPrice}
                  placeholder="Price"
                  placeholderTextColor={T.muted}
                  keyboardType="numeric"
                />
                <Text style={styles.fieldLabel}>Condition</Text>
                <View style={styles.conditionRow}>
                  {CONDITIONS.map(c => (
                    <Pressable
                      key={c}
                      style={[
                        styles.conditionChip,
                        editListingCondition === c && styles.conditionChipActive,
                      ]}
                      onPress={() => setEditListingCondition(c)}
                    >
                      <Text style={[
                        styles.conditionChipText,
                        editListingCondition === c && styles.conditionChipTextActive,
                      ]}>{c}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.modalInput, { minHeight: 80, textAlignVertical: 'top' }]}
                  value={editListingDesc}
                  onChangeText={setEditListingDesc}
                  placeholder="Describe the item"
                  placeholderTextColor={T.muted}
                  multiline
                />
              </ScrollView>
              <Pressable
                style={[styles.saveBtn, editListingSaving && { opacity: 0.6 }]}
                onPress={handleSaveListing}
                disabled={editListingSaving}
              >
                {editListingSaving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Modal>

        {subStatus && (
          <View style={[styles.section, { marginBottom: 12 }]}>
            <Text style={styles.sectionTitle}>Subscription</Text>
            <View style={[styles.subCard, { borderColor: subStatus.active ? '#34C75930' : '#FF3B3030' }]}>
              <View style={styles.subCardHeader}>
                <View style={[styles.subStatusDot, { backgroundColor: subStatus.active ? '#34C759' : '#FF3B30' }]} />
                <Text style={[styles.subStatusText, { color: subStatus.active ? '#34C759' : '#FF3B30' }]}>
                  {subStatus.active ? 'Active' : (subStatus.required ? 'Expired' : 'Free')}
                </Text>
              </View>
              {subStatus.subscriptionEnd && subStatus.subscriptionEnd > 0 && (
                <View style={styles.subRow}>
                  <Ionicons name="calendar-outline" size={16} color={T.textSub} />
                  <Text style={styles.subRowText}>
                    {subStatus.active ? 'Expires' : 'Expired'}: {new Date(subStatus.subscriptionEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
              )}
              {subStatus.amount && parseInt(subStatus.amount) > 0 && (
                <View style={styles.subRow}>
                  <Ionicons name="pricetag-outline" size={16} color={T.textSub} />
                  <Text style={styles.subRowText}>₹{subStatus.amount}/{subStatus.period || 'monthly'}</Text>
                </View>
              )}
              {subStatus.commission && (
                <View style={styles.subRow}>
                  <Ionicons name="trending-up-outline" size={16} color={T.textSub} />
                  <Text style={styles.subRowText}>Commission: {subStatus.commission}%</Text>
                </View>
              )}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <Pressable
            style={styles.settingsRow}
            onPress={handleChangeAvatar}
          >
            <View style={styles.settingsRowLeft}>
              <View style={[styles.settingsIcon, { backgroundColor: '#FF6B2C20' }]}>
                <Ionicons name="camera-outline" size={20} color="#FF6B2C" />
              </View>
              <Text style={styles.settingsRowText}>Change Profile Photo</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={T.muted} />
          </Pressable>
          <View style={styles.settingsDivider} />
          {profile.role !== 'customer' && (
            <>
              <Pressable
                style={styles.settingsRow}
                onPress={() => router.push('/my-orders')}
              >
                <View style={styles.settingsRowLeft}>
                  <View style={[styles.settingsIcon, { backgroundColor: '#30D15820' }]}>
                    <Ionicons name="receipt-outline" size={20} color="#30D158" />
                  </View>
                  <Text style={styles.settingsRowText}>My Orders</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={T.muted} />
              </Pressable>
              <View style={styles.settingsDivider} />
            </>
          )}
          {profile.role === 'teacher' && (
            <>
              <View style={styles.settingsDivider} />
              <Pressable
                style={styles.settingsRow}
                onPress={() => router.push('/teacher-revenue')}
              >
                <View style={styles.settingsRowLeft}>
                  <View style={[styles.settingsIcon, { backgroundColor: '#FFD60A20' }]}>
                    <Ionicons name="cash-outline" size={20} color="#FFD60A" />
                  </View>
                  <Text style={styles.settingsRowText}>My Revenue</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={T.muted} />
              </Pressable>
            </>
          )}
          <View style={styles.settingsDivider} />
          {profile?.phone?.replace(/\D/g, '') === ADMIN_PHONE && (
            <>
              <Pressable
                style={styles.settingsRow}
                onPress={() => router.push('/admin')}
              >
                <View style={styles.settingsRowLeft}>
                  <View style={[styles.settingsIcon, { backgroundColor: '#5E8BFF20' }]}>
                    <Ionicons name="shield-checkmark-outline" size={20} color="#5E8BFF" />
                  </View>
                  <Text style={styles.settingsRowText}>Admin Panel</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={T.muted} />
              </Pressable>
              <View style={styles.settingsDivider} />
            </>
          )}
          {getAllowedRoles(profile.role, profile.phone, profile.email).length > 0 && (
            <>
              <Pressable
                style={styles.settingsRow}
                onPress={() => setShowRolePicker(true)}
                disabled={changingRole}
              >
                <View style={styles.settingsRowLeft}>
                  <View style={[styles.settingsIcon, { backgroundColor: '#AF52DE20' }]}>
                    <Ionicons name="swap-horizontal-outline" size={20} color="#AF52DE" />
                  </View>
                  <View>
                    <Text style={styles.settingsRowText}>
                      {changingRole ? 'Changing Role...' : 'Switch Role'}
                    </Text>
                    <Text style={{ fontSize: 12, color: T.muted, marginTop: 1 }}>
                      Current: {ROLE_LABELS[profile.role as UserRole] || profile.role}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={T.muted} />
              </Pressable>
              <View style={styles.settingsDivider} />
            </>
          )}
          <Pressable
            style={styles.settingsRow}
            onPress={async () => {
              if (Platform.OS === 'web') {
                const confirmed = window.confirm('Are you sure you want to log out? All your local data will be cleared.');
                if (confirmed) {
                  await logout();
                  router.replace('/onboarding');
                }
              } else {
                Alert.alert(
                  'Log Out',
                  'Are you sure you want to log out? All your local data will be cleared.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Log Out',
                      style: 'destructive',
                      onPress: async () => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        await logout();
                        router.replace('/onboarding');
                      },
                    },
                  ]
                );
              }
            }}
          >
            <View style={styles.settingsRowLeft}>
              <View style={[styles.settingsIcon, { backgroundColor: '#FF3B3020' }]}>
                <Ionicons name="log-out-outline" size={20} color="#FF3B30" />
              </View>
              <Text style={styles.settingsRowText}>Log Out</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={T.muted} />
          </Pressable>
        </View>
      </ScrollView>

      {/* Role Picker Modal */}
      <Modal
        visible={showRolePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRolePicker(false)}
      >
        <Pressable style={rolePickerStyles.backdrop} onPress={() => setShowRolePicker(false)}>
          <View style={rolePickerStyles.sheet}>
            <Text style={rolePickerStyles.title}>Switch Role</Text>
            <Text style={rolePickerStyles.subtitle}>Select a role to switch to</Text>
            {getAllowedRoles(profile?.role || 'customer', profile?.phone, profile?.email).map(r => (
              <Pressable
                key={r}
                style={[rolePickerStyles.roleRow, profile?.role === r && rolePickerStyles.roleRowActive]}
                onPress={() => handleChangeRole(r)}
              >
                <Text style={[rolePickerStyles.roleLabel, profile?.role === r && rolePickerStyles.roleLabelActive]}>
                  {ROLE_LABELS[r]}
                </Text>
                {profile?.role === r && (
                  <Ionicons name="checkmark-circle" size={20} color="#FF6B2C" />
                )}
              </Pressable>
            ))}
            <Pressable style={rolePickerStyles.cancelBtn} onPress={() => setShowRolePicker(false)}>
              <Text style={rolePickerStyles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bg,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  content: {
    paddingHorizontal: 20,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  pageTitle: {
    color: T.text,
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarImg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: T.border,
  },
  avatarText: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 12,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FF6B2C',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  profileName: {
    color: T.text,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  nameInput: {
    color: T.text,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: T.accent,
    paddingBottom: 4,
  },
  roleBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleBadgeText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: T.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: T.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: T.text,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  statLabel: {
    color: T.muted,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: T.border,
  },
  section: {
    backgroundColor: T.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  subCard: {
    backgroundColor: T.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1.5,
    gap: 10,
  },
  subCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  subStatusText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subRowText: {
    color: T.text,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  sectionTitle: {
    color: T.muted,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  bioText: {
    color: T.textSub,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  bioInput: {
    color: T.text,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
    backgroundColor: T.cardSurface,
    borderRadius: 10,
    padding: 12,
    minHeight: 60,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  detailText: {
    color: T.text,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  detailInput: {
    flex: 1,
    color: T.text,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    borderBottomWidth: 1,
    borderBottomColor: T.accent,
    paddingVertical: 2,
    padding: 0,
  },
  skillsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  skillChipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  supportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  cancelText: {
    color: T.muted,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  settingsRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingsIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsRowText: {
    color: T.text,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  settingsDivider: {
    height: 1,
    backgroundColor: T.border,
    marginVertical: 2,
  },
  emptyTitle: {
    color: T.text,
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  emptyText: {
    color: T.muted,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  listingCard: {
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
    paddingBottom: 8,
  },
  listingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  listingThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
  },
  listingThumbPlaceholder: {
    backgroundColor: T.cardSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listingInfo: {
    flex: 1,
    gap: 2,
  },
  listingTitle: {
    color: T.text,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  listingPrice: {
    color: '#FF6B2C',
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  listingCondition: {
    color: T.muted,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  listingActions: {
    flexDirection: 'row',
    gap: 8,
  },
  listingActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: T.cardSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: T.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: T.text,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  modalScroll: {
    marginBottom: 12,
  },
  fieldLabel: {
    color: T.muted,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    marginBottom: 6,
    marginTop: 12,
  },
  modalInput: {
    backgroundColor: T.cardSurface,
    color: T.text,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  conditionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  conditionChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: T.cardSurface,
    borderWidth: 1,
    borderColor: T.border,
  },
  conditionChipActive: {
    backgroundColor: '#FF6B2C20',
    borderColor: '#FF6B2C',
  },
  conditionChipText: {
    color: T.muted,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  conditionChipTextActive: {
    color: '#FF6B2C',
  },
  saveBtn: {
    backgroundColor: '#FF6B2C',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: Platform.OS === 'web' ? 20 : 34,
  },
  saveBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});

const rolePickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#00000080',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'web' ? 40 : 50,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: '#1C1C1E',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 20,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#F2F2F7',
  },
  roleRowActive: {
    backgroundColor: '#FF6B2C15',
    borderWidth: 1.5,
    borderColor: '#FF6B2C',
  },
  roleLabel: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: '#1C1C1E',
  },
  roleLabelActive: {
    color: '#FF6B2C',
    fontFamily: 'Inter_600SemiBold',
  },
  cancelBtn: {
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#FF3B30',
  },
});
