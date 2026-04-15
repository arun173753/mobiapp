import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Platform,
  ActivityIndicator, Dimensions, ViewToken, Modal, BackHandler,
  TextInput, ScrollView, Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { router, useNavigation, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import ReelItem from '@/components/ReelItem';
import { Reel, Comment } from '@/lib/types';

const C = Colors.light;
const { width: SW, height: SH } = Dimensions.get('window');
const SNAP_HEIGHT = SH;

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <View style={cs.commentItem}>
      <View style={cs.commentAvatar}>
        <Text style={cs.commentAvatarText}>{comment.userName.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={cs.commentContent}>
        <Text style={cs.commentLine}>
          <Text style={cs.commentName}>{comment.userName} </Text>
          <Text style={cs.commentBody}>{comment.text}</Text>
        </Text>
        <Text style={cs.commentTime}>{timeAgo(comment.createdAt)}</Text>
      </View>
    </View>
  );
}

function CommentsModal({
  visible, onClose, comments, reelId, userId, userName, onCommentAdded,
}: {
  visible: boolean;
  onClose: () => void;
  comments: Comment[];
  reelId: string;
  userId?: string;
  userName?: string;
  onCommentAdded: (reelId: string, comments: Comment[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const handleSend = async () => {
    if (!text.trim() || !userId || !userName || sending) return;
    setSending(true);
    try {
      const res = await apiRequest('POST', `/api/reels/${reelId}/comment`, {
        userId, userName, text: text.trim(),
      });
      const data = await res.json();
      if (data.success) {
        onCommentAdded(reelId, data.comments);
        setText('');
      }
    } catch (e) {
      console.error('[Reels] Comment error:', e);
    } finally {
      setSending(false);
    }
  };

  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e: any) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0)
    );
    return () => { showSub.remove(); hideSub.remove(); };
  }, [visible]);

  const sheetBottom = keyboardHeight > 0 ? keyboardHeight : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={cs.modalOverlay}>
        <Pressable style={cs.backdrop} onPress={onClose} />
        <View style={[cs.sheet, { bottom: sheetBottom, paddingBottom: keyboardHeight > 0 ? 8 : Math.max(insets.bottom, 8) }]}>  
          <View style={cs.handle} />
          <Text style={cs.sheetTitle}>Comments</Text>

          <ScrollView
            style={cs.listWrap}
            contentContainerStyle={comments.length === 0 ? cs.emptyWrap : { paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {comments.length === 0 ? (
              <>
                <Text style={cs.emptyText}>No comments yet</Text>
                <Text style={cs.emptySub}>Start the conversation.</Text>
              </>
            ) : (
              comments.map(item => <CommentItem key={item.id} comment={item} />)
            )}
          </ScrollView>

          {userId && (
            <View style={cs.inputRow}>
              <View style={cs.inputAvatar}>
                <Text style={cs.inputAvatarText}>{(userName || 'U').charAt(0).toUpperCase()}</Text>
              </View>
              <View style={cs.inputWrap}>
                <TextInput
                  ref={inputRef}
                  style={cs.input}
                  placeholder="Add a comment..."
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={text}
                  onChangeText={setText}
                  multiline
                  maxLength={500}
                />
              </View>
              <Pressable
                onPress={handleSend}
                disabled={!text.trim() || sending}
                hitSlop={8}
              >
                <Text style={[cs.postBtn, (!text.trim() || sending) && cs.postBtnOff]}>Post</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

export default function ReelsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ reelId?: string; initialReelId?: string }>();
  const targetReelId = params.reelId || params.initialReelId;
  const { profile } = useApp();
  const [reelsList, setReelsList] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [commentReelId, setCommentReelId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const fetchReels = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/reels');
      const data = await res.json();
      if (Array.isArray(data)) {
        setReelsList(data);
      }
    } catch (e) {
      console.error('[Reels] Fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReels(); }, [fetchReels]);

  // Refresh when returning to this screen (e.g. after uploading a reel)
  useFocusEffect(
    useCallback(() => {
      void fetchReels();
      return undefined;
    }, [fetchReels]),
  );

  // Resolve the initial index once data is loaded — also drives activeIndex so overlay is correct
  const initialTargetIdx = useMemo(() => {
    if (!targetReelId || !reelsList.length) return 0;
    const idx = reelsList.findIndex(r => r.id === targetReelId);
    return idx >= 0 ? idx : 0;
  }, [targetReelId, reelsList]);

  useEffect(() => {
    if (!loading && initialTargetIdx > 0) {
      setActiveIndex(initialTargetIdx);
    }
  }, [loading, initialTargetIdx]);

  const handleLike = useCallback(async (reelId: string) => {
    if (!profile) return;
    let prevLikes: string[] | null = null;
    // Optimistic UI
    setReelsList(prev => prev.map(r => {
      if (r.id !== reelId) return r;
      const likes = Array.isArray((r as any).likes) ? ((r as any).likes as string[]) : [];
      prevLikes = likes;
      const next = likes.includes(profile.id) ? likes.filter(x => x !== profile.id) : [...likes, profile.id];
      return { ...r, likes: next };
    }));
    try {
      const res = await apiRequest('POST', `/api/reels/${reelId}/like`, { userId: profile.id });
      const data = await res.json();
      if (data.success && Array.isArray(data.likes)) {
        setReelsList(prev => prev.map(r => r.id === reelId ? { ...r, likes: data.likes } : r));
      }
    } catch (e) {
      // Roll back on failure
      if (prevLikes) {
        setReelsList(prev => prev.map(r => r.id === reelId ? { ...r, likes: prevLikes! } : r));
      }
      console.error('[Reels] Like error:', e);
    }
  }, [profile]);

  const viewedRef = useRef<Set<string>>(new Set());
  const handleView = useCallback(async (reelId: string) => {
    if (!reelId || viewedRef.current.has(reelId)) return;
    viewedRef.current.add(reelId);
    try {
      await apiRequest('POST', `/api/reels/${reelId}/view`);
      setReelsList(prev => prev.map(r => r.id === reelId ? { ...r, views: (r.views || 0) + 1 } : r));
    } catch (e) {
      console.error('[Reels] View error:', e);
    }
  }, []);

  const handleCommentAdded = useCallback((reelId: string, comments: Comment[]) => {
    setReelsList(prev => prev.map(r => r.id === reelId ? { ...r, comments } : r));
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      setActiveIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace('/');
      return true;
    });
    return () => sub.remove();
  }, []);

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <View style={[s.container, Platform.OS === 'web' ? s.webViewport : null]}>
      <FlatList
        ref={flatListRef}
        data={reelsList}
        keyExtractor={item => item.id}
        initialScrollIndex={initialTargetIdx > 0 ? initialTargetIdx : undefined}
        renderItem={({ item, index }) => (
          <ReelItem
            reel={item}
            isActive={index === activeIndex}
            currentUserId={profile?.id}
            onLike={handleLike}
            onOpenComments={(r) => setCommentReelId(r.id)}
            onView={handleView}
            onRetry={() => void fetchReels()}
          />
        )}
        pagingEnabled
        snapToAlignment="start"
        showsVerticalScrollIndicator={false}
        snapToInterval={SH}
        decelerationRate="fast"
        disableIntervalMomentum
        bounces={false}
        overScrollMode="never"
        style={Platform.OS === 'web' ? ({ height: '100vh', width: '100vw' } as any) : undefined}
        contentContainerStyle={Platform.OS === 'web' ? ({ minHeight: '100vh', width: '100vw', backgroundColor: '#000' } as any) : { backgroundColor: '#000' }}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({ length: SH, offset: SH * index, index })}
        windowSize={3}
        maxToRenderPerBatch={2}
        initialNumToRender={2}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      {(profile?.role === 'teacher' || profile?.role === 'supplier' || profile?.role === 'technician' || profile?.role === 'shopkeeper') && (
        <Pressable
          style={[s.fab, { bottom: insets.bottom + 16 }]}
          onPress={() => router.push('/upload-reel')}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </Pressable>
      )}


      {commentReelId && (
        <CommentsModal
          visible={!!commentReelId}
          onClose={() => setCommentReelId(null)}
          comments={reelsList.find(r => r.id === commentReelId)?.comments || []}
          reelId={commentReelId}
          userId={profile?.id}
          userName={profile?.name}
          onCommentAdded={handleCommentAdded}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  webViewport: {
    position: 'relative',
    overflow: 'hidden',
    width: '100vw' as any,
    height: '100vh' as any,
  },
  center: { justifyContent: 'center', alignItems: 'center' },
  reelWrap: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
    position: 'relative',
  },
  video: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  tapZone: { ...StyleSheet.absoluteFillObject, zIndex: 2 },

  centerIcon: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 8,
  },
  muteCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, zIndex: 30,
  },
  topBtn: {
    width: 34, height: 34, borderRadius: 17,
    justifyContent: 'center', alignItems: 'center',
  },
  topLabel: {
    color: '#fff', fontSize: 17, fontFamily: 'Inter_700Bold',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },

  bottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 14, zIndex: 30,
  },
  bottomLeft: { flex: 1, marginRight: 8, marginBottom: 4 },
  authorRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  authorAv: {
    width: 32, height: 32, borderRadius: 16,
    marginRight: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)',
  },
  authorAvPlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  authorAvText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 13 },
  authorName: {
    color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 14,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  desc: {
    color: 'rgba(255,255,255,0.9)', fontFamily: 'Inter_400Regular', fontSize: 13,
    marginBottom: 2, lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },

  actionStack: {
    position: 'absolute',
    right: 14,
    zIndex: 30,
    alignItems: 'center',
    gap: 22,
  },
  sideItem: { alignItems: 'center' },
  sideCount: {
    color: '#fff', fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  viewsBadge: {
    position: 'absolute',
    left: 14,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  backIconBtn: {
    marginRight: 4,
  },
  viewsText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },

  fab: {
    position: 'absolute', alignSelf: 'center', left: SW / 2 - 24,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.primary,
    justifyContent: 'center', alignItems: 'center',
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 5, zIndex: 40,
  },

  emptyTitle: { color: C.text, fontSize: 17, fontFamily: 'Inter_600SemiBold', marginTop: 14 },
  emptyDesc: { color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 4, textAlign: 'center', paddingHorizontal: 40 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.primary, paddingHorizontal: 18, paddingVertical: 11,
    borderRadius: 22, marginTop: 20, gap: 6,
  },
  emptyBtnText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});

