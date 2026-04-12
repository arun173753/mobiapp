import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView,
  Platform, Pressable, TextInput, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';

// Colors
const PRIMARY = '#10B981';
const DARK = '#111827';
const GRAY = '#6B7280';
const BORDER = '#E5E7EB';
const BG = '#F9FAFB';
const WHITE = '#FFFFFF';
const SUCCESS = '#10B981';

// Types
interface Shop {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  image: string;
  address: string;
  distance: number;
  isOpen: boolean;
}

interface Product {
  id: string;
  name: string;
  price: string;
  shopName: string;
  shopId: string;
  image: string;
  distance: number;
}

// Mock data
const MOCK_SHOPS: Shop[] = [
  {
    id: 's1',
    name: 'S-Connect Mobile',
    rating: 4.2,
    reviewCount: 120,
    image: 'https://via.placeholder.com/80?text=Shop1',
    address: 'Hitech City, Hyderabad',
    distance: 0.8,
    isOpen: true,
  },
  {
    id: 's2',
    name: 'Mobile Care Plus',
    rating: 4.5,
    reviewCount: 98,
    image: 'https://via.placeholder.com/80?text=Shop2',
    address: 'Jubilee Hills, Hyderabad',
    distance: 1.2,
    isOpen: true,
  },
  {
    id: 's3',
    name: 'Tech Repair Hub',
    rating: 3.8,
    reviewCount: 64,
    image: 'https://via.placeholder.com/80?text=Shop3',
    address: 'Banjara Hills, Hyderabad',
    distance: 1.9,
    isOpen: false,
  },
  {
    id: 's4',
    name: 'PhoneFix Express',
    rating: 4.6,
    reviewCount: 150,
    image: 'https://via.placeholder.com/80?text=Shop4',
    address: 'Kondapur, Hyderabad',
    distance: 2.1,
    isOpen: true,
  },
  {
    id: 's5',
    name: 'iRepair Studio',
    rating: 4.3,
    reviewCount: 85,
    image: 'https://via.placeholder.com/80?text=Shop5',
    address: 'Gachibowli, Hyderabad',
    distance: 3.5,
    isOpen: true,
  },
  {
    id: 's6',
    name: 'Device Hospital',
    rating: 4.1,
    reviewCount: 72,
    image: 'https://via.placeholder.com/80?text=Shop6',
    address: 'Manikonda, Hyderabad',
    distance: 4.2,
    isOpen: false,
  },
];

const MOCK_PRODUCTS: Product[] = [
  {
    id: 'p1',
    name: 'iPhone 14 Screen',
    price: '₹8,999',
    shopName: 'S-Connect Mobile',
    shopId: 's1',
    image: 'https://via.placeholder.com/140?text=Screen',
    distance: 0.8,
  },
  {
    id: 'p2',
    name: 'Samsung Battery',
    price: '₹2,499',
    shopName: 'Mobile Care Plus',
    shopId: 's2',
    image: 'https://via.placeholder.com/140?text=Battery',
    distance: 1.2,
  },
  {
    id: 'p3',
    name: 'USB-C Cable',
    price: '₹399',
    shopName: 'Tech Repair Hub',
    shopId: 's3',
    image: 'https://via.placeholder.com/140?text=Cable',
    distance: 1.9,
  },
  {
    id: 'p4',
    name: 'Phone Case',
    price: '₹599',
    shopName: 'PhoneFix Express',
    shopId: 's4',
    image: 'https://via.placeholder.com/140?text=Case',
    distance: 2.1,
  },
  {
    id: 'p5',
    name: 'Glass Protector',
    price: '₹299',
    shopName: 'iRepair Studio',
    shopId: 's5',
    image: 'https://via.placeholder.com/140?text=Protector',
    distance: 3.5,
  },
  {
    id: 'p6',
    name: 'Charging Port Repair',
    price: '₹1,200',
    shopName: 'Device Hospital',
    shopId: 's6',
    image: 'https://via.placeholder.com/140?text=Port',
    distance: 4.2,
  },
];

