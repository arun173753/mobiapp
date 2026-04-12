import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCart, CartItem } from '@/lib/cart-context';

// ─── MarketHub Light Theme ───────────────────────────────────────────────────
const T = {
  bg: '#F9FAFB', card: '#FFFFFF', cardSurface: '#F3F4F6', bgElevated: '#FFFFFF',
  border: '#E5E7EB', text: '#111827', muted: '#9CA3AF', textSub: '#4B5563',
  accent: '#6B46C1', accentMuted: '#F3EEFF', green: '#10B981', red: '#EF4444',
};

const webTop = Platform.OS === 'web' ? 67 : 0;

function CartItemRow({ item, onRemove, onQtyChange }: {
  item: CartItem;
  onRemove: () => void;
  onQtyChange: (qty: number) => void;
}) {
  return (
    <View style={styles.itemRow}>
      <View style={styles.itemImgWrap}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.itemImg} contentFit="cover" />
        ) : (
          <View style={[styles.itemImg, styles.itemImgPlaceholder]}>
            <Ionicons name="cube-outline" size={20} color={T.muted} />
          </View>
        )}
      </View>
      <View style={styles.itemInfo}>
        <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.itemSupplier} numberOfLines={1}>{item.supplierName}</Text>
        <Text style={styles.itemPrice}>₹{item.price.toLocaleString('en-IN')}</Text>
      </View>
      <View style={styles.itemRight}>
        <Pressable onPress={onRemove} style={styles.removeBtn}>
          <Ionicons name="trash-outline" size={14} color="#EF4444" />
        </Pressable>
        <View style={styles.qtyRow}>
          <Pressable
            onPress={() => { if (item.quantity <= 1) onRemove(); else onQtyChange(item.quantity - 1); }}
            style={styles.qtyBtn}
          >
            <Ionicons name="remove" size={14} color={T.text} />
          </Pressable>
          <Text style={styles.qtyVal}>{item.quantity}</Text>
          <Pressable
            onPress={() => { if (item.quantity < item.inStock) onQtyChange(item.quantity + 1); }}
            disabled={item.quantity >= item.inStock}
            style={[styles.qtyBtn, item.quantity >= item.inStock && { opacity: 0.4 }]}
          >
            <Ionicons name="add" size={14} color={T.text} />
          </Pressable>
        </View>
        <Text style={styles.itemSubtotal}>₹{(item.price * item.quantity).toLocaleString('en-IN')}</Text>
      </View>
    </View>
  );
}