const styles = StyleSheet.create({
  videoOverlayCenter: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -70 }, { translateY: -20 }],
    width: 140,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  videoOverlayText: {
    color: '#fff',
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  videoErrorBox: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 110,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  videoErrorTitle: { color: '#fff', fontWeight: '800', fontSize: 14, marginBottom: 4 },
  videoErrorMsg: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginBottom: 10 },
  videoRetryBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  videoRetryText: { color: '#111', fontWeight: '800' },
});

const cs = StyleSheet.create({
  modalOverlay: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0,
    height: SH * 0.55,
    backgroundColor: '#1C1C1E', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 14,
  },
  listWrap: { flex: 1, marginTop: 4 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#555', alignSelf: 'center', marginTop: 10, marginBottom: 8 },
  sheetTitle: {
    color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 15,
    textAlign: 'center', paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  emptySub: { color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },

  commentItem: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 2 },
  commentAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#3a3a3c', justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  commentAvatarText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 13 },
  commentContent: { flex: 1 },
  commentLine: { fontSize: 14, lineHeight: 20 },
  commentName: { color: '#fff', fontFamily: 'Inter_700Bold' },
  commentBody: { color: 'rgba(255,255,255,0.9)', fontFamily: 'Inter_400Regular' },
  commentTime: { color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center', paddingTop: 10, paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)', gap: 10,
  },
  inputAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#3a3a3c', justifyContent: 'center', alignItems: 'center',
  },
  inputAvatarText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  inputWrap: {
    flex: 1,
    backgroundColor: '#2C2C2E',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 14,
    justifyContent: 'center',
    minHeight: 38,
  },
  input: {
    color: '#fff', fontFamily: 'Inter_400Regular', fontSize: 14,
    paddingVertical: Platform.OS === 'ios' ? 8 : 6, maxHeight: 80,
  },
  postBtn: { color: '#0095F6', fontFamily: 'Inter_700Bold', fontSize: 14 },
  postBtnOff: { opacity: 0.3 },
});

