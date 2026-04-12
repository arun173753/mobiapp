import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, Platform, RefreshControl, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';
import Colors from '@/constants/colors';

const C = Colors.light;
const ORANGE = '#FF6B35';
const GREEN = '#34C759';
const YELLOW = '#FFD60A';

function formatINR(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

type RevenueData = {
  totalRevenue: number;
  totalCommission: number;
  totalEarnings: number;
  availableForWithdrawal: number;
  paidOut: number;
  totalSales: number;
  totalEnrollments: number;
  totalCourses: number;
  currentCommissionPct: number;
  payouts: Array<{
    id: string;
    amount: number;
    status: string;
    upiId: string;
    requestedAt: number;
    paidAt: number;
    adminNotes: string;
  }>;
  recentSales: Array<{
    id: string;
    studentName: string;
    amount: number;
    teacherEarning: number;
    adminCommission: number;
    commissionPercent: string;
    createdAt: number;
  }>;
};

export default function TeacherRevenueScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawUpi, setWithdrawUpi] = useState('');
  const [withdrawBank, setWithdrawBank] = useState('');
  const [withdrawNotes, setWithdrawNotes] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const fetchRevenue = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const res = await apiRequest('GET', `/api/teacher/revenue/${profile.id}`);
      const json = await res.json();
      if (json.success) setData(json);
    } catch (e) {
      console.error('[TeacherRevenue] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => { fetchRevenue(); }, [fetchRevenue]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRevenue();
    setRefreshing(false);
  }, [fetchRevenue]);

  const handleRequestWithdraw = async () => {
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0) {
      setStatusMsg('Enter a valid amount');
      setTimeout(() => setStatusMsg(''), 3000);
      return;
    }
    if (!data || amt > data.availableForWithdrawal) {
      setStatusMsg(`Maximum available: ${formatINR(data?.availableForWithdrawal || 0)}`);
      setTimeout(() => setStatusMsg(''), 3000);
      return;
    }
    if (!withdrawUpi && !withdrawBank) {
      setStatusMsg('Enter UPI ID or bank account details');
      setTimeout(() => setStatusMsg(''), 3000);
      return;
    }
    try {
      setWithdrawing(true);
      const res = await apiRequest('POST', '/api/teacher/payout/request', {
        teacherId: profile!.id,
        teacherName: profile!.name,
        amount: amt,
        upiId: withdrawUpi,
        bankAccount: withdrawBank,
        notes: withdrawNotes,
      });
      const json = await res.json();
      if (json.success) {
        setShowWithdrawModal(false);
        setWithdrawAmount('');
        setWithdrawUpi('');
        setWithdrawBank('');
        setWithdrawNotes('');
        setStatusMsg('Withdrawal request submitted! Admin will process within 2-3 business days.');
        setTimeout(() => setStatusMsg(''), 5000);
        await fetchRevenue();
      } else {
        setStatusMsg(json.message || 'Failed to submit request');
        setTimeout(() => setStatusMsg(''), 3000);
      }
    } catch {
      setStatusMsg('Network error. Please try again.');
      setTimeout(() => setStatusMsg(''), 3000);
    } finally {
      setWithdrawing(false);
    }
  };

  const paddingTop = Platform.OS === 'web' ? webTopInset : insets.top;

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={ORANGE} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: paddingTop + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>Revenue & Earnings</Text>
        <View style={{ width: 24 }} />
      </View>

      {statusMsg ? (
        <View style={s.statusBanner}>
          <Ionicons name="information-circle" size={16} color="#fff" />
          <Text style={s.statusText}>{statusMsg}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: Platform.OS === 'web' ? 34 : 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ORANGE} colors={[ORANGE]} />}
      >
        {data?.currentCommissionPct !== undefined && (
          <View style={s.commissionBanner}>
            <Ionicons name="information-circle-outline" size={16} color={YELLOW} />
            <Text style={s.commissionBannerText}>
              Platform commission: <Text style={{ fontWeight: '700', color: YELLOW }}>{data.currentCommissionPct}%</Text>
              {'  '}Your share: <Text style={{ fontWeight: '700', color: GREEN }}>{100 - data.currentCommissionPct}%</Text>
            </Text>
          </View>
        )}

        <View style={s.statsGrid}>
          <View style={[s.statCard, { borderLeftColor: GREEN }]}>
            <Ionicons name="wallet-outline" size={22} color={GREEN} />
            <Text style={s.statValue}>{formatINR(data?.totalEarnings || 0)}</Text>
            <Text style={s.statLabel}>Net Earnings</Text>
          </View>
          <View style={[s.statCard, { borderLeftColor: ORANGE }]}>
            <Ionicons name="cash-outline" size={22} color={ORANGE} />
            <Text style={s.statValue}>{formatINR(data?.totalRevenue || 0)}</Text>
            <Text style={s.statLabel}>Total Sales</Text>
          </View>
          <View style={[s.statCard, { borderLeftColor: '#FF3B30' }]}>
            <Ionicons name="trending-down-outline" size={22} color="#FF3B30" />
            <Text style={s.statValue}>{formatINR(data?.totalCommission || 0)}</Text>
            <Text style={s.statLabel}>Commission Deducted</Text>
          </View>
          <View style={[s.statCard, { borderLeftColor: YELLOW }]}>
            <Ionicons name="arrow-up-circle-outline" size={22} color={YELLOW} />
            <Text style={s.statValue}>{formatINR(data?.availableForWithdrawal || 0)}</Text>
            <Text style={s.statLabel}>Available to Withdraw</Text>
          </View>
          <View style={[s.statCard, { borderLeftColor: '#5E8BFF' }]}>
            <Ionicons name="people-outline" size={22} color="#5E8BFF" />
            <Text style={s.statValue}>{data?.totalSales || 0}</Text>
            <Text style={s.statLabel}>Paid Enrollments</Text>
          </View>
          <View style={[s.statCard, { borderLeftColor: '#AF52DE' }]}>
            <Ionicons name="school-outline" size={22} color="#AF52DE" />
            <Text style={s.statValue}>{data?.totalCourses || 0}</Text>
            <Text style={s.statLabel}>Courses</Text>
          </View>
        </View>

        <Pressable
          style={[s.withdrawBtn, (!data?.availableForWithdrawal || data.availableForWithdrawal < 100) && s.withdrawBtnDisabled]}
          onPress={() => setShowWithdrawModal(true)}
          disabled={!data?.availableForWithdrawal || data.availableForWithdrawal < 100}
        >
          <Ionicons name="arrow-up-circle" size={20} color="#fff" />
          <Text style={s.withdrawBtnText}>Request Withdrawal</Text>
        </Pressable>
        {data?.availableForWithdrawal !== undefined && data.availableForWithdrawal < 100 && (
          <Text style={s.minWithdrawNote}>Minimum withdrawal amount: ₹100</Text>
        )}

        {(data?.recentSales?.length ?? 0) > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Recent Sales</Text>
            {data!.recentSales.map((sale, i) => (
              <View key={sale.id} style={[s.saleRow, i === data!.recentSales.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.saleName}>{sale.studentName}</Text>
                  <Text style={s.saleDate}>{timeAgo(sale.createdAt)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.saleTotal}>{formatINR((sale.amount || 0) / 100)}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                    <Text style={s.saleCommission}>-{formatINR((sale.adminCommission || 0) / 100)} ({sale.commissionPercent}%)</Text>
                    <Text style={s.saleEarning}>{formatINR((sale.teacherEarning || 0) / 100)}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {(data?.payouts?.length ?? 0) > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Withdrawal History</Text>
            {data!.payouts.map((payout, i) => {
              const statusColor = payout.status === 'paid' ? GREEN : payout.status === 'processing' ? YELLOW : '#999';
              return (
                <View key={payout.id} style={[s.payoutRow, i === data!.payouts.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.payoutAmount}>{formatINR((payout.amount || 0) / 100)}</Text>
                    <Text style={s.payoutDate}>
                      {payout.upiId ? `UPI: ${payout.upiId}` : 'Bank Transfer'}
                    </Text>
                    {payout.adminNotes ? <Text style={s.payoutNotes}>{payout.adminNotes}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={[s.statusBadge, { backgroundColor: statusColor + '20' }]}>
                      <Text style={[s.statusBadgeText, { color: statusColor }]}>
                        {payout.status.charAt(0).toUpperCase() + payout.status.slice(1)}
                      </Text>
                    </View>
                    <Text style={s.payoutDate}>{timeAgo(payout.requestedAt)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {data?.totalSales === 0 && (
          <View style={s.emptyState}>
            <Ionicons name="school-outline" size={48} color={C.textTertiary} />
            <Text style={s.emptyTitle}>No sales yet</Text>
            <Text style={s.emptyText}>When students enroll in your courses, your earnings will appear here</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={showWithdrawModal} animationType="slide" transparent onRequestClose={() => setShowWithdrawModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Request Withdrawal</Text>
              <Pressable onPress={() => setShowWithdrawModal(false)}>
                <Ionicons name="close" size={24} color={C.text} />
              </Pressable>
            </View>
            <Text style={s.modalSubtitle}>
              Available: <Text style={{ color: GREEN, fontWeight: '700' }}>{formatINR(data?.availableForWithdrawal || 0)}</Text>
            </Text>
            <Text style={s.fieldLabel}>Amount (₹)</Text>
            <TextInput
              style={s.input}
              value={withdrawAmount}
              onChangeText={setWithdrawAmount}
              placeholder="Enter amount"
              placeholderTextColor={C.textTertiary}
              keyboardType="number-pad"
            />
            <Text style={s.fieldLabel}>UPI ID</Text>
            <TextInput
              style={s.input}
              value={withdrawUpi}
              onChangeText={setWithdrawUpi}
              placeholder="yourname@upi"
              placeholderTextColor={C.textTertiary}
              autoCapitalize="none"
            />
            <Text style={s.fieldLabel}>Bank Account (optional)</Text>
            <TextInput
              style={s.input}
              value={withdrawBank}
              onChangeText={setWithdrawBank}
              placeholder="Account No · IFSC"
              placeholderTextColor={C.textTertiary}
            />
            <Text style={s.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[s.input, { minHeight: 60 }]}
              value={withdrawNotes}
              onChangeText={setWithdrawNotes}
              placeholder="Any additional info"
              placeholderTextColor={C.textTertiary}
              multiline
            />
            {statusMsg ? <Text style={s.modalError}>{statusMsg}</Text> : null}
            <Pressable
              style={[s.submitBtn, withdrawing && { opacity: 0.6 }]}
              onPress={handleRequestWithdraw}
              disabled={withdrawing}
            >
              {withdrawing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={s.submitBtnText}>Submit Request</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: {
    color: C.text,
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },

  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1A3A5C',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  statusText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },

  commissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1A1500',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: YELLOW + '30',
  },
  commissionBannerText: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },

  content: { padding: 16 },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    width: '47%' as any,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 3,
    gap: 6,
  },
  statValue: {
    color: C.text,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  statLabel: {
    color: C.textTertiary,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },

  withdrawBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ORANGE,
    borderRadius: 14,
    height: 50,
    marginBottom: 8,
  },
  withdrawBtnDisabled: { opacity: 0.5 },
  withdrawBtnText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  minWithdrawNote: {
    color: C.textTertiary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 16,
  },

  section: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  sectionTitle: {
    color: C.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },

  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  saleName: {
    color: C.text,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  saleDate: {
    color: C.textTertiary,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  saleTotal: {
    color: C.text,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  saleCommission: {
    color: '#FF3B30',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  saleEarning: {
    color: GREEN,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },

  payoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  payoutAmount: {
    color: C.text,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  payoutDate: {
    color: C.textTertiary,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  payoutNotes: {
    color: ORANGE,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  emptyText: {
    color: C.textTertiary,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    color: C.text,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  modalSubtitle: {
    color: C.textSecondary,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 16,
  },
  fieldLabel: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: C.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: C.text,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  modalError: {
    color: '#FF3B30',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 8,
    textAlign: 'center',
  },
  submitBtn: {
    backgroundColor: ORANGE,
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});
