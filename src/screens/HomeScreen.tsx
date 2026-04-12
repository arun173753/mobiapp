import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, Animated,
  ScrollView, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';
import { ProgressRing } from '@/components/ProgressRing';

const { width: SW } = Dimensions.get('window');

const GREEN   = '#00E676';
const AMBER   = '#F59E0B';
const RED     = '#FF3B30';
const INDIGO  = '#4F46E5';
const PURPLE  = '#8B5CF6';
const TEAL    = '#0D9488';
const EMERALD = '#10B981';
const BLUE    = '#3B82F6';
const NAVY    = '#0F172A';
const NAVY2   = '#1E293B';
const BG      = '#F8FAFC';
const CARD    = '#FFFFFF';
const GRAY    = '#64748B';

const HEALTH_SCORE = 92;

const QUICK_ACTIONS = [
  { id: 'repair',    label: 'Repair',      icon: 'construct-outline',        color: INDIGO,  bg: '#EEF2FF', route: '/select-brand'  },
  { id: 'sell',      label: 'Sell Phone',  icon: 'phone-portrait-outline',   color: PURPLE,  bg: '#F5F3FF', route: '/buy-sell'      },
  { id: 'shop',      label: 'Shop',        icon: 'cart-outline',             color: TEAL,    bg: '#F0FDFA', route: '/marketplace'   },
  { id: 'insurance', label: 'Insurance',   icon: 'shield-checkmark-outline', color: EMERALD, bg: '#ECFDF5', route: '/insurance'     },
];

const DEVICE_STATS = [
  { icon: 'battery-charging-outline', label: 'Battery', val: '98%',  color: GREEN   },
  { icon: 'speedometer-outline',      label: 'CPU',     val: 'Good', color: '#4F8CFF' },
  { icon: 'cellular-outline',         label: 'Signal',  val: '5G',   color: TEAL    },
  { icon: 'thermometer-outline',      label: 'Temp',    val: '37°C', color: AMBER   },
];

type Props = {
  topPad?: number;
  botPad?: number;
};