export default function CartScreen() {
  const insets = useSafeAreaInsets();
  const { items, totalPrice, totalItems, removeFromCart, updateQuantity, clearCart } = useCart();
  const topInset = Platform.OS === 'web' ? webTop : insets.top;

  const handleClear = () => {
    clearCart();
  };

  const deliveryCharge = totalPrice > 999 ? 0 : 49;
  const grandTotal = totalPrice + deliveryCharge;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={T.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Cart ({totalItems})</Text>
        {items.length > 0 && (
          <Pressable onPress={handleClear} style={styles.clearBtn}>
            <Text style={styles.clearTxt}>Clear All</Text>
          </Pressable>
        )}
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bag-outline" size={72} color={T.muted} />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptySub}>Browse the marketplace and add products</Text>
          <Pressable onPress={() => router.replace('/(tabs)/marketplace' as any)} style={styles.shopBtn}>
            <Ionicons name="storefront-outline" size={18} color="#FFF" />
            <Text style={styles.shopBtnTxt}>Browse Marketplace</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={i => i.productId}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <CartItemRow
                item={item}
                onRemove={() => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); removeFromCart(item.productId); }}
                onQtyChange={(qty) => updateQuantity(item.productId, qty)}
              />
            )}
            ListFooterComponent={
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Order Summary</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Subtotal ({totalItems} items)</Text>
                  <Text style={styles.summaryVal}>₹{totalPrice.toLocaleString('en-IN')}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Delivery</Text>
                  <Text style={[styles.summaryVal, deliveryCharge === 0 && { color: T.green }]}>
                    {deliveryCharge === 0 ? 'FREE' : `₹${deliveryCharge}`}
                  </Text>
                </View>
                {deliveryCharge > 0 && (
                  <Text style={styles.freeDeliveryHint}>Add ₹{(999 - totalPrice).toLocaleString('en-IN')} more for free delivery</Text>
                )}
                <View style={[styles.summaryRow, styles.totalRow]}>
                  <Text style={styles.totalLabel}>Grand Total</Text>
                  <Text style={styles.totalVal}>₹{grandTotal.toLocaleString('en-IN')}</Text>
                </View>
              </View>
            }
          />

          <View style={[styles.checkoutBar, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 16) }]}>
            <View>
              <Text style={styles.checkoutLabel}>Total</Text>
              <Text style={styles.checkoutTotal}>₹{grandTotal.toLocaleString('en-IN')}</Text>
            </View>
            <Pressable onPress={() => router.push('/checkout' as any)} style={styles.checkoutBtn}>
              <Text style={styles.checkoutBtnTxt}>Checkout</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFF" />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: T.bgElevated, borderBottomWidth: 1, borderBottomColor: T.border },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 20, fontFamily: 'Inter_700Bold', color: T.text },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#EF444420' },
  clearTxt: { color: '#EF4444', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  list: { padding: 16, gap: 12, paddingBottom: 140 },
  itemRow: { flexDirection: 'row', backgroundColor: T.card, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: T.border },
  itemImgWrap: { width: 90, height: 90 },
  itemImg: { width: 90, height: 90, backgroundColor: T.cardSurface },
  itemImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  itemInfo: { flex: 1, padding: 10 },
  itemTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: T.text, lineHeight: 20 },
  itemSupplier: { fontSize: 11, color: T.muted, fontFamily: 'Inter_400Regular', marginTop: 3 },
  itemPrice: { fontSize: 14, fontFamily: 'Inter_700Bold', color: T.accent, marginTop: 6 },
  itemRight: { padding: 10, alignItems: 'flex-end', justifyContent: 'space-between', minHeight: 90 },
  removeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EF444420', alignItems: 'center', justifyContent: 'center' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.cardSurface, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: T.border },
  qtyBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  qtyVal: { fontSize: 13, fontFamily: 'Inter_700Bold', color: T.text, paddingHorizontal: 8, minWidth: 24, textAlign: 'center' },
  itemSubtotal: { fontSize: 13, fontFamily: 'Inter_700Bold', color: T.text },
  summaryCard: { backgroundColor: T.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: T.border },
  summaryTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: T.text, marginBottom: 14 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  summaryLabel: { fontSize: 14, color: T.textSub, fontFamily: 'Inter_400Regular' },
  summaryVal: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: T.text },
  freeDeliveryHint: { fontSize: 11, color: T.accent, fontFamily: 'Inter_400Regular', marginBottom: 10 },
  totalRow: { borderTopWidth: 1, borderTopColor: T.border, paddingTop: 12, marginBottom: 0, marginTop: 4 },
  totalLabel: { fontSize: 16, fontFamily: 'Inter_700Bold', color: T.text },
  totalVal: { fontSize: 20, fontFamily: 'Inter_700Bold', color: T.accent },
  checkoutBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, backgroundColor: T.bgElevated, borderTopWidth: 1, borderTopColor: T.border, gap: 16 },
  checkoutLabel: { fontSize: 11, color: T.muted, fontFamily: 'Inter_400Regular' },
  checkoutTotal: { fontSize: 20, fontFamily: 'Inter_700Bold', color: T.text },
  checkoutBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.accent, borderRadius: 14, paddingVertical: 14 },
  checkoutBtnTxt: { color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: T.text, marginTop: 20 },
  emptySub: { fontSize: 14, color: T.muted, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 8 },
  shopBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.accent, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14, marginTop: 24 },
  shopBtnTxt: { color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
});
