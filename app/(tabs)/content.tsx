import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, Pressable, Platform,
  Image, ActivityIndicator, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, {
  FadeInDown, useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';
import { openLink } from '@/lib/open-link';

const BG   = '#F9FAFB';
const CARD = '#FFFFFF';
const TEXT = '#111827';
const MUTED = '#9CA3AF';
const RED  = '#EF4444';
const BORDER = '#E5E7EB';

interface LiveSession {
  id: string;
  teacherId: string;
  teacherName: string;
  teacherAvatar?: string;
  title: string;
  platform: string;
  link: string;
  thumbnailUrl?: string;
  isLive: boolean;
  startedAt: number;
  viewerCount?: number;
}

const PLATFORM_COLORS: Record<string, string> = {
  youtube: '#FF0000', zoom: '#2D8CFF', meet: '#00897B',
  bunny: '#FF6B35', camera: '#8B5CF6', other: '#EF4444',
};
const PLATFORM_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  youtube: 'logo-youtube', zoom: 'videocam', meet: 'videocam',
  bunny: 'videocam', camera: 'videocam', other: 'radio',
};
const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube', zoom: 'Zoom', meet: 'Google Meet',
  bunny: 'Live', camera: 'Camera', other: 'Live',
};

function LiveDotPulse({ color = RED }: { color?: string }) {
  const scale   = useSharedValue(1);
  const opacity = useSharedValue(0.8);
  useEffect(() => {
    scale.value   = withRepeat(withSequence(withTiming(2, { duration: 800 }), withTiming(1, { duration: 400 })), -1);
    opacity.value = withRepeat(withSequence(withTiming(0, { duration: 800 }), withTiming(0.8, { duration: 400 })), -1);
  }, []);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: opacity.value }));
  return (
    <View style={{ width: 10, height: 10 }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 5, backgroundColor: color }, ring]} />
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
    </View>
  );
}

