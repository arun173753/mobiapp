import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, Platform,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { fetch as expoFetch } from 'expo/fetch';
import { router } from 'expo-router';
import { useApp } from '@/lib/context';
import { getApiUrl } from '@/lib/query-client';

const LT = {
  text: '#1A1A1A',
  textSecondary: '#555555',
  textTertiary: '#888888',
  background: '#FFFFFF',
  surface: '#F7F7F7',
  surfaceElevated: '#EBEBEB',
  border: '#E0E0E0',
  primary: '#FF6B2C',
  accent: '#FF2D55',
};

const CONDITIONS = ['Like New', 'Good', 'Fair', 'Used'];

const SELL_CATEGORIES = [
  { key: 'mobiles', label: 'Mobiles', icon: 'phone-portrait-outline' as const },
  { key: 'electronics', label: 'Electronics', icon: 'tv-outline' as const },
  { key: 'spare_parts', label: 'Spare Parts', icon: 'hardware-chip-outline' as const },
  { key: 'tools', label: 'Tools', icon: 'construct-outline' as const },
  { key: 'ewaste', label: 'E-Waste', icon: 'trash-outline' as const },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' as const },
];

function formatSellText(title: string, price: string, condition: string, description: string, sellCategory: string): string {
  let text = `SELL_TITLE:${title}\nSELL_PRICE:${price}\nSELL_CONDITION:${condition}\nSELL_DESC:${description}`;
  if (sellCategory) text += `\nSELL_CATEGORY:${sellCategory}`;
  return text;
}

