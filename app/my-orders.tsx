import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Platform,
  RefreshControl, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import {
  Order, OrderStatus, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS,
  RepairBooking, REPAIR_STATUS_LABELS, REPAIR_STATUS_COLORS
} from '@/lib/types';

const C = Colors.light;

type FilterType = 'all' | 'active' | 'completed' | 'repairs';

export default function MyOrdersScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [repairs, setRepairs] = useState<RepairBooking[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const fetchOrders = useCallback(async () => {
    if (!profile) return;
    try {
      const [ordersRes, repairsRes] = await Promise.all([
        apiRequest('GET', `/api/orders?buyerId=${profile.id}`),
        apiRequest('GET', `/api/repair-bookings?customerId=${profile.id}`)
      ]);
      const ordersData = await ordersRes.json();
      const repairsData = await repairsRes.json();
      setOrders(ordersData);
      setRepairs(repairsData);
    } catch (e) {}
  }, [profile?.id]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  };

  const cancelOrder = (orderId: string) => {
    Alert.alert('Cancel Order', 'Are you sure you want to cancel this order?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel', style: 'destructive', onPress: async () => {
          try {
            await apiRequest('PATCH', `/api/orders/${orderId}/status`, { status: 'cancelled' });
            fetchOrders();
          } catch (e) {
            Alert.alert('Error', 'Failed to cancel order');
          }
        }
      },
    ]);
  };

  const confirmDelivery = async (orderId: string) => {
    try {
      await apiRequest('PATCH', `/api/orders/${orderId}/status`, { status: 'completed' });
      fetchOrders();
    } catch (e) {
      Alert.alert('Error', 'Failed to confirm delivery');
    }
  };

  const filtered = orders.filter(o => {
    if (filter === 'active') return ['pending', 'confirmed', 'shipped'].includes(o.status);
    if (filter === 'completed') return ['delivered', 'completed', 'cancelled', 'rejected'].includes(o.status);
    return true;
  });

  const getTimeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const getStatusIcon = (status: OrderStatus): keyof typeof Ionicons.glyphMap => {
    const icons: Record<OrderStatus, keyof typeof Ionicons.glyphMap> = {
      pending: 'time-outline',
      confirmed: 'checkmark-circle-outline',
      shipped: 'airplane-outline',
      delivered: 'archive-outline',
      completed: 'checkmark-done-circle',
      cancelled: 'close-circle-outline',
      rejected: 'ban-outline',
    };
    return icons[status];
  };

  const renderRepair = ({ item }: { item: RepairBooking }) => {
    const statusColor = REPAIR_STATUS_COLORS[item.status];
    
    return (
      <Pressable 
        style={styles.orderCard} 
        onPress={() => router.push({ pathname: '/repair-tracking', params: { bookingId: item.id } })}
      >
        <View style={styles.orderTop}>
          <View style={styles.orderImageWrap}>
            <View style={[styles.orderImage, styles.orderImagePlaceholder]}>
              <Ionicons name="construct" size={24} color={C.primary} />
            </View>
          </View>
          <View style={styles.orderDetails}>
            <Text style={styles.orderTitle} numberOfLines={2}>{item.deviceBrand} {item.deviceModel}</Text>
            <Text style={styles.orderSeller}>{item.repairType}</Text>
            <View style={styles.orderPriceRow}>
              <Text style={styles.orderPrice}>Rs. {item.price}</Text>
            </View>
          </View>
          <View style={styles.orderStatusCol}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>{REPAIR_STATUS_LABELS[item.status]}</Text>
            </View>
            <Text style={styles.orderTime}>{getTimeAgo(item.createdAt)}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  const renderOrder = ({ item }: { item: Order }) => {
    const statusColor = ORDER_STATUS_COLORS[item.status as OrderStatus];
    const canCancel = ['pending', 'confirmed', 'shipped'].includes(item.status);
    const canConfirmDelivery = item.status === 'delivered';

    return (
      <View style={styles.orderCard}>
        <View style={styles.orderTop}>
          <View style={styles.orderImageWrap}>
            {item.productImage ? (
              <Image
                source={{ uri: item.productImage.startsWith('/') ? `${getApiUrl()}${item.productImage}` : item.productImage }}
                style={styles.orderImage}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.orderImage, styles.orderImagePlaceholder]}>
                <Ionicons name={item.sellerRole === 'teacher' ? 'school' : 'cube'} size={24} color={C.textTertiary} />
              </View>
            )}
          </View>
          <View style={styles.orderDetails}>
            <Text style={styles.orderTitle} numberOfLines={2}>{item.productTitle}</Text>
            <Text style={styles.orderSeller}>from {item.sellerName}</Text>
            <View style={styles.orderPriceRow}>
              <Text style={styles.orderPrice}>Rs. {item.totalAmount}</Text>
              {item.quantity > 1 && <Text style={styles.orderQty}>x{item.quantity}</Text>}
            </View>
          </View>
          <View style={styles.orderStatusCol}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
              <Ionicons name={getStatusIcon(item.status as OrderStatus)} size={12} color={statusColor} />
              <Text style={[styles.statusText, { color: statusColor }]}>{ORDER_STATUS_LABELS[item.status as OrderStatus]}</Text>
            </View>
            <Text style={styles.orderTime}>{getTimeAgo(item.createdAt)}</Text>
          </View>
        </View>

        {item.sellerNotes ? (
          <View style={styles.noteRow}>
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={C.textSecondary} />
            <Text style={styles.noteText} numberOfLines={2}>Seller: {item.sellerNotes}</Text>
          </View>
        ) : null}

        {(canCancel || canConfirmDelivery) && (
          <View style={styles.actionRow}>
            {canCancel && (
              <Pressable style={styles.cancelBtn} onPress={() => cancelOrder(item.id)}>
                <Text style={styles.cancelBtnText}>Cancel Order</Text>
              </Pressable>
            )}
            {canConfirmDelivery && (
              <Pressable style={styles.confirmBtn} onPress={() => confirmDelivery(item.id)}>
                <Ionicons name="checkmark" size={16} color="#FFF" />
                <Text style={styles.confirmBtnText}>Received</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </Pressable>
          <Text style={styles.headerTitle}>My Orders</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.filtersRow}>
          {(['all', 'active', 'completed', 'repairs'] as FilterType[]).map(f => (
            <Pressable
              key={f}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'completed' ? 'Past' : 'Repairs'}
              </Text>
            </Pressable>
          ))}
          <Text style={styles.countText}>
            {filter === 'repairs' ? repairs.length : filtered.length} {filter === 'repairs' ? 'repairs' : 'orders'}
          </Text>
        </View>
      </View>

      <FlatList
        data={filter === 'repairs' ? repairs : filtered}
        keyExtractor={item => item.id}
        renderItem={filter === 'repairs' ? renderRepair : (renderOrder as any)}
        contentContainerStyle={[styles.listContent, { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 20 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={56} color={C.textTertiary} />
            <Text style={styles.emptyTitle}>No orders yet</Text>
            <Text style={styles.emptyText}>Your purchases will appear here</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  headerTitle: { color: C.text, fontSize: 20, fontFamily: 'Inter_700Bold' },
  filtersRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filterChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterText: { color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_500Medium' },
  filterTextActive: { color: '#FFF' },
  countText: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular', marginLeft: 'auto' as const },
  listContent: { paddingTop: 8 },
  orderCard: {
    marginHorizontal: 16, marginBottom: 12, backgroundColor: C.surface,
    borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border,
  },
  orderTop: { flexDirection: 'row', gap: 12 },
  orderImageWrap: { borderRadius: 10, overflow: 'hidden' },
  orderImage: { width: 64, height: 64, borderRadius: 10 },
  orderImagePlaceholder: { backgroundColor: C.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  orderDetails: { flex: 1, justifyContent: 'center' },
  orderTitle: { color: C.text, fontSize: 14, fontFamily: 'Inter_600SemiBold', lineHeight: 20 },
  orderSeller: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  orderPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  orderPrice: { color: C.primary, fontSize: 15, fontFamily: 'Inter_700Bold' },
  orderQty: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular' },
  orderStatusCol: { alignItems: 'flex-end', justifyContent: 'space-between' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  orderTime: { color: C.textTertiary, fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 4 },
  noteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border,
  },
  noteText: { color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  actionRow: {
    flexDirection: 'row', gap: 10, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border,
  },
  cancelBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: C.error, alignItems: 'center',
  },
  cancelBtnText: { color: C.error, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  confirmBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12, backgroundColor: '#30D158',
  },
  confirmBtnText: { color: '#FFF', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 100, gap: 12 },
  emptyTitle: { color: C.text, fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { color: C.textTertiary, fontSize: 14, fontFamily: 'Inter_400Regular' },
});
