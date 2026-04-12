import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Platform, Alert, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { Conversation, ROLE_LABELS, UserRole } from '@/lib/types';

const C = Colors.light;

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

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

function ConversationItem({ convo, profileId, onPress, onDelete }: {
  convo: Conversation;
  profileId: string;
  onPress: () => void;
  onDelete: () => void;
}) {
  const otherIdx = convo.participantIds[0] === profileId ? 1 : 0;
  const otherName = convo.participantNames[otherIdx];
  const otherRole = convo.participantRoles[otherIdx];
  const roleColor = ROLE_COLORS[otherRole] || C.primary;
  const hasUnread = convo.unreadCount > 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.convoItem, pressed && { backgroundColor: C.surfaceHighlight }]}
      onPress={onPress}
      onLongPress={() => {
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onDelete();
      }}
    >
      <View style={styles.avatarContainer}>
        <View style={[styles.convoAvatar, { backgroundColor: roleColor + '18' }]}>
          <Text style={[styles.convoAvatarText, { color: roleColor }]}>
            {getInitials(otherName)}
          </Text>
        </View>
        <View style={styles.onlineDot} />
      </View>

      <View style={styles.convoInfo}>
        <View style={styles.convoTopRow}>
          <Text style={[styles.convoName, hasUnread && styles.convoNameUnread]} numberOfLines={1}>
            {otherName}
          </Text>
          <Text style={[styles.convoTime, hasUnread && { color: C.primary }]}>
            {timeAgo(convo.lastMessageAt)}
          </Text>
        </View>
        <View style={styles.convoMiddleRow}>
          <View style={[styles.convoRoleBadge, { backgroundColor: roleColor + '12' }]}>
            <View style={[styles.roleDot, { backgroundColor: roleColor }]} />
            <Text style={[styles.convoRoleText, { color: roleColor }]}>
              {ROLE_LABELS[otherRole]}
            </Text>
          </View>
        </View>
        {convo.lastMessage ? (
          <Text
            style={[styles.convoLastMsg, hasUnread && styles.convoLastMsgUnread]}
            numberOfLines={1}
          >
            {convo.lastMessage}
          </Text>
        ) : (
          <Text style={styles.convoLastMsgEmpty} numberOfLines={1}>
            Start a conversation
          </Text>
        )}
      </View>

      {hasUnread && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadText}>
            {convo.unreadCount > 99 ? '99+' : convo.unreadCount}
          </Text>
        </View>
      )}
      {!hasUnread && (
        <Ionicons name="chevron-forward" size={16} color={C.textTertiary} style={{ marginLeft: 8 }} />
      )}
    </Pressable>
  );
}

export default function ChatsScreen() {
  const insets = useSafeAreaInsets();
  const { conversations, profile, deleteConversation } = useApp();
  const webTopInset = Platform.OS === 'web' ? 67 : 0;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'messages' | 'live'>('messages');
  const isCustomer = profile?.role === 'customer';

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(convo => {
      const otherIdx = convo.participantIds[0] === (profile?.id || '') ? 1 : 0;
      const otherName = convo.participantNames[otherIdx];
      return otherName.toLowerCase().includes(q);
    });
  }, [conversations, searchQuery, profile?.id]);

  const handleDelete = (convoId: string) => {
    Alert.alert(
      'Delete Conversation',
      'Are you sure you want to delete this conversation? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteConversation(convoId),
        },
      ]
    );
  };

  const handleTabPress = (tab: 'messages' | 'live') => {
    if (tab === 'live') {
      router.push('/live-chat');
    } else {
      setActiveTab('messages');
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.headerWrapper, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.headerTitle}>Chat</Text>
          <View style={{ width: 36 }} />
        </View>

        {!isCustomer && (
          <View style={styles.tabRow}>
            <Pressable
              style={[styles.tabBtn, activeTab === 'messages' && styles.tabBtnActive]}
              onPress={() => handleTabPress('messages')}
            >
              <Ionicons
                name="chatbubbles"
                size={16}
                color={activeTab === 'messages' ? '#4A6CF7' : 'rgba(255,255,255,0.7)'}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.tabText, activeTab === 'messages' && styles.tabTextActive]}>
                Messages
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tabBtn, activeTab === 'live' && styles.tabBtnActive]}
              onPress={() => handleTabPress('live')}
            >
              <Ionicons
                name="radio"
                size={16}
                color={activeTab === 'live' ? '#4A6CF7' : 'rgba(255,255,255,0.7)'}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.tabText, activeTab === 'live' && styles.tabTextActive]}>
                Live Chat
              </Text>
            </Pressable>
          </View>
        )}

        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color="rgba(255,255,255,0.6)" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search conversations..."
            placeholderTextColor="rgba(255,255,255,0.6)"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.6)" />
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={filteredConversations}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <ConversationItem
            convo={item}
            profileId={profile?.id || ''}
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
            onDelete={() => handleDelete(item.id)}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Platform.OS === 'web' ? 34 : Math.max(insets.bottom, 16) },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIconOuter}>
              <View style={styles.emptyIconInner}>
                <Ionicons name="chatbubbles-outline" size={36} color={C.primary} />
              </View>
            </View>
            <Text style={styles.emptyTitle}>
              {searchQuery ? 'No results found' : 'No conversations yet'}
            </Text>
            <Text style={styles.emptyText}>
              {searchQuery
                ? 'Try a different search term'
                : 'Start a chat from the Directory by tapping on any professional'}
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  headerWrapper: {
    backgroundColor: '#4A6CF7',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 44,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.3,
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 10,
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tabText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.7)',
  },
  tabTextActive: {
    color: '#4A6CF7',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#FFFFFF',
    height: 42,
    paddingVertical: 0,
  },
  listContent: {
    paddingTop: 6,
  },
  convoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: C.surface,
  },
  avatarContainer: {
    position: 'relative',
  },
  convoAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  convoAvatarText: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#34C759',
    borderWidth: 2.5,
    borderColor: C.surface,
  },
  convoInfo: {
    flex: 1,
    marginLeft: 14,
  },
  convoTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  convoName: {
    color: C.text,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    flex: 1,
    marginRight: 8,
  },
  convoNameUnread: {
    fontFamily: 'Inter_700Bold',
  },
  convoTime: {
    color: C.textTertiary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  convoMiddleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  convoRoleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 5,
  },
  convoRoleText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  convoLastMsg: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
  },
  convoLastMsgUnread: {
    color: C.text,
    fontFamily: 'Inter_500Medium',
  },
  convoLastMsgEmpty: {
    color: C.textTertiary,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    fontStyle: 'italic',
    marginTop: 4,
  },
  unreadBadge: {
    backgroundColor: '#4A6CF7',
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadText: {
    color: '#FFF',
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  separator: {
    height: 1,
    backgroundColor: C.borderLight,
    marginLeft: 84,
    marginRight: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyIconOuter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: C.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyIconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  emptyText: {
    color: C.textTertiary,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 21,
  },
});