// Components
function ShopCard({ shop }: { shop: Shop }) {
  const { startConversation, profile } = useApp();

  const handleChat = async () => {
    if (!profile?.id) {
      Alert.alert('Error', 'Please log in to chat');
      return;
    }
    const convoId = await startConversation(shop.id, shop.name, 'shopkeeper');
    if (convoId) {
      router.push({ pathname: '/chat/[id]', params: { id: convoId } });
    }
  };

  const handleCall = () => {
    Alert.alert('Call', `Calling ${shop.name}`);
  };

  return (
    <Pressable style={styles.shopCard} onPress={() => router.push(`/shop/${shop.id}` as any)}>
      <Image source={{ uri: shop.image }} style={styles.shopImage} contentFit="cover" />

      <View style={styles.shopContent}>
        <Text style={styles.shopName} numberOfLines={1}>
          {shop.name}
        </Text>

        <View style={styles.ratingRow}>
          <Ionicons name="star" size={14} color="#FBBF24" />
          <Text style={styles.rating}>{shop.rating}</Text>
          <Text style={styles.reviewCount}>({shop.reviewCount})</Text>
        </View>

        <Text style={styles.address} numberOfLines={1}>
          {shop.address}
        </Text>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: shop.isOpen ? SUCCESS : '#DC2626' }]} />
          <Text style={[styles.status, { color: shop.isOpen ? SUCCESS : '#DC2626' }]}>
            {shop.isOpen ? 'Open' : 'Closed'}
          </Text>
          <Text style={styles.distance}>{shop.distance.toFixed(1)} km away</Text>
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

          <TouchableOpacity style={styles.btnView} onPress={() => router.push(`/shop/${shop.id}` as any)}>
            <Ionicons name="chevron-forward" size={14} color={GRAY} />
          </TouchableOpacity>
        </View>
      </View>
    </Pressable>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <Pressable style={styles.productCard}>
      <Image source={{ uri: product.image }} style={styles.productImage} contentFit="cover" />

      <View style={styles.productContent}>
        <Text style={styles.productName} numberOfLines={2}>
          {product.name}
        </Text>

        <Text style={styles.productPrice}>{product.price}</Text>

        <Text style={styles.productShop} numberOfLines={1}>
          From {product.shopName} • {product.distance.toFixed(1)} km
        </Text>

        <View style={styles.productButtonRow}>
          <TouchableOpacity style={styles.productBtn}>
            <Text style={styles.productBtnText}>View Product</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Pressable>
  );
}

function DistanceSlider({ sliderValue, selectedDistance, onDistanceChange }: { sliderValue: number; selectedDistance: number | 'ALL'; onDistanceChange: (val: number | 'ALL') => void }) {
  const isWeb = Platform.OS === 'web';
  const isAllIndia = selectedDistance === 'ALL';

  return (
    <View style={styles.sliderContainer}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>
          {isAllIndia ? 'Showing results across India' : `Showing results within ${Math.round(sliderValue)} km`}
        </Text>
      </View>

      {/* Quick Select Buttons */}
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
          <Text style={[styles.quickSelectText, isAllIndia && styles.quickSelectTextActive]}>
            All India
          </Text>
        </TouchableOpacity>
      </View>

      {/* Slider - Web Native Input (hidden when All India selected) */}
      {!isAllIndia && (
        isWeb ? (
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
              marginVertical: 12,
              cursor: 'pointer',
              accentColor: PRIMARY,
            } as any}
          />
        ) : (
          <View style={styles.sliderTrackContainer}>
            <Text style={styles.nativeSliderText}>Distance: {Math.round(sliderValue)} km</Text>
          </View>
        )
      )}
    </View>
  );
}

