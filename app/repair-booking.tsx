import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ScrollView,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';
import { ReelsPreviewStrip } from '@/app/reels';

const PRIMARY = '#FF6B2C';
const BG      = '#F5F7FA';
const CARD    = '#FFFFFF';
const DARK    = '#1A1A2E';
const GRAY    = '#8E8E93';

const TIMES = ['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'];

function getDateOptions(): { label: string; value: string }[] {
  const dates: { label: string; value: string }[] = [];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push({
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`,
      value: d.toISOString().split('T')[0],
    });
  }
  return dates;
}

export default function RepairBookingScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const params = useLocalSearchParams<{ brand?: string; model?: string; services?: string; total?: string }>();

  const services = (() => {
    try { return JSON.parse(params.services || '[]'); } catch { return []; }
  })();
  const total = parseInt(params.total || '0', 10);

  const dates = getDateOptions();
  const [selectedDate, setSelectedDate] = useState(dates[0].value);
  const [selectedTime, setSelectedTime] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [booked, setBooked] = useState(false);
  const [bookingId, setBookingId] = useState('');
  const [userLocation, setUserLocation] = useState<{ lat: string; lng: string } | null>(null);
  const [locationStatus, setLocationStatus] = useState<'requesting' | 'captured' | 'failed' | 'idle'>('idle');

  const topInset  = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 20;

  useEffect(() => {
    (async () => {
      try {
        setLocationStatus('requesting');
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setLocationStatus('failed');
          return;
        }

        let location = await Location.getCurrentPositionAsync({});
        setUserLocation({
          lat: String(location.coords.latitude),
          lng: String(location.coords.longitude),
        });
        setLocationStatus('captured');
      } catch (error) {
        console.warn('Error getting location:', error);
        setLocationStatus('failed');
      }
    })();
  }, []);

  const handleBook = async () => {
    if (!selectedTime) {
      if (Platform.OS === 'web') window.alert('Please select a time slot');
      else Alert.alert('Select Time', 'Please choose a time slot for your appointment.');
      return;
    }
    if (!address.trim()) {
      if (Platform.OS === 'web') window.alert('Please enter your address');
      else Alert.alert('Address Required', 'Please enter your pickup address.');
      return;
    }
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      const serviceLabel = services.map((s: any) => s.label).join(', ');
      const res = await apiRequest('POST', '/api/repair-bookings', {
        customerId: profile?.id || 'guest',
        customerName: profile?.name || 'Customer',
        customerPhone: profile?.phone || '',
        deviceBrand: params.brand || '',
        deviceModel: params.model || '',
        repairType: serviceLabel,
        price: String(total),
        address: address,
        latitude: userLocation?.lat || '',
        longitude: userLocation?.lng || '',
        bookingDate: selectedDate,
        bookingTime: selectedTime,
        notes: notes,
        status: 'pending',
      });
      
      const data = await res.json();
      setBookingId(data.id || '');
      setBooked(true);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      console.error('Booking error:', e);
      if (Platform.OS === 'web') window.alert('Failed to place booking: ' + e.message);
      else Alert.alert('Error', 'Failed to place booking. ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  if (booked) return (
    <View style={[styles.container, styles.centered, { paddingTop: topInset }]}>
      <View style={styles.successCard}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark-circle" size={64} color="#34C759" />
        </View>
        <Text style={styles.successTitle}>Booking Confirmed!</Text>
        <Text style={styles.successSub}>
          Your repair is booked for {'\n'}
          <Text style={{ fontFamily: 'Inter_700Bold', color: DARK }}>
            {dates.find(d => d.value === selectedDate)?.label} at {selectedTime}
          </Text>
        </Text>
        
        <View style={styles.findingBox}>
          <ActivityIndicator size="small" color={PRIMARY} />
          <Text style={styles.findingText}>Finding technician near you...</Text>
        </View>

        <View style={styles.successDetails}>
          <View style={styles.successRow}>
            <Ionicons name="finger-print" size={16} color={GRAY} />
            <Text style={styles.successDetailText}>ID: {bookingId}</Text>
          </View>
          <View style={styles.successRow}>
            <Ionicons name="phone-portrait" size={16} color={GRAY} />
            <Text style={styles.successDetailText}>{params.brand} {params.model}</Text>
          </View>
          <View style={styles.successRow}>
            <Ionicons name="construct" size={16} color={GRAY} />
            <Text style={styles.successDetailText}>{services.map((s: any) => s.label).join(', ')}</Text>
          </View>
          <View style={styles.successRow}>
            <Ionicons name="location" size={16} color={GRAY} />
            <Text style={styles.successDetailText}>{address}</Text>
          </View>
          <View style={styles.successRow}>
            <Ionicons name="cash" size={16} color={GRAY} />
            <Text style={styles.successDetailText}>₹{total} (Pay after service)</Text>
          </View>
        </View>
        <Pressable style={styles.trackBtn} onPress={() => router.replace(`/repair-tracking?bookingId=${bookingId}` as any)}>
          <Text style={styles.trackBtnText}>Track Repair</Text>
        </Pressable>
        <Pressable style={styles.homeBtn} onPress={() => router.replace('/(tabs)/customer-home' as any)}>
          <Text style={styles.homeBtnText}>Back to Home</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.navBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </Pressable>
        <Text style={styles.navTitle}>Book Repair</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 100 }]}>
        <ReelsPreviewStrip onOpenReel={(reelId) => router.replace({ pathname: '/reels', params: { initialReelId: reelId } } as any)} />

        {/* Location Status */}
        <View style={styles.locationBanner}>
          <Ionicons 
            name={locationStatus === 'captured' ? "location" : "location-outline"} 
            size={16} 
            color={locationStatus === 'captured' ? "#34C759" : GRAY} 
          />
          <Text style={[styles.locationBannerText, locationStatus === 'captured' && { color: '#34C759' }]}>
            {locationStatus === 'requesting' ? 'Capturing location...' : 
             locationStatus === 'captured' ? 'Location captured' : 
             'Using address only'}
          </Text>
        </View>

        {/* Device + Services summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <Ionicons name="phone-portrait" size={20} color={PRIMARY} />
            <Text style={styles.summaryDevice}>{params.brand} {params.model}</Text>
          </View>
          {services.map((s: any) => (
            <View key={s.key} style={styles.summaryService}>
              <Text style={styles.summaryServiceName}>{s.label}</Text>
              <Text style={styles.summaryServicePrice}>₹{s.price}</Text>
            </View>
          ))}
          <View style={styles.summaryDivider} />
          <View style={styles.summaryTotal}>
            <Text style={styles.summaryTotalLabel}>Total Estimate</Text>
            <Text style={styles.summaryTotalPrice}>₹{total}</Text>
          </View>
          <Text style={styles.summaryNote}>* Final price may vary based on inspection</Text>
        </View>

        {/* Date Picker */}
        <Text style={styles.fieldLabel}>Select Date</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingBottom: 4 }}>
          {dates.map(d => (
            <Pressable
              key={d.value}
              style={[styles.dateChip, selectedDate === d.value && styles.dateChipActive]}
              onPress={() => setSelectedDate(d.value)}
            >
              <Text style={[styles.dateChipText, selectedDate === d.value && styles.dateChipTextActive]}>
                {d.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Time Picker */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Select Time Slot</Text>
        <View style={styles.timeGrid}>
          {TIMES.map(t => (
            <Pressable
              key={t}
              style={[styles.timeChip, selectedTime === t && styles.timeChipActive]}
              onPress={() => setSelectedTime(t)}
            >
              <Text style={[styles.timeChipText, selectedTime === t && styles.timeChipTextActive]}>
                {t}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Address */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Pickup Address</Text>
        <TextInput
          style={styles.addressInput}
          placeholder="Enter your full address..."
          placeholderTextColor={GRAY}
          value={address}
          onChangeText={setAddress}
          multiline
          numberOfLines={3}
        />

        {/* Notes */}
        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Additional Notes (optional)</Text>
        <TextInput
          style={[styles.addressInput, { height: 70 }]}
          placeholder="Describe the issue in detail..."
          placeholderTextColor={GRAY}
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        {/* Service Guarantee */}
        <View style={styles.guaranteeCard}>
          {[
            { icon: 'shield-checkmark', text: 'Genuine parts used' },
            { icon: 'person-circle', text: 'Certified technicians' },
            { icon: 'refresh', text: 'Service warranty included' },
          ].map(g => (
            <View key={g.text} style={styles.guaranteeRow}>
              <Ionicons name={g.icon as any} size={16} color="#34C759" />
              <Text style={styles.guaranteeText}>{g.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Book Button */}
      <View style={[styles.bookBar, { paddingBottom: bottomPad }]}>
        <View>
          <Text style={styles.bookBarLabel}>Total Estimate</Text>
          <Text style={styles.bookBarPrice}>₹{total}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.bookBtn, { opacity: pressed ? 0.9 : 1 }]}
          onPress={handleBook}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#FFF" size="small" />
            : <>
                <Text style={styles.bookBtnText}>Confirm Booking</Text>
                <Ionicons name="checkmark" size={18} color="#FFF" />
              </>
          }
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  centered: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  navTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: DARK },
  content: { paddingHorizontal: 16, paddingTop: 4 },
  locationBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, backgroundColor: CARD, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#F0F0F0' },
  locationBannerText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: GRAY },
  summaryCard: { backgroundColor: CARD, borderRadius: 16, padding: 16, marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  summaryDevice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: DARK },
  summaryService: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  summaryServiceName: { fontSize: 14, fontFamily: 'Inter_400Regular', color: DARK },
  summaryServicePrice: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: DARK },
  summaryDivider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 10 },
  summaryTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryTotalLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: DARK },
  summaryTotalPrice: { fontSize: 20, fontFamily: 'Inter_700Bold', color: PRIMARY },
  summaryNote: { fontSize: 11, fontFamily: 'Inter_400Regular', color: GRAY, marginTop: 6 },
  fieldLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: DARK, marginBottom: 10, paddingHorizontal: 0 },
  dateChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: CARD, borderWidth: 1.5, borderColor: '#E5E5EA' },
  dateChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  dateChipText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: DARK },
  dateChipTextActive: { color: '#FFF' },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  timeChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: CARD, borderWidth: 1.5, borderColor: '#E5E5EA', minWidth: '22%' as any, alignItems: 'center' },
  timeChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  timeChipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: DARK },
  timeChipTextActive: { color: '#FFF' },
  addressInput: { backgroundColor: CARD, borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: '#E5E5EA', fontSize: 14, fontFamily: 'Inter_400Regular', color: DARK, textAlignVertical: 'top', marginBottom: 4 },
  guaranteeCard: { backgroundColor: '#EAF7EE', borderRadius: 14, padding: 16, gap: 10, marginTop: 16 },
  guaranteeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  guaranteeText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: DARK },
  bookBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: CARD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0F0F0', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 8 },
  bookBarLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: GRAY },
  bookBarPrice: { fontSize: 20, fontFamily: 'Inter_700Bold', color: DARK },
  bookBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: PRIMARY, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14, gap: 8, shadowColor: PRIMARY, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  bookBtnText: { color: '#FFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  successCard: { backgroundColor: CARD, borderRadius: 24, padding: 28, alignItems: 'center', width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 6 },
  successIcon: { marginBottom: 16 },
  successTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', color: DARK, marginBottom: 8 },
  successSub: { fontSize: 15, fontFamily: 'Inter_400Regular', color: GRAY, textAlign: 'center', marginBottom: 20, lineHeight: 22 },
  findingBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF5F0', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, marginBottom: 20, width: '100%', justifyContent: 'center' },
  findingText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: PRIMARY },
  successDetails: { width: '100%', gap: 10, backgroundColor: BG, borderRadius: 14, padding: 16, marginBottom: 20 },
  successRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  successDetailText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: DARK, flex: 1 },
  trackBtn: { backgroundColor: PRIMARY, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginBottom: 10, width: '100%', alignItems: 'center', shadowColor: PRIMARY, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  trackBtnText: { color: '#FFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  homeBtn: { paddingVertical: 12 },
  homeBtnText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: GRAY },
});
