import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, SectionList, TextInput, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';

const { width: SW } = Dimensions.get('window');

const BG    = '#F2F4F7';
const CARD  = '#FFFFFF';
const DARK  = '#0F172A';
const GRAY  = '#64748B';
const LGRAY = '#94A3B8';
const PRIMARY = '#FF6B2C';

type ModelEntry = { name: string; colors?: string[]; popular?: boolean };
type Series     = { series: string; year: string; icon: string; color: string; models: ModelEntry[] };

const BRAND_DATA: Record<string, Series[]> = {
  Apple: [
    { series: 'iPhone 16 Series', year: '2024', icon: '📱', color: '#1C1C1E', models: [
      { name: 'iPhone 16 Pro Max', popular: true, colors: ['#4E4F53','#F0E6D3','#FAFAFA'] },
      { name: 'iPhone 16 Pro',     popular: true, colors: ['#4E4F53','#F0E6D3','#FAFAFA'] },
      { name: 'iPhone 16 Plus',                   colors: ['#0071E3','#FF6B2C','#34C759','#FAFAFA','#1C1C1E'] },
      { name: 'iPhone 16',                        colors: ['#0071E3','#FF6B2C','#34C759','#FAFAFA','#1C1C1E'] },
    ]},
    { series: 'iPhone 15 Series', year: '2023', icon: '📱', color: '#1C1C1E', models: [
      { name: 'iPhone 15 Pro Max', popular: true, colors: ['#4E4F53','#F4F4F4','#6B4F3A'] },
      { name: 'iPhone 15 Pro',                    colors: ['#4E4F53','#F4F4F4','#6B4F3A'] },
      { name: 'iPhone 15 Plus',                   colors: ['#E8C9A0','#CFE2F3','#FAFAFA','#2C2C2E'] },
      { name: 'iPhone 15',                        colors: ['#E8C9A0','#CFE2F3','#FAFAFA','#2C2C2E'] },
    ]},
    { series: 'iPhone 14 Series', year: '2022', icon: '📱', color: '#1C1C1E', models: [
      { name: 'iPhone 14 Pro Max', popular: true },
      { name: 'iPhone 14 Pro' },
      { name: 'iPhone 14 Plus' },
      { name: 'iPhone 14' },
    ]},
    { series: 'iPhone 13 Series', year: '2021', icon: '📱', color: '#1C1C1E', models: [
      { name: 'iPhone 13 Pro Max' },
      { name: 'iPhone 13 Pro' },
      { name: 'iPhone 13' },
      { name: 'iPhone 13 Mini' },
    ]},
    { series: 'iPhone 12 Series', year: '2020', icon: '📱', color: '#1C1C1E', models: [
      { name: 'iPhone 12 Pro Max' },
      { name: 'iPhone 12 Pro' },
      { name: 'iPhone 12' },
      { name: 'iPhone 12 Mini' },
    ]},
    { series: 'iPhone SE & Older', year: '2019 & below', icon: '📱', color: '#8E8E93', models: [
      { name: 'iPhone SE (3rd Gen)' },
      { name: 'iPhone SE (2nd Gen)' },
      { name: 'iPhone 11 Pro Max' },
      { name: 'iPhone 11 Pro' },
      { name: 'iPhone 11' },
      { name: 'iPhone XS Max' },
      { name: 'iPhone XS' },
      { name: 'iPhone XR' },
      { name: 'iPhone X' },
    ]},
  ],
  Samsung: [
    { series: 'Galaxy S24 Series', year: '2024', icon: '📱', color: '#1428A0', models: [
      { name: 'Galaxy S24 Ultra', popular: true },
      { name: 'Galaxy S24+',      popular: true },
      { name: 'Galaxy S24' },
    ]},
    { series: 'Galaxy A55/A35 Series', year: '2024', icon: '📱', color: '#1428A0', models: [
      { name: 'Galaxy A55 5G', popular: true },
      { name: 'Galaxy A35 5G' },
      { name: 'Galaxy A25 5G' },
      { name: 'Galaxy A15 5G' },
    ]},
    { series: 'Galaxy M Series', year: '2024', icon: '📱', color: '#1428A0', models: [
      { name: 'Galaxy M55 5G' },
      { name: 'Galaxy M35 5G' },
      { name: 'Galaxy M15 5G' },
    ]},
    { series: 'Galaxy Z Series', year: '2024', icon: '📱', color: '#1428A0', models: [
      { name: 'Galaxy Z Fold 6' },
      { name: 'Galaxy Z Flip 6' },
    ]},
    { series: 'Galaxy S23 & Older', year: '2023 & below', icon: '📱', color: '#8E8E93', models: [
      { name: 'Galaxy S23 Ultra' },
      { name: 'Galaxy S23+' },
      { name: 'Galaxy S23' },
      { name: 'Galaxy S22 Ultra' },
      { name: 'Galaxy S22' },
    ]},
  ],
  Xiaomi: [
    { series: 'Xiaomi 14 Series', year: '2024', icon: '📱', color: '#FF6900', models: [
      { name: 'Xiaomi 14 Ultra', popular: true },
      { name: 'Xiaomi 14 Pro' },
      { name: 'Xiaomi 14' },
    ]},
    { series: 'Redmi Note 13 Series', year: '2024', icon: '📱', color: '#FF6900', models: [
      { name: 'Redmi Note 13 Pro+ 5G', popular: true },
      { name: 'Redmi Note 13 Pro 5G' },
      { name: 'Redmi Note 13 5G' },
      { name: 'Redmi Note 13' },
    ]},
    { series: 'POCO Series', year: '2024', icon: '📱', color: '#FF6900', models: [
      { name: 'POCO X6 Pro 5G', popular: true },
      { name: 'POCO F6 Pro' },
      { name: 'POCO M6 Pro' },
      { name: 'POCO C65' },
    ]},
    { series: 'Redmi 13 Series', year: '2024', icon: '📱', color: '#FF6900', models: [
      { name: 'Redmi 13C 5G' },
      { name: 'Redmi 13C' },
    ]},
  ],
  Vivo: [
    { series: 'Vivo X100 Series', year: '2024', icon: '📱', color: '#415FFF', models: [
      { name: 'Vivo X100 Pro', popular: true },
      { name: 'Vivo X100' },
    ]},
    { series: 'Vivo V30 Series', year: '2024', icon: '📱', color: '#415FFF', models: [
      { name: 'Vivo V30 Pro', popular: true },
      { name: 'Vivo V30' },
      { name: 'Vivo V30e' },
    ]},
    { series: 'Vivo Y Series', year: '2024', icon: '📱', color: '#415FFF', models: [
      { name: 'Vivo Y200' },
      { name: 'Vivo Y100' },
      { name: 'Vivo Y58' },
      { name: 'Vivo Y28' },
    ]},
  ],
  Oppo: [
    { series: 'OPPO Find X7 Series', year: '2024', icon: '📱', color: '#1F8EF1', models: [
      { name: 'OPPO Find X7 Ultra', popular: true },
      { name: 'OPPO Find X7' },
    ]},
    { series: 'OPPO Reno 12 Series', year: '2024', icon: '📱', color: '#1F8EF1', models: [
      { name: 'OPPO Reno 12 Pro', popular: true },
      { name: 'OPPO Reno 12' },
    ]},
    { series: 'OPPO A Series', year: '2024', icon: '📱', color: '#1F8EF1', models: [
      { name: 'OPPO A3 Pro' },
      { name: 'OPPO A60' },
      { name: 'OPPO A38' },
    ]},
  ],
  Realme: [
    { series: 'Realme GT 6 Series', year: '2024', icon: '📱', color: '#E8A100', models: [
      { name: 'Realme GT 6T', popular: true },
      { name: 'Realme GT 6' },
    ]},
    { series: 'Realme 12 Series', year: '2024', icon: '📱', color: '#E8A100', models: [
      { name: 'Realme 12 Pro+', popular: true },
      { name: 'Realme 12 Pro' },
      { name: 'Realme 12' },
    ]},
    { series: 'Realme Narzo Series', year: '2024', icon: '📱', color: '#E8A100', models: [
      { name: 'Realme Narzo 70 Pro' },
      { name: 'Realme Narzo 70' },
    ]},
  ],
  OnePlus: [
    { series: 'OnePlus 12 Series', year: '2024', icon: '📱', color: '#F5010C', models: [
      { name: 'OnePlus 12', popular: true },
      { name: 'OnePlus 12R' },
    ]},
    { series: 'OnePlus Nord Series', year: '2024', icon: '📱', color: '#F5010C', models: [
      { name: 'OnePlus Nord 4' },
      { name: 'OnePlus Nord CE 4' },
      { name: 'OnePlus Nord CE 4 Lite' },
    ]},
    { series: 'OnePlus Open', year: '2024', icon: '📱', color: '#F5010C', models: [
      { name: 'OnePlus Open' },
    ]},
  ],
};

