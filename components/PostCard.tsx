import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput,
  Platform, Alert, Modal, Share,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring, withSequence,
} from 'react-native-reanimated';
import { Post, ROLE_LABELS } from '@/lib/types';
import MediaViewer from '@/components/MediaViewer';
import { apiRequest } from '@/lib/query-client';

// ─── UX Pilot exact tokens ──────────────────────────────────────────────────
const BG_DARK       = '#121212';
const CARD_CHARCOAL = '#2A2A2A';
const BORDER_DARK   = '#374151';
const TEXT_MAIN     = '#F3F4F6';
const TEXT_MUTED    = '#9CA3AF';
const ACCENT_BLUE   = '#3B82F6';
const ACCENT_GREEN  = '#10B981';
const ACCENT_ORANGE = '#FF6B2C';
const PURPLE        = '#8B5CF6';

const CAT_CONFIG: Record<string, {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}> = {
  repair: {
    label: 'Repair', icon: 'construct', color: ACCENT_BLUE,
  },
  job: {
    label: 'Job', icon: 'briefcase', color: PURPLE,
  },
  training: {
    label: 'Training', icon: 'school', color: ACCENT_GREEN,
  },
  sell: {
    label: 'For Sale', icon: 'pricetag', color: ACCENT_ORANGE,
  },
  supplier: {
    label: 'Supplier', icon: 'cube', color: ACCENT_GREEN,
  },
};

function getProfileRoute(userId: string, userRole?: string) {
  if (userRole === 'supplier') {
    return { pathname: '/supplier-profile', params: { id: userId } };
  }
  return { pathname: '/user-profile', params: { id: userId } };
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w]+/g);
  return matches ? matches.slice(0, 4) : [];
}

function pickTagColor(tag: string, fallback: string): string {
  const lc = tag.toLowerCase();
  if (lc.includes('damage') || lc.includes('issue') || lc.includes('error')) return '#EF4444';
  if (lc.includes('success') || lc.includes('fixed') || lc.includes('done')) return ACCENT_GREEN;
  if (lc.includes('job') || lc.includes('hire') || lc.includes('work')) return PURPLE;
  return fallback;
}

interface PostCardProps {
  post: Post;
  currentUserId?: string;
  onLike: (postId: string) => void;
  onComment: (postId: string, text: string) => void;
  onDelete?: (postId: string) => void;
  onPostUpdated?: (updatedPost: Partial<Post> & { id: string }) => void;
}