// Distance calculation helper
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Main Screen
export default function NearbyScreen() {
  const insets = useSafeAreaInsets();
  const { allProfiles } = useApp();
  const [tab, setTab] = useState<'shops' | 'products'>('shops');
  const [search, setSearch] = useState('');
  const [selectedDistance, setSelectedDistance] = useState<number | 'ALL'>(2);
  const [sliderValue, setSliderValue] = useState(2);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [supplierProducts, setSupplierProducts] = useState<any[]>([]);
  const [supplierShops, setSupplierShops] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const topPad = (Platform.OS === 'web' ? 67 : insets.top) + 12;

  // Immediate visual feedback + debounced filtering
  const handleDistanceChange = useCallback((distance: number | 'ALL') => {
    if (distance === 'ALL') {
      setSelectedDistance('ALL');
      setSliderValue(2);
    } else {
      setSliderValue(distance);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        setSelectedDistance(distance);
      }, 300);
    }
  }, []);

  // Request location
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      }
    })();
  }, []);

  // Fetch supplier and shopkeeper products
  useEffect(() => {
    const fetchSupplierProducts = async () => {
      setIsLoading(true);
      try {
        // Fetch both supplier and shopkeeper products
        const [supplierRes, shopkeeperRes] = await Promise.all([
          apiRequest('GET', '/api/products?role=supplier'),
          apiRequest('GET', '/api/products?role=shopkeeper')
        ]);
        
        const supplierProducts = await supplierRes.json();
        const shopkeeperProducts = await shopkeeperRes.json();
        let allProducts = [...supplierProducts, ...shopkeeperProducts];
        
        // Map products and calculate distances
        allProducts = allProducts.map((p: any) => {
          const seller = allProfiles.find(prof => prof.id === p.userId);
          let distance = undefined;
          if (location && seller?.latitude && seller?.longitude) {
            const sellerLat = parseFloat(seller.latitude);
            const sellerLng = parseFloat(seller.longitude);
            if (!isNaN(sellerLat) && !isNaN(sellerLng)) {
              distance = calculateDistance(location.latitude, location.longitude, sellerLat, sellerLng);
            }
          }
          return {
            id: p.id,
            name: p.title,
            price: p.price ? `₹${p.price}` : '₹0',
            shopName: p.userName || 'Shop',
            shopId: p.userId,
            image: p.images?.[0] || '',
            distance: distance || undefined,
          };
        });
        setSupplierProducts(allProducts);
      } catch (e) {
        console.log('Error fetching products:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSupplierProducts();
  }, [location, allProfiles]);

  // Fetch supplier and shopkeeper shops
  useEffect(() => {
    const fetchShops = async () => {
      try {
        const res = await apiRequest('GET', '/api/profiles');
        const data = await res.json();
        const profiles = Array.isArray(data) ? data : (data.profiles || []);
        
        let shops = profiles.filter((u: any) => 
          (u.role === 'supplier' || u.role === 'shopkeeper') && !u.blocked_at
        );
        
        // Map shops and calculate distances
        shops = shops.map((s: any) => {
          let distance = undefined;
          if (location && s.latitude && s.longitude) {
            const shopLat = parseFloat(s.latitude);
            const shopLng = parseFloat(s.longitude);
            if (!isNaN(shopLat) && !isNaN(shopLng)) {
              distance = calculateDistance(location.latitude, location.longitude, shopLat, shopLng);
            }
          }
          return {
            id: s.id,
            name: s.businessName || s.name,
            rating: parseFloat(s.rating) || 4.5,
            reviewCount: parseInt(s.ratingCount) || 0,
            image: s.shopThumbnail || s.bannerImage || 'https://via.placeholder.com/80?text=Shop',
            address: [s.city, s.state].filter(Boolean).join(', ') || 'Location not available',
            distance: distance !== undefined ? distance : undefined,
            isOpen: true,
          };
        });
        setSupplierShops(shops);
      } catch (e) {
        console.log('Error fetching shops:', e);
        setSupplierShops([]);
      }
    };
    fetchShops();
  }, []);

  // Filter shops by distance and search
  const filteredShops = useMemo(() => {
    let shops = supplierShops;
    if (selectedDistance !== 'ALL') {
      shops = shops.filter(s => s.distance === undefined || s.distance <= selectedDistance);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      shops = shops.filter(s => (s.name || '').toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q));
    }
    return shops.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }, [selectedDistance, search, supplierShops]);

  const filteredProducts = useMemo(() => {
    let products = supplierProducts;
    if (selectedDistance !== 'ALL') {
      products = products.filter(p => p.distance === undefined || p.distance <= selectedDistance);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      products = products.filter(p => (p.name || '').toLowerCase().includes(q) || (p.shopName || '').toLowerCase().includes(q));
    }
    return products.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }, [selectedDistance, search, supplierProducts]);

  const renderHeader = () => (
    <View>
      {/* Header */}
      <View style={styles.header}>
        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={GRAY} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search shops, products..."
            placeholderTextColor={GRAY}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* Location */}
        <View style={styles.locationRow}>
          <Ionicons name="location" size={14} color={PRIMARY} />
          <Text style={styles.locationText}>Hyderabad 📍</Text>
          <Text style={styles.countText}>
            {selectedDistance === 'ALL' 
              ? `Showing ${tab === 'shops' ? 'shops' : 'products'} across India`
              : `${tab === 'shops' ? filteredShops.length : filteredProducts.length} ${tab === 'shops' ? 'shops' : 'products'} within ${selectedDistance} km`
            }
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, tab === 'shops' && styles.tabActive]}
          onPress={() => setTab('shops')}
        >
          <Text style={[styles.tabText, tab === 'shops' && styles.tabTextActive]}>Shops</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, tab === 'products' && styles.tabActive]}
          onPress={() => setTab('products')}
        >
          <Text style={[styles.tabText, tab === 'products' && styles.tabTextActive]}>Products</Text>
        </TouchableOpacity>
      </View>

      {/* Distance Slider */}
      <DistanceSlider sliderValue={sliderValue} selectedDistance={selectedDistance} onDistanceChange={handleDistanceChange} />
    </View>
  );

  const renderEmptyComponent = () => (
    <View style={styles.emptyState}>
      <Ionicons name="alert-circle-outline" size={48} color={GRAY} />
      <Text style={styles.emptyText}>
        No {tab === 'shops' ? 'shops' : 'products'} within {selectedDistance} km
      </Text>
      <Text style={styles.emptySubText}>Try increasing distance</Text>
    </View>
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
          ListEmptyComponent={renderEmptyComponent}
          scrollEnabled={true}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          key="products-list"
          data={filteredProducts}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={styles.productGrid}
          renderItem={({ item }) => <ProductCard product={item} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmptyComponent}
          scrollEnabled={true}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// Styles
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
    paddingVertical: 12,
    alignItems: 'center',
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
    marginBottom: 12,
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

  sliderTrackContainer: {
    paddingHorizontal: 4,
    marginVertical: 12,
  },

  nativeSliderText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: GRAY,
    textAlign: 'center',
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },

  shopImage: {
    width: 80,
    height: 80,
    borderRadius: 10,
  },

  shopContent: {
    flex: 1,
    justifyContent: 'space-between',
  },

  shopName: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: DARK,
    marginBottom: 4,
  },

  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },

  rating: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
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
    gap: 6,
    marginBottom: 6,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  status: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },

  distance: {
    fontSize: 12,
    color: GRAY,
    fontFamily: 'Inter_400Regular',
    marginLeft: 'auto',
  },

  buttonRow: {
    flexDirection: 'row',
    gap: 6,
  },

  btnCall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    height: 36,
  },

  btnCallText: {
    fontSize: 13,
    color: DARK,
    fontFamily: 'Inter_600SemiBold',
  },

  btnChat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: PRIMARY,
    borderRadius: 8,
    height: 36,
  },

  btnChatText: {
    fontSize: 13,
    color: WHITE,
    fontFamily: 'Inter_600SemiBold',
  },

  btnView: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    height: 36,
    backgroundColor: BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },

  // Product Card
  productGrid: {
    gap: 12,
    justifyContent: 'space-between',
  },

  productCard: {
    flex: 1,
    backgroundColor: WHITE,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },

  productImage: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    marginBottom: 10,
  },

  productContent: {
    flex: 1,
  },

  productName: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: DARK,
    marginBottom: 4,
  },

  productPrice: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: PRIMARY,
    marginBottom: 4,
  },

  productShop: {
    fontSize: 11,
    color: GRAY,
    fontFamily: 'Inter_400Regular',
    marginBottom: 8,
  },

  productButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },

  productBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: PRIMARY,
    borderRadius: 8,
    alignItems: 'center',
  },

  productBtnText: {
    fontSize: 12,
    color: WHITE,
    fontFamily: 'Inter_600SemiBold',
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12,
  },

  emptyText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: DARK,
  },

  emptySubText: {
    fontSize: 13,
    color: GRAY,
    fontFamily: 'Inter_400Regular',
  },
});
