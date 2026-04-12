import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView,
  Platform, Pressable, TextInput, Alert, ActivityIndicator,
  RefreshControl, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';

// Colors
const PRIMARY = '#6B46C1';
const DARK = '#111827';
const GRAY = '#6B7280';
const BORDER = '#E5E7EB';
const BG = '#F9FAFB';
const WHITE = '#FFFFFF';
const SUCCESS = '#10B981';
const STAR = '#FBBF24';

// Types
interface ShopItem {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  image: string;
  address: string;
  distance: number | undefined;
  isOpen: boolean;
  phone?: string;
  role: string;
}

interface ProductItem {
  id: string;
  name: string;
  price: string;
  shopName: string;
  shopId: string;
  image: string;
  distance: number | undefined;
}

function getImgUri(img: string) {
  if (!img) return '';
  if (img.startsWith('http')) return img;
  if (img.startsWith('/')) return `${getApiUrl()}${img}`;
  return img;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Shop Card — matches Nearby screen exactly
function ShopCard({ shop }: { shop: ShopItem }) {
  const { startConversation, profile } = useApp();

  const handleChat = async () => {
    if (!profile?.id) {
      Alert.alert('Error', 'Please log in to chat');
      return;
    }
    const convoId = await startConversation(shop.id, shop.name, shop.role as any);
    if (convoId) {
      router.push({ pathname: '/chat/[id]', params: { id: convoId } });
    }
  };

  const handleCall = () => {
    if (shop.phone) {
      if (Platform.OS === 'web') {
        window.open(`tel:${shop.phone}`);
      } else {
        Linking.openURL(`tel:${shop.phone}`).catch(() => {
          Alert.alert('Error', 'Unable to make call. Please try again.');
        });
      }
    } else {
      Alert.alert('Call', `No phone number available for ${shop.name}`);
    }
  };

  const imgUri = getImgUri(shop.image);

  return (
    <Pressable style={styles.shopCard} onPress={() => router.push({ pathname: '/shop/[supplierId]', params: { supplierId: shop.id } } as any)}>
      {imgUri ? (
        <Image source={{ uri: imgUri }} style={styles.shopImage} contentFit="cover" />
      ) : (
        <View style={[styles.shopImage, { backgroundColor: PRIMARY + '22', alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name="storefront" size={28} color={PRIMARY} />
        </View>
      )}

      <View style={styles.shopContent}>
        <Text style={styles.shopName} numberOfLines={1}>{shop.name}</Text>

        <View style={styles.ratingRow}>
          <Ionicons name="star" size={14} color={STAR} />
          <Text style={styles.rating}>{shop.rating.toFixed(1)}</Text>
          <Text style={styles.reviewCount}>({shop.reviewCount} reviews)</Text>
        </View>

        <Text style={styles.address} numberOfLines={1}>{shop.address}</Text>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: SUCCESS }]} />
          <Text style={[styles.status, { color: SUCCESS }]}>Open</Text>
          {shop.distance !== undefined ? (
            <Text style={styles.distance}>{shop.distance.toFixed(1)} km away</Text>
          ) : null}
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.btnCall} onPress={handleCall}>
            <Ionicons name="call" size={14} color={DARK} />
            <Text style={styles.btnCallText}>Call</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.btnChat} onPress={handleChat}>
            <Ionicons name="chatbubble" size={14} color={WHITE} />
            <Text style={styles.btnChatText}>Chat</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.btnView}
            onPress={() => router.push({ pathname: '/shop/[supplierId]', params: { supplierId: shop.id } } as any)}
          >
            <Ionicons name="chevron-forward" size={14} color={GRAY} />
          </TouchableOpacity>
        </View>
      </View>
    </Pressable>
  );
}

