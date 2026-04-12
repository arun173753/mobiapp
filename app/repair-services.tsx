import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';

const PRIMARY = '#FF6B2C';
const BG      = '#F5F7FA';
const CARD    = '#FFFFFF';
const DARK    = '#1A1A2E';
const GRAY    = '#8E8E93';
const GREEN   = '#34C759';

const SERVICES = [
  {
    key: 'screen',
    label: 'Screen Replacement',
    icon: 'phone-portrait' as const,
    desc: 'Cracked or broken display replacement',
    basePrice: 999,
    duration: '1-2 hrs',
    warranty: '3 months',
    color: '#4F8EF7',
    bg: '#EAF1FF',
    popular: true,
  },
  {
    key: 'battery',
    label: 'Battery Replacement',
    icon: 'battery-charging' as const,
    desc: 'Original capacity battery swap',
    basePrice: 499,
    duration: '30-60 min',
    warranty: '6 months',
    color: GREEN,
    bg: '#EAF7EE',
    popular: true,
  },
  {
    key: 'charging',
    label: 'Charging Port Repair',
    icon: 'flash' as const,
    desc: 'Fix slow or no charging issues',
    basePrice: 399,
    duration: '45-90 min',
    warranty: '3 months',
    color: '#FFD700',
    bg: '#FFFBE8',
  },
  {
    key: 'camera',
    label: 'Camera Repair',
    icon: 'camera' as const,
    desc: 'Blurry, black or broken camera fix',
    basePrice: 699,
    duration: '1-2 hrs',
    warranty: '3 months',
    color: PRIMARY,
    bg: '#FFF0EA',
  },
  {
    key: 'speaker',
    label: 'Speaker Repair',
    icon: 'volume-high' as const,
    desc: 'Distorted or no sound fix',
    basePrice: 349,
    duration: '30-60 min',
    warranty: '3 months',
    color: '#AF52DE',
    bg: '#F5EAFF',
  },
  {
    key: 'backpanel',
    label: 'Back Panel Replacement',
    icon: 'phone-portrait-outline' as const,
    desc: 'Cracked back glass or cover',
    basePrice: 599,
    duration: '1-2 hrs',
    warranty: '1 month',
    color: '#FF6B2C',
    bg: '#FFF0EA',
  },
  {
    key: 'motherboard',
    label: 'Motherboard Repair',
    icon: 'hardware-chip' as const,
    desc: 'Advanced board-level repair',
    basePrice: 1499,
    duration: '2-4 hrs',
    warranty: '6 months',
    color: '#5856D6',
    bg: '#EEEEFF',
  },
  {
    key: 'water',
    label: 'Water Damage Repair',
    icon: 'water' as const,
    desc: 'Liquid damage cleaning & repair',
    basePrice: 799,
    duration: '2-4 hrs',
    warranty: '1 month',
    color: '#32ADE6',
    bg: '#E5F6FF',
  },
];

