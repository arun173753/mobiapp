import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  FlatList, ActivityIndicator, Dimensions, RefreshControl, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { UserProfile, Course } from '@/lib/types';

const ORANGE = '#FF6B2C';
const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

function getImageUri(img: string): string {
  if (img.startsWith('/')) return `${getApiUrl()}${img}`;
  return img;
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function TeacherStoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile: myProfile, startConversation } = useApp();

  const [teacher, setTeacher] = useState<UserProfile | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [following, setFollowing] = useState(false);

  const webTopInset = Platform.OS === 'web' ? 67 : 0;
  const topInset = Platform.OS === 'web' ? webTopInset : insets.top;

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, coursesRes] = await Promise.all([
        apiRequest('GET', `/api/profiles/${id}`),
        apiRequest('GET', `/api/courses?teacherId=${id}`),
      ]);
      const profileData = await profileRes.json();
      if (profileData && profileData.id) setTeacher(profileData);

      const teacherCourses: Course[] = await coursesRes.json();
      setCourses(teacherCourses);
    } catch (e) {
      console.error('[TeacherStore] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const handleMessage = async () => {
    if (!myProfile || !teacher) return;
    const convoId = await startConversation(teacher.id, teacher.name, teacher.role);
    if (convoId) router.push({ pathname: '/chat/[id]', params: { id: convoId } });
  };

  const openUploadLink = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/admin/links');
      const data = await res.json();
      const uploadLink = data?.upload_video_link;
      if (uploadLink) {
        await WebBrowser.openBrowserAsync(uploadLink);
      } else {
        Alert.alert('Upload Link Not Set', 'The upload link has not been configured yet.');
      }
    } catch (e) {
      console.error('[Upload] Error:', e);
      Alert.alert('Error', 'Unable to open upload link');
    }
  }, []);

  const totalStudents = useMemo(() => {
    return courses.reduce((sum, c) => sum + (c.enrollmentCount || 0), 0);
  }, [courses]);

  const isMe = myProfile?.id === id;

  const renderCourseCard = ({ item }: { item: Course }) => {
    const coverUri = item.coverImage ? getImageUri(item.coverImage) : null;
    return (
      <Pressable
        style={s.card}
        onPress={() => router.push({ pathname: '/course-detail', params: { courseId: item.id } })}
      >
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={s.cardImage} contentFit="cover" />
        ) : (
          <View style={s.cardImagePlaceholder}>
            <Ionicons name="school-outline" size={32} color="#ccc" />
          </View>
        )}
        <View style={s.cardBody}>
          <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={s.cardPrice}>{'\u20B9'}{item.price}</Text>
          <View style={s.cardMeta}>
            <View style={s.metaItem}>
              <Ionicons name="people-outline" size={12} color="#999" />
              <Text style={s.metaText}>{item.enrollmentCount}</Text>
            </View>
            <View style={s.metaItem}>
              <Ionicons name="videocam-outline" size={12} color="#999" />
              <Text style={s.metaText}>{item.totalVideos}</Text>
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  const ListHeader = () => {
    if (!teacher) return null;
    return (
      <View style={s.headerSection}>
        {teacher.avatar ? (
          <Image source={{ uri: getImageUri(teacher.avatar) }} style={s.avatar} contentFit="cover" />
        ) : (
          <View style={s.avatarFallback}>
            <Text style={s.avatarInitials}>{getInitials(teacher.name)}</Text>
          </View>
        )}

        <Text style={s.teacherName}>{teacher.name}</Text>

        {teacher.teachType ? (
          <View style={s.badge}>
            <Text style={s.badgeText}>{teacher.teachType} Repair</Text>
          </View>
        ) : null}

        <View style={s.locationRow}>
          <Ionicons name="location-outline" size={14} color="#999" />
          <Text style={s.locationText}>
            {teacher.city}{teacher.state ? `, ${teacher.state}` : ''}
          </Text>
        </View>

        <View style={s.statsRow}>
          <View style={s.statItem}>
            <Text style={s.statValue}>{courses.length}</Text>
            <Text style={s.statLabel}>Courses</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Text style={s.statValue}>{totalStudents}</Text>
            <Text style={s.statLabel}>Students</Text>
          </View>
        </View>

        {isMe ? (
          <Pressable style={s.uploadBtn} onPress={() => openUploadLink()}>
            <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
            <Text style={s.uploadBtnText}>Upload Videos</Text>
          </Pressable>
        ) : (
          <View style={s.actionRow}>
            <Pressable
              style={[s.actionBtn, following && s.actionBtnFollowing]}
              onPress={() => setFollowing(!following)}
            >
              <Ionicons
                name={following ? 'checkmark' : 'person-add-outline'}
                size={16}
                color={following ? '#fff' : ORANGE}
              />
              <Text style={[s.actionBtnText, following && s.actionBtnTextFollowing]}>
                {following ? 'Following' : 'Follow'}
              </Text>
            </Pressable>
            <Pressable style={s.messageBtn} onPress={handleMessage}>
              <Ionicons name="chatbubble-outline" size={16} color="#fff" />
              <Text style={s.messageBtnText}>Message</Text>
            </Pressable>
          </View>
        )}

        <Text style={s.sectionTitle}>Courses by {teacher.name}</Text>
      </View>
    );
  };

  const ListEmpty = () => (
    <View style={s.emptyState}>
      <Ionicons name="school-outline" size={48} color="#ccc" />
      <Text style={s.emptyText}>No courses yet</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={ORANGE} />
      </View>
    );
  }

  if (!teacher) {
    return (
      <View style={[s.container, s.center]}>
        <Ionicons name="person-outline" size={48} color="#ccc" />
        <Text style={s.emptyText}>Teacher not found</Text>
        <Pressable onPress={() => router.back()} style={s.goBackBtn}>
          <Text style={s.goBackText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={[s.topBar, { paddingTop: topInset + 8 }]}>
        <Pressable hitSlop={14} onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </Pressable>
        <Text style={s.topTitle} numberOfLines={1}>{teacher.name}</Text>
        <View style={{ width: 34 }} />
      </View>

      <FlatList
        data={courses}
        keyExtractor={item => item.id}
        numColumns={2}
        columnWrapperStyle={courses.length > 0 ? s.columnWrapper : undefined}
        contentContainerStyle={[s.listContent, { paddingTop: topInset + 56 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<ListHeader />}
        ListEmptyComponent={<ListEmpty />}
        renderItem={renderCourseCard}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ORANGE} colors={[ORANGE]} />
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { justifyContent: 'center', alignItems: 'center' },

  topBar: {
    position: 'absolute' as const, top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  backBtn: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  topTitle: { color: '#222', fontSize: 17, fontWeight: '700' as const, flex: 1, textAlign: 'center' as const },

  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  columnWrapper: { gap: 16, marginBottom: 16 },

  headerSection: { alignItems: 'center', marginBottom: 24 },

  avatar: {
    width: 90, height: 90, borderRadius: 45, marginBottom: 14,
    borderWidth: 3, borderColor: ORANGE + '30',
  },
  avatarFallback: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: ORANGE + '15', justifyContent: 'center', alignItems: 'center',
    marginBottom: 14,
  },
  avatarInitials: { fontSize: 32, fontWeight: '700' as const, color: ORANGE },

  teacherName: { fontSize: 24, fontWeight: '700' as const, color: '#222', marginBottom: 8 },

  badge: {
    backgroundColor: ORANGE + '15',
    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 14,
    marginBottom: 8,
  },
  badgeText: { color: ORANGE, fontSize: 13, fontWeight: '600' as const },

  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 },
  locationText: { color: '#888', fontSize: 14 },

  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F8F8F8', borderRadius: 14, paddingVertical: 16,
    marginBottom: 16, width: '100%',
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700' as const, color: '#222' },
  statLabel: { fontSize: 12, color: '#999', marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: '#E5E5E5' },

  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 20, width: '100%' },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 2, borderColor: ORANGE, borderRadius: 12, height: 44,
  },
  actionBtnFollowing: { backgroundColor: ORANGE, borderColor: ORANGE },
  actionBtnText: { fontSize: 14, fontWeight: '600' as const, color: ORANGE },
  actionBtnTextFollowing: { color: '#fff' },
  messageBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: ORANGE, borderRadius: 12, height: 44,
  },
  messageBtnText: { fontSize: 14, fontWeight: '600' as const, color: '#fff' },

  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: ORANGE, borderRadius: 12, height: 44, marginBottom: 20, width: '100%',
  },
  uploadBtnText: { fontSize: 14, fontWeight: '600' as const, color: '#fff' },

  sectionTitle: {
    fontSize: 18, fontWeight: '700' as const, color: '#222',
    alignSelf: 'flex-start', marginBottom: 16,
  },

  card: {
    width: CARD_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden' as const,
    borderWidth: 1, borderColor: '#F7F7F7',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardImage: { width: '100%' as const, height: CARD_WIDTH * 0.6 },
  cardImagePlaceholder: {
    width: '100%' as const, height: CARD_WIDTH * 0.6,
    backgroundColor: '#F7F7F7', alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { padding: 10 },
  cardTitle: { fontSize: 14, fontWeight: '600' as const, color: '#222', lineHeight: 18, marginBottom: 6 },
  cardPrice: { fontSize: 16, fontWeight: '700' as const, color: ORANGE, marginBottom: 6 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11, color: '#999' },

  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { fontSize: 15, color: '#999' },

  goBackBtn: {
    marginTop: 16, paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: '#F7F7F7', borderRadius: 10,
  },
  goBackText: { fontWeight: '600' as const, fontSize: 14, color: '#333' },
});
