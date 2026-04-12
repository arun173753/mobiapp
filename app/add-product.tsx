import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, Platform,
  ScrollView, Alert, ActivityIndicator, Switch, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { ProductCategory, TEACHER_CATEGORIES, SUPPLIER_CATEGORIES } from '@/lib/types';

const C = Colors.light;
const MAX_VIDEO_SIZE_MB = 500;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

export default function AddProductScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ productId?: string }>();
  const isTeacher = profile?.role === 'teacher';
  const categories = isTeacher ? TEACHER_CATEGORIES : SUPPLIER_CATEGORIES;
  const isEditMode = !!params.productId;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<ProductCategory>(categories[0].key);
  const [images, setImages] = useState<string[]>([]);
  const [thumbnail, setThumbnail] = useState<string>('');
  const [inStock, setInStock] = useState(true);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string>('');
  const [deliveryInfo, setDeliveryInfo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const [uploadProgress, setUploadProgress] = useState('');

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  useEffect(() => {
    if (isEditMode && params.productId) {
      setLoadingEdit(true);
      apiRequest('GET', `/api/products/${params.productId}`)
        .then(r => r.json())
        .then(data => {
          if (data.success === false) {
            Alert.alert('Error', data.message || 'Failed to load product');
            setLoadingEdit(false);
            return;
          }
          setTitle(data.title || '');
          setDescription(data.description || '');
          setPrice(data.price || '');
          setCategory(data.category || categories[0].key);
          setDeliveryInfo(data.deliveryInfo || '');
          setInStock(data.inStock !== 0);
          const imgs = (() => { try { return JSON.parse(data.images || '[]'); } catch { return []; } })();
          setImages(imgs);
          setThumbnail(data.thumbnail || '');
          setLoadingEdit(false);
        })
        .catch(e => {
          console.error('[AddProduct] Load error:', e);
          Alert.alert('Error', 'Failed to load product');
          setLoadingEdit(false);
        });
    }
  }, [params.productId]);

  const openAppSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  const pickImages = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photo Access Required',
          'Mobi needs access to your photo library. Please enable it in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: openAppSettings },
          ]
        );
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.7,
      base64: Platform.OS === 'web',
      selectionLimit: 5 - images.length,
    });
    if (!result.canceled && result.assets) {
      const newUris = result.assets.map(a => a.uri);
      setImages(prev => [...prev, ...newUris].slice(0, 5));
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const takePhoto = async () => {
    if (images.length >= 5) {
      Alert.alert('Limit reached', 'You can add up to 5 photos.');
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Camera Access Required',
        'Mobi needs camera access to take photos. Please enable it in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: openAppSettings },
        ]
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: Platform.OS === 'web',
    });
    if (!result.canceled && result.assets) {
      setImages(prev => [...prev, result.assets[0].uri].slice(0, 5));
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const pickVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: false,
      quality: 0.8,
      videoMaxDuration: 3600,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];

      if (asset.fileSize && asset.fileSize > MAX_VIDEO_SIZE_BYTES) {
        Alert.alert('Too Large', `Video must be under ${MAX_VIDEO_SIZE_MB}MB. Your video is ${Math.round(asset.fileSize / (1024 * 1024))}MB.`);
        return;
      }

      setVideoUri(asset.uri);
      setVideoFileName(asset.fileName || 'video.mp4');
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const uploadImage = async (uri: string): Promise<string> => {
    const baseUrl = getApiUrl();

    if (Platform.OS === 'web') {
      const uploadUrl = new URL('/api/upload-base64', baseUrl).toString();
      const response = await window.fetch(uri);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      const base64 = btoa(binary);
      const uploadRes = await window.fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mimeType: blob.type || 'image/jpeg' }),
      });
      const data = await uploadRes.json();
      if (!data.success) throw new Error(data.message || 'Upload failed');
      return data.url;
    } else {
      const uploadUrl = new URL('/api/upload', baseUrl).toString();
      const formData = new FormData();
      const file = { uri, name: 'product.jpg', type: 'image/jpeg' };
      formData.append('image', file as unknown as Blob);
      const uploadRes = await globalThis.fetch(uploadUrl, { method: 'POST', body: formData as any });
      const data = await uploadRes.json();
      if (!data.success) throw new Error(data.message || 'Upload failed');
      return data.url;
    }
  };

  const uploadVideo = async (uri: string): Promise<string> => {
    const baseUrl = getApiUrl();
    const uploadUrl = new URL('/api/upload-video', baseUrl).toString();
    const formData = new FormData();

    if (Platform.OS === 'web') {
      const response = await window.fetch(uri);
      const blob = await response.blob();
      formData.append('video', blob, 'video.mp4');
      const uploadRes = await window.fetch(uploadUrl, { method: 'POST', body: formData });
      const data = await uploadRes.json();
      if (!data.success) throw new Error(data.message || 'Video upload failed');
      return data.url;
    } else {
      const file = { uri, name: 'video.mp4', type: 'video/mp4' };
      formData.append('video', file as unknown as Blob);
      const uploadRes = await globalThis.fetch(uploadUrl, { method: 'POST', body: formData as any });
      const data = await uploadRes.json();
      if (!data.success) throw new Error(data.message || 'Video upload failed');
      return data.url;
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) { Alert.alert('Required', 'Please add a title'); return; }
    if (!price.trim()) { Alert.alert('Required', 'Please add a price'); return; }
    if (!profile) return;

    setIsSubmitting(true);
    try {
      setUploadProgress('Uploading images...');
      const uploadedImages: string[] = [];
      for (const uri of images) {
        const url = await uploadImage(uri);
        uploadedImages.push(url);
      }

      let uploadedThumbnail = '';
      if (thumbnail) {
        setUploadProgress('Uploading thumbnail...');
        uploadedThumbnail = await uploadImage(thumbnail);
      }

      let uploadedVideoUrl = '';
      if (videoUri) {
        setUploadProgress('Uploading video... This may take a while for large files');
        uploadedVideoUrl = await uploadVideo(videoUri);
      }

      setUploadProgress('Publishing...');
      const res = await apiRequest('POST', '/api/products', {
        id: isEditMode ? params.productId : undefined,
        userId: profile.id,
        userName: profile.name,
        userRole: profile.role,
        userAvatar: profile.avatar || '',
        title: title.trim(),
        description: description.trim(),
        price: price.trim(),
        category,
        images: uploadedImages,
        thumbnail: uploadedThumbnail,
        videoUrl: uploadedVideoUrl,
        city: profile.city,
        state: profile.state,
        inStock: inStock ? 1 : 0,
        deliveryInfo: deliveryInfo.trim(),
        contactPhone: profile.phone,
      });
      const data = await res.json();

      if (!data.success) {
        Alert.alert('Error', data.message || 'Failed to publish. Please try again.');
        return;
      }

      // Invalidate products cache so marketplace refreshes with new product
      await queryClient.invalidateQueries({ queryKey: ['/api/products'] });

      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (Platform.OS === 'web') {
        window.alert(isTeacher ? 'Your content has been listed successfully!' : 'Your product has been listed successfully!');
        router.replace('/(tabs)/products');
      } else {
        Alert.alert(
          'Listed!',
          isTeacher ? 'Your content has been listed successfully' : 'Your product has been listed successfully',
          [{ text: 'OK', onPress: () => router.replace('/(tabs)/products') }]
        );
      }
    } catch (e) {
      console.error('[AddProduct] Error:', e);
      Alert.alert('Error', 'Failed to create listing. Please try again.');
    } finally {
      setIsSubmitting(false);
      setUploadProgress('');
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={28} color={C.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>
          {isEditMode ? 'Edit' : 'Add'} {isTeacher ? 'Content' : 'Product'}
        </Text>
        <Pressable
          style={[styles.publishBtn, (!title.trim() || !price.trim() || isSubmitting) && styles.publishBtnDisabled]}
          onPress={handleSubmit}
          disabled={!title.trim() || !price.trim() || isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={styles.publishText}>Publish</Text>
          )}
        </Pressable>
      </View>

      {loadingEdit ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={{ color: C.textSecondary, marginTop: 12, fontFamily: 'Inter_400Regular' }}>Loading product...</Text>
        </View>
      ) : (
      <ScrollView style={styles.form} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Title *</Text>
        <TextInput
          style={styles.input}
          placeholder={isTeacher ? 'e.g., Mobile Repair Complete Course' : 'e.g., iPhone Display IC'}
          placeholderTextColor={C.textTertiary}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.sectionLabel}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder={isTeacher ? 'Describe what students will learn...' : 'Describe your product, specifications...'}
          placeholderTextColor={C.textTertiary}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
        />

        <Text style={styles.sectionLabel}>Price (Rs.) *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 999"
          placeholderTextColor={C.textTertiary}
          value={price}
          onChangeText={setPrice}
          keyboardType="numeric"
        />

        <Text style={styles.sectionLabel}>Category</Text>
        <View style={styles.categoryRow}>
          {categories.map(c => (
            <Pressable
              key={c.key}
              style={[styles.categoryChip, category === c.key && styles.categoryChipActive]}
              onPress={() => setCategory(c.key)}
            >
              <Text style={[styles.categoryText, category === c.key && styles.categoryTextActive]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Photos (up to 5)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagesScroll}>
          {Platform.OS !== 'web' && (
            <Pressable style={styles.addImageBtn} onPress={takePhoto}>
              <Ionicons name="camera" size={28} color={C.primary} />
              <Text style={[styles.addImageText, { color: C.primary }]}>Camera</Text>
            </Pressable>
          )}
          <Pressable style={styles.addImageBtn} onPress={pickImages}>
            <Ionicons name="images-outline" size={28} color={C.textTertiary} />
            <Text style={styles.addImageText}>Gallery</Text>
          </Pressable>
          {images.map((uri, i) => (
            <View key={i} style={styles.imageWrapper}>
              <Image source={{ uri }} style={styles.imageThumb} contentFit="cover" />
              <Pressable
                style={styles.removeImageBtn}
                onPress={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
              >
                <Ionicons name="close-circle" size={22} color={C.error} />
              </Pressable>
            </View>
          ))}
        </ScrollView>

        <Text style={styles.sectionLabel}>Thumbnail (Discover page)</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {thumbnail ? (
            <View style={[styles.imageWrapper, { flex: 1 }]}>
              <Image source={{ uri: thumbnail }} style={styles.imageThumb} contentFit="cover" />
              <Pressable
                style={styles.removeImageBtn}
                onPress={() => setThumbnail('')}
              >
                <Ionicons name="close-circle" size={22} color={C.error} />
              </Pressable>
            </View>
          ) : (
            <Pressable 
              style={[styles.addImageBtn, { flex: 1, height: 100 }]} 
              onPress={async () => {
                const result = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ['images'],
                  quality: 0.8,
                });
                if (!result.canceled && result.assets[0]) {
                  setThumbnail(result.assets[0].uri);
                }
              }}
            >
              <Ionicons name="image-outline" size={28} color={C.textTertiary} />
              <Text style={styles.addImageText}>Pick Thumbnail</Text>
            </Pressable>
          )}
        </View>

        {isTeacher && (
          <>
            <Text style={styles.sectionLabel}>Video (up to 500MB)</Text>
            {videoUri ? (
              <View style={styles.videoSelected}>
                <View style={styles.videoInfo}>
                  <Ionicons name="videocam" size={24} color={C.primary} />
                  <Text style={styles.videoFileName} numberOfLines={1}>{videoFileName}</Text>
                </View>
                <Pressable onPress={() => { setVideoUri(null); setVideoFileName(''); }} hitSlop={8}>
                  <Ionicons name="close-circle" size={24} color={C.error} />
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.addVideoBtn} onPress={pickVideo}>
                <Ionicons name="videocam-outline" size={28} color={C.textTertiary} />
                <Text style={styles.addVideoText}>Select Video</Text>
                <Text style={styles.addVideoHint}>MP4, MOV - Max 500MB</Text>
              </Pressable>
            )}
          </>
        )}

        <Text style={styles.sectionLabel}>{isTeacher ? 'Access / Delivery Info' : 'Delivery / Shipping Info'}</Text>
        <TextInput
          style={styles.input}
          placeholder={isTeacher ? 'e.g., Lifetime access via WhatsApp' : 'e.g., All India delivery via courier'}
          placeholderTextColor={C.textTertiary}
          value={deliveryInfo}
          onChangeText={setDeliveryInfo}
        />

        {!isTeacher && (
          <View style={styles.stockRow}>
            <View>
              <Text style={[styles.sectionLabel, { marginTop: 0, marginBottom: 2 }]}>In Stock</Text>
              <Text style={{ color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
                {inStock ? 'Product is available' : 'Product is out of stock'}
              </Text>
            </View>
            <Switch
              value={inStock}
              onValueChange={setInStock}
              trackColor={{ false: C.border, true: C.primary }}
              thumbColor="#FFF"
            />
          </View>
        )}

        <View style={styles.locationInfo}>
          <Ionicons name="location-outline" size={16} color={C.textTertiary} />
          <Text style={styles.locationText}>Location: {profile?.city}, {profile?.state}</Text>
        </View>

        {isSubmitting && uploadProgress ? (
          <View style={styles.progressContainer}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={styles.progressText}>{uploadProgress}</Text>
          </View>
        ) : null}
      </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  topBarTitle: { color: C.text, fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  publishBtn: {
    backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20,
  },
  publishBtnDisabled: { opacity: 0.4 },
  publishText: { color: '#FFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  form: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  sectionLabel: {
    color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_600SemiBold',
    marginBottom: 8, marginTop: 16, textTransform: 'uppercase' as const, letterSpacing: 0.5,
  },
  input: {
    backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: C.text, fontSize: 15, fontFamily: 'Inter_400Regular',
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' as const },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  categoryChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  categoryChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  categoryText: { color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_500Medium' },
  categoryTextActive: { color: '#FFF' },
  imagesScroll: { marginTop: 4 },
  addImageBtn: {
    width: 80, height: 80, borderRadius: 12, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' as const,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  addImageText: { color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  imageWrapper: { marginRight: 10, position: 'relative' as const },
  imageThumb: { width: 80, height: 80, borderRadius: 12 },
  removeImageBtn: { position: 'absolute' as const, top: -6, right: -6 },
  addVideoBtn: {
    borderRadius: 12, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' as const,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 20,
  },
  addVideoText: { color: C.textTertiary, fontSize: 14, fontFamily: 'Inter_500Medium', marginTop: 6 },
  addVideoHint: { color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 4, opacity: 0.7 },
  videoSelected: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.primary,
  },
  videoInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 10 },
  videoFileName: { color: C.text, fontSize: 14, fontFamily: 'Inter_400Regular', flex: 1 },
  stockRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface, borderRadius: 12, padding: 14, marginTop: 20,
    borderWidth: 1, borderColor: C.border,
  },
  locationInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20,
    backgroundColor: C.surface, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
  },
  locationText: { color: C.textTertiary, fontSize: 13, fontFamily: 'Inter_400Regular' },
  progressContainer: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16,
    backgroundColor: C.surface, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
  },
  progressText: { color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_400Regular' },
});
