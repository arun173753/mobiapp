import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Platform,
  ActivityIndicator, Linking, RefreshControl
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import { RepairBooking, REPAIR_STATUS_LABELS, REPAIR_STATUS_COLORS, RepairStatus } from '@/lib/types';

const C = Colors.light;

export default function RepairTrackingScreen() {
  const insets = useSafeAreaInsets();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [booking, setBooking] = useState<RepairBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBooking = useCallback(async () => {
    if (!bookingId) return;
    try {
      const res = await apiRequest('GET', `/api/repair-bookings/${bookingId}`);
      const data = await res.json();
      setBooking(data);
    } catch (e) {
      console.error('Failed to fetch booking:', e);
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    fetchBooking();
    const interval = setInterval(fetchBooking, 10000);
    return () => clearInterval(interval);
  }, [fetchBooking]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBooking();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (!booking) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Booking not found</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const steps: { status: RepairStatus; label: string }[] = [
    { status: 'pending', label: 'Booking Confirmed' },
    { status: 'assigned', label: 'Technician Assigned' },
    { status: 'on_the_way', label: 'On The Way' },
    { status: 'repair_started', label: 'Repair Started' },
    { status: 'completed', label: 'Completed' },
  ];

  const currentStatusIndex = steps.findIndex(s => s.status === booking.status);
  const isCancelled = booking.status === 'cancelled';

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backIcon}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Track Repair</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        <View style={styles.card}>
          <View style={styles.statusHeader}>
            <View style={[styles.statusBadge, { backgroundColor: REPAIR_STATUS_COLORS[booking.status] + '22' }]}>
              <Text style={[styles.statusText, { color: REPAIR_STATUS_COLORS[booking.status] }]}>
                {REPAIR_STATUS_LABELS[booking.status]}
              </Text>
            </View>
            <Text style={styles.bookingId}>ID: {booking.id.substring(0, 8)}</Text>
          </View>

          <Text style={styles.deviceTitle}>{booking.deviceBrand} {booking.deviceModel}</Text>
          <Text style={styles.repairType}>{booking.repairType}</Text>
          <Text style={styles.price}>Rs. {booking.price}</Text>
        </View>

        {booking.technicianId && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Assigned Technician</Text>
            <View style={styles.techRow}>
              <View style={styles.techAvatar}>
                <Ionicons name="person" size={24} color={C.textTertiary} />
              </View>
              <View style={styles.techInfo}>
                <Text style={styles.techName}>{booking.technicianName}</Text>
                <Text style={styles.techStatus}>Verified Technician</Text>
              </View>
              {booking.technicianPhone && (
                <Pressable
                  style={styles.callBtn}
                  onPress={() => Linking.openURL(`tel:${booking.technicianPhone}`)}
                >
                  <Ionicons name="call" size={20} color="#FFF" />
                </Pressable>
              )}
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Repair Status</Text>
          <View style={styles.timeline}>
            {steps.map((step, index) => {
              const isCompleted = currentStatusIndex >= index;
              const isCurrent = currentStatusIndex === index;
              const isLast = index === steps.length - 1;

              return (
                <View key={step.status} style={styles.timelineStep}>
                  <View style={styles.timelineLeft}>
                    <View style={[
                      styles.dot,
                      isCompleted && styles.dotCompleted,
                      isCurrent && styles.dotCurrent
                    ]}>
                      {isCompleted && !isCurrent && <Ionicons name="checkmark" size={12} color="#FFF" />}
                    </View>
                    {!isLast && <View style={[styles.line, isCompleted && currentStatusIndex > index && styles.lineCompleted]} />}
                  </View>
                  <View style={styles.timelineRight}>
                    <Text style={[
                      styles.stepLabel,
                      isCompleted && styles.stepLabelCompleted,
                      isCurrent && styles.stepLabelCurrent
                    ]}>
                      {step.label}
                    </Text>
                    {isCurrent && (
                      <Text style={styles.stepTime}>
                        {REPAIR_STATUS_LABELS[booking.status]}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
            {isCancelled && (
              <View style={styles.timelineStep}>
                <View style={styles.timelineLeft}>
                  <View style={[styles.dot, { backgroundColor: C.error }]}>
                    <Ionicons name="close" size={12} color="#FFF" />
                  </View>
                </View>
                <View style={styles.timelineRight}>
                  <Text style={[styles.stepLabel, { color: C.error }]}>Cancelled</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Booking Details</Text>
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={18} color={C.textTertiary} />
            <Text style={styles.detailText}>{booking.bookingDate} at {booking.bookingTime}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={18} color={C.textTertiary} />
            <Text style={styles.detailText}>{booking.address}</Text>
          </View>
          {booking.notes ? (
            <View style={styles.detailRow}>
              <Ionicons name="document-text-outline" size={18} color={C.textTertiary} />
              <Text style={styles.detailText}>{booking.notes}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: C.surface,
  },
  backIcon: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.background },
  content: { padding: 16 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  bookingId: { fontSize: 12, color: C.textTertiary, fontFamily: 'Inter_400Regular' },
  deviceTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 4 },
  repairType: { fontSize: 14, color: C.textSecondary, marginBottom: 8 },
  price: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.primary },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 16 },
  techRow: { flexDirection: 'row', alignItems: 'center' },
  techAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  techInfo: { flex: 1 },
  techName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  techStatus: { fontSize: 12, color: C.success, marginTop: 2 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeline: { paddingLeft: 8 },
  timelineStep: { flexDirection: 'row', minHeight: 60 },
  timelineLeft: { alignItems: 'center', marginRight: 16, width: 24 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.surfaceHighlight,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  dotCompleted: { backgroundColor: C.primary, borderColor: C.primary },
  dotCurrent: { backgroundColor: C.primary, borderColor: C.primary, transform: [{ scale: 1.2 }] },
  line: {
    position: 'absolute',
    top: 24,
    bottom: 0,
    width: 2,
    backgroundColor: C.border,
  },
  lineCompleted: { backgroundColor: C.primary },
  timelineRight: { flex: 1, paddingTop: 2 },
  stepLabel: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textTertiary },
  stepLabelCompleted: { color: C.textSecondary },
  stepLabelCurrent: { color: C.primary, fontFamily: 'Inter_700Bold' },
  stepTime: { fontSize: 12, color: C.textTertiary, marginTop: 2 },
  detailRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  detailText: { fontSize: 14, color: C.textSecondary, marginLeft: 12, flex: 1 },
  errorText: { fontSize: 16, color: C.error, marginBottom: 16 },
  backBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 8 },
  backBtnText: { color: '#FFF', fontFamily: 'Inter_600SemiBold' },
});