export default function PostCard({
  post, currentUserId, onLike, onComment, onDelete, onPostUpdated,
}: PostCardProps) {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [viewerMedia, setViewerMedia] = useState<{ type: 'image' | 'video'; url: string } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editText, setEditText] = useState(post.text);
  const [editSaving, setEditSaving] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [fullscreenVideoUrl, setFullscreenVideoUrl] = useState<string | null>(null);

  const isLiked = currentUserId ? post.likes.includes(currentUserId) : false;
  const isOwn   = currentUserId === post.userId;
  const isTech  = post.userRole === 'technician';

  const cat      = CAT_CONFIG[post.category] || CAT_CONFIG.repair;
  const catColor = cat.color;

  const handleShowOptions = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Post Options', '', [
      { text: 'Edit Post', onPress: () => { setEditText(post.text); setShowEditModal(true); } },
      onDelete ? { text: 'Delete Post', style: 'destructive', onPress: () => onDelete(post.id) } : null,
      { text: 'Cancel', style: 'cancel' },
    ].filter(Boolean) as any[]);
  };

  const handleSaveEdit = async () => {
    if (!editText.trim()) return;
    setEditSaving(true);
    try {
      await apiRequest('PATCH', `/api/posts/${post.id}`, { userId: currentUserId, text: editText.trim() });
      setShowEditModal(false);
      onPostUpdated?.({ id: post.id, text: editText.trim() });
    } catch {
      Alert.alert('Error', 'Failed to update post');
    } finally {
      setEditSaving(false);
    }
  };

  const likeScale    = useSharedValue(1);
  const likeAnimStyle = useAnimatedStyle(() => ({ transform: [{ scale: likeScale.value }] }));

  const handleLike = () => {
    likeScale.value = withSequence(withSpring(1.4, { damping: 4 }), withSpring(1, { damping: 6 }));
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onLike(post.id);
  };

  const handleShare = async () => {
    try {
      const message = `Check out this ${post.category} post by ${post.userName}:\n\n"${post.text.slice(0, 100)}${post.text.length > 100 ? '...' : ''}"\n\nhttps://mobile-repair-app-276b6.web.app`;
      await Share.share({
        message,
        title: `${post.category.toUpperCase()} - ${post.userName}`,
        url: 'https://mobile-repair-app-276b6.web.app',
      });
    } catch (e: any) {
      console.log('Share error:', e.message);
    }
  };

  // Track view on mount
  useEffect(() => {
    if (!currentUserId) return;
    const trackView = async () => {
      try {
        await apiRequest('POST', `/api/posts/${post.id}/view`, { userId: currentUserId });
      } catch (e) {
        console.log('View tracking failed:', e);
      }
    };
    trackView();
  }, [post.id, currentUserId]);

  const handleComment = () => {
    if (!commentText.trim()) return;
    onComment(post.id, commentText.trim());
    setCommentText('');
  };

  // Sell post parsing
  const isSellPost = post.category === 'sell' && post.text.startsWith('SELL_TITLE:');
  let sellTitle = '', sellPrice = '', sellDesc = '', sellCondition = '';
  if (isSellPost) {
    post.text.split('\n').forEach(line => {
      if (line.startsWith('SELL_TITLE:'))     sellTitle     = line.replace('SELL_TITLE:', '').trim();
      if (line.startsWith('SELL_PRICE:'))     sellPrice     = line.replace('SELL_PRICE:', '').trim();
      if (line.startsWith('SELL_DESC:'))      sellDesc      = line.replace('SELL_DESC:', '').trim();
      if (line.startsWith('SELL_CONDITION:')) sellCondition = line.replace('SELL_CONDITION:', '').trim();
    });
  }
  const displayText = isSellPost ? sellDesc : post.text;

  // Hashtags
  const hashtags   = extractHashtags(displayText);
  const fallbackTag = `#${post.category.charAt(0).toUpperCase() + post.category.slice(1)}`;

  return (
    <View style={styles.card}>
      {/* ── Category Badge: absolute top-right, rounded-bl ── */}
      <View style={[styles.badge, { backgroundColor: catColor + '33' }]}>
        <Ionicons name={cat.icon} size={10} color={catColor} />
        <Text style={[styles.badgeText, { color: catColor }]}>{cat.label}</Text>
      </View>

      {/* ── Header (pr-80 to avoid badge) ── */}
      <View style={styles.header}>
        {post.userRole === 'supplier' ? (
          <View>
            {post.userAvatar && !avatarLoadFailed ? (
              <Image
                source={{ uri: post.userAvatar }}
                style={[styles.avatar, { borderColor: catColor + '80' }]}
                contentFit="cover"
                onError={() => setAvatarLoadFailed(true)}
              />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: catColor + '25', borderColor: catColor + '80' }]}>
                <Text style={[styles.avatarText, { color: catColor }]}>{getInitials(post.userName)}</Text>
              </View>
            )}
          </View>
        ) : (
          <Pressable onPress={() => router.push(getProfileRoute(post.userId, post.userRole) as any)}>
            {post.userAvatar && !avatarLoadFailed ? (
              <Image
                source={{ uri: post.userAvatar }}
                style={[styles.avatar, { borderColor: catColor + '80' }]}
                contentFit="cover"
                onError={() => setAvatarLoadFailed(true)}
              />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: catColor + '25', borderColor: catColor + '80' }]}>
                <Text style={[styles.avatarText, { color: catColor }]}>{getInitials(post.userName)}</Text>
              </View>
            )}
          </Pressable>
        )}

        <View style={styles.headerInfo}>
          <View style={styles.nameRow}>
            {post.userRole === 'supplier' ? (
              <Text style={styles.userName} numberOfLines={1}>{post.userName}</Text>
            ) : (
              <Pressable onPress={() => router.push(getProfileRoute(post.userId, post.userRole) as any)}>
                <Text style={styles.userName} numberOfLines={1}>{post.userName}</Text>
              </Pressable>
            )}
            {isTech && <Ionicons name="checkmark-circle" size={11} color={ACCENT_GREEN} />}
          </View>
          <Text style={styles.metaText}>{ROLE_LABELS[post.userRole]} · {timeAgo(post.createdAt)}</Text>
        </View>

        {isOwn && (
          <Pressable onPress={handleShowOptions} hitSlop={12} style={styles.moreBtn}>
            <Ionicons name="ellipsis-horizontal" size={16} color={TEXT_MUTED} />
          </Pressable>
        )}
      </View>

      {/* ── Sell header ── */}
      {isSellPost && (
        <View style={styles.sellHeader}>
          <Text style={styles.sellTitle}>{sellTitle}</Text>
          <View style={styles.sellMeta}>
            <Text style={styles.sellPrice}>₹{sellPrice}</Text>
            {!!sellCondition && (
              <View style={[styles.conditionBadge, { backgroundColor: ACCENT_GREEN + '20' }]}>
                <Text style={[styles.conditionText, { color: ACCENT_GREEN }]}>{sellCondition}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── Post text ── */}
      {displayText.length > 0 && (
        <Text style={styles.postText}>{displayText}</Text>
      )}

      {/* ── Images or Video ── */}
      {(post.images.length > 0 || post.videoUrl) && (
        <>
          {post.images.length > 0 && (
            <>
              <Text style={{ fontSize: 10, color: '#999', marginLeft: 12, marginBottom: 8 }}>
                📸 {post.images.length} image{post.images.length > 1 ? 's' : ''}
              </Text>
            </>
          )}
          <View style={styles.imageWrap}>
          {/* Video: 4:3 thumbnail with play button */}
          {post.videoUrl && !post.images.length ? (
            <Pressable 
              style={styles.videoCardContainer}
              onPress={() => setFullscreenVideoUrl(post.videoUrl)}
            >
              {/* Black background for video thumbnail */}
              <View style={styles.videoThumbnailBg}>
                <Ionicons name="play-circle" size={72} color="#FFFFFF" />
              </View>
              {/* Play button overlay */}
              <View style={styles.videoPlayOverlay}>
                <View style={styles.playButtonCenter}>
                  <Ionicons name="play-circle" size={64} color="#FFFFFF" />
                </View>
              </View>
            </Pressable>
          ) : null}

          {/* Images grid */}
          {post.images.length > 0 ? (
            post.images.length === 1 ? (
              <Pressable onPress={() => setViewerMedia({ type: 'image', url: post.images[0] })}>
                <Image source={{ uri: post.images[0] }} style={styles.singleImage} contentFit="contain" />
              </Pressable>
            ) : (
              <View style={styles.imageGrid}>
                {post.images.slice(0, 4).map((img, i) => (
                  <Pressable key={i} style={styles.gridCell} onPress={() => setViewerMedia({ type: 'image', url: img })}>
                    <Image source={{ uri: img }} style={styles.gridImage} contentFit="cover" />
                    {i === 3 && post.images.length > 4 && (
                      <View style={styles.moreOverlay}>
                        <Text style={styles.moreText}>+{post.images.length - 4}</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            )
          ) : null}
        </View>
        </>
      )}

      {/* ── Hashtag pills ── */}
      <View style={styles.tags}>
        {(hashtags.length > 0 ? hashtags : [fallbackTag]).map((tag, i) => {
          const tc = hashtags.length > 0 ? pickTagColor(tag, catColor) : catColor;
          return (
            <View key={i} style={[styles.tagPill, { backgroundColor: tc + '1A' }]}>
              <Text style={[styles.tagText, { color: tc }]}>{tag}</Text>
            </View>
          );
        })}
      </View>

      {/* ── Action row ── */}
      <View style={styles.actions}>
        <View style={styles.actionLeft}>
          <Pressable style={styles.actionBtn} onPress={() => setShowComments(v => !v)}>
            <Ionicons name="chatbubble-outline" size={13} color={TEXT_MUTED} />
            <Text style={styles.actionBtnText}>{post.comments.length}</Text>
          </Pressable>

          <Animated.View style={likeAnimStyle}>
            <Pressable
              style={[styles.actionBtn, isLiked && { borderColor: ACCENT_GREEN + '80' }]}
              onPress={handleLike}
            >
              <Ionicons
                name={isLiked ? 'arrow-up-circle' : 'arrow-up-circle-outline'}
                size={13}
                color={isLiked ? ACCENT_GREEN : TEXT_MUTED}
              />
              <Text style={[styles.actionBtnText, isLiked && { color: ACCENT_GREEN }]}>
                {post.likes.length}
              </Text>
            </Pressable>
          </Animated.View>
        </View>

        {/* Share button */}
        <Pressable
          style={[styles.ctaBtn, { backgroundColor: ACCENT_BLUE + '1A', borderColor: ACCENT_BLUE + '33' }]}
          onPress={handleShare}
        >
          <Ionicons name="share-social" size={11} color={ACCENT_BLUE} />
          <Text style={[styles.ctaBtnText, { color: ACCENT_BLUE }]}>Share</Text>
        </Pressable>
      </View>

      {/* ── Comments section ── */}
      {showComments && (
        <View style={styles.commentsSection}>
          {post.comments.slice(-3).map((c, i) => (
            <View key={i} style={styles.commentRow}>
              <View style={[styles.commentAvatar, { backgroundColor: catColor + '25' }]}>
                <Text style={[styles.commentAvatarText, { color: catColor }]}>{getInitials(c.userName)}</Text>
              </View>
              <View style={styles.commentBody}>
                <Text style={styles.commentName}>{c.userName}</Text>
                <Text style={styles.commentText}>{c.text}</Text>
              </View>
            </View>
          ))}
          <View style={styles.commentInput}>
            <TextInput
              style={styles.commentTextInput}
              placeholder="Add a comment..."
              placeholderTextColor={TEXT_MUTED}
              value={commentText}
              onChangeText={setCommentText}
              onSubmitEditing={handleComment}
              returnKeyType="send"
            />
            <Pressable onPress={handleComment} disabled={!commentText.trim()}>
              <Ionicons name="send" size={18} color={commentText.trim() ? catColor : TEXT_MUTED} />
            </Pressable>
          </View>
        </View>
      )}

      <MediaViewer
        visible={!!viewerMedia}
        onClose={() => setViewerMedia(null)}
        imageUrl={viewerMedia?.type === 'image' ? viewerMedia.url : undefined}
        videoUrl={viewerMedia?.type === 'video' ? viewerMedia.url : undefined}
      />

      <Modal visible={showEditModal} transparent animationType="slide" onRequestClose={() => setShowEditModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.editModal}>
            <View style={styles.editModalHeader}>
              <Text style={styles.editModalTitle}>Edit Post</Text>
              <Pressable onPress={() => setShowEditModal(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={TEXT_MUTED} />
              </Pressable>
            </View>
            <TextInput
              style={styles.editTextInput}
              value={editText}
              onChangeText={setEditText}
              multiline
              numberOfLines={6}
              placeholder="Edit your post..."
              placeholderTextColor={TEXT_MUTED}
              autoFocus
            />
            <Pressable
              style={[styles.editSaveBtn, (!editText.trim() || editSaving) && { opacity: 0.5 }]}
              onPress={handleSaveEdit}
              disabled={!editText.trim() || editSaving}
            >
              <Text style={styles.editSaveBtnText}>{editSaving ? 'Saving...' : 'Save Changes'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Fullscreen video player modal ── */}
      {fullscreenVideoUrl && (
        <Modal
          visible={!!fullscreenVideoUrl}
          transparent={false}
          animationType="fade"
          onRequestClose={() => setFullscreenVideoUrl(null)}
        >
          <View style={styles.fullscreenVideoContainer}>
            <Pressable 
              style={styles.fullscreenCloseBtn}
              onPress={() => setFullscreenVideoUrl(null)}
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </Pressable>
            <Video
              source={{ uri: fullscreenVideoUrl }}
              style={styles.fullscreenVideo}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={true}
              isLooping={false}
              isMuted={false}
              progressUpdateIntervalMillis={500}
            />
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_CHARCOAL,
    borderRadius: 14,
    padding: 12,
    marginHorizontal: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER_DARK + '4D',
    position: 'relative',
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomLeftRadius: 10,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingRight: 80,
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  userName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  metaText: {
    color: TEXT_MUTED,
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
  },
  moreBtn: {
    position: 'absolute',
    right: -2,
    top: -2,
    padding: 4,
  },
  sellHeader: {
    marginBottom: 10,
  },
  sellTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  sellMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sellPrice: {
    color: ACCENT_GREEN,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  conditionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  conditionText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  postText: {
    color: TEXT_MAIN,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'Inter_400Regular',
    marginBottom: 12,
    fontWeight: '500',
  },
  imageWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER_DARK + '80',
  },
  singleImage: {
    width: '100%',
    height: 280,
    backgroundColor: '#000',
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  gridCell: {
    width: '49%' as any,
    height: 110,
    position: 'relative',
  },
  gridImage: {
    width: '100%',
    height: 140,
  },
  moreOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    color: '#FFF',
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
  },
  videoCardContainer: {
    position: 'relative',
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  videoThumbnailBg: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: BORDER_DARK,
  },
  inlineVideo: {
    width: '100%',
    height: 240,
    backgroundColor: '#000',
  },
  videoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenVideoContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenVideo: {
    width: '100%',
    height: '100%',
  },
  fullscreenCloseBtn: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 8,
    borderRadius: 999,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  tagPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: BORDER_DARK + '80',
    paddingTop: 12,
  },
  actionLeft: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: BG_DARK,
    borderWidth: 1,
    borderColor: BORDER_DARK,
  },
  actionBtnText: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  ctaBtnText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  commentsSection: {
    marginTop: 12,
    gap: 8,
  },
  commentRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  commentBody: {
    flex: 1,
    backgroundColor: BG_DARK,
    borderRadius: 10,
    padding: 8,
  },
  commentName: {
    color: TEXT_MAIN,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 2,
  },
  commentText: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 17,
  },
  commentInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: BG_DARK,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: BORDER_DARK,
  },
  commentTextInput: {
    flex: 1,
    color: TEXT_MAIN,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  editModal: {
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  editModalTitle: {
    color: TEXT_MAIN,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  editTextInput: {
    backgroundColor: CARD_CHARCOAL,
    borderRadius: 12,
    padding: 14,
    color: TEXT_MAIN,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
    minHeight: 120,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: BORDER_DARK,
    marginBottom: 16,
  },
  editSaveBtn: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  editSaveBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
