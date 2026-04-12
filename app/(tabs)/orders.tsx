import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  Pressable, Platform, Alert, ScrollView, TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { router, useRootNavigationState } from 'expo-router';
import Animated, {
  FadeInDown, useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming, withDelay, Easing,
} from 'react-native-reanimated';
import { useApp } from '@/lib/context';
import { openLink } from '@/lib/open-link';
import { PostCategory } from '@/lib/types';
import PostCard from '@/components/PostCard';
import { apiRequest } from '@/lib/query-client';

// ─── MarketHub Light Theme ───────────────────────────────────────────────────
const BG        = '#F9FAFB';
const CARD      = '#FFFFFF';
const SURFACE   = '#FFFFFF';
const BORDER    = '#E5E7EB';
const TEXT      = '#111827';
const MUTED     = '#9CA3AF';
const PRIMARY   = '#1B4D3E';
const BLUE      = '#3B82F6';
const GREEN     = '#10B981';
const AMBER     = '#F59E0B';

type FilterKey = PostCategory | 'all' | 'technician' | 'customer' | 'teacher' | 'supplier' | 'sell';

const FILTERS: { key: FilterKey; label: string; icon: keyof typeof Ionicons.glyphMap; color?: string }[] = [
  { key: 'all',        label: 'All Posts',        icon: 'layers-outline' },
  { key: 'sell',       label: 'Buy & Sell',       icon: 'pricetag-outline', color: '#FF6B2C' },
  { key: 'technician', label: 'Technician Posts',  icon: 'construct-outline', color: GREEN },
  { key: 'customer',   label: 'Customer Posts',    icon: 'person-outline',    color: AMBER },
  { key: 'job',        label: 'Jobs',             icon: 'briefcase-outline' },
  { key: 'training',   label: 'Training',         icon: 'school-outline' },
  { key: 'supplier',   label: 'Suppliers',        icon: 'cube-outline' },
];

function SkeletonBox({ width, height, borderRadius = 8, style }: {
  width: number | string; height: number; borderRadius?: number; style?: any;
}) {
  const opacity = useSharedValue(0.4);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.ease }),
        withTiming(0.4, { duration: 700, easing: Easing.ease }),
      ), -1,
    );
  }, []);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[{ width: width as any, height, borderRadius, backgroundColor: SURFACE }, animStyle, style]} />
  );
}

