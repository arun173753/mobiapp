import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Platform,
  Alert, TextInput, Linking, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';

// ─── Theme ───────────────────────────────────────────────────────────────────
const BG       = '#F9FAFB';
const CARD     = '#FFFFFF';
const BORDER   = '#E5E7EB';
const TEXT     = '#111827';
const MUTED    = '#9CA3AF';
const SUB      = '#4B5563';
const PRIMARY  = '#1B4D3E';
const GREEN    = '#10B981';
const AMBER    = '#F59E0B';
const RED      = '#EF4444';
const BLUE     = '#3B82F6';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  pending:   { label: 'New Order',   color: AMBER,  bg: '#FEF3C7', icon: 'time-outline' },
  confirmed: { label: 'Confirmed',   color: BLUE,   bg: '#DBEAFE', icon: 'checkmark-circle-outline' },
  shipped:   { label: 'Shipped',     color: '#8B5CF6', bg: '#EDE9FE', icon: 'car-outline' },
  delivered: { label: 'Delivered',   color: GREEN,  bg: '#D1FAE5', icon: 'checkmark-done-outline' },
  completed: { label: 'Completed',   color: GREEN,  bg: '#D1FAE5', icon: 'checkmark-done-circle-outline' },
  cancelled: { label: 'Cancelled',   color: RED,    bg: '#FEE2E2', icon: 'close-circle-outline' },
  rejected:  { label: 'Rejected',    color: RED,    bg: '#FEE2E2', icon: 'ban-outline' },
};

const ORDER_STEPS = [
  { key: 'pending',   label: 'Order Placed',  icon: 'bag-outline' },
  { key: 'confirmed', label: 'Confirmed',      icon: 'checkmark-circle-outline' },
  { key: 'shipped',   label: 'Shipped',        icon: 'car-outline' },
  { key: 'delivered', label: 'Delivered',      icon: 'home-outline' },
];

const STEP_ORDER = ['pending', 'confirmed', 'shipped', 'delivered', 'completed'];

function InfoRow({ icon, label, value, onPress, color }: {
  icon: any; label: string; value: string; onPress?: () => void; color?: string;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.infoRow, onPress && styles.infoRowClickable]}>
      <View style={[styles.infoIcon, { backgroundColor: (color || MUTED) + '18' }]}>
        <Ionicons name={icon} size={16} color={color || MUTED} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, color ? { color } : {}]}>{value || '—'}</Text>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={14} color={MUTED} />}
    </Pressable>
  );
}

