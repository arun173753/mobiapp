import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { ChatMessage, ROLE_LABELS, UserRole } from '@/lib/types';
import MediaViewer from '@/components/MediaViewer';
import { playNotificationSound } from '@/lib/notification-sound';

const ROLE_COLORS: Record<UserRole, string> = {
  technician: '#34C759',
  teacher: '#FFD60A',
  supplier: '#FF6B2C',
  job_provider: '#5E8BFF',
  customer: '#FF2D55',
  shopkeeper: '#8B5CF6',
  admin: '#8B5CF6',
};

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hours = d.getHours();
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${mins} ${ampm}`;
}

function formatDateLabel(ts: number): string {
  const msgDate = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(msgDate, today)) return 'Today';
  if (isSameDay(msgDate, yesterday)) return 'Yesterday';

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[msgDate.getMonth()]} ${msgDate.getDate()}`;
}

function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

type ListItem =
  | { type: 'message'; data: ChatMessage }
  | { type: 'date'; label: string; key: string };

function DateSeparator({ label }: { label: string }) {
  return (
    <View style={styles.dateSeparatorRow}>
      <View style={styles.datePill}>
        <Text style={styles.datePillText}>{label}</Text>
      </View>
    </View>
  );
}

function MessageBubble({
  msg,
  isMine,
  senderRole,
  onImagePress,
}: {
  msg: ChatMessage;
  isMine: boolean;
  senderRole: UserRole;
  onImagePress?: (url: string) => void;
}) {
  const hasImage = msg.image && msg.image.length > 0 && !msg.image.startsWith('file://');
  const hasText = msg.text && msg.text.length > 0;

  if (!hasImage && !hasText) return null;

  const roleColor = ROLE_COLORS[senderRole] || '#4A6CF7';

  return (
    <View style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}>
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
        {!isMine && (
          <Text style={[styles.senderName, { color: roleColor }]}>
            {msg.senderName}
          </Text>
        )}
        {hasImage && (
          <Pressable onPress={() => onImagePress?.(msg.image!)}>
            <Image
              source={{ uri: msg.image }}
              style={styles.messageImage}
              contentFit="cover"
              transition={200}
            />
          </Pressable>
        )}
        {hasText && (
          <Text style={[styles.bubbleText, isMine ? styles.bubbleTextMine : styles.bubbleTextOther]}>
            {msg.text}
          </Text>
        )}
        <View style={styles.bubbleFooter}>
          <Text style={[styles.bubbleTime, isMine ? styles.bubbleTimeMine : styles.bubbleTimeOther]}>
            {formatTime(msg.createdAt)}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function ChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { conversations, profile, sendMessage, loadMessages, pollMessages, setActiveChatId } = useApp();
  const [text, setText] = useState('');
  const [viewerMedia, setViewerMedia] = useState<{ type: 'image' | 'video'; url: string } | null>(null);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMsgs, setIsLoadingMsgs] = useState(true);
  const inputRef = useRef<TextInput>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgTsRef = useRef<number>(0);

  const convo = conversations.find(c => c.id === id);
  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const otherIdx = convo ? (convo.participantIds[0] === profile?.id ? 1 : 0) : 0;
  const otherName = convo?.participantNames[otherIdx] || 'User';
  const otherRole = convo?.participantRoles[otherIdx] || ('technician' as UserRole);
  const roleColor = ROLE_COLORS[otherRole] || '#4A6CF7';

  useEffect(() => {
    if (!id) return;

    setActiveChatId(id);

    const load = async () => {
      setIsLoadingMsgs(true);
      const msgs = await loadMessages(id);
      setLocalMessages(msgs);
      if (msgs.length > 0) {
        lastMsgTsRef.current = msgs[msgs.length - 1].createdAt;
      }
      setIsLoadingMsgs(false);
    };
    load();

    pollingRef.current = setInterval(async () => {
      const newMsgs = await pollMessages(id, lastMsgTsRef.current);
      if (newMsgs.length > 0) {
        setLocalMessages(prev => {
          const withoutTemp = prev.filter(m => !m.id.startsWith('temp_'));
          const existingIds = new Set(withoutTemp.map(m => m.id));
          const unique = newMsgs.filter(m => !existingIds.has(m.id));
          if (unique.length === 0) return prev;
          const incomingNew = unique.filter(m => m.senderId !== profile?.id);
          if (incomingNew.length > 0) {
            playNotificationSound();
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          const updated = [...withoutTemp, ...unique];
          lastMsgTsRef.current = updated[updated.length - 1].createdAt;
          return updated;
        });
      }
    }, 2000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setActiveChatId(null);
    };
  }, [id]);

  const listData = useMemo(() => {
    const sorted = [...localMessages].sort((a, b) => a.createdAt - b.createdAt);
    const items: ListItem[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const msg = sorted[i];
      const prev = i > 0 ? sorted[i - 1] : null;
      if (!prev || !isSameDay(prev.createdAt, msg.createdAt)) {
        const label = formatDateLabel(msg.createdAt);
        items.push({ type: 'date', label, key: `date_${msg.createdAt}` });
      }
      items.push({ type: 'message', data: msg });
    }

    return items.reverse();
  }, [localMessages]);

  const handleSend = useCallback(async () => {
    if (!text.trim() || !id) return;
    const msgText = text.trim();
    setText('');
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const tempId = 'temp_' + Date.now().toString();
    const tempMsg: ChatMessage = {
      id: tempId,
      senderId: profile?.id || '',
      senderName: profile?.name || '',
      text: msgText,
      createdAt: Date.now(),
    };
    setLocalMessages(prev => [...prev, tempMsg]);
    lastMsgTsRef.current = tempMsg.createdAt;

    await sendMessage(id, msgText);

    const serverMsgs = await pollMessages(id, tempMsg.createdAt - 5000);
    if (serverMsgs.length > 0) {
      setLocalMessages(prev => {
        const withoutTemp = prev.filter(m => !m.id.startsWith('temp_'));
        const existingIds = new Set(withoutTemp.map(m => m.id));
        const newUnique = serverMsgs.filter(m => !existingIds.has(m.id));
        const updated = [...withoutTemp, ...newUnique];
        if (updated.length > 0) {
          lastMsgTsRef.current = updated[updated.length - 1].createdAt;
        }
        return updated;
      });
    }

    inputRef.current?.focus();
  }, [text, id, profile, sendMessage, pollMessages]);

  const [isUploading, setIsUploading] = useState(false);

  const uploadImage = useCallback(async (uri: string): Promise<string | null> => {
    try {
      const baseUrl = getApiUrl();
      const uploadUrl = new URL('/api/upload', baseUrl).toString();

      if (Platform.OS === 'web') {
        const formData = new FormData();
        try {
          const response = await window.fetch(uri, { mode: 'no-cors' });
          const blob = await response.blob();
          formData.append('image', blob, 'photo.jpg');
        } catch {
          try {
            const response = await window.fetch(uri);
            const blob = await response.blob();
            formData.append('image', blob, 'photo.jpg');
          } catch {
            const blob = new Blob([uri], { type: 'image/jpeg' });
            formData.append('image', blob, 'photo.jpg');
          }
        }
        const uploadRes = await window.fetch(uploadUrl, { method: 'POST', body: formData });
        const data = await uploadRes.json();
        if (data.success && data.url) return new URL(data.url, baseUrl).toString();
        return null;
      } else {
        const formData = new FormData();
        formData.append('image', {
          uri: uri,
          name: 'photo.jpg',
          type: 'image/jpeg',
        } as any);
        const uploadRes = await globalThis.fetch(uploadUrl, { method: 'POST', body: formData as any });
        const data = await uploadRes.json();
        if (data.success && data.url) return new URL(data.url, baseUrl).toString();
        return null;
      }
    } catch (e) {
      console.error('[Upload] Failed:', e);
      return null;
    }
  }, []);

  const handleSendImage = useCallback(async () => {
    if (!id) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets) {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsUploading(true);
      const serverUrl = await uploadImage(result.assets[0].uri);
      setIsUploading(false);
      if (serverUrl) {
        await sendMessage(id, '', serverUrl);
      } else {
        Alert.alert('Upload Failed', 'Could not upload image. Please try again.');
      }
    }
  }, [id, sendMessage, uploadImage]);

  const handleTakePhoto = useCallback(async () => {
    if (!id) return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets) {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsUploading(true);
      const serverUrl = await uploadImage(result.assets[0].uri);
      setIsUploading(false);
      if (serverUrl) {
        await sendMessage(id, '', serverUrl);
      } else {
        Alert.alert('Upload Failed', 'Could not upload image. Please try again.');
      }
    }
  }, [id, sendMessage, uploadImage]);

  if (!convo) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>Conversation not found</Text>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#666666" />
        </Pressable>
      </View>
    );
  }

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'date') {
      return <DateSeparator label={item.label} />;
    }
    return (
      <MessageBubble
        msg={item.data}
        isMine={item.data.senderId === profile?.id}
        senderRole={item.data.senderId === profile?.id ? (profile?.role || 'technician') : otherRole}
        onImagePress={(url) => setViewerMedia({ type: 'image', url })}
      />
    );
  };

  const getItemKey = (item: ListItem) => {
    if (item.type === 'date') return item.key;
    return item.data.id;
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={[styles.headerAvatar, { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.3)' }]}>
          <Text style={styles.headerAvatarText}>
            {getInitials(otherName)}
          </Text>
        </View>
        <View style={styles.headerInfo}>
          <View style={styles.headerNameRow}>
            <Text style={styles.headerName} numberOfLines={1}>{otherName}</Text>
            <View style={[styles.roleBadge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <Text style={styles.roleBadgeText}>{ROLE_LABELS[otherRole]}</Text>
            </View>
          </View>
          <Text style={styles.onlineText}>Online</Text>
        </View>
      </View>

      {isLoadingMsgs ? (
        <View style={[styles.messagesArea, styles.center]}>
          <ActivityIndicator size="large" color="#4A6CF7" />
        </View>
      ) : (
        <FlatList
          data={listData}
          inverted
          keyExtractor={getItemKey}
          renderItem={renderItem}
          contentContainerStyle={styles.messagesList}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.messagesArea}
        />
      )}

      <View style={[styles.inputBar, { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 8) }]}>
        <View style={styles.inputRow}>
          <Pressable onPress={handleTakePhoto} hitSlop={8} style={styles.attachBtn} disabled={isUploading}>
            <Ionicons name="camera" size={20} color="#999999" />
          </Pressable>
          <Pressable onPress={handleSendImage} hitSlop={8} style={styles.attachBtn} disabled={isUploading}>
            {isUploading ? (
              <ActivityIndicator size="small" color="#4A6CF7" />
            ) : (
              <Ionicons name="attach" size={22} color="#999999" />
            )}
          </Pressable>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor="#999999"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={500}
          />
          <Pressable
            onPress={handleSend}
            disabled={!text.trim()}
            style={[styles.sendBtn, !!text.trim() && styles.sendBtnActive]}
          >
            <Ionicons name="send" size={18} color={text.trim() ? '#FFF' : '#CCCCCC'} />
          </Pressable>
        </View>
        {isUploading && (
          <View style={styles.uploadIndicator}>
            <ActivityIndicator size="small" color="#4A6CF7" />
            <Text style={styles.uploadText}>Uploading image...</Text>
          </View>
        )}
      </View>

      <MediaViewer
        visible={!!viewerMedia}
        onClose={() => setViewerMedia(null)}
        imageUrl={viewerMedia?.type === 'image' ? viewerMedia.url : undefined}
        videoUrl={viewerMedia?.type === 'video' ? viewerMedia.url : undefined}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#666666',
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#4A6CF7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  backBtn: {
    marginRight: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  headerAvatarText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  headerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    flexShrink: 1,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  roleBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  onlineText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  messagesArea: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  dateSeparatorRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 14,
  },
  datePill: {
    backgroundColor: 'rgba(0,0,0,0.06)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
  },
  datePillText: {
    color: '#8E8E93',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 6,
    justifyContent: 'flex-start',
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 2,
  },
  bubbleMine: {
    backgroundColor: '#4A6CF7',
    borderTopRightRadius: 18,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: '#FFFFFF',
    borderTopRightRadius: 18,
    borderTopLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  senderName: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 3,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  bubbleTextMine: {
    color: '#FFFFFF',
  },
  bubbleTextOther: {
    color: '#1A1A1A',
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  bubbleTime: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
  },
  bubbleTimeMine: {
    color: 'rgba(255,255,255,0.6)',
  },
  bubbleTimeOther: {
    color: '#B0B0B0',
  },
  messageImage: {
    width: 220,
    height: 160,
    borderRadius: 12,
    marginBottom: 4,
  },
  inputBar: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: '#E5E5EA',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#F2F2F7',
    borderRadius: 25,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
  },
  attachBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    color: '#1A1A1A',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    paddingVertical: 6,
    paddingHorizontal: 6,
    maxHeight: 100,
    lineHeight: 20,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnActive: {
    backgroundColor: '#4A6CF7',
  },
  uploadIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  uploadText: {
    color: '#4A6CF7',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
});
