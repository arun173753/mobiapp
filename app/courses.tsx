import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  TextInput, FlatList, ActivityIndicator, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { getApiUrl, apiRequest } from '@/lib/query-client';
import { openLink } from '@/lib/open-link';
import { Course, CourseCategory, INDIAN_LANGUAGES } from '@/lib/types';

const C = Colors.light;
const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

const FILTER_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'course', label: 'Course' },
  { key: 'tutorial', label: 'Tutorial' },
  { key: 'workshop', label: 'Workshop' },
];

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function getLanguageName(code: string): string {
  const lang = INDIAN_LANGUAGES.find(l => l.code === code);
  return lang ? lang.name : code;
}

export default function CoursesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useApp();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [uploadVideoLink, setUploadVideoLink] = useState('');

  const isTeacher = profile?.role === 'teacher' || profile?.role === 'admin';

  useEffect(() => {
    apiRequest('GET', '/api/app-settings')
      .then(r => r.json())
      .then(data => { if (data.upload_video_link) setUploadVideoLink(data.upload_video_link); })
      .catch(() => {});
  }, []);

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const { data: courses, isLoading } = useQuery<Course[]>({
    queryKey: ['/api/courses?published=1'],
  });

  const filtered = useMemo(() => {
    if (!courses) return [];
    let list = courses;
    if (activeFilter !== 'all') {
      list = list.filter(c => c.category === activeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.teacherName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [courses, activeFilter, search]);

  const renderCourseCard = ({ item }: { item: Course }) => {
    const coverUri = item.coverImage
      ? (item.coverImage.startsWith('/') ? `${getApiUrl()}${item.coverImage}` : item.coverImage)
      : null;
    const rating = parseFloat(item.rating) || 0;

    return (
      <Pressable
        testID={`course-card-${item.id}`}
        style={styles.card}
        onPress={() => router.push({ pathname: '/course-detail', params: { courseId: item.id } })}
      >
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={styles.cardImage} contentFit="cover" />
        ) : (
          <View style={styles.cardImagePlaceholder}>
            <Ionicons name="school-outline" size={32} color={C.textTertiary} />
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.cardTeacher} numberOfLines={1}>{item.teacherName}</Text>
          <View style={styles.cardMeta}>
            {rating > 0 && (
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={12} color="#FFD60A" />
                <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
              </View>
            )}
            <View style={styles.metaItem}>
              <Ionicons name="videocam-outline" size={12} color={C.textTertiary} />
              <Text style={styles.metaText}>{item.totalVideos}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={12} color={C.textTertiary} />
              <Text style={styles.metaText}>{item.enrollmentCount}</Text>
            </View>
          </View>
          <Text style={styles.cardPrice}>{'\u20B9'}{item.price}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container} testID="courses-screen">
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="courses-back-btn">
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Courses</Text>
          {isTeacher && !!uploadVideoLink ? (
            <Pressable
              onPress={() => openLink(uploadVideoLink, 'Upload Videos')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FF6B35', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 }}
              hitSlop={8}
            >
              <Ionicons name="cloud-upload-outline" size={15} color="#FFF" />
              <Text style={{ color: '#FFF', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>Upload</Text>
            </Pressable>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={C.textTertiary} />
          <TextInput
            testID="courses-search-input"
            style={styles.searchInput}
            placeholder="Search courses..."
            placeholderTextColor={C.textTertiary}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={C.textTertiary} />
            </Pressable>
          )}
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTER_TABS}
          keyExtractor={t => t.key}
          contentContainerStyle={styles.filterRow}
          renderItem={({ item: tab }) => (
            <Pressable
              testID={`filter-tab-${tab.key}`}
              style={[styles.filterChip, activeFilter === tab.key && styles.filterChipActive]}
              onPress={() => setActiveFilter(tab.key)}
            >
              <Text style={[styles.filterText, activeFilter === tab.key && styles.filterTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          )}
        />
      </View>

      {isLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="school-outline" size={48} color={C.textTertiary} />
          <Text style={styles.emptyText}>
            {search.trim() ? 'No courses match your search' : 'No courses available yet'}
          </Text>
        </View>
      ) : (
        <FlatList
          testID="courses-list"
          data={filtered}
          keyExtractor={item => item.id}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.columnWrapper}
          showsVerticalScrollIndicator={false}
          renderItem={renderCourseCard}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: {
    color: C.text,
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    padding: 0,
  },
  filterRow: { gap: 8, paddingBottom: 4 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  filterChipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  filterText: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  filterTextActive: { color: '#FFF' },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    color: C.textTertiary,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center' as const,
    paddingHorizontal: 40,
  },
  listContent: { padding: 16, paddingBottom: 40 },
  columnWrapper: { gap: 16, marginBottom: 16 },
  card: {
    width: CARD_WIDTH,
    backgroundColor: C.surface,
    borderRadius: 14,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardImage: {
    width: '100%' as const,
    height: CARD_WIDTH * 0.6,
  },
  cardImagePlaceholder: {
    width: '100%' as const,
    height: CARD_WIDTH * 0.6,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { padding: 10 },
  cardTitle: {
    color: C.text,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 18,
    marginBottom: 4,
  },
  cardTeacher: {
    color: C.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginBottom: 6,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    color: '#FFD60A',
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    color: C.textTertiary,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  cardPrice: {
    color: C.primary,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});
