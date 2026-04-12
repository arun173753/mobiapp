import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, ScrollView, Platform, ActivityIndicator,
  RefreshControl, Dimensions, NativeScrollEvent, NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { apiRequest, getApiUrl } from '@/lib/query-client';

const { width: SW } = Dimensions.get('window');
const COL_GAP  = 12;
const BANNER_H = SW < 768 ? 200 : 300;

const ACCENT  = '#6B46C1';
const BG      = '#FAFAFB';
const WHITE   = '#FFFFFF';
const DARK    = '#111827';
const MUTED   = '#6B7280';
const BORDER  = '#E5E7EB';
const STAR    = '#F2C94C';
const DANGER  = '#EB5757';

const TABS = ['Products', 'Categories', 'Deals', 'About Us', 'Reviews'];

function getImgUri(img: string) {
  if (!img) return '';
  if (img.startsWith('http')) return img;
  if (img.startsWith('/')) return `${getApiUrl()}${img}`;
  return img;
}

function parseImages(raw: any): string[] {
  if (Array.isArray(raw)) return raw.filter((u: any) => typeof u === 'string' && u.length > 0);
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(Boolean) : []; }
    catch { return raw.includes(',') ? raw.split(',').map((s: string) => s.trim()).filter(Boolean) : raw ? [raw] : []; }
  }
  return [];
}

function fmtPrice(v: any) {
  const n = parseFloat(v) || 0;
  return `₹${n.toLocaleString('en-IN')}`;
}

function discPct(p: any, m: any) {
  const pn = parseFloat(p) || 0, mn = parseFloat(m) || 0;
  return mn > pn ? Math.round(((mn - pn) / mn) * 100) : 0;
}