function PostSkeleton() {
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <SkeletonBox width={44} height={44} borderRadius={22} />
        <View style={{ gap: 6, flex: 1 }}>
          <SkeletonBox width="60%" height={14} />
          <SkeletonBox width="40%" height={12} />
        </View>
      </View>
      <SkeletonBox width="100%" height={160} borderRadius={12} />
      <SkeletonBox width="80%" height={14} />
      <SkeletonBox width="50%" height={12} />
    </View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function HeaderButton({ children, onPress, delay = 0 }: {
  children: React.ReactNode; onPress: () => void; delay?: number;
}) {
  const scale   = useSharedValue(0.5);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value   = withDelay(delay, withSequence(
      withTiming(1.15, { duration: 300, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }),
    ));
    opacity.value = withDelay(delay, withTiming(1, { duration: 250 }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const handlePress = () => {
    scale.value = withSequence(
      withTiming(0.85, { duration: 80 }),
      withTiming(1.1, { duration: 120, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 100 }),
    );
    onPress();
  };

  return (
    <AnimatedPressable hitSlop={12} onPress={handlePress} style={[{ position: 'relative' }, animStyle]}>
      {children}
    </AnimatedPressable>
  );
}

function PingDot({ color }: { color: string }) {
  const scale   = useSharedValue(1);
  const opacity = useSharedValue(1);
  useEffect(() => {
    scale.value   = withRepeat(withSequence(withTiming(2, { duration: 900 }), withTiming(1, { duration: 0 })), -1);
    opacity.value = withRepeat(withSequence(withTiming(0, { duration: 900 }), withTiming(1, { duration: 0 })), -1);
  }, []);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: opacity.value }));
  return (
    <View style={{ width: 8, height: 8 }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 4, backgroundColor: color }, ring]} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const {
    posts, profile, isLoading, isOnboarded,
    toggleLike, addComment, deletePost, updatePost,
    refreshData, totalUnread,
  } = useApp();

  const isTech = profile?.role === 'technician';
  const rootNavState = useRootNavigationState();

  useEffect(() => {
    if (!rootNavState?.key) return; // Navigator not mounted yet — skip
    if (!isLoading && !isOnboarded) {
      router.replace('/onboarding');
    }
  }, [isLoading, isOnboarded, rootNavState?.key]);

  const [filter, setFilter]       = useState<FilterKey>('repair');
  const [refreshing, setRefreshing] = useState(false);

  const filtered = (() => {
    if (filter === 'all')        return posts.filter(p => p.category === 'repair' || p.category === 'sell');
    if (filter === 'sell')       return posts.filter(p => p.category === 'sell');
    if (filter === 'technician') return posts.filter(p => p.userRole === 'technician' && (p.category === 'repair' || p.category === 'sell'));
    if (filter === 'customer')   return posts.filter(p => p.userRole === 'customer' && (p.category === 'repair' || p.category === 'sell'));
    if (filter === 'teacher')    return posts.filter(p => p.userRole === 'teacher' && (p.category === 'repair' || p.category === 'sell'));
    if (filter === 'supplier')   return posts.filter(p => p.userRole === 'supplier' && (p.category === 'repair' || p.category === 'sell'));
    return posts.filter(p => p.category === 'repair' || p.category === 'sell');
  })();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  }, [refreshData]);

  const topPad = (Platform.OS === 'web' ? 67 : insets.top) + 10;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: topPad }]}>
          <View style={styles.profileAvatar}>
            <Ionicons name="person" size={20} color={PRIMARY} />
          </View>
          <Text style={styles.headerTitle}>Ask for Repair</Text>
          <View style={styles.headerActions} />
        </View>
        {[1, 2, 3].map(i => <PostSkeleton key={i} />)}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => router.push('/profile' as any)} activeOpacity={0.7} style={styles.profileAvatarBtn}>
          {profile?.avatar ? (
            <Image source={{ uri: profile.avatar }} style={styles.profileAvatarImg} contentFit="cover" />
          ) : (
            <View style={styles.profileAvatar}>
              <Ionicons name="person" size={20} color={PRIMARY} />
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <HeaderButton delay={0} onPress={() => router.push('/ai-repair')}>
            <View style={styles.aiBtnHeader}>
              <Ionicons name="hardware-chip" size={14} color="#FFF" />
              <Text style={styles.aiBtnHeaderText}>AI</Text>
            </View>
          </HeaderButton>

          <HeaderButton delay={80} onPress={() => router.push('/live-chat')}>
            <View style={styles.liveChatBtn}>
              <Ionicons name="chatbubble" size={13} color={BLUE} />
              <Text style={styles.liveChatText}>Live Chat</Text>
              <View style={styles.pingOuter}>
                <PingDot color={BLUE} />
              </View>
            </View>
          </HeaderButton>

          <HeaderButton delay={160} onPress={() => router.push('/chats')}>
            <View style={styles.bellBtn}>
              <Ionicons name="chatbubble-outline" size={18} color={TEXT} />
              {totalUnread > 0 && <View style={styles.redDot} />}
            </View>
          </HeaderButton>

          <HeaderButton delay={240} onPress={() => router.push('/create')}>
            <View style={styles.composeBtn}>
              <Ionicons name="create-outline" size={18} color={TEXT} />
            </View>
          </HeaderButton>
        </View>
      </View>

      <View style={styles.filterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersContent}
          scrollEventThrottle={16}
        >
          {FILTERS.map((item) => {
            const isActive = filter === item.key;
            const chipColor = item.color;
            return (
              <Pressable
                key={item.key}
                style={[
                  styles.filterChip,
                  isActive
                    ? {
                        backgroundColor: chipColor || PRIMARY,
                        borderColor: chipColor || PRIMARY,
                      }
                    : {
                        backgroundColor: SURFACE,
                        borderColor: BORDER + '80',
                      },
                ]}
                onPress={() => setFilter(item.key)}
              >
                <Ionicons
                  name={item.icon}
                  size={13}
                  color={isActive ? '#FFF' : chipColor || MUTED}
                />
                <Text style={[
                  styles.filterText,
                  { color: isActive ? '#FFF' : chipColor || MUTED },
                ]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(Math.min(index * 40, 300)).duration(400).springify()}>
            <PostCard
              post={item}
              currentUserId={profile?.id}
              onLike={toggleLike}
              onComment={addComment}
              onDelete={profile?.id === item.userId ? deletePost : undefined}
              onPostUpdated={(updated) => updatePost(updated.id, updated)}
            />
          </Animated.View>
        )}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Platform.OS === 'web' ? 118 : 100 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={PRIMARY}
            colors={[PRIMARY]}
          />
        }
        ListHeaderComponent={
          filtered.length > 0 ? (
            <View style={styles.feedHeader}>
              <Text style={styles.flagEmoji}>🇮🇳</Text>
              <View>
                <Text style={styles.feedHeaderTitle}>Community Feed</Text>
                <Text style={styles.feedHeaderSub}>India</Text>
              </View>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIconBg}>
              <Ionicons name="newspaper-outline" size={32} color={PRIMARY} />
            </View>
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptyText}>Be the first to share something with the community</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    backgroundColor: BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER + '40',
  },
  profileAvatarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  profileAvatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  profileAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY + '18',
    borderWidth: 1,
    borderColor: PRIMARY + '30',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: TEXT,
  },
  composeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER + '80',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER + '80',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    position: 'relative',
  },
  liveChatText: {
    fontSize: 11,
    color: BLUE,
    fontFamily: 'Inter_600SemiBold',
  },
  pingOuter: {
    position: 'absolute',
    top: -2,
    right: -2,
  },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER + '80',
    position: 'relative',
  },
  redDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  searchRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: BG,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: SURFACE,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: BORDER + '80',
  },
  searchPlaceholder: {
    color: MUTED,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  filterContainer: {
    backgroundColor: BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER + '40',
  },
  filtersContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
    minHeight: 36,
  },
  filterText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  flagEmoji: {
    fontSize: 32,
  },
  feedHeaderTitle: {
    color: TEXT,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  feedHeaderSub: {
    color: MUTED,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    marginTop: 2,
  },
  listContent: {
    paddingTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 14,
    paddingHorizontal: 40,
  },
  emptyIconBg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY + '20',
    marginBottom: 4,
  },
  emptyTitle: {
    color: TEXT,
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  emptyText: {
    color: MUTED,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  aiBtnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#7C3AED',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  aiBtnHeaderText: {
    fontSize: 11,
    color: '#FFF',
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
});