const DEFAULT_SERIES: Series[] = [
  { series: 'Latest Models', year: '2024', icon: '📱', color: PRIMARY, models: [
    { name: 'Latest Flagship', popular: true },
    { name: 'Mid-Range Model' },
    { name: 'Budget Model' },
  ]},
];

export default function SelectModelScreen() {
  const insets = useSafeAreaInsets();
  const { brand } = useLocalSearchParams<{ brand?: string }>();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const topInset  = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom + 16;

  const allSeries = BRAND_DATA[brand || ''] || DEFAULT_SERIES;

  const filteredSections = search.trim()
    ? allSeries.map(s => ({
        ...s,
        models: s.models.filter(m => m.name.toLowerCase().includes(search.toLowerCase())),
      })).filter(s => s.models.length > 0)
    : allSeries;

  const handleModel = (model: string) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/repair-services', params: { brand, model } } as any);
  };

  const toggleSeries = (seriesName: string) => {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    setExpanded(prev => prev === seriesName ? null : seriesName);
  };

  return (
    <View style={[styles.root, { paddingTop: topInset }]}>
      {/* Nav */}
      <View style={styles.nav}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </Pressable>
        <View>
          <Text style={styles.navTitle}>{brand || 'Select Model'}</Text>
          <Text style={styles.navSub}>Choose your device series & model</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={GRAY} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search model..."
          placeholderTextColor={GRAY}
          value={search}
          onChangeText={(t) => { setSearch(t); if (t) setExpanded(null); }}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={GRAY} />
          </Pressable>
        )}
      </View>

      <SectionList
        sections={filteredSections.map(s => ({
          ...s,
          data: (expanded === s.series || search.trim()) ? s.models : [],
          key: s.series,
        }))}
        keyExtractor={(item, i) => `${item.name}-${i}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad + 24 }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => {
          const isOpen = expanded === section.series || !!search.trim();
          return (
            <Pressable
              style={({ pressed }) => [styles.seriesCard, { opacity: pressed ? 0.95 : 1 }]}
              onPress={() => !search.trim() && toggleSeries(section.series)}
            >
              <View style={[styles.seriesIconWrap, { backgroundColor: section.color + '18' }]}>
                <Text style={styles.seriesEmoji}>{section.icon}</Text>
              </View>
              <View style={styles.seriesInfo}>
                <Text style={styles.seriesName}>{section.series}</Text>
                <Text style={styles.seriesPrice}>Repair starts ₹499</Text>
              </View>
              {!search.trim() && (
                <View style={[styles.chevronWrap, isOpen && styles.chevronWrapOpen]}>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={isOpen ? PRIMARY : GRAY} />
                </View>
              )}
            </Pressable>
          );
        }}
        renderItem={({ item, section }) => {
          const isOpen = expanded === section.series || !!search.trim();
          if (!isOpen) return null;
          return (
            <Pressable
              style={({ pressed }) => [styles.modelRow, { opacity: pressed ? 0.88 : 1 }]}
              onPress={() => handleModel(item.name)}
            >
              <View style={styles.modelLeft}>
                <View style={[styles.phoneIcon, { backgroundColor: (section as Series).color + '15' }]}>
                  <Ionicons name="phone-portrait" size={18} color={(section as Series).color} />
                </View>
                <View>
                  <View style={styles.modelNameRow}>
                    <Text style={styles.modelName}>{item.name}</Text>
                    {item.popular && (
                      <View style={styles.hotBadge}>
                        <Text style={styles.hotText}>🔥 Hot</Text>
                      </View>
                    )}
                  </View>
                  {item.colors && item.colors.length > 0 && (
                    <View style={styles.colorDots}>
                      {item.colors.slice(0, 5).map((c, i) => (
                        <View key={i} style={[styles.colorDot, { backgroundColor: c, borderColor: c === '#FAFAFA' || c === '#F4F4F4' ? '#E0E0E0' : c }]} />
                      ))}
                      {item.colors.length > 5 && (
                        <Text style={styles.moreColors}>+{item.colors.length - 5}</Text>
                      )}
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.selectArrow}>
                <Ionicons name="chevron-forward" size={18} color={PRIMARY} />
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="search" size={40} color={LGRAY} />
            <Text style={styles.emptyText}>No models found for "{search}"</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  navTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: DARK },
  navSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: GRAY, marginTop: 1 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 10, marginHorizontal: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: DARK, padding: 0 },
  seriesCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, marginHorizontal: 16, marginTop: 10, borderRadius: 16, padding: 14, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  seriesIconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  seriesEmoji: { fontSize: 26 },
  seriesInfo: { flex: 1 },
  seriesName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: DARK, marginBottom: 3 },
  seriesPrice: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: PRIMARY },
  chevronWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  chevronWrapOpen: { backgroundColor: PRIMARY + '15' },
  modelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 2, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FAFBFC', borderRadius: 12, borderLeftWidth: 3, borderLeftColor: PRIMARY + '40' },
  modelLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  phoneIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modelNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: DARK },
  hotBadge: { backgroundColor: '#FFF3E0', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  hotText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#FF9800' },
  colorDots: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  colorDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  moreColors: { fontSize: 11, fontFamily: 'Inter_400Regular', color: GRAY },
  selectArrow: { width: 30, height: 30, borderRadius: 15, backgroundColor: PRIMARY + '10', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: GRAY },
});
