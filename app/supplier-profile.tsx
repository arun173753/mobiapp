import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';

const ACCENT = '#6B46C1';
const ACCENT_BG = '#F3EEFF';
const BG = '#F9FAFB';
const CARD = '#FFFFFF';
const BORDER = '#E5E7EB';
const TEXT = '#111827';
const MUTED = '#9CA3AF';
const SUCCESS = '#27AE60';
const DANGER = '#EB5757';

export default function SupplierProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profile, setProfile } = useApp();
  
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [shopName, setShopName] = useState(profile?.shopName || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [city, setCity] = useState(profile?.city || '');
  const [state, setState] = useState(profile?.state || '');
  const [bannerImage, setBannerImage] = useState(profile?.bannerImage || '');
  const [saving, setSaving] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  if (!profile || profile.role !== 'supplier') {
    return (
      <View style={[ss.root, { paddingTop: topPad }]}>
        <View style={ss.centered}>
          <Text style={ss.errorText}>Only suppliers can access this page</Text>
          <TouchableOpacity onPress={() => router.back()} style={ss.backBtn}>
            <Text style={ss.backBtnTxt}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const pickBanner = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        uploadBanner(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const uploadBanner = async (uri: string) => {
    setUploading(true);
    try {
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'banner.jpg';
      formData.append('file', { uri, name: filename, type: 'image/jpeg' } as unknown as Blob);
      
      // Upload to your cloud storage or API
      const res = await fetch(`${new URL('/', await apiRequest('GET', '/').then(() => '')).origin}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      
      const data = await res.json();
      if (data.url) {
        setBannerImage(data.url);
      }
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Error', 'Failed to upload banner');
    } finally {
      setUploading(false);
    }
  };

  const saveSupplerProfile = async () => {
    if (!shopName.trim()) {
      Alert.alert('Required', 'Shop name is required');
      return;
    }
    
    setSaving(true);
    try {
      await apiRequest('PUT', `/api/profiles/${profile.id}`, {
        shopName: shopName.trim(),
        bio: bio.trim(),
        city: city.trim(),
        state: state.trim(),
        bannerImage,
      });
      
      if (setProfile) {
        setProfile({
          ...profile,
          shopName: shopName.trim(),
          bio: bio.trim(),
          city: city.trim(),
          state: state.trim(),
          bannerImage,
        });
      }
      
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[ss.root, { paddingTop: topPad }]}>
      <View style={ss.header}>
        <TouchableOpacity onPress={() => router.back()} style={ss.backBtn}>
          <Ionicons name="arrow-back" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={ss.headerTitle}>Shop Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Banner Upload Section */}
        <View style={ss.section}>
          <Text style={ss.sectionTitle}>Shop Banner</Text>
          <Text style={ss.sectionSub}>This banner displays on marketplace and your shop page</Text>
          
          <TouchableOpacity 
            onPress={pickBanner}
            disabled={uploading}
            style={[ss.bannerBox, uploading && { opacity: 0.5 }]}>
            {bannerImage ? (
              <>
                <Image source={{ uri: bannerImage }} style={ss.bannerImg} contentFit="cover" />
                <TouchableOpacity 
                  onPress={() => setBannerImage('')}
                  style={ss.removeBannerBtn}>
                  <Ionicons name="close-circle" size={24} color={DANGER} />
                </TouchableOpacity>
              </>
            ) : (
              <View style={ss.uploadPlaceholder}>
                {uploading ? (
                  <>
                    <ActivityIndicator color={ACCENT} size="large" />
                    <Text style={ss.uploadText}>Uploading…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={40} color={MUTED} />
                    <Text style={ss.uploadText}>Tap to upload banner</Text>
                    <Text style={ss.uploadSubText}>Recommended: 1200×675px</Text>
                  </>
                )}
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Shop Details */}
        <View style={ss.section}>
          <Text style={ss.sectionTitle}>Shop Details</Text>
          
          <Field 
            label="Shop Name" 
            value={shopName} 
            onChangeText={setShopName} 
            placeholder="Your business name"
            icon="storefront-outline"
          />
          
          <Field 
            label="Bio" 
            value={bio} 
            onChangeText={setBio} 
            placeholder="Tell customers about your business"
            icon="chatbox-outline"
            multiline
          />
          
          <View style={ss.rowFields}>
            <View style={{ flex: 1 }}>
              <Field 
                label="City" 
                value={city} 
                onChangeText={setCity} 
                placeholder="Your city"
                icon="location-outline"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field 
                label="State" 
                value={state} 
                onChangeText={setState} 
                placeholder="Your state"
                icon="map-outline"
              />
            </View>
          </View>
        </View>

        {/* Current Profile Info */}
        <View style={ss.section}>
          <Text style={ss.sectionTitle}>Account Information</Text>
          <InfoRow label="Phone" value={profile.phone} />
          <InfoRow label="Email" value={profile.email || '—'} />
          <InfoRow label="Role" value={profile.role} />
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={[ss.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          onPress={saveSupplerProfile}
          disabled={saving}
          style={[ss.saveBtn, saving && { opacity: 0.5 }]}>
          {saving ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark" size={18} color="#FFF" />
              <Text style={ss.saveBtnTxt}>Save Profile</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, icon, multiline }: any) {
  return (
    <View style={ss.field}>
      <Text style={ss.fieldLabel}>{label}</Text>
      <View style={ss.inputWrap}>
        <Ionicons name={icon} size={16} color={MUTED} style={{ marginRight: 8 }} />
        <TextInput
          style={[ss.input, multiline && ss.inputMulti]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={MUTED}
          multiline={multiline}
          numberOfLines={multiline ? 3 : 1}
        />
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={ss.infoRow}>
      <Text style={ss.infoLabel}>{label}</Text>
      <Text style={ss.infoVal}>{value}</Text>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 16, color: TEXT, fontFamily: 'Inter_600SemiBold', marginBottom: 20, textAlign: 'center' },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  backBtnTxt: { color: ACCENT, fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', color: TEXT, textAlign: 'center' },

  section: {
    backgroundColor: CARD, marginHorizontal: 16, marginTop: 12,
    borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER,
  },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 4 },
  sectionSub: { fontSize: 12, color: MUTED, fontFamily: 'Inter_400Regular', marginBottom: 12 },

  bannerBox: {
    width: '100%', height: 200, borderRadius: 14,
    backgroundColor: '#F9FAFB', borderWidth: 2, borderColor: BORDER,
    borderStyle: 'dashed', overflow: 'hidden', position: 'relative',
  },
  bannerImg: { width: '100%', height: '100%' },
  removeBannerBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: CARD, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  uploadPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  uploadText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: TEXT },
  uploadSubText: { fontSize: 12, color: MUTED, fontFamily: 'Inter_400Regular' },

  rowFields: { flexDirection: 'row', gap: 10 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: TEXT, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: BORDER,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  input: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: TEXT },
  inputMulti: { height: 72, textAlignVertical: 'top', paddingTop: 4 },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  infoLabel: { fontSize: 13, color: MUTED, fontFamily: 'Inter_400Regular' },
  infoVal: { fontSize: 13, color: TEXT, fontFamily: 'Inter_600SemiBold' },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: CARD, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: BORDER,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 16, elevation: 16,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 14,
  },
  saveBtnTxt: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
