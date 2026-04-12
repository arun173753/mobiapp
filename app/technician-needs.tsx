import { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Dimensions,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getApiUrl, apiRequest } from '@/lib/query-client';
import { openLink } from '@/lib/open-link';

const DK = {
  text: '#1A1A1A',
  textSecondary: '#555555',
  textTertiary: '#888888',
  background: '#FFFFFF',
  surface: '#F7F7F7',
  surfaceElevated: '#EBEBEB',
  border: '#E0E0E0',
  primary: '#FF6B2C',
};

interface Course {
  id: string;
  teacherId: string;
  teacherName: string;
  teacherAvatar: string;
  title: string;
  description: string;
  price: string;
  coverImage: string;
  category: string;
  language: string;
  totalVideos: number;
  enrollmentCount: number;
  isPublished: number;
  createdAt: number;
}

interface Product {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  userAvatar: string;
  title: string;
  description: string;
  price: string;
  category: string;
  images: string;
  city: string;
  state: string;
  inStock: number;
  likes: string;
  views: number;
  createdAt: number;
}

function getImageUri(img: string): string {
  if (img.startsWith('/')) return `${getApiUrl()}${img}`;
  return img;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function TechnicianNeedsScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [selectedTab, setSelectedTab] = useState<'all' | 'courses' | 'products'>('all');
  const [courses, setCourses] = useState<Course[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = () => {
    setLoadingCourses(true);
    setLoadingProducts(true);
    apiRequest('GET', '/api/courses?published=true')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setCourses(data);
      })
      .catch((err) => { console.warn('[TechNeeds] courses fetch error:', err); })
      .finally(() => setLoadingCourses(false));

    apiRequest('GET', '/api/products')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setProducts(data);
      })
      .catch((err) => { console.warn('[TechNeeds] products fetch error:', err); })
      .finally(() => setLoadingProducts(false));

  };

  useEffect(() => {
    fetchData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);

    Promise.all([
      apiRequest('GET', '/api/courses?published=true')
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setCourses(data);
        })
        .catch((err) => { console.warn('[TechNeeds] courses refresh error:', err); }),
      apiRequest('GET', '/api/products')
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setProducts(data);
        })
        .catch((err) => { console.warn('[TechNeeds] products refresh error:', err); }),
    ]).finally(() => setRefreshing(false));
  };

  const getProductImage = (product: Product): string => {
    let imgs: string[] = [];
    try {
      if (Array.isArray(product.images)) {
        imgs = product.images;
      } else if (typeof product.images === 'string') {
        imgs = JSON.parse(product.images || '[]');
      }
    } catch {}
    if (imgs.length > 0) return getImageUri(imgs[0]);
    return '';
  };

  type GridItem = { kind: 'course'; data: Course } | { kind: 'product'; data: Product };

  const allItems = useMemo<GridItem[]>(() => {
    const q = search.toLowerCase().trim();
    const fc: GridItem[] = selectedTab === 'products' ? [] : courses
      .filter(c => !q || (c.title || '').toLowerCase().includes(q) || (c.teacherName || '').toLowerCase().includes(q))
      .map(c => ({ kind: 'course' as const, data: c }));
    const fp: GridItem[] = selectedTab === 'courses' ? [] : products
      .filter(p => !q || (p.title || '').toLowerCase().includes(q) || (p.userName || '').toLowerCase().includes(q) || (p.city || '').toLowerCase().includes(q))
      .map(p => ({ kind: 'product' as const, data: p }));
    return [...fc, ...fp];
  }, [courses, products, search, selectedTab]);

  const isLoading = loadingCourses && loadingProducts;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={DK.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Technician Needs</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={DK.textTertiary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search courses, parts, products..."
          placeholderTextColor={DK.textTertiary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
            <Ionicons name="close-circle" size={18} color={DK.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.tabBar}>
        {([
          { key: 'all' as const, label: 'All', icon: 'grid-outline' as const },
          { key: 'courses' as const, label: 'Courses', icon: 'school-outline' as const },
          { key: 'products' as const, label: 'Spare Parts', icon: 'construct-outline' as const },
        ]).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, selectedTab === tab.key && styles.tabActive]}
            onPress={() => setSelectedTab(tab.key)}
            activeOpacity={0.7}
          >
            <Ionicons name={tab.icon} size={14} color={selectedTab === tab.key ? '#FFF' : DK.textSecondary} />
            <Text style={[styles.tabText, selectedTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={DK.primary} />
        </View>
      ) : (
        <FlatList
          data={allItems}
          keyExtractor={(item, idx) => (item.kind === 'course' ? `c_${item.data.id}` : `p_${(item.data as Product).id}`)}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[styles.gridContent, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DK.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptySection}>
              <Ionicons name="cube-outline" size={48} color={DK.textTertiary} />
              <Text style={styles.emptyText}>No courses or products found</Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'course') {
              const c = item.data;
              return (
                <TouchableOpacity
                  style={styles.gridCard}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/course-detail?id=${c.id}`)}
                >
                  <View style={styles.gridImageWrap}>
                    {c.coverImage ? (
                      <Image source={{ uri: getImageUri(c.coverImage) }} style={styles.gridImage} contentFit="cover" />
                    ) : (
                      <View style={[styles.gridImage, styles.gridImagePlaceholder]}>
                        <Ionicons name="school" size={28} color="#CCC" />
                      </View>
                    )}
                    <View style={styles.typeBadge}>
                      <Ionicons name="school" size={10} color="#FFF" />
                      <Text style={styles.typeBadgeText}>Course</Text>
                    </View>
                  </View>
                  <View style={styles.gridInfo}>
                    <Text style={styles.gridTitle} numberOfLines={2}>{c.title}</Text>
                    <Text style={styles.gridSeller} numberOfLines={1}>{c.teacherName}</Text>
                    <View style={styles.gridFooter}>
                      <Text style={styles.gridPrice}>
                        {Number(c.price) > 0 ? `\u20B9${Number(c.price).toLocaleString('en-IN')}` : 'Free'}
                      </Text>
                      {c.enrollmentCount > 0 && (
                        <View style={styles.enrollBadge}>
                          <Ionicons name="people-outline" size={11} color={DK.textTertiary} />
                          <Text style={styles.enrollCount}>{c.enrollmentCount}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            } else {
              const p = item.data as Product;
              const imgUri = getProductImage(p);
              const location = [p.city, p.state].filter(Boolean).join(', ');
              return (
                <TouchableOpacity
                  style={styles.gridCard}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/product-detail?id=${p.id}`)}
                >
                  <View style={styles.gridImageWrap}>
                    {imgUri ? (
                      <Image source={{ uri: imgUri }} style={styles.gridImage} contentFit="cover" />
                    ) : (
                      <View style={[styles.gridImage, styles.gridImagePlaceholder]}>
                        <Ionicons name="cube" size={28} color="#CCC" />
                      </View>
                    )}
                    <View style={[styles.typeBadge, { backgroundColor: '#2C7AFF' }]}>
                      <Ionicons name="construct" size={10} color="#FFF" />
                      <Text style={styles.typeBadgeText}>Product</Text>
                    </View>
                  </View>
                  <View style={styles.gridInfo}>
                    <Text style={styles.gridTitle} numberOfLines={2}>{p.title}</Text>
                    <Text style={styles.gridSeller} numberOfLines={1}>{p.userName}</Text>
                    <View style={styles.gridFooter}>
                      <Text style={styles.gridPrice}>
                        {Number(p.price) > 0 ? `\u20B9${Number(p.price).toLocaleString('en-IN')}` : 'Free'}
                      </Text>
                    </View>
                    {location ? (
                      <View style={styles.locationRow}>
                        <Ionicons name="location-outline" size={11} color={DK.textTertiary} />
                        <Text style={styles.locationText} numberOfLines={1}>{location}</Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            }
          }}
        />
      )}
    </View>
  );
}

