import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Platform, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCart } from '@/lib/cart-context';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';

const ACCENT = '#6B46C1';
const ACCENT_BG = '#F3EEFF';
const SUCCESS = '#27AE60';
const DANGER = '#EB5757';
const BG = '#F9FAFB';
const CARD = '#FFFFFF';
const BORDER = '#E5E7EB';
const TEXT = '#111827';
const MUTED = '#9CA3AF';
const SUB = '#4B5563';

type PayMethod = 'cod' | 'online' | 'upi';

const PAY_OPTIONS: { id: PayMethod; label: string; icon: string; sub: string }[] = [
  { id: 'cod', label: 'Cash on Delivery', icon: 'cash-outline', sub: 'Pay when you receive' },
  { id: 'upi', label: 'UPI / QR', icon: 'qr-code-outline', sub: 'GPay, PhonePe, Paytm' },
  { id: 'online', label: 'Card / Net Banking', icon: 'card-outline', sub: 'Visa, Mastercard, IMPS' },
];

export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const { items, totalPrice, clearCart } = useCart();
  const { profile } = useApp();

  const [name, setName] = useState(profile?.name || '');
  const [phone, setPhone] = useState(profile?.phone?.replace(/\D/g, '').slice(-10) || '');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState(profile?.city || '');
  const [pincode, setPincode] = useState('');
  const [notes, setNotes] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>('cod');
  const [placing, setPlacing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const delivery = totalPrice > 1999 ? 0 : 99;
  const grandTotal = totalPrice + delivery;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Full name is required';
    if (!phone.trim() || phone.length < 10) e.phone = 'Enter a valid 10-digit number';
    if (!address.trim()) e.address = 'Delivery address is required';
    if (!city.trim()) e.city = 'City is required';
    if (!pincode.trim() || pincode.length !== 6) e.pincode = 'Enter a valid 6-digit pincode';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const placeOrder = async () => {
    if (!validate()) return;
    setPlacing(true);
    try {
      // Place an order for each item
      for (const item of items) {
        const res = await apiRequest('POST', '/api/orders', {
          productId: item.productId,
          productTitle: item.title,
          productPrice: item.price.toString(),
          productImage: item.image,
          productCategory: item.category,
          buyerId: profile?.id,
          buyerName: name,
          buyerPhone: phone,
          buyerCity: city,
          buyerState: '',
          sellerId: item.supplierId,
          sellerName: item.supplierName,
          sellerRole: 'supplier',
          quantity: item.quantity,
          totalAmount: (item.price * item.quantity).toString(),
          shippingAddress: `${address}, ${city}, ${pincode}`,
          buyerNotes: notes,
        });
        if (!res.ok) {
          let errMsg = 'Failed to place order';
          try {
            const data = await res.json();
            errMsg = data.message || errMsg;
          } catch {}
          throw new Error(errMsg);
        }
      }
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      clearCart();
      setSuccess(true);
    } catch (error) {
      console.error('Order error:', error);
      const msg = (error as Error)?.message || 'Failed to place order. Please try again.';
      setErrors({ submit: msg });
    } finally {
      setPlacing(false);
    }
  };

  if (success) {
    return (
      <View style={[ss.root, { paddingTop: topPad }]}>
        <View style={ss.centered}>
          <View style={ss.successCircle}>
            <Ionicons name="checkmark" size={48} color="#FFF" />
          </View>
          <Text style={ss.successTitle}>Order Placed!</Text>
          <Text style={ss.successSub}>Your order has been confirmed. You'll receive updates on your registered number.</Text>
          <TouchableOpacity onPress={() => router.replace('/(tabs)/' as any)} style={ss.successBtn}>
            <Text style={ss.successBtnTxt}>Back to Home</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/orders' as any)} style={ss.successOutlineBtn}>
            <Text style={ss.successOutlineTxt}>View Orders</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[ss.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={ss.header}>
        <TouchableOpacity onPress={() => router.back()} style={ss.backBtn}>
          <Ionicons name="arrow-back" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={ss.headerTitle}>Checkout</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Progress steps */}
      <View style={ss.stepsRow}>
        {['Cart', 'Details', 'Payment', 'Confirm'].map((s, i) => (
          <React.Fragment key={s}>
            <View style={ss.step}>
              <View style={[ss.stepDot, i <= 1 && ss.stepDotActive]}>
                {i < 1 ? <Ionicons name="checkmark" size={12} color="#FFF" /> :
                  <Text style={ss.stepDotTxt}>{i + 1}</Text>}
              </View>
              <Text style={[ss.stepLbl, i <= 1 && ss.stepLblActive]}>{s}</Text>
            </View>
            {i < 3 && <View style={[ss.stepLine, i < 1 && ss.stepLineActive]} />}
          </React.Fragment>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>

        {/* Order Summary */}
        <View style={ss.section}>
          <Text style={ss.sectionTitle}>Order Summary ({items.length} {items.length === 1 ? 'item' : 'items'})</Text>
          {items.map(item => (
            <View key={item.productId} style={ss.orderItem}>
              <View style={ss.orderItemImg}>
                {item.image ? (
                  <Image source={{ uri: item.image }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                ) : (
                  <Ionicons name="cube-outline" size={20} color={MUTED} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ss.orderItemName} numberOfLines={1}>{item.title}</Text>
                <Text style={ss.orderItemSup}>{item.supplierName}</Text>
                <Text style={ss.orderItemQty}>Qty: {item.quantity}</Text>
              </View>
              <Text style={ss.orderItemPrice}>₹{(item.price * item.quantity).toLocaleString('en-IN')}</Text>
            </View>
          ))}
        </View>

        {/* Delivery Address */}
        <View style={ss.section}>
          <Text style={ss.sectionTitle}>Delivery Details</Text>
          <Field label="Full Name" value={name} onChangeText={setName} placeholder="Arun Kumar" error={errors.name} icon="person-outline" />
          <Field label="Phone Number" value={phone} onChangeText={(text) => setPhone(text.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" error={errors.phone} icon="call-outline" keyboardType="phone-pad" maxLength={10} />
          <Field label="Delivery Address" value={address} onChangeText={setAddress} placeholder="Street, Building, Landmark…" error={errors.address} icon="home-outline" multiline />
          <View style={ss.rowFields}>
            <View style={{ flex: 1 }}>
              <Field label="City" value={city} onChangeText={setCity} placeholder="Vizag" error={errors.city} icon="business-outline" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Pincode" value={pincode} onChangeText={setPincode} placeholder="530001" error={errors.pincode} icon="location-outline" keyboardType="number-pad" maxLength={6} />
            </View>
          </View>
          <Field label="Order Notes (Optional)" value={notes} onChangeText={setNotes} placeholder="Special instructions…" icon="chatbox-outline" multiline />
        </View>

        {/* Payment Method */}
        <View style={ss.section}>
          <Text style={ss.sectionTitle}>Payment Method</Text>
          {PAY_OPTIONS.map(opt => (
            <TouchableOpacity key={opt.id} onPress={() => setPayMethod(opt.id)} style={[ss.payOption, payMethod === opt.id && ss.payOptionActive]}>
              <View style={[ss.payIconWrap, payMethod === opt.id && { backgroundColor: ACCENT }]}>
                <Ionicons name={opt.icon as any} size={18} color={payMethod === opt.id ? '#FFF' : MUTED} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[ss.payLabel, payMethod === opt.id && { color: ACCENT }]}>{opt.label}</Text>
                <Text style={ss.paySub}>{opt.sub}</Text>
              </View>
              <View style={[ss.radio, payMethod === opt.id && ss.radioActive]}>
                {payMethod === opt.id && <View style={ss.radioDot} />}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Price Breakdown */}
        <View style={ss.section}>
          <Text style={ss.sectionTitle}>Price Breakdown</Text>
          <View style={ss.priceBreakCard}>
            {[
              ['Subtotal', `₹${totalPrice.toLocaleString('en-IN')}`],
              ['Delivery', delivery === 0 ? 'FREE' : `₹${delivery}`],
            ].map(([k, v]) => (
              <View key={k} style={ss.breakRow}>
                <Text style={ss.breakKey}>{k}</Text>
                <Text style={[ss.breakVal, v === 'FREE' && { color: SUCCESS }]}>{v}</Text>
              </View>
            ))}
            <View style={ss.breakDivider} />
            <View style={ss.breakRow}>
              <Text style={ss.breakTotal}>Total</Text>
              <Text style={ss.breakTotalVal}>₹{grandTotal.toLocaleString('en-IN')}</Text>
            </View>
            {delivery === 0 && (
              <View style={ss.freeDeliveryBadge}>
                <Ionicons name="checkmark-circle" size={14} color={SUCCESS} />
                <Text style={ss.freeDeliveryTxt}>Free delivery on orders above ₹1,999</Text>
              </View>
            )}
          </View>
        </View>

        {errors.submit && (
          <View style={ss.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={DANGER} />
            <Text style={ss.errorBannerTxt}>{errors.submit}</Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[ss.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <View style={{ marginBottom: 4 }}>
          <Text style={ss.totalLabel}>Grand Total</Text>
          <Text style={ss.totalAmt}>₹{grandTotal.toLocaleString('en-IN')}</Text>
        </View>
        <TouchableOpacity onPress={placeOrder} disabled={placing || items.length === 0} style={[ss.placeBtn, (placing || items.length === 0) && { opacity: 0.5 }]}>
          {placing ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Ionicons name="bag-check-outline" size={18} color="#FFF" />
              <Text style={ss.placeBtnTxt}>Place Order</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, error, icon, multiline, keyboardType, maxLength }: any) {
  return (
    <View style={ss.field}>
      <Text style={ss.fieldLabel}>{label}</Text>
      <View style={[ss.inputWrap, error && ss.inputWrapErr]}>
        <Ionicons name={icon} size={16} color={error ? DANGER : MUTED} style={{ marginRight: 8 }} />
        <TextInput
          style={[ss.input, multiline && ss.inputMulti]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={MUTED}
          keyboardType={keyboardType || 'default'}
          maxLength={maxLength}
          multiline={multiline}
          numberOfLines={multiline ? 3 : 1}
        />
      </View>
      {error && <Text style={ss.fieldErr}>{error}</Text>}
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: SUCCESS, alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  successTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 10 },
  successSub: { fontSize: 14, color: SUB, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  successBtn: { width: '100%', backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  successBtnTxt: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  successOutlineBtn: { width: '100%', borderWidth: 1.5, borderColor: ACCENT, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  successOutlineTxt: { color: ACCENT, fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', color: TEXT, textAlign: 'center' },

  stepsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, paddingHorizontal: 16, backgroundColor: CARD,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  step: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: BORDER, alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: ACCENT },
  stepDotTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  stepLbl: { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  stepLblActive: { color: ACCENT, fontFamily: 'Inter_600SemiBold' },
  stepLine: { flex: 1, height: 2, backgroundColor: BORDER, marginBottom: 16, marginHorizontal: 4 },
  stepLineActive: { backgroundColor: ACCENT },

  section: {
    backgroundColor: CARD, marginHorizontal: 16, marginTop: 12,
    borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER,
  },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 12 },

  orderItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  orderItemImg: {
    width: 56, height: 56, borderRadius: 10, backgroundColor: '#F9FAFB',
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  orderItemName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: TEXT },
  orderItemSup: { fontSize: 12, color: MUTED, fontFamily: 'Inter_400Regular' },
  orderItemQty: { fontSize: 12, color: SUB, fontFamily: 'Inter_500Medium', marginTop: 2 },
  orderItemPrice: { fontSize: 14, fontFamily: 'Inter_700Bold', color: ACCENT },

  rowFields: { flexDirection: 'row', gap: 10 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: SUB, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: BORDER,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  inputWrapErr: { borderColor: DANGER, backgroundColor: '#FFF5F5' },
  input: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: TEXT },
  inputMulti: { height: 72, textAlignVertical: 'top', paddingTop: 4 },
  fieldErr: { fontSize: 11, color: DANGER, fontFamily: 'Inter_400Regular', marginTop: 4 },

  payOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, padding: 14, marginBottom: 8,
    backgroundColor: '#F9FAFB',
  },
  payOptionActive: { borderColor: ACCENT, backgroundColor: ACCENT_BG },
  payIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  payLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: TEXT },
  paySub: { fontSize: 12, color: MUTED, fontFamily: 'Inter_400Regular' },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: ACCENT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ACCENT },

  priceBreakCard: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: BORDER },
  breakRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  breakKey: { fontSize: 13, color: SUB, fontFamily: 'Inter_400Regular' },
  breakVal: { fontSize: 13, color: TEXT, fontFamily: 'Inter_500Medium' },
  breakDivider: { height: 1, backgroundColor: BORDER, marginVertical: 8 },
  breakTotal: { fontSize: 15, fontFamily: 'Inter_700Bold', color: TEXT },
  breakTotalVal: { fontSize: 17, fontFamily: 'Inter_700Bold', color: ACCENT },
  freeDeliveryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#ECFDF5', borderRadius: 8, padding: 8, marginTop: 8,
  },
  freeDeliveryTxt: { fontSize: 12, color: SUCCESS, fontFamily: 'Inter_500Medium' },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF5F5', borderRadius: 10, padding: 12, marginHorizontal: 16, marginTop: 8,
    borderWidth: 1, borderColor: '#FECACA',
  },
  errorBannerTxt: { color: DANGER, fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: CARD, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: BORDER,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 16, elevation: 16,
    gap: 12,
  },
  totalLabel: { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular' },
  totalAmt: { fontSize: 20, fontFamily: 'Inter_700Bold', color: ACCENT },
  placeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 14,
  },
  placeBtnTxt: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
});
