import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, Platform,
  Alert, ActivityIndicator, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';
import { uploadVideoToBunnyStream } from '@/lib/bunny-stream';
import { uploadReelVideoViaMultipartApi } from '@/lib/reel-server-upload';

/** Large reels: direct TUS to Bunny (no multipart through API). */
const MAX_VIDEO_SIZE_MB = 2048;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;
const ENCODING_POLL_MS = 10 * 60 * 1000;
const ENCODING_RETRY_MS = 4000;
const MAX_VIDEO_DURATION_SECS = 120;

const C = Colors.light;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function UploadReelScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<{ fileName?: string; mimeType?: string; fileSize?: number } | null>(null);
  const [localThumbUri, setLocalThumbUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [webPickedFile, setWebPickedFile] = useState<Blob | File | null>(null);

  const player = useVideoPlayer(videoUri || '', (p) => {
    p.loop = true;
  });

  const pickVideo = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets[0]) {
      const asset = result.assets[0];

      if (asset.fileSize && asset.fileSize > MAX_VIDEO_SIZE_BYTES) {
        const sizeMB = (asset.fileSize / (1024 * 1024)).toFixed(1);
        Alert.alert(
          'Video Too Large',
          `This video is ${sizeMB} MB. Maximum allowed size is ${MAX_VIDEO_SIZE_MB} MB.`
        );
        return;
      }

      if (Platform.OS !== 'web' && asset.duration && asset.duration > MAX_VIDEO_DURATION_SECS * 1000) {
        const durSecs = Math.round(asset.duration / 1000);
        Alert.alert(
          'Video Too Long',
          `This video is ${durSecs}s long. Maximum allowed duration is ${MAX_VIDEO_DURATION_SECS} seconds (2 minutes).`
        );
        return;
      }

      setVideoUri(asset.uri);
      setVideoMeta({
        fileName: (asset as any).fileName || undefined,
        mimeType: (asset as any).mimeType || undefined,
        fileSize: (asset as any).fileSize || undefined,
      });
      if (Platform.OS === 'web') {
        const f = (asset as any).file;
        setWebPickedFile(f instanceof Blob && typeof (f as Blob).size === 'number' && (f as Blob).size > 0 ? f : null);
      } else {
        setWebPickedFile(null);
      }
      setUploadError(null);
      setLocalThumbUri(null);
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (Platform.OS !== 'web') {
        try {
          const VideoThumbnails = await import('expo-video-thumbnails');
          const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 0 });
          setLocalThumbUri(thumbUri);
        } catch (thumbErr) {
          console.warn('[Upload] Thumbnail extraction failed:', thumbErr);
        }
      }
    }
  }, []);

  type UploadVideoOk =
    | { ok: true; mode: 'bunny'; videoId: string; directUrl: string }
    | { ok: true; mode: 'multipart'; videoUrl: string; playbackUrl?: string; videoId?: string };
  type UploadVideoErr = { ok: false; error: string };
  type UploadVideoResult = UploadVideoOk | UploadVideoErr;

  const isPlayableVideoUrl = (url: string) => /\.mp4(\?|#|$)|\.m3u8(\?|#|$)/i.test(String(url || '').trim());

  function shouldFallbackToMultipart(err: unknown): boolean {
    const msg = String((err as any)?.message || err || '').toLowerCase();
    return (
      msg.includes('bunny stream not configured') ||
      msg.includes('503') ||
      msg.includes('failed to create bunny') ||
      msg.includes('create bunny stream video')
    );
  }

  const uploadVideo = async (uri: string): Promise<UploadVideoResult> => {
    try {
      setUploadError(null);
      setUploadProgress('Preparing upload...');
      setUploadPercent(2);

      // Auto-retry once on failure (network / timeouts)
      const attempt = async () => {
      try {
        const r = await uploadVideoToBunnyStream(
          uri,
          title?.trim() || 'temp-video',
          (p) => {
            setUploadPercent(Math.max(2, Math.min(94, p.percent)));
            setUploadProgress(p.message);
          },
          undefined,
          false,
          videoMeta?.fileSize,
          Platform.OS === 'web' ? webPickedFile : null,
        );

        setUploadPercent(100);
        setUploadProgress('Upload complete. Publishing…');
        return { ok: true, mode: 'bunny', videoId: r.videoId, directUrl: r.directUrl };
      } catch (bunnyErr: any) {
        if (!shouldFallbackToMultipart(bunnyErr)) throw bunnyErr;
        console.warn('[Upload] Bunny Stream unavailable, using multipart fallback:', bunnyErr?.message);
        setUploadProgress('Uploading via server (large file)…');
        const out = await uploadReelVideoViaMultipartApi(uri, {
          mimeType: videoMeta?.mimeType,
          fileName: videoMeta?.fileName,
          webFile: Platform.OS === 'web' ? webPickedFile : null,
          onProgress: (pct, m) => {
            setUploadPercent(Math.max(2, Math.min(94, pct)));
            setUploadProgress(m);
          },
        });
        if (!out.mode || !/bunny_stream/i.test(String(out.mode))) {
          throw new Error('Video uploaded without Bunny Stream encoding. Please retry in a moment.');
        }
        const videoUrl = out.directUrl || out.playbackUrl || out.url || '';
        if (!videoUrl) throw new Error('Upload succeeded but server did not return a playback URL');
        if (!isPlayableVideoUrl(videoUrl)) throw new Error('Upload succeeded but server returned a non-playable video URL');
        setUploadPercent(100);
        setUploadProgress('Ready to publish');
        return { ok: true, mode: 'multipart', videoUrl, playbackUrl: out.playbackUrl, videoId: out.videoId };
      }
      };

      try {
        return await attempt();
      } catch (firstErr: any) {
        const msg = String(firstErr?.message || '').toLowerCase();
        const retryable =
          msg.includes('network') ||
          msg.includes('timeout') ||
          msg.includes('failed to fetch') ||
          msg.includes('fetch failed') ||
          msg.includes('econnreset');
        if (retryable) {
          console.warn('[Upload] retrying once after error:', firstErr?.message);
          setUploadProgress('Retrying upload…');
          return await attempt();
        }
        throw firstErr;
      }
    } catch (e: any) {
      console.error('[Upload] Video failed:', e);
      const msg =
        e?.message === 'CANCELLED'
          ? 'Upload cancelled.'
          : e?.message || 'Could not upload video. Check your connection and try again.';
      setUploadError(msg);
      return { ok: false, error: msg };
    }
  };

  const uploadThumbnail = async (uri: string): Promise<string | null> => {
    try {
      if (!uri) return null;
      const formData = new FormData();
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        formData.append('image', blob, 'reel-thumbnail.jpg');
      } else {
        formData.append('image', { uri, type: 'image/jpeg', name: 'reel-thumbnail.jpg' } as any);
      }
      const res = await apiRequest('POST', '/api/upload-image', formData, {
        timeoutMs: 180000,
        retries: 2,
      });
      const data = await res.json();
      if (!data.success) return null;
      return data.url || null;
    } catch (e) {
      console.error('[Upload] Thumbnail failed:', e);
      return null;
    }
  };

  const publishBunnyReelWhenReady = useCallback(async (reelBody: Record<string, unknown>) => {
    const videoId = String(reelBody.videoId || '').trim();
    const startedAt = Date.now();

    while (true) {
      try {
        const res = await apiRequest('POST', '/api/reels', reelBody, {
          timeoutMs: 120000,
          retries: 2,
        });
        return await res.json();
      } catch (e: any) {
        const msg = String(e?.message || e?.detail || e || '');
        const stillProcessing = /still processing/i.test(msg);
        if (!stillProcessing || !videoId) throw e;

        if (Date.now() - startedAt >= ENCODING_POLL_MS) {
          throw new Error('Video upload finished, but Bunny is still processing it. Please try posting again shortly.');
        }

        setUploadProgress('Processing video… publishing when ready');
        try {
          const statusRes = await apiRequest('GET', `/api/bunny/video-status/${videoId}`, undefined, {
            timeoutMs: 60000,
            retries: 1,
          });
          const statusData = await statusRes.json();
          const pct = Math.max(0, Math.min(100, Number(statusData?.encodeProgress || 0)));
          setUploadPercent(95 + Math.min(5, Math.round((pct / 100) * 5)));
          if (typeof statusData?.status === 'number' && statusData.status === 4) {
            throw new Error('Bunny encoding failed');
          }
        } catch (statusErr: any) {
          if (/encoding failed/i.test(String(statusErr?.message || ''))) throw statusErr;
        }

        await new Promise((resolve) => setTimeout(resolve, ENCODING_RETRY_MS));
      }
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!videoUri) {
      Alert.alert('No video', 'Please select a video first.');
      return;
    }
    if (!profile) return;

    setIsUploading(true);
    setUploadError(null);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      setUploadPercent(0);
      setUploadProgress('Starting…');
      const uploadResult = await uploadVideo(videoUri);
      if (!uploadResult.ok) {
        Alert.alert('Upload Failed', uploadResult.error);
        setIsUploading(false);
        return;
      }

      setUploadProgress('Saving reel…');
      const thumbnailUrl = localThumbUri ? await uploadThumbnail(localThumbUri) : '';

      const reelBody =
        uploadResult.mode === 'bunny'
          ? {
              userId: profile.id,
              userName: profile.name,
              userAvatar: profile.avatar || '',
              title: title.trim(),
              description: description.trim(),
              videoId: uploadResult.videoId,
              thumbnailUrl: thumbnailUrl || '',
            }
          : {
              userId: profile.id,
              userName: profile.name,
              userAvatar: profile.avatar || '',
              title: title.trim(),
              description: description.trim(),
              videoUrl: uploadResult.videoUrl,
              thumbnailUrl: thumbnailUrl || '',
            };

      const data =
        uploadResult.mode === 'bunny'
          ? await publishBunnyReelWhenReady(reelBody)
          : await (async () => {
              const res = await apiRequest('POST', '/api/reels', reelBody, {
                timeoutMs: 120000,
                retries: 2,
              });
              return await res.json();
            })();
      if (data.success) {
        const savedVideoUrl = String(data?.reel?.videoUrl || '');
        if (savedVideoUrl && !isPlayableVideoUrl(savedVideoUrl)) {
          throw new Error('Reel was saved without a playable video URL');
        }
        setUploadProgress('');
        setUploadPercent(0);
        router.back();
      } else {
        Alert.alert('Error', data.message || 'Failed to create reel.');
      }
    } catch (e: any) {
      console.error('[Reel] Create error:', e);
      Alert.alert('Error', e?.message || 'Something went wrong.');
    } finally {
      setIsUploading(false);
      setUploadProgress('');
      setUploadPercent(0);
    }
  }, [videoUri, title, description, profile, localThumbUri, videoMeta, webPickedFile, publishBunnyReelWhenReady]);

  const canUpload = profile?.role === 'teacher' || profile?.role === 'supplier' || profile?.role === 'technician' || profile?.role === 'shopkeeper';

  if (!canUpload) {
    return (
      <View style={[styles.container, styles.center]}>
        <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 10 }]}>
          <Pressable hitSlop={12} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={26} color={C.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Upload Reel</Text>
          <View style={{ width: 40 }} />
        </View>
        <Ionicons name="lock-closed-outline" size={56} color={C.textTertiary} />
        <Text style={styles.restrictedTitle}>Restricted Access</Text>
        <Text style={styles.restrictedText}>Only technicians, teachers, suppliers and shopkeepers can upload reels</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 10 }]}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Upload Reel</Text>
        <Pressable
          style={[styles.postBtn, (!videoUri || isUploading) && styles.postBtnDisabled]}
          disabled={!videoUri || isUploading}
          onPress={handleSubmit}
        >
          {isUploading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.postBtnText}>Post</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.content}>
        {videoUri ? (
          <View style={styles.previewContainer}>
            <VideoView
              player={player}
              style={styles.videoPreview}
              contentFit="cover"
              nativeControls
            />
            {localThumbUri && (
              <View style={styles.thumbBadgeRow}>
                <Image source={{ uri: localThumbUri }} style={styles.thumbBadge} contentFit="cover" />
                <Text style={styles.thumbBadgeText}>Auto-thumbnail will be generated</Text>
              </View>
            )}
            <Pressable style={styles.changeVideoBtn} onPress={pickVideo}>
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.changeVideoText}>Change</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.pickVideoArea} onPress={pickVideo}>
            <View style={styles.pickVideoIcon}>
              <Ionicons name="videocam" size={40} color={C.primary} />
            </View>
            <Text style={styles.pickVideoTitle}>Select Video</Text>
            <Text style={styles.pickVideoSubtitle}>From your gallery</Text>
            <View style={styles.limitsBadge}>
              <Ionicons name="information-circle-outline" size={13} color={C.textSecondary} />
              <Text style={styles.limitsText}>
                Up to {MAX_VIDEO_SIZE_MB} MB (direct to Bunny) · Max {MAX_VIDEO_DURATION_SECS / 60} min
              </Text>
            </View>
          </Pressable>
        )}

        <TextInput
          style={styles.input}
          placeholder="Title (optional)"
          placeholderTextColor={C.textTertiary}
          value={title}
          onChangeText={setTitle}
          maxLength={100}
        />

        <TextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="Description (optional)"
          placeholderTextColor={C.textTertiary}
          value={description}
          onChangeText={setDescription}
          maxLength={500}
          multiline
          numberOfLines={3}
        />

        {isUploading && (
          <View style={styles.uploadingOverlay}>
            {uploadProgress ? (
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
              </View>
            ) : (
              <>
                <ActivityIndicator size="large" color={C.primary} />
                <Text style={styles.uploadingText}>Uploading video...</Text>
              </>
            )}
          </View>
        )}

        {!isUploading && uploadError && videoUri ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{uploadError}</Text>
            <Pressable
              style={styles.retryBtn}
              onPress={() => {
                setUploadError(null);
                void handleSubmit();
              }}
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.retryBtnText}>Retry upload</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.background,
    zIndex: 10,
  },
  headerTitle: {
    color: C.text,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  postBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 70,
    alignItems: 'center',
  },
  postBtnDisabled: {
    opacity: 0.5,
  },
  postBtnText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  pickVideoArea: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: C.border,
    borderStyle: 'dashed',
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  pickVideoIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.primaryMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  pickVideoTitle: {
    color: C.text,
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 4,
  },
  pickVideoSubtitle: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginBottom: 10,
  },
  limitsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.surfaceHighlight || '#F3F4F6',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  limitsText: {
    color: C.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  previewContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    height: 300,
    backgroundColor: '#000',
  },
  videoPreview: {
    width: '100%',
    height: '100%',
  },
  thumbBadgeRow: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 10,
    padding: 5,
    gap: 6,
  },
  thumbBadge: {
    width: 30,
    height: 42,
    borderRadius: 5,
  },
  thumbBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  changeVideoBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  changeVideoText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  input: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: C.text,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  inputMultiline: {
    height: 90,
    textAlignVertical: 'top',
  },
  uploadingOverlay: {
    alignItems: 'center',
    paddingTop: 20,
  },
  uploadingText: {
    color: C.textSecondary,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginTop: 12,
  },
  restrictedTitle: {
    color: C.text,
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 16,
  },
  restrictedText: {
    color: C.textSecondary,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginTop: 6,
  },
  progressContainer: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  progressTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  progressText: {
    color: C.text,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: C.surfaceElevated,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: C.primary,
    borderRadius: 4,
  },
  progressPercentBig: {
    color: C.primary,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginTop: 4,
  },
  errorBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginBottom: 12,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryBtnText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
});
