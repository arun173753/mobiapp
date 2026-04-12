import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
  Dimensions, Animated, StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/lib/context';
import { useCart } from '@/lib/cart-context';
import { apiRequest } from '@/lib/query-client';
import { Product } from '@/lib/types';

const ACCENT = '#6B46C1';
const ACCENT_LIGHT = '#9F7AEA';
const ACCENT_BG = '#F3EEFF';
const SUCCESS = '#27AE60';
const WARN = '#F2C94C';
const DANGER = '#EB5757';
const BG = '#F9FAFB';
const CARD = '#FFFFFF';
const BORDER = '#E5E7EB';
const TEXT = '#111827';
const MUTED = '#9CA3AF';
const SUB = '#4B5563';

const { width } = Dimensions.get('window');
const IMG_H = width;

function Stars({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons
          key={i}
          name={rating >= i ? 'star' : rating >= i - 0.5 ? 'star-half' : 'star-outline'}
          size={14}
          color={WARN}
        />
      ))}
    </View>
  );
}

export default function ProductDetailScreen() {
  const params = useLocalSearchParams<{ id: string; productId: string }>();
  const id = params.productId || params.id;
  const insets = useSafeAreaInsets();
  const { profile, startConversation } = useApp();
  const { addToCart, isInCart, getQuantity, updateQuantity, removeFromCart } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeImg, setActiveImg] = useState(0);
  const [liked, setLiked] = useState(false);
  const [activeTab, setActiveTab] = useState<'desc' | 'specs'>('desc');
  const [chatLoading, setChatLoading] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const inCart = product ? isInCart(product.id) : false;
  const cartQty = product ? getQuantity(product.id) : 0;

  const fetchProduct = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiRequest('GET', `/api/products/${id}`);
      const data = await res.json();
      setProduct(data);
      if (profile) setLiked((() => { try { return JSON.parse(data.likes || '[]').includes(profile.id); } catch { return false; } })());
    } catch {
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, profile]);

  useEffect(() => { fetchProduct(); }, [fetchProduct]);

  const imgs = product
    ? (() => {
        const images = product.images || (product as any).images;
        // If already an array (from API), use it directly
        if (Array.isArray(images) && images.length > 0) {
          return images.filter(img => img && String(img).trim());
        }
        // If a string, try parsing
        if (typeof images === 'string' && images.trim()) {
          try {
            const parsed = JSON.parse(images);
            if (Array.isArray(parsed) && parsed.length > 0) {
              return parsed.filter(img => img && String(img).trim());
            }
          } catch {}
        }
        // Fallback to single image field
        const singleImg = (product as any).image;
        if (singleImg && String(singleImg).trim()) {
          return [singleImg];
        }
        return [];
      })()
    : [];

  const price = product ? parseFloat(product.price) || 0 : 0;

  const handleToggleLike = async () => {
    if (!product || !profile) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLiked(v => !v);
    try { await apiRequest('POST', `/api/products/${product.id}/like`, { userId: profile.id }); } catch {}
  };

  const handleAddToCart = () => {
    if (!product) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
    // Get first valid image
    const firstImg = imgs && imgs.length > 0 ? imgs[0] : (product as any).image || '';
    if (inCart) {
      updateQuantity(product.id, cartQty + 1);
    } else {
      addToCart({
        productId: product.id,
        title: product.title,
        price,
        image: firstImg,
        supplierName: product.userName,
        supplierId: product.userId,
        inStock: product.inStock || 0,
        category: product.category,
      });
    }
  };

  const handleChat = async () => {
    if (!product || !profile) return;
    if (profile.id === product.userId) return;
    setChatLoading(true);
    try {
      const convoId = await startConversation(product.userId, product.userName, 'supplier' as any);
      if (convoId) router.push(`/chat/${convoId}` as any);
    } catch {}
    finally { setChatLoading(false); }
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  if (loading) {
    return (
      <View style={[ss.centered, { paddingTop: topPad }]}>
        <View style={ss.loadingDot} />
        <Text style={{ color: MUTED, marginTop: 12, fontFamily: 'Inter_400Regular' }}>Loading…</Text>
      </View>
    );
  }

  if (!product) return null;

  const stock = product.inStock ?? 1;

  return (
    <View style={[ss.root, { paddingTop: topPad }]}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={ss.header}>
        <TouchableOpacity onPress={() => router.back()} style={ss.iconBtn}>
          <Ionicons name="arrow-back" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={ss.headerTitle} numberOfLines={1}>{product.title}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={handleToggleLike} style={ss.iconBtn}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={20} color={liked ? DANGER : TEXT} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/cart' as any)} style={[ss.iconBtn, { position: 'relative' }]}>
            <Ionicons name="bag-outline" size={20} color={TEXT} />
            {cartQty > 0 && (
              <View style={ss.cartBadge}>
                <Text style={ss.cartBadgeTxt}>{cartQty}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

        {/* Main Image */}
        <View style={ss.imgWrap}>
          {imgs.length > 0 ? (
            <Image source={{ uri: imgs[activeImg] }} style={ss.mainImg} contentFit="cover" />
          ) : (
            <View style={[ss.mainImg, ss.noImg]}>
              <Ionicons name="cube-outline" size={72} color={MUTED} />
              <Text style={{ color: MUTED, marginTop: 10, fontFamily: 'Inter_400Regular', fontSize: 14 }}>No image</Text>
            </View>
          )}
          {/* Discount badge */}
          <View style={ss.discountBadge}>
            <Text style={ss.discountTxt}>-15% OFF</Text>
          </View>
          {/* Like overlay */}
          <TouchableOpacity onPress={handleToggleLike} style={ss.imgLikeBtn}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={20} color={liked ? DANGER : MUTED} />
          </TouchableOpacity>
          {stock === 0 && (
            <View style={ss.oosBanner}>
              <Text style={ss.oosTxt}>Out of Stock</Text>
            </View>
          )}
        </View>

        {/* Thumbnail Strip */}
        {imgs.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ss.thumbsRow}>
            {imgs.map((img: string, i: number) => (
              <TouchableOpacity key={i} onPress={() => setActiveImg(i)}
                style={[ss.thumb, activeImg === i && ss.thumbActive]}>
                <Image source={{ uri: img }} style={ss.thumbImg} contentFit="cover" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View style={ss.content}>
          {/* Category + Stock */}
          <View style={ss.topRow}>
            <View style={ss.catChip}>
              <Text style={ss.catTxt}>{product.category}</Text>
            </View>
            <View style={[ss.stockChip, { backgroundColor: stock > 0 ? '#D1FAE5' : '#FEE2E2' }]}>
              <View style={[ss.stockDot, { backgroundColor: stock > 0 ? SUCCESS : DANGER }]} />
              <Text style={[ss.stockTxt, { color: stock > 0 ? SUCCESS : DANGER }]}>
                {stock > 0 ? `In Stock (${stock} units)` : 'Out of Stock'}
              </Text>
            </View>
          </View>

          {/* Title */}
          <Text style={ss.title}>{product.title}</Text>

          {/* Stars + location */}
          <View style={ss.metaRow}>
            <Stars rating={4.5} />
            <Text style={ss.metaRatingVal}>4.5</Text>
            {(product.city || product.state) && (
              <>
                <View style={ss.dot} />
                <Ionicons name="location-outline" size={13} color={MUTED} />
                <Text style={ss.metaLoc}>{[product.city, product.state].filter(Boolean).join(', ')}</Text>
              </>
            )}
          </View>

          {/* Pricing Tiers */}
          <View style={ss.tiersCard}>
            {[
              { label: '1–49 Units', val: price },
              { label: '50–199 Units', val: price * 0.94 },
              { label: '≥200 Units', val: price * 0.87, accent: true },
            ].map((t, i) => (
              <View key={i} style={[ss.tier, i > 0 && ss.tierBorder]}>
                <Text style={ss.tierLabel}>{t.label}</Text>
                <Text style={[ss.tierPrice, t.accent && { color: ACCENT }]}>
                  ₹{t.val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </Text>
              </View>
            ))}
          </View>


          {/* Supplier Card */}
          <View style={ss.supplierCard}>
            <View style={ss.supplierAvatar}>
              <Text style={ss.supplierInitial}>{(product.userName || 'S').charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ss.supplierName}>{product.userName}</Text>
              <Text style={ss.supplierRole}>Verified Supplier</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push(`/shop/${product.userId}` as any)}
              style={ss.supplierActionBtn}>
              <Ionicons name="storefront-outline" size={14} color={ACCENT} />
              <Text style={ss.supplierActionTxt}>Shop</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleChat} disabled={chatLoading} style={[ss.supplierActionBtn, { marginLeft: 6 }]}>
              <Ionicons name="chatbubble-outline" size={14} color={ACCENT} />
              <Text style={ss.supplierActionTxt}>{chatLoading ? '…' : 'Chat'}</Text>
            </TouchableOpacity>
          </View>

          {/* Description / Specs tabs */}
          <View style={ss.tabsBar}>
            {(['desc', 'specs'] as const).map(t => (
              <TouchableOpacity key={t} onPress={() => setActiveTab(t)} style={[ss.tabBtn, activeTab === t && ss.tabBtnActive]}>
                <Text style={[ss.tabBtnTxt, activeTab === t && ss.tabBtnTxtActive]}>
                  {t === 'desc' ? 'Description' : 'Specifications'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {activeTab === 'desc' ? (
            <View style={ss.tabContent}>
              <Text style={ss.descTxt}>
                {product.description || 'No description provided for this product.'}
              </Text>
            </View>
          ) : (
            <View style={ss.tabContent}>
              {[
                ['Category', product.category],
                ['Price', `₹${price.toLocaleString('en-IN')}`],
                ['Stock', stock > 0 ? `${stock} units available` : 'Out of stock'],
                ['Seller', product.userName],
                ['Location', [product.city, product.state].filter(Boolean).join(', ') || '—'],
              ].map(([k, v]) => (
                <View key={k} style={ss.specRow}>
                  <Text style={ss.specKey}>{k}</Text>
                  <Text style={ss.specVal}>{v}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[ss.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {inCart ? (
          // Show quantity selector when already in cart
          <View style={ss.cartUpdateRow}>
            <TouchableOpacity
              onPress={() => { if (cartQty > 1) updateQuantity(product.id, cartQty - 1); else removeFromCart(product.id); }}
              activeOpacity={0.6}
              style={ss.qtyStepBtn}>
              <Ionicons name="remove" size={18} color={ACCENT} />
            </TouchableOpacity>
            <View style={ss.qtyDisplay}>
              <Text style={ss.cartQtyVal}>{cartQty}</Text>
              <Text style={ss.stockLimitTxt}>of {stock}</Text>
            </View>
            <TouchableOpacity
              onPress={() => { if (cartQty < stock) updateQuantity(product.id, cartQty + 1); }}
              activeOpacity={cartQty >= stock ? 0.5 : 0.6}
              style={[ss.qtyStepBtn, cartQty >= stock && { opacity: 0.5, backgroundColor: '#F3F4F6' }]}>
              <Ionicons name="add" size={18} color={cartQty >= stock ? MUTED : ACCENT} />
            </TouchableOpacity>
          </View>
        ) : (
          <Animated.View style={[{ flex: 1, transform: [{ scale: scaleAnim }] }]}>
            <TouchableOpacity
              onPress={handleAddToCart}
              disabled={stock === 0}
              style={[ss.addBtn, stock === 0 && { opacity: 0.4 }]}>
              <Ionicons name="bag-add-outline" size={18} color="#FFF" />
              <Text style={ss.addBtnTxt}>Add to Cart</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  loadingDot: { width: 40, height: 40, borderRadius: 20, backgroundColor: ACCENT_BG },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: TEXT },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: ACCENT, borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: CARD,
  },
  cartBadgeTxt: { color: '#FFF', fontSize: 9, fontFamily: 'Inter_700Bold' },

  imgWrap: { width, height: IMG_H * 0.75, backgroundColor: '#F3F4F6', position: 'relative' },
  mainImg: { width: '100%', height: '100%' },
  noImg: { alignItems: 'center', justifyContent: 'center' },
  discountBadge: {
    position: 'absolute', top: 14, left: 14,
    backgroundColor: DANGER, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4,
  },
  discountTxt: { color: '#FFF', fontSize: 11, fontFamily: 'Inter_700Bold' },
  imgLikeBtn: {
    position: 'absolute', top: 12, right: 12,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: CARD, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, elevation: 4,
  },
  oosBanner: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  oosTxt: { color: '#FFF', fontSize: 18, fontFamily: 'Inter_700Bold' },

  thumbsRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 10, flexDirection: 'row' },
  thumb: {
    width: 60, height: 60, borderRadius: 10, borderWidth: 2,
    borderColor: BORDER, overflow: 'hidden', backgroundColor: '#F9FAFB',
  },
  thumbActive: { borderColor: ACCENT },
  thumbImg: { width: '100%', height: '100%' },

  content: { paddingHorizontal: 16, paddingTop: 4 },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  catChip: { backgroundColor: ACCENT_BG, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  catTxt: { color: ACCENT, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  stockChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  stockTxt: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  title: { fontSize: 20, fontFamily: 'Inter_700Bold', color: TEXT, lineHeight: 28, marginBottom: 8 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
  metaRatingVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: TEXT },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: BORDER },
  metaLoc: { fontSize: 13, color: MUTED, fontFamily: 'Inter_400Regular' },

  tiersCard: {
    flexDirection: 'row', backgroundColor: '#F9FAFB', borderRadius: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 16, overflow: 'hidden',
  },
  tier: { flex: 1, padding: 12, alignItems: 'center' },
  tierBorder: { borderLeftWidth: 1, borderLeftColor: BORDER },
  tierLabel: { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular', marginBottom: 4, textAlign: 'center' },
  tierPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: TEXT },

  qtyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 16, backgroundColor: CARD,
    borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    padding: 12,
  },
  qtyLabel: { fontSize: 14, fontFamily: 'Inter_500Medium', color: TEXT, flex: 1 },
  qtyStepper: {
    flexDirection: 'row', alignItems: 'center', gap: 0,
    backgroundColor: '#F3F4F6', borderRadius: 10, overflow: 'hidden',
  },
  qtyStepBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  qtyVal: { fontSize: 15, fontFamily: 'Inter_700Bold', color: TEXT, minWidth: 32, textAlign: 'center' },
  totalPriceLbl: { fontSize: 13, fontFamily: 'Inter_400Regular', color: SUB },

  supplierCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    padding: 12, marginBottom: 16,
  },
  supplierAvatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: ACCENT_BG,
    alignItems: 'center', justifyContent: 'center',
  },
  supplierInitial: { fontSize: 18, fontFamily: 'Inter_700Bold', color: ACCENT },
  supplierName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: TEXT },
  supplierRole: { fontSize: 12, color: SUCCESS, fontFamily: 'Inter_500Medium' },
  supplierActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: ACCENT_BG, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6,
  },
  supplierActionTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: ACCENT },

  tabsBar: {
    flexDirection: 'row', borderRadius: 10, backgroundColor: '#F3F4F6',
    padding: 4, marginBottom: 12,
  },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: CARD, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  tabBtnTxt: { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },
  tabBtnTxtActive: { color: TEXT, fontFamily: 'Inter_600SemiBold' },
  tabContent: { marginBottom: 20 },
  descTxt: { fontSize: 14, color: SUB, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  specRow: {
    flexDirection: 'row', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  specKey: { width: 110, fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },
  specVal: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: TEXT },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: CARD, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: BORDER,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 12,
  },
  cartUpdateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: ACCENT_BG, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1.5, borderColor: ACCENT,
  },
  qtyStepBtn: {
    width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFF', borderWidth: 1, borderColor: ACCENT,
  },
  qtyDisplay: { alignItems: 'center', gap: 1 },
  cartQtyVal: { fontSize: 16, fontFamily: 'Inter_700Bold', color: ACCENT },
  stockLimitTxt: { fontSize: 10, color: MUTED, fontFamily: 'Inter_400Regular' },
  cartPriceDivider: { width: 1, height: 24, backgroundColor: ACCENT + '40', marginHorizontal: 4 },
  cartPriceLabel: { fontSize: 10, color: MUTED, fontFamily: 'Inter_400Regular' },
  cartPriceVal: { fontSize: 16, fontFamily: 'Inter_700Bold', color: ACCENT },
  priceTag: { gap: 2 },
  priceTagSub: { fontSize: 10, color: MUTED, fontFamily: 'Inter_400Regular' },
  priceTagVal: { fontSize: 18, fontFamily: 'Inter_700Bold', color: ACCENT },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24,
    minWidth: 200,
  },
  addBtnTxt: { color: '#FFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  buyBtn: {
    backgroundColor: '#111827', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  buyBtnTxt: { color: '#FFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