export default function SellItemScreen() {
  const insets = useSafeAreaInsets();
  const { profile, addPost } = useApp();

  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [condition, setCondition] = useState('Like New');
  const [description, setDescription] = useState('');
  const [sellCategory, setSellCategory] = useState('other');
  const [images, setImages] = useState<string[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const webTopInset = Platform.OS === 'web' ? 67 : 0;
  const webBottomInset = Platform.OS === 'web' ? 34 : 0;

  const resizeImageForWeb = async (uri: string): Promise<string> => {
    const img = new window.Image();
    // Do NOT set crossOrigin on blob URLs — they are same-origin and setting
    // crossOrigin causes the browser to reject the load with a CORS error.
    return new Promise((resolve, reject) => {
      img.onload = () => {
        const maxSide = 1024;
        let width = img.width;
        let height = img.height;
        if (width > maxSide || height > maxSide) {
          if (width > height) {
            height = Math.round((height / width) * maxSide);
            width = maxSide;
          } else {
            width = Math.round((width / height) * maxSide);
            height = maxSide;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = uri;
    });
  };

  const validateAndUploadImage = async (uri: string, index: number) => {
    try {
      setUploadingIdx(index);
      const baseUrl = getApiUrl();
      
      if (Platform.OS === 'web') {
        // Resize via canvas first (reduces payload from ~3MB to <150KB)
        const resizedDataUrl = await resizeImageForWeb(uri);
        const base64 = resizedDataUrl.split(',')[1];
        // Use /api/upload-base64 — NOT /api/upload which requires multipart/form-data
        const uploadUrl = new URL('/api/upload-base64', baseUrl).toString();
        const res = await window.fetch(uploadUrl, {
          method: 'POST',
          body: JSON.stringify({ base64, mimeType: 'image/jpeg' }),
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (!data.success || !data.url) throw new Error(data.message || 'Upload failed');
        return data.url;
      } else {
        const uploadUrl = new URL('/api/upload', baseUrl).toString();
        const formData = new FormData();
        try {
          // Try FormData first
          formData.append('image', { uri, name: `sell-${index}.jpg`, type: 'image/jpeg' } as unknown as Blob);
          const res = await globalThis.fetch(uploadUrl, { method: 'POST', body: formData as any });
          const data = await res.json();
          if (!data.success || !data.url) throw new Error(data.message || 'Upload failed');
          return data.url;
        } catch (formDataError: any) {
          // Fallback to base64
          console.log('[Sell] FormData failed, trying base64:', formDataError?.message);
          const response = await expoFetch(uri);
          const blob = await response.blob();
          const sizeInMB = blob.size / (1024 * 1024);
          if (sizeInMB > 5) {
            Alert.alert('File too large', 'Image must be under 5MB');
            return null;
          }
          const arrayBuffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode(...chunk);
          }
          const base64 = btoa(binary);
          
          const base64Url = new URL('/api/upload-base64', baseUrl).toString();
          const res = await expoFetch(base64Url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64, mimeType: 'image/jpeg' }),
            timeout: 30000,
          });
          const data = await res.json();
          if (!data.success || !data.url) throw new Error(data.message || 'Base64 upload failed');
          return data.url;
        }
      }
    } catch (e: any) {
      Alert.alert('Upload failed', (e.message || String(e)).slice(0, 100));
      return null;
    } finally {
      setUploadingIdx(null);
    }
  };

  const openAppSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  const pickImages = async () => {
    try {
      // Request permissions on Android/iOS
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
        selectionLimit: 5 - images.length,
        quality: 0.8,
      });
      if (!result.canceled && result.assets) {
        const newUris = result.assets.map(a => a.uri);
        setImages(prev => [...prev, ...newUris].slice(0, 5));
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e: any) {
      Alert.alert('Error', 'Could not pick images: ' + (e.message || 'Unknown error'));
    }
  };

  const takePhoto = async () => {
    try {
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
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (!result.canceled && result.assets) {
        setImages(prev => [...prev, result.assets[0].uri].slice(0, 5));
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {
      Alert.alert('Error', 'Could not take photo');
    }
  };

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  const postAd = async () => {
    if (!profile) {
      Alert.alert('Profile required', 'Please complete your profile first.');
      return;
    }
    if (!title.trim()) {
      Alert.alert('Required', 'Enter item name');
      return;
    }
    if (!price.trim()) {
      Alert.alert('Required', 'Enter price');
      return;
    }

    setIsPosting(true);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      let uploadedUrls: string[] = [];
      
      if (images.length > 0) {
        uploadedUrls = await Promise.all(
          images.map((uri, idx) => 
            uri.startsWith('http') ? Promise.resolve(uri) : validateAndUploadImage(uri, idx)
          )
        );
        uploadedUrls = uploadedUrls.filter(Boolean) as string[];
        
        if (uploadedUrls.length === 0) {
          Alert.alert('Error', 'Failed to upload images');
          return;
        }
      }

      const text = formatSellText(title.trim(), price.trim(), condition, description.trim(), sellCategory);
      await addPost({
        userId: profile.id,
        userName: profile.name,
        userRole: profile.role,
        userAvatar: profile.avatar || '',
        text,
        images: uploadedUrls,
        category: 'sell',
      } as any);

      Alert.alert('Posted!', 'Your ad has been listed successfully.');
      router.back();
    } catch (e) {
      Alert.alert('Error', 'Failed to post your ad. Please try again.');
    } finally {
      setIsPosting(false);
    }
  };

  const canPost = title.trim().length > 0 && price.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.header, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={LT.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Sell Something</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: (Platform.OS === 'web' ? webBottomInset : insets.bottom) + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Item Photos ({images.length}/5) - JPG/PNG, max 5MB</Text>
        <View style={styles.photosSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow}>
            {images.map((uri, i) => (
              <View key={i} style={[styles.photoThumb, uploadingIdx === i && styles.photoThumbUploading]}>
                <Image source={{ uri }} style={styles.photoThumbImage} contentFit="cover" />
                {uploadingIdx === i ? (
                  <View style={styles.uploadingOverlay}>
                    <ActivityIndicator size="small" color={LT.primary} />
                  </View>
                ) : (
                  <Pressable style={styles.photoRemoveBtn} onPress={() => removeImage(i)} disabled={isPosting}>
                    <Ionicons name="close-circle" size={22} color={LT.accent} />
                  </Pressable>
                )}
              </View>
            ))}
            {images.length < 5 && (
              <>
                <Pressable style={styles.photoAddBtn} onPress={pickImages}>
                  <Ionicons name="images-outline" size={26} color={LT.primary} />
                  <Text style={styles.photoAddLabel}>Gallery</Text>
                </Pressable>
                {Platform.OS !== 'web' && (
                  <Pressable style={styles.photoAddBtn} onPress={takePhoto}>
                    <Ionicons name="camera-outline" size={26} color={LT.primary} />
                    <Text style={styles.photoAddLabel}>Camera</Text>
                  </Pressable>
                )}
              </>
            )}
          </ScrollView>
        </View>

        <Text style={styles.sectionLabel}>Item Title *</Text>
        <TextInput
          style={styles.input}
          placeholder="What are you selling?"
          placeholderTextColor={LT.textTertiary}
          value={title}
          onChangeText={setTitle}
          maxLength={100}
        />

        <Text style={styles.sectionLabel}>Price *</Text>
        <View style={styles.priceRow}>
          <View style={styles.pricePrefix}>
            <Text style={styles.pricePrefixText}>{'\u20B9'}</Text>
          </View>
          <TextInput
            style={[styles.input, styles.priceInput]}
            placeholder="0"
            placeholderTextColor={LT.textTertiary}
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
          />
        </View>

        <Text style={styles.sectionLabel}>Condition</Text>
        <View style={styles.conditionRow}>
          {CONDITIONS.map(c => (
            <Pressable
              key={c}
              style={[styles.conditionChip, condition === c && styles.conditionChipActive]}
              onPress={() => {
                setCondition(c);
                if (Platform.OS !== 'web') Haptics.selectionAsync();
              }}
            >
              <Text style={[styles.conditionChipText, condition === c && styles.conditionChipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Category</Text>
        <View style={styles.categoryGrid}>
          {SELL_CATEGORIES.map(cat => (
            <Pressable
              key={cat.key}
              style={[styles.categoryItem, sellCategory === cat.key && styles.categoryItemActive]}
              onPress={() => {
                setSellCategory(cat.key);
                if (Platform.OS !== 'web') Haptics.selectionAsync();
              }}
            >
              <Ionicons
                name={cat.icon}
                size={20}
                color={sellCategory === cat.key ? LT.primary : LT.textSecondary}
              />
              <Text
                style={[styles.categoryItemLabel, sellCategory === cat.key && styles.categoryItemLabelActive]}
                numberOfLines={1}
              >
                {cat.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Describe your item - brand, model, age, any defects..."
          placeholderTextColor={LT.textTertiary}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          maxLength={500}
        />
        <Text style={styles.charCount}>{description.length}/500</Text>

        <Pressable
          style={({ pressed }) => [
            styles.postBtn,
            pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            (!canPost || isPosting) && { opacity: 0.5 },
          ]}
          onPress={postAd}
          disabled={!canPost || isPosting}
        >
          {isPosting ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Ionicons name="megaphone" size={20} color="#FFF" />
              <Text style={styles.postBtnText}>Post Ad</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: LT.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: LT.border,
    backgroundColor: LT.background,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: LT.text,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: LT.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 4,
  },
  photosSection: {
    marginBottom: 20,
  },
  photosRow: {
    flexDirection: 'row',
    gap: 10,
  },
  photoThumb: {
    width: 90,
    height: 90,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: LT.border,
  },
  photoThumbUploading: {
    opacity: 0.6,
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  photoThumbImage: {
    width: '100%',
    height: '100%',
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  photoAddBtn: {
    width: 90,
    height: 90,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: LT.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LT.surface,
    gap: 4,
  },
  photoAddLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: LT.textSecondary,
  },
  input: {
    backgroundColor: LT.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LT.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: LT.text,
    marginBottom: 20,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 20,
  },
  pricePrefix: {
    backgroundColor: LT.surfaceElevated,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: LT.border,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  pricePrefixText: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: LT.text,
  },
  priceInput: {
    flex: 1,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    marginBottom: 0,
  },
  conditionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  conditionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: LT.surface,
    borderWidth: 1.5,
    borderColor: LT.border,
  },
  conditionChipActive: {
    backgroundColor: LT.primary + '15',
    borderColor: LT.primary,
  },
  conditionChipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: LT.textSecondary,
  },
  conditionChipTextActive: {
    color: LT.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: LT.surface,
    borderWidth: 1.5,
    borderColor: LT.border,
  },
  categoryItemActive: {
    backgroundColor: LT.primary + '12',
    borderColor: LT.primary,
  },
  categoryItemLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: LT.textSecondary,
  },
  categoryItemLabelActive: {
    color: LT.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  textArea: {
    minHeight: 100,
    paddingTop: 14,
    marginBottom: 4,
  },
  charCount: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: LT.textTertiary,
    textAlign: 'right',
    marginBottom: 24,
  },
  postBtn: {
    backgroundColor: LT.primary,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: LT.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  postBtnText: {
    color: '#FFF',
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
});