// Product Card — grid layout matching Nearby screen
function ProductCard({ product }: { product: ProductItem }) {
  const imgUri = getImgUri(product.image);

  return (
    <Pressable
      style={styles.productCard}
      onPress={() => router.push({ pathname: '/shop/[supplierId]', params: { supplierId: product.shopId } } as any)}
    >
      {imgUri ? (
        <Image source={{ uri: imgUri }} style={styles.productImage} contentFit="cover" />
      ) : (
        <View style={[styles.productImage, { backgroundColor: PRIMARY + '15', alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name="cube-outline" size={32} color={PRIMARY} />
        </View>
      )}

      <View style={styles.productContent}>
        <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
        <Text style={styles.productPrice}>{product.price}</Text>
        <Text style={styles.productShop} numberOfLines={1}>
          {product.shopName}{product.distance !== undefined ? ` • ${product.distance.toFixed(1)} km` : ''}
        </Text>
        <View style={styles.productButtonRow}>
          <TouchableOpacity
            style={styles.productBtn}
            onPress={() => router.push({ pathname: '/shop/[supplierId]', params: { supplierId: product.shopId } } as any)}
          >
            <Text style={styles.productBtnText}>View</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Pressable>
  );
}

// Distance filter bar — matches Nearby screen
function DistanceBar({
  sliderValue,
  selectedDistance,
  onDistanceChange,
}: {
  sliderValue: number;
  selectedDistance: number | 'ALL';
  onDistanceChange: (val: number | 'ALL') => void;
}) {
  const isWeb = Platform.OS === 'web';
  const isAllIndia = selectedDistance === 'ALL';

  return (
    <View style={styles.sliderContainer}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>
          {isAllIndia ? 'Showing results across India' : `Showing results within ${Math.round(sliderValue)} km`}
        </Text>
      </View>

      <View style={styles.quickSelectRow}>
        {[2, 5, 10].map(km => (
          <TouchableOpacity
            key={km}
            style={[styles.quickSelectBtn, !isAllIndia && Math.round(sliderValue) === km && styles.quickSelectBtnActive]}
            onPress={() => onDistanceChange(km)}
          >
            <Text style={[styles.quickSelectText, !isAllIndia && Math.round(sliderValue) === km && styles.quickSelectTextActive]}>
              {km} km
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.quickSelectBtn, isAllIndia && styles.quickSelectBtnActive]}
          onPress={() => onDistanceChange('ALL')}
        >
          <Text style={[styles.quickSelectText, isAllIndia && styles.quickSelectTextActive]}>All India</Text>
        </TouchableOpacity>
      </View>

      {!isAllIndia && isWeb && (
        <input
          type="range"
          min="1"
          max="20"
          step="1"
          value={Math.round(sliderValue)}
          onChange={(e) => onDistanceChange(Number(e.target.value))}
          style={{
            width: '100%',
            height: 6,
            borderRadius: 3,
            outline: 'none',
            marginTop: 4,
            marginBottom: 4,
            cursor: 'pointer',
            accentColor: PRIMARY,
          } as any}
        />
      )}
    </View>
  );
}

// Main Screen
export default function MarketplaceScreen() {
  const insets = useSafeAreaInsets();
  const { allProfiles, startConversation, profile } = useApp();
  const isTechnician = profile?.role === 'technician';
  const isCustomer = profile?.role === 'customer';
  
  const [tab, setTab] = useState<'shops' | 'products'>('shops');
  const [search, setSearch] = useState('');
  const [selectedDistance, setSelectedDistance] = useState<number | 'ALL'>('ALL');
  const [sliderValue, setSliderValue] = useState(2);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [shops, setShops] = useState<ShopItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loadingShops, setLoadingShops] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const topPad = (Platform.OS === 'web' ? 67 : insets.top) + 12;

  const handleDistanceChange = useCallback((distance: number | 'ALL') => {
    if (distance === 'ALL') {
      setSelectedDistance('ALL');
      setSliderValue(2);
    } else {
      setSliderValue(distance);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setSelectedDistance(distance), 300);
    }
  }, []);

  // Request location
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'web') return;
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({});
          setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        }
      } catch {}
    })();
  }, []);

  // Fetch shops (suppliers for technicians, shopkeepers for customers)
  const fetchShops = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/profiles');
      const data = await res.json();
      const profiles = Array.isArray(data) ? data : (data.profiles || []);

      // Technicians see suppliers, customers see shopkeepers
      const targetRole = isTechnician ? 'supplier' : 'shopkeeper';

      const mapped: ShopItem[] = profiles
        .filter((u: any) => u.role === targetRole && !u.blocked_at)
        .map((s: any) => {
          let distance: number | undefined;
          if (location && s.latitude && s.longitude) {
            const lat = parseFloat(s.latitude);
            const lng = parseFloat(s.longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
              distance = calculateDistance(location.latitude, location.longitude, lat, lng);
            }
          }
          return {
            id: s.id,
            name: s.businessName || s.name || 'Shop',
            rating: parseFloat(s.rating) || 4.5,
            reviewCount: parseInt(s.ratingCount) || 0,
            image: s.shopThumbnail || s.bannerImage || s.profilePhoto || '',
            address: [s.city, s.state].filter(Boolean).join(', ') || 'India',
            distance,
            isOpen: true,
            phone: s.phone || '',
            role: s.role,
          };
        });

      setShops(mapped);
    } catch {
      setShops([]);
    } finally {
      setLoadingShops(false);
      setRefreshing(false);
    }
  }, [location, isTechnician]);

  // Fetch products (suppliers for technicians, shopkeepers for customers)
  const fetchProducts = useCallback(async () => {
    try {
      // Technicians see supplier products, customers see shopkeeper products
      const targetRole = isTechnician ? 'supplier' : 'shopkeeper';
      const res = await apiRequest('GET', `/api/products?role=${targetRole}`);
      const data = await res.json();
      const all = Array.isArray(data) ? data : [];

      const mapped: ProductItem[] = all.map((p: any) => {
        const seller = allProfiles.find((prof: any) => prof.id === p.userId);
        let distance: number | undefined;
        if (location && seller?.latitude && seller?.longitude) {
          const lat = parseFloat(seller.latitude);
          const lng = parseFloat(seller.longitude);
          if (!isNaN(lat) && !isNaN(lng)) {
            distance = calculateDistance(location.latitude, location.longitude, lat, lng);
          }
        }
        return {
          id: p.id?.toString() || Math.random().toString(),
          name: p.title || p.name || 'Product',
          price: p.price ? `₹${p.price}` : '₹0',
          shopName: p.userName || seller?.businessName || seller?.name || 'Shop',
          shopId: p.userId || '',
          image: Array.isArray(p.images) ? (p.images[0] || '') : (p.image || ''),
          distance,
        };
      });

      setProducts(mapped);
    } catch (e) {
      console.log('Error fetching products:', e);
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  }, [location, allProfiles, isTechnician]);

  useEffect(() => { fetchShops(); }, [fetchShops]);
  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchShops();
    fetchProducts();
  }, [fetchShops, fetchProducts]);

  // Filter shops
  const filteredShops = useMemo(() => {
    let list = shops;
    if (selectedDistance !== 'ALL') {
      list = list.filter(s => s.distance === undefined || s.distance <= selectedDistance);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q));
    }
    return list.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }, [selectedDistance, search, shops]);

  // Filter products
  const filteredProducts = useMemo(() => {
    let list = products;
    if (selectedDistance !== 'ALL') {
      list = list.filter(p => p.distance === undefined || p.distance <= selectedDistance);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.shopName.toLowerCase().includes(q));
    }
    return list.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }, [selectedDistance, search, products]);

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={GRAY} />
          <TextInput
            style={styles.searchInput}
            placeholder={tab === 'shops' ? 'Search shops, locations...' : 'Search products, shops...'}
            placeholderTextColor={GRAY}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={GRAY} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.locationRow}>
          <Ionicons name="storefront" size={14} color={PRIMARY} />
          <Text style={styles.locationText}>{isTechnician ? 'Suppliers' : 'Shopkeepers'}</Text>
          <Text style={styles.countText}>
            {selectedDistance === 'ALL'
              ? `${tab === 'shops' ? filteredShops.length + ' shops' : filteredProducts.length + ' products'} across India`
              : `${tab === 'shops' ? filteredShops.length + ' shops' : filteredProducts.length + ' products'} within ${selectedDistance} km`}
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, tab === 'shops' && styles.tabActive]}
          onPress={() => setTab('shops')}
        >
          <Ionicons name="storefront" size={15} color={tab === 'shops' ? PRIMARY : GRAY} style={{ marginRight: 5 }} />
          <Text style={[styles.tabText, tab === 'shops' && styles.tabTextActive]}>Shops</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'products' && styles.tabActive]}
          onPress={() => setTab('products')}
        >
          <Ionicons name="cube" size={15} color={tab === 'products' ? PRIMARY : GRAY} style={{ marginRight: 5 }} />
          <Text style={[styles.tabText, tab === 'products' && styles.tabTextActive]}>Products</Text>
        </TouchableOpacity>
      </View>

      {/* Distance Filter */}
      <DistanceBar sliderValue={sliderValue} selectedDistance={selectedDistance} onDistanceChange={handleDistanceChange} />
    </View>
  );

  const isLoading = tab === 'shops' ? loadingShops : loadingProducts;

  const renderEmpty = () => (
    isLoading ? (
      <View style={{ alignItems: 'center', paddingTop: 40 }}>
        <ActivityIndicator color={PRIMARY} size="large" />
      </View>
    ) : (
      <View style={styles.emptyState}>
        <Ionicons name={tab === 'shops' ? 'storefront-outline' : 'cube-outline'} size={48} color={BORDER} />
        <Text style={styles.emptyText}>
          No {tab === 'shops' ? 'shops' : 'products'} found
        </Text>
        <Text style={styles.emptySubText}>
          {selectedDistance !== 'ALL' ? 'Try increasing the distance or select All India' : 'Check back later'}
        </Text>
      </View>
    )
  );

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {tab === 'shops' ? (
        <FlatList
          key="shops-list"
          data={filteredShops}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <ShopCard shop={item} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          scrollEnabled={true}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />}
        />
      ) : (
        <FlatList
          key="products-grid"
          data={filteredProducts}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={styles.productGrid}
          renderItem={({ item }) => <ProductCard product={item} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          scrollEnabled={true}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WHITE,
  },

  header: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: WHITE,
    borderBottomColor: BORDER,
    borderBottomWidth: 1,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: BG,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },

  searchInput: {
    flex: 1,
    fontSize: 14,
    color: DARK,
    fontFamily: 'Inter_400Regular',
  },

  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },

  locationText: {
    fontSize: 13,
    color: DARK,
    fontFamily: 'Inter_600SemiBold',
  },

  countText: {
    fontSize: 12,
    color: GRAY,
    fontFamily: 'Inter_400Regular',
  },

  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: WHITE,
    borderBottomColor: BORDER,
    borderBottomWidth: 1,
    paddingHorizontal: 14,
  },

  tab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },

  tabActive: {
    borderBottomColor: PRIMARY,
  },

  tabText: {
    fontSize: 14,
    color: GRAY,
    fontFamily: 'Inter_600SemiBold',
  },

  tabTextActive: {
    color: PRIMARY,
  },

  sliderContainer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: WHITE,
    borderBottomColor: BORDER,
    borderBottomWidth: 1,
  },

  sliderHeader: {
    marginBottom: 10,
  },

  sliderLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: DARK,
  },

  quickSelectRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },

  quickSelectBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
  },

  quickSelectBtnActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },

  quickSelectText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: GRAY,
  },

  quickSelectTextActive: {
    color: WHITE,
  },

  listContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'web' ? 100 : 80,
  },

  // Shop Card
  shopCard: {
    flexDirection: 'row',
    backgroundColor: WHITE,
    borderRadius: 14,
    minHeight: 110,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  shopImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: BG,
  },

  shopContent: {
    flex: 1,
    justifyContent: 'space-between',
  },

  shopName: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: DARK,
    marginBottom: 3,
  },

  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },

  rating: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: DARK,
  },

  reviewCount: {
    fontSize: 12,
    color: GRAY,
    fontFamily: 'Inter_400Regular',
  },

  address: {
    fontSize: 12,
    color: GRAY,
    fontFamily: 'Inter_400Regular',
    marginBottom: 4,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  status: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },

  distance: {
    fontSize: 11,
    color: GRAY,
    fontFamily: 'Inter_400Regular',
    marginLeft: 4,
  },

  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },

  btnCall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
  },

  btnCallText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: DARK,
  },

  btnChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: PRIMARY,
  },

  btnChatText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: WHITE,
  },

  btnView: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },

  // Product Card
  productGrid: {
    gap: 12,
    marginBottom: 12,
  },

  productCard: {
    flex: 1,
    backgroundColor: WHITE,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  productImage: {
    width: '100%',
    height: 130,
    backgroundColor: BG,
  },

  productContent: {
    padding: 10,
  },

  productName: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: DARK,
    marginBottom: 4,
    lineHeight: 18,
  },

  productPrice: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: PRIMARY,
    marginBottom: 3,
  },

  productShop: {
    fontSize: 11,
    color: GRAY,
    fontFamily: 'Inter_400Regular',
    marginBottom: 8,
  },

  productButtonRow: {
    flexDirection: 'row',
  },

  productBtn: {
    flex: 1,
    backgroundColor: PRIMARY + '15',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },

  productBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: PRIMARY,
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
  },

  emptyText: {
    marginTop: 12,
    fontSize: 15,
    color: DARK,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },

  emptySubText: {
    marginTop: 6,
    fontSize: 13,
    color: GRAY,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
});
