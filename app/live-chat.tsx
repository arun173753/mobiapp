import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
  Modal,
  Animated,
  Dimensions,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useApp } from '@/lib/context';
import { getApiUrl, apiRequest } from '@/lib/query-client';
import * as ImagePicker from 'expo-image-picker';
import { fetch as expoFetch } from 'expo/fetch';
import * as Haptics from 'expo-haptics';
import { playNotificationSound } from '@/lib/notification-sound';
import { openLink } from '@/lib/open-link';

const PRIMARY = '#4F46E5';
const BG = '#0F0F0F';
const SURFACE = '#1E1E1E';
const CARD = '#2A2A2A';
const BORDER = '#374151';
const TEXT_PRIMARY = '#F3F4F6';
const TEXT_SECONDARY = '#9CA3AF';
const TEXT_TERTIARY = '#6B7280';
const SCREEN_WIDTH = Dimensions.get('window').width;

const ROLE_COLORS: Record<string, string> = {
  technician: '#34C759',
  teacher: '#FFD60A',
  supplier: '#FF6B2C',
  job_provider: '#5E8BFF',
  customer: '#FF2D55',
};

const ROLE_LABELS: Record<string, string> = {
  technician: 'Technician',
  teacher: 'Teacher',
  supplier: 'Supplier',
  job_provider: 'Job Provider',
  customer: 'Customer',
};

const EMOJI_LIST = [
  '😀', '😂', '🤣', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😇',
  '🙏', '👍', '👎', '👋', '🤝', '💪', '🔥', '❤️', '💯', '🎉',
  '😢', '😡', '🤔', '😴', '🤮', '🤯', '😱', '🥺', '😏', '🙄',
  '👏', '🙌', '✌️', '🤞', '👌', '🤙', '💕', '💖', '💗', '💝',
  '⭐', '🌟', '✨', '💫', '🏆', '🎯', '🔧', '🛠️', '📱', '💻',
  '✅', '❌', '⚡', '🚀', '💡', '📌', '🔔', '💬', '👀', '🎓',
];

const GIF_STICKERS = [
  { label: 'thumbs up', emoji: '👍' },
  { label: 'clap', emoji: '👏' },
  { label: 'fire', emoji: '🔥' },
  { label: 'heart', emoji: '❤️' },
  { label: 'laugh', emoji: '😂' },
  { label: 'wow', emoji: '🤩' },
  { label: 'sad', emoji: '😢' },
  { label: 'angry', emoji: '😡' },
  { label: 'cool', emoji: '😎' },
  { label: 'party', emoji: '🥳' },
  { label: 'pray', emoji: '🙏' },
  { label: 'rocket', emoji: '🚀' },
];

interface LiveMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderAvatar: string;
  message: string;
  image: string;
  video?: string;
  createdAt: number;
}

function normalizeMsg(m: any): LiveMessage {
  let createdAt: number;
  if (typeof m.createdAt === 'number') {
    createdAt = m.createdAt;
  } else if (m.createdAt?._seconds != null) {
    createdAt = m.createdAt._seconds * 1000;
  } else if (m.createdAt?.seconds != null) {
    createdAt = m.createdAt.seconds * 1000;
  } else {
    createdAt = Date.now();
  }
  return { ...m, createdAt };
}

interface OnlineUser {
  id: string;
  name: string;
  role: string;
  avatar?: string;
}


function getInitials(name: string): string {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m} ${ampm}`;
}

function formatDateLabel(ts: number): string {
  const msgDate = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSame = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSame(msgDate, today)) return 'Today';
  if (isSame(msgDate, yesterday)) return 'Yesterday';

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[msgDate.getMonth()]} ${msgDate.getDate()}, ${msgDate.getFullYear()}`;
}

function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

type ListItem =
  | { type: 'message'; data: LiveMessage }
  | { type: 'date'; label: string; key: string };

function DateSeparator({ label }: { label: string }) {
  return (
    <View style={dateSepStyles.row}>
      <View style={dateSepStyles.pill}>
        <Text style={dateSepStyles.text}>{label}</Text>
      </View>
    </View>
  );
}

const dateSepStyles = StyleSheet.create({
  row: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
  },
  text: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: TEXT_SECONDARY,
  },
});

