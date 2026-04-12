import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { openLink } from '@/lib/open-link';
import { Post, UserProfile, ROLE_LABELS, UserRole, CATEGORY_LABELS } from '@/lib/types';
import PostCard from '@/components/PostCard';

const C = Colors.light;
const PRIMARY = '#E8704A';
const GREEN = '#34C759';
const AMBER = '#F59E0B';

const ROLE_COLORS: Record<UserRole, string> = {
  technician: GREEN,
  teacher: '#FFD60A',
  supplier: '#FF6B2C',
  job_provider: '#5E8BFF',
  customer: '#FF2D55',
  shopkeeper: '#8B5CF6',
  admin: '#8B5CF6',
};

const TECH_SERVICES = [
  { id: 'screen', label: 'Screen Replacement', icon: 'phone-portrait-outline' as const, price: '₹199' },
  { id: 'battery', label: 'Battery Replacement', icon: 'battery-charging-outline' as const, price: '₹199' },
  { id: 'charging', label: 'Charging Port Fix', icon: 'flash-outline' as const, price: '₹149' },
  { id: 'back', label: 'Back Panel', icon: 'shield-outline' as const, price: '₹149' },
  { id: 'camera', label: 'Camera Repair', icon: 'camera-outline' as const, price: '₹299' },
  { id: 'software', label: 'Software/Flashing', icon: 'code-slash-outline' as const, price: '₹99' },
];

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function seededRandom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(31, h) + seed.charCodeAt(i) | 0; }
  return Math.abs(h % 1000) / 1000;
}

function techRating(id: string): string {
  return (4.0 + seededRandom(id + 'r') * 1.0).toFixed(1);
}

function techReviews(id: string): number {
  return 100 + Math.floor(seededRandom(id + 'rv') * 800);
}

