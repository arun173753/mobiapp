import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Pressable, Platform, RefreshControl, ScrollView, ActivityIndicator, Dimensions, Modal, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay, withSpring, Easing } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useApp } from '@/lib/context';
import { UserRole, ROLE_LABELS, Post, UserProfile } from '@/lib/types';
import { getApiUrl } from '@/lib/query-client';
import MediaViewer from '@/components/MediaViewer';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_GAP = 8;
const CARD_WIDTH = (SCREEN_WIDTH - 32 - CARD_GAP) / 2;

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

// Haversine formula — returns distance in km between two lat/lng points
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

type MarketItem = {
  id: string;
  type: 'sell';
  title: string;
  price: string;
  image?: string;
  imageCount: number;
  condition?: string;
  description: string;
  sellCategory: string;
  videoUrl?: string;
  sellerId: string;
  sellerName: string;
  sellerRole: string;
  sellerAvatar?: string;
  sellerCity?: string;
  sellerState?: string;
  sellerLat?: number;
  sellerLng?: number;
  distanceKm?: number;
  likes: string[];
  comments: any[];
  createdAt: number;
  originalPost?: Post;
};

const SELL_CATEGORIES = [
  { key: 'all', label: 'All', icon: 'grid-outline' as const },
  { key: 'mobiles', label: 'Mobiles', icon: 'phone-portrait-outline' as const },
  { key: 'electronics', label: 'Electronics', icon: 'tv-outline' as const },
  { key: 'spare_parts', label: 'Spare Parts', icon: 'hardware-chip-outline' as const },
  { key: 'tools', label: 'Tools', icon: 'construct-outline' as const },
  { key: 'ewaste', label: 'E-Waste', icon: 'trash-outline' as const },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' as const },
];