export default function RepairServicesScreen() {
  const insets = useSafeAreaInsets();
  const { brand, model } = useLocalSearchParams<{ brand?: string; model?: string }>();
  const [selected, setSelected] = useState<string[]>([]);

  const topInset  = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 20;

  const toggleService = (key: string) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const selectedServices = SERVICES.filter(s => selected.includes(s.key));
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.basePrice, 0);

  const handleNext = () => {
    if (selected.length === 0) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: '/repair-booking',
      params: {
        brand,
        model,
        services: JSON.stringify(selectedServices.map(s => ({ key: s.key, label: s.label, price: s.basePrice }))),
        total: String(totalPrice),
      },
    } as any);
  };

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      {/* Nav */}
      <View style={styles.navBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.navTitle}>Repair Services</Text>
          {(brand || model) && (
            <Text style={styles.navSub} numberOfLines={1}>
              {[brand, model].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 80 }]}
      >
        <Text style={styles.sectionLabel}>Select all issues with your phone</Text>

        {SERVICES.map((svc) => {
          const isSelected = selected.includes(svc.key);
          return (
            <Pressable
              key={svc.key}
              style={({ pressed }) => [
                styles.serviceCard,
                isSelected && styles.serviceCardSelected,
                { opacity: pressed ? 0.92 : 1 },
              ]}
              onPress={() => toggleService(svc.key)}
            >
              <View style={[styles.serviceIcon, { backgroundColor: isSelected ? svc.color + '22' : svc.bg }]}>
                <Ionicons name={svc.icon} size={24} color={svc.color} />
              </View>
              <View style={styles.serviceInfo}>
                <View style={styles.serviceNameRow}>
                  <Text style={[styles.serviceName, isSelected && { color: PRIMARY }]}>{svc.label}</Text>
                  {svc.popular && (
                    <View style={styles.popularBadge}>
                      <Text style={styles.popularText}>Popular</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.serviceDesc}>{svc.desc}</Text>
                <View style={styles.serviceMeta}>
                  <View style={styles.metaItem}>
                    <Ionicons name="time-outline" size={12} color={GRAY} />
                    <Text style={styles.metaText}>{svc.duration}</Text>
                  </View>
                  <View style={styles.metaDot} />
                  <View style={styles.metaItem}>
                    <Ionicons name="shield-checkmark-outline" size={12} color={GRAY} />
                    <Text style={styles.metaText}>{svc.warranty} warranty</Text>
                  </View>
                </View>
              </View>
              <View style={styles.serviceRight}>
                <Text style={styles.servicePriceFrom}>Starting from</Text>
                <Text style={styles.servicePrice}>₹{svc.basePrice}</Text>
                <View style={[styles.checkCircle, isSelected && styles.checkCircleActive]}>
                  {isSelected && <Ionicons name="checkmark" size={14} color="#FFF" />}
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Bottom CTA */}
      {selected.length > 0 && (
        <View style={[styles.bottomBar, { paddingBottom: bottomPad }]}>
          <View>
            <Text style={styles.bottomLabel}>{selected.length} service{selected.length > 1 ? 's' : ''} selected</Text>
            <Text style={styles.bottomPrice}><Text style={styles.bottomPriceSub}>Starting from </Text>₹{totalPrice}</Text>
          </View>
          <Pressable style={({ pressed }) => [styles.nextBtn, { opacity: pressed ? 0.9 : 1 }]} onPress={handleNext}>
            <Text style={styles.nextBtnText}>Continue</Text>
            <Ionicons name="arrow-forward" size={18} color="#FFF" />
          </Pressable>
        </View>
      )}

      {selected.length === 0 && (
        <View style={[styles.bottomBarEmpty, { paddingBottom: bottomPad }]}>
          <Text style={styles.bottomEmptyText}>Select at least one service to continue</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  navBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  navTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: DARK },
  navSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: GRAY, marginTop: 1 },
  sectionLabel: { fontSize: 15, fontFamily: 'Inter_500Medium', color: GRAY, marginBottom: 12, paddingHorizontal: 16 },
  list: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  serviceCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 16, padding: 14, gap: 12, borderWidth: 1.5, borderColor: 'transparent', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  serviceCardSelected: { borderColor: PRIMARY, backgroundColor: '#FFF8F5' },
  serviceIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  serviceInfo: { flex: 1 },
  serviceNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  serviceName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: DARK },
  popularBadge: { backgroundColor: PRIMARY + '18', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  popularText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: PRIMARY },
  serviceDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: GRAY, marginBottom: 6 },
  serviceMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: GRAY },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: GRAY },
  serviceRight: { alignItems: 'flex-end', gap: 4 },
  servicePriceFrom: { fontSize: 10, fontFamily: 'Inter_400Regular', color: GRAY },
  servicePrice: { fontSize: 15, fontFamily: 'Inter_700Bold', color: DARK, marginBottom: 4 },
  checkCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#D1D1D6', alignItems: 'center', justifyContent: 'center' },
  checkCircleActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: CARD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0F0F0', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 8 },
  bottomLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: GRAY },
  bottomPrice: { fontSize: 20, fontFamily: 'Inter_700Bold', color: DARK },
  bottomPriceSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: GRAY },
  nextBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: PRIMARY, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14, gap: 8, shadowColor: PRIMARY, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  nextBtnText: { color: '#FFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  bottomBarEmpty: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: CARD, paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0F0F0', alignItems: 'center' },
  bottomEmptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: GRAY, textAlign: 'center' },
});
