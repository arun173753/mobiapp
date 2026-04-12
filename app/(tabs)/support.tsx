import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';

const C = Colors.light;

export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const { profile, allProfiles } = useApp();

  const topInset  = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 84 + 34 : 100;

  const [subActive, setSubActive] = useState(false);
  const [subLoading, setSubLoading] = useState(true);
  const [ordering, setOrdering] = useState(false);
  const [liveSessions, setLiveSessions] = useState<any[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [myPosts, setMyPosts] = useState<any[]>([]);

  const technicians = allProfiles.filter(p => p.role === 'technician').slice(0, 6);

  const safePush = (href: string) => {
    try {
      router.push(href as any);
    } catch {
      router.push('/') as any;
    }
  };

  const fetchSubscription = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const res = await apiRequest('GET', `/api/subscription/status/${profile.id}`);
      const data = await res.json();
      setSubActive(data.active === true);
    } catch {
      setSubActive(false);
    } finally {
      setSubLoading(false);
    }
  }, [profile?.id]);

  const fetchLive = useCallback(async () => {
    setLiveLoading(true);
    try {
      const res = await apiRequest('GET', '/api/teacher/live-sessions');
      const data = await res.json();
      setLiveSessions(data.sessions || []);
    } catch { setLiveSessions([]); }
    finally { setLiveLoading(false); }
  }, []);

  const fetchMyPosts = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const res = await apiRequest('GET', `/api/posts?userId=${profile.id}&category=repair`);
      const data = await res.json();
      setMyPosts((data.posts || data || []).slice(0, 5));
    } catch { setMyPosts([]); }
  }, [profile?.id]);

  useEffect(() => {
    fetchSubscription();
    fetchLive();
    fetchMyPosts();
  }, [fetchSubscription, fetchLive, fetchMyPosts]);

  const handleSubscribe = async () => {
    if (!profile?.id) return;
    setOrdering(true);
    try {
      const res = await apiRequest('POST', '/api/customer/subscription/create-order', { userId: profile.id });
      const data = await res.json();
      if (!data.success) {
        if (Platform.OS === 'web') window.alert(data.message || 'Failed to create order');
        else Alert.alert('Error', data.message || 'Failed');
        return;
      }
      const { orderId, keyId, amount } = data;
      const checkoutUrl = new URL('/api/subscription/checkout', getApiUrl());
      checkoutUrl.searchParams.set('orderId', orderId);
      checkoutUrl.searchParams.set('amount', String(amount));
      checkoutUrl.searchParams.set('keyId', keyId);
      checkoutUrl.searchParams.set('role', 'customer');
      checkoutUrl.searchParams.set('displayAmount', '30');
      checkoutUrl.searchParams.set('userId', profile.id);
      checkoutUrl.searchParams.set('userName', profile.name || '');
      checkoutUrl.searchParams.set('userPhone', profile.phone || '');
      if (Platform.OS === 'web') {
        window.open(checkoutUrl.toString(), '_blank');
        setTimeout(fetchSubscription, 5000);
      } else {
        router.push({ pathname: '/payment-webview', params: { url: checkoutUrl.toString(), type: 'customer_sub' } });
      }
    } catch {
      if (Platform.OS === 'web') window.alert('Failed. Please try again.');
      else Alert.alert('Error', 'Failed. Please try again.');
    } finally {
      setOrdering(false);
    }
  };

  const requireSub = (action: () => void) => {
    if (!subActive) {
      if (Platform.OS === 'web') {
        const ok = window.confirm('This is a Premium feature (₹30/month). Subscribe to access?');
        if (ok) handleSubscribe();
      } else {
        Alert.alert('Premium Feature 🔒', 'Subscribe for ₹30/month to access this feature.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Subscribe Now', onPress: handleSubscribe },
        ]);
      }
      return;
    }
    action();
  };

  return (
    <ScrollView
      style={st.container}
      contentContainerStyle={[st.content, { paddingTop: topInset + 16, paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={st.heading}>Support</Text>
      <Text style={st.headingSub}>Get help from our expert technicians</Text>

      {/* Subscription Status Banner */}
      {!subLoading && (
        subActive ? (
          <View style={st.subActiveBanner}>
            <Ionicons name="star" size={16} color="#FFD700" />
            <Text style={st.subActiveBannerText}>Premium Active — All features unlocked</Text>
          </View>
        ) : (
          <View style={st.subBanner}>
            <View style={st.subBannerLeft}>
              <Text style={st.subBannerTitle}>⭐ Go Premium — ₹30/month</Text>
              <Text style={st.subBannerSub}>Unlock all support features</Text>
            </View>
            <Pressable
              style={({ pressed }) => [st.subBannerBtn, pressed && { opacity: 0.88 }]}
              onPress={handleSubscribe}
              disabled={ordering}
            >
              {ordering ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={st.subBannerBtnText}>Subscribe</Text>}
            </Pressable>
          </View>
        )
      )}

      {/* Quick Actions */}
      <Text style={st.sectionTitle}>Quick Actions</Text>
      <View style={st.actionGrid}>
        <Pressable
          style={({ pressed }) => [st.actionItem, pressed && { opacity: 0.85 }]}
          onPress={() => requireSub(() => router.push('/'))}
        >
          <View style={[st.actionItemIcon, { backgroundColor: '#FF3B3015' }]}>
            <Ionicons name="videocam" size={24} color="#FF3B30" />
            {!subActive && <Ionicons name="lock-closed" size={10} color="#FF3B30" style={st.lockBadge} />}
          </View>
          <Text style={st.actionItemTitle}>Live Help</Text>
          <Text style={st.actionItemSub}>Watch experts live</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [st.actionItem, pressed && { opacity: 0.85 }]}
          onPress={() => requireSub(() => safePush('/create'))}
        >
          <View style={[st.actionItemIcon, { backgroundColor: C.primary + '15' }]}>
            <Ionicons name="chatbubble-ellipses" size={24} color={C.primary} />
            {!subActive && <Ionicons name="lock-closed" size={10} color={C.primary} style={st.lockBadge} />}
          </View>
          <Text style={st.actionItemTitle}>Post Problem</Text>
          <Text style={st.actionItemSub}>Get expert replies</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [st.actionItem, pressed && { opacity: 0.85 }]}
          onPress={() => requireSub(() => safePush('/directory'))}
        >
          <View style={[st.actionItemIcon, { backgroundColor: '#5E8BFF15' }]}>
            <Ionicons name="people" size={24} color="#5E8BFF" />
            {!subActive && <Ionicons name="lock-closed" size={10} color="#5E8BFF" style={st.lockBadge} />}
          </View>
          <Text style={st.actionItemTitle}>Chat Technician</Text>
          <Text style={st.actionItemSub}>Direct messaging</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [st.actionItem, pressed && { opacity: 0.85 }]}
          onPress={() => {}}
        >
          <View style={[st.actionItemIcon, { backgroundColor: '#34C75915' }]}>
            <Ionicons name="ticket" size={24} color="#34C759" />
          </View>
          <Text style={st.actionItemTitle}>My Tickets</Text>
          <Text style={st.actionItemSub}>Track support</Text>
        </Pressable>
      </View>

      {/* Live Sessions */}
      <View style={st.sectionRow}>
        <Text style={st.sectionTitle}>Live Help Sessions</Text>
        <View style={st.liveIndicator}>
          <View style={st.liveDot} />
          <Text style={st.liveCount}>{liveLoading ? '...' : `${liveSessions.length} live`}</Text>
        </View>
      </View>
      {liveLoading ? (
        <ActivityIndicator color={C.primary} style={{ marginVertical: 12 }} />
      ) : liveSessions.length === 0 ? (
        <View style={st.emptyBox}>
          <Ionicons name="videocam-off-outline" size={28} color={C.textTertiary} />
          <Text style={st.emptyText}>No live sessions right now</Text>
        </View>
      ) : (
        liveSessions.map(session => (
          <Pressable
            key={session.id}
            style={({ pressed }) => [st.sessionCard, pressed && { opacity: 0.88 }]}
            onPress={() => requireSub(() =>
              router.push({ pathname: '/live-session', params: { url: session.link || session.streamUrl || '', title: session.title } })
            )}
          >
            <View style={st.sessionAvatarWrap}>
              {session.teacherAvatar ? (
                <Image source={{ uri: session.teacherAvatar }} style={st.sessionAvatar} contentFit="cover" />
              ) : (
                <View style={[st.sessionAvatar, { backgroundColor: '#FF3B3020', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 16, color: '#FF3B30', fontFamily: 'Inter_700Bold' }}>
                    {(session.teacherName || 'T')[0]}
                  </Text>
                </View>
              )}
              <View style={st.liveBadge}><Text style={st.liveBadgeText}>LIVE</Text></View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.sessionTitle} numberOfLines={1}>{session.title}</Text>
              <Text style={st.sessionHost}>{session.teacherName || 'Technician'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.textTertiary} />
          </Pressable>
        ))
      )}

      {/* Technicians */}
      {technicians.length > 0 && (
        <>
          <Text style={[st.sectionTitle, { marginTop: 20 }]}>Chat with Technicians</Text>
          {technicians.map(tech => (
            <Pressable
              key={tech.id}
              style={({ pressed }) => [st.techRow, pressed && { opacity: 0.88 }]}
              onPress={() => requireSub(() => router.push({ pathname: '/chat', params: { userId: tech.id, userName: tech.name } }))}
            >
              {tech.avatar ? (
                <Image source={{ uri: tech.avatar }} style={st.techAvatar} contentFit="cover" />
              ) : (
                <View style={[st.techAvatar, { backgroundColor: C.primary + '20', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 16, color: C.primary, fontFamily: 'Inter_700Bold' }}>{(tech.name || 'T')[0]}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={st.techName}>{tech.name}</Text>
                <Text style={st.techMeta}>{tech.city || 'Technician'}{tech.experience ? ` · ${tech.experience}` : ''}</Text>
              </View>
              <View style={[st.chatBtn, !subActive && st.chatBtnLocked]}>
                <Ionicons name={subActive ? "chatbubble" : "lock-closed"} size={14} color={subActive ? C.primary : C.textTertiary} />
                <Text style={[st.chatBtnText, !subActive && { color: C.textTertiary }]}>
                  {subActive ? 'Chat' : 'Lock'}
                </Text>
              </View>
            </Pressable>
          ))}
        </>
      )}

      {/* My Support Posts */}
      {myPosts.length > 0 && (
        <>
          <Text style={[st.sectionTitle, { marginTop: 20 }]}>My Support Tickets</Text>
          {myPosts.map(post => (
            <View key={post.id} style={st.ticketCard}>
              <View style={st.ticketHeader}>
                <View style={st.ticketBadge}><Text style={st.ticketBadgeText}>REPAIR</Text></View>
                <Text style={st.ticketDate}>{new Date(post.createdAt).toLocaleDateString('en-IN')}</Text>
              </View>
              <Text style={st.ticketContent} numberOfLines={2}>{post.content}</Text>
              <View style={st.ticketFooter}>
                <Ionicons name="chatbubble-outline" size={13} color={C.textTertiary} />
                <Text style={st.ticketFooterText}>{post.comments || 0} replies</Text>
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container:  { flex: 1, backgroundColor: C.background },
  content:    { paddingHorizontal: 20, alignItems: 'flex-start' },
  heading:    { fontSize: 26, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 2 },
  headingSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSecondary, marginBottom: 20 },

  subActiveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#34C75912', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#34C75940', alignSelf: 'stretch', marginBottom: 20,
  },
  subActiveBannerText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },

  subBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.primary + '12', borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: C.primary + '40', alignSelf: 'stretch', marginBottom: 20, gap: 12,
  },
  subBannerLeft:    { flex: 1 },
  subBannerTitle:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text },
  subBannerSub:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSecondary, marginTop: 2 },
  subBannerBtn:     { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  subBannerBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },

  sectionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 12, alignSelf: 'stretch' },
  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', marginBottom: 12 },
  liveIndicator:{ flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF3B30' },
  liveCount:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#FF3B30' },

  actionGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    alignSelf: 'stretch', marginBottom: 24,
  },
  actionItem: {
    width: '47%', backgroundColor: C.surface, borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: C.border, alignItems: 'flex-start', gap: 6,
  },
  actionItemIcon: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 4,
  },
  lockBadge: { position: 'absolute', bottom: 4, right: 4 },
  actionItemTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  actionItemSub:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSecondary },

  emptyBox:  { alignItems: 'center', alignSelf: 'stretch', paddingVertical: 24, gap: 8 },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textTertiary },

  sessionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, alignSelf: 'stretch', marginBottom: 8,
  },
  sessionAvatarWrap: { position: 'relative' },
  sessionAvatar:     { width: 48, height: 48, borderRadius: 24 },
  liveBadge:         { position: 'absolute', bottom: -2, right: -4, backgroundColor: '#FF3B30', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  liveBadgeText:     { fontSize: 8, fontFamily: 'Inter_700Bold', color: '#FFF', letterSpacing: 0.5 },
  sessionTitle:      { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 2 },
  sessionHost:       { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSecondary },

  techRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, alignSelf: 'stretch', marginBottom: 8,
  },
  techAvatar: { width: 44, height: 44, borderRadius: 22 },
  techName:   { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  techMeta:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSecondary, marginTop: 2 },
  chatBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primary + '15', borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12 },
  chatBtnLocked: { backgroundColor: C.border },
  chatBtnText:   { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  ticketCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, alignSelf: 'stretch', marginBottom: 8,
  },
  ticketHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  ticketBadge:       { backgroundColor: C.primary + '15', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  ticketBadgeText:   { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary, letterSpacing: 0.5 },
  ticketDate:        { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textTertiary },
  ticketContent:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 18, marginBottom: 8 },
  ticketFooter:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ticketFooterText:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textTertiary },
});
