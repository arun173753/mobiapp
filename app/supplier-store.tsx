import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  ActivityIndicator, FlatList, RefreshControl, Dimensions, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '@/lib/context';
import { useCart } from '@/lib/cart-context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { T } from '@/constants/techTheme';
import { UserProfile } from '@/lib/types';

const { width } = Dimensions.get('window');
const CARD_W = (width - 48) / 2;
const webTop = Platform.OS === 'web' ? 67 : 0;

function getImgUri(img: string) {
  if (!img) return '';
  if (img.startsWith('/')) return `${getApiUrl()}${img}`;
  return img;
}

function getProductImages(product: any): string[] {
  try {
    if (Array.isArray(product.images)) return product.images;
    const parsed = JSON.parse(product.images || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Fallback: handle comma-separated strings
    if (typeof product.images === 'string' && product.images.length > 0) {
      return product.images.includes(',')
        ? product.images.split(',').filter((url: string) => url.trim().length > 0)
        : [product.images.trim()];
    }
    return [];
  }
}

function StarRating({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(s => (
        <Ionicons key={s} name={s <= Math.round(rating) ? 'star' : 'star-outline'} size={11} color="#F59E0B" />
      ))}
    </View>
  );
}

export default function SupplierStoreScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; supplierId: string }>();
  const supplierId = params.supplierId || params.id;
  const { profile: myProfile, startConversation } = useApp();
  const { addToCart, isInCart } = useCart();
  const [supplier, setSupplier] = useState<UserProfile | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, productsRes] = await Promise.all([
        apiRequest('GET', `/api/profiles/${supplierId}`),
        apiRequest('GET', '/api/products'),
      ]);
      const profileData = await profileRes.json();
      const allProducts = await productsRes.json();
      if (profileData?.id) setSupplier(profileData);
      if (Array.isArray(allProducts)) {
        setProducts(allProducts.filter((p: any) => p.userId === supplierId));
      }
    } catch (e) {
      console.error('[SupplierStore] fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supplierId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchData(); }, [fetchData]);

  const handleMessage = async () => {
    if (!myProfile || !supplier) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const convoId = await startConversation(supplier.id, supplier.name, supplier.role);
    if (convoId) router.push({ pathname: '/chat/[id]', params: { id: convoId } });
  };

  const handleAddToCart = (item: any) => {
    const imgs = getProductImages(item);
    addToCart({
      productId: item.id,
      title: item.title,
      price: parseFloat(item.price) || 0,
      image: imgs[0] ? getImgUri(imgs[0]) : '',
      supplierName: item.userName,
      supplierId: item.userId,
      inStock: item.inStock,
      category: item.category,
    });
  };

  const totalViews = products.reduce((s, p) => s + (p.views || 0), 0);
  const displayName = supplier?.shopName || supplier?.name || 'Supplier';
  const fakeRating = 4.0 + ((supplierId?.charCodeAt(0) || 65) % 10) / 10;

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  const renderHeader = () => (
    <View>
      {/* BANNER */}
      <LinearGradient colors={['#059669', '#047857']} style={styles.banner}>
        <View style={styles.bannerOverlay}>
          <View style={styles.avatarWrap}>
            {supplier?.avatar ? (
              <Image source={{ uri: getImgUri(supplier.avatar) }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{displayName[0]?.toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark" size={10} color="#fff" />
            </View>
          </View>
          <Text style={[styles.shopName, { color: '#FFFFFF' }]}>{displayName}</Text>
          {supplier?.shopName && supplier.name !== displayName && (
            <Text style={[styles.ownerName, { color: 'rgba(255,255,255,0.85)' }]}>by {supplier.name}</Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 }}>
              <Ionicons name="star" size={13} color="#FFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_700Bold' }}>{fakeRating.toFixed(1)}</Text>
            </View>
            {(supplier?.city || supplier?.state) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.8)" />
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontFamily: 'Inter_400Regular' }}>
                  {[supplier.city, supplier.state].filter(Boolean).join(', ')}
                </Text>
              </View>
            )}
          </View>
        </View>
      </LinearGradient>

      {/* STATS */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{products.length}</Text>
          <Text style={styles.statLabel}>Products</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{totalViews.toLocaleString('en-IN')}</Text>
          <Text style={styles.statLabel}>Views</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{fakeRating.toFixed(1)}</Text>
          <Text style={styles.statLabel}>Rating</Text>
        </View>
      </View>

      {/* ACTIONS */}
      {myProfile?.id !== supplierId && (
        <View style={styles.actionRow}>
          {(supplier as any)?.phone && (
            <Pressable onPress={() => Linking.openURL(`tel:${(supplier as any).phone}`)} style={styles.contactBtn}>
              <Ionicons name="call-outline" size={18} color={T.accent} />
              <Text style={styles.contactBtnText}>Call</Text>
            </Pressable>
          )}
          <Pressable onPress={handleMessage} style={styles.messageBtn}>
            <Ionicons name="chatbubble-outline" size={18} color="#fff" />
            <Text style={styles.messageBtnText}>Message Supplier</Text>
          </Pressable>
        </View>
      )}

      {/* PRODUCTS HEADING */}
      <View style={styles.productsHeader}>
        <Text style={styles.productsTitle}>Products ({products.length})</Text>
      </View>
    </View>
  );

  const renderProduct = ({ item, index }: { item: any; index: number }) => {
    const imgs = getProductImages(item);
    let img = imgs[0] ? getImgUri(imgs[0]) : '';
    // Add cache-busting to prevent stale images
    if (img) img += (img.includes('?') ? '&' : '?') + 't=' + Date.now();
    const price = parseFloat(item.price) || 0;
    const inCart = isInCart(item.id);
    const fakeDiscount = (item.views || 0) > 30 ? Math.floor((item.views || 0) % 25) + 5 : 0;
    const isLeft = index % 2 === 0;

    return (
      <Pressable
        onPress={() => router.push({ pathname: '/product-detail', params: { id: item.id } })}
        style={[styles.productCard, { marginLeft: isLeft ? 0 : 8 }]}
      >
        <View style={styles.productImgWrap}>
          {img ? (
            <Image 
              source={{ uri: img }} 
              style={styles.productImg} 
              contentFit="cover"
              cachePolicy="reload"
            />
          ) : (
            <View style={[styles.productImg, { backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="cube-outline" size={32} color={T.muted} />
            </View>
          )}
          {fakeDiscount > 0 && (
            <View style={styles.discountBadge}>
              <Text style={styles.discountText}>{fakeDiscount}%</Text>
            </View>
          )}
          {!item.inStock && (
            <View style={styles.outOfStock}>
              <Text style={{ color: '#fff', fontSize: 10, fontFamily: 'Inter_600SemiBold' }}>Out of Stock</Text>
            </View>
          )}
        </View>
        <View style={{ padding: 10 }}>
          <Text style={styles.productTitle} numberOfLines={2}>{item.title}</Text>
          <StarRating rating={3.8 + ((item.id.charCodeAt(0) || 65) % 12) / 10} />
          <Text style={styles.productPrice}>₹{price.toLocaleString('en-IN')}</Text>
          <Pressable
            onPress={e => { e.stopPropagation(); handleAddToCart(item); }}
            style={[styles.addBtn, inCart && styles.addBtnActive]}
            disabled={!item.inStock}
          >
            <Ionicons name={inCart ? 'checkmark-circle' : 'cart-outline'} size={13} color="#fff" />
            <Text style={styles.addBtnText}>{inCart ? 'In Cart' : 'Add to Cart'}</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* HEADER BAR */}
      <View style={[styles.headerBar, { paddingTop: (Platform.OS === 'web' ? webTop : insets.top) + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={T.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{displayName}</Text>
        <View style={{ width: 38 }} />
      </View>

      {!supplier ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="storefront-outline" size={56} color={T.muted} />
          <Text style={{ color: T.text, fontSize: 18, fontFamily: 'Inter_700Bold', marginTop: 16 }}>Store Not Found</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 20, backgroundColor: T.accent, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold' }}>Go Back</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={{ paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 60 }}>
              <Ionicons name="cube-outline" size={56} color={T.muted} />
              <Text style={{ color: T.text, fontSize: 18, fontFamily: 'Inter_700Bold', marginTop: 16 }}>No Products Yet</Text>
              <Text style={{ color: T.muted, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 8 }}>This supplier hasn't listed any products</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.accent} />}
          renderItem={renderProduct}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  headerBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_700Bold', color: '#111827' },
  banner: { padding: 24, paddingTop: 28, paddingBottom: 32, backgroundColor: '#059669' },
  bannerOverlay: { alignItems: 'center' },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatar: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: T.accent },
  avatarFallback: { backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: T.accent, fontSize: 34, fontFamily: 'Inter_700Bold' },
  verifiedBadge: { position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: T.green, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#0A0A14' },
  shopName: { fontSize: 24, fontFamily: 'Inter_700Bold', color: T.text },
  ownerName: { fontSize: 13, color: T.muted, fontFamily: 'Inter_400Regular', marginTop: 3 },
  statsRow: { flexDirection: 'row', backgroundColor: T.card, marginHorizontal: 16, borderRadius: 16, padding: 16, marginTop: -16, borderWidth: 1, borderColor: T.border },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: T.text },
  statLabel: { fontSize: 11, color: T.muted, fontFamily: 'Inter_400Regular', marginTop: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: T.border },
  actionRow: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 16 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14, borderWidth: 2, borderColor: T.accent, backgroundColor: 'transparent' },
  contactBtnText: { color: T.accent, fontSize: 14, fontFamily: 'Inter_700Bold' },
  messageBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: T.accent },
  messageBtnText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold' },
  productsHeader: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 12 },
  productsTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: T.text },
  productCard: { width: CARD_W, backgroundColor: T.card, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: T.border, marginBottom: 16 },
  productImgWrap: { position: 'relative', width: '100%', aspectRatio: 1, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  productImg: { width: '100%', height: '100%' },
  discountBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: T.red, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  discountText: { color: '#fff', fontSize: 10, fontFamily: 'Inter_700Bold' },
  outOfStock: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  productTitle: { color: T.text, fontSize: 12, fontFamily: 'Inter_500Medium', lineHeight: 17, marginBottom: 5 },
  productPrice: { color: T.accent, fontSize: 15, fontFamily: 'Inter_700Bold', marginTop: 5, marginBottom: 8 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: T.accent, borderRadius: 10, paddingVertical: 7 },
  addBtnActive: { backgroundColor: T.green },
  addBtnText: { color: '#fff', fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});
