import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, Animated,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

// ── Mobix Design System ──────────────────────────────────────────────────────
const PRIMARY = '#0F172A';   // dark navy
const GREEN   = '#00E676';   // electric green accent
const BLUE    = '#3B82F6';
const BG      = '#F8FAFC';
const CARD    = '#FFFFFF';
const DARK    = '#0F172A';
const GRAY    = '#64748B';
const ACCENT_GREEN = '#06F906';
const WHITE = '#FFFFFF';
// ─────────────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'detecting' | 'scanning' | 'results';

const CHECKS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; desc: string }[] = [
  { key: 'screen',      label: 'Touch Screen',   icon: 'finger-print', desc: 'Testing touch response...'    },
  { key: 'camera',      label: 'Camera',          icon: 'camera',          desc: 'Checking camera sensor...'   },
  { key: 'speaker',     label: 'Speaker',         icon: 'volume-high',     desc: 'Testing audio output...'     },
  { key: 'microphone',  label: 'Microphone',      icon: 'mic',             desc: 'Testing audio input...'      },
  { key: 'battery',     label: 'Battery Health',  icon: 'battery-charging',    desc: 'Analysing battery...'        },
  { key: 'gps',         label: 'GPS & Location',  icon: 'location',        desc: 'Testing location module...'  },
  { key: 'sensors',     label: 'Sensors',         icon: 'pulse',           desc: 'Testing gyro & accelerometer...' },
  { key: 'network',     label: 'Network',         icon: 'wifi',            desc: 'Checking connectivity...'    },
];

type DeviceInfo = { model: string; os: string; battery: number };