// ─── Banner Slider ─────────────────────────────────────────────────────────────
function BannerSlider({
  images, onBack, title, insetTop,
}: {
  images: string[]; onBack: () => void; title: string; insetTop: number;
}) {
  const [idx, setIdx]   = useState(0);
  const scrollRef       = useRef<ScrollView>(null);

  useEffect(() => {
    if (images.length <= 1) return;
    const t = setInterval(() => {
      const next = (idx + 1) % images.length;
      scrollRef.current?.scrollTo({ x: next * SW, animated: true });
      setIdx(next);
    }, 3500);
    return () => clearInterval(t);
  }, [idx, images.length]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    setIdx(Math.round(x / SW));
  };

  return (
    <View style={ss.bannerWrap}>
      {images.length > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          style={{ flex: 1 }}
          scrollEnabled={images.length > 1}
        >
          {images.map((uri, i) => (
            <Image key={i} source={{ uri }} style={{ width: SW, height: BANNER_H }} contentFit="cover" />
          ))}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, backgroundColor: ACCENT + '22', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="storefront" size={56} color={ACCENT} />
        </View>
      )}

      {/* Top bar with share button only */}
      <View style={[ss.bannerTopBar, { top: insetTop + 8, justifyContent: 'flex-end' }]}>
        <TouchableOpacity style={ss.bannerBtn}>
          <Ionicons name="share-outline" size={20} color={WHITE} />
        </TouchableOpacity>
      </View>

      {/* Dots */}
      {images.length > 1 && (
        <View style={ss.dots}>
          {images.map((_, i) => (
            <View key={i} style={[ss.dot, i === idx && ss.dotActive]} />
          ))}
        </View>
      )}

      {/* Arrow buttons */}
      {images.length > 1 && (
        <>
          <TouchableOpacity style={[ss.arrowBtn, { left: 12 }]} onPress={() => {
            const prev = (idx - 1 + images.length) % images.length;
            scrollRef.current?.scrollTo({ x: prev * SW, animated: true });
            setIdx(prev);
          }}>
            <Ionicons name="chevron-back" size={18} color={WHITE} />
          </TouchableOpacity>
          <TouchableOpacity style={[ss.arrowBtn, { right: 12 }]} onPress={() => {
            const next = (idx + 1) % images.length;
            scrollRef.current?.scrollTo({ x: next * SW, animated: true });
            setIdx(next);
          }}>
            <Ionicons name="chevron-forward" size={18} color={WHITE} />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// ─── Category Tabs ─────────────────────────────────────────────────────────────
function CategoryTabs({ active, onSelect }: { active: string; onSelect: (t: string) => void }) {
  return (
    <View style={ss.tabsBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ss.tabsRow}>
        {TABS.map(t => {
          const isActive = t === active;
          return (
            <TouchableOpacity key={t} style={[ss.tab, isActive && ss.tabActive]} onPress={() => onSelect(t)}>
              <Text style={[ss.tabText, isActive && ss.tabTextActive]}>
                {t}
                {t === 'Deals' ? ' 🔥' : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Product Card ──────────────────────────────────────────────────────────────
function ProductCard({ item, onPress }: { item: any; onPress: () => void }) {
  const imgs = parseImages(item.images);
  const thumbUri = getImgUri(item.thumbnail || '');
  const uri  = getImgUri(thumbUri || imgs[0] || item.image || '');
  const disc = discPct(item.price, item.mrp);
  const isNew = item.badge === 'new' || item.isNew;

  return (
    <TouchableOpacity style={ss.prodCard} onPress={onPress} activeOpacity={0.92}>
      {/* Image */}
      <View style={ss.prodImgWrap}>
        {uri ? (
          <Image source={{ uri }} style={ss.prodImg} contentFit="contain" />
        ) : (
          <View style={[ss.prodImg, { alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="cube-outline" size={32} color={BORDER} />
          </View>
        )}
        {disc > 0 && (
          <View style={ss.discBadge}><Text style={ss.discText}>-{disc}%</Text></View>
        )}
        {isNew && !disc && (
          <View style={[ss.discBadge, { backgroundColor: DARK }]}><Text style={ss.discText}>NEW</Text></View>
        )}
        <TouchableOpacity style={ss.heartBtn}>
          <Ionicons name="heart-outline" size={14} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Info */}
      <View style={ss.prodInfo}>
        {item.category && (
          <Text style={ss.prodCategory} numberOfLines={1}>{item.category}</Text>
        )}
        <Text style={ss.prodName} numberOfLines={2}>{item.name || item.title}</Text>
        <View style={{ flex: 1 }} />

        {/* Stars */}
        <View style={ss.starsRow}>
          {[1,2,3,4,5].map(s => (
            <Ionicons key={s} name={s <= Math.round(item.rating || 0) ? 'star' : 'star-outline'} size={10} color={STAR} />
          ))}
          {item.reviewCount > 0 && <Text style={ss.reviewCount}>({item.reviewCount})</Text>}
        </View>

        {/* Price */}
        <View style={ss.priceRow}>
          <Text style={ss.price}>{fmtPrice(item.price)}</Text>
          {disc > 0 && <Text style={ss.mrp}>{fmtPrice(item.mrp)}</Text>}
        </View>

        {item.moq && (
          <Text style={ss.moqText}>MOQ: {item.moq} Units</Text>
        )}

        <TouchableOpacity style={ss.addBtn} onPress={onPress}>
          <Text style={ss.addBtnText}>View Details</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Supplier Header ───────────────────────────────────────────────────────────
function SupplierHeader({ supplier }: { supplier: any }) {
  const avatarUri = getImgUri(supplier.avatar || '');
  const cats: string[] = Array.isArray(supplier.categories)
    ? supplier.categories
    : typeof supplier.categories === 'string'
      ? supplier.categories.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];

  return (
    <View style={ss.supplierHeader}>
      <View style={ss.supplierRow}>
        <View style={ss.supplierAvatar}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={{ width: 56, height: 56, borderRadius: 28 }} contentFit="cover" />
          ) : (
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: ACCENT + '22', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 22, fontFamily: 'Inter_700Bold', color: ACCENT }}>
                {(supplier.businessName || supplier.name || 'S')[0].toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={ss.supplierName}>{supplier.businessName || supplier.name}</Text>
          {(supplier.city || supplier.location) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name="location-outline" size={12} color={MUTED} />
              <Text style={{ fontSize: 12, color: MUTED, fontFamily: 'Inter_400Regular' }}>{supplier.city || supplier.location}</Text>
            </View>
          )}
          {cats.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                {cats.slice(0, 4).map((c, i) => (
                  <View key={i} style={ss.catTag}>
                    <Text style={ss.catTagText}>{c}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      </View>

      {/* Stats row */}
      {(supplier.productCount || supplier.totalOrders) && (
        <View style={ss.statsRow}>
          {supplier.productCount != null && (
            <View style={ss.statItem}>
              <Text style={ss.statVal}>{supplier.productCount}</Text>
              <Text style={ss.statLabel}>Products</Text>
            </View>
          )}
          {supplier.totalOrders != null && (
            <>
              <View style={ss.statDivider} />
              <View style={ss.statItem}>
                <Text style={ss.statVal}>{supplier.totalOrders}</Text>
                <Text style={ss.statLabel}>Orders</Text>
              </View>
            </>
          )}
          {supplier.yearsActive != null && (
            <>
              <View style={ss.statDivider} />
              <View style={ss.statItem}>
                <Text style={ss.statVal}>{supplier.yearsActive}+</Text>
                <Text style={ss.statLabel}>Years</Text>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function ShopScreen() {
  const insets = useSafeAreaInsets();
  const { supplierId, supplierName } = useLocalSearchParams<{ supplierId: string; supplierName: string }>();

  const [supplier, setSupplier]     = useState<any>(null);
  const [products, setProducts]     = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab]   = useState('Products');
  const [search, setSearch]         = useState('');
  const [sortBy, setSortBy]         = useState('recommended');
  const [selCategory, setSelCategory] = useState('All');

  const webTop = Platform.OS === 'web' ? 67 : 0;

  const fetchData = useCallback(async () => {
    try {
      const [supRes, prodsRes] = await Promise.all([
        apiRequest('GET', `/api/profiles/${supplierId}`),
        apiRequest('GET', `/api/products?supplierId=${supplierId}&limit=100`),
      ]);
      const supData   = await supRes.json();
      const prodsData = await prodsRes.json();
      setSupplier(supData);
      const arr = Array.isArray(prodsData) ? prodsData : (prodsData.products || prodsData.items || []);
      setProducts(arr);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supplierId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const allCategories = ['All', ...Array.from(new Set(products.map((p: any) => p.category).filter(Boolean)))];

  let filtered = products.filter((p: any) => {
    const q = search.toLowerCase();
    const matchQ = !q || (p.name || p.title || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q);
    const matchC = selCategory === 'All' || p.category === selCategory;
    if (activeTab === 'Deals') return matchQ && matchC && (parseFloat(p.mrp) > parseFloat(p.price));
    return matchQ && matchC;
  });

  if (sortBy === 'low') filtered = [...filtered].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  if (sortBy === 'high') filtered = [...filtered].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  if (sortBy === 'newest') filtered = [...filtered].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const bannerImages: string[] = supplier
    ? [
        getImgUri(supplier.shopThumbnail || supplier.bannerImage || supplier.shopBanner || ''),
      ].filter(Boolean)
    : [];

  const insetTop = Platform.OS === 'ios' ? insets.top : (Platform.OS === 'android' ? 12 : 0);

  const renderHeader = () => (
    <>
      {/* Banner with back button inside */}
      <BannerSlider
        images={bannerImages}
        onBack={() => router.back()}
        title={supplierName || supplier?.businessName || supplier?.name || 'Shop'}
        insetTop={insetTop + webTop}
      />

      {/* Supplier info */}
      {supplier && <SupplierHeader supplier={supplier} />}

      {/* Sticky Tabs */}
      <CategoryTabs active={activeTab} onSelect={setActiveTab} />

      {/* Search + sort bar */}
      <View style={ss.toolbar}>
        <View style={ss.toolSearch}>
          <Ionicons name="search-outline" size={14} color={MUTED} />
          <TextInput
            style={ss.toolSearchInput}
            placeholder="Search in this shop..."
            placeholderTextColor={MUTED}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {['recommended', 'low', 'high', 'newest'].map(s => (
            <TouchableOpacity
              key={s}
              style={[ss.sortBtn, sortBy === s && ss.sortBtnActive]}
              onPress={() => setSortBy(s)}
            >
              <Text style={[ss.sortBtnText, sortBy === s && ss.sortBtnTextActive]}>
                {s === 'recommended' ? 'Top' : s === 'low' ? '↑ Price' : s === 'high' ? '↓ Price' : 'New'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Category chips (mobile sub-filter) */}
      {allCategories.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ss.catScroll} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          {allCategories.map(c => (
            <TouchableOpacity
              key={c}
              style={[ss.catChip, selCategory === c && ss.catChipActive]}
              onPress={() => setSelCategory(c)}
            >
              <Text style={[ss.catChipText, selCategory === c && ss.catChipTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* About tab content */}
      {activeTab === 'About Us' && supplier && (
        <View style={ss.aboutBox}>
          <Text style={ss.aboutTitle}>About {supplier.businessName || supplier.name}</Text>
          <Text style={ss.aboutBody}>{supplier.about || supplier.bio || supplier.description || 'No description available.'}</Text>
          {supplier.phone && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <Ionicons name="call-outline" size={16} color={ACCENT} />
              <Text style={{ fontSize: 14, color: DARK, fontFamily: 'Inter_500Medium' }}>{supplier.phone}</Text>
            </View>
          )}
          {supplier.email && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Ionicons name="mail-outline" size={16} color={ACCENT} />
              <Text style={{ fontSize: 14, color: DARK, fontFamily: 'Inter_500Medium' }}>{supplier.email}</Text>
            </View>
          )}
        </View>
      )}
    </>
  );

  const renderProduct = ({ item }: { item: any }) => (
    <View style={ss.prodCellWrap}>
      <ProductCard
        item={item}
        onPress={() => router.push({ pathname: '/product-detail', params: { productId: item.id } } as any)}
      />
    </View>
  );

  if (loading) {
    return (
      <View style={[ss.root, { alignItems: 'center', justifyContent: 'center', paddingTop: webTop }]}>
        <ActivityIndicator color={ACCENT} size="large" />
        <Text style={{ marginTop: 12, color: MUTED, fontFamily: 'Inter_500Medium' }}>Loading shop...</Text>
      </View>
    );
  }

  return (
    <View style={[ss.root, { paddingTop: webTop }]}>
      <FlatList
        data={activeTab === 'About Us' ? [] : filtered}
        keyExtractor={i => i.id?.toString()}
        numColumns={2}
        renderItem={renderProduct}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: insets.bottom + 32 }}
        columnWrapperStyle={{ marginBottom: 0 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={ACCENT} />}
        ListEmptyComponent={
          activeTab !== 'About Us' ? (
            <View style={{ alignItems: 'center', paddingTop: 48, paddingBottom: 24 }}>
              <Ionicons name="cube-outline" size={44} color={BORDER} />
              <Text style={{ marginTop: 10, fontSize: 14, color: MUTED, fontFamily: 'Inter_500Medium' }}>
                {search ? 'No products match your search' : `No products in ${activeTab.toLowerCase()}`}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // Banner
  bannerWrap:    { width: '100%', height: BANNER_H, backgroundColor: '#E5E7EB', overflow: 'hidden', position: 'relative' },
  bannerOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: BANNER_H * 0.5, backgroundColor: 'rgba(0,0,0,0.25)' },
  bannerTopBar:  { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  bannerBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  bannerTitle:   { flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: WHITE },
  dots:          { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:           { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive:     { backgroundColor: ACCENT, width: 20 },
  arrowBtn:      { position: 'absolute', top: BANNER_H / 2 - 18, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },

  // Supplier Header
  supplierHeader: { backgroundColor: WHITE, padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  supplierRow:    { flexDirection: 'row', gap: 12, marginBottom: 12 },
  supplierAvatar: {},
  supplierName:   { fontSize: 17, fontFamily: 'Inter_700Bold', color: DARK },
  catTag:         { backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  catTagText:     { fontSize: 11, color: '#4B5563', fontFamily: 'Inter_500Medium' },
  statsRow:       { flexDirection: 'row', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER, gap: 0 },
  statItem:       { flex: 1, alignItems: 'center' },
  statVal:        { fontSize: 18, fontFamily: 'Inter_700Bold', color: DARK },
  statLabel:      { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular', marginTop: 2 },
  statDivider:    { width: 1, height: 30, backgroundColor: BORDER },

  // Tabs
  tabsBar:  { backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  tabsRow:  { flexDirection: 'row', paddingHorizontal: 16 },
  tab:      { paddingHorizontal: 4, paddingVertical: 14, marginRight: 24, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:{ borderBottomColor: ACCENT },
  tabText:  { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },
  tabTextActive: { color: ACCENT, fontFamily: 'Inter_600SemiBold' },

  // Toolbar
  toolbar:        { backgroundColor: WHITE, padding: 12, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 10 },
  toolSearch:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 10, paddingHorizontal: 10, gap: 6, borderWidth: 1, borderColor: BORDER, height: 38 },
  toolSearchInput:{ flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: DARK },
  sortBtn:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: WHITE },
  sortBtnActive:  { borderColor: ACCENT, backgroundColor: ACCENT + '10' },
  sortBtnText:    { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  sortBtnTextActive: { color: ACCENT },

  // Category chips
  catScroll:    { paddingVertical: 10, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER },
  catChip:      { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: WHITE },
  catChipActive:{ borderColor: ACCENT, backgroundColor: ACCENT + '10' },
  catChipText:  { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  catChipTextActive: { color: ACCENT },

  // Product
  prodCellWrap: { flex: 1, padding: COL_GAP / 2 },
  prodCard:     { backgroundColor: WHITE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1, flexDirection: 'column' },
  prodImgWrap:  { aspectRatio: 1, backgroundColor: '#F9FAFB', padding: 12, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  prodImg:      { width: '100%', height: '100%' },
  discBadge:    { position: 'absolute', top: 6, left: 6, backgroundColor: DANGER, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  discText:     { fontSize: 10, fontFamily: 'Inter_700Bold', color: WHITE },
  heartBtn:     { position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },

  prodInfo:     { padding: 10, flex: 1, flexDirection: 'column', gap: 3 },
  prodCategory: { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular' },
  prodName:     { fontSize: 13, fontFamily: 'Inter_500Medium', color: DARK, lineHeight: 18 },
  starsRow:     { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 3 },
  reviewCount:  { fontSize: 10, color: MUTED, fontFamily: 'Inter_400Regular', marginLeft: 2 },
  priceRow:     { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 },
  price:        { fontSize: 15, fontFamily: 'Inter_700Bold', color: DARK },
  mrp:          { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular', textDecorationLine: 'line-through' },
  moqText:      { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular' },
  addBtn:       { marginTop: 8, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  addBtnText:   { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: DARK },

  // About
  aboutBox:   { margin: 16, backgroundColor: WHITE, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: BORDER },
  aboutTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: DARK, marginBottom: 10 },
  aboutBody:  { fontSize: 14, color: MUTED, fontFamily: 'Inter_400Regular', lineHeight: 22 },
});
