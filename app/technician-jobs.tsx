import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Platform,
  RefreshControl, Alert, Animated
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';
import { playOrderSound } from '@/lib/notifications';

const C = Colors.light;

interface RepairBooking {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  deviceBrand: string;
  deviceModel: string;
  repairType: string;
  price: string;
  address?: string;
  latitude?: string;
  longitude?: string;
  bookingDate: string;
  bookingTime: string;
  status: 'pending' | 'assigned' | 'on_the_way' | 'repair_started' | 'completed' | 'cancelled' | 'timed_out';
  technicianId?: string;
  technicianName?: string;
  technicianPhone?: string;
  notes?: string;
  createdAt: number;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'New Request',
  assigned: 'Assigned',
  on_the_way: 'On The Way',
  repair_started: 'Repairing',
  completed: 'Completed',
  cancelled: 'Cancelled',
  timed_out: 'Timed Out',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#FF9F0A',
  assigned: '#007AFF',
  on_the_way: '#5856D6',
  repair_started: '#AF52DE',
  completed: '#34C759',
  cancelled: '#FF3B30',
  timed_out: '#8E8E93',
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function JobCard({ 
  job, 
  userLat, 
  userLng, 
  onAccept, 
  onReject, 
  onUpdateStatus 
}: { 
  job: RepairBooking, 
  userLat?: number, 
  userLng?: number,
  onAccept: (id: string) => void,
  onReject: (id: string) => void,
  onUpdateStatus: (id: string, status: string) => void
}) {
  const [timeLeft, setTimeLeft] = useState(60);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (job.status === 'pending') {
      const elapsed = Math.floor((Date.now() - job.createdAt) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      setTimeLeft(remaining);

      if (remaining > 0) {
        timerRef.current = setInterval(() => {
          setTimeLeft(prev => {
            if (prev <= 1) {
              if (timerRef.current) clearInterval(timerRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [job.status, job.createdAt]);

  const distance = userLat && userLng && job.latitude && job.longitude 
    ? haversine(userLat, userLng, parseFloat(job.latitude), parseFloat(job.longitude)).toFixed(1)
    : null;

  const statusColor = STATUS_COLORS[job.status] || C.textTertiary;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{STATUS_LABELS[job.status]}</Text>
        </View>
        {job.status === 'pending' && timeLeft > 0 && (
          <View style={styles.timerContainer}>
            <Ionicons name="time-outline" size={14} color={C.error} />
            <Text style={styles.timerText}>{timeLeft}s</Text>
          </View>
        )}
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.jobTitle}>{job.deviceBrand} {job.deviceModel}</Text>
        <Text style={styles.jobSubtitle}>{job.repairType}</Text>
        
        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={14} color={C.textSecondary} />
          <Text style={styles.infoText}>{job.customerName}</Text>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={14} color={C.textSecondary} />
          <Text style={styles.infoText} numberOfLines={1}>{job.address || 'No address provided'}</Text>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="calendar-outline" size={14} color={C.textSecondary} />
          <Text style={styles.infoText}>{job.bookingDate} at {job.bookingTime}</Text>
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.priceText}>Rs. {job.price}</Text>
          {distance && <Text style={styles.distanceText}>{distance} km away</Text>}
        </View>
      </View>

      <View style={styles.cardActions}>
        {job.status === 'pending' && timeLeft > 0 ? (
          <>
            <Pressable style={[styles.actionBtn, styles.rejectBtn]} onPress={() => onReject(job.id)}>
              <Text style={styles.rejectBtnText}>Reject</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, styles.acceptBtn]} onPress={() => onAccept(job.id)}>
              <Text style={styles.acceptBtnText}>Accept</Text>
            </Pressable>
          </>
        ) : job.status === 'assigned' ? (
          <Pressable style={[styles.actionBtn, styles.statusUpdateBtn]} onPress={() => onUpdateStatus(job.id, 'on_the_way')}>
            <Text style={styles.statusUpdateBtnText}>On My Way</Text>
          </Pressable>
        ) : job.status === 'on_the_way' ? (
          <Pressable style={[styles.actionBtn, styles.statusUpdateBtn]} onPress={() => onUpdateStatus(job.id, 'repair_started')}>
            <Text style={styles.statusUpdateBtnText}>Start Repair</Text>
          </Pressable>
        ) : job.status === 'repair_started' ? (
          <Pressable style={[styles.actionBtn, styles.statusUpdateBtn, { backgroundColor: '#34C759' }]} onPress={() => onUpdateStatus(job.id, 'completed')}>
            <Text style={styles.statusUpdateBtnText}>Mark Completed</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function TechnicianJobsScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const [jobs, setJobs] = useState<RepairBooking[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'active'>('pending');
  const [refreshing, setRefreshing] = useState(false);
  const knownJobIds = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);

  const fetchJobs = useCallback(async () => {
    if (!profile) return;
    try {
      const res = await apiRequest('GET', `/api/repair-bookings?technicianId=${profile.id}`);
      const data = await res.json();
      
      if (isFirstLoad.current) {
        data.forEach((j: RepairBooking) => knownJobIds.current.add(j.id));
        isFirstLoad.current = false;
      } else {
        const newJobs = data.filter((j: RepairBooking) => !knownJobIds.current.has(j.id) && j.status === 'pending');
        if (newJobs.length > 0) {
          playOrderSound();
          if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        data.forEach((j: RepairBooking) => knownJobIds.current.add(j.id));
      }
      setJobs(data);
    } catch (e) {
      console.error('Failed to fetch jobs:', e);
    }
  }, [profile?.id]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 8000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchJobs();
    setRefreshing(false);
  };

  const updateJobStatus = async (id: string, status: string) => {
    try {
      const body: any = { status };
      if (status === 'assigned') {
        body.technicianId = profile?.id;
        body.technicianName = profile?.name;
        body.technicianPhone = profile?.phone;
      }
      await apiRequest('PATCH', `/api/repair-bookings/${id}/status`, body);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchJobs();
    } catch (e) {
      Alert.alert('Error', 'Failed to update job status');
    }
  };

  const openLearnLink = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/admin/links');
      const data = await res.json();
      const learnLink = data?.learn_link;
      if (learnLink) {
        await WebBrowser.openBrowserAsync(learnLink);
      } else {
        Alert.alert('Learn Link Not Set', 'The learn link has not been configured yet.');
      }
    } catch (e) {
      console.error('[Learn] Error:', e);
      Alert.alert('Error', 'Unable to open learn link');
    }
  }, []);

  const filteredJobs = jobs.filter(j => {
    if (activeTab === 'pending') return j.status === 'pending';
    return ['assigned', 'on_the_way', 'repair_started'].includes(j.status);
  });

  const userLat = profile?.latitude ? parseFloat(profile.latitude) : undefined;
  const userLng = profile?.longitude ? parseFloat(profile.longitude) : undefined;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Repair Jobs</Text>
          <Pressable onPress={openLearnLink} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#FF6B2C15' }}>
            <Ionicons name="book-outline" size={18} color="#FF6B2C" />
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#FF6B2C' }}>Learn</Text>
          </Pressable>
        </View>

        <View style={styles.tabs}>
          <Pressable 
            style={[styles.tab, activeTab === 'pending' && styles.activeTab]} 
            onPress={() => setActiveTab('pending')}
          >
            <Text style={[styles.tabText, activeTab === 'pending' && styles.activeTabText]}>Requests</Text>
            {jobs.filter(j => j.status === 'pending').length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{jobs.filter(j => j.status === 'pending').length}</Text>
              </View>
            )}
          </Pressable>
          <Pressable 
            style={[styles.tab, activeTab === 'active' && styles.activeTab]} 
            onPress={() => setActiveTab('active')}
          >
            <Text style={[styles.tabText, activeTab === 'active' && styles.activeTabText]}>Active</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={filteredJobs}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <JobCard 
            job={item} 
            userLat={userLat}
            userLng={userLng}
            onAccept={(id) => updateJobStatus(id, 'assigned')}
            onReject={(id) => updateJobStatus(id, 'cancelled')}
            onUpdateStatus={updateJobStatus}
          />
        )}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 20 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="construct-outline" size={64} color={C.textTertiary} />
            <Text style={styles.emptyTitle}>No jobs found</Text>
            <Text style={styles.emptyText}>
              {activeTab === 'pending' ? 'New repair requests will appear here.' : 'You have no active jobs at the moment.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: { backgroundColor: '#FFF', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text },
  tabs: { flexDirection: 'row', gap: 16 },
  tab: { paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeTab: { borderBottomColor: C.primary },
  tabText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.textSecondary },
  activeTabText: { color: C.primary },
  badge: { backgroundColor: C.error, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#FFF', fontSize: 10, fontFamily: 'Inter_700Bold' },
  list: { padding: 16 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, borderWidth: 1, borderColor: '#F0F0F0' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  timerContainer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timerText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.error },
  cardBody: { gap: 4 },
  jobTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  jobSubtitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.primary, marginBottom: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  infoText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSecondary, flex: 1 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  priceText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  distanceText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textTertiary },
  cardActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  actionBtn: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  acceptBtn: { backgroundColor: '#34C759' },
  acceptBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
  rejectBtn: { backgroundColor: '#FFF', borderWidth: 1, borderColor: C.error },
  rejectBtnText: { color: C.error, fontSize: 15, fontFamily: 'Inter_700Bold' },
  statusUpdateBtn: { backgroundColor: C.primary },
  statusUpdateBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 100, gap: 16, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textTertiary, textAlign: 'center' },
});