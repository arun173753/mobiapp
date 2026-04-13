import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator,
  Alert, Linking, Platform, RefreshControl, Modal, useWindowDimensions,
} from 'react-native';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { WebView } from 'react-native-webview';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { getSessionToken } from '@/lib/storage';
import { useApp } from '@/lib/context';
import { isAdminUser } from '@/lib/types';

const ORANGE = '#FF6A00';
const ORANGE_LIGHT = '#FFF3EC';
const BG = '#F5F5F5';
const TEXT_DARK = '#1A1A1A';
const TEXT_MID = '#555555';
const TEXT_LIGHT = '#999999';
const GREEN = '#16A34A';
const GREEN_LIGHT = '#F0FDF4';

type CategoryKey = 'all' | 'repair' | 'electrician' | 'plumber' | 'ac' | 'cleaning' | 'other';
type SortOrder = 'latest' | 'oldest';
type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const CATEGORIES: Array<{ key: CategoryKey; label: string; icon: IoniconsName }> = [
  { key: 'all', label: 'All', icon: 'apps-outline' },
  { key: 'repair', label: 'Repair', icon: 'construct-outline' },
  { key: 'electrician', label: 'Electrician', icon: 'flash-outline' },
  { key: 'plumber', label: 'Plumber', icon: 'water-outline' },
  { key: 'ac', label: 'AC', icon: 'snow-outline' },
  { key: 'cleaning', label: 'Cleaning', icon: 'sparkles-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
];

const CATEGORY_ICON_MAP: Record<string, IoniconsName> = {
  all: 'apps-outline',
  repair: 'construct-outline',
  electrician: 'flash-outline',
  plumber: 'water-outline',
  ac: 'snow-outline',
  cleaning: 'sparkles-outline',
  other: 'ellipsis-horizontal-outline',
};

interface Lead {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  customerName: string;
  contactNumber: string;
  createdAt: number;
  price: number;
  buyerCount: number;
  maxBuyers: number;
  purchased: boolean;
  isFull: boolean;
  purchasedBy: string[];
  latitude?: string;
  longitude?: string;
  distance?: number;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isHot(ts: number): boolean {
  return Date.now() - ts < 2 * 60 * 60 * 1000;
}

function SkeletonCard() {
  const shimmer = useSharedValue(0);
  useEffect(() => {
    shimmer.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900 }),
        withTiming(0, { duration: 900 })
      ),
      -1
    );
  }, [shimmer]);
  const animStyle = useAnimatedStyle(() => ({ opacity: interpolate(shimmer.value, [0, 1], [0.4, 0.8]) }));

  const Block = ({ w, h, r = 6 }: { w: number | `${number}%`; h: number; r?: number }) => (
    <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: '#E5E5E5' }, animStyle]} />
  );

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <Block w={72} h={22} r={20} />
        <Block w={48} h={18} r={6} />
      </View>
      <Block w="85%" h={18} r={6} />
      <View style={{ height: 8 }} />
      <Block w="65%" h={14} r={6} />
      <View style={{ height: 16 }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Block w="48%" h={40} r={12} />
        <Block w="48%" h={40} r={12} />
      </View>
    </View>
  );
}