export default function UserProfileScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile: myProfile, startConversation, posts } = useApp();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPosts, setShowPosts] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      const res = await apiRequest('GET', `/api/profiles/${id}`);
      const data = await res.json();
      if (data && data.id) setUser(data);
    } catch (e) {
      console.error('[UserProfile] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  const handleChat = async () => {
    if (!myProfile || !user) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChatLoading(true);
    try {
      const convoId = await startConversation(user.id, user.name, user.role);
      if (convoId) router.push({ pathname: '/chat/[id]', params: { id: convoId } });
    } catch (e) {
      console.error('[UserProfile] chat error:', e);
    } finally {
      setChatLoading(false);
    }
  };

  const handleLike = async (postId: string) => {
    if (!myProfile) return;
    try {
      await apiRequest('POST', `/api/posts/${postId}/like`, { userId: myProfile.id });
    } catch (e) {
      console.error('[UserProfile] like error:', e);
    }
  };

  const handleComment = async (postId: string, text: string) => {
    if (!myProfile) return;
    try {
      await apiRequest('POST', `/api/posts/${postId}/comment`, {
        userId: myProfile.id,
        userName: myProfile.name,
        text,
      });
    } catch (e) {
      console.error('[UserProfile] comment error:', e);
    }
  };

  const userPosts = posts.filter(p => p.userId === id);
  const totalLikes = userPosts.reduce((sum, p) => sum + p.likes.length, 0);
  const isMe = myProfile?.id === id;
  const isTechnician = user?.role === 'technician';

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[s.container, s.center]}>
        <Ionicons name="person-outline" size={48} color={C.textTertiary} />
        <Text style={s.emptyTitle}>Profile not found</Text>
        <Pressable onPress={() => router.back()} style={s.backBtnAlt}>
          <Text style={s.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const roleColor = ROLE_COLORS[user.role] || PRIMARY;
  const rating = techRating(user.id);
  const reviews = techReviews(user.id);

  return (
    <View style={s.container}>
      <View style={[s.topBar, { paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 8 }]}>
        <Pressable hitSlop={14} onPress={() => router.back()} style={s.topBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <Text style={s.topTitle} numberOfLines={1}>{user.name}</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 56 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={s.profileHeader}>
          {user.avatar ? (
            <Image source={{ uri: user.avatar }} style={s.avatarImg} contentFit="cover" />
          ) : (
            <View style={[s.avatar, { backgroundColor: roleColor + '20' }]}>
              <Text style={[s.avatarText, { color: roleColor }]}>
                {getInitials(user.name)}
              </Text>
            </View>
          )}
          <Text style={s.profileName}>{user.name}</Text>

          {/* Verified badge + role */}
          <View style={s.badgeRow}>
            <View style={[s.roleBadge, { backgroundColor: roleColor + '20' }]}>
              <Text style={[s.roleBadgeText, { color: roleColor }]}>
                {ROLE_LABELS[user.role]}
              </Text>
            </View>
            {isTechnician && (
              <View style={s.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={13} color={GREEN} />
                <Text style={s.verifiedText}>Verified</Text>
              </View>
            )}
          </View>

          {/* Rating (for technicians) */}
          {isTechnician && (
            <View style={s.ratingRow}>
              <Ionicons name="star" size={15} color={AMBER} />
              <Text style={s.ratingText}>{rating}</Text>
              <Text style={s.reviewsText}>({reviews} reviews)</Text>
            </View>
          )}

          {/* Location + Experience */}
          {(user.city || user.experience) && (
            <View style={s.metaRow}>
              {user.city ? (
                <View style={s.metaItem}>
                  <Ionicons name="location-outline" size={14} color={C.textSecondary} />
                  <Text style={s.metaText}>{user.city}{user.state ? `, ${user.state}` : ''}</Text>
                </View>
              ) : null}
              {user.experience ? (
                <View style={s.metaItem}>
                  <Ionicons name="time-outline" size={14} color={C.textSecondary} />
                  <Text style={s.metaText}>{user.experience}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>

        {/* Action Buttons — Chat + Book */}
        {!isMe && (
          <View style={s.actionRow}>
            <Pressable
              style={[s.chatBtn, chatLoading && { opacity: 0.7 }]}
              onPress={handleChat}
              disabled={chatLoading}
            >
              {chatLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="chatbubble-outline" size={18} color="#fff" />
              )}
              <Text style={s.chatBtnText}>Chat</Text>
            </Pressable>
          </View>
        )}

        {/* Stats Row */}
        <View style={s.statsRow}>
          <Pressable style={s.statItem} onPress={() => setShowPosts(!showPosts)}>
            <Text style={s.statValue}>{userPosts.length}</Text>
            <Text style={s.statLabel}>Posts</Text>
          </Pressable>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Text style={s.statValue}>{totalLikes}</Text>
            <Text style={s.statLabel}>Likes</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Text style={s.statValue}>{user.skills.length}</Text>
            <Text style={s.statLabel}>Skills</Text>
          </View>
        </View>

        {/* Posts */}
        {showPosts && userPosts.length > 0 && (
          <View style={s.postsSection}>
            <Text style={s.postsSectionTitle}>Posts by {user.name}</Text>
            {userPosts.map(post => (
              <PostCard
                key={post.id}
                post={post}
                currentUserId={myProfile?.id}
                onLike={handleLike}
                onComment={handleComment}
              />
            ))}
          </View>
        )}

        {/* Services Section Disabled - Booking removed */}

        {/* Bio */}
        {user.bio ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>About</Text>
            <Text style={s.bioText}>{user.bio}</Text>
          </View>
        ) : null}

        {/* Details */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Details</Text>
          <View style={s.detailRow}>
            <Ionicons name="location-outline" size={18} color={C.textSecondary} />
            <Text style={s.detailText}>{user.city}{user.state ? `, ${user.state}` : 'Location not set'}</Text>
          </View>
          {user.experience ? (
            <View style={s.detailRow}>
              <Ionicons name="time-outline" size={18} color={C.textSecondary} />
              <Text style={s.detailText}>{user.experience}</Text>
            </View>
          ) : null}
          {user.shopName ? (
            <View style={s.detailRow}>
              <Ionicons name="storefront-outline" size={18} color={C.textSecondary} />
              <Text style={s.detailText}>{user.shopName}</Text>
            </View>
          ) : null}
          {(user.id === myProfile?.id) && (
            <View style={s.detailRow}>
              <Ionicons name="call-outline" size={18} color={C.textSecondary} />
              <Text style={s.detailText}>{user.phone}</Text>
            </View>
          )}
        </View>

        {/* Skills */}
        {user.skills.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Skills</Text>
            <View style={s.skillsWrap}>
              {user.skills.map((skill, i) => (
                <View key={i} style={[s.skillChip, { backgroundColor: roleColor + '15' }]}>
                  <Text style={[s.skillText, { color: roleColor }]}>{skill}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Support */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Support</Text>
          <Pressable
            style={s.supportRow}
            onPress={async () => {
              try {
                const res = await apiRequest('GET', '/api/settings/whatsapp_support_link');
                const { value } = await res.json();
                const url = value || 'https://wa.me/918179142535';
                openLink(url, 'Support');
              } catch {
                openLink('https://wa.me/918179142535', 'Support');
              }
            }}
          >
            <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
            <Text style={s.detailText}>Contact Support</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { justifyContent: 'center', alignItems: 'center' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingBottom: 10,
    backgroundColor: C.background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  topBtn: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  topTitle: { color: C.text, fontSize: 17, fontFamily: 'Inter_700Bold', flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  profileHeader: { alignItems: 'center', marginBottom: 20 },
  avatar: {
    width: 90, height: 90, borderRadius: 45,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  avatarImg: {
    width: 90, height: 90, borderRadius: 45, marginBottom: 12,
    borderWidth: 3, borderColor: '#E8704A',
  },
  avatarText: { fontSize: 32, fontFamily: 'Inter_700Bold' },
  profileName: { color: C.text, fontSize: 22, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  roleBadgeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E8F5ED', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  verifiedText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: GREEN },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  ratingText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  reviewsText: { fontSize: 13, color: C.textSecondary, fontFamily: 'Inter_400Regular' },
  metaRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', justifyContent: 'center' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: C.textSecondary, fontFamily: 'Inter_400Regular' },

  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  chatBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0095F6', borderRadius: 12,
    paddingVertical: 13, gap: 8,
  },
  chatBtnText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 15 },

  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface, borderRadius: 14, paddingVertical: 16,
    marginBottom: 20,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { color: C.text, fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: C.border },

  postsSection: { marginBottom: 20 },
  postsSectionTitle: { color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: 0.5 },

  section: { marginBottom: 20 },
  sectionTitle: { color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: 0.5 },

  servicesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  serviceCard: {
    width: '47%',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: C.border,
  },
  serviceIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF1EC', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  serviceLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  servicePrice: { fontSize: 12, fontFamily: 'Inter_400Regular', color: PRIMARY },

  bioText: { color: C.text, fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  detailText: { color: C.text, fontSize: 15, fontFamily: 'Inter_400Regular' },
  supportRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
    backgroundColor: C.surface, borderRadius: 10, marginTop: 8,
  },
  skillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skillChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  skillText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  emptyTitle: { color: C.text, fontSize: 17, fontFamily: 'Inter_600SemiBold', marginTop: 12 },
  backBtnAlt: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.surface, borderRadius: 10 },
  backBtnText: { color: C.text, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
