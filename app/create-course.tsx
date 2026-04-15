import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, Platform,
  ScrollView, ActivityIndicator, Switch, Modal, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { UploadManager } from '@/lib/upload-manager';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { INDIAN_LANGUAGES, COURSE_CATEGORIES, Course, CourseChapter, CourseVideo, CourseCategory } from '@/lib/types';

const C = Colors.light;
const MAX_VIDEO_SIZE_MB = 2048;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

function VideoPreviewModal({ url, onClose }: { url: string | null; onClose: () => void }) {
  const player = useVideoPlayer(url || '', (p) => {
    p.loop = false;
    if (url) p.play();
  });
  if (!url) return null;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 50, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 6 }}>
          <Ionicons name="close" size={26} color="#FFF" />
        </Pressable>
        {Platform.OS === 'web'
          ? React.createElement('video', { src: url, controls: true, autoPlay: true, style: { width: '90%', maxHeight: '80vh', borderRadius: 10 } })
          : <VideoView player={player} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10 }} contentFit="contain" nativeControls />
        }
      </View>
    </Modal>
  );
}

const getVideoDurationWeb = (uri: string): Promise<number> =>
  new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(Math.round(v.duration));
    v.onerror = () => resolve(0);
    v.src = uri;
  });

export default function CreateCourseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ courseId?: string }>();
  const { profile } = useApp();

  const isEditing = !!params.courseId;
  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<CourseCategory>('course');
  const [language, setLanguage] = useState('hi');
  const [accessDays, setAccessDays] = useState('365');
  const [demoDuration, setDemoDuration] = useState('5');
  const [coverImageUri, setCoverImageUri] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(true);

  const [course, setCourse] = useState<Course | null>(null);
  const [chapters, setChapters] = useState<(CourseChapter & { videos?: CourseVideo[] })[]>([]);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingCourse, setIsLoadingCourse] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);

  const cancelUpload = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    UploadManager.cancel();
    setIsSubmitting(false);
    setUploadProgress('');
    setUploadPercent(0);
    showStatus('Upload cancelled', 'info');
  };

  useFocusEffect(
    React.useCallback(() => {
      UploadManager.suppressBanner(true);
      return () => { UploadManager.suppressBanner(false); };
    }, [])
  );

  const isUploadActive = useRef(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusType, setStatusType] = useState<'success' | 'error' | 'info'>('info');
  const [pendingDelete, setPendingDelete] = useState<{ type: 'video' | 'chapter' | 'course'; id: string; label: string } | null>(null);
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);

  const showStatus = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setStatusMsg(msg); setStatusType(type);
    setTimeout(() => setStatusMsg(''), 4000);
  };

  const [showChapterModal, setShowChapterModal] = useState(false);
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterDescription, setChapterDescription] = useState('');

  const [showVideoModal, setShowVideoModal] = useState(false);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState('');
  const [videoDescription, setVideoDescription] = useState('');
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFileName, setVideoFileName] = useState('');
  const [videoFileSize, setVideoFileSize] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState('0');
  const [videoIsDemo, setVideoIsDemo] = useState(false);
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [videoInputMode, setVideoInputMode] = useState<'file' | 'url'>('file');
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  useEffect(() => {
    if (UploadManager.isUploading()) {
      setIsSubmitting(true);
      setUploadPercent(UploadManager.getProgress());
      setUploadProgress(UploadManager.getMessage());
    }
    return UploadManager.subscribe(() => {
      if (!isMountedRef.current) return;
      if (UploadManager.isUploading()) {
        setIsSubmitting(true);
        setUploadPercent(UploadManager.getProgress());
        setUploadProgress(UploadManager.getMessage());
      }
    });
  }, []);

  const [showLanguageModal, setShowLanguageModal] = useState(false);

  useEffect(() => {
    if (params.courseId) {
      loadCourse(params.courseId);
    }
  }, [params.courseId]);

  const loadCourse = async (id: string) => {
    setIsLoadingCourse(true);
    try {
      const res = await apiRequest('GET', `/api/courses/${id}`);
      const data = await res.json();
      if (data) {
        setCourse(data);
        setTitle(data.title || '');
        setDescription(data.description || '');
        setPrice(data.price || '');
        setCategory(data.category || 'course');
        setLanguage(data.language || 'hi');
        setAccessDays(String(data.accessDays || 365));
        setDemoDuration(String(data.demoDuration || 5));
        setIsPublished(data.isPublished === 1);
        if (data.coverImage) setCoverImageUri(data.coverImage);
        setChapters(data.chapters || []);
        const allIds = new Set<string>((data.chapters || []).map((ch: CourseChapter) => ch.id));
        setExpandedChapters(allIds);
      }
    } catch (e) {
      console.error('[CreateCourse] Failed to load:', e);
      showStatus('Failed to load course', 'error');
    } finally {
      setIsLoadingCourse(false);
    }
  };

  const uploadImage = async (uri: string): Promise<string> => {
    const baseUrl = getApiUrl();
    const uploadUrl = new URL('/api/upload', baseUrl).toString();
    const formData = new FormData();

    if (Platform.OS === 'web') {
      const response = await window.fetch(uri);
      const blob = await response.blob();
      formData.append('image', blob, 'cover.jpg');
      const uploadRes = await window.fetch(uploadUrl, { method: 'POST', body: formData });
      const data = await uploadRes.json();
      if (!data.success) throw new Error('Upload failed');
      return data.url;
    } else {
      formData.append('image', {
        uri: uri,
        name: 'cover.jpg',
        type: 'image/jpeg',
      } as any);
      const uploadRes = await globalThis.fetch(uploadUrl, { method: 'POST', body: formData as any });
      const data = await uploadRes.json();
      if (!data.success) throw new Error('Upload failed');
      return data.url;
    }
  };

  const uploadVideo = async (uri: string, fileSize: number): Promise<string> => {
    const { uploadVideoToBunnyStream } = await import('@/lib/bunny-stream');
    const title = videoTitle.trim() || 'Untitled Video';
    const cancelSignal = { cancelled: false };

    UploadManager.startTus(videoFileName || 'video', cancelSignal);

    const result = await uploadVideoToBunnyStream(
      uri,
      title,
      (p) => {
        if (!isMountedRef.current) return;
        setUploadPercent(p.percent);
        setUploadProgress(p.message);
        UploadManager.update(p.percent, p.message);
      },
      cancelSignal,
      false,
      fileSize || undefined,
      Platform.OS === 'web' ? videoFile : null,
    );

    UploadManager.finish();
    return result.directUrl;
  };

  const _uploadVideoLegacy = async (uri: string): Promise<string> => {
    const baseUrl = getApiUrl();
    const uploadUrl = new URL('/api/upload-video', baseUrl).toString();
    const formData = new FormData();

    if (Platform.OS === 'web') {
      if (videoFile) {
        formData.append('video', videoFile, videoFile.name);
      } else {
        const response = await window.fetch(uri);
        const blob = await response.blob();
        const ext = videoFileName ? videoFileName.split('.').pop() || 'mp4' : 'mp4';
        formData.append('video', blob, `video.${ext}`);
      }
    } else {
      const uriLower = uri.toLowerCase();
      const ext = uriLower.includes('.mov') ? 'mov' : uriLower.includes('.webm') ? 'webm' : 'mp4';
      const mimeMap: Record<string, string> = {
        mov: 'video/quicktime',
        webm: 'video/webm',
        mp4: 'video/mp4',
      };
      const mimeType = mimeMap[ext] || 'video/mp4';
      formData.append('video', {
        uri,
        type: mimeType,
        name: `video.${ext}`,
      } as any);
    }

    const fileName = videoFileName || (videoFile?.name ?? 'video');

    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open('POST', uploadUrl);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
          setUploadPercent(pct);
          setUploadProgress(`Uploading... ${pct}%`);
          UploadManager.update(pct, `Uploading... ${pct}%`);
        }
      };
      xhr.onload = () => {
        setUploadPercent(100);
        setUploadProgress('Processing video...');
        UploadManager.finish();
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.success && data.url) {
              const finalUrl = data.url.startsWith('http') 
                ? data.url 
                : new URL(data.url, baseUrl).toString();
              resolve(finalUrl);
            } else {
              reject(new Error(data.message || 'Upload failed'));
            }
          } catch {
            reject(new Error(`Upload failed — unexpected response (HTTP ${xhr.status})`));
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => {
        UploadManager.finish();
        reject(new Error('Upload failed — network error. Check connection.'));
      };
      xhr.ontimeout = () => {
        UploadManager.finish();
        reject(new Error('Upload timed out. Video may be too large.'));
      };
      xhr.onabort = () => {
        reject(new Error('CANCELLED'));
      };

      UploadManager.start(xhr, fileName);
      xhr.send(formData);
    });
  };

  const pickCoverImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setCoverImageUri(result.assets[0].uri);
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const pickVideoFile = async () => {
    if (Platform.OS === 'web') {
      await new Promise<void>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) { resolve(); return; }
          if (file.size > MAX_VIDEO_SIZE_BYTES) {
            showStatus('Video must be under 2GB', 'error');
            resolve();
            return;
          }
          const objectUrl = URL.createObjectURL(file);
          setVideoFile(file);
          setVideoUri(objectUrl);
          setVideoFileName(file.name);
          setVideoFileSize(file.size);
          getVideoDurationWeb(objectUrl).then(secs => {
            if (secs > 0) setVideoDuration(String(secs));
          });
          resolve();
        };
        input.click();
      });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: false,
      quality: 1,
      videoMaxDuration: 7200,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_VIDEO_SIZE_BYTES) {
        showStatus('Video must be under 2GB', 'error');
        return;
      }
      setVideoUri(asset.uri);
      setVideoFile(null);
      setVideoFileName(asset.fileName || 'video.mp4');
      setVideoFileSize(asset.fileSize ?? 0);
      if (asset.duration) {
        setVideoDuration(String(Math.round(asset.duration / 1000)));
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleCreateCourse = async () => {
    if (!title.trim()) { showStatus('Please enter a course title', 'error'); return; }
    if (!price.trim()) { showStatus('Please enter a price', 'error'); return; }
    if (!profile) return;

    setIsSubmitting(true);
    try {
      let coverUrl = '';
      if (coverImageUri && (coverImageUri.startsWith('file://') || coverImageUri.startsWith('content://') || coverImageUri.startsWith('ph://') || coverImageUri.startsWith('blob:'))) {
        setUploadProgress('Uploading cover image...');
        coverUrl = await uploadImage(coverImageUri);
      } else if (coverImageUri) {
        coverUrl = coverImageUri;
      }

      setUploadProgress('Creating course...');
      const res = await apiRequest('POST', '/api/courses', {
        teacherId: profile.id,
        teacherName: profile.name,
        teacherAvatar: profile.avatar || '',
        title: title.trim(),
        description: description.trim(),
        price: price.trim(),
        coverImage: coverUrl,
        category,
        language,
        demoDuration: parseInt(demoDuration) || 5,
        accessDays: parseInt(accessDays) || 365,
        isPublished: isPublished ? 1 : 0,
      });
      const data = await res.json();

      if (data.success && data.course) {
        setCourse(data.course);
        setChapters([]);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showStatus('Course created! Now add chapters and videos below.', 'success');
      } else {
        showStatus(data.message || 'Failed to create course', 'error');
      }
    } catch (e: any) {
      if (e?.message === 'CANCELLED') return;
      console.error('[CreateCourse] Error:', e);
      showStatus('Failed to create course. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
      setUploadProgress('');
      setUploadPercent(0);
    }
  };

  const handleAddChapter = async () => {
    if (!chapterTitle.trim() || !course) return;

    setIsSubmitting(true);
    try {
      const res = await apiRequest('POST', `/api/courses/${course.id}/chapters`, {
        title: chapterTitle.trim(),
        description: chapterDescription.trim(),
        sortOrder: chapters.length + 1,
      });
      const data = await res.json();
      if (data.success && data.chapter) {
        setChapters(prev => [...prev, { ...data.chapter, videos: [] }]);
        setExpandedChapters(prev => new Set([...prev, data.chapter.id]));
        setChapterTitle('');
        setChapterDescription('');
        setShowChapterModal(false);
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (e) {
      console.error('[CreateCourse] Add chapter error:', e);
      showStatus('Failed to add chapter', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddVideo = async () => {
    if (!videoTitle.trim() || !course || !activeChapterId) return;
    if (videoInputMode === 'file' && !videoUri) return;
    if (videoInputMode === 'url' && !videoUrlInput.trim()) return;

    setIsSubmitting(true);
    const capturedUri = videoUri;
    const capturedSize = videoFileSize;
    const capturedChapterId = activeChapterId;
    const capturedCourse = course;
    try {
      let videoUrl: string;
      if (videoInputMode === 'url') {
        videoUrl = videoUrlInput.trim();
      } else {
        setUploadPercent(0);
        setUploadProgress('Preparing upload...');
        videoUrl = await uploadVideo(capturedUri!, capturedSize);
      }

      if (isMountedRef.current) setUploadProgress('Saving video...');
      const chapterVideos = chapters.find(ch => ch.id === capturedChapterId)?.videos || [];
      const res = await apiRequest('POST', `/api/courses/${capturedCourse!.id}/chapters/${capturedChapterId}/videos`, {
        title: videoTitle.trim(),
        description: videoDescription.trim(),
        videoUrl,
        thumbnailUrl: '',
        duration: parseInt(videoDuration) || 0,
        sortOrder: chapterVideos.length + 1,
        isDemo: videoIsDemo ? 1 : 0,
      });
      const data = await res.json();
      if (data.success && data.video) {
        if (isMountedRef.current) {
          setChapters(prev => prev.map(ch => {
            if (ch.id !== capturedChapterId) return ch;
            return { ...ch, videos: [...(ch.videos || []), data.video] };
          }));
          resetVideoModal();
          showStatus('Video added successfully!', 'success');
        }
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e: any) {
      const wasCancelled = e?.message === 'CANCELLED';
      if (!wasCancelled) {
        const errMsg = e?.message || (typeof e === 'string' ? e : null) || JSON.stringify(e) || 'Unknown error';
        console.error('[CreateCourse] Add video error:', errMsg, e);
        if (isMountedRef.current) {
          showStatus(errMsg.length < 200 ? errMsg : 'Upload failed — please try again.', 'error');
        }
      }
    } finally {
      if (UploadManager.isUploading()) {
        UploadManager.finish();
      }
      if (isMountedRef.current) {
        setIsSubmitting(false);
        setUploadProgress('');
        setUploadPercent(0);
      }
    }
  };

  const resetVideoModal = () => {
    setVideoTitle('');
    setVideoDescription('');
    setVideoUri(null);
    setVideoFileName('');
    setVideoFileSize(0);
    setVideoDuration('0');
    setVideoIsDemo(false);
    setVideoUrlInput('');
    setVideoInputMode('file');
    setActiveChapterId(null);
    setShowVideoModal(false);
  };

  const togglePublish = async () => {
    if (!course) return;
    const newVal = !isPublished;
    setIsPublished(newVal);
    try {
      await apiRequest('POST', `/api/courses`, {
        ...course,
        isPublished: newVal ? 1 : 0,
      });
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      setIsPublished(!newVal);
      console.error('[CreateCourse] Toggle publish error:', e);
    }
  };

  const toggleChapter = (chId: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chId)) next.delete(chId);
      else next.add(chId);
      return next;
    });
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const selectedLang = INDIAN_LANGUAGES.find(l => l.code === language);

  if (isLoadingCourse) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Loading course...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="back-button">
          <Ionicons name="arrow-back" size={26} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{isEditing || course ? 'Edit Course' : 'Create Course'}</Text>
        <View style={{ width: 26 }} />
      </View>

      {!!statusMsg && (
        <View style={{ backgroundColor: statusType === 'success' ? '#1a3a1a' : statusType === 'error' ? '#3a1a1a' : '#1a2a3a', paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name={statusType === 'success' ? 'checkmark-circle' : statusType === 'error' ? 'alert-circle' : 'information-circle'} size={18} color={statusType === 'success' ? '#34C759' : statusType === 'error' ? '#FF453A' : '#0A84FF'} />
          <Text style={{ color: statusType === 'success' ? '#34C759' : statusType === 'error' ? '#FF453A' : '#0A84FF', fontSize: 14, fontFamily: 'Inter_500Medium', flex: 1 }}>{statusMsg}</Text>
        </View>
      )}

      {pendingDelete && (
        <View style={{ backgroundColor: '#2a1a1a', padding: 16, margin: 12, borderRadius: 12, borderWidth: 1, borderColor: C.error }}>
          <Text style={{ color: C.text, fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 6 }}>
            {pendingDelete.type === 'course' ? 'Delete Course' : pendingDelete.type === 'chapter' ? 'Delete Chapter' : 'Delete Video'}
          </Text>
          <Text style={{ color: C.textSecondary, fontSize: 14, fontFamily: 'Inter_400Regular', marginBottom: 14 }}>
            {`Delete "${pendingDelete.label}"? This cannot be undone.`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setPendingDelete(null)} style={{ flex: 1, backgroundColor: C.surface2, paddingVertical: 10, borderRadius: 8, alignItems: 'center' }}>
              <Text style={{ color: C.text, fontFamily: 'Inter_500Medium' }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                const { type, id } = pendingDelete;
                setPendingDelete(null);
                try {
                  if (type === 'video') {
                    await apiRequest('DELETE', `/api/courses/${course!.id}/videos/${id}`);
                    loadCourse(course!.id);
                  } else if (type === 'chapter') {
                    await apiRequest('DELETE', `/api/courses/${course!.id}/chapters/${id}`);
                    loadCourse(course!.id);
                  } else {
                    await apiRequest('DELETE', `/api/courses/${id}`);
                    router.back();
                  }
                } catch (e) {
                  showStatus(`Failed to delete ${type}`, 'error');
                }
              }}
              style={{ flex: 1, backgroundColor: C.error, paddingVertical: 10, borderRadius: 8, alignItems: 'center' }}
            >
              <Text style={{ color: '#FFF', fontFamily: 'Inter_600SemiBold' }}>Delete</Text>
            </Pressable>
          </View>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {course && (
          <View style={styles.publishRow}>
            <View style={styles.publishInfo}>
              <Ionicons
                name={isPublished ? 'globe-outline' : 'eye-off-outline'}
                size={20}
                color={isPublished ? C.success : C.textTertiary}
              />
              <Text style={[styles.publishLabel, isPublished && { color: C.success }]}>
                {isPublished ? 'Published' : 'Unpublished'}
              </Text>
            </View>
            <Switch
              testID="publish-toggle"
              value={isPublished}
              onValueChange={togglePublish}
              trackColor={{ false: C.surfaceElevated, true: C.success }}
              thumbColor="#FFF"
            />
          </View>
        )}

        <Text style={styles.sectionLabel}>Course Title *</Text>
        <TextInput
          testID="course-title-input"
          style={styles.input}
          placeholder="e.g., Complete Mobile Repair Course"
          placeholderTextColor={C.textTertiary}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.sectionLabel}>Description</Text>
        <TextInput
          testID="course-description-input"
          style={[styles.input, styles.textArea]}
          placeholder="What will students learn in this course?"
          placeholderTextColor={C.textTertiary}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
        />

        <View style={styles.row}>
          <View style={styles.halfField}>
            <Text style={styles.sectionLabel}>Price (INR) *</Text>
            <TextInput
              testID="course-price-input"
              style={styles.input}
              placeholder="e.g., 999"
              placeholderTextColor={C.textTertiary}
              value={price}
              onChangeText={setPrice}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.sectionLabel}>Access Days</Text>
            <TextInput
              testID="access-days-input"
              style={styles.input}
              placeholder="365"
              placeholderTextColor={C.textTertiary}
              value={accessDays}
              onChangeText={setAccessDays}
              keyboardType="numeric"
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.halfField}>
            <Text style={styles.sectionLabel}>Demo Duration (sec)</Text>
            <TextInput
              testID="demo-duration-input"
              style={styles.input}
              placeholder="60"
              placeholderTextColor={C.textTertiary}
              value={demoDuration}
              onChangeText={setDemoDuration}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.sectionLabel}>Language</Text>
            <Pressable
              testID="language-selector"
              style={styles.selectorBtn}
              onPress={() => setShowLanguageModal(true)}
            >
              <Text style={styles.selectorText}>
                {selectedLang ? `${selectedLang.nativeName}` : 'Select'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Category</Text>
        <View style={styles.categoryRow}>
          {COURSE_CATEGORIES.map(c => (
            <Pressable
              key={c.key}
              style={[styles.categoryChip, category === c.key && styles.categoryChipActive]}
              onPress={() => setCategory(c.key)}
            >
              <Text style={[styles.categoryText, category === c.key && styles.categoryTextActive]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Cover Image</Text>
        {coverImageUri ? (
          <View style={styles.coverImageContainer}>
            <Image source={{ uri: coverImageUri }} style={styles.coverImage} contentFit="cover" />
            <Pressable style={styles.removeCoverBtn} onPress={() => setCoverImageUri(null)}>
              <Ionicons name="close-circle" size={28} color={C.error} />
            </Pressable>
          </View>
        ) : (
          <Pressable testID="pick-cover-image" style={styles.addCoverBtn} onPress={pickCoverImage}>
            <Ionicons name="image-outline" size={32} color={C.textTertiary} />
            <Text style={styles.addCoverText}>Add Cover Image</Text>
          </Pressable>
        )}

        {course && (
          <Pressable
            testID="save-changes-button"
            style={[styles.createBtn, isSubmitting && styles.createBtnDisabled]}
            onPress={async () => {
              if (!title.trim() || !price.trim()) {
                showStatus('Title and price are required', 'error');
                return;
              }
              setIsSubmitting(true);
              try {
                let coverUrl = coverImageUri || '';
                if (coverImageUri && (coverImageUri.startsWith('file://') || coverImageUri.startsWith('content://') || coverImageUri.startsWith('ph://') || coverImageUri.startsWith('blob:'))) {
                  setUploadProgress('Uploading cover image...');
                  coverUrl = await uploadImage(coverImageUri);
                }
                await apiRequest('PUT', `/api/courses/${course.id}`, {
                  title: title.trim(),
                  description: description.trim(),
                  price: price.trim(),
                  accessDays: parseInt(accessDays) || 365,
                  demoDuration: parseInt(demoDuration) || 5,
                  language,
                  category,
                  isPublished: isPublished ? 1 : 0,
                  coverImage: coverUrl,
                });
                if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                showStatus('Course updated successfully', 'success');
              } catch (e) {
                console.error('[CreateCourse] Save error:', e);
                showStatus('Failed to save changes', 'error');
              } finally {
                setIsSubmitting(false);
                setUploadProgress('');
              }
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="save-outline" size={22} color="#FFF" />
                <Text style={styles.createBtnText}>Save Changes</Text>
              </>
            )}
          </Pressable>
        )}

        {!course && (
          <>
            {isSubmitting && uploadProgress ? (
              <View style={styles.progressContainer}>
                <View style={styles.progressTopRow}>
                  <ActivityIndicator size="small" color={C.primary} />
                  <Text style={styles.progressText}>{uploadProgress}</Text>
                </View>
                {uploadPercent > 0 && (
                  <>
                    <View style={styles.progressBarBg}>
                      <View style={[styles.progressBarFill, { width: `${uploadPercent}%` as any }]} />
                    </View>
                    <Text style={styles.progressPercentBig}>{uploadPercent}%</Text>
                  </>
                )}
                <Text style={styles.progressLimit}>Max file size: 2 GB</Text>
                {UploadManager.isUploading() && (
                  <Pressable style={styles.cancelUploadBtn} onPress={cancelUpload}>
                    <Ionicons name="close-circle-outline" size={18} color="#E53935" />
                    <Text style={styles.cancelUploadText}>Cancel Upload</Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            <Pressable
              testID="create-course-button"
              style={[styles.createBtn, (!title.trim() || !price.trim() || isSubmitting) && styles.createBtnDisabled]}
              onPress={handleCreateCourse}
              disabled={!title.trim() || !price.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="add-circle-outline" size={22} color="#FFF" />
                  <Text style={styles.createBtnText}>Create Course</Text>
                </>
              )}
            </Pressable>
          </>
        )}

        {course && (
          <View style={styles.chaptersSection}>
            <View style={styles.chapterHeader}>
              <Text style={styles.chaptersTitle}>Chapters ({chapters.length})</Text>
            </View>

            {chapters.length === 0 && (
              <View style={styles.emptyChapters}>
                <Feather name="folder-plus" size={40} color={C.textTertiary} />
                <Text style={styles.emptyText}>No chapters yet</Text>
                <Text style={styles.emptySubText}>Add chapters and organize your videos</Text>
              </View>
            )}

            {chapters.map((ch, idx) => (
              <View key={ch.id} style={styles.chapterCard}>
                <Pressable
                  style={styles.chapterTitleRow}
                  onPress={() => toggleChapter(ch.id)}
                  testID={`chapter-toggle-${idx}`}
                >
                  <View style={styles.chapterLeft}>
                    <View style={styles.chapterIcon}>
                      <MaterialIcons name="folder" size={20} color={C.primary} />
                    </View>
                    <View style={styles.chapterInfo}>
                      <Text style={styles.chapterName} numberOfLines={1}>{ch.title}</Text>
                      <Text style={styles.chapterVideoCount}>
                        {(ch.videos || []).length} video{(ch.videos || []).length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name={expandedChapters.has(ch.id) ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={C.textSecondary}
                  />
                </Pressable>

                {expandedChapters.has(ch.id) && (
                  <View style={styles.chapterContent}>
                    {(ch.videos || []).map((vid, vIdx) => (
                      <View key={vid.id} style={styles.videoItem}>
                        <Pressable style={styles.videoLeft} onPress={() => vid.videoUrl ? setPlayingVideoUrl(vid.videoUrl) : null} hitSlop={6}>
                          <View style={styles.videoIconWrap}>
                            <Ionicons name="play-circle" size={28} color={C.primary} />
                          </View>
                          <View style={styles.videoMeta}>
                            <Text style={styles.videoTitle} numberOfLines={1}>{vid.title}</Text>
                            <View style={styles.videoMetaRow}>
                              <Text style={styles.videoDuration}>{formatDuration(vid.duration)}</Text>
                              {vid.isDemo === 1 && (
                                <View style={styles.demoBadge}>
                                  <Text style={styles.demoBadgeText}>FREE</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </Pressable>
                        <Pressable
                          hitSlop={8}
                          onPress={() => setPendingDelete({ type: 'video', id: vid.id, label: vid.title })}
                        >
                          <Ionicons name="trash-outline" size={20} color={C.error} />
                        </Pressable>
                      </View>
                    ))}

                    <View style={styles.chapterActionsRow}>
                      <Pressable
                        testID={`add-video-${idx}`}
                        style={styles.addVideoBtn}
                        onPress={() => {
                          setActiveChapterId(ch.id);
                          setShowVideoModal(true);
                        }}
                      >
                        <Ionicons name="add" size={20} color={C.primary} />
                        <Text style={styles.addVideoText}>Add Video</Text>
                      </Pressable>
                      <Pressable
                        style={styles.deleteChapterBtn}
                        onPress={() => setPendingDelete({ type: 'chapter', id: ch.id, label: ch.title })}
                      >
                        <Ionicons name="trash-outline" size={18} color={C.error} />
                        <Text style={styles.deleteChapterText}>Delete Chapter</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            ))}

            <Pressable
              testID="delete-course-button"
              style={styles.deleteCourseBtn}
              onPress={() => setPendingDelete({ type: 'course', id: course!.id, label: 'this entire course' })}
            >
              <Ionicons name="trash-outline" size={20} color="#FFF" />
              <Text style={styles.deleteCourseText}>Delete Course</Text>
            </Pressable>
          </View>
        )}

        {isSubmitting && uploadProgress && course ? (
          <View style={styles.progressContainer}>
            <View style={styles.progressTopRow}>
              <ActivityIndicator size="small" color={C.primary} />
              <Text style={styles.progressText}>{uploadProgress}</Text>
            </View>
            {uploadPercent > 0 && (
              <>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${uploadPercent}%` as any }]} />
                </View>
                <Text style={styles.progressPercentBig}>{uploadPercent}%</Text>
              </>
            )}
            <Text style={styles.progressLimit}>Max file size: 2 GB</Text>
            {UploadManager.isUploading() && (
              <Pressable style={styles.cancelUploadBtn} onPress={cancelUpload}>
                <Ionicons name="close-circle-outline" size={18} color="#E53935" />
                <Text style={styles.cancelUploadText}>Cancel Upload</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </ScrollView>

      {course && (
        <Pressable
          testID="add-chapter-fab"
          style={[styles.fab, { bottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 20 }]}
          onPress={() => setShowChapterModal(true)}
        >
          <Ionicons name="folder-open-outline" size={24} color="#FFF" />
        </Pressable>
      )}

      <Modal visible={showChapterModal} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Add Chapter</Text>
                  <Pressable onPress={() => setShowChapterModal(false)} hitSlop={12}>
                    <Ionicons name="close" size={24} color={C.text} />
                  </Pressable>
                </View>

                <Text style={styles.modalLabel}>Chapter Title *</Text>
                <TextInput
                  testID="chapter-title-input"
                  style={styles.modalInput}
                  placeholder="e.g., Introduction to Mobile Repair"
                  placeholderTextColor={C.textTertiary}
                  value={chapterTitle}
                  onChangeText={setChapterTitle}
                />

                <Text style={styles.modalLabel}>Description</Text>
                <TextInput
                  testID="chapter-description-input"
                  style={[styles.modalInput, styles.modalTextArea]}
                  placeholder="Brief chapter description..."
                  placeholderTextColor={C.textTertiary}
                  value={chapterDescription}
                  onChangeText={setChapterDescription}
                  multiline
                />

                <Pressable
                  testID="save-chapter-button"
                  style={[styles.modalBtn, (!chapterTitle.trim() || isSubmitting) && styles.modalBtnDisabled]}
                  onPress={handleAddChapter}
                  disabled={!chapterTitle.trim() || isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.modalBtnText}>Add Chapter</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showVideoModal} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            {isSubmitting ? (
              /* ── UPLOADING STATE: show only progress, hide all form fields ── */
              <View style={styles.uploadingSheet}>
                <View style={styles.uploadingIconWrap}>
                  <Ionicons name="cloud-upload" size={48} color={C.primary} />
                </View>
                <Text style={styles.uploadingTitle}>Uploading Video</Text>
                <Text style={styles.uploadingSubtitle}>{uploadProgress || 'Preparing...'}</Text>
                <View style={styles.uploadingBarBg}>
                  <View style={[styles.uploadingBarFill, { width: `${uploadPercent}%` as any }]} />
                </View>
                <Text style={styles.uploadingPercent}>{uploadPercent}%</Text>
                <Text style={styles.uploadingHint}>Please keep this screen open</Text>
                {UploadManager.isUploading() && (
                  <Pressable style={styles.cancelUploadBtn} onPress={cancelUpload}>
                    <Ionicons name="close-circle-outline" size={18} color="#E53935" />
                    <Text style={styles.cancelUploadText}>Cancel Upload</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              /* ── FORM STATE: show all fields ── */
              <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Add Video</Text>
                    <Pressable onPress={resetVideoModal} hitSlop={12}>
                      <Ionicons name="close" size={24} color={C.text} />
                    </Pressable>
                  </View>

                  <Text style={styles.modalLabel}>Video Title *</Text>
                  <TextInput
                    testID="video-title-input"
                    style={styles.modalInput}
                    placeholder="e.g., Lesson 1 - Tools Overview"
                    placeholderTextColor={C.textTertiary}
                    value={videoTitle}
                    onChangeText={setVideoTitle}
                  />

                  <Text style={styles.modalLabel}>Description</Text>
                  <TextInput
                    style={[styles.modalInput, styles.modalTextArea]}
                    placeholder="Brief video description..."
                    placeholderTextColor={C.textTertiary}
                    value={videoDescription}
                    onChangeText={setVideoDescription}
                    multiline
                  />

                  <Text style={styles.modalLabel}>Video Source *</Text>
                  <View style={styles.videoModeToggle}>
                    <Pressable
                      style={[styles.videoModeBtn, videoInputMode === 'file' && styles.videoModeBtnActive]}
                      onPress={() => setVideoInputMode('file')}
                    >
                      <Ionicons name="phone-portrait-outline" size={16} color={videoInputMode === 'file' ? '#FFF' : C.textSecondary} />
                      <Text style={[styles.videoModeBtnText, videoInputMode === 'file' && styles.videoModeBtnTextActive]}>Upload File</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.videoModeBtn, videoInputMode === 'url' && styles.videoModeBtnActive]}
                      onPress={() => setVideoInputMode('url')}
                    >
                      <Ionicons name="link-outline" size={16} color={videoInputMode === 'url' ? '#FFF' : C.textSecondary} />
                      <Text style={[styles.videoModeBtnText, videoInputMode === 'url' && styles.videoModeBtnTextActive]}>Video URL</Text>
                    </Pressable>
                  </View>

                  {videoInputMode === 'url' ? (
                    <View>
                      <TextInput
                        style={styles.modalInput}
                        placeholder="https://... (Bunny Stream, YouTube, etc.)"
                        placeholderTextColor={C.textTertiary}
                        value={videoUrlInput}
                        onChangeText={setVideoUrlInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                      />
                      <Text style={{ color: videoUrlInput && (videoUrlInput.includes('youtube.com') || videoUrlInput.includes('youtu.be')) ? C.error : C.textTertiary, fontSize: 12, marginBottom: 12 }}>
                        {videoUrlInput && (videoUrlInput.includes('youtube.com') || videoUrlInput.includes('youtu.be'))
                          ? 'YouTube links are not supported. Use a direct MP4 URL from Bunny Stream or any CDN.'
                          : 'Paste a direct MP4 video URL from Bunny Stream, Vimeo, or any CDN.'}
                      </Text>
                    </View>
                  ) : (
                    videoUri ? (
                      <View style={styles.videoSelected}>
                        <View style={styles.videoSelectedInfo}>
                          <Ionicons name="videocam" size={22} color={C.primary} />
                          <Text style={styles.videoSelectedName} numberOfLines={1}>{videoFileName}</Text>
                        </View>
                        <Pressable onPress={() => { setVideoUri(null); setVideoFileName(''); }} hitSlop={8}>
                          <Ionicons name="close-circle" size={22} color={C.error} />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable testID="pick-video-button" style={styles.pickVideoBtn} onPress={pickVideoFile}>
                        <Ionicons name="cloud-upload-outline" size={28} color={C.textTertiary} />
                        <Text style={styles.pickVideoText}>Select Video</Text>
                        <Text style={styles.pickVideoHint}>MP4, MOV — Max 2 GB</Text>
                      </Pressable>
                    )
                  )}

                  <View style={styles.demoRow}>
                    <View style={styles.demoInfo}>
                      <Ionicons name="eye-outline" size={20} color={C.textSecondary} />
                      <Text style={styles.demoLabel}>Free Demo Video</Text>
                    </View>
                    <Switch
                      testID="video-demo-toggle"
                      value={videoIsDemo}
                      onValueChange={setVideoIsDemo}
                      trackColor={{ false: C.surfaceElevated, true: C.primary }}
                      thumbColor="#FFF"
                    />
                  </View>

                  <Pressable
                    testID="save-video-button"
                    style={[styles.modalBtn, (!videoTitle.trim() || (videoInputMode === 'file' ? !videoUri : !videoUrlInput.trim())) && styles.modalBtnDisabled]}
                    onPress={handleAddVideo}
                    disabled={!videoTitle.trim() || (videoInputMode === 'file' ? !videoUri : !videoUrlInput.trim())}
                  >
                    <Text style={styles.modalBtnText}>Upload & Add Video</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showLanguageModal} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowLanguageModal(false)}>
          <View style={styles.languageModalContent}>
            <Text style={styles.modalTitle}>Select Language</Text>
            <ScrollView style={styles.languageList} showsVerticalScrollIndicator={false}>
              {INDIAN_LANGUAGES.map(lang => (
                <Pressable
                  key={lang.code}
                  style={[styles.languageItem, language === lang.code && styles.languageItemActive]}
                  onPress={() => {
                    setLanguage(lang.code);
                    setShowLanguageModal(false);
                    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Text style={[styles.languageName, language === lang.code && styles.languageNameActive]}>
                    {lang.nativeName}
                  </Text>
                  <Text style={styles.languageEnglish}>{lang.name}</Text>
                  {language === lang.code && (
                    <Ionicons name="checkmark-circle" size={20} color={C.primary} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <VideoPreviewModal url={playingVideoUrl} onClose={() => setPlayingVideoUrl(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: C.textSecondary, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 12 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.background,
  },
  headerTitle: { color: C.text, fontSize: 18, fontFamily: 'Inter_600SemiBold' },

  scrollView: { flex: 1, paddingHorizontal: 20 },

  publishRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginTop: 16, borderWidth: 1, borderColor: C.border,
  },
  publishInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  publishLabel: { color: C.textSecondary, fontSize: 15, fontFamily: 'Inter_500Medium' },

  sectionLabel: {
    color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_600SemiBold',
    marginBottom: 8, marginTop: 18, textTransform: 'uppercase' as const, letterSpacing: 0.6,
  },

  input: {
    backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: C.text, fontSize: 15, fontFamily: 'Inter_400Regular',
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' as const },

  row: { flexDirection: 'row', gap: 12 },
  halfField: { flex: 1 },

  selectorBtn: {
    backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: C.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  selectorText: { color: C.text, fontSize: 15, fontFamily: 'Inter_400Regular' },

  categoryRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  categoryChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  categoryChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  categoryText: { color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_500Medium' },
  categoryTextActive: { color: '#FFF' },

  coverImageContainer: { position: 'relative' as const, borderRadius: 14, overflow: 'hidden' },
  coverImage: { width: '100%', height: 180, borderRadius: 14 },
  removeCoverBtn: { position: 'absolute' as const, top: 8, right: 8 },

  addCoverBtn: {
    borderRadius: 14, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' as const,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 30,
  },
  addCoverText: { color: C.textTertiary, fontSize: 14, fontFamily: 'Inter_500Medium', marginTop: 8 },

  createBtn: {
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 24,
  },
  createBtnDisabled: { opacity: 0.4 },
  createBtnText: { color: '#FFF', fontSize: 16, fontFamily: 'Inter_600SemiBold' },

  progressContainer: {
    gap: 8, marginTop: 16,
    backgroundColor: C.surface, padding: 16, borderRadius: 14,
    borderWidth: 1, borderColor: C.primary, alignItems: 'center',
  },
  progressTopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start' as const,
  },
  progressText: { color: C.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  progressBarBg: {
    height: 8, borderRadius: 4, backgroundColor: C.surfaceElevated,
    overflow: 'hidden' as const, width: '100%',
  },
  progressBarFill: {
    height: 8, borderRadius: 4, backgroundColor: C.primary,
  },
  progressPercentBig: {
    color: C.primary, fontSize: 28, fontFamily: 'Inter_700Bold',
  },
  progressLimit: {
    color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular',
  },
  cancelUploadBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    marginTop: 16, paddingVertical: 10, paddingHorizontal: 20,
    borderRadius: 10, borderWidth: 1, borderColor: '#E53935',
    alignSelf: 'center' as const,
  },
  cancelUploadText: {
    color: '#E53935', fontSize: 14, fontFamily: 'Inter_600SemiBold',
  },

  uploadingSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 32, alignItems: 'center',
    paddingBottom: Platform.OS === 'web' ? 48 : 60,
  },
  uploadingIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  uploadingTitle: {
    color: C.text, fontSize: 22, fontFamily: 'Inter_700Bold',
    marginBottom: 6,
  },
  uploadingSubtitle: {
    color: C.textSecondary, fontSize: 14, fontFamily: 'Inter_500Medium',
    textAlign: 'center', marginBottom: 24,
  },
  uploadingBarBg: {
    height: 10, borderRadius: 5, backgroundColor: C.surfaceElevated,
    width: '100%', overflow: 'hidden' as const, marginBottom: 12,
  },
  uploadingBarFill: {
    height: 10, borderRadius: 5, backgroundColor: C.primary,
  },
  uploadingPercent: {
    color: C.primary, fontSize: 36, fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  uploadingHint: {
    color: C.textTertiary, fontSize: 13, fontFamily: 'Inter_400Regular',
  },

  chaptersSection: { marginTop: 24 },
  chapterHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  chaptersTitle: { color: C.text, fontSize: 17, fontFamily: 'Inter_700Bold' },

  emptyChapters: {
    alignItems: 'center', paddingVertical: 40,
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
  },
  emptyText: { color: C.textSecondary, fontSize: 16, fontFamily: 'Inter_500Medium', marginTop: 12 },
  emptySubText: { color: C.textTertiary, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 4 },

  chapterCard: {
    backgroundColor: C.surface, borderRadius: 14, marginBottom: 12,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  chapterTitleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14,
  },
  chapterLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  chapterIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  chapterInfo: { marginLeft: 12, flex: 1 },
  chapterName: { color: C.text, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  chapterVideoCount: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  chapterContent: {
    borderTopWidth: 1, borderTopColor: C.border,
    paddingHorizontal: 14, paddingBottom: 10,
  },

  videoItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  videoLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  videoIconWrap: { marginRight: 12 },
  videoMeta: { flex: 1 },
  videoTitle: { color: C.text, fontSize: 14, fontFamily: 'Inter_500Medium' },
  videoMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  videoDuration: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular' },
  demoBadge: {
    backgroundColor: C.success, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  demoBadgeText: { color: '#FFF', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },

  chapterActionsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 4,
  },
  addVideoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12,
  },
  addVideoText: { color: C.primary, fontSize: 14, fontFamily: 'Inter_500Medium' },
  deleteChapterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12,
  },
  deleteChapterText: { color: C.error, fontSize: 13, fontFamily: 'Inter_500Medium' },
  deleteCourseBtn: {
    backgroundColor: C.error, borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 24,
  },
  deleteCourseText: { color: '#FFF', fontSize: 16, fontFamily: 'Inter_600SemiBold' },

  fab: {
    position: 'absolute', right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      android: { elevation: 8 },
      web: { boxShadow: '0 4px 12px rgba(0,0,0,0.4)' },
    }),
  },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalTitle: { color: C.text, fontSize: 20, fontFamily: 'Inter_700Bold' },

  modalLabel: {
    color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_600SemiBold',
    marginBottom: 8, marginTop: 14, textTransform: 'uppercase' as const, letterSpacing: 0.5,
  },
  modalInput: {
    backgroundColor: C.surfaceElevated, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: C.text, fontSize: 15, fontFamily: 'Inter_400Regular',
    borderWidth: 1, borderColor: C.border,
  },
  modalTextArea: { minHeight: 80, textAlignVertical: 'top' as const },

  modalBtn: {
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center', marginTop: 20,
  },
  modalBtnDisabled: { opacity: 0.4 },
  modalBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  videoSelected: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surfaceElevated, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.primary,
  },
  videoSelectedInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 10 },
  videoSelectedName: { color: C.text, fontSize: 14, fontFamily: 'Inter_400Regular', flex: 1 },

  pickVideoBtn: {
    borderRadius: 12, backgroundColor: C.surfaceElevated,
    borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' as const,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 20,
  },
  pickVideoText: { color: C.textTertiary, fontSize: 14, fontFamily: 'Inter_500Medium', marginTop: 6 },
  pickVideoHint: { color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 4, opacity: 0.7 },

  videoModeToggle: {
    flexDirection: 'row', backgroundColor: C.surfaceElevated,
    borderRadius: 10, padding: 3, marginBottom: 14,
    borderWidth: 1, borderColor: C.border,
  },
  videoModeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 8, borderRadius: 8,
  },
  videoModeBtnActive: { backgroundColor: C.primary },
  videoModeBtnText: { color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_500Medium' },
  videoModeBtnTextActive: { color: '#FFF' },

  demoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, backgroundColor: C.surfaceElevated, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: C.border,
  },
  demoInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  demoLabel: { color: C.textSecondary, fontSize: 14, fontFamily: 'Inter_500Medium' },

  languageModalContent: {
    backgroundColor: C.surface, borderRadius: 20, padding: 24,
    marginHorizontal: 20, maxHeight: '60%',
  },
  languageList: { marginTop: 16 },
  languageItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border, gap: 12,
  },
  languageItemActive: { backgroundColor: C.primaryMuted, marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 10 },
  languageName: { color: C.text, fontSize: 16, fontFamily: 'Inter_500Medium', flex: 1 },
  languageNameActive: { color: C.primary },
  languageEnglish: { color: C.textTertiary, fontSize: 13, fontFamily: 'Inter_400Regular' },
});
