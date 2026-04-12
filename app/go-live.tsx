import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, Platform, TouchableOpacity, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { openLink } from '@/lib/open-link';
import * as ImagePicker from 'expo-image-picker';

const RED  = '#EF4444';
const GRAY = '#9CA3AF';
const DARK = '#111827';
const BUNNY_COLOR = '#FF6B35';

interface LiveSession {
  id: string;
  title: string;
  platform: string;
  link: string;
  thumbnailUrl?: string;
  startedAt: number;
  streamKey?: string;
}

type StreamMode = 'bunny' | 'link';
type LinkPlatform = 'youtube' | 'zoom' | 'meet' | 'other';

const LINK_PLATFORMS: { key: LinkPlatform; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { key: 'youtube', label: 'YouTube', icon: 'logo-youtube', color: '#FF0000' },
  { key: 'zoom',    label: 'Zoom',    icon: 'videocam',     color: '#2D8CFF' },
  { key: 'meet',    label: 'Meet',    icon: 'videocam',     color: '#00897B' },
  { key: 'other',   label: 'Other',   icon: 'radio',        color: '#EF4444' },
];

function showMsg(msg: string) {
  Alert.alert('', msg);
}

export default function GoLiveScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const isTeacher = profile?.role === 'teacher' || profile?.role === 'admin';
  const scrollRef = useRef<ScrollView>(null);

  const [mode, setMode] = useState<StreamMode>('link');
  const [linkPlatform, setLinkPlatform] = useState<LinkPlatform>('youtube');
  const [title, setTitle]               = useState('');
  const [description, setDescription]   = useState('');
  const [link, setLink]                 = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [activeSession, setActiveSession] = useState<LiveSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [isUploading, setIsUploading]   = useState(false);
  const [streamKeyInfo, setStreamKeyInfo] = useState<{ rtmpUrl: string; streamKey: string } | null>(null);
  const [thumbnailUri, setThumbnailUri]   = useState<string | null>(null);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [errorMsg, setErrorMsg]         = useState('');
  const [successMsg, setSuccessMsg]     = useState('');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  useEffect(() => {
    if (isTeacher && profile?.id) {
      fetchMySession();
    } else {
      setLoadingSession(false);
    }
  }, [profile?.id]);

  const openUploadLink = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/admin/links');
      const data = await res.json();
      const uploadLink = data?.upload_video_link;
      if (uploadLink) {
        openLink(uploadLink, 'Upload Video');
      } else {
        Alert.alert('Upload Link Not Set', 'The upload link has not been configured yet.');
      }
    } catch (e) {
      console.error('[Upload] Error:', e);
      Alert.alert('Error', 'Unable to open upload link');
    }
  }, []);

  const fetchMySession = async () => {
    try {
      const res  = await apiRequest('GET', '/api/teacher/live-sessions');
      const data = await res.json();
      if (data.sessions) {
        const mine = data.sessions.find((s: any) => s.teacherId === profile?.id);
        setActiveSession(mine || null);
      }
    } catch (e) {
      console.warn('[GoLive] fetch error:', e);
    } finally {
      setLoadingSession(false);
    }
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setSuccessMsg('');
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setErrorMsg('');
  };

  const uploadThumbnail = async (uri: string): Promise<string | null> => {
    try {
      const formData = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await globalThis.fetch(uri)).blob();
        formData.append('image', blob, 'thumbnail.jpg');
      } else {
        const name = uri.split('/').pop() || 'thumbnail.jpg';
        formData.append('image', { uri, name, type: 'image/jpeg' } as any);
      }
      const uploadUrl = new URL('/api/upload', getApiUrl()).toString();
      const res = await globalThis.fetch(uploadUrl, { method: 'POST', body: formData });
      if (!res.ok) return null;
      const data = await res.json();
      return data.success && data.url ? data.url : null;
    } catch (e: any) {
      console.error('[GoLive] thumbnail upload failed:', e?.message);
      return null;
    }
  };

  // Start a Bunny Live stream (RTMP)
  const handleStartBunnyStream = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    const finalTitle = title.trim() || 'Live Session';
    setSubmitting(true);
    try {
      let thumbnailUrl = '';
      if (thumbnailUri) {
        setUploadingThumbnail(true);
        thumbnailUrl = await uploadThumbnail(thumbnailUri) || '';
        setUploadingThumbnail(false);
      }

      const res = await apiRequest('POST', '/api/teacher/bunny-live/start', {
        teacherId:     profile?.id,
        teacherName:   profile?.name,
        teacherAvatar: profile?.avatar,
        title:         finalTitle,
        description:   description.trim(),
        thumbnailUrl:  thumbnailUrl || '',
      });

      let data: any = {};
      try { data = await res.json(); } catch { /* ignore parse error */ }

      if (!res.ok || !data.success) {
        const msg = data.message || `Server error (${res.status})`;
        showError(msg);
        showMsg('Error: ' + msg);
        return;
      }

      setActiveSession(data.session);
      setStreamKeyInfo({ rtmpUrl: data.rtmpUrl, streamKey: data.streamKey });
      setTitle('');
      setDescription('');
      setThumbnailUri(null);
      showSuccess('Live stream started! Share your RTMP details below.');
      showMsg('Live stream started! You are now LIVE.');
    } catch (e: any) {
      const msg = e?.message || 'Connection failed. Please try again.';
      showError(msg);
      showMsg('Error: ' + msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Share an external link (YouTube / Zoom / Meet)
  const handleShareLink = async () => {
    setErrorMsg('');
    setSuccessMsg('');

    const finalLink = link.trim();
    const finalTitle = title.trim() || 'Live Session';

    if (!finalLink) {
      showError('Please enter your live stream link.');
      showMsg('Please enter your live stream link.');
      return;
    }
    if (!/^https?:\/\/.+/i.test(finalLink)) {
      showError('Please enter a valid URL starting with https://');
      showMsg('Please enter a valid URL starting with https://');
      return;
    }

    setSubmitting(true);
    try {
      let thumbnailUrl = '';
      if (thumbnailUri) {
        setUploadingThumbnail(true);
        thumbnailUrl = await uploadThumbnail(thumbnailUri) || '';
        setUploadingThumbnail(false);
      }

      const res = await apiRequest('POST', '/api/teacher/go-live', {
        teacherId:     profile?.id,
        teacherName:   profile?.name,
        teacherAvatar: profile?.avatar,
        title:         finalTitle,
        description:   description.trim(),
        platform:      linkPlatform,
        link:          finalLink,
        thumbnailUrl:  thumbnailUrl || '',
      });

      let data: any = {};
      try { data = await res.json(); } catch { /* ignore parse error */ }

      if (!res.ok || !data.success) {
        const msg = data.message || `Server error (${res.status}). Please try again.`;
        showError(msg);
        showMsg('Error: ' + msg);
        return;
      }

      setActiveSession(data.session);
      setTitle('');
      setDescription('');
      setLink('');
      setThumbnailUri(null);
      showSuccess('You are LIVE! All users have been notified.');
      showMsg('You are LIVE! All users have been notified.');
    } catch (e: any) {
      const msg = e?.message || 'Connection failed. Please try again.';
      showError(msg);
      showMsg('Error: ' + msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndLive = async () => {
    if (!activeSession?.id || !profile?.id) return;
    const sessionId = activeSession.id;
    const teacherId = profile.id;
    setActiveSession(null);
    setStreamKeyInfo(null);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      await apiRequest('POST', '/api/teacher/end-live', { teacherId, sessionId });
    } catch (err: any) {
      console.error('[EndLive] error:', err.message || err);
    }
  };

  const pickThumbnail = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setThumbnailUri(result.assets[0].uri);
    }
  };

  const handleShareImage = async () => {
    if (!activeSession) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setIsUploading(true);
    try {
      const uri      = result.assets[0].uri;
      const formData = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await globalThis.fetch(uri)).blob();
        formData.append('image', blob, 'live-session.jpg');
      } else {
        const name = uri.split('/').pop() || 'live-session.jpg';
        formData.append('image', { uri, name, type: result.assets[0].mimeType || 'image/jpeg' } as any);
      }
      formData.append('sessionId', activeSession.id);
      formData.append('sessionLink', activeSession.link);
      formData.append('teacherName', profile?.name || 'Teacher');
      const uploadUrl = new URL('/api/teacher/live-session/upload-image', getApiUrl()).toString();
      const res = await globalThis.fetch(uploadUrl, { method: 'POST', body: formData });
      if (res.ok) {
        showSuccess('Photo shared with all technicians!');
        showMsg('Photo shared with all technicians!');
      } else {
        showError('Photo upload failed. Please try again.');
        showMsg('Photo upload failed. Please try again.');
      }
    } catch (e: any) {
      showError(e.message || 'Failed to upload photo.');
      showMsg(e.message || 'Failed to upload photo.');
    } finally {
      setIsUploading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator?.clipboard) {
      await navigator.clipboard.writeText(text);
      showSuccess('Copied to clipboard!');
    }
  };

  // ── Not a teacher ────────────────────────────────────────────────────────
  if (!isTeacher) {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </Pressable>
          <Text style={styles.headerTitle}>Live Session</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centerContent}>
          <Ionicons name="lock-closed-outline" size={48} color="#CCC" />
          <Text style={styles.restrictedText}>Only teachers can go live</Text>
        </View>
      </View>
    );
  }

  if (loadingSession) {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </Pressable>
          <Text style={styles.headerTitle}>Go Live</Text>
          <View style={{ width: 40 }} />
        </View>
        <ActivityIndicator size="large" color={RED} style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </Pressable>
        <Text style={styles.headerTitle}>{activeSession ? 'You are LIVE' : 'Go Live'}</Text>
        {isTeacher && (
          <Pressable style={styles.uploadHeaderBtn} onPress={openUploadLink}>
            <Ionicons name="cloud-upload-outline" size={18} color="#FF6B35" />
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Inline error/success banners */}
        {!!errorMsg && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color="#FFF" />
            <Text style={styles.bannerText}>{errorMsg}</Text>
            <Pressable onPress={() => setErrorMsg('')}>
              <Ionicons name="close" size={18} color="#FFF" />
            </Pressable>
          </View>
        )}
        {!!successMsg && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={18} color="#FFF" />
            <Text style={styles.bannerText}>{successMsg}</Text>
            <Pressable onPress={() => setSuccessMsg('')}>
              <Ionicons name="close" size={18} color="#FFF" />
            </Pressable>
          </View>
        )}

        {activeSession ? (
          // ── Active session card ─────────────────────────────────────────
          <View>
            <View style={styles.activeBanner}>
              <View style={styles.liveRow}>
                <View style={styles.liveDotRed} />
                <Text style={styles.liveLabel}>LIVE NOW</Text>
              </View>
              <Text style={styles.activeTitle} numberOfLines={2}>{activeSession.title}</Text>
              <Text style={styles.activeSubtext}>
                Your session is visible in the Live tab. All users have been notified.
              </Text>
            </View>

            {activeSession.link && (
              <View style={styles.linkCard}>
                <View style={styles.linkCardHeader}>
                  <Ionicons name="link" size={16} color="#FFF" />
                  <Text style={styles.linkCardLabel}>Live Session Link</Text>
                </View>
                <Text style={styles.linkCardUrl} numberOfLines={2}>{activeSession.link}</Text>
                <Pressable 
                  style={styles.linkCardBtn}
                  onPress={() => {
                    router.push({
                      pathname: '/live-link',
                      params: { link: activeSession.link, title: activeSession.title },
                    } as any);
                  }}
                >
                  <Ionicons name="open-outline" size={16} color="#FFF" />
                  <Text style={styles.linkCardBtnText}>Open Link</Text>
                </Pressable>
              </View>
            )}

            {streamKeyInfo && (
              <View style={styles.rtmpCard}>
                <Text style={styles.rtmpLabel}>Stream with OBS / Streamlabs</Text>
                <View style={styles.rtmpRow}>
                  <View style={styles.rtmpInfo}>
                    <Text style={styles.rtmpKey}>RTMP URL</Text>
                    <Text style={styles.rtmpValue} numberOfLines={2}>{streamKeyInfo.rtmpUrl}</Text>
                  </View>
                  <Pressable style={styles.copyBtn} onPress={() => copyToClipboard(streamKeyInfo.rtmpUrl)}>
                    <Ionicons name="copy-outline" size={16} color={BUNNY_COLOR} />
                  </Pressable>
                </View>
                <View style={styles.divider} />
                <View style={styles.rtmpRow}>
                  <View style={styles.rtmpInfo}>
                    <Text style={styles.rtmpKey}>Stream Key</Text>
                    <Text style={styles.rtmpValue}>{streamKeyInfo.streamKey}</Text>
                  </View>
                  <Pressable style={styles.copyBtn} onPress={() => copyToClipboard(streamKeyInfo.streamKey)}>
                    <Ionicons name="copy-outline" size={16} color={BUNNY_COLOR} />
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.actionStack}>
              <TouchableOpacity style={styles.sharePhotoBtn} onPress={handleShareImage} disabled={isUploading} activeOpacity={0.7}>
                {isUploading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="camera" size={18} color="#FFF" />
                    <Text style={styles.sharePhotoBtnText}>Share Photo</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.watchBtn}
                onPress={() => router.push({
                  pathname: '/live-session',
                  params: { url: activeSession.link, title: activeSession.title, platform: activeSession.platform, sessionId: activeSession.id },
                } as any)}
                activeOpacity={0.7}
              >
                <Ionicons name="play-circle" size={18} color="#FFF" />
                <Text style={styles.watchBtnText}>Watch My Stream</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.uploadActionBtn} onPress={openUploadLink} activeOpacity={0.7}>
                <Ionicons name="cloud-upload" size={18} color="#FFF" />
                <Text style={styles.uploadActionBtnText}>Upload Video</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.endBtn} onPress={handleEndLive} activeOpacity={0.7}>
                <Ionicons name="stop-circle" size={16} color={RED} />
                <Text style={styles.endBtnText}>End Session</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          // ── Setup form ─────────────────────────────────────────────────
          <>
            {/* Action buttons row */}
            <View style={styles.actionButtonsRow}>
              <Pressable
                style={styles.startLiveBtn}
                onPress={() => setMode('link')}
              >
                <Ionicons name="radio" size={18} color="#FFF" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.startLiveBtnText}>Start Live Stream</Text>
                  <Text style={styles.startLiveBtnSub}>Share your session</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#FFF" />
              </Pressable>

              <Pressable
                style={styles.uploadBtn}
                onPress={openUploadLink}
              >
                <Ionicons name="cloud-upload" size={18} color="#FFF" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.uploadBtnText}>Upload Video</Text>
                  <Text style={styles.uploadBtnSub}>Upload resources</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#FFF" />
              </Pressable>
            </View>


            {/* Share Link Section */}
            <>
              <View style={[styles.introCard, { backgroundColor: '#FFF5F5', borderColor: '#FFCECE' }]}>
                <View style={styles.introBadge}>
                  <View style={styles.liveDotRed} />
                  <Text style={styles.introBadgeText}>SHARE LINK</Text>
                </View>
                <Text style={styles.introHeading}>Share your live class link</Text>
                <Text style={styles.introSub}>
                  Post your YouTube, Zoom, or Google Meet link. Users get notified instantly.
                </Text>
              </View>

              <Text style={styles.fieldLabel}>Platform</Text>
              <View style={styles.platformRow}>
                {LINK_PLATFORMS.map(p => (
                  <Pressable
                    key={p.key}
                    style={[
                      styles.platformBtn,
                      linkPlatform === p.key && { backgroundColor: p.color, borderColor: p.color },
                    ]}
                    onPress={() => setLinkPlatform(p.key)}
                  >
                    <Ionicons name={p.icon} size={14} color={linkPlatform === p.key ? '#FFF' : p.color} />
                    <Text style={[styles.platformBtnText, linkPlatform === p.key && { color: '#FFF' }]}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Stream Link <Text style={{ color: RED }}>*</Text></Text>
              <TextInput
                style={styles.input}
                value={link}
                onChangeText={setLink}
                placeholder="https://youtube.com/live/..."
                placeholderTextColor="#BBB"
                autoCapitalize="none"
                keyboardType="url"
                maxLength={300}
              />

              <Text style={styles.fieldLabel}>Session Title (optional)</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Live AC Repair Workshop"
                placeholderTextColor="#BBB"
                maxLength={80}
              />

              <Text style={styles.fieldLabel}>Thumbnail (optional)</Text>
              <Pressable style={styles.pickerBtn} onPress={pickThumbnail}>
                <Ionicons name="image-outline" size={18} color={RED} />
                <Text style={styles.pickerBtnText}>{thumbnailUri ? 'Change thumbnail' : 'Pick thumbnail'}</Text>
              </Pressable>

              <Text style={styles.fieldLabel}>Description (optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={description}
                onChangeText={setDescription}
                placeholder="What will you cover today?"
                placeholderTextColor="#BBB"
                multiline
                numberOfLines={3}
                maxLength={200}
              />

              <Pressable
                style={[styles.goLiveBtn, submitting && { opacity: 0.6 }]}
                onPress={handleShareLink}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <View style={styles.goLiveDot} />
                    <Text style={styles.goLiveBtnText}>Go Live Now</Text>
                    <Text style={styles.goLiveSubNote}>Notifies all users</Text>
                  </>
                )}
              </Pressable>
            </>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F2F2F2', alignItems: 'center', justifyContent: 'center',
  },
  uploadHeaderBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#FF6B3515', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#000' },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  restrictedText: { fontSize: 15, color: GRAY, fontFamily: 'Inter_500Medium' },

  // Banners
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#EF4444', borderRadius: 14, padding: 14, marginBottom: 16,
  },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#10B981', borderRadius: 14, padding: 14, marginBottom: 16,
  },
  bannerText: { flex: 1, color: '#FFF', fontSize: 14, fontFamily: 'Inter_500Medium' },

  // Action buttons row
  actionButtonsRow: { gap: 12, marginBottom: 24 },
  startLiveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: RED, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 14,
    shadowColor: RED, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  startLiveBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
  startLiveBtnSub: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FF6B35', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 14,
    shadowColor: '#FF6B35', shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  uploadBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
  uploadBtnSub: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },

  // Mode tabs
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  modeTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: '#E0E0E0', backgroundColor: '#F8F8F8',
  },
  modeTabActive: { backgroundColor: RED, borderColor: RED },
  modeTabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: GRAY },
  modeTabTextActive: { color: '#FFF' },

  // Intro card
  introCard: {
    borderRadius: 18, padding: 18, marginBottom: 22, borderWidth: 1,
  },
  introBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  liveDotRed: { width: 8, height: 8, borderRadius: 4, backgroundColor: RED },
  introBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: RED, letterSpacing: 1 },
  introHeading: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#000', marginBottom: 6 },
  introSub: { fontSize: 13, color: '#666', lineHeight: 19 },

  // Form fields
  fieldLabel: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#333', marginBottom: 8, marginTop: 2 },
  input: {
    backgroundColor: '#F8F8F8', borderRadius: 14, borderWidth: 1.5, borderColor: '#E8E8E8',
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#000', marginBottom: 16,
    fontFamily: 'Inter_400Regular',
  },
  textArea: { height: 80, textAlignVertical: 'top' },

  // Platform selector
  platformRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  platformBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#E0E0E0', backgroundColor: '#F8F8F8',
  },
  platformBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#666' },

  // Picker btn
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  pickerBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: DARK },

  // Go Live button
  goLiveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: RED, borderRadius: 18, paddingVertical: 17, marginTop: 6,
    shadowColor: RED, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  goLiveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFF' },
  goLiveBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
  goLiveSubNote: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_400Regular' },

  // Active session
  activeBanner: {
    backgroundColor: '#FFF5F5', borderRadius: 20, padding: 20, marginBottom: 18,
    borderWidth: 1.5, borderColor: '#FFCECE',
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  liveLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: RED, letterSpacing: 1.5 },
  activeTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#000', lineHeight: 26, marginBottom: 6 },
  activeSubtext: { fontSize: 13, color: '#666', lineHeight: 18 },

  // Link card
  linkCard: {
    backgroundColor: '#E0F2FE', borderRadius: 16, padding: 14, marginBottom: 18,
    borderWidth: 1, borderColor: '#0EA5E9',
  },
  linkCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  linkCardLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#0369A1', letterSpacing: 0.5 },
  linkCardUrl: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#0C4A6E', lineHeight: 16, marginBottom: 10 },
  linkCardBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#0EA5E9', borderRadius: 10, paddingVertical: 10,
  },
  linkCardBtnText: { color: '#FFF', fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // RTMP card
  rtmpCard: {
    backgroundColor: '#FFF8F4', borderRadius: 16, padding: 16, marginBottom: 18,
    borderWidth: 1, borderColor: BUNNY_COLOR + '30',
  },
  rtmpLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: BUNNY_COLOR, marginBottom: 12 },
  rtmpRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rtmpInfo: { flex: 1 },
  rtmpKey: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: GRAY, letterSpacing: 0.5, marginBottom: 3 },
  rtmpValue: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#333', lineHeight: 16 },
  copyBtn: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: BUNNY_COLOR + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  divider: { height: 1, backgroundColor: '#F0E0D8', marginVertical: 12 },

  // Action stack
  actionStack: { gap: 10 },
  sharePhotoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#10B981', borderRadius: 14, paddingVertical: 14,
  },
  sharePhotoBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  watchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: RED, borderRadius: 14, paddingVertical: 14,
  },
  watchBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  endBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFF', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: '#FFCECE',
  },
  endBtnText: { color: RED, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  uploadActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FF6B35', borderRadius: 14, paddingVertical: 14,
  },
  uploadActionBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