// ─── ReelsPreviewStrip ────────────────────────────────────────────────────────
// Horizontal thumbnail strip for embedding in the posts feed.
// Tapping a thumbnail opens the full-screen reels player starting at that reel.

const THUMB_SIZE = 100;
const MOBI_LOGO = require('@/assets/mobi-logo.jpeg');

function ReelThumb({ reel, label, onPress }: { reel: Reel; label: number; onPress: () => void }) {
  const baseUrl = getApiUrl();
  const rawVideoUrl = (reel.videoUrl.startsWith('http') || reel.videoUrl.includes('b-cdn.net'))
    ? reel.videoUrl
    : `${baseUrl}${reel.videoUrl}`;

  const storedThumb = (reel.thumbnailUrl && reel.thumbnailUrl.trim() !== '') ? reel.thumbnailUrl : null;
  const [generatedThumb, setGeneratedThumb] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (storedThumb || Platform.OS === 'web') return;
    let cancelled = false;
    VideoThumbnails.getThumbnailAsync(rawVideoUrl, { time: 1000 })
      .then(({ uri }) => { if (!cancelled) setGeneratedThumb(uri); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [rawVideoUrl, storedThumb]);

  const thumbUri = storedThumb || generatedThumb;

  return (
    <Pressable onPress={onPress} style={ps.thumb}>
      {thumbUri && !imgError ? (
        <Image
          source={{ uri: thumbUri }}
          style={ps.thumbImg}
          contentFit="cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <Image
          source={MOBI_LOGO}
          style={ps.thumbImg}
          contentFit="cover"
        />
      )}
      <View style={ps.thumbOverlay}>
        <Ionicons name="play" size={18} color="#fff" />
      </View>
      <View style={ps.thumbLabel}>
        <Text style={ps.thumbLabelText} numberOfLines={1}>{String(label)}</Text>
        <Text style={ps.thumbViewsText} numberOfLines={1}>{`${reel.views || 0} views`}</Text>
      </View>
    </Pressable>
  );
}

export function ReelsPreviewStrip({ onOpenReel }: { onOpenReel: (reelId: string) => void }) {
  const [stripReels, setStripReels] = useState<Reel[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    apiRequest('GET', '/api/reels')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const sorted = [...data].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          setTotalCount(sorted.length);
          setStripReels(sorted.slice(0, 10));
        }
      })
      .catch(() => {});
  }, []);

  if (stripReels.length === 0) return null;

  return (
    <View style={ps.stripContainer}>
      <View style={ps.stripHeader}>
        <Ionicons name="film-outline" size={16} color="#7C3AED" />
        <Text style={ps.stripTitle}>Reels</Text>
        <View style={ps.stripCountBadge}>
          <Text style={ps.stripCountText}>{totalCount}</Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color="#7C3AED" />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={ps.stripScroll}
      >
        {stripReels.map((reel, index) => (
          <ReelThumb key={reel.id} reel={reel} label={stripReels.length - index} onPress={() => onOpenReel(reel.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

const ps = StyleSheet.create({
  stripContainer: {
    marginVertical: 8,
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    marginHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB60',
  },
  stripHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, marginBottom: 10,
  },
  stripTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#7C3AED' },
  stripCountBadge: {
    flex: 1,
    marginLeft: 6,
    backgroundColor: '#7C3AED',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignSelf: 'center',
    minWidth: 22,
    alignItems: 'center',
  },
  stripCountText: { color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold' },
  stripScroll: { paddingHorizontal: 12, gap: 8 },
  thumb: {
    width: THUMB_SIZE, height: THUMB_SIZE * 1.6, borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#000',
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbFallback: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  thumbLabel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 6, paddingVertical: 5,
  },
  thumbLabelText: { color: '#fff', fontSize: 13, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  thumbViewsText: { color: '#fff', fontSize: 9, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginTop: 2 },
});

// ─── ReelsFeedInline ─────────────────────────────────────────────────────────
// Full-screen reel player designed for inline embed in the home feed tab.
// Uses Dimensions to take up the full screen height.

export function ReelsFeedInline({ initialReelId: initialReelIdProp }: { initialReelId?: string }) {
  const { profile } = useApp();
  const params = useLocalSearchParams<{ reelId?: string }>();
  const initialReelId = initialReelIdProp || (typeof params.reelId === 'string' ? params.reelId : undefined);
  const [pendingReelId, setPendingReelId] = useState<string | null>(initialReelId ?? null);
  const [reelsList, setReelsList] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [commentReelId, setCommentReelId] = useState<string | null>(null);
  const flatListRef = useRef<any>(null);

  const fetchReels = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/reels');
      const data = await res.json();
      if (Array.isArray(data)) {
        const ordered = [...data].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setReelsList(ordered);
        if (pendingReelId) {
          const idx = ordered.findIndex((r: Reel) => r.id === pendingReelId);
          if (idx >= 0) setActiveIndex(idx);
        }
      }
    } catch (e) {
      console.error('[Reels] Fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [pendingReelId]);

  useEffect(() => { fetchReels(); }, [fetchReels]);

  useEffect(() => {
    if (reelsList.length > 0) {
      const idx = pendingReelId ? reelsList.findIndex(r => r.id === pendingReelId) : -1;
      if (idx >= 0 && flatListRef.current) {
        flatListRef.current.scrollToIndex({ index: idx, animated: false });
        setActiveIndex(idx);
        setPendingReelId(null);
      }
    }
  }, [pendingReelId, reelsList]);

  const handleLike = useCallback(async (reelId: string) => {
    if (!profile) return;
    let prevLikes: string[] | null = null;
    setReelsList(prev => prev.map(r => {
      if (r.id !== reelId) return r;
      const likes = Array.isArray((r as any).likes) ? ((r as any).likes as string[]) : [];
      prevLikes = likes;
      const next = likes.includes(profile.id) ? likes.filter(x => x !== profile.id) : [...likes, profile.id];
      return { ...r, likes: next };
    }));
    try {
      const res = await apiRequest('POST', `/api/reels/${reelId}/like`, { userId: profile.id });
      const data = await res.json();
      if (data.success && Array.isArray(data.likes)) {
        setReelsList(prev => prev.map(r => r.id === reelId ? { ...r, likes: data.likes } : r));
      }
    } catch (e) {
      if (prevLikes) {
        setReelsList(prev => prev.map(r => r.id === reelId ? { ...r, likes: prevLikes! } : r));
      }
      console.error('[Reels] Like error:', e);
    }
  }, [profile]);

  const viewedRef = useRef<Set<string>>(new Set());
  const handleView = useCallback(async (reelId: string) => {
    if (!reelId || viewedRef.current.has(reelId)) return;
    viewedRef.current.add(reelId);
    try {
      await apiRequest('POST', `/api/reels/${reelId}/view`);
      setReelsList(prev => prev.map(r => r.id === reelId ? { ...r, views: (r.views || 0) + 1 } : r));
    } catch (e) {
      console.error('[Reels] View error:', e);
    }
  }, []);

  const handleCommentAdded = useCallback((reelId: string, comments: Comment[]) => {
    setReelsList(prev => prev.map(r => r.id === reelId ? { ...r, comments } : r));
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) {
      setActiveIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

  const insets = useSafeAreaInsets();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (reelsList.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
        <MaterialCommunityIcons name="video-off-outline" size={48} color="rgba(255,255,255,0.4)" />
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, fontFamily: 'Inter_600SemiBold', marginTop: 14 }}>No reels yet</Text>
        {(profile?.role === 'teacher' || profile?.role === 'supplier' || profile?.role === 'technician') && (
          <Pressable
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.primary, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 22, marginTop: 20, gap: 6 }}
            onPress={() => router.push('/upload-reel')}
          >
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Upload Reel</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <FlatList
        ref={flatListRef}
        data={reelsList}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => (
          <ReelItem
            reel={item}
            isActive={index === activeIndex}
            currentUserId={profile?.id}
            onLike={handleLike}
            onOpenComments={(r) => setCommentReelId(r.id)}
            onView={handleView}
            onRetry={() => void fetchReels()}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={SH}
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({ length: SH, offset: SH * index, index })}
        windowSize={3}
        maxToRenderPerBatch={2}
        initialNumToRender={2}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      {(profile?.role === 'teacher' || profile?.role === 'supplier' || profile?.role === 'technician') && (
        <Pressable
          style={[s.fab, { bottom: insets.bottom + 16 }]}
          onPress={() => router.push('/upload-reel')}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </Pressable>
      )}

      {commentReelId && (
        <CommentsModal
          visible={!!commentReelId}
          onClose={() => setCommentReelId(null)}
          comments={reelsList.find(r => r.id === commentReelId)?.comments || []}
          reelId={commentReelId}
          userId={profile?.id}
          userName={profile?.name}
          onCommentAdded={handleCommentAdded}
        />
      )}
    </View>
  );
}
