import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Platform,
  RefreshControl, Alert, Modal, TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { Order, OrderStatus, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/lib/types';
import { playOrderSound, showOrderNotification } from '@/lib/notifications';

const C = Colors.light;

type FilterType = 'all' | 'pending' | 'active' | 'completed';

export default function SellerOrdersScreen() {
  const insets = useSafeAreaInsets();
  const { profile, startConversation } = useApp();
  const [orders, setOrders] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [noteModal, setNoteModal] = useState<{ orderId: string; status: string } | null>(null);
  const [sellerNote, setSellerNote] = useState('');
  const knownOrderIds = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const fetchOrders = useCallback(async () => {
    if (!profile) return;
    try {
      const res = await apiRequest('GET', `/api/orders?sellerId=${profile.id}`);
      const data = await res.json();
      if (isFirstLoad.current) {
        data.forEach((o: Order) => knownOrderIds.current.add(o.id));
        isFirstLoad.current = false;
      } else {
        const newOrders = data.filter((o: Order) => !knownOrderIds.current.has(o.id));
        if (newOrders.length > 0) {
          const latest = newOrders[0];
          playOrderSound();
          showOrderNotification(latest.buyerName || 'Someone', latest.productTitle || 'your item');
          if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        data.forEach((o: Order) => knownOrderIds.current.add(o.id));
      }
      setOrders(data);
    } catch (e) {}
  }, [profile?.id]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 8000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  };

  const updateStatus = async (orderId: string, status: string, notes?: string) => {
    try {
      const body: any = { status };
      if (notes) body.sellerNotes = notes;
      await apiRequest('PATCH', `/api/orders/${orderId}/status`, body);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchOrders();
    } catch (e) {
      Alert.alert('Error', 'Failed to update order');
    }
  };

  const showStatusAction = (order: Order) => {
    const actions: { text: string; status: string; needsNote?: boolean }[] = [];

    if (order.status === 'pending') {
      actions.push({ text: 'Confirm Order', status: 'confirmed' });
      actions.push({ text: 'Reject Order', status: 'rejected', needsNote: true });
    } else if (order.status === 'confirmed') {
      if (order.sellerRole === 'teacher') {
        actions.push({ text: 'Grant Access', status: 'delivered', needsNote: true });
      } else {
        actions.push({ text: 'Mark Shipped', status: 'shipped', needsNote: true });
      }
    } else if (order.status === 'shipped') {
      actions.push({ text: 'Mark Delivered', status: 'delivered' });
    }

    if (actions.length === 0) return;

    const buttons: { text: string; onPress: () => void; style?: 'destructive' | 'cancel' | 'default' }[] = actions.map(a => ({
      text: a.text,
      onPress: () => {
        if (a.needsNote) {
          setNoteModal({ orderId: order.id, status: a.status });
          setSellerNote('');
        } else {
          updateStatus(order.id, a.status);
        }
      },
      style: a.status === 'rejected' ? 'destructive' as const : 'default' as const,
    }));
    buttons.push({ text: 'Cancel', onPress: () => {}, style: 'cancel' as const });

    Alert.alert('Update Order', `Order from ${order.buyerName}`, buttons);
  };

  const contactBuyer = async (order: Order) => {
    if (!profile) return;
    try {
      const convoId = await startConversation(order.buyerId, order.buyerName, 'technician');
      if (convoId) router.push({ pathname: '/chat/[id]', params: { id: convoId } });
    } catch (e) {}
  };

  const filtered = orders.filter(o => {
    if (filter === 'pending') return o.status === 'pending';
    if (filter === 'active') return ['confirmed', 'shipped'].includes(o.status);
    if (filter === 'completed') return ['delivered', 'completed', 'cancelled', 'rejected'].includes(o.status);
    return true;
  });

  const pendingCount = orders.filter(o => o.status === 'pending').length;

  const getTimeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const deleteOrder = (orderId: string) => {
    Alert.alert('Delete Order', 'Are you sure you want to delete this order record?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await apiRequest('DELETE', `/api/orders/${orderId}?sellerId=${profile?.id}`);
            setOrders(prev => prev.filter(o => o.id !== orderId));
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (e) {
            Alert.alert('Error', 'Failed to delete order');
          }
        }
      },
    ]);
  };

  const renderOrder = ({ item }: { item: Order }) => {
    const statusColor = ORDER_STATUS_COLORS[item.status as OrderStatus];
    const isPending = item.status === 'pending';
    const isActionable = ['pending', 'confirmed', 'shipped'].includes(item.status);

    return (
      <Pressable
        style={[styles.orderCard, isPending && styles.orderCardPending]}
        onPress={() => router.push({ pathname: '/order-detail', params: { id: item.id } } as any)}
      >
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
                <Ionicons name="cube" size={20} color={C.textTertiary} />
              </View>
            )}
          </View>
          <View style={styles.orderDetails}>
            <Text style={styles.orderTitle} numberOfLines={1}>{item.productTitle}</Text>
            <View style={styles.buyerRow}>
              <Ionicons name="person-outline" size={12} color={C.textTertiary} />
              <Text style={styles.buyerName}>{item.buyerName}</Text>
              {item.buyerCity ? <Text style={styles.buyerLoc}>({item.buyerCity})</Text> : null}
            </View>
            <View style={styles.orderPriceRow}>
              <Text style={styles.orderPrice}>Rs. {item.totalAmount}</Text>
              {item.quantity > 1 && <Text style={styles.orderQty}>x{item.quantity}</Text>}
            </View>
          </View>
          <View style={styles.orderStatusCol}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable onPress={() => deleteOrder(item.id)} hitSlop={10}>
                <Ionicons name="trash-outline" size={16} color={C.error} />
              </Pressable>
              <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
                <Text style={[styles.statusText, { color: statusColor }]}>{ORDER_STATUS_LABELS[item.status as OrderStatus]}</Text>
              </View>
            </View>
            <Text style={styles.orderTime}>{getTimeAgo(item.createdAt)}</Text>
          </View>
        </View>

        {item.shippingAddress ? (
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={14} color={C.textSecondary} />
            <Text style={styles.addressText} numberOfLines={2}>{item.shippingAddress}</Text>
          </View>
        ) : null}

        {item.buyerNotes ? (
          <View style={styles.noteRow}>
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={C.textSecondary} />
            <Text style={styles.noteText} numberOfLines={2}>Buyer: {item.buyerNotes}</Text>
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable style={styles.chatBuyerBtn} onPress={() => contactBuyer(item)}>
            <Ionicons name="chatbubble-outline" size={16} color={C.primary} />
            <Text style={styles.chatBuyerText}>Chat</Text>
          </Pressable>
          {isActionable && (
            <Pressable style={styles.updateBtn} onPress={() => showStatusAction(item)}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#FFF" />
              <Text style={styles.updateBtnText}>
                {isPending ? 'Respond' : 'Update'}
              </Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Orders Received</Text>
          {pendingCount > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
            </View>
          )}
          {pendingCount === 0 && <View style={{ width: 24 }} />}
        </View>

        <View style={styles.filtersRow}>
          {(['all', 'pending', 'active', 'completed'] as FilterType[]).map(f => (
            <Pressable
              key={f}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f === 'all' ? 'All' : f === 'pending' ? 'New' : f === 'active' ? 'In Progress' : 'Past'}
              </Text>
              {f === 'pending' && pendingCount > 0 && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{pendingCount}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderOrder}
        contentContainerStyle={[styles.listContent, { paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 20 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={56} color={C.textTertiary} />
            <Text style={styles.emptyTitle}>No orders yet</Text>
            <Text style={styles.emptyText}>When customers order your products, they'll appear here</Text>
          </View>
        }
      />

      <Modal visible={!!noteModal} transparent animationType="fade" onRequestClose={() => setNoteModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {noteModal?.status === 'rejected' ? 'Reason for Rejection' :
               noteModal?.status === 'delivered' ? 'Access / Delivery Details' :
               'Shipping Details'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={sellerNote}
              onChangeText={setSellerNote}
              placeholder={
                noteModal?.status === 'rejected' ? 'Why are you rejecting this order?' :
                noteModal?.status === 'delivered' ? 'Share access link or delivery details...' :
                'Tracking number, courier name, etc...'
              }
              placeholderTextColor={C.textTertiary}
              multiline
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setNoteModal(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, noteModal?.status === 'rejected' && { backgroundColor: C.error }]}
                onPress={() => {
                  if (noteModal) {
                    updateStatus(noteModal.orderId, noteModal.status, sellerNote);
                    setNoteModal(null);
                  }
                }}
              >
                <Text style={styles.modalConfirmText}>
                  {noteModal?.status === 'rejected' ? 'Reject' : 'Confirm'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { paddingHorizontal: 16, paddingBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  headerTitle: { color: C.text, fontSize: 20, fontFamily: 'Inter_700Bold' },
  pendingBadge: {
    backgroundColor: C.error, width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  pendingBadgeText: { color: '#FFF', fontSize: 12, fontFamily: 'Inter_700Bold' },
  filtersRow: { flexDirection: 'row', gap: 8 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterText: { color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_500Medium' },
  filterTextActive: { color: '#FFF' },
  filterBadge: {
    backgroundColor: C.error, width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  filterBadgeText: { color: '#FFF', fontSize: 10, fontFamily: 'Inter_700Bold' },
  listContent: { paddingTop: 8 },
  orderCard: {
    marginHorizontal: 16, marginBottom: 12, backgroundColor: C.surface,
    borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border,
  },
  orderCardPending: { borderColor: '#FF9F0A44', borderWidth: 2 },
  orderTop: { flexDirection: 'row', gap: 12 },
  orderImageWrap: { borderRadius: 10, overflow: 'hidden' },
  orderImage: { width: 56, height: 56, borderRadius: 10 },
  orderImagePlaceholder: { backgroundColor: C.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  orderDetails: { flex: 1, justifyContent: 'center' },
  orderTitle: { color: C.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  buyerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  buyerName: { color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_500Medium' },
  buyerLoc: { color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular' },
  orderPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  orderPrice: { color: C.primary, fontSize: 14, fontFamily: 'Inter_700Bold' },
  orderQty: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular' },
  orderStatusCol: { alignItems: 'flex-end', justifyContent: 'space-between' },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  orderTime: { color: C.textTertiary, fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 4 },
  addressRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border,
  },
  addressText: { color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  noteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
  },
  noteText: { color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  actionRow: {
    flexDirection: 'row', gap: 10, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border,
  },
  chatBuyerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border,
  },
  chatBuyerText: { color: C.primary, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  updateBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12, backgroundColor: C.primary,
  },
  updateBtnText: { color: '#FFF', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 100, gap: 12, paddingHorizontal: 40 },
  emptyTitle: { color: C.text, fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { color: C.textTertiary, fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' as const },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 },
  modalContent: { backgroundColor: C.surface, borderRadius: 20, padding: 20 },
  modalTitle: { color: C.text, fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 14 },
  modalInput: {
    backgroundColor: C.background, borderRadius: 12, padding: 14,
    color: C.text, fontSize: 14, fontFamily: 'Inter_400Regular',
    borderWidth: 1, borderColor: C.border, minHeight: 80, textAlignVertical: 'top' as const,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  modalCancel: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: C.border, alignItems: 'center',
  },
  modalCancelText: { color: C.textSecondary, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  modalConfirm: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: C.primary, alignItems: 'center',
  },
  modalConfirmText: { color: '#FFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
