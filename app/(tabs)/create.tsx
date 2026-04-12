import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, Platform,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { getApiUrl } from '@/lib/query-client';
import { PostCategory } from '@/lib/types';

const C = Colors.light;

const CATEGORIES: { key: PostCategory; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { key: 'repair', label: 'Repair Work', icon: 'construct', color: '#34C759' },
  { key: 'job', label: 'Job', icon: 'briefcase', color: '#5E8BFF' },
  { key: 'training', label: 'Training', icon: 'school', color: '#FFD60A' },
  { key: 'supplier', label: 'Supplier', icon: 'cube', color: '#FF6B2C' },
];

const QUICK_ISSUES = [
  'Screen Broken',
  'Battery Issue',
  'Not Charging',
  'Water Damage',
  'Camera Not Working',
  'Speaker Issue',
  'Mic Not Working',
  'Touch Not Responding',
  'Software Issue',
  'Back Panel Broken',
];

export default function CreatePostScreen() {
  const insets = useSafeAreaInsets();
  const { profile, addPost } = useApp();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<PostCategory>('repair');
  const [images, setImages] = useState<any[]>([]);
  const [videoAsset, setVideoAsset] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);

  const isWeb = Platform.OS === 'web';
  const webTopInset = isWeb ? 67 : 0;

  const pickImages = async () => {
    try {
      if (!isWeb) {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Please grant permission to access your photos.');
          return;
        }
      }
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.5,
        selectionLimit: 4,
        base64: false, // Mobile uses URI-based FormData; web uses canvas resize — never need base64 from picker
      });

      if (!result.canceled && result.assets) {
        setImages(prev => [...prev, ...result.assets].slice(0, 4));
        if (!isWeb) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e: any) {
      Alert.alert('Error', 'Could not access photos: ' + (e.message || 'Unknown error'));
    }
  };


  const takePhoto = async () => {
    try {
      if (!isWeb) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Camera permission is required to take photos.');
          return;
        }
      }
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera permission is required to take photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.65,
        base64: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        setImages(prev => [...prev, result.assets[0]].slice(0, 4));
        if (!isWeb) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e: any) {
      Alert.alert('Camera Error', e?.message || 'Could not open camera.');
    }
  };

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  const pickVideo = async () => {
    try {
      if (!isWeb) {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Please grant permission to access your videos.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsMultipleSelection: false,
        quality: 1,
        base64: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        setVideoAsset(result.assets[0]);
        if (!isWeb) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e: any) {
      Alert.alert('Error', 'Could not access videos: ' + (e.message || 'Unknown error'));
    }
  };

  const uploadVideo = useCallback(async (asset: any): Promise<string> => {
    const baseUrl = getApiUrl();
    setUploadProgress('Uploading reel...');
    const uploadUrl = new URL('/api/upload-video', baseUrl).toString();
    const formData = new FormData();
    const ext = asset.uri?.split('.').pop() || 'mp4';
    const filename = `reel_${Date.now()}.${ext}`;
    const file = {
      uri: asset.uri,
      name: filename,
      type: asset.mimeType || 'video/mp4',
    } as any;
    formData.append('video', file);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData as any, signal: controller.signal });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => '(no error text)');
        throw new Error(`Server error ${uploadRes.status}: ${errText}`);
      }
      const data = await uploadRes.json();
      if (data.success && data.url) return data.url;
      throw new Error(data.message || 'Video upload returned no URL');
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const resizeImageForWeb = useCallback(async (asset: any): Promise<{ base64: string; mimeType: string }> => {
    const MAX_SIDE = 1024;
    const QUALITY = 0.7;
    const srcUri: string = asset.uri || '';

    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_SIDE || height > MAX_SIDE) {
          if (width > height) {
            height = Math.round((height / width) * MAX_SIDE);
            width = MAX_SIDE;
          } else {
            width = Math.round((width / height) * MAX_SIDE);
            height = MAX_SIDE;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
        const base64 = dataUrl.split(',')[1];
        resolve({ base64, mimeType: 'image/jpeg' });
      };
      img.onerror = () => {
        // Canvas resize failed — fall back to original base64
        const rawBase64 = asset.base64 || srcUri?.split(',')[1] || '';
        resolve({ base64: rawBase64, mimeType: asset.mimeType || 'image/jpeg' });
      };
      // Prefer data-URI (already in memory) over blob URL to avoid re-fetch
      if (srcUri.startsWith('data:')) {
        img.src = srcUri;
      } else if (asset.base64) {
        img.src = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
      } else {
        img.src = srcUri;
      }
    });
  }, []);

  const uploadImage = useCallback(async (asset: any, index: number, total: number): Promise<string | null> => {
    const baseUrl = getApiUrl();
    setUploadProgress(total > 1 ? `Uploading photo ${index + 1} of ${total}...` : 'Uploading photo...');
    try {
      if (isWeb) {
        // Resize on web first — reduces 1-4 MB photos to <200 KB before upload
        const { base64, mimeType } = await resizeImageForWeb(asset);
        if (!base64) throw new Error('No image data available for upload');
        const uploadUrl = new URL('/api/upload-base64', baseUrl).toString();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mimeType }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!uploadRes.ok) {
          const errText = await uploadRes.text().catch(() => '(no error text)');
          throw new Error(`Server error ${uploadRes.status}: ${errText}`);
        }
        const data = await uploadRes.json();
        if (data.success && data.url) return data.url;
        throw new Error(data.message || 'Upload returned no URL');
      } else {
        // Mobile: multipart FormData with native uri object
        const uploadUrl = new URL('/api/upload', baseUrl).toString();
        const formData = new FormData();
        const filename = `photo_${Date.now()}.jpg`;
        const file = {
          uri: asset.uri,
          name: filename,
          type: asset.mimeType || 'image/jpeg',
        } as any;
        formData.append('image', file);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData as any, signal: controller.signal });
        clearTimeout(timeout);
        if (!uploadRes.ok) {
          const errText = await uploadRes.text().catch(() => '(no error text)');
          throw new Error(`Server error ${uploadRes.status}: ${errText}`);
        }
        const data = await uploadRes.json();
        if (data.success && data.url) return data.url;
        throw new Error(data.message || 'Upload returned no URL');
      }
    } catch (e: any) {
      console.error(`[Upload] Image ${index + 1} FAILED:`, e?.message || String(e));
      setUploadProgress('');
      setUploadPercent(0);
      throw e;
    }
  }, [isWeb, resizeImageForWeb]);

  const uploadImages = useCallback(async (assets: any[]) => {
    const results = await Promise.allSettled(assets.map((asset, index) => uploadImage(asset, index, assets.length)));
    return {
      uploadedImages: results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled' && typeof r.value === 'string')
        .map(r => r.value),
      failed: results.filter(r => r.status === 'rejected').length,
      errors: results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => String(r.reason?.message || r.reason || 'Upload failed')),
    };
  }, [uploadImage]);

  const handleSubmit = async () => {
    if (!text.trim() && images.length === 0 && !videoAsset) {
      Alert.alert('Missing content', 'Please write something or add media before posting.');
      return;
    }
    if (!profile) {
      Alert.alert('Profile required', 'Please complete your profile first.');
      return;
    }

    setIsSubmitting(true);
    if (!isWeb) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      let uploadedImages: string[] = [];
      if (images.length > 0) {
        setUploadProgress(`Uploading ${images.length} photo${images.length > 1 ? 's' : ''}...`);
        const { uploadedImages: urls, failed, errors } = await uploadImages(images);
        uploadedImages = urls;
        if (uploadedImages.length === 0) {
          Alert.alert('Photo Upload Failed', `Could not upload photos: ${errors[0] || 'Unknown error'}\n\nPlease check your connection and try again.`);
          setIsSubmitting(false);
          setUploadProgress('');
          setUploadPercent(0);
          return;
        }
        if (failed > 0) {
          Alert.alert('Partial Upload', `${uploadedImages.length} of ${images.length} photos uploaded. Posting with available photos.`);
        }
        setUploadProgress('');
      }

      let finalVideoUrl = '';
      if (videoAsset) {
        try {
          finalVideoUrl = await uploadVideo(videoAsset);
          setUploadProgress('');
        } catch (e: any) {
          Alert.alert('Reel Upload Failed', `Could not upload video: ${e?.message || 'Unknown error'}\n\nPlease check your connection and try again.`);
          setIsSubmitting(false);
          setUploadProgress('');
          setUploadPercent(0);
          return;
        }
      }

      setUploadProgress('Creating post...');
      await addPost({
        userId: profile.id,
        userName: profile.name,
        userRole: profile.role,
        userAvatar: profile.avatar || '',
        text: text.trim(),
        images: uploadedImages,
        videoUrl: finalVideoUrl,
        category,
      } as any);

      setText('');
      setImages([]);
      setVideoAsset(null);
      setCategory('repair');
      setUploadProgress('Post created!');
      setUploadPercent(100);
      
      // Brief delay to show success message
      await new Promise(r => setTimeout(r, 500));
      router.navigate('/(tabs)');
    } catch (e: any) {
      console.error('[CreatePost] Submit failed:', e instanceof Error ? e.message : String(e));
      Alert.alert('Post Failed', `Something went wrong: ${(e?.message || 'Unknown error').slice(0, 120)}\n\nPlease try again.`);
    } finally {
      setIsSubmitting(false);
      setUploadProgress('');
      setUploadPercent(0);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: (isWeb ? webTopInset : insets.top) + 16,
          paddingBottom: isWeb ? 84 + 34 : 100,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Create Post</Text>
      <Text style={styles.subtitle}>Share with the repair community</Text>

      <Text style={styles.label}>Category</Text>
      <View style={styles.categoryGrid}>
        {CATEGORIES.map(cat => (
          <Pressable
            key={cat.key}
            style={[
              styles.categoryCard,
              category === cat.key && { borderColor: cat.color, backgroundColor: cat.color + '12' },
            ]}
            onPress={() => {
              setCategory(cat.key);
              if (!isWeb) Haptics.selectionAsync();
            }}
          >
            <View style={[styles.categoryIcon, { backgroundColor: cat.color + '20' }]}>
              <Ionicons name={cat.icon} size={22} color={cat.color} />
            </View>
            <Text style={[
              styles.categoryLabel,
              category === cat.key && { color: cat.color },
            ]}>{cat.label}</Text>
            {category === cat.key && (
              <View style={[styles.checkCircle, { backgroundColor: cat.color }]}>
                <Ionicons name="checkmark" size={14} color="#FFF" />
              </View>
            )}
          </Pressable>
        ))}
      </View>

      {category === 'repair' && profile?.role === 'customer' && (
        <>
          <Text style={styles.label}>Quick Issue</Text>
          <View style={styles.quickIssueGrid}>
            {QUICK_ISSUES.map(issue => {
              const selected = text.includes(issue);
              return (
                <Pressable
                  key={issue}
                  style={[styles.quickIssueChip, selected && styles.quickIssueChipActive]}
                  onPress={() => {
                    if (selected) {
                      setText(text.replace(issue, '').replace(/\s+/g, ' ').trim());
                    } else {
                      setText(prev => (prev ? `${prev.trim()} ${issue}` : issue));
                    }
                    if (Platform.OS !== 'web') Haptics.selectionAsync();
                  }}
                >
                  <Text style={[styles.quickIssueText, selected && styles.quickIssueTextActive]}>{issue}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.label}>Content</Text>
      <View style={styles.textInputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder="Share your repair experience, tip, job opening, or supply update..."
          placeholderTextColor={C.textTertiary}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1000}
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{text.length}/1000</Text>
      </View>

      <Text style={styles.label}>Media</Text>
      <View style={styles.imageSection}>
        <Pressable
          style={({ pressed }) => [styles.reelAlwaysBtn, pressed && { opacity: 0.75 }]}
          onPress={() => router.push('/reels')}
        >
          <View style={styles.reelAlwaysIcon}>
            <Ionicons name="play-circle" size={24} color="#AF52DE" />
          </View>
          <View style={styles.reelAlwaysTextWrap}>
            <Text style={styles.reelBannerTitle}>Open Reels</Text>
            <Text style={styles.reelBannerSubtitle}>Go to the reel feed and upload from there</Text>
          </View>
        </Pressable>
        {images.length > 0 && (
          <View style={styles.imagePreviewRow}>
            {images.map((asset, idx) => (
              <View key={idx} style={styles.imagePreview}>
                <Image source={{ uri: asset.uri }} style={styles.previewImage} contentFit="cover" />
                <Pressable style={styles.removeImageBtn} onPress={() => removeImage(idx)}>
                  <Ionicons name="close-circle" size={22} color="#FF3B30" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {videoAsset && (
          <View style={styles.videoPreviewCard}>
            <View style={styles.videoPreviewIcon}>
              <Ionicons name="play-circle" size={28} color={C.primary} />
            </View>
            <View style={styles.videoPreviewInfo}>
              <Text style={styles.videoPreviewTitle} numberOfLines={1}>
                {videoAsset.fileName || videoAsset.uri?.split('/').pop() || 'Video selected'}
              </Text>
              <Text style={styles.videoPreviewSubtitle}>
                {videoAsset.duration ? `${Math.round(videoAsset.duration / 1000)}s` : 'Reel ready to post'}
              </Text>
            </View>
            <Pressable onPress={() => setVideoAsset(null)} hitSlop={8}>
              <Ionicons name="close-circle" size={22} color="#FF3B30" />
            </Pressable>
          </View>
        )}
        <View style={styles.imageButtons}>
          <View style={styles.imageButtonRow}>
            <Pressable
              style={({ pressed }) => [styles.imageBtn, pressed && { opacity: 0.7 }]}
              onPress={pickImages}
              disabled={images.length >= 4}
            >
              <Ionicons name="images-outline" size={22} color={images.length >= 4 ? C.textTertiary : C.primary} />
              <Text style={[styles.imageBtnText, images.length >= 4 && { color: C.textTertiary }]}>Gallery</Text>
            </Pressable>
            {Platform.OS !== 'web' && (
              <Pressable
                style={({ pressed }) => [styles.imageBtn, pressed && { opacity: 0.7 }]}
                onPress={takePhoto}
                disabled={images.length >= 4}
              >
                <Ionicons name="camera-outline" size={22} color={images.length >= 4 ? C.textTertiary : C.primary} />
                <Text style={[styles.imageBtnText, images.length >= 4 && { color: C.textTertiary }]}>Camera</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.imageCount}>{images.length}/4</Text>
        </View>
      </View>

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
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.submitBtn,
          pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
          (isSubmitting || (!text.trim() && images.length === 0 && !videoAsset)) && { opacity: 0.5 },
        ]}
        onPress={handleSubmit}
        disabled={isSubmitting || (!text.trim() && images.length === 0 && !videoAsset)}
      >
        <Ionicons name="send" size={20} color="#FFF" />
        <Text style={styles.submitText}>
          {isSubmitting ? 'Posting...' : 'Publish Post'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  content: {
    paddingHorizontal: 20,
  },
  title: {
    color: C.text,
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  subtitle: {
    color: C.textTertiary,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
    marginBottom: 24,
  },
  label: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  categoryCard: {
    width: '47%' as any,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    gap: 8,
    position: 'relative',
  },
  categoryIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  checkCircle: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInputContainer: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 24,
  },
  textInput: {
    color: C.text,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    minHeight: 100,
    lineHeight: 22,
    padding: 0,
  },
  charCount: {
    color: C.textTertiary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'right',
    marginTop: 8,
  },
  imageSection: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 24,
  },
  imagePreviewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  imagePreview: {
    width: 80,
    height: 80,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  removeImageBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
  },
  videoPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceElevated,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  videoPreviewIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: C.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPreviewInfo: {
    flex: 1,
  },
  videoPreviewTitle: {
    color: C.text,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  videoPreviewSubtitle: {
    color: C.textTertiary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  imageButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  imageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surfaceElevated,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  imageBtnText: {
    color: C.primary,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  imageCount: {
    color: C.textTertiary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginLeft: 'auto',
  },
  reelAlwaysBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderColor: '#AF52DE',
    backgroundColor: '#AF52DE' + '10',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  reelAlwaysIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#AF52DE' + '16',
  },
  reelAlwaysTextWrap: {
    flex: 1,
  },
  reelBannerTitle: {
    color: C.text,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  reelBannerSubtitle: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  reelBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#AF52DE' + '18',
    borderWidth: 1,
    borderColor: '#AF52DE' + '35',
  },
  reelWebNote: {
    color: C.textTertiary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  reelBtnActive: {
    borderColor: C.border,
    backgroundColor: C.surfaceElevated,
  },
  reelBtnText: {
    color: '#AF52DE',
  },
  submitBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitText: {
    color: '#FFF',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  sellCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF2D55',
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    gap: 12,
    shadowColor: '#FF2D55',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  sellCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellCardText: {
    flex: 1,
  },
  sellCardTitle: {
    color: '#FFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  sellCardSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
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
  quickIssueGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  quickIssueChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  quickIssueChipActive: {
    backgroundColor: '#34C759' + '18',
    borderColor: '#34C759',
  },
  quickIssueText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.textSecondary,
  },
  quickIssueTextActive: {
    color: '#34C759',
    fontFamily: 'Inter_600SemiBold',
  },
});