function LiveCard({ session, onJoin }: { session: LiveSession; onJoin: (s: LiveSession) => void }) {
  const pColor = PLATFORM_COLORS[session.platform] ?? RED;
  const pIcon  = PLATFORM_ICONS[session.platform] ?? 'radio';
  const pLabel = PLATFORM_LABELS[session.platform] ?? 'Live';
  const elapsed = Math.floor((Date.now() - session.startedAt) / 60000);
  const timeStr = elapsed < 1 ? 'Just started' : elapsed < 60 ? `${elapsed}m` : `${Math.floor(elapsed / 60)}h`;
  const [imageError, setImageError] = React.useState(false);

  return (
    <Animated.View entering={FadeInDown.duration(350).springify()}>
      <Pressable style={liveStyles.card} onPress={() => onJoin(session)}>
        {/* Thumbnail / Icon area */}
        <View style={[liveStyles.thumb, { backgroundColor: pColor + '14' }]}>
          {session.thumbnailUrl && !imageError ? (
            <Image 
              source={{ uri: session.thumbnailUrl }} 
              style={liveStyles.thumbImg} 
              resizeMode="cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <Ionicons name={pIcon} size={28} color={pColor} />
          )}
          {/* LIVE badge */}
          <View style={liveStyles.livePill}>
            <LiveDotPulse color="#FFF" />
            <Text style={liveStyles.livePillText}>LIVE</Text>
          </View>
        </View>

        {/* Info row */}
        <View style={liveStyles.info}>
          {/* Avatar */}
          <View style={[liveStyles.avatar, { backgroundColor: pColor + '20' }]}>
            {session.teacherAvatar ? (
              <Image source={{ uri: session.teacherAvatar }} style={liveStyles.avatarImg} />
            ) : (
              <Text style={[liveStyles.avatarInitial, { color: pColor }]}>
                {(session.teacherName || 'T')[0].toUpperCase()}
              </Text>
            )}
          </View>

          {/* Title & meta */}
          <View style={liveStyles.textBlock}>
            <Text style={liveStyles.title} numberOfLines={2}>{session.title}</Text>
            <View style={liveStyles.metaRow}>
              <Text style={liveStyles.teacherName}>{session.teacherName}</Text>
              <Text style={liveStyles.dot}>·</Text>
              <Ionicons name={pIcon} size={11} color={pColor} />
              <Text style={[liveStyles.platformLabel, { color: pColor }]}>{pLabel}</Text>
              <Text style={liveStyles.dot}>·</Text>
              <Text style={liveStyles.time}>{timeStr}</Text>
            </View>
            {session.viewerCount != null && session.viewerCount > 0 && (
              <Text style={liveStyles.viewers}>{session.viewerCount} watching</Text>
            )}
          </View>

          {/* Join button */}
          <Pressable
            style={[liveStyles.joinBtn, { backgroundColor: pColor }]}
            onPress={() => onJoin(session)}
            hitSlop={8}
          >
            <Ionicons name="play" size={11} color="#FFF" />
            <Text style={liveStyles.joinText}>Join</Text>
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const liveStyles = StyleSheet.create({
  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    marginHorizontal: 16,
    marginVertical: 7,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  thumb: {
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  thumbImg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  livePill: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(220,38,38,0.9)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  livePillText: { color: '#FFF', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.2 },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarImg: { width: 40, height: 40, borderRadius: 20 },
  avatarInitial: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  textBlock: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: TEXT, lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  teacherName: { fontSize: 12, color: MUTED, fontFamily: 'Inter_500Medium' },
  platformLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  dot: { fontSize: 11, color: MUTED },
  time: { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular' },
  viewers: { fontSize: 11, color: '#6366F1', fontFamily: 'Inter_500Medium', marginTop: 1 },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    flexShrink: 0,
  },
  joinText: { color: '#FFF', fontSize: 13, fontFamily: 'Inter_700Bold' },
});

export default function LiveContentScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLiveSessions = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/teacher/live-sessions');
      const data = await res.json();
      if (data.sessions) setLiveSessions(data.sessions as LiveSession[]);
    } catch (e) {
      console.error('[Live] fetch error:', e);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchLiveSessions().finally(() => setLoading(false));
    intervalRef.current = setInterval(fetchLiveSessions, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchLiveSessions]);

  useFocusEffect(useCallback(() => {
    fetchLiveSessions();
  }, [fetchLiveSessions]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLiveSessions();
    setRefreshing(false);
  }, [fetchLiveSessions]);

  const handleJoinLive = useCallback((session: LiveSession) => {
    const link = session.link || '';
    const isExternalVideo = /youtube\.com|youtu\.be|zoom\.us|meet\.google\.com/i.test(link);
    if (Platform.OS !== 'web' && isExternalVideo) {
      Linking.openURL(link).catch(() => {});
      return;
    }
    router.navigate({
      pathname: '/live-link',
      params: { link, title: session.title },
    } as any);
  }, []);

  const topPad = (Platform.OS === 'web' ? 67 : insets.top) + 10;
  const isTeacher = profile?.role === 'teacher' || profile?.role === 'admin';

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <LiveDotPulse />
          <Text style={styles.screenTitle}>Live Sessions</Text>
          <Text style={styles.orgCode}>Org Code: Wcpdlu</Text>
        </View>
        {isTeacher && (
          <Pressable onPress={() => router.push('/go-live' as any)} style={styles.broadcastBtn}>
            <Ionicons name="radio" size={18} color={RED} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={liveSessions}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <LiveCard session={item} onJoin={handleJoinLive} />}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: Platform.OS === 'web' ? 100 : 90 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={RED} colors={[RED]} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          isTeacher ? (
            <View style={{ paddingHorizontal: 16, marginBottom: 8, gap: 10 }}>
              <Pressable style={styles.goLiveBtn} onPress={() => router.push('/go-live' as any)}>
                <View style={styles.liveDotWhite} />
                <Text style={styles.goLiveBtnText}>Start Live Stream</Text>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
              </Pressable>
              <Pressable style={styles.uploadBtn} onPress={async () => {
                try {
                  const res = await apiRequest('GET', '/api/admin/links');
                  const data = await res.json();
                  const uploadLink = data?.upload_video_link;
                  if (uploadLink) {
                    openLink(uploadLink, 'Upload Video');
                  }
                } catch (e) {
                  console.error('[Upload] Error:', e);
                }
              }}>
                <Ionicons name="cloud-upload" size={18} color="#FFF" />
                <Text style={styles.uploadBtnText}>Upload Video</Text>
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator size="small" color={RED} />
              <Text style={styles.emptyText}>Loading live sessions...</Text>
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <Ionicons name="radio-outline" size={36} color={RED} />
              </View>
              <Text style={styles.emptyTitle}>No live sessions right now</Text>
              <Text style={styles.emptyText}>Check back soon or start your own stream</Text>
              {isTeacher && (
                <Pressable style={styles.goLiveBtn} onPress={() => router.push('/go-live' as any)}>
                  <View style={styles.liveDotWhite} />
                  <Text style={styles.goLiveBtnText}>Start Live Stream</Text>
                </Pressable>
              )}
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER + '60',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  screenTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: TEXT },
  orgCode: { fontSize: 13, fontFamily: 'Inter_700Bold', color: RED, marginLeft: 'auto' },
  broadcastBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: RED + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goLiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: RED,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    shadowColor: RED,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  liveDotWhite: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' },
  goLiveBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_700Bold', flex: 1 },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FF6B35',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    shadowColor: '#FF6B35',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  uploadBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_700Bold', flex: 1 },
  center: { paddingTop: 60, alignItems: 'center' },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 12, paddingHorizontal: 40 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: RED + '14',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: TEXT },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center' },
});
