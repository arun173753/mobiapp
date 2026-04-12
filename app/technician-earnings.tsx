import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Platform, RefreshControl
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';

const C = Colors.light;
const PRIMARY = '#FF6B2C';

export default function TechnicianEarningsScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    todayEarnings: 0,
    totalEarnings: 0,
    completedJobs: 0,
    recentJobs: [] as any[]
  });

  const fetchEarnings = async () => {
    if (!profile?.id) return;
    try {
      const res = await apiRequest('GET', `/api/repair-bookings?technicianId=${profile.id}&status=completed`);
      const bookings = await res.json();
      
      if (Array.isArray(bookings)) {
        const today = new Date().toISOString().split('T')[0];
        let todaySum = 0;
        let totalSum = 0;
        
        bookings.forEach((b: any) => {
          const price = parseFloat(b.price || '0');
          totalSum += price;
          if (b.bookingDate === today) {
            todaySum += price;
          }
        });

        setStats({
          todayEarnings: todaySum,
          totalEarnings: totalSum,
          completedJobs: bookings.length,
          recentJobs: bookings.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 10)
        });
      }
    } catch (e) {
      console.error('[Earnings] Fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchEarnings();
  }, [profile?.id]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchEarnings();
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1A1A1A" />
        </Pressable>
        <Text style={styles.headerTitle}>My Earnings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />}
      >
        {/* Stats Cards */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Today's Earnings</Text>
            <Text style={[styles.statValue, { color: PRIMARY }]}>₹{stats.todayEarnings}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Total Completed</Text>
            <Text style={styles.statValue}>{stats.completedJobs}</Text>
          </View>
        </View>

        <View style={[styles.statCard, { marginBottom: 20 }]}>
          <Text style={styles.statLabel}>Total Lifetime Earnings</Text>
          <Text style={[styles.statValue, { fontSize: 32, color: '#34C759' }]}>₹{stats.totalEarnings}</Text>
        </View>

        {/* Recent Jobs */}
        <Text style={styles.sectionTitle}>Recent Completed Jobs</Text>
        {stats.recentJobs.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cash-outline" size={48} color="#CCC" />
            <Text style={styles.emptyText}>No completed jobs yet</Text>
          </View>
        ) : (
          stats.recentJobs.map((job) => (
            <View key={job.id} style={styles.jobCard}>
              <View style={styles.jobInfo}>
                <Text style={styles.jobTitle}>{job.deviceBrand} {job.deviceModel}</Text>
                <Text style={styles.jobSubtitle}>{job.repairType}</Text>
                <Text style={styles.jobDate}>{job.bookingDate}</Text>
              </View>
              <Text style={styles.jobPrice}>+₹{job.price}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
    marginLeft: 4,
  },
  jobCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  jobInfo: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  jobSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  jobDate: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  jobPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#34C759',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    backgroundColor: '#FFF',
    borderRadius: 16,
  },
  emptyText: {
    marginTop: 12,
    color: '#888',
    fontSize: 14,
  },
});