export function HomeScreen({ topPad = 0, botPad = 104 }: Props) {
  const { profile } = useApp();
  const [techs, setTechs] = useState<any[]>([]);
  const pulse    = useRef(new Animated.Value(1)).current;
  const slideIn  = useRef(new Animated.Value(40)).current;

  const firstName = profile?.name?.split(' ')[0] || 'there';

  useEffect(() => {
    Animated.parallel([
      Animated.loop(Animated.sequence([
        Animated.timing(pulse,   { toValue: 1.15, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse,   { toValue: 1.0,  duration: 1100, useNativeDriver: true }),
      ])),
      Animated.spring(slideIn, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

  const fetchTechs = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/profiles?role=technician&limit=8');
      const data = await res.json();
      setTechs((data.profiles || data || []).slice(0, 5));
    } catch { setTechs([]); }
  }, []);
  useEffect(() => { fetchTechs(); }, [fetchTechs]);

  const go = (route: string) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as any);
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={{ paddingTop: topPad + 12, paddingBottom: botPad, paddingHorizontal: 20 }}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good day,</Text>
          <Text style={styles.name}>{firstName} 👋</Text>
        </View>
        <View style={styles.hRight}>
          <Pressable style={styles.iconBtn} onPress={() => go('/notification-preferences')}>
            <Ionicons name="notifications-outline" size={21} color={NAVY} />
            <View style={styles.notifBadge} />
          </Pressable>
          <Pressable onPress={() => go('/(tabs)/profile')}>
            <Image
              source={{ uri: profile?.avatar || 'https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=100&h=100&fit=crop' }}
              style={styles.avatar} contentFit="cover"
            />
          </Pressable>
        </View>
      </View>

      {/* ── Device Health Hero ─────────────────────────────── */}
      <Animated.View style={[styles.hero, { transform: [{ translateY: slideIn }] }]}>
        <View style={styles.heroGlow} />
        <View style={styles.heroGlow2} />

        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <View style={styles.detectedChip}>
              <Animated.View style={[styles.chipDot, { transform: [{ scale: pulse }] }]} />
              <Text style={styles.chipText}>AUTO-DETECTED</Text>
            </View>
            <Text style={styles.deviceName} numberOfLines={1}>
              {profile?.device || 'iPhone 15 Pro'}
            </Text>
            <Text style={styles.deviceSub}>Excellent Condition</Text>
          </View>
          <ProgressRing
            size={92}
            strokeWidth={9}
            progress={HEALTH_SCORE / 100}
            valueText={`${HEALTH_SCORE}`}
            label="Health"
            color={GREEN}
          />
        </View>

        <View style={styles.statsRow}>
          {DEVICE_STATS.map(st => (
            <View key={st.label} style={styles.statItem}>
              <Ionicons name={st.icon as any} size={14} color={st.color} />
              <Text style={styles.statVal}>{st.val}</Text>
              <Text style={styles.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.heroDivider} />
        <Pressable style={styles.heroFooter} onPress={() => go('/diagnose')}>
          <Ionicons name="shield-checkmark" size={15} color={GREEN} />
          <Text style={styles.footerTxt}>Protected by Mobix Shield</Text>
          <Ionicons name="chevron-forward" size={13} color={GREEN} style={{ marginLeft: 'auto' }} />
        </Pressable>
      </Animated.View>

      {/* ── Quick Actions ──────────────────────────────────── */}
      <View style={styles.qGrid}>
        {QUICK_ACTIONS.map(a => (
          <Pressable key={a.id} style={styles.qCard} onPress={() => go(a.route)}>
            <View style={[styles.qIcon, { backgroundColor: a.bg }]}>
              <Ionicons name={a.icon as any} size={26} color={a.color} />
            </View>
            <Text style={styles.qLabel}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── Mobix Shield Banner ────────────────────────────── */}
      <Pressable style={styles.banner} onPress={() => go('/insurance')}>
        <View style={styles.bannerContent}>
          <Text style={styles.bannerEye}>MOBIX SHIELD</Text>
          <Text style={styles.bannerTitle}>Total Device{'\n'}Protection</Text>
          <Text style={styles.bannerDesc}>Covers screen, liquid & accidental damage</Text>
          <View style={styles.bannerCTA}>
            <Text style={styles.bannerCTATxt}>View Plans</Text>
            <Ionicons name="arrow-forward" size={13} color={NAVY} />
          </View>
        </View>
        <View style={styles.bannerShield}>
          <Ionicons name="shield-half" size={110} color="rgba(0,230,118,0.16)" />
        </View>
      </Pressable>

      {/* ── Certified Technicians ─────────────────────────── */}
      <View style={styles.secRow}>
        <Text style={styles.secTitle}>Certified Technicians</Text>
        <Pressable onPress={() => go('/(tabs)/directory')}>
          <Text style={styles.seeAll}>See All</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.techList}>
        {techs.length > 0 ? techs.map(t => (
          <Pressable key={t.id} style={styles.techCard}
            onPress={() => router.push({ pathname: '/user-profile', params: { id: t.id } } as any)}>
            <Image
              source={{ uri: t.avatar || `https://i.pravatar.cc/150?u=${t.id}` }}
              style={styles.techAv}
            />
            <View style={styles.onlineDot} />
            <Text style={styles.techName} numberOfLines={1}>{t.name?.split(' ')[0]}</Text>
            <View style={styles.techRating}>
              <Ionicons name="star" size={10} color={AMBER} />
              <Text style={styles.techRatingTxt}>4.9</Text>
            </View>
          </Pressable>
        )) : (
          <View style={styles.techEmpty}>
            <Text style={styles.techEmptyTxt}>Finding expert technicians…</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Run Diagnostics ───────────────────────────────── */}
      <Pressable style={styles.diagCard} onPress={() => go('/diagnose')}>
        <View>
          <Text style={styles.diagTitle}>Run Full Diagnostics</Text>
          <Text style={styles.diagDesc}>Test battery, screen, sensors & more</Text>
        </View>
        <View style={styles.diagIcon}>
          <Ionicons name="medkit" size={28} color={INDIGO} />
        </View>
      </Pressable>

      {/* ── Refer & Wallet ────────────────────────────────── */}
      <View style={styles.earnRow}>
        <Pressable style={styles.earnCard}>
          <View style={[styles.earnIcon, { backgroundColor: '#FFFBEB' }]}>
            <Ionicons name="gift" size={20} color={AMBER} />
          </View>
          <View>
            <Text style={styles.earnTitle}>Refer & Earn</Text>
            <Text style={styles.earnVal}>Get ₹100</Text>
          </View>
        </Pressable>
        <Pressable style={styles.earnCard} onPress={() => go('/(tabs)/orders')}>
          <View style={[styles.earnIcon, { backgroundColor: '#EFF6FF' }]}>
            <Ionicons name="wallet" size={20} color={BLUE} />
          </View>
          <View>
            <Text style={styles.earnTitle}>Mobi Wallet</Text>
            <Text style={styles.earnVal}>₹250.00</Text>
          </View>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: BG },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  greeting:    { fontSize: 13, color: GRAY },
  name:        { fontSize: 26, fontWeight: '700', color: NAVY, marginTop: 2 },
  hRight:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBtn:     { width: 44, height: 44, borderRadius: 22, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  notifBadge:  { position: 'absolute', top: 11, right: 11, width: 9, height: 9, borderRadius: 5, backgroundColor: RED, borderWidth: 2, borderColor: CARD },
  avatar:      { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: '#FFF' },

  // Hero
  hero:         { backgroundColor: NAVY2, borderRadius: 32, padding: 24, marginBottom: 24, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.22, shadowRadius: 28, elevation: 14 },
  heroGlow:     { position: 'absolute', right: -20, top: -20, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(0,230,118,0.12)' },
  heroGlow2:    { position: 'absolute', left: -30, bottom: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(79,140,255,0.08)' },
  heroTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  detectedChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 12 },
  chipDot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN },
  chipText:     { fontSize: 9, fontWeight: '700', color: '#CBD5E1', letterSpacing: 1.2 },
  deviceName:   { fontSize: 24, fontWeight: '700', color: '#FFF', marginBottom: 4, maxWidth: SW * 0.55 },
  deviceSub:    { fontSize: 13, color: '#94A3B8' },
  statsRow:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  statItem:     { alignItems: 'center', gap: 3, flex: 1 },
  statVal:      { fontSize: 13, fontWeight: '700', color: '#FFF' },
  statLabel:    { fontSize: 10, color: '#64748B' },
  heroDivider:  { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 16 },
  heroFooter:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerTxt:    { fontSize: 13, fontWeight: '500', color: '#FFF' },

  // Quick Actions
  qGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  qCard:   { width: (SW - 52) / 2, backgroundColor: CARD, padding: 18, borderRadius: 24, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 10, elevation: 2 },
  qIcon:   { width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  qLabel:  { fontSize: 14, fontWeight: '600', color: NAVY },

  // Banner
  banner:       { backgroundColor: NAVY2, borderRadius: 32, padding: 24, marginBottom: 24, flexDirection: 'row', overflow: 'hidden', minHeight: 178 },
  bannerContent:{ flex: 1, zIndex: 1 },
  bannerEye:    { fontSize: 10, fontWeight: '700', color: GREEN, letterSpacing: 1.5, marginBottom: 8 },
  bannerTitle:  { fontSize: 22, fontWeight: '700', color: '#FFF', lineHeight: 28, marginBottom: 8 },
  bannerDesc:   { fontSize: 13, color: '#94A3B8', marginBottom: 18, maxWidth: '90%' },
  bannerCTA:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24, alignSelf: 'flex-start' },
  bannerCTATxt: { fontSize: 13, fontWeight: '700', color: NAVY },
  bannerShield: { position: 'absolute', right: -14, bottom: -14 },

  // Techs
  secRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  secTitle:    { fontSize: 18, fontWeight: '700', color: NAVY },
  seeAll:      { fontSize: 14, fontWeight: '600', color: GRAY },
  techList:    { gap: 14, paddingRight: 20, marginBottom: 24 },
  techCard:    { width: 110, backgroundColor: CARD, borderRadius: 24, padding: 16, alignItems: 'center', position: 'relative', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  techAv:      { width: 64, height: 64, borderRadius: 32, marginBottom: 8 },
  onlineDot:   { position: 'absolute', top: 62, right: 30, width: 14, height: 14, borderRadius: 7, backgroundColor: GREEN, borderWidth: 3, borderColor: CARD },
  techName:    { fontSize: 13, fontWeight: '600', color: NAVY },
  techRating:  { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  techRatingTxt:{ fontSize: 11, fontWeight: '600', color: AMBER },
  techEmpty:   { width: SW - 40, height: 100, alignItems: 'center', justifyContent: 'center' },
  techEmptyTxt:{ color: GRAY, fontSize: 14 },

  // Diagnose Card
  diagCard:  { backgroundColor: CARD, borderRadius: 24, padding: 20, marginBottom: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2 },
  diagTitle: { fontSize: 16, fontWeight: '700', color: NAVY, marginBottom: 4 },
  diagDesc:  { fontSize: 13, color: GRAY },
  diagIcon:  { width: 56, height: 56, borderRadius: 18, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },

  // Earn
  earnRow:   { flexDirection: 'row', gap: 12, marginBottom: 16 },
  earnCard:  { flex: 1, backgroundColor: CARD, borderRadius: 24, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 10, elevation: 2 },
  earnIcon:  { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  earnTitle: { fontSize: 13, fontWeight: '700', color: NAVY },
  earnVal:   { fontSize: 12, fontWeight: '600', color: GREEN },
});