function parseSellPost(text: string): { title: string; price: string; condition: string; description: string; sellCategory: string } | null {
  try {
    const lines = text.split('\n');
    const data: any = {
      title: '',
      price: '',
      condition: '',
      description: '',
      sellCategory: 'other',
    };
    for (const line of lines) {
      if (line.startsWith('SELL_TITLE:')) data.title = line.replace('SELL_TITLE:', '').trim();
      else if (line.startsWith('SELL_PRICE:')) data.price = line.replace('SELL_PRICE:', '').trim();
      else if (line.startsWith('SELL_CONDITION:')) data.condition = line.replace('SELL_CONDITION:', '').trim();
      else if (line.startsWith('SELL_DESC:')) data.description = line.replace('SELL_DESC:', '').trim();
      else if (line.startsWith('SELL_CATEGORY:')) data.sellCategory = line.replace('SELL_CATEGORY:', '').trim();
    }
    if (data.title) return data;
    return null;
  } catch { return null; }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(ts).toLocaleDateString();
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getImageUri(img: string): string {
  if (img.startsWith('/')) return `${getApiUrl()}${img}`;
  return img;
}

// ------------------------------------------------------------------
// DistanceSlider Component
// ------------------------------------------------------------------
function DistanceSlider({ sliderValue, selectedDistance, onDistanceChange }: { sliderValue: number; selectedDistance: number | 'ALL'; onDistanceChange: (val: number | 'ALL') => void }) {
  const isWeb = Platform.OS === 'web';
  const isAllIndia = selectedDistance === 'ALL';

  return (
    <View style={styles.sliderContainer}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>
          {isAllIndia ? 'Showing products across India' : `Showing results within ${Math.round(sliderValue)} km`}
        </Text>
      </View>

      {/* Quick Select Buttons */}
      <View style={styles.quickSelectRow}>
        {[5, 10, 25].map(km => (
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
            max="50"
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
              accentColor: DK.primary,
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

// ------------------------------------------------------------------
// MarketCard — OLX-style card with distance + location
// ------------------------------------------------------------------
const MarketCard = React.memo(function MarketCard({
  item, liked, onPress, onLike,
}: {
  item: MarketItem;
  liked: boolean;
  onPress: () => void;
  onLike: () => void;
}) {
  const locationLabel = item.sellerCity || item.sellerState || 'India';

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardImageWrap}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.cardImage} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
            <Ionicons name="pricetag" size={32} color="#CCC" />
          </View>
        )}
        {item.imageCount > 1 && (
          <View style={styles.imageCountBadge}>
            <Ionicons name="images" size={10} color="#FFF" />
            <Text style={styles.imageCountText}>{item.imageCount}</Text>
          </View>
        )}
        {item.distanceKm !== undefined && (
          <View style={styles.distanceBadge}>
            <Ionicons name="navigate" size={9} color="#FFF" />
            <Text style={styles.distanceBadgeText}>{formatDistance(item.distanceKm)}</Text>
          </View>
        )}
        <Pressable style={styles.heartBtn} onPress={onLike} hitSlop={8}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={20} color={liked ? '#FF3B30' : '#AAA'} />
        </Pressable>
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardPrice}>{'\u20B9'} {Number(item.price).toLocaleString('en-IN')}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title.toUpperCase()}</Text>
        <View style={styles.cardFooter}>
          <View style={styles.cardLocation}>
            <Ionicons name="location-sharp" size={11} color="#999" />
            <Text style={styles.cardLocationText} numberOfLines={1}>{locationLabel}</Text>
          </View>
          {item.distanceKm !== undefined && (
            <Text style={styles.cardDistanceText}>{formatDistance(item.distanceKm)} away</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
});

// ------------------------------------------------------------------
// SellerProfileModal — Full OLX-style seller profile view
// ------------------------------------------------------------------
function SellerProfileModal({
  visible,
  seller,
  sellerItems,
  currentUserId,
  onClose,
  onChat,
  onItemPress,
}: {
  visible: boolean;
  seller: UserProfile | null;
  sellerItems: MarketItem[];
  currentUserId?: string;
  onClose: () => void;
  onChat: () => void;
  onItemPress: (item: MarketItem) => void;
}) {
  const insets = useSafeAreaInsets();
  const topPad = (typeof window !== 'undefined' && Platform.OS === 'web' ? 67 : insets.top) + 12;
  const bottomPad = typeof window !== 'undefined' && Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16);

  if (!seller) return null;
  const isOwnProfile = seller.id === currentUserId;

  const renderSellerItem = ({ item }: { item: MarketItem }) => {
    const MINI_W = (SCREEN_WIDTH - 48 - 8) / 2;
    return (
      <Pressable
        style={[styles.miniCard, { width: MINI_W }]}
        onPress={() => onItemPress(item)}
      >
        {item.image ? (
          <Image source={{ uri: item.image }} style={[styles.miniCardImage, { width: MINI_W }]} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.miniCardImage, styles.cardImagePlaceholder, { width: MINI_W }]}>
            <Ionicons name="pricetag" size={22} color="#CCC" />
          </View>
        )}
        <View style={styles.miniCardContent}>
          <Text style={styles.miniCardPrice}>{'\u20B9'} {Number(item.price).toLocaleString('en-IN')}</Text>
          <Text style={styles.miniCardTitle} numberOfLines={1}>{item.title}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.detailContainer, { paddingTop: topPad }]}>
        <View style={styles.detailHeader}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={DK.text} />
          </Pressable>
          <Text style={styles.detailHeaderTitle}>Seller Profile</Text>
          <View style={{ width: 24 }} />
        </View>

        <FlatList
          data={sellerItems}
          keyExtractor={i => i.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 8, paddingHorizontal: 16, marginBottom: 8 }}
          contentContainerStyle={{ paddingBottom: bottomPad + 80 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={() => (
            <View>
              {/* Seller Hero Card */}
              <View style={styles.spHeroCard}>
                {seller.avatar ? (
                  <Image source={{ uri: getImageUri(seller.avatar) }} style={styles.spAvatar} contentFit="cover" />
                ) : (
                  <View style={styles.spAvatarPlaceholder}>
                    <Text style={styles.spAvatarInitials}>{getInitials(seller.name)}</Text>
                  </View>
                )}

                <View style={styles.spInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.spName}>{seller.name}</Text>
                    {seller.verified === 1 && (
                      <Ionicons name="checkmark-circle" size={16} color="#1DA1F2" />
                    )}
                  </View>
                  <Text style={styles.spRole}>{ROLE_LABELS[seller.role as UserRole] || seller.role}</Text>
                  {(seller.city || seller.state) && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                      <Ionicons name="location-outline" size={12} color={DK.textTertiary} />
                      <Text style={styles.spLocation}>{[seller.city, seller.state].filter(Boolean).join(', ')}</Text>
                    </View>
                  )}
                  {seller.shopName && (
                    <Text style={styles.spShop}>{seller.shopName}</Text>
                  )}
                </View>
              </View>

              {seller.bio ? (
                <View style={styles.spBioBox}>
                  <Text style={styles.spBioText}>{seller.bio}</Text>
                </View>
              ) : null}

              {/* Stats row */}
              <View style={styles.spStatsRow}>
                <View style={styles.spStatItem}>
                  <Text style={styles.spStatValue}>{sellerItems.length}</Text>
                  <Text style={styles.spStatLabel}>Listings</Text>
                </View>
                <View style={styles.spStatDivider} />
                <View style={styles.spStatItem}>
                  <Text style={styles.spStatValue}>
                    {sellerItems.reduce((sum, i) => sum + i.likes.length, 0)}
                  </Text>
                  <Text style={styles.spStatLabel}>Total Likes</Text>
                </View>
                <View style={styles.spStatDivider} />
                <View style={styles.spStatItem}>
                  <Text style={styles.spStatValue}>
                    {Math.round((Date.now() - (seller as any).createdAt || 0) / (1000 * 60 * 60 * 24 * 30)) || '—'}
                  </Text>
                  <Text style={styles.spStatLabel}>Months</Text>
                </View>
              </View>

              {sellerItems.length > 0 ? (
                <Text style={styles.spListingsTitle}>
                  Active Listings ({sellerItems.length})
                </Text>
              ) : (
                <View style={styles.spEmpty}>
                  <Ionicons name="storefront-outline" size={40} color={DK.textTertiary} />
                  <Text style={styles.spEmptyText}>No active listings</Text>
                </View>
              )}
            </View>
          )}
          renderItem={renderSellerItem}
        />

        {!isOwnProfile && (
          <Pressable
            style={[styles.spChatBtn, { bottom: bottomPad + 16 }]}
            onPress={onChat}
          >
            <Ionicons name="chatbubble-ellipses" size={20} color="#FFF" />
            <Text style={styles.spChatBtnText}>Chat with Seller</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

// ------------------------------------------------------------------
// Animated SELL button
// ------------------------------------------------------------------
function AnimatedSellButton({ isEmbedded }: { isEmbedded: boolean }) {
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withDelay(2000, withSpring(1.12, { damping: 4, stiffness: 180 })),
        withSpring(1, { damping: 6, stiffness: 200 })
      ),
      -1, false
    );
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.ease) })
      ),
      -1, true
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.5,
    transform: [{ scale: 1 + glow.value * 0.35 }],
  }));

  const bottomVal = isEmbedded
    ? (typeof window !== 'undefined' && Platform.OS === 'web' ? 84 + 16 : 90)
    : (typeof window !== 'undefined' && Platform.OS === 'web' ? 34 + 16 : 32);

  return (
    <View style={{ position: 'absolute', right: 20, bottom: bottomVal }}>
      <Animated.View style={[styles.fabGlow, glowStyle]} />
      <Animated.View style={animStyle}>
        <Pressable
          style={styles.fab}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/sell-item' as any);
          }}
        >
          <Ionicons name="add" size={26} color="#FFF" />
          <Text style={styles.fabText}>SELL</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ------------------------------------------------------------------