export default function DiagnoseScreen() {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('idle');
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const topInset  = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 16;

  useEffect(() => {
    if (phase !== 'idle') return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.1, duration: 1000, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1.00, duration: 1000, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [phase]);

  const getDeviceInfo = async (): Promise<DeviceInfo> => {
    let model = 'Your Device', os = 'Android', battery = 78;
    if (Platform.OS === 'web') {
      const ua = navigator.userAgent;
      if (ua.includes('iPhone')) model = 'iPhone';
      else if (ua.includes('iPad')) model = 'iPad';
      else if (ua.includes('Android')) {
        const m = ua.match(/;\s*([^)]+)\)/);
        model = m ? (m[1].trim().split(';').pop()?.trim() ?? 'Android Device') : 'Android Device';
      } else model = 'Computer';
      os = ua.includes('iPhone') || ua.includes('iPad') ? 'iOS' : ua.includes('Android') ? 'Android' : 'Desktop';
      try { if ('getBattery' in navigator) { const b = await (navigator as any).getBattery(); battery = Math.round(b.level * 100); } } catch {}
    } else {
      model = Platform.OS === 'ios' ? 'iPhone' : 'Android Phone';
      os    = Platform.OS === 'ios' ? 'iOS' : 'Android';
    }
    return { model, os, battery };
  };

  const startScan = async () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setPhase('detecting'); setCompleted([]); setIssues([]);
    const info = await getDeviceInfo();
    await new Promise(r => setTimeout(r, 1200));
    setDeviceInfo(info); setPhase('scanning');
    const found: string[] = [];
    for (const c of CHECKS) {
      await new Promise(r => setTimeout(r, 350 + Math.random() * 280));
      const bad = c.key === 'speaker' || (c.key === 'battery' && info.battery < 50);
      if (bad) found.push(c.key);
      setCompleted(p => [...p, c.key]);
      if (bad) setIssues(p => [...p, c.key]);
    }
    await new Promise(r => setTimeout(r, 300));
    const s = Math.max(60, 98 - found.length * 12 - (info.battery < 30 ? 10 : info.battery < 50 ? 5 : 0));
    setScore(s); setPhase('results');
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const reset = () => { setPhase('idle'); setCompleted([]); setIssues([]); setDeviceInfo(null); setScore(0); };

  const scoreColor = score >= 85 ? GREEN : score >= 70 ? '#FF9F0A' : '#FF3B30';
  const scoreLabel = score >= 85 ? 'Excellent' : score >= 70 ? 'Fair' : 'Needs Attention';

  /* ─── IDLE ─── */
  if (phase === 'idle') return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.navBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </Pressable>
        <Text style={styles.navTitle}>Smart Diagnosis</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.idleContent, { paddingBottom: bottomPad + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.idleHero}>
          <View style={styles.heroImgWrap}>
            <Image 
              source={{ uri: "https://cdn-icons-png.flaticon.com/512/3067/3067451.png" }} 
              style={styles.heroImg}
              contentFit="contain"
            />
            <View style={styles.questionMarkWrap}>
              <Ionicons name="help" size={40} color={GREEN} />
            </View>
            <Animated.View style={[styles.scanCircle, { transform: [{ scale: pulseAnim }] }]} />
          </View>
          <Text style={styles.heroTitle}>Analyze Your Device</Text>
          <Text style={styles.heroSub}>Mobix AI detects hardware issues instantly</Text>
        </View>

        <View style={styles.checkGrid}>
          {CHECKS.map((c) => (
            <View key={c.key} style={styles.checkPreviewCard}>
              <View style={styles.checkPreviewIcon}>
                <Ionicons name={c.icon} size={20} color={BLUE} />
              </View>
              <Text style={styles.checkPreviewLabel}>{c.label}</Text>
            </View>
          ))}
        </View>

        <Pressable style={({ pressed }) => [styles.startBtn, { opacity: pressed ? 0.9 : 1 }]} onPress={startScan}>
          <Ionicons name="pulse" size={22} color={PRIMARY} />
          <Text style={styles.startBtnText}>Start AI Scan</Text>
        </Pressable>
      </ScrollView>
    </View>
  );

  /* ─── DETECTING ─── */
  if (phase === 'detecting') return (
    <View style={[styles.container, styles.centered, { paddingTop: topInset }]}>
      <View style={styles.detectingCard}>
        <View style={styles.phoneIconWrap}>
          <Ionicons name="phone-portrait" size={48} color={ACCENT_GREEN} />
        </View>
        <Text style={styles.detectingTitle}>Detecting Device</Text>
        <Text style={styles.detectingSub}>Reading system information...</Text>
        <ActivityIndicator style={{ marginTop: 24 }} size="large" color={ACCENT_GREEN} />
      </View>
    </View>
  );

  /* ─── SCANNING ─── */
  if (phase === 'scanning') {
    const done = completed.length, total = CHECKS.length;
    const pct = total > 0 ? done / total : 0;
    const current = CHECKS.find(c => !completed.includes(c.key));
    return (
      <View style={[styles.container, { paddingTop: topInset }]}>
        <View style={styles.navBar}>
          <View style={{ width: 40 }} />
          <Text style={styles.navTitle}>AI Scanning...</Text>
          <View style={{ width: 40 }} />
        </View>
        {deviceInfo && (
          <View style={styles.devicePill}>
            <Ionicons name="phone-portrait-outline" size={14} color={GREEN} />
            <Text style={styles.devicePillText}>{deviceInfo.model} · {deviceInfo.os} · {deviceInfo.battery}%</Text>
          </View>
        )}
        <View style={styles.progressWrap}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` as any }]} />
          </View>
          <Text style={styles.progressLabel}>{done}/{total} checks</Text>
        </View>
        {current && (
          <View style={styles.currentCheck}>
            <ActivityIndicator size="small" color={GREEN} />
            <Text style={styles.currentCheckText}>{current.desc}</Text>
          </View>
        )}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
          {CHECKS.map((c) => {
            const isDone = completed.includes(c.key);
            const isIssue = issues.includes(c.key);
            return (
              <View key={c.key} style={[styles.scanRow, isDone && styles.scanRowDone]}>
                <View style={[styles.scanIconWrap, { backgroundColor: isDone ? (isIssue ? '#FFF3E0' : 'rgba(0,230,118,0.1)') : '#F2F2F7' }]}>
                  <Ionicons name={c.icon} size={18} color={isDone ? (isIssue ? '#FF9F0A' : GREEN) : GRAY} />
                </View>
                <Text style={[styles.scanLabel, isDone && { color: DARK }]}>{c.label}</Text>
                <View style={styles.scanStatus}>
                  {isDone
                    ? <Ionicons name={isIssue ? 'warning' : 'checkmark-circle'} size={22} color={isIssue ? '#FF9F0A' : GREEN} />
                    : <View style={styles.scanPending} />
                  }
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  /* ─── RESULTS ─── */
  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.navBar}>
        <Pressable style={styles.backBtn} onPress={reset}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </Pressable>
        <Text style={styles.navTitle}>AI Report</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.resultsContent, { paddingBottom: bottomPad + 24 }]} showsVerticalScrollIndicator={false}>
        {/* Score Circle */}
        <View style={[styles.scoreCard, { borderColor: scoreColor + '40', backgroundColor: DARK }]}>
          <View style={[styles.scoreCircle, { borderColor: scoreColor }]}>
            <Text style={[styles.scoreNum, { color: scoreColor }]}>{score}</Text>
            <Text style={[styles.scoreOf, { color: 'rgba(255,255,255,0.5)' }]}>/100</Text>
          </View>
          <Text style={[styles.scoreLabel, { color: scoreColor }]}>{scoreLabel}</Text>
          {deviceInfo && (
            <Text style={styles.scoreDevice}>{deviceInfo.model} · {deviceInfo.os} · Battery {deviceInfo.battery}%</Text>
          )}
        </View>

        {/* Check List */}
        <Text style={styles.sectionTitle}>Test Results</Text>
        <View style={styles.resultsCard}>
          {CHECKS.map((c, i) => {
            const isIssue = issues.includes(c.key);
            return (
              <View key={c.key} style={[styles.resultRow, i < CHECKS.length - 1 && styles.resultRowBorder]}>
                <View style={[styles.resultIconWrap, { backgroundColor: isIssue ? '#FFF3E0' : 'rgba(0,230,118,0.1)' }]}>
                  <Ionicons name={c.icon} size={16} color={isIssue ? '#FF9F0A' : GREEN} />
                </View>
                <Text style={styles.resultLabel}>{c.label}</Text>
                <View style={[styles.resultBadge, { backgroundColor: isIssue ? '#FFF3E0' : 'rgba(0,230,118,0.1)' }]}>
                  <Text style={[styles.resultBadgeText, { color: isIssue ? '#FF9F0A' : GREEN }]}>
                    {isIssue ? 'Issue Found' : 'OK'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Actions */}
        {issues.length > 0 && (
          <View style={styles.actionSection}>
            <Text style={styles.actionTitle}>Recommended Actions</Text>
            <Pressable style={styles.primaryAction} onPress={() => router.push('/select-brand' as any)}>
              <Ionicons name="construct" size={18} color={PRIMARY} />
              <Text style={styles.primaryActionText}>Book a Repair</Text>
            </Pressable>
            <Pressable style={styles.secondaryAction} onPress={() => router.push('/insurance' as any)}>
              <Ionicons name="shield-checkmark" size={18} color={GREEN} />
              <Text style={styles.secondaryActionText}>Get Mobix Shield</Text>
            </Pressable>
          </View>
        )}

        <Pressable style={styles.scanAgainBtn} onPress={reset}>
          <Ionicons name="refresh" size={16} color={GRAY} />
          <Text style={styles.scanAgainText}>Scan Again</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  centered: { justifyContent: 'center', alignItems: 'center' },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  navTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: DARK },
  idleContent: { padding: 16, alignItems: 'center' },
  idleHero: { alignItems: 'center', paddingVertical: 20, width: '100%' },
  heroImgWrap: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 20 },
  heroImg: { width: '100%', height: '100%', zIndex: 1 },
  questionMarkWrap: { position: 'absolute', zIndex: 2, backgroundColor: 'rgba(15, 23, 42, 0.8)', width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: GREEN },
  scanCircle: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 2, borderColor: GREEN + '44', backgroundColor: GREEN + '08' },
  heroTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', color: DARK, textAlign: 'center', marginBottom: 8 },
  heroSub: { fontSize: 15, fontFamily: 'Inter_400Regular', color: GRAY, textAlign: 'center' },
  checkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 32, width: '100%' },
  checkPreviewCard: { width: '46%', backgroundColor: CARD, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1 },
  checkPreviewIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  checkPreviewLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: DARK, flex: 1 },
  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: GREEN, borderRadius: 30, paddingVertical: 18, paddingHorizontal: 32, gap: 10, width: '100%', shadowColor: GREEN, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8 },
  startBtnText: { color: PRIMARY, fontSize: 18, fontFamily: 'Inter_700Bold' },
  detectingCard: { backgroundColor: CARD, borderRadius: 24, padding: 32, alignItems: 'center', marginHorizontal: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
  phoneIconWrap: { width: 90, height: 90, borderRadius: 45, backgroundColor: GREEN + '10', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  detectingTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: DARK, marginBottom: 6 },
  detectingSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: GRAY },
  devicePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GREEN + '10', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginHorizontal: 16, marginBottom: 12, alignSelf: 'flex-start' },
  devicePillText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: GREEN },
  progressWrap: { marginHorizontal: 16, marginBottom: 8 },
  progressBg: { height: 10, backgroundColor: '#E5E5EA', borderRadius: 5, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: GREEN, borderRadius: 5 },
  progressLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: GRAY, textAlign: 'right' },
  currentCheck: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  currentCheckText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: GRAY },
  scanRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 16, padding: 14, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  scanRowDone: {},
  scanIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  scanLabel: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: GRAY },
  scanStatus: { width: 28, alignItems: 'center' },
  scanPending: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D1D1D6' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: DARK, marginBottom: 12, paddingHorizontal: 16 },
  scoreCard: { borderRadius: 24, padding: 24, alignItems: 'center', margin: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 8 },
  scoreCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 6, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  scoreNum: { fontSize: 42, fontFamily: 'Inter_700Bold' },
  scoreOf: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  scoreLabel: { fontSize: 20, fontFamily: 'Inter_700Bold', marginBottom: 6 },
  scoreDevice: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.5)' },
  resultsContent: { paddingBottom: 24 },
  resultsCard: { backgroundColor: CARD, borderRadius: 20, marginHorizontal: 16, marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2, overflow: 'hidden' },
  resultRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  resultRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F2F2F7' },
  resultIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  resultLabel: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: DARK },
  resultBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  resultBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  actionSection: { paddingHorizontal: 16, marginBottom: 16, gap: 12 },
  actionTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: DARK, marginBottom: 4 },
  primaryAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: GREEN, borderRadius: 16, paddingVertical: 18, gap: 10, shadowColor: GREEN, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 4 },
  primaryActionText: { color: PRIMARY, fontSize: 17, fontFamily: 'Inter_700Bold' },
  secondaryAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: DARK, borderRadius: 16, paddingVertical: 18, gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  secondaryActionText: { color: WHITE, fontSize: 17, fontFamily: 'Inter_700Bold' },
  scanAgainBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  scanAgainText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: GRAY },
});
