import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, Pressable, ActivityIndicator, Alert, Platform,
  RefreshControl, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { getApiUrl, apiRequest } from '@/lib/query-client';

const C = Colors.light;

function getImageUri(img: string): string {
  if (img.startsWith('/')) return `${getApiUrl()}${img}`;
  return img;
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

export default function MyPostsScreen() {
  const insets = useSafeAreaInsets();
  const { profile, posts, refreshData } = useApp();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const myPosts = useMemo(() => {
    if (!profile?.id) return [];
    return posts
      .filter(p => p.userId === profile.id)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [posts, profile?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  };

  const handleDeletePost = (postId: string) => {
    const doDelete = async () => {
      try {
        setDeletingId(postId);
        const res = await apiRequest('DELETE', `/api/posts/${postId}`);
        const data = await res.json();
        if (data.success || res.status === 404) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await refreshData();
        } else {
          Alert.alert('Error', data.message || 'Failed to delete post');
        }
      } catch (error) {
        Alert.alert('Error', 'Failed to delete post');
      } finally {
        setDeletingId(null);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to delete this post?')) doDelete();
    } else {
      Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const renderPost = ({ item }: { item: any }) => {
    if (!item) return null;
    
    return (
      <View style={styles.postCard}>
        {/* Header */}
        <View style={styles.postHeader}>
          {item.userAvatar ? (
            <Image
              source={{ uri: getImageUri(item.userAvatar) }}
              style={styles.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {item.userName?.charAt(0).toUpperCase() || 'U'}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{item.userName}</Text>
            <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
          </View>
          <Pressable
            onPress={() => handleDeletePost(item.id)}
            disabled={deletingId === item.id}
            style={styles.deleteBtn}
          >
            {deletingId === item.id ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Ionicons name="trash-outline" size={18} color="#EF4444" />
            )}
          </Pressable>
        </View>

        {/* Text */}
        <Text style={styles.postText}>{item.text}</Text>

        {/* Images */}
        {item.images && item.images.length > 0 && (
          <View style={styles.imagesContainer}>
            {item.images.slice(0, 3).map((img: string, idx: number) => (
              <View key={idx} style={styles.imageWrapper}>
                <Image
                  source={{ uri: getImageUri(img) }}
                  style={styles.postImage}
                  contentFit="cover"
                />
                {idx === 2 && item.images.length > 3 && (
                  <View style={styles.moreOverlay}>
                    <Text style={styles.moreText}>+{item.images.length - 3}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Engagement */}
        <View style={styles.engagementBar}>
          <View style={styles.engagementItem}>
            <Ionicons name="heart" size={16} color="#EF4444" />
            <Text style={styles.engagementText}>{item.likes?.length || 0}</Text>
          </View>
          <View style={styles.engagementItem}>
            <Ionicons name="chatbubble" size={16} color="#4F46E5" />
            <Text style={styles.engagementText}>{item.comments?.length || 0}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>My Posts</Text>
        <View style={{ width: 24 }} />
      </View>

      {myPosts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="document-outline" size={48} color={C.textTertiary} />
          <Text style={styles.emptyText}>No posts yet</Text>
          <Text style={styles.emptySubtext}>Share your first post to get started</Text>
        </View>
      ) : (
        <FlatList
          data={myPosts}
          renderItem={renderPost}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          scrollEnabled={myPosts.length > 0}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 32,
  },
  postCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  avatarPlaceholder: {
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  timestamp: {
    fontSize: 12,
    color: C.textTertiary,
    marginTop: 2,
  },
  deleteBtn: {
    padding: 8,
    marginLeft: 8,
  },
  postText: {
    fontSize: 15,
    color: C.text,
    lineHeight: 22,
    marginBottom: 12,
  },
  imagesContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  imageWrapper: {
    position: 'relative',
  },
  postImage: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  moreOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  engagementBar: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  engagementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  engagementText: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: C.textTertiary,
    marginTop: 6,
    textAlign: 'center',
  },
});