function ParsedMessageText({ text, isMine }: { text: string; isMine: boolean }) {
  const urlPattern = /(https?:\/\/[^\s]+)/gi;
  const parts = text.split(urlPattern);

  const hasLinks = parts.some(p => /^https?:\/\//i.test(p));
  if (!hasLinks) {
    return <Text style={[styles.msgText, isMine && { color: '#FFF' }]}>{text}</Text>;
  }

  return (
    <Text style={[styles.msgText, isMine && { color: '#FFF' }]}>
      {parts.map((part, i) => {
        if (/^https?:\/\//i.test(part)) {
          return (
            <Text
              key={i}
              style={{ color: isMine ? '#E0E8FF' : '#1A73E8', textDecorationLine: 'underline' as const }}
              onPress={() => openLink(part)}
            >
              {part}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

function VideoMessage({ uri }: { uri: string }) {
  const videoRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const resolvedUri = uri.startsWith('/') ? `${getApiUrl()}${uri}` : uri;

  return (
    <Pressable
      onPress={() => {
        if (videoRef.current) {
          if (isPlaying) {
            videoRef.current.pauseAsync();
          } else {
            videoRef.current.playAsync();
          }
          setIsPlaying(!isPlaying);
        }
      }}
      style={styles.videoContainer}
    >
      <Video
        ref={videoRef}
        source={{ uri: resolvedUri }}
        style={styles.msgVideo}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay={false}
        isLooping={false}
        useNativeControls
        onPlaybackStatusUpdate={(status: any) => {
          if (status.isLoaded) {
            setIsPlaying(status.isPlaying);
          }
        }}
      />
    </Pressable>
  );
}

function MessageItem({ msg, isMine, onLongPress, onImagePress }: { msg: LiveMessage; isMine: boolean; onLongPress?: () => void; onImagePress?: (uri: string) => void }) {
  const roleColor = ROLE_COLORS[msg.senderRole] || '#888';

  return (
    <Pressable
      onLongPress={() => {
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onLongPress?.();
      }}
      style={[styles.row, isMine && styles.rowMine]}
    >
      {!isMine && (
        <Pressable onPress={() => router.push(`/user-profile?id=${msg.senderId}`)}>
          {msg.senderAvatar ? (
            <Image
              source={{ uri: msg.senderAvatar.startsWith('http') ? msg.senderAvatar : `${getApiUrl()}${msg.senderAvatar}` }}
              style={styles.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.avatar, { backgroundColor: roleColor + '20', alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: roleColor, fontSize: 11, fontWeight: '700' as const, fontFamily: 'Inter_600SemiBold' }}>{getInitials(msg.senderName)}</Text>
            </View>
          )}
        </Pressable>
      )}
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
        {!isMine && (
          <View style={styles.senderRow}>
            <Text style={[styles.senderName, { color: roleColor }]}>{msg.senderName}</Text>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '15' }]}>
              <Text style={[styles.roleText, { color: roleColor }]}>{ROLE_LABELS[msg.senderRole] || msg.senderRole}</Text>
            </View>
          </View>
        )}
        {msg.image ? (
          <Pressable onPress={() => onImagePress?.(msg.image!.startsWith('http') ? msg.image! : `${getApiUrl()}${msg.image}`)}>
            <Image
              source={{ uri: msg.image.startsWith('http') ? msg.image : `${getApiUrl()}${msg.image}` }}
              style={styles.msgImage}
              contentFit="cover"
              transition={200}
            />
          </Pressable>
        ) : null}
        {msg.video ? (
          <VideoMessage uri={msg.video.startsWith('http') ? msg.video : `${getApiUrl()}${msg.video}`} />
        ) : null}
        {msg.message ? (
          <ParsedMessageText text={msg.message} isMine={isMine} />
        ) : null}
        <Text style={[styles.time, isMine && { color: 'rgba(255,255,255,0.7)' }]}>{formatTime(msg.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

function TypingIndicator({ name }: { name: string }) {
  const dotAnim1 = useRef(new Animated.Value(0)).current;
  const dotAnim2 = useRef(new Animated.Value(0)).current;
  const dotAnim3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createDotAnimation = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
        ])
      );

    const a1 = createDotAnimation(dotAnim1, 0);
    const a2 = createDotAnimation(dotAnim2, 150);
    const a3 = createDotAnimation(dotAnim3, 300);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={typingStyles.container}>
      <View style={typingStyles.bubble}>
        <Text style={typingStyles.text}>{name} is typing</Text>
        <View style={typingStyles.dots}>
          {[dotAnim1, dotAnim2, dotAnim3].map((anim, i) => (
            <Animated.View
              key={i}
              style={[
                typingStyles.dot,
                { opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const typingStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  text: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: PRIMARY,
    fontStyle: 'italic' as const,
  },
  dots: {
    flexDirection: 'row',
    gap: 3,
    marginLeft: 2,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: PRIMARY,
  },
});

function OnlineUsersStrip({ users, onPress }: { users: OnlineUser[]; onPress: () => void }) {
  if (users.length === 0) return null;
  return (
    <View style={stripStyles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={stripStyles.scroll}
      >
        {users.map((user) => {
          const roleColor = ROLE_COLORS[user.role] || '#888';
          return (
            <Pressable key={user.id} style={stripStyles.item} onPress={onPress}>
              <View style={stripStyles.avatarWrap}>
                {user.avatar ? (
                  <Image
                    source={{ uri: user.avatar.startsWith('http') ? user.avatar : `${getApiUrl()}${user.avatar}` }}
                    style={stripStyles.avatar}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[stripStyles.avatar, { backgroundColor: roleColor + '25', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: roleColor, fontSize: 12, fontWeight: '700' as const }}>{getInitials(user.name)}</Text>
                  </View>
                )}
                <View style={[stripStyles.dot, { borderColor: '#1A1A2E' }]} />
              </View>
              <Text style={stripStyles.name} numberOfLines={1}>{user.name.split(' ')[0]}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const stripStyles = StyleSheet.create({
  container: {
    backgroundColor: '#1A1A2E',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingBottom: 8,
  },
  scroll: {
    paddingHorizontal: 12,
    paddingTop: 6,
    gap: 4,
  },
  item: {
    alignItems: 'center',
    marginHorizontal: 6,
    width: 52,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 4,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#4ADE80',
  },
  dot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4ADE80',
    borderWidth: 2,
  },
  name: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    maxWidth: 52,
  },
});

function OnlineUserItem({ user }: { user: OnlineUser }) {
  const roleColor = ROLE_COLORS[user.role] || '#888';
  return (
    <View style={onlineStyles.item}>
      {user.avatar ? (
        <Image
          source={{ uri: user.avatar.startsWith('http') ? user.avatar : `${getApiUrl()}${user.avatar}` }}
          style={onlineStyles.avatar}
          contentFit="cover"
        />
      ) : (
        <View style={[onlineStyles.avatar, { backgroundColor: roleColor + '15', alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: roleColor, fontSize: 13, fontWeight: '700' as const, fontFamily: 'Inter_600SemiBold' }}>{getInitials(user.name)}</Text>
        </View>
      )}
      <View style={onlineStyles.info}>
        <Text style={onlineStyles.name}>{user.name}</Text>
        <View style={[onlineStyles.roleBadge, { backgroundColor: roleColor + '12' }]}>
          <Text style={[onlineStyles.roleText, { color: roleColor }]}>{ROLE_LABELS[user.role] || user.role}</Text>
        </View>
      </View>
      <View style={onlineStyles.onlineDot} />
    </View>
  );
}

const onlineStyles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: TEXT_PRIMARY,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  roleText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4ADE80',
    borderWidth: 2,
    borderColor: SURFACE,
  },
});

export default function LiveChatScreen() {
  const insets = useSafeAreaInsets();
  const { profile, resetLiveChatUnread, setLiveChatActive } = useApp();
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [text, setText] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showOnlineModal, setShowOnlineModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiTab, setEmojiTab] = useState<'emoji' | 'sticker'>('emoji');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [totalMembers, setTotalMembers] = useState<number>(0);
  const [repliesEnabled, setRepliesEnabled] = useState<boolean>(true);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const webTopInset = Platform.OS === 'web' ? 0 : 0;
  const webBottomPad = Platform.OS === 'web' ? 34 : 0;

  useFocusEffect(
    useCallback(() => {
      setLiveChatActive(true);
      resetLiveChatUnread();
      return () => {
        setLiveChatActive(false);
      };
    }, [setLiveChatActive, resetLiveChatUnread])
  );

  useEffect(() => {
    setIsLoading(true);
    console.log('[LiveChat] useEffect mounted - starting message load');

    let pollInterval: NodeJS.Timeout | null = null;

    const loadMessagesViaREST = async () => {
      try {
        console.log('[LiveChat] Fetching messages from /api/live-chat/messages');
        const res = await apiRequest('GET', '/api/live-chat/messages?limit=60');
        const data = await res.json();
        console.log('[LiveChat] API response:', data);
        
        if (Array.isArray(data)) {
          const normalized = data.map(normalizeMsg);
          console.log('[LiveChat] Normalized', normalized.length, 'messages');
          console.log('[LiveChat] First message:', normalized[0]);
          console.log('[LiveChat] Last message:', normalized[normalized.length - 1]);
          setMessages(prev => {
            console.log('[LiveChat] Setting messages state from', prev.length, 'to', normalized.length);
            return normalized;
          });
        } else {
          console.warn('[LiveChat] API returned non-array data:', typeof data);
        }
      } catch (err) {
        console.error('[LiveChat] REST API load error:', err);
      }
    };

    // ALWAYS use REST API with polling (most reliable)
    console.log('[LiveChat] Using REST API with polling strategy');
    
    // Load messages immediately
    loadMessagesViaREST().finally(() => {
      console.log('[LiveChat] Initial load complete, disabling loading state');
      setIsLoading(false);
    });
    
    // Poll every 3 seconds
    pollInterval = setInterval(() => {
      console.log('[LiveChat] Poll interval tick');
      loadMessagesViaREST();
    }, 3000);

    apiRequest('GET', '/api/community/stats')
      .then(res => res.json())
      .then(data => { if (data.totalMembers) setTotalMembers(data.totalMembers); })
      .catch(() => {});

    // HTTP-based presence
    const pingPresence = () => {
      if (!profile) return;
      apiRequest('POST', '/api/live-chat/presence', {
        userId: profile.id,
        name: profile.name,
        role: profile.role,
        avatar: profile.avatar || '',
      }).catch(() => {});
    };
    pingPresence();
    const presenceInterval = setInterval(pingPresence, 20000);

    // Poll online users every 5 seconds
    const onlineInterval = setInterval(() => {
      apiRequest('GET', '/api/live-chat/online-users')
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setOnlineUsers(data); })
        .catch(() => {});
    }, 5000);
    apiRequest('GET', '/api/live-chat/online-users')
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setOnlineUsers(data); })
      .catch(() => {});

    return () => {
      console.log('[LiveChat] useEffect cleanup');
      if (pollInterval) clearInterval(pollInterval);
      clearInterval(presenceInterval);
      clearInterval(onlineInterval);
      if (profile) {
        apiRequest('DELETE', '/api/live-chat/presence', { userId: profile.id }).catch(() => {});
      }
    };
  }, [profile]);

  const handleSend = useCallback(async () => {
    if (!text.trim() || !profile) return;
    const msgText = text.trim();
    setText('');
    
    try {
      const res = await apiRequest('POST', '/api/live-chat/messages', {
        senderId: profile.id,
        senderName: profile.name,
        senderRole: profile.role,
        senderAvatar: profile.avatar || '',
        message: msgText,
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => [...prev, normalizeMsg(data.message)]);
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      Alert.alert('Error', 'Failed to send message');
    }
  }, [text, profile]);

  const uploadWithProgress = useCallback((url: string, formData: FormData): Promise<string | null> => {
    const baseUrl = getApiUrl();
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setUploadProgress(Math.min(pct, 99));
      }
    });
    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.url) resolve(data.url);
        else resolve(null);
      } catch { resolve(null); }
    });
      xhr.addEventListener('error', () => resolve(null));
      xhr.open('POST', url);
      xhr.send(formData);
    });
  }, []);

  const uploadImage = useCallback(async (uri: string): Promise<string | null> => {
    try {
      const baseUrl = getApiUrl();
      const uploadUrl = new URL('/api/upload', baseUrl).toString();
      const formData = new FormData();

      if (Platform.OS === 'web') {
        const response = await globalThis.fetch(uri);
        const blob = await response.blob();
        formData.append('image', blob, 'chat-image.jpg');
      } else {
        const name = uri.split('/').pop() || 'chat-image.jpg';
        const type = 'image/jpeg';
        formData.append('image', { uri, name, type } as any);
      }
      return await uploadWithProgress(uploadUrl, formData);
    } catch (e) {
      console.warn('[LiveChat] Image upload failed:', e);
      return null;
    }
  }, [uploadWithProgress]);

  const handlePickImage = useCallback(async () => {
    if (!profile) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    setIsUploading(true);
    setUploadProgress(0);
    try {
      const uploadedUrl = await uploadImage(result.assets[0].uri);
      if (uploadedUrl) {
        const res = await apiRequest('POST', '/api/live-chat/messages', {
          senderId: profile.id,
          senderName: profile.name,
          senderRole: profile.role,
          senderAvatar: profile.avatar || '',
          message: '',
          image: uploadedUrl,
          video: '',
        });
        const data = await res.json();
        if (data.success && data.message) {
          setMessages(prev => [...prev, normalizeMsg(data.message)]);
        }
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      console.error('[LiveChat] Image send error:', err);
      Alert.alert('Error', 'Failed to send image');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [profile, uploadImage]);

  const uploadVideo = useCallback(async (uri: string): Promise<string | null> => {
    try {
      const baseUrl = getApiUrl();
      const uploadUrl = new URL('/api/upload-video', baseUrl).toString();
      const formData = new FormData();

      if (Platform.OS === 'web') {
        const response = await globalThis.fetch(uri);
        const blob = await response.blob();
        formData.append('video', blob, 'chat-video.mp4');
      } else {
        const name = uri.split('/').pop() || 'chat-video.mp4';
        const type = 'video/mp4';
        formData.append('video', { uri, name, type } as any);
      }
      return await uploadWithProgress(uploadUrl, formData);
    } catch (e) {
      console.warn('[LiveChat] Video upload failed:', e);
      return null;
    }
  }, [uploadWithProgress]);

  const handlePickVideo = useCallback(async () => {
    if (!profile) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 0.8,
      allowsEditing: false,
      videoMaxDuration: 120,
    });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    setIsUploading(true);
    setUploadProgress(0);
    try {
      const uploadedUrl = await uploadVideo(result.assets[0].uri);
      if (uploadedUrl) {
        const res = await apiRequest('POST', '/api/live-chat/messages', {
          senderId: profile.id,
          senderName: profile.name,
          senderRole: profile.role,
          senderAvatar: profile.avatar || '',
          message: '',
          image: '',
          video: uploadedUrl,
        });
        const data = await res.json();
        if (data.success && data.message) {
          setMessages(prev => [...prev, normalizeMsg(data.message)]);
        }
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      console.error('[LiveChat] Video send error:', err);
      Alert.alert('Error', 'Failed to send video');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [profile, uploadVideo]);

  const handleTyping = useCallback((val: string) => {
    setText(val);
  }, []);

  const handleEmojiPress = useCallback((emoji: string) => {
    setText(prev => prev + emoji);
  }, []);

  const handleStickerSend = useCallback(async (sticker: string) => {
    if (!profile) return;
    try {
      await apiRequest('POST', '/api/live-chat/messages', {
        senderId: profile.id,
        senderName: profile.name,
        senderRole: profile.role,
        senderAvatar: profile.avatar || '',
        message: sticker,
        image: '',
        video: '',
      });
      setShowEmojiPicker(false);
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.warn('Failed to send sticker:', err);
    }
  }, [profile]);

  const listData = useMemo((): ListItem[] => {
    const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
    const items: ListItem[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const msg = sorted[i];
      if (i === 0 || !isSameDay(sorted[i - 1].createdAt, msg.createdAt)) {
        items.push({ type: 'date', label: formatDateLabel(msg.createdAt), key: `date-${msg.createdAt}-${i}` });
      }
      items.push({ type: 'message', data: msg });
    }
    return items.reverse();
  }, [messages]);

  const renderItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.type === 'date') {
      return <DateSeparator label={item.label} />;
    }
    return <MessageItem
      msg={item.data}
      isMine={item.data.senderId === profile?.id}
      onImagePress={(uri) => setFullScreenImage(uri)}
      onLongPress={() => {
        if (profile?.phone === '8179142535') {
          const doDelete = async () => {
            try {
              await apiRequest('DELETE', `/api/live-chat/messages/${item.data.id}?phone=${profile.phone}`);
              setMessages(prev => prev.filter(m => m.id !== item.data.id));
              if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err) {
              Alert.alert('Error', 'Failed to delete message');
            }
          };

          if (Platform.OS === 'web') {
            if (window.confirm('Delete this message?')) doDelete();
          } else {
            Alert.alert('Delete Message', 'Do you want to delete this message?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: doDelete },
            ]);
          }
        }
      }}
    />;
  }, [profile?.id, profile?.phone]);

  const keyExtractor = useCallback((item: ListItem) => {
    if (item.type === 'date') return item.key;
    return item.data.id;
  }, []);

  const headerHeight = insets.top + 56;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top, height: headerHeight }]}>
        <View style={styles.headerRow}>
          <Pressable hitSlop={12} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </Pressable>
          <View style={styles.headerAvatar}>
            <Ionicons name="people" size={18} color="#FFF" />
          </View>
          <Pressable style={styles.headerCenter} onPress={() => setShowOnlineModal(true)}>
            <Text style={styles.headerTitle}>Technician Live Chat</Text>
            <Text style={styles.headerSub}>
              {onlineUsers.length} online now • {totalMembers} total members
            </Text>
          </Pressable>
          <Pressable hitSlop={12} onPress={() => {
            console.log('Online Users:', onlineUsers);
            setShowOnlineModal(true);
          }}>
            <Ionicons name="people-outline" size={22} color="#FFF" />
          </Pressable>
          {profile?.phone === '8179142535' && (
            <Pressable
              hitSlop={12}
              onPress={async () => {
                const confirmed = Platform.OS === 'web'
                  ? window.confirm('This will permanently delete all messages for everyone. This cannot be undone.\n\nAre you sure?')
                  : await new Promise<boolean>(resolve => {
                      Alert.alert(
                        'Clear All Chat',
                        'This will permanently delete all messages for everyone. This cannot be undone.',
                        [
                          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                          { text: 'Clear All', style: 'destructive', onPress: () => resolve(true) }
                        ]
                      );
                    });
                
                if (!confirmed) return;

                try {
                  const res = await apiRequest('DELETE', `/api/live-chat/clear?adminPhone=${profile.phone}`);
                  const data = await res.json();
                  if (data.success) {
                    setMessages([]);
                    const msg = 'All chat messages have been cleared.';
                    if (Platform.OS === 'web') {
                      alert(msg);
                    } else {
                      Alert.alert('Done', msg);
                    }
                  } else {
                    const errMsg = data.message || 'Failed to clear chat';
                    if (Platform.OS === 'web') {
                      alert('Error: ' + errMsg);
                    } else {
                      Alert.alert('Error', errMsg);
                    }
                  }
                } catch (e) {
                  const msg = 'Failed to clear chat';
                  if (Platform.OS === 'web') {
                    alert('Error: ' + msg);
                  } else {
                    Alert.alert('Error', msg);
                  }
                }
              }}
              style={{ marginLeft: 6 }}
            >
              <Ionicons name="trash-outline" size={22} color="#FF4B4B" />
            </Pressable>
          )}
        </View>
      </View>

      <OnlineUsersStrip users={onlineUsers} onPress={() => setShowOnlineModal(true)} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={0}
      >

      <View style={{ flex: 1, position: 'relative' }}>
        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={PRIMARY} />
          </View>
        ) : !repliesEnabled && profile?.phone !== '8179142535' ? (
          <View style={[styles.center, { flex: 1, padding: 40 }]}>
            <View style={{ backgroundColor: 'rgba(79,70,229,0.15)', padding: 20, borderRadius: 20, marginBottom: 20 }}>
              <Ionicons name="chatbubble-ellipses-outline" size={60} color={PRIMARY} />
            </View>
            <Text style={{ fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY, textAlign: 'center', marginBottom: 12 }}>Live Chat is Offline</Text>
            <Text style={{ fontSize: 16, color: TEXT_SECONDARY, textAlign: 'center', lineHeight: 24, marginBottom: 24 }}>The admin has temporarily disabled the community chat. Please check back later.</Text>
            <Pressable onPress={() => router.back()} style={{ backgroundColor: PRIMARY, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}>
              <Text style={{ color: '#FFF', fontWeight: '600' }}>Go Back</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={listData}
            keyExtractor={keyExtractor}
            inverted
            contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6, flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            removeClippedSubviews={Platform.OS !== 'web'}
            maxToRenderPerBatch={10}
            windowSize={10}
            initialNumToRender={15}
            renderItem={renderItem}
            ListHeaderComponent={
              typingUser ? <TypingIndicator name={typingUser} /> : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="chatbubbles-outline" size={44} color={PRIMARY} />
                </View>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptySubtitle}>Start the conversation with the community</Text>
              </View>
            }
          />
        )}
      </View>

      {showEmojiPicker && (
        <View style={styles.emojiPanel}>
          <View style={styles.emojiTabRow}>
            <Pressable
              style={[styles.emojiTabBtn, emojiTab === 'emoji' && styles.emojiTabBtnActive]}
              onPress={() => setEmojiTab('emoji')}
            >
              <Ionicons name="happy-outline" size={20} color={emojiTab === 'emoji' ? PRIMARY : TEXT_TERTIARY} />
              <Text style={[styles.emojiTabText, emojiTab === 'emoji' && { color: PRIMARY }]}>Emoji</Text>
            </Pressable>
            <Pressable
              style={[styles.emojiTabBtn, emojiTab === 'sticker' && styles.emojiTabBtnActive]}
              onPress={() => setEmojiTab('sticker')}
            >
              <MaterialCommunityIcons name="sticker-emoji" size={20} color={emojiTab === 'sticker' ? PRIMARY : TEXT_TERTIARY} />
              <Text style={[styles.emojiTabText, emojiTab === 'sticker' && { color: PRIMARY }]}>Stickers</Text>
            </Pressable>
          </View>

          {emojiTab === 'emoji' ? (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.emojiGrid}
            >
              {EMOJI_LIST.map((emoji, i) => (
                <Pressable
                  key={i}
                  style={styles.emojiItem}
                  onPress={() => handleEmojiPress(emoji)}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.stickerGrid}
            >
              {GIF_STICKERS.map((sticker, i) => (
                <Pressable
                  key={i}
                  style={styles.stickerItem}
                  onPress={() => handleStickerSend(sticker.emoji)}
                >
                  <Text style={styles.stickerEmoji}>{sticker.emoji}</Text>
                  <Text style={styles.stickerLabel}>{sticker.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      <View style={[styles.inputBar, { paddingBottom: Platform.OS === 'web' ? webBottomPad : Math.max(insets.bottom, 6) }]}>
        {!repliesEnabled && profile?.phone !== '8179142535' ? (
          <View style={{ paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' }} />
              <Text style={{ color: '#FF3B30', fontSize: 15, fontWeight: '700' }}>Live Chat is Offline</Text>
            </View>
            <Text style={{ color: TEXT_SECONDARY, fontSize: 13, textAlign: 'center' }}>You cannot send messages while chat is disabled by admin.</Text>
          </View>
        ) : profile?.role !== 'technician' && profile?.phone !== '8179142535' ? (
          <View style={{ paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Ionicons name="eye-outline" size={18} color={TEXT_SECONDARY} />
              <Text style={{ color: TEXT_PRIMARY, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>View Only</Text>
            </View>
            <Text style={{ color: TEXT_SECONDARY, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>Only technicians can send messages in this chat.</Text>
          </View>
        ) : (
          <>
            <View style={styles.inputContainer}>
              <Pressable style={styles.iconBtn} onPress={() => setShowEmojiPicker(!showEmojiPicker)}>
                <Ionicons name={showEmojiPicker ? "keypad" : "happy-outline"} size={24} color={PRIMARY} />
              </Pressable>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="Type a message..."
                placeholderTextColor={TEXT_TERTIARY}
                value={text}
                onChangeText={handleTyping}
                multiline
                maxLength={1000}
                onFocus={() => setShowEmojiPicker(false)}
              />
              <Pressable style={styles.iconBtn} onPress={handlePickImage}>
                <Ionicons name="image-outline" size={24} color={PRIMARY} />
              </Pressable>
              <Pressable style={styles.iconBtn} onPress={handlePickVideo}>
                <Ionicons name="videocam-outline" size={24} color={PRIMARY} />
              </Pressable>
              <Pressable 
                style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]} 
                onPress={handleSend}
                disabled={!text.trim()}
              >
                <Ionicons name="send" size={20} color="#FFF" />
              </Pressable>
            </View>
          </>
        )}
      </View>
      </KeyboardAvoidingView>

      <Modal visible={!!fullScreenImage} transparent animationType="fade">
        <Pressable style={styles.modalBg} onPress={() => setFullScreenImage(null)}>
          <Image source={{ uri: fullScreenImage || '' }} style={styles.fullImage} contentFit="contain" />
          <Pressable style={styles.closeBtn} onPress={() => setFullScreenImage(null)}>
            <Ionicons name="close" size={28} color="#FFF" />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showOnlineModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Online Members ({onlineUsers.length})</Text>
              <Pressable onPress={() => setShowOnlineModal(false)}>
                <Ionicons name="close" size={24} color={TEXT_PRIMARY} />
              </Pressable>
            </View>
            <FlatList
              data={onlineUsers}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <OnlineUserItem user={item} />}
              contentContainerStyle={{ paddingBottom: 20 }}
            />
          </View>
        </View>
      </Modal>

      {isUploading && (
        <View style={styles.uploadOverlay}>
          <ActivityIndicator size="large" color="#FFF" />
          <Text style={styles.uploadText}>Uploading... {uploadProgress}%</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    backgroundColor: PRIMARY,
    justifyContent: 'center',
    paddingHorizontal: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
  },
  headerSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.8)',
  },
  loadingWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG,
  },
  inputBar: {
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    gap: 4,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: '#2A2A2A',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: TEXT_PRIMARY,
    fontFamily: 'Inter_400Regular',
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#374151',
  },
  row: {
    flexDirection: 'row',
    marginBottom: 12,
    paddingHorizontal: 8,
    gap: 8,
  },
  rowMine: {
    flexDirection: 'row-reverse',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginTop: 4,
  },
  bubble: {
    maxWidth: SCREEN_WIDTH * 0.75,
    padding: 12,
    borderRadius: 18,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  bubbleMine: {
    backgroundColor: PRIMARY,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: SURFACE,
    borderBottomLeftRadius: 4,
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  senderName: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  roleText: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
  },
  msgText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: TEXT_PRIMARY,
    lineHeight: 20,
  },
  msgImage: {
    width: SCREEN_WIDTH * 0.6,
    height: 200,
    borderRadius: 12,
    marginBottom: 6,
  },
  time: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: TEXT_TERTIARY,
    marginTop: 4,
    textAlign: 'right',
  },
  modalBg: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  closeBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: TEXT_PRIMARY,
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  uploadText: {
    color: '#FFF',
    marginTop: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  emojiPanel: {
    height: 280,
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  emojiTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  emojiTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  emojiTabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: PRIMARY,
  },
  emojiTabText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: TEXT_TERTIARY,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
  },
  emojiItem: {
    width: '12.5%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: {
    fontSize: 24,
  },
  stickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
  },
  stickerItem: {
    width: '25%',
    padding: 8,
    alignItems: 'center',
  },
  stickerEmoji: {
    fontSize: 32,
    marginBottom: 4,
  },
  stickerLabel: {
    fontSize: 10,
    color: TEXT_SECONDARY,
    fontFamily: 'Inter_500Medium',
  },
  videoContainer: {
    width: SCREEN_WIDTH * 0.6,
    height: 150,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginBottom: 6,
  },
  msgVideo: {
    flex: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 60,
  },
  emptyIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(79,70,229,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: TEXT_PRIMARY,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 20,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