const CARD_GAP = 10;
const CARD_WIDTH = (SCREEN_WIDTH - 16 * 2 - CARD_GAP) / 2;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DK.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: DK.text,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#F8F8F8',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: '#ECECEC',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: DK.text,
    height: 44,
  },
  clearBtn: {
    padding: 4,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F7F7F7',
    borderWidth: 1.5,
    borderColor: '#EFEFEF',
  },
  tabActive: {
    backgroundColor: DK.primary,
    borderColor: DK.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: DK.textSecondary,
  },
  tabTextActive: {
    color: '#FFF',
    fontWeight: '700' as const,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  columnWrapper: {
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  gridCard: {
    width: CARD_WIDTH,
    backgroundColor: '#FFF',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EBEBEB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  gridImageWrap: {
    position: 'relative' as const,
  },
  gridImage: {
    width: '100%' as const,
    aspectRatio: 1,
    backgroundColor: '#F7F7F7',
  },
  gridImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadge: {
    position: 'absolute' as const,
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: DK.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  typeBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700' as const,
  },
  gridInfo: {
    padding: 10,
  },
  gridTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: DK.text,
    marginBottom: 3,
  },
  gridSeller: {
    fontSize: 11,
    color: DK.textSecondary,
    marginBottom: 6,
  },
  gridFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gridPrice: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: DK.primary,
  },
  enrollBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  enrollCount: {
    fontSize: 11,
    color: DK.textTertiary,
  },
  emptySection: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: DK.textTertiary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
  },
  locationText: {
    fontSize: 11,
    color: DK.textTertiary,
    flex: 1,
  },
});

