import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Platform, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { fetch as expoFetch } from 'expo/fetch';
import { router } from 'expo-router';
import { useApp } from '@/lib/context';
import { getApiUrl, apiRequest } from '@/lib/query-client';

const ORANGE = '#E8704A';

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profile, setProfile } = useApp();
  const [name, setName] = useState(profile?.name || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [address, setAddress] = useState(profile?.address || '');
  const [profileImage, setProfileImage] = useState(profile?.profileImage || '');
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom + 20;

  const pickProfileImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow photo access to change your profile photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    
    setUploadingImage(true);
    try {
      const uri = result.assets[0].uri;
      const uploadUrl = new URL('/api/upload', getApiUrl()).toString();
      const formData = new FormData();
      if (Platform.OS === 'web') {
        const resp = await expoFetch(uri);
        const blob = await resp.blob();
        formData.append('image', blob, 'profile.jpg');
        const uploadRes = await globalThis.fetch(uploadUrl, { method: 'POST', body: formData });
        const data = await uploadRes.json();
        if (!data.success || !data.url) throw new Error(data.message || 'Upload failed');
        setProfileImage(data.url);
      } else {
        formData.append('image', { uri, name: 'profile.jpg', type: 'image/jpeg' } as unknown as Blob);
        const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData as any });
        const data = await uploadRes.json();
        if (!data.success || !data.url) throw new Error(data.message || 'Upload failed');
        setProfileImage(data.url);
      }
    } catch (e) {
      console.error('[EditProfile] Image upload error:', e);
      Alert.alert('Upload failed', String(e).slice(0, 80));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!profile?.id) {
      Alert.alert('Error', 'User profile not found');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Missing info', 'Please enter your name.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest('PATCH', `/api/profiles/${profile.id}`, {
        name: name.trim(),
        email: email.trim(),
        address: address.trim(),
        profileImage,
      });
      const data = await res.json();
      if (data.success || data.profile) {
        if (setProfile) {
          const updated = data.profile || { ...profile, name, email, address, profileImage };
          await setProfile(updated);
        }
        Alert.alert('Success', 'Profile updated successfully!');
        router.back();
      } else {
        throw new Error(data.message || 'Failed to save profile');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const ini = profile?.name?.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: topPad + 12, paddingBottom: botPad + 20, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
          <Pressable onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={28} color="#1A1A1A" />
          </Pressable>
          <Text style={{ fontSize: 22, fontWeight: '700', color: '#1A1A1A', marginLeft: 12 }}>Edit Profile</Text>
        </View>

        {/* Profile Photo */}
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <View style={{ width: 120, height: 120, borderRadius: 60, marginBottom: 16, overflow: 'hidden', backgroundColor: '#FFF1EC' }}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            ) : (
              <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 40, fontWeight: '700', color: ORANGE }}>{ini}</Text>
              </View>
            )}
          </View>
          <Pressable
            onPress={pickProfileImage}
            disabled={uploadingImage}
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: ORANGE, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 }}
          >
            {uploadingImage ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <>
                <Ionicons name="camera-outline" size={16} color="#FFF" />
                <Text style={{ color: '#FFF', fontWeight: '600', marginLeft: 6 }}>Change Photo</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Form Fields */}
        <View style={{ backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 20, gap: 16 }}>
          {/* Name */}
          <View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginBottom: 8 }}>Name *</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, color: '#1A1A1A' }}
              placeholder="Your name"
              placeholderTextColor="#CCC"
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* Phone - Read Only */}
          <View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginBottom: 8 }}>Phone (Read-only)</Text>
            <View style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#F9F9F9' }}>
              <Text style={{ fontSize: 15, color: '#666' }}>{profile?.phone || 'N/A'}</Text>
            </View>
          </View>

          {/* Email */}
          <View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginBottom: 8 }}>Email</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, color: '#1A1A1A' }}
              placeholder="your.email@example.com"
              placeholderTextColor="#CCC"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
            />
          </View>

          {/* Address */}
          <View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginBottom: 8 }}>Address</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, color: '#1A1A1A', minHeight: 80 }}
              placeholder="Your address"
              placeholderTextColor="#CCC"
              value={address}
              onChangeText={setAddress}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>
      </ScrollView>

      {/* Save Button - Fixed at bottom */}
      <View style={{ paddingHorizontal: 16, paddingVertical: botPad + 12, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#F0F0F0' }}>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={{ backgroundColor: ORANGE, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
        >
          {saving ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>Save Changes</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