function LeadCard({ lead, onBuy, buying, index, userLocation }: { lead: Lead; onBuy: (lead: Lead) => void; buying: boolean; index: number; userLocation?: { lat: number; lng: number } | null }) {
  const [expanded, setExpanded] = useState(false);
  const scale = useSharedValue(1);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const onPressIn = () => { scale.value = withSpring(0.98, { damping: 15 }); };
  const onPressOut = () => { scale.value = withSpring(1, { damping: 15 }); };

  const isFull = lead.isFull;
  const purchased = lead.purchased;
  const buyerCount = lead.buyerCount ?? 0;
  const maxBuyers = lead.maxBuyers ?? 5;
  const price = lead.price ?? 50;
  const spotsLeft = maxBuyers - buyerCount;
  const catIcon: IoniconsName = CATEGORY_ICON_MAP[lead.category] || 'apps-outline';

  let distanceText = '';
  if (userLocation && lead.latitude && lead.longitude) {
    const dist = haversineKm(userLocation.lat, userLocation.lng, parseFloat(lead.latitude), parseFloat(lead.longitude));
    distanceText = dist < 1 ? `${Math.round(dist * 1000)}m away` : `${dist.toFixed(1)}km away`;
  }

  return (
    <Animated.View entering={FadeInDown.duration(350).delay(index * 60)} style={cardStyle}>
      <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={() => setExpanded(e => !e)}>
        <View style={styles.card}>
          {/* Top row */}
          <View style={styles.cardTopRow}>
            <View style={styles.catPill}>
              <Ionicons name={catIcon} size={11} color={ORANGE} />
              <Text style={styles.catPillText}>{(lead.category || 'other').toUpperCase()}</Text>
            </View>
            <View style={styles.cardTopRight}>
              {isHot(lead.createdAt) && !isFull && (
                <View style={styles.hotBadge}>
                  <Text style={styles.hotBadgeText}>HOT</Text>
                </View>
              )}
              {isFull && !purchased && (
                <View style={styles.soldOutBadge}>
                  <Ionicons name="lock-closed" size={10} color="#fff" />
                  <Text style={styles.soldOutBadgeText}>SOLD OUT</Text>
                </View>
              )}
              {purchased && (
                <View style={styles.purchasedBadge}>
                  <Ionicons name="checkmark-circle" size={11} color={GREEN} />
                  <Text style={styles.purchasedBadgeText}>Purchased</Text>
                </View>
              )}
              <Text style={styles.timeText}>{timeAgo(lead.createdAt)}</Text>
            </View>
          </View>

          {/* Title */}
          <Text style={styles.cardTitle} numberOfLines={expanded ? undefined : 2}>{lead.title}</Text>

          {/* Description */}
          {!!lead.description && (
            <Text style={styles.cardDesc} numberOfLines={expanded ? undefined : 2}>{lead.description}</Text>
          )}

          {/* Info pills */}
          <View style={styles.infoRow}>
            {!!lead.location && (
              <View style={styles.infoPill}>
                <Ionicons name="location-outline" size={12} color={TEXT_MID} />
                <Text style={styles.infoPillText}>{lead.location}</Text>
              </View>
            )}
            <View style={[styles.infoPill, styles.pricePill]}>
              <Ionicons name="pricetag-outline" size={12} color={ORANGE} />
              <Text style={styles.pricePillText}>₹{price}</Text>
            </View>
            {!!distanceText && (
              <View style={[styles.infoPill, { backgroundColor: '#E0F2FE' }]}>
                <Ionicons name="navigate-outline" size={12} color="#0284C7" />
                <Text style={[styles.infoPillText, { color: '#0284C7' }]}>{distanceText}</Text>
              </View>
            )}
          </View>

          {/* Buyer interest */}
          <View style={styles.interestRow}>
            <View style={styles.dotsRow}>
              {Array.from({ length: maxBuyers }).map((_, i) => (
                <View key={i} style={[styles.dot, i < buyerCount ? styles.dotFilled : styles.dotEmpty]} />
              ))}
            </View>
            <Text style={styles.interestText}>
              {buyerCount}/{maxBuyers} technicians interested
              {!purchased && !isFull && spotsLeft > 0 && (
                <Text style={styles.spotsText}> · {spotsLeft} left</Text>
              )}
            </Text>
          </View>

          <View style={styles.divider} />

          {/* Action area */}
          {purchased ? (
            <View style={styles.contactBox}>
              <View style={styles.contactTopRow}>
                <Ionicons name="call-outline" size={14} color={GREEN} />
                <Text style={styles.contactLabel}>Customer Contact</Text>
              </View>
              <Text style={styles.contactNumber}>{lead.contactNumber || 'N/A'}</Text>
              {!!lead.contactNumber && (
                <View style={styles.contactBtns}>
                  <Pressable style={styles.callBtn} onPress={() => {
                    const ph = lead.contactNumber;
                    if (Platform.OS === 'web') { try { (window as any).location.href = `tel:${ph}`; } catch {} }
                    else { Linking.openURL(`tel:${ph}`).catch(() => {}); }
                  }}>
                    <Ionicons name="call" size={16} color={GREEN} />
                    <Text style={styles.callBtnText}>Call</Text>
                  </Pressable>
                  <Pressable
                    style={styles.waBtn}
                    onPress={() => Linking.openURL(`https://wa.me/91${lead.contactNumber.replace(/\D/g, '')}`).catch(() => {})}
                  >
                    <Ionicons name="logo-whatsapp" size={16} color="#fff" />
                    <Text style={styles.waBtnText}>WhatsApp</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ) : (
            // Both "available" and "full" states share the same action row; full = disabled button
            <View style={styles.actionRow}>
              <Pressable style={styles.detailsBtn} onPress={() => setExpanded(e => !e)}>
                <Ionicons name={expanded ? 'chevron-up' : 'information-circle-outline'} size={16} color={ORANGE} />
                <Text style={styles.detailsBtnText}>{expanded ? 'Less Details' : 'View Details'}</Text>
              </Pressable>
              <Pressable
                style={[styles.buyBtn, (buying || isFull) && styles.buyBtnDisabled]}
                onPress={() => { if (!isFull) onBuy(lead); }}
                disabled={buying || isFull}
              >
                {buying ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name={isFull ? 'lock-closed' : 'lock-open-outline'} size={15} color="#fff" />
                    <Text style={styles.buyBtnText}>{isFull ? 'Sold Out' : `Get Lead ₹${price}`}</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function EmptyState({ isMyLeads, onRefresh }: { isMyLeads: boolean; onRefresh: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name={isMyLeads ? 'checkmark-circle-outline' : 'briefcase-outline'} size={44} color={ORANGE} />
      </View>
      <Text style={styles.emptyTitle}>
        {isMyLeads ? 'No purchased leads' : 'No leads available right now'}
      </Text>
      <Text style={styles.emptySubtitle}>
        {isMyLeads
          ? 'Buy leads from the Lead Box to see them here'
          : 'Check back later or try a different category'}
      </Text>
      <Pressable style={styles.emptyRefreshBtn} onPress={onRefresh}>
        <Ionicons name="refresh-outline" size={16} color={ORANGE} />
        <Text style={styles.emptyRefreshText}>Refresh</Text>
      </Pressable>
    </View>
  );
}

export default function LeadsScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const isAdmin = isAdminUser(profile);
  const canAccessLeads = profile?.role === 'technician' || isAdmin;
  const { width: screenWidth } = useWindowDimensions();

  const [activeTab, setActiveTab] = useState<'box' | 'myLeads'>('box');
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('all');
  const [sort, setSort] = useState<SortOrder>('latest');
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS !== 'web') {
          const { status } = await require('expo-location').requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await require('expo-location').getCurrentPositionAsync({ accuracy: 3 });
            setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          }
        }
      } catch (e) {
        console.warn('[Leads] Location error:', e);
      }
    })();
  }, []);

  // Tab indicator: pixel-based positions computed from screen width
  // Tab container: screenWidth - 36px margins - 8px padding = usable width; each tab = half that
  const tabHalfWidth = (screenWidth - 44) / 2;
  const tabPosition = useSharedValue(0);
  const tabIndicatorStyle = useAnimatedStyle(() => ({
    left: withSpring(4 + tabPosition.value * tabHalfWidth, { damping: 15, stiffness: 120 }),
    width: tabHalfWidth,
  }));

  function normalizeLeadsPayload(data: unknown): Lead[] {
    if (Array.isArray(data)) return data as Lead[];
    if (data && typeof data === 'object' && Array.isArray((data as { leads?: unknown }).leads)) {
      return (data as { leads: Lead[] }).leads;
    }
    return [];
  }

  const { data: allLeads, isLoading: loadingAll, isError: errorAll, refetch: refetchAll, isFetching: fetchingAll } = useQuery<Lead[]>({
    queryKey: ['/api/leads', selectedCategory, sort, profile?.id],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/leads?category=${selectedCategory}&sort=${sort}`);
      return normalizeLeadsPayload(await res.json());
    },
    enabled: activeTab === 'box' && canAccessLeads,
    staleTime: 20000,
    retry: 1,
    refetchOnWindowFocus: true,
  });

  const { data: myLeads, isLoading: loadingMy, isError: errorMy, refetch: refetchMy, isFetching: fetchingMy } = useQuery<Lead[]>({
    queryKey: ['/api/leads/my-leads', profile?.id],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/leads/my-leads');
      return normalizeLeadsPayload(await res.json());
    },
    enabled: activeTab === 'myLeads' && canAccessLeads,
    staleTime: 20000,
    retry: 1,
    refetchOnWindowFocus: true,
  });

  useFocusEffect(
    useCallback(() => {
      if (!canAccessLeads) return;
      if (activeTab === 'box') void refetchAll();
      else void refetchMy();
    }, [canAccessLeads, activeTab, refetchAll, refetchMy]),
  );

  // 10-second silent auto-refresh
  useEffect(() => {
    const interval = setInterval(() => {
      setIsAutoRefreshing(true);
      const refetch = activeTab === 'box' ? refetchAll : refetchMy;
      refetch().finally(() => setIsAutoRefreshing(false));
    }, 10000);
    return () => clearInterval(interval);
  }, [activeTab, refetchAll, refetchMy]);

  const switchTab = (tab: 'box' | 'myLeads') => {
    setActiveTab(tab);
    tabPosition.value = tab === 'box' ? 0 : 1;
  };

  const handleBuy = useCallback(async (lead: Lead) => {
    if (buyingId) return;
    setBuyingId(lead.id);
    try {
      const base = getApiUrl();
      const res = await apiRequest('POST', `/api/leads/${lead.id}/buy-order`, {});
      const data = await res.json();

      if (!data.success) {
        Alert.alert('Error', data.message || 'Could not start payment');
        setBuyingId(null);
        return;
      }
      if (data.alreadyPurchased) {
        await refetchAll();
        setBuyingId(null);
        return;
      }

      const sessionToken = (await getSessionToken()) || '';
      const params = new URLSearchParams({
        orderId: data.orderId,
        amount: String(data.amount),
        keyId: data.keyId,
        leadId: data.leadId,
        leadTitle: data.leadTitle || lead.title,
        technicianName: profile?.name || '',
        technicianPhone: profile?.phone || '',
        technicianEmail: profile?.email || '',
        sessionToken,
      });
      const checkoutUrl = new URL(`/api/leads/checkout?${params}`, base).toString();

      if (Platform.OS === 'web') {
        window.open(checkoutUrl, '_blank', 'width=480,height=700');
        setBuyingId(null);
        const pollInterval = setInterval(() => refetchAll(), 5000);
        setTimeout(() => clearInterval(pollInterval), 120000);
      } else {
        setPaymentUrl(checkoutUrl);
        setShowPaymentModal(true);
        setBuyingId(null);
      }
    } catch {
      Alert.alert('Error', 'Could not start payment. Please try again.');
      setBuyingId(null);
    }
  }, [buyingId, profile, refetchAll]);

  const handlePaymentMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'lead_purchased') {
        setShowPaymentModal(false);
        setPaymentUrl('');
        refetchAll();
        refetchMy();
        Alert.alert('Lead Unlocked!', 'Contact details are now visible in My Leads.');
      } else if (data.type === 'lead_purchase_failed') {
        setShowPaymentModal(false);
        setPaymentUrl('');
        Alert.alert('Payment Failed', data.message || 'Please try again.');
      } else if (data.type === 'lead_purchase_cancelled') {
        setShowPaymentModal(false);
        setPaymentUrl('');
      }
    } catch { /* no-op */ }
  }, [refetchAll, refetchMy]);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  if (profile?.role === 'customer') {
    return <Redirect href="/customer-home" />;
  }

  if (!canAccessLeads) {
    return (
      <View style={[styles.container, { paddingTop: topPad + 24 }]}>
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="lock-closed-outline" size={36} color={ORANGE} />
          </View>
          <Text style={styles.emptyTitle}>Technicians Only</Text>
          <Text style={styles.emptySubtitle}>This area is only for verified technicians.</Text>
        </View>
      </View>
    );
  }

  const isLoading = activeTab === 'box' ? loadingAll : loadingMy;
  const isError = activeTab === 'box' ? errorAll : errorMy;
  const isFetching = (activeTab === 'box' ? fetchingAll : fetchingMy) && !isLoading;
  const refetch = activeTab === 'box' ? refetchAll : refetchMy;
  const displayLeads = (activeTab === 'box' ? allLeads : myLeads) || [];
  const totalCount = displayLeads.length;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Lead Box</Text>
          <Text style={styles.headerSub}>
            {isLoading ? 'Loading...' : `${totalCount} service request${totalCount !== 1 ? 's' : ''}`}
          </Text>
        </View>
        <Pressable style={styles.sortBtn} onPress={() => setSort(s => s === 'latest' ? 'oldest' : 'latest')}>
          <Ionicons name={sort === 'latest' ? 'arrow-down-outline' : 'arrow-up-outline'} size={14} color={TEXT_DARK} />
          <Text style={styles.sortBtnText}>{sort === 'latest' ? 'Latest' : 'Oldest'}</Text>
        </Pressable>
      </View>

      {/* Sub-tabs */}
      <View style={styles.tabContainer}>
        <Animated.View style={[styles.tabIndicator, tabIndicatorStyle]} />
        <Pressable style={styles.tabBtn} onPress={() => switchTab('box')}>
          <Ionicons
            name={activeTab === 'box' ? 'briefcase' : 'briefcase-outline'}
            size={14}
            color={activeTab === 'box' ? '#fff' : TEXT_MID}
          />
          <Text style={[styles.tabBtnText, activeTab === 'box' && styles.tabBtnTextActive]}>Lead Box</Text>
        </Pressable>
        <Pressable style={styles.tabBtn} onPress={() => switchTab('myLeads')}>
          <Ionicons
            name={activeTab === 'myLeads' ? 'checkmark-circle' : 'checkmark-circle-outline'}
            size={14}
            color={activeTab === 'myLeads' ? '#fff' : TEXT_MID}
          />
          <Text style={[styles.tabBtnText, activeTab === 'myLeads' && styles.tabBtnTextActive]}>My Leads</Text>
          {(myLeads?.length ?? 0) > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{myLeads!.length}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Category pills */}
      {activeTab === 'box' && (
        <View style={styles.pillWrapper}>
          <FlatList
            data={CATEGORIES}
            keyExtractor={c => c.key}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillRow}
            renderItem={({ item }) => {
              const active = selectedCategory === item.key;
              return (
                <Pressable
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => setSelectedCategory(item.key)}
                >
                  <Ionicons name={item.icon} size={13} color={active ? '#fff' : TEXT_MID} />
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{item.label}</Text>
                </Pressable>
              );
            }}
          />
        </View>
      )}

      {/* Auto-refresh subtle indicator — tiny corner dot, no text */}
      {isAutoRefreshing && (
        <View style={styles.autoRefreshDot} pointerEvents="none">
          <ActivityIndicator size="small" color={ORANGE} style={{ transform: [{ scale: 0.65 }] }} />
        </View>
      )}

      {/* Content */}
      {isLoading ? (
        <View style={styles.listPad}>{[1, 2, 3].map(i => <SkeletonCard key={i} />)}</View>
      ) : isError ? (
        <View style={styles.errorState}>
          <Ionicons name="cloud-offline-outline" size={44} color={ORANGE} />
          <Text style={styles.errorStateTitle}>Could not load leads</Text>
          <Text style={styles.errorStateSub}>Please make sure you are logged in as a technician, then pull down to refresh.</Text>
          <Pressable style={styles.errorRetryBtn} onPress={() => refetch()}>
            <Text style={styles.errorRetryText}>Try Again</Text>
          </Pressable>
        </View>
      ) : displayLeads.length === 0 ? (
        <EmptyState isMyLeads={activeTab === 'myLeads'} onRefresh={refetch} />
      ) : (
        <FlatList
          data={displayLeads}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listPad,
            { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 80 },
          ]}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={ORANGE} colors={[ORANGE]} />
          }
          renderItem={({ item, index }) => (
            <LeadCard
              lead={item}
              onBuy={handleBuy}
              buying={buyingId === item.id}
              index={index}
              userLocation={userLocation}
            />
          )}
        />
      )}

      {/* Floating refresh button */}
      {!isLoading && (
        <Pressable
          style={[styles.fab, { bottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) + 16 }]}
          onPress={() => refetch()}
        >
          {isFetching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="refresh" size={22} color="#fff" />
          )}
        </Pressable>
      )}

      {/* Payment WebView Modal */}
      {Platform.OS !== 'web' && (
        <Modal
          visible={showPaymentModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => { setShowPaymentModal(false); setPaymentUrl(''); }}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pay for Lead</Text>
              <Pressable onPress={() => { setShowPaymentModal(false); setPaymentUrl(''); }} style={styles.modalClose}>
                <Ionicons name="close" size={22} color={TEXT_DARK} />
              </Pressable>
            </View>
            {!!paymentUrl && (
              <WebView
                source={{ uri: paymentUrl }}
                onMessage={handlePaymentMessage}
                style={{ flex: 1 }}
                javaScriptEnabled
                domStorageEnabled
                startInLoadingState
                renderLoading={() => (
                  <View style={styles.webviewLoader}>
                    <ActivityIndicator size="large" color={ORANGE} />
                  </View>
                )}
              />
            )}
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12,
  },
  headerTitle: { fontSize: 26, fontWeight: '800', color: TEXT_DARK, letterSpacing: -0.5 },
  headerSub: { fontSize: 12, color: TEXT_LIGHT, marginTop: 2 },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: '#E8E8E8',
  },
  sortBtnText: { fontSize: 12, fontWeight: '600', color: TEXT_DARK },
  tabContainer: {
    flexDirection: 'row', marginHorizontal: 18, marginBottom: 12,
    backgroundColor: '#E8E8E8', borderRadius: 14, padding: 4, position: 'relative', height: 44,
  },
  tabIndicator: {
    position: 'absolute', top: 4, height: 36,
    backgroundColor: ORANGE, borderRadius: 11,
    shadowColor: ORANGE, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, zIndex: 1 },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: TEXT_MID },
  tabBtnTextActive: { color: '#fff' },
  tabBadge: {
    backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 1, minWidth: 18, alignItems: 'center',
  },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  pillWrapper: { height: 46, flexShrink: 0 },
  pillRow: { paddingHorizontal: 18, paddingBottom: 8, gap: 8, alignItems: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E8E8E8',
  },
  pillActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  pillText: { fontSize: 12, fontWeight: '500', color: TEXT_MID },
  pillTextActive: { color: '#fff', fontWeight: '600' },
  autoRefreshDot: {
    position: 'absolute', top: 12, right: 18, zIndex: 10,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center',
  },
  listPad: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 3,
    marginBottom: 2,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  catPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: ORANGE_LIGHT, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  catPillText: { fontSize: 10, fontWeight: '700', color: ORANGE, letterSpacing: 0.5 },
  cardTopRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hotBadge: { backgroundColor: '#FF3B30', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  hotBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  soldOutBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#555', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  soldOutBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  purchasedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: GREEN_LIGHT, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  purchasedBadgeText: { fontSize: 10, fontWeight: '600', color: GREEN },
  timeText: { fontSize: 11, color: TEXT_LIGHT },
  cardTitle: { fontSize: 16, fontWeight: '700', color: TEXT_DARK, lineHeight: 22, marginBottom: 5 },
  cardDesc: { fontSize: 13, color: TEXT_MID, lineHeight: 19, marginBottom: 10 },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  infoPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F5F5F5', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  pricePill: { backgroundColor: ORANGE_LIGHT },
  infoPillText: { fontSize: 12, color: TEXT_MID, fontWeight: '500' },
  pricePillText: { fontSize: 12, color: ORANGE, fontWeight: '700' },
  interestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  dotsRow: { flexDirection: 'row', gap: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotFilled: { backgroundColor: ORANGE },
  dotEmpty: { backgroundColor: '#E0E0E0' },
  interestText: { fontSize: 11, color: TEXT_LIGHT, flex: 1 },
  spotsText: { color: ORANGE },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginBottom: 12 },
  actionRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  detailsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1.5, borderColor: ORANGE, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    minWidth: 100,
  },
  detailsBtnText: { fontSize: 12, fontWeight: '600', color: ORANGE },
  buyBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: ORANGE, borderRadius: 12, paddingVertical: 11,
    shadowColor: ORANGE, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  buyBtnDisabled: { opacity: 0.45, shadowOpacity: 0 },
  buyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  contactBox: {
    backgroundColor: GREEN_LIGHT, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#BBF7D0',
  },
  contactTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  contactLabel: { fontSize: 11, fontWeight: '600', color: GREEN, textTransform: 'uppercase', letterSpacing: 0.5 },
  contactNumber: { fontSize: 20, fontWeight: '800', color: TEXT_DARK, marginBottom: 10 },
  contactBtns: { flexDirection: 'row', gap: 10 },
  callBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: GREEN, borderRadius: 10, paddingVertical: 9,
  },
  callBtnText: { fontSize: 13, fontWeight: '600', color: GREEN },
  waBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#25D366', borderRadius: 10, paddingVertical: 9,
  },
  waBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: ORANGE_LIGHT, alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT_DARK, marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: TEXT_LIGHT, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyRefreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: ORANGE_LIGHT, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10,
  },
  emptyRefreshText: { fontSize: 14, fontWeight: '600', color: ORANGE },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36 },
  errorStateTitle: { fontSize: 17, fontWeight: '700', color: TEXT_DARK, marginTop: 16, marginBottom: 8, textAlign: 'center' },
  errorStateSub: { fontSize: 13, color: TEXT_LIGHT, textAlign: 'center', lineHeight: 19, marginBottom: 24 },
  errorRetryBtn: {
    backgroundColor: ORANGE, borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10,
  },
  errorRetryText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  fab: {
    position: 'absolute', right: 18,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  modalContainer: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: TEXT_DARK },
  modalClose: { padding: 4 },
  webviewLoader: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