export default function OrderDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, startConversation } = useApp();

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [noteModal, setNoteModal] = useState(false);
  const [note, setNote] = useState('');
  const [pendingStatus, setPendingStatus] = useState('');

  const topPad = (Platform.OS === 'web' ? 67 : insets.top) + 8;

  const fetchOrder = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiRequest('GET', `/api/orders/${id}`);
      const data = await res.json();
      setOrder(data);
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  const updateStatus = async (status: string, sellerNotes?: string) => {
    setUpdating(true);
    try {
      const body: any = { status };
      if (sellerNotes) body.sellerNotes = sellerNotes;
      const res = await apiRequest('PATCH', `/api/orders/${id}/status`, body);
      if (!res.ok) throw new Error('Update failed');
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await fetchOrder();
      setTimeout(() => router.back(), 500);
    } catch (err: any) {
      Alert.alert('Error', 'Failed to update order');
      setUpdating(false);
    }
  };

  const handleAction = (status: string, needsNote = false) => {
    if (needsNote) {
      setPendingStatus(status);
      setNote('');
      setNoteModal(true);
      return;
    }
    updateStatus(status);
  };

  const callCustomer = () => {
    const phone = order?.buyerPhone?.replace(/\D/g, '');
    if (!phone) { Alert.alert('No Phone', 'Customer phone not available'); return; }
    const url = `tel:+91${phone}`;
    if (Platform.OS === 'web') { try { (window as any).location.href = url; } catch {} }
    else { Linking.openURL(url).catch(() => {}); }
  };

  const whatsappCustomer = () => {
    const phone = order?.buyerPhone?.replace(/\D/g, '');
    if (!phone) { Alert.alert('No Phone', 'Customer phone not available'); return; }
    const msg = encodeURIComponent(
      `Hi ${order?.buyerName || 'there'}, I received your order for *${order?.productTitle}* worth ₹${order?.totalAmount}. I will process it shortly.`
    );
    Linking.openURL(`https://wa.me/91${phone}?text=${msg}`);
  };

  const chatCustomer = async () => {
    if (!order) return;
    try {
      const convoId = await startConversation(order.buyerId, order.buyerName, 'customer');
      if (convoId) router.push({ pathname: '/chat/[id]', params: { id: convoId } });
    } catch { Alert.alert('Error', 'Could not open chat'); }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Ionicons name="receipt-outline" size={48} color={MUTED} />
        <Text style={[styles.emptyTitle, { marginTop: 16 }]}>Order not found</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtnEmpty}>
          <Text style={{ color: PRIMARY, fontFamily: 'Inter_600SemiBold' }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const isSupplier = profile?.id === order.sellerId;
  const stepIdx = STEP_ORDER.indexOf(order.status);
  const imgUrl = order.productImage?.startsWith('/') ? `${getApiUrl()}${order.productImage}` : order.productImage;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={TEXT} />
        </Pressable>
        <Text style={styles.headerTitle}>Order Details</Text>
        <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
          <Ionicons name={sc.icon as any} size={12} color={sc.color} />
          <Text style={[styles.statusTxt, { color: sc.color }]}>{sc.label}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Order Progress Timeline */}
        {!['cancelled', 'rejected'].includes(order.status) && (
          <Animated.View entering={FadeInDown.delay(50)} style={styles.card}>
            <Text style={styles.cardTitle}>Order Progress</Text>
            <View style={styles.timeline}>
              {ORDER_STEPS.map((step, i) => {
                const done = STEP_ORDER.indexOf(order.status) >= STEP_ORDER.indexOf(step.key);
                const isLast = i === ORDER_STEPS.length - 1;
                return (
                  <View key={step.key} style={styles.timelineStep}>
                    <View style={styles.timelineLeft}>
                      <View style={[styles.timelineDot, done ? styles.timelineDotDone : styles.timelineDotPending]}>
                        <Ionicons name={step.icon as any} size={12} color={done ? '#FFF' : MUTED} />
                      </View>
                      {!isLast && <View style={[styles.timelineLine, done ? styles.timelineLineDone : {}]} />}
                    </View>
                    <Text style={[styles.timelineLabel, done && { color: TEXT, fontFamily: 'Inter_600SemiBold' }]}>
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Animated.View>
        )}

        {/* Product */}
        <Animated.View entering={FadeInDown.delay(100)} style={styles.card}>
          <Text style={styles.cardTitle}>Product</Text>
          <View style={styles.productRow}>
            {imgUrl ? (
              <Image source={{ uri: imgUrl }} style={styles.productImg} contentFit="cover" />
            ) : (
              <View style={[styles.productImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' }]}>
                <Ionicons name="cube-outline" size={28} color={MUTED} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.productTitle}>{order.productTitle}</Text>
              {order.productCategory && <Text style={styles.productCat}>{order.productCategory}</Text>}
              <View style={styles.priceRow}>
                <Text style={styles.productPrice}>₹{(parseFloat(order.productPrice || '0')).toLocaleString('en-IN')}</Text>
                <Text style={styles.productQty}>× {order.quantity || 1}</Text>
              </View>
            </View>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Amount</Text>
            <Text style={styles.totalValue}>₹{(parseFloat(order.totalAmount || '0')).toLocaleString('en-IN')}</Text>
          </View>
        </Animated.View>

        {/* Customer Info */}
        <Animated.View entering={FadeInDown.delay(150)} style={styles.card}>
          <Text style={styles.cardTitle}>Customer Details</Text>
          <InfoRow icon="person" label="Name" value={order.buyerName} color={TEXT} />
          <InfoRow
            icon="call" label="Phone"
            value={order.buyerPhone ? `+91 ${order.buyerPhone}` : ''}
            color={GREEN} onPress={callCustomer}
          />
          <InfoRow icon="location" label="Delivery Address" value={order.shippingAddress} />
          <InfoRow icon="business" label="City" value={`${order.buyerCity}${order.buyerState ? ', ' + order.buyerState : ''}`} />
          {order.buyerNotes ? <InfoRow icon="chatbubble" label="Customer Notes" value={order.buyerNotes} color={AMBER} /> : null}
        </Animated.View>

        {/* Contact Buttons */}
        {isSupplier && (
          <Animated.View entering={FadeInDown.delay(200)} style={styles.card}>
            <Text style={styles.cardTitle}>Contact Customer</Text>
            <View style={styles.contactRow}>
              <Pressable onPress={whatsappCustomer} style={[styles.contactBtn, { backgroundColor: '#25D366' }]}>
                <Ionicons name="logo-whatsapp" size={20} color="#FFF" />
                <Text style={styles.contactBtnTxt}>WhatsApp</Text>
              </Pressable>
              <Pressable onPress={callCustomer} style={[styles.contactBtn, { backgroundColor: BLUE }]}>
                <Ionicons name="call" size={18} color="#FFF" />
                <Text style={styles.contactBtnTxt}>Call</Text>
              </Pressable>
              <Pressable onPress={chatCustomer} style={[styles.contactBtn, { backgroundColor: PRIMARY }]}>
                <Ionicons name="chatbubble" size={17} color="#FFF" />
                <Text style={styles.contactBtnTxt}>Chat</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}

        {/* Action Buttons for Supplier */}
        {isSupplier && ['pending', 'confirmed', 'shipped'].includes(order.status) && (
          <Animated.View entering={FadeInDown.delay(250)} style={styles.card}>
            <Text style={styles.cardTitle}>Manage Order</Text>
            {order.status === 'pending' && (
              <View style={styles.actionGrid}>
                <Pressable onPress={() => handleAction('confirmed')} disabled={updating}
                  style={[styles.actionPrimary, { backgroundColor: GREEN }]}>
                  {updating ? <ActivityIndicator size="small" color="#FFF" /> : (
                    <>
                      <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                      <Text style={styles.actionPrimaryTxt}>Accept Order</Text>
                    </>
                  )}
                </Pressable>
                <Pressable onPress={() => handleAction('rejected', true)} disabled={updating}
                  style={[styles.actionSecondary, { borderColor: RED }]}>
                  <Ionicons name="close-circle-outline" size={18} color={RED} />
                  <Text style={[styles.actionSecondaryTxt, { color: RED }]}>Reject</Text>
                </Pressable>
              </View>
            )}
            {order.status === 'confirmed' && (
              <Pressable onPress={() => handleAction('shipped', true)} disabled={updating}
                style={[styles.actionPrimary, { backgroundColor: '#8B5CF6' }]}>
                {updating ? <ActivityIndicator size="small" color="#FFF" /> : (
                  <>
                    <Ionicons name="car" size={20} color="#FFF" />
                    <Text style={styles.actionPrimaryTxt}>Mark as Shipped</Text>
                  </>
                )}
              </Pressable>
            )}
            {order.status === 'shipped' && (
              <Pressable onPress={() => handleAction('delivered')} disabled={updating}
                style={[styles.actionPrimary, { backgroundColor: GREEN }]}>
                {updating ? <ActivityIndicator size="small" color="#FFF" /> : (
                  <>
                    <Ionicons name="checkmark-done" size={20} color="#FFF" />
                    <Text style={styles.actionPrimaryTxt}>Mark as Delivered</Text>
                  </>
                )}
              </Pressable>
            )}
            <Text style={styles.actionNote}>Customer will be notified about status changes</Text>
          </Animated.View>
        )}

        {/* Seller Notes */}
        {order.sellerNotes ? (
          <Animated.View entering={FadeInDown.delay(300)} style={styles.card}>
            <Text style={styles.cardTitle}>Your Notes</Text>
            <Text style={styles.noteText}>{order.sellerNotes}</Text>
          </Animated.View>
        ) : null}

        {/* Order Meta */}
        <Animated.View entering={FadeInDown.delay(350)} style={[styles.card, { marginBottom: 32 }]}>
          <Text style={styles.cardTitle}>Order Info</Text>
          <InfoRow icon="receipt-outline" label="Order ID" value={order.id?.slice(0, 16) + '...'} />
          <InfoRow icon="wallet-outline" label="Payment" value={order.paymentMethod === 'online' ? 'Online Payment' : 'Cash on Delivery'} />
          <InfoRow icon="calendar-outline" label="Placed On"
            value={new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          />
        </Animated.View>
      </ScrollView>

      {/* Note Modal */}
      {noteModal && (
        <View style={styles.modalOverlay}>
          <Animated.View entering={FadeIn} style={styles.modal}>
            <Text style={styles.modalTitle}>
              {pendingStatus === 'rejected' ? '✗ Reject Order' :
               pendingStatus === 'shipped'  ? '🚚 Add Shipping Info' : 'Add Note'}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder={pendingStatus === 'rejected' ? 'Reason for rejection...' : 'Tracking number, notes...'}
              placeholderTextColor={MUTED}
              value={note}
              onChangeText={setNote}
              multiline
            />
            <View style={styles.modalBtns}>
              <Pressable onPress={() => setNoteModal(false)} style={styles.modalCancel}>
                <Text style={styles.modalCancelTxt}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => { setNoteModal(false); updateStatus(pendingStatus, note); }}
                style={[styles.modalConfirm, pendingStatus === 'rejected' && { backgroundColor: RED }]}
              >
                <Text style={styles.modalConfirmTxt}>
                  {pendingStatus === 'rejected' ? 'Reject' : 'Confirm'}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 12,
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: TEXT },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  statusTxt: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  scroll: { padding: 16, gap: 12 },
  card: { backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER },
  cardTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },

  // Timeline
  timeline: { gap: 0 },
  timelineStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 0 },
  timelineLeft: { alignItems: 'center', width: 28 },
  timelineDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  timelineDotDone: { backgroundColor: PRIMARY },
  timelineDotPending: { backgroundColor: BORDER },
  timelineLine: { width: 2, height: 24, backgroundColor: BORDER, marginTop: 2 },
  timelineLineDone: { backgroundColor: PRIMARY },
  timelineLabel: { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, paddingTop: 5, paddingBottom: 24 },

  // Product
  productRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  productImg: { width: 72, height: 72, borderRadius: 10, backgroundColor: BG },
  productTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: TEXT, flex: 1 },
  productCat: { fontSize: 12, color: MUTED, fontFamily: 'Inter_400Regular', marginTop: 3, textTransform: 'capitalize' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  productPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: PRIMARY },
  productQty: { fontSize: 13, color: MUTED, fontFamily: 'Inter_400Regular' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
  totalLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: SUB },
  totalValue: { fontSize: 18, fontFamily: 'Inter_700Bold', color: GREEN },

  // Info rows
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER + '60' },
  infoRowClickable: {},
  infoIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 1 },
  infoValue: { fontSize: 14, fontFamily: 'Inter_500Medium', color: SUB },

  // Contact
  contactRow: { flexDirection: 'row', gap: 10 },
  contactBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
  contactBtnTxt: { color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  // Actions
  actionGrid: { gap: 10 },
  actionPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14 },
  actionPrimaryTxt: { color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
  actionSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, backgroundColor: CARD },
  actionSecondaryTxt: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  actionNote: { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 10 },

  // Note
  noteText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: SUB, lineHeight: 20 },

  // Empty / Back
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: TEXT },
  backBtnEmpty: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 12 },

  // Note Modal
  modalOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modal: { backgroundColor: CARD, borderRadius: 20, padding: 24, width: '100%' },
  modalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 14 },
  modalInput: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12,
    fontFamily: 'Inter_400Regular', fontSize: 14, color: TEXT, minHeight: 80, textAlignVertical: 'top',
  },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 16 },
  modalCancel: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  modalCancelTxt: { color: MUTED, fontFamily: 'Inter_600SemiBold' },
  modalConfirm: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: PRIMARY, alignItems: 'center' },
  modalConfirmTxt: { color: '#FFF', fontFamily: 'Inter_700Bold' },
});