// Main Screen
// ------------------------------------------------------------------
export default function BuySellScreen({ isEmbedded }: { isEmbedded?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const { allProfiles, profile, posts, isLoading, refreshData, toggleLike, addComment, startConversation } = useApp();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDistance, setSelectedDistance] = useState<number | 'ALL'>('ALL');
  const [sliderValue, setSliderValue] = useState(25);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [detailItem, setDetailItem] = useState<MarketItem | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  const [mediaViewerUrl, setMediaViewerUrl] = useState('');

  // Seller profile modal
  const [sellerProfileId, setSellerProfileId] = useState<string | null>(null);
  const [sellerProfileVisible, setSellerProfileVisible] = useState(false);

  const webInset = typeof window !== 'undefined' && Platform.OS === 'web';
  const topPad = (webInset ? 67 : insets.top) + 12;

  // User's own lat/lng for distance calculation
  const userLat = profile?.latitude ? parseFloat(profile.latitude) : null;
  const userLng = profile?.longitude ? parseFloat(profile.longitude) : null;
  const hasLocation = userLat !== null && userLng !== null && !isNaN(userLat) && !isNaN(userLng);

  const userLocationLabel = profile?.city
    ? [profile.city, profile.state].filter(Boolean).join(', ')
    : null;

  // Immediate visual feedback + debounced filtering
  const handleDistanceChange = useCallback((distance: number | 'ALL') => {
    if (distance !== 'ALL') {
      setSliderValue(distance);
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setSelectedDistance(distance);
    }, 300);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  };

  const sellPosts = useMemo(() => {
    return posts.filter(p => p.category === 'sell');
  }, [posts]);

  const marketItems = useMemo<MarketItem[]>(() => {
    return sellPosts.map(p => {
      const parsed = parseSellPost(p.text);
      const prof = allProfiles.find(pr => pr.id === p.userId);
      const sellerLat = prof?.latitude ? parseFloat(prof.latitude) : undefined;
      const sellerLng = prof?.longitude ? parseFloat(prof.longitude) : undefined;
      const hasSellerLoc = sellerLat !== undefined && sellerLng !== undefined && !isNaN(sellerLat) && !isNaN(sellerLng);
      const distanceKm = (hasLocation && hasSellerLoc)
        ? haversineKm(userLat!, userLng!, sellerLat!, sellerLng!)
        : undefined;

      return {
        id: `sell_${p.id}`,
        type: 'sell' as const,
        title: parsed?.title || 'Untitled',
        price: parsed?.price || '0',
        image: p.images && p.images.length > 0 ? getImageUri(p.images[0]) : undefined,
        imageCount: p.images ? p.images.length : 0,
        condition: parsed?.condition,
        description: parsed?.description || '',
        sellCategory: parsed?.sellCategory || 'other',
        videoUrl: (p as any).videoUrl || undefined,
        sellerId: p.userId,
        sellerName: p.userName,
        sellerRole: p.userRole,
        sellerAvatar: p.userAvatar,
        sellerCity: prof?.city,
        sellerState: prof?.state,
        sellerLat: hasSellerLoc ? sellerLat : undefined,
        sellerLng: hasSellerLoc ? sellerLng : undefined,
        distanceKm,
        likes: p.likes || [],
        comments: p.comments || [],
        createdAt: p.createdAt,
        originalPost: p,
      };
    });
  }, [sellPosts, allProfiles, userLat, userLng, hasLocation]);

  const filtered = useMemo(() => {
    let list = marketItems;
    if (selectedCategory !== 'all') {
      list = list.filter(i => i.sellCategory === selectedCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.sellerName.toLowerCase().includes(q) ||
        (i.sellerCity || '').toLowerCase().includes(q)
      );
    }
    // Filter & Sort: by distance if location available
    if (hasLocation && selectedDistance !== 'ALL' && selectedDistance > 0) {
      // Filter to selected distance
      list = list.filter(i => i.distanceKm !== undefined && i.distanceKm <= selectedDistance);
      // Then sort by distance (nearest first)
      list = [...list].sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
    } else {
      list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    }
    return list;
  }, [marketItems, search, selectedCategory, selectedDistance, hasLocation]);

  const openDetail = (item: MarketItem) => {
    setDetailItem(item);
    setDetailVisible(true);
    setCommentText('');
  };

  const openSellerProfile = useCallback((sellerId: string) => {
    setSellerProfileId(sellerId);
    setSellerProfileVisible(true);
  }, []);

  const handleLike = async (item: MarketItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.type === 'sell' && item.originalPost) {
      await toggleLike(item.originalPost.id);
      const updatedPost = posts.find(p => p.id === item.originalPost!.id);
      if (updatedPost && detailItem?.id === item.id) {
        setDetailItem(prev => prev ? { ...prev, likes: updatedPost.likes, comments: updatedPost.comments } : null);
      }
    }
  };

  const handleComment = async () => {
    if (!commentText.trim() || !detailItem) return;
    if (detailItem.type === 'sell' && detailItem.originalPost) {
      await addComment(detailItem.originalPost.id, commentText.trim());
      setCommentText('');
      const updatedPost = posts.find(p => p.id === detailItem.originalPost!.id);
      if (updatedPost) {
        setDetailItem(prev => prev ? { ...prev, comments: updatedPost.comments } : null);
      }
    }
  };

  const handleChatWithSeller = async (sellerId: string, sellerName: string, sellerRole: string) => {
    if (!profile) return;
    const convoId = await startConversation(sellerId, sellerName, sellerRole as UserRole);
    if (convoId) {
      setDetailVisible(false);
      setSellerProfileVisible(false);
      router.push(`/chat/${convoId}` as any);
    }
  };

  const getDetailImages = (item: MarketItem): string[] => {
    if (item.type === 'sell' && item.originalPost) {
      return (item.originalPost.images || []).map(getImageUri);
    }
    return [];
  };

  // Data for seller profile modal
  const sellerProfile = useMemo(() =>
    sellerProfileId ? allProfiles.find(p => p.id === sellerProfileId) || null : null,
    [sellerProfileId, allProfiles]
  );

  const sellerItems = useMemo(() =>
    sellerProfileId ? marketItems.filter(i => i.sellerId === sellerProfileId) : [],
    [sellerProfileId, marketItems]
  );

  const renderCard = ({ item }: { item: MarketItem }) => {
    const liked = profile ? item.likes.includes(profile.id) : false;
    return (
      <MarketCard
        item={item}
        liked={liked}
        onPress={() => openDetail(item)}
        onLike={() => handleLike(item)}
      />
    );
  };

  const renderDetailModal = () => {
    if (!detailItem) return null;
    const images = getDetailImages(detailItem);
    const isOwn = profile?.id === detailItem.sellerId;
    const sellerProf = allProfiles.find(p => p.id === detailItem.sellerId);

    const freshPost = detailItem.type === 'sell' && detailItem.originalPost
      ? posts.find(p => p.id === detailItem.originalPost!.id)
      : null;
    const currentLikes = freshPost ? freshPost.likes : detailItem.likes;
    const currentComments = freshPost ? freshPost.comments : detailItem.comments;
    const currentLiked = profile ? currentLikes.includes(profile.id) : false;

    return (
      <Modal visible={detailVisible} animationType="slide" onRequestClose={() => setDetailVisible(false)}>
        <View style={[styles.detailContainer, { paddingTop: topPad }]}>
          <View style={styles.detailHeader}>
            <Pressable onPress={() => setDetailVisible(false)}>
              <Ionicons name="arrow-back" size={24} color={DK.text} />
            </Pressable>
            <Text style={styles.detailHeaderTitle} numberOfLines={1}>{detailItem.title}</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {images.length > 0 ? (
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.carousel}>
                {images.map((uri, i) => (
                  <Pressable key={i} onPress={() => { setMediaViewerUrl(uri); setMediaViewerVisible(true); }}>
                    <Image source={{ uri }} style={styles.carouselImage} contentFit="contain" cachePolicy="memory-disk" />
                    {images.length > 1 && (
                      <View style={styles.carouselCounter}>
                        <Text style={styles.carouselCounterText}>{i + 1}/{images.length}</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.detailNoImage}>
                <Ionicons name="pricetag" size={48} color={DK.textTertiary} />
              </View>
            )}

            <View style={styles.detailBody}>
              <Text style={styles.detailPrice}>{'\u20B9'} {detailItem.price}</Text>
              <Text style={styles.detailTitle}>{detailItem.title}</Text>

              {detailItem.condition && (
                <View style={styles.detailConditionBadge}>
                  <Text style={styles.detailConditionText}>{detailItem.condition}</Text>
                </View>
              )}

              {/* Location + Distance row */}
              <View style={styles.detailLocationRow}>
                <Ionicons name="location" size={14} color={DK.primary} />
                <Text style={styles.detailLocationText}>
                  {[detailItem.sellerCity, detailItem.sellerState].filter(Boolean).join(', ') || 'India'}
                </Text>
                {detailItem.distanceKm !== undefined && (
                  <View style={styles.detailDistancePill}>
                    <Ionicons name="navigate" size={10} color={DK.primary} />
                    <Text style={styles.detailDistanceText}>{formatDistance(detailItem.distanceKm)} away</Text>
                  </View>
                )}
              </View>

              <Text style={styles.detailDesc}>{detailItem.description}</Text>

              {/* Seller Card — clickable → opens seller profile */}
              <Pressable
                style={styles.sellerCard}
                onPress={() => openSellerProfile(detailItem.sellerId)}
              >
                {sellerProf?.avatar || detailItem.sellerAvatar ? (
                  <Image source={{ uri: getImageUri(sellerProf?.avatar || detailItem.sellerAvatar || '') }} style={styles.sellerAvatar} contentFit="cover" />
                ) : (
                  <View style={styles.sellerAvatarPlaceholder}>
                    <Text style={styles.sellerInitials}>{getInitials(detailItem.sellerName)}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={styles.sellerName}>{detailItem.sellerName}</Text>
                    {sellerProf?.verified === 1 && (
                      <Ionicons name="checkmark-circle" size={14} color="#1DA1F2" />
                    )}
                  </View>
                  <Text style={styles.sellerMeta}>{ROLE_LABELS[detailItem.sellerRole as UserRole] || detailItem.sellerRole}</Text>
                  {(detailItem.sellerCity || detailItem.sellerState) && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
                      <Ionicons name="location-outline" size={11} color={DK.textTertiary} />
                      <Text style={styles.sellerMeta}>{[detailItem.sellerCity, detailItem.sellerState].filter(Boolean).join(', ')}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.viewProfileBadge}>
                  <Text style={styles.viewProfileText}>View</Text>
                  <Ionicons name="chevron-forward" size={12} color={DK.primary} />
                </View>
              </Pressable>

              <View style={styles.statsRow}>
                <Pressable
                  style={styles.statItem}
                  onPress={() => { if (detailItem.type === 'sell') handleLike(detailItem); }}
                >
                  <Ionicons name={currentLiked ? 'heart' : 'heart-outline'} size={18} color={currentLiked ? '#FF3B30' : DK.textSecondary} />
                  <Text style={styles.statText}>{currentLikes.length}</Text>
                </Pressable>
                <View style={styles.statItem}>
                  <Ionicons name="chatbubble-outline" size={16} color={DK.textSecondary} />
                  <Text style={styles.statText}>{currentComments.length}</Text>
                </View>
                <Text style={styles.statTime}>{timeAgo(detailItem.createdAt)}</Text>
              </View>

              {!isOwn && (
                <Pressable
                  style={styles.chatBtn}
                  onPress={() => handleChatWithSeller(detailItem.sellerId, detailItem.sellerName, detailItem.sellerRole)}
                >
                  <Ionicons name="chatbubble-ellipses" size={20} color="#FFF" />
                  <Text style={styles.chatBtnText}>Chat with Seller</Text>
                </Pressable>
              )}

              {currentComments.length > 0 && (
                <View style={styles.commentsSection}>
                  <Text style={styles.commentsSectionTitle}>Comments</Text>
                  {currentComments.map((c: any, i: number) => (
                    <View key={c.id || i} style={styles.commentItem}>
                      <Text style={styles.commentAuthor}>{c.userName}</Text>
                      <Text style={styles.commentBody}>{c.text}</Text>
                      <Text style={styles.commentTime}>{timeAgo(c.createdAt)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>

          <View style={[styles.commentInputRow, { paddingBottom: webInset ? 34 : Math.max(insets.bottom, 12) }]}>
            <TextInput
              style={styles.commentInput}
              placeholder="Add a comment..."
              placeholderTextColor={DK.textTertiary}
              value={commentText}
              onChangeText={setCommentText}
            />
            <Pressable onPress={handleComment} disabled={!commentText.trim()}>
              <Ionicons name="send" size={22} color={commentText.trim() ? DK.primary : DK.textTertiary} />
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  };

  const renderListHeader = () => (
    <View>
      {/* Search Box */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={DK.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search items, sellers, location..."
            placeholderTextColor={DK.textTertiary}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={DK.textTertiary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Location bar — OLX style */}
      <View style={styles.locationBar}>
        <Pressable
          style={styles.locationBarLeft}
          onPress={async () => {
            try {
              const location = await getCurrentLocation();
              if (location) {
                setUserLocation(location.latitude, location.longitude);
              }
            } catch (err) {
              console.error('Error getting location:', err);
            }
          }}
          hitSlop={8}
        >
          <Ionicons name="location" size={16} color={DK.primary} />
          <Text style={styles.locationBarText} numberOfLines={1}>
            {userLocationLabel || 'Set your location'}
          </Text>
        </Pressable>
        {(profile?.role === 'customer' || profile?.role === 'technician') && (
          <Pressable
            style={styles.locationBarSellBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push('/sell-item' as any);
            }}
          >
            <Ionicons name="add" size={18} color="#FFF" />
          </Pressable>
        )}
      </View>

      {/* Distance Slider */}
      {hasLocation && <DistanceSlider sliderValue={sliderValue} selectedDistance={selectedDistance} onDistanceChange={handleDistanceChange} />}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryBar}
      >
        {SELL_CATEGORIES.map(cat => (
          <Pressable
            key={cat.key}
            style={[styles.categoryChip, selectedCategory === cat.key && styles.categoryChipActive]}
            onPress={() => setSelectedCategory(cat.key)}
          >
            <Ionicons name={cat.icon} size={16} color={selectedCategory === cat.key ? '#FFF' : DK.textSecondary} />
            <Text style={[styles.categoryChipText, selectedCategory === cat.key && styles.categoryChipTextActive]}>{cat.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {filtered.length > 0 && (
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{filtered.length} items listed</Text>
        </View>
      )}
    </View>
  );

  if (isLoading && posts.length === 0) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={DK.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!isEmbedded && (
        <View style={[styles.header, { paddingTop: topPad }]}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={DK.text} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>Buy & Sell</Text>
          <Pressable onPress={() => router.push('/chats' as any)}>
            <Ionicons name="chatbubbles-outline" size={24} color={DK.text} />
          </Pressable>
        </View>
      )}

      {isEmbedded && (
        <View style={{ paddingTop: topPad }} />
      )}

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderCard}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={[styles.listContent, { paddingBottom: webInset ? 84 + 34 : 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DK.primary} colors={[DK.primary]} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="storefront-outline" size={56} color={DK.textTertiary} />
            <Text style={styles.emptyTitle}>No listings yet</Text>
            <Text style={styles.emptyText}>Products and items for sale will appear here</Text>
          </View>
        }
      />


      {renderDetailModal()}

      {/* Seller Profile Modal */}
      <SellerProfileModal
        visible={sellerProfileVisible}
        seller={sellerProfile}
        sellerItems={sellerItems}
        currentUserId={profile?.id}
        onClose={() => setSellerProfileVisible(false)}
        onChat={() => {
          if (sellerProfile) {
            handleChatWithSeller(sellerProfile.id, sellerProfile.name, sellerProfile.role);
          }
        }}
        onItemPress={(item) => {
          setSellerProfileVisible(false);
          openDetail(item);
        }}
      />

      <MediaViewer
        visible={mediaViewerVisible}
        onClose={() => setMediaViewerVisible(false)}
        imageUrl={mediaViewerUrl}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DK.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 8, gap: 12,
  },
  headerTitle: { color: DK.text, fontSize: 24, fontWeight: '800' as const, flex: 1 },
  searchContainer: { paddingHorizontal: 16, marginBottom: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F8F8',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#ECECEC', gap: 10,
  },
  searchInput: { flex: 1, color: DK.text, fontSize: 15, fontWeight: '400' as const, padding: 0 },

  // Location bar
  locationBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10, gap: 10, paddingHorizontal: 16,
  },
  locationBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  locationBarText: { color: DK.text, fontSize: 13, fontWeight: '600', flex: 1 },
  locationBarSellBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: DK.primary, alignItems: 'center', justifyContent: 'center',
    elevation: 2, shadowColor: DK.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4,
  },
  sortPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, backgroundColor: '#F0F0F0', borderWidth: 1, borderColor: '#E0E0E0',
  },
  sortPillActive: { backgroundColor: DK.primary, borderColor: DK.primary },
  sortPillText: { color: DK.textSecondary, fontSize: 12, fontWeight: '600' },
  sortPillTextActive: { color: '#FFF' },

  countBadge: { marginBottom: 8 },
  countText: { color: DK.textTertiary, fontSize: 12 },
  listContent: { paddingHorizontal: 16, paddingTop: 4 },
  columnWrapper: { gap: CARD_GAP, marginBottom: CARD_GAP },

  card: {
    width: CARD_WIDTH, backgroundColor: '#FFFFFF', borderRadius: 12,
    overflow: 'hidden', borderWidth: 1, borderColor: '#EBEBEB',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardImageWrap: { position: 'relative' as const, width: '100%', aspectRatio: 1 },
  cardImage: { width: '100%', height: '100%', backgroundColor: '#F7F7F7' },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' },
  cardContent: { padding: 12, paddingTop: 10 },
  cardPrice: { color: '#002F34', fontSize: 19, fontWeight: '800' as const, letterSpacing: -0.3 },
  cardTitle: { color: '#002F34', fontSize: 13, fontWeight: '500' as const, lineHeight: 17, marginTop: 4 },
  cardFooter: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLocation: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  cardLocationText: { color: '#999', fontSize: 11, fontWeight: '400' as const, flex: 1 },
  cardDistanceText: { color: DK.primary, fontSize: 10, fontWeight: '600' as const },

  // Distance badge on card image
  distanceBadge: {
    position: 'absolute' as const, bottom: 6, left: 6, flexDirection: 'row',
    alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
  },
  distanceBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '700' as const },

  heartBtn: {
    position: 'absolute' as const, top: 6, right: 6,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center',
  },
  imageCountBadge: {
    position: 'absolute' as const, top: 6, left: 6, flexDirection: 'row',
    alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
  },
  imageCountText: { color: '#FFF', fontSize: 10, fontWeight: '600' as const },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { color: DK.text, fontSize: 18, fontWeight: '600' },
  emptyText: { color: DK.textTertiary, fontSize: 14, textAlign: 'center' as const, paddingHorizontal: 40 },

  fab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: DK.primary, paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 28, elevation: 8,
    shadowColor: DK.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10,
  },
  fabGlow: {
    position: 'absolute' as const,
    top: -4, left: -4, right: -4, bottom: -4,
    borderRadius: 32, backgroundColor: DK.primary,
  },
  fabText: { color: '#FFF', fontSize: 15, fontWeight: '800' as const, letterSpacing: 0.5 },

  detailContainer: { flex: 1, backgroundColor: DK.background },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10,
  },
  detailHeaderTitle: { color: DK.text, fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' as const, marginHorizontal: 12 },
  carousel: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 0.75 },
  carouselImage: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 0.75, backgroundColor: '#F7F7F7' },
  carouselCounter: {
    position: 'absolute' as const, bottom: 10, right: 14,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  carouselCounterText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  detailNoImage: {
    width: SCREEN_WIDTH, height: SCREEN_WIDTH * 0.5,
    backgroundColor: DK.surfaceElevated, alignItems: 'center', justifyContent: 'center',
  },
  detailBody: { padding: 16 },
  detailPrice: { color: DK.primary, fontSize: 24, fontWeight: '700' },
  detailTitle: { color: DK.text, fontSize: 18, fontWeight: '600', marginTop: 4 },
  detailConditionBadge: {
    alignSelf: 'flex-start', backgroundColor: DK.surfaceElevated,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 8,
  },
  detailConditionText: { color: DK.textSecondary, fontSize: 12, fontWeight: '600' },
  detailLocationRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, flexWrap: 'wrap' as const,
  },
  detailLocationText: { color: DK.textSecondary, fontSize: 13 },
  detailDistancePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#FFF3EE', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10, borderWidth: 1, borderColor: '#FFD9C4',
  },
  detailDistanceText: { color: DK.primary, fontSize: 12, fontWeight: '700' },
  detailDesc: { color: DK.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 12 },

  sellerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20,
    padding: 14, backgroundColor: DK.surface, borderRadius: 12, borderWidth: 1, borderColor: DK.border,
  },
  sellerAvatar: { width: 44, height: 44, borderRadius: 22 },
  sellerAvatarPlaceholder: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: DK.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  sellerInitials: { color: DK.textSecondary, fontSize: 16, fontWeight: '700' },
  sellerName: { color: DK.text, fontSize: 15, fontWeight: '600' },
  sellerMeta: { color: DK.textTertiary, fontSize: 12 },
  viewProfileBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewProfileText: { color: DK.primary, fontSize: 12, fontWeight: '600' },

  statsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16,
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: DK.border,
  },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { color: DK.textSecondary, fontSize: 13 },
  statTime: { color: DK.textTertiary, fontSize: 12, marginLeft: 'auto' as const },

  chatBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: DK.primary, borderRadius: 14, paddingVertical: 14, marginTop: 16,
  },
  chatBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

  commentsSection: { marginTop: 20 },
  commentsSectionTitle: { color: DK.text, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  commentItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: DK.border },
  commentAuthor: { color: DK.text, fontSize: 13, fontWeight: '600' },
  commentBody: { color: DK.textSecondary, fontSize: 13, marginTop: 2 },
  commentTime: { color: DK.textTertiary, fontSize: 11, marginTop: 4 },

  commentInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: DK.border, backgroundColor: DK.surface,
  },
  commentInput: {
    flex: 1, backgroundColor: DK.surfaceElevated, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10, color: DK.text, fontSize: 14,
  },
  categoryBar: { paddingHorizontal: 0, gap: 8, paddingBottom: 10 },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 22, backgroundColor: '#F7F7F7', borderWidth: 1.5, borderColor: '#EFEFEF',
  },
  categoryChipActive: { backgroundColor: DK.primary, borderColor: DK.primary },
  categoryChipText: { color: DK.textSecondary, fontSize: 13, fontWeight: '600' as const },
  categoryChipTextActive: { color: '#FFF', fontWeight: '700' as const },

  // ---- Seller Profile Modal ----
  spHeroCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, margin: 16, marginBottom: 0,
    backgroundColor: DK.surface, borderRadius: 16,
    borderWidth: 1, borderColor: DK.border,
  },
  spAvatar: { width: 70, height: 70, borderRadius: 35 },
  spAvatarPlaceholder: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: DK.surfaceElevated, alignItems: 'center', justifyContent: 'center',
  },
  spAvatarInitials: { color: DK.textSecondary, fontSize: 22, fontWeight: '700' },
  spInfo: { flex: 1 },
  spName: { color: DK.text, fontSize: 18, fontWeight: '700' },
  spRole: { color: DK.textSecondary, fontSize: 13, marginTop: 2 },
  spLocation: { color: DK.textTertiary, fontSize: 12 },
  spShop: { color: DK.primary, fontSize: 12, fontWeight: '600', marginTop: 2 },
  spBioBox: { marginHorizontal: 16, marginTop: 10, padding: 12, backgroundColor: '#FFF9F6', borderRadius: 10, borderWidth: 1, borderColor: '#FFE5D5' },
  spBioText: { color: DK.textSecondary, fontSize: 13, lineHeight: 19 },
  spStatsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    margin: 16, padding: 14,
    backgroundColor: DK.surface, borderRadius: 12, borderWidth: 1, borderColor: DK.border,
  },
  spStatItem: { alignItems: 'center', gap: 2 },
  spStatValue: { color: DK.text, fontSize: 20, fontWeight: '800' },
  spStatLabel: { color: DK.textTertiary, fontSize: 11 },
  spStatDivider: { width: 1, height: 30, backgroundColor: DK.border },
  spListingsTitle: {
    color: DK.text, fontSize: 15, fontWeight: '700',
    marginHorizontal: 16, marginBottom: 10,
  },
  spEmpty: { alignItems: 'center', gap: 8, paddingTop: 40, paddingBottom: 20 },
  spEmptyText: { color: DK.textTertiary, fontSize: 14 },
  spChatBtn: {
    position: 'absolute' as const, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: DK.primary, borderRadius: 14, paddingVertical: 14,
    shadowColor: DK.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  spChatBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  miniCard: {
    backgroundColor: '#FFF', borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: '#EBEBEB',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  miniCardImage: { aspectRatio: 1, backgroundColor: '#F7F7F7' },
  miniCardContent: { padding: 8 },
  miniCardPrice: { color: '#002F34', fontSize: 14, fontWeight: '800' },
  miniCardTitle: { color: DK.textSecondary, fontSize: 11, marginTop: 2 },

  sliderContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: DK.background,
    borderBottomColor: DK.border,
    borderBottomWidth: 1,
  },

  sliderHeader: {
    marginBottom: 10,
  },

  sliderLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: DK.text,
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
    backgroundColor: DK.surface,
    borderWidth: 1,
    borderColor: DK.border,
  },

  quickSelectBtnActive: {
    backgroundColor: DK.primary,
    borderColor: DK.primary,
  },

  quickSelectText: {
    fontSize: 12,
    fontWeight: '600',
    color: DK.textSecondary,
  },

  quickSelectTextActive: {
    color: '#FFF',
  },

  sliderTrackContainer: {
    paddingHorizontal: 4,
    marginVertical: 12,
  },

  nativeSliderText: {
    fontSize: 13,
    fontWeight: '500',
    color: DK.textSecondary,
    textAlign: 'center',
  },
});
