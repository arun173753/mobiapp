import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Platform,
  Alert, RefreshControl, ActivityIndicator, Dimensions, ScrollView, TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';

const C = Colors.light;
const PRIMARY = '#FF6B2C';
const GREEN = '#10B981';
const BLUE = '#007AFF';
const ORANGE = '#FF9F0A';
const webTopInset = Platform.OS === 'web' ? 67 : 0;

interface Product {
  id: string;
  title: string;
  price: string;
  images: string[];
  category: string;
  inStock: number;
  views: number;
  createdAt: number;
  likes?: string[];
  userId: string;
  userName?: string;
  userRole?: string;
  userAvatar?: string;
  description?: string;
  videoUrl?: string;
  city?: string;
  state?: string;
  deliveryInfo?: string;
  contactPhone?: string;
}

interface Order {
  id: string;
  productTitle: string;
  productImage?: string;
  buyerName: string;
  buyerPhone?: string;
  quantity: number;
  totalAmount: string;
  status: string;
  createdAt: number;
  deliveryAddress?: string;
  city?: string;
  sellerNotes?: string;
}

type OrderTab = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'old';

const ORDER_TABS: { key: OrderTab; label: string; statuses: string[]; color: string; icon: any }[] = [
  { key: 'pending',   label: 'Pending',   statuses: ['pending'],             color: ORANGE, icon: 'time-outline' },
  { key: 'confirmed', label: 'Confirmed', statuses: ['confirmed'],            color: BLUE,   icon: 'checkmark-circle-outline' },
  { key: 'shipped',   label: 'Shipped',   statuses: ['shipped'],              color: '#8B5CF6', icon: 'cube-outline' },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered'],            color: GREEN,  icon: 'checkmark-done-outline' },
  { key: 'old',       label: 'Old Orders',statuses: ['completed','cancelled','rejected'], color: '#9CA3AF', icon: 'archive-outline' },
];

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: any; color: string }) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <View style={[styles.statIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProductRow({ product, onEdit, onDelete }: { product: Product; onEdit: () => void; onDelete: () => void }) {
  const imgs = product.images || [];
  const img = Array.isArray(imgs) && imgs.length > 0 && imgs[0] 
    ? (imgs[0].startsWith('/') ? `${getApiUrl()}${imgs[0]}` : imgs[0]) 
    : '';
  const price = parseFloat(product.price) || 0;
  return (
    <View style={styles.productRow}>
      <View style={styles.productImgWrap}>
        {img ? (
          <Image source={{ uri: img }} style={styles.productImg} contentFit="cover" />
        ) : (
          <View style={[styles.productImg, styles.imgPlaceholder]}>
            <Ionicons name="cube-outline" size={22} color={C.textTertiary} />
          </View>
        )}
      </View>
      <View style={styles.productInfo}>
        <Text style={styles.productTitle} numberOfLines={1}>{product.title}</Text>
        <Text style={styles.productCat}>{product.category}</Text>
        <View style={styles.productMeta}>
          <Text style={styles.productPrice}>₹{price.toLocaleString('en-IN')}</Text>
          <View style={[styles.stockBadge, { backgroundColor: product.inStock > 0 ? '#34C75918' : '#FF3B3018' }]}>
            <Text style={[styles.stockTxt, { color: product.inStock > 0 ? '#34C759' : '#FF3B30' }]}>
              {product.inStock > 0 ? 'In Stock' : 'Out'}
            </Text>
          </View>
        </View>
        <View style={styles.productStats}>
          <Ionicons name="eye-outline" size={11} color={C.textTertiary} />
          <Text style={styles.productStatTxt}>{product.views || 0} views</Text>
        </View>
      </View>
      <View style={styles.productActions} pointerEvents="auto">
        <TouchableOpacity 
          onPress={onEdit} 
          style={styles.actionBtn}
          activeOpacity={0.6}
        >
          <Ionicons name="create-outline" size={18} color={PRIMARY} />
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => { 
            console.log('[Delete] Delete button pressed for product:', product.id); 
            onDelete(); 
          }} 
          style={styles.actionBtn}
          activeOpacity={0.6}
        >
          <Ionicons name="trash-outline" size={18} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function OrderCard({
  item, onAction, loadingId,
}: {
  item: Order;
  onAction: (id: string, status: string) => void;
  loadingId: string | null;
}) {
  const isLoading = loadingId === item.id;
  const imgUri = item.productImage
    ? (item.productImage.startsWith('/') ? `${getApiUrl()}${item.productImage}` : item.productImage)
    : null;

  const statusColors: Record<string, string> = {
    pending: ORANGE, confirmed: BLUE, shipped: '#8B5CF6', delivered: GREEN,
    completed: GREEN, cancelled: '#FF3B30', rejected: '#FF3B30',
  };
  const sc = statusColors[item.status] || '#9CA3AF';
  const label = item.status.charAt(0).toUpperCase() + item.status.slice(1);
  const date = new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });

  const isPending = item.status === 'pending';
  const handlePress = () => {
    if (isPending) {
      router.push({ pathname: '/order-detail', params: { id: item.id } } as any);
    }
  };

  return (
    <Pressable onPress={handlePress} style={styles.orderCard}>
      {/* Card Top */}
      <View style={styles.cardTop}>
        {imgUri ? (
          <Image source={{ uri: imgUri }} style={styles.cardImg} contentFit="cover" />
        ) : (
          <View style={[styles.cardImg, styles.imgPlaceholder]}>
            <Ionicons name="cube-outline" size={20} color={C.textTertiary} />
          </View>
        )}
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.productTitle}</Text>
          <Text style={styles.cardBuyer}>{item.buyerName}</Text>
          {item.buyerPhone ? <Text style={styles.cardPhone}>{item.buyerPhone}</Text> : null}
          <View style={styles.cardMeta}>
            <Text style={styles.cardMetaTxt}>Qty: {item.quantity || 1}</Text>
            <Text style={styles.cardMetaTxt}>·</Text>
            <Text style={styles.cardMetaTxt}>{date}</Text>
          </View>
        </View>
        <View style={styles.cardRight}>
          <View style={[styles.statusPill, { backgroundColor: sc + '20' }]}>
            <Text style={[styles.statusPillTxt, { color: sc }]}>{label}</Text>
          </View>
          <Text style={styles.cardAmount}>₹{(parseFloat(item.totalAmount) || 0).toLocaleString('en-IN')}</Text>
        </View>
      </View>

      {/* Address */}
      {(item.deliveryAddress || item.city) ? (
        <View style={styles.addressRow}>
          <Ionicons name="location-outline" size={12} color={C.textTertiary} />
          <Text style={styles.addressTxt} numberOfLines={1}>
            {[item.deliveryAddress, item.city].filter(Boolean).join(', ')}
          </Text>
        </View>
      ) : null}

      {/* Action Buttons */}
      {item.status === 'pending' && (
        <View style={styles.btnRow}>
          <Pressable
            style={[styles.btn, styles.btnReject, isLoading && { opacity: 0.6 }]}
            onPress={() => onAction(item.id, 'rejected')}
            disabled={isLoading}
          >
            <Ionicons name="close-circle-outline" size={16} color="#FF3B30" />
            <Text style={styles.btnRejectTxt}>Reject</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnConfirm, isLoading && { opacity: 0.6 }]}
            onPress={() => onAction(item.id, 'confirmed')}
            disabled={isLoading}
          >
            {isLoading ? <ActivityIndicator size="small" color="#FFF" /> : (
              <>
                <Ionicons name="checkmark-circle-outline" size={16} color="#FFF" />
                <Text style={styles.btnTxt}>Confirm Order</Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      {item.status === 'confirmed' && (
        <Pressable
          style={[styles.btn, styles.btnShip, isLoading && { opacity: 0.6 }]}
          onPress={() => onAction(item.id, 'shipped')}
          disabled={isLoading}
        >
          {isLoading ? <ActivityIndicator size="small" color="#FFF" /> : (
            <>
              <Ionicons name="cube-outline" size={16} color="#FFF" />
              <Text style={styles.btnTxt}>Mark as Shipped</Text>
            </>
          )}
        </Pressable>
      )}

      {item.status === 'shipped' && (
        <Pressable
          style={[styles.btn, styles.btnDeliver, isLoading && { opacity: 0.6 }]}
          onPress={() => onAction(item.id, 'delivered')}
          disabled={isLoading}
        >
          {isLoading ? <ActivityIndicator size="small" color="#FFF" /> : (
            <>
              <Ionicons name="checkmark-done-circle-outline" size={16} color="#FFF" />
              <Text style={styles.btnTxt}>Mark as Delivered</Text>
            </>
          )}
        </Pressable>
      )}
    </Pressable>
  );
}

export default function SupplierProductsScreen() {
  const insets = useSafeAreaInsets();
  const { profile, setProfile } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [activeTab, setActiveTab] = useState<'products' | 'orders'>('products');
  const [orderTab, setOrderTab] = useState<OrderTab>('pending');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [showThumbnailModal, setShowThumbnailModal] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const productsOffsetRef = useRef(0);
  const PROD_SERVER_PAGE = 100;

  const topInset = Platform.OS === 'web' ? webTopInset : insets.top;

  const buildProductsUrl = useCallback((offset: number) => {
    const isAdmin = profile?.role === 'admin';
    const base = isAdmin
      ? `/api/products?limit=${PROD_SERVER_PAGE}&offset=${offset}`
      : `/api/products?userId=${profile?.id}&limit=${PROD_SERVER_PAGE}&offset=${offset}`;
    return base;
  }, [profile?.id, profile?.role]);

  const loadData = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const [prodRes, ordRes] = await Promise.all([
        apiRequest('GET', buildProductsUrl(0)),
        apiRequest('GET', `/api/orders?sellerId=${profile.id}`),
      ]);
      const prodData = await prodRes.json();
      const ordData = await ordRes.json();
      if (Array.isArray(prodData)) {
        setProducts(prodData);
        productsOffsetRef.current = prodData.length;
        setHasMoreProducts(prodData.length >= PROD_SERVER_PAGE);
      }
      if (Array.isArray(ordData)) setOrders(ordData);
    } catch (e) {
      console.error('[SupplierProducts] fetch error:', e);
      Alert.alert('Error', 'Failed to load products. Pull down to refresh.');
    } finally {
      setLoading(false);
    }
  }, [profile?.id, profile?.role, buildProductsUrl]);

  const loadMoreProducts = useCallback(async () => {
    if (loadingMoreProducts || !hasMoreProducts) return;
    setLoadingMoreProducts(true);
    try {
      const res = await apiRequest('GET', buildProductsUrl(productsOffsetRef.current));
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setProducts(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newItems = data.filter((p: Product) => !existingIds.has(p.id));
          return [...prev, ...newItems];
        });
        productsOffsetRef.current += data.length;
        setHasMoreProducts(data.length >= PROD_SERVER_PAGE);
      } else {
        setHasMoreProducts(false);
      }
    } catch (e) {
      console.error('[SupplierProducts] load more error:', e);
    } finally {
      setLoadingMoreProducts(false);
    }
  }, [loadingMoreProducts, hasMoreProducts, buildProductsUrl]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    setLoadingId(orderId);
    try {
      const res = await apiRequest('PATCH', `/api/orders/${orderId}/status`, { status: newStatus });
      if (!res.ok) throw new Error('Failed');
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
      const nextTab: Record<string, OrderTab> = {
        confirmed: 'confirmed', shipped: 'shipped', delivered: 'delivered', rejected: 'old',
      };
      if (nextTab[newStatus]) setOrderTab(nextTab[newStatus]);
    } catch {
      Alert.alert('Error', 'Could not update order. Please try again.');
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = (product: Product) => {
    console.log('[Delete] Showing alert for:', product.title);
    Alert.alert('Delete Product', `Delete "${product.title}" permanently?`, [
      { text: 'Keep', style: 'cancel', onPress: () => console.log('[Delete] Cancelled') },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          console.log('[Delete] Confirmed for:', product.id);
          try {
            setLoadingId(product.id);
            const res = await apiRequest('DELETE', `/api/products/${product.id}`, { userId: profile?.id, ownerId: product.userId });
            const data = await res.json();
            console.log('[Delete] Response:', data);
            
            if (data.success || res.status === 404) {
              setProducts(prev => prev.filter(p => p.id !== product.id));
              // 404 means product doesn't exist - still success in our case
              if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Success', 'Product deleted successfully');
              // Refresh all data to ensure sync
              await loadData();
            } else {
              Alert.alert('Error', data.message || 'Failed to delete product');
            }
          } catch (e) {
            console.error('[Delete] Error:', e);
            Alert.alert('Error', 'Failed to delete product. Check your connection and try again.');
          } finally {
            setLoadingId(null);
          }
        }
      }
    ]);
  };

  const countFor = (statuses: string[]) => orders.filter(o => statuses.includes(o.status)).length;
  const ordersForTab = (tab: OrderTab) => {
    const def = ORDER_TABS.find(t => t.key === tab);
    return def ? orders.filter(o => def.statuses.includes(o.status)) : [];
  };


  const handleThumbnailUpload = async () => {
    console.log('🔵 [Thumbnail] Button clicked!');
    if (Platform.OS === 'web') {
      console.log('🟢 [Thumbnail] On browser - creating file input');
      // Browser - create DOM file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      console.log('🟢 [Thumbnail] Input created, setting onChange handler');
      input.onchange = async (e: any) => {
        console.log('🟢 [Thumbnail] File selected:', e.target?.files?.[0]?.name);
        const file = e.target?.files?.[0];
        if (file) await uploadThumbnailFile(file);
      };
      console.log('🟢 [Thumbnail] Clicking file input...');
      input.click();
    } else {
      // Native - use ImagePicker (lazy import)
      console.log('🟠 [Thumbnail] On native - importing ImagePicker');
      try {
        const ImagePicker = await import('expo-image-picker');
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Please allow photo access to upload a shop thumbnail.');
          return;
        }
        console.log('🟠 [Thumbnail] ImagePicker imported, launching library');
        const result = await ImagePicker.default.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
        });
        if (!result.canceled && result.assets[0]) {
          await uploadThumbnailFile(result.assets[0].uri);
        }
      } catch (e) {
        Alert.alert('Error', 'Failed to pick image');
        console.error('[Thumbnail] Pick error:', e);
      }
    }
  };

  const uploadThumbnailFile = async (file: File | string) => {
    setUploadingThumbnail(true);
    try {
      const formData = new FormData();

      if (file instanceof File) {
        // Web: File object
        formData.append('image', file);
      } else if (typeof file === 'string') {
        // Native: uri string
        formData.append('image', {
          uri: file,
          name: 'thumbnail.jpg',
          type: 'image/jpeg',
        } as any);
      } else {
        throw new Error('Invalid file');
      }
      
      const apiUrl = getApiUrl();
      console.log('[Thumbnail] Uploading to:', `${apiUrl}/api/upload`);
      const uploadRes = await globalThis.fetch(`${apiUrl}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      const uploadData = await uploadRes.json();
      
      console.log('[Thumbnail] Upload response:', uploadData);
      
      if (!uploadData.success) throw new Error('Upload failed: ' + (uploadData.message || 'Unknown error'));
      
      let imageUrl = uploadData.url;
      console.log('[Thumbnail] Raw image URL from server:', imageUrl);
      
      // Ensure absolute URL for local fallback URLs
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = `${getApiUrl()}${imageUrl}`;
        console.log('[Thumbnail] Converted to absolute URL:', imageUrl);
      }
      
      console.log('[Thumbnail] Final image URL to save:', imageUrl);
      
      // Update profile with thumbnail URL
      console.log('[Thumbnail] Updating profile with thumbnail URL...');
      const updateRes = await apiRequest('PUT', `/api/profiles/${profile?.id}`, {
        shopThumbnail: imageUrl,
      });
      const updateData = await updateRes.json();
      
      console.log('[Thumbnail] Profile update response:', updateData);
      
      if (updateData.success && setProfile) {
        setProfile(updateData.profile);
        setShowThumbnailModal(false);
        Alert.alert('Success', 'Shop thumbnail updated!');
      } else {
        throw new Error('Update failed: ' + (updateData.message || 'Unknown error'));
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to upload thumbnail';
      console.error('[Thumbnail] Upload error:', errorMsg);
      Alert.alert('Error', errorMsg);
    } finally {
      setUploadingThumbnail(false);
    }
  };


  const totalRevenue = orders
    .filter(o => ['delivered', 'completed'].includes(o.status))
    .reduce((s, o) => s + (parseFloat(o.totalAmount) || 0), 0);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  const currentOrders = ordersForTab(orderTab);
  const currentTabDef = ORDER_TABS.find(t => t.key === orderTab)!;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>{profile?.role === 'admin' ? 'All Products' : 'My Store'}</Text>
            <Text style={styles.headerSub}>{profile?.shopName || profile?.name || 'Hi'}{profile?.role === 'admin' ? ' (Admin)' : ''}</Text>
          </View>
          {profile?.role !== 'admin' && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setShowThumbnailModal(true)} style={[styles.addBtn, { backgroundColor: '#8B5CF6' }]}>
                <Ionicons name="image-outline" size={20} color="#FFF" />
                <Text style={styles.addBtnTxt}>Thumbnail</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/add-product' as any)} style={styles.addBtn}>
                <Ionicons name="add" size={20} color="#FFF" />
                <Text style={styles.addBtnTxt}>Add Product</Text>
              </Pressable>
            </View>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
          <StatCard label="Products"   value={products.length}        icon="cube-outline"     color={PRIMARY} />
          <StatCard label="Pending"    value={countFor(['pending'])}  icon="time-outline"     color={ORANGE}  />
          <StatCard label="Confirmed"  value={countFor(['confirmed'])} icon="checkmark-circle-outline" color={BLUE} />
          <StatCard label="Revenue"    value={`₹${Math.round(totalRevenue).toLocaleString('en-IN')}`} icon="cash-outline" color={GREEN} />
        </ScrollView>
      </View>

      {/* Main Tabs: Products / Orders */}
      <View style={styles.mainTabRow}>
        <Pressable onPress={() => setActiveTab('products')} style={[styles.mainTab, activeTab === 'products' && styles.mainTabActive]}>
          <Ionicons name="cube-outline" size={15} color={activeTab === 'products' ? PRIMARY : C.textTertiary} />
          <Text style={[styles.mainTabTxt, activeTab === 'products' && styles.mainTabTxtActive]}>Products ({products.length})</Text>
        </Pressable>
        <Pressable onPress={() => setActiveTab('orders')} style={[styles.mainTab, activeTab === 'orders' && styles.mainTabActive]}>
          <Ionicons name="receipt-outline" size={15} color={activeTab === 'orders' ? PRIMARY : C.textTertiary} />
          <Text style={[styles.mainTabTxt, activeTab === 'orders' && styles.mainTabTxtActive]}>Orders ({orders.length})</Text>
          {countFor(['pending']) > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeTxt}>{countFor(['pending'])}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {activeTab === 'products' ? (
        <FlatList
          data={products}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          scrollEnabled={products.length > 5}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />}
          onEndReached={loadMoreProducts}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            hasMoreProducts ? (
              loadingMoreProducts ? (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={PRIMARY} />
                </View>
              ) : (
                <Pressable
                  onPress={loadMoreProducts}
                  style={{ paddingVertical: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: PRIMARY, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
                    Load more products
                  </Text>
                </Pressable>
              )
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="cube-outline" size={52} color={C.textTertiary} />
              <Text style={styles.emptyTitle}>No products yet</Text>
              <Text style={styles.emptySub}>Add your first product to start selling</Text>
              <Pressable onPress={() => router.push('/add-product' as any)} style={styles.emptyBtn}>
                <Ionicons name="add" size={18} color="#FFF" />
                <Text style={styles.emptyBtnTxt}>Add First Product</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <ProductRow
              product={item}
              onEdit={() => router.push({ pathname: '/add-product', params: { productId: item.id } } as any)}
              onDelete={() => handleDelete(item)}
            />
          )}
        />
      ) : (
        <View style={{ flex: 1 }}>
          {/* Order Status Tabs — horizontal scroll */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.orderTabScroll}
            contentContainerStyle={styles.orderTabContent}
          >
            {ORDER_TABS.map(tab => {
              const count = countFor(tab.statuses);
              const isActive = orderTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setOrderTab(tab.key)}
                  style={[styles.orderTab, isActive && { borderBottomColor: tab.color, borderBottomWidth: 2 }]}
                >
                  <Ionicons name={tab.icon} size={13} color={isActive ? tab.color : C.textTertiary} />
                  <Text style={[styles.orderTabTxt, isActive && { color: tab.color, fontFamily: 'Inter_600SemiBold' }]}>
                    {tab.label}
                  </Text>
                  <View style={[styles.orderTabCount, { backgroundColor: isActive ? tab.color : C.border }]}>
                    <Text style={[styles.orderTabCountTxt, { color: isActive ? '#FFF' : C.textTertiary }]}>{count}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Orders List */}
          <FlatList
            key={orderTab}
            data={currentOrders}
            keyExtractor={i => i.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={currentTabDef.color} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name={currentTabDef.icon} size={52} color={C.textTertiary} />
                <Text style={styles.emptyTitle}>No {currentTabDef.label}</Text>
                <Text style={styles.emptySub}>
                  {orderTab === 'pending'   && 'New orders from customers will appear here'}
                  {orderTab === 'confirmed' && 'Orders you confirmed will appear here'}
                  {orderTab === 'shipped'   && 'Shipped orders will appear here'}
                  {orderTab === 'delivered' && 'Successfully delivered orders appear here'}
                  {orderTab === 'old'       && 'Completed and archived orders appear here'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <OrderCard item={item} onAction={handleStatusChange} loadingId={loadingId} />
            )}
          />
        </View>
      )}

      {/* Thumbnail Modal - Works everywhere */}
      {showThumbnailModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Shop Thumbnail</Text>
              <TouchableOpacity onPress={() => setShowThumbnailModal(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color={C.text} />
              </TouchableOpacity>
            </View>

            {profile?.shopThumbnail ? (
              <View style={styles.thumbnailPreview}>
                <Image 
                  source={{ uri: profile.shopThumbnail }} 
                  style={StyleSheet.absoluteFill} 
                  contentFit="cover"
                  onLoadStart={() => console.log('[Thumbnail] Image loading:', profile.shopThumbnail)}
                  onLoad={() => console.log('[Thumbnail] Image loaded successfully:', profile.shopThumbnail)}
                  onError={(e) => console.error('[Thumbnail] Image failed to load:', profile.shopThumbnail, e)}
                />
              </View>
            ) : (
              <View style={[styles.thumbnailPreview, { alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceElevated }]}>
                <Ionicons name="image-outline" size={48} color={C.textTertiary} />
                <Text style={{ marginTop: 12, color: C.textTertiary, fontFamily: 'Inter_400Regular' }}>No thumbnail yet</Text>
              </View>
            )}

            {Platform.OS === 'web' ? (
              <button
                onClick={handleThumbnailUpload}
                disabled={uploadingThumbnail}
                style={{
                  backgroundColor: PRIMARY,
                  color: '#FFF',
                  border: 'none',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: '600',
                  fontFamily: 'Inter',
                  width: '100%',
                  cursor: uploadingThumbnail ? 'not-allowed' : 'pointer',
                  opacity: uploadingThumbnail ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                } as any}
              >
                📤 Upload New Thumbnail
              </button>
            ) : (
              <TouchableOpacity
                style={[styles.uploadThumbnailBtn, uploadingThumbnail && { opacity: 0.6 }]}
                onPress={handleThumbnailUpload}
                disabled={uploadingThumbnail}
                activeOpacity={0.7}
              >
                {uploadingThumbnail ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={18} color="#FFF" />
                    <Text style={styles.uploadThumbnailText}>Upload New Thumbnail</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { backgroundColor: C.surface, paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', color: C.text },
  headerSub: { fontSize: 12, color: C.textTertiary, fontFamily: 'Inter_400Regular', marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: PRIMARY, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  addBtnTxt: { color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', zIndex: 999 },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingVertical: 20, paddingBottom: Platform.OS === 'web' ? 100 : 80 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontFamily: 'Inter_600SemiBold', color: C.text },
  thumbnailPreview: { width: '100%', height: 180, backgroundColor: C.surfaceElevated, borderRadius: 12, marginBottom: 16, overflow: 'hidden' },
  uploadThumbnailBtn: { backgroundColor: PRIMARY, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 10 },
  uploadThumbnailText: { color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  statCard: { backgroundColor: C.surfaceElevated, borderRadius: 12, padding: 14, minWidth: 110, borderLeftWidth: 3 },
  statIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text },
  statLabel: { fontSize: 11, color: C.textTertiary, fontFamily: 'Inter_400Regular', marginTop: 2 },
  mainTabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  mainTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  mainTabActive: { borderBottomColor: PRIMARY },
  mainTabTxt: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textTertiary },
  mainTabTxtActive: { color: PRIMARY, fontFamily: 'Inter_600SemiBold' },
  tabBadge: { backgroundColor: ORANGE, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeTxt: { color: '#FFF', fontSize: 10, fontFamily: 'Inter_700Bold' },
  orderTabScroll: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, maxHeight: 46, flexGrow: 0 },
  orderTabContent: { paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  orderTab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  orderTabTxt: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textTertiary },
  orderTabCount: { borderRadius: 8, minWidth: 18, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  orderTabCountTxt: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  list: { padding: 14, paddingBottom: Platform.OS === 'web' ? 100 : 80, gap: 12 },
  productRow: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  productImgWrap: { width: 80, height: 80 },
  productImg: { width: 80, height: 80, backgroundColor: C.surfaceElevated },
  imgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  productInfo: { flex: 1, padding: 10 },
  productTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  productCat: { fontSize: 11, color: C.textTertiary, fontFamily: 'Inter_400Regular', textTransform: 'capitalize', marginTop: 2 },
  productMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  productPrice: { fontSize: 15, fontFamily: 'Inter_700Bold', color: PRIMARY },
  stockBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  stockTxt: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  productStats: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  productStatTxt: { fontSize: 10, color: C.textTertiary, fontFamily: 'Inter_400Regular' },
  productActions: { paddingRight: 10, gap: 8 },
  actionBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  orderCard: { backgroundColor: C.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  cardTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  cardImg: { width: 56, height: 56, borderRadius: 10, backgroundColor: C.surfaceElevated },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, lineHeight: 19 },
  cardBuyer: { fontSize: 12, color: C.textSecondary, fontFamily: 'Inter_400Regular', marginTop: 2 },
  cardPhone: { fontSize: 12, color: BLUE, fontFamily: 'Inter_400Regular', marginTop: 1 },
  cardMeta: { flexDirection: 'row', gap: 6, marginTop: 5, alignItems: 'center' },
  cardMetaTxt: { fontSize: 11, color: C.textTertiary, fontFamily: 'Inter_400Regular' },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusPillTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  cardAmount: { fontSize: 14, fontFamily: 'Inter_700Bold', color: GREEN },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  addressTxt: { fontSize: 11, color: C.textTertiary, fontFamily: 'Inter_400Regular', flex: 1 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 11 },
  btnConfirm: { backgroundColor: GREEN },
  btnReject: { backgroundColor: '#FF3B3010', borderWidth: 1, borderColor: '#FF3B30', flex: 0.5 },
  btnRejectTxt: { color: '#FF3B30', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  btnShip: { backgroundColor: '#8B5CF6', marginTop: 12 },
  btnDeliver: { backgroundColor: GREEN, marginTop: 12 },
  btnTxt: { color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, marginTop: 16 },
  emptySub: { fontSize: 14, color: C.textTertiary, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 8 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PRIMARY, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
  emptyBtnTxt: { color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
