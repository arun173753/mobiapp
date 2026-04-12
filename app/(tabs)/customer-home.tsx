import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert,
  ScrollView, Dimensions, Platform, ActivityIndicator, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';
import { useInsuranceSettings } from '@/lib/use-insurance-settings';

const { width: SW } = Dimensions.get('window');

const BG       = '#F5F5F5';
const CARD     = '#FFFFFF';
const BORDER   = '#EBEBEB';
const FORE     = '#1A1A1A';
const MUTED    = '#888888';
const PRIMARY  = '#E8704A';
const PRIMARY_L = '#FFF1EC';
const BLUE     = '#4A90D9';
const BLUE_L   = '#E8F2FB';
const GREEN    = '#27AE60';
const GREEN_L  = '#E8F5ED';
const PURPLE   = '#9B6DD4';
const PURPLE_L = '#F3ECFC';
const AMBER    = '#F59E0B';

const SERVICES = [
  { id: 'screen',  icon: 'phone-portrait-outline',   label: 'Screen',       color: BLUE,   bg: BLUE_L    },
  { id: 'battery', icon: 'battery-charging-outline', label: 'Battery',      color: GREEN,  bg: GREEN_L   },
  { id: 'back',    icon: 'shield-outline',            label: 'Back Panel',   color: PURPLE, bg: PURPLE_L  },
  { id: 'full',    icon: 'construct-outline',         label: 'Full Service', color: PRIMARY, bg: PRIMARY_L },
];

const SERVICE_CATEGORIES = [
  { id: 'phone',       label: 'Mobile',      icon: 'phone-portrait-outline',   color: '#E87722', bg: '#FEF3E7' },
  { id: 'electrician', label: 'Electrician', icon: 'flash-outline',             color: '#F59E0B', bg: '#FFFBEA' },
  { id: 'plumber',     label: 'Plumber',     icon: 'water-outline',             color: '#3B82F6', bg: '#EFF6FF' },
  { id: 'ac',          label: 'AC Service',  icon: 'snow-outline',              color: '#06B6D4', bg: '#ECFEFF' },
  { id: 'appliance',   label: 'Appliance',   icon: 'tv-outline',                color: '#8B5CF6', bg: '#F3ECFC' },
  { id: 'cctv',        label: 'CCTV',        icon: 'videocam-outline',           color: '#64748B', bg: '#F1F5F9' },
];

const CATEGORY_CHIPS: Record<string, { id: string; label: string; icon: string }[]> = {
  phone: [
    { id: 'screen',      label: 'Screen Broken',       icon: 'phone-portrait-outline' },
    { id: 'battery',     label: 'Battery Issue',        icon: 'battery-dead-outline'  },
    { id: 'charging',    label: 'Not Charging',         icon: 'flash-outline'         },
    { id: 'water',       label: 'Water Damage',         icon: 'water-outline'         },
    { id: 'camera',      label: 'Camera Not Working',   icon: 'camera-outline'        },
    { id: 'speaker',     label: 'Speaker Issue',        icon: 'volume-high-outline'   },
    { id: 'motherboard', label: 'Motherboard Issue',    icon: 'hardware-chip-outline' },
    { id: 'software',    label: 'Software Issue',       icon: 'code-slash-outline'    },
    { id: 'back_panel',  label: 'Back Panel Broken',    icon: 'shield-outline'        },
    { id: 'mic',         label: 'Mic Not Working',      icon: 'mic-off-outline'       },
    { id: 'touch',       label: 'Touch Not Responding', icon: 'hand-left-outline'     },
    { id: 'other',       label: 'Other Issue',          icon: 'construct-outline'     },
  ],
  electrician: [
    { id: 'wiring',      label: 'Wiring Issue',         icon: 'git-branch-outline'    },
    { id: 'fan',         label: 'Fan Repair',           icon: 'sync-outline'          },
    { id: 'switchboard', label: 'Switchboard',          icon: 'toggle-outline'        },
    { id: 'short',       label: 'Short Circuit',        icon: 'warning-outline'       },
    { id: 'install',     label: 'New Installation',     icon: 'add-circle-outline'    },
    { id: 'socket',      label: 'AC / Power Socket',    icon: 'power-outline'         },
    { id: 'mcb',         label: 'MCB Trip',             icon: 'flash-off-outline'     },
    { id: 'light',       label: 'Light / Fitting',      icon: 'bulb-outline'          },
    { id: 'meter',       label: 'Meter Issue',          icon: 'speedometer-outline'   },
    { id: 'other',       label: 'Other Issue',          icon: 'construct-outline'     },
  ],
  plumber: [
    { id: 'tap',         label: 'Leaking Tap',          icon: 'water-outline'         },
    { id: 'drain',       label: 'Clogged Drain',        icon: 'arrow-down-circle-outline' },
    { id: 'heater',      label: 'Water Heater',         icon: 'flame-outline'         },
    { id: 'pipe',        label: 'Pipe Burst / Leak',    icon: 'cut-outline'           },
    { id: 'fitting',     label: 'New Fitting',          icon: 'build-outline'         },
    { id: 'flush',       label: 'Flush Tank Repair',    icon: 'refresh-outline'       },
    { id: 'pump',        label: 'Water Pump',           icon: 'cellular-outline'      },
    { id: 'motor',       label: 'Motor Repair',         icon: 'hardware-chip-outline' },
    { id: 'other',       label: 'Other Issue',          icon: 'construct-outline'     },
  ],
  ac: [
    { id: 'gas',         label: 'Gas Refill',           icon: 'thermometer-outline'   },
    { id: 'not_cooling', label: 'Not Cooling',          icon: 'sunny-outline'         },
    { id: 'water_leak',  label: 'Water Leaking',        icon: 'water-outline'         },
    { id: 'noise',       label: 'AC Noisy',             icon: 'volume-mute-outline'   },
    { id: 'not_start',   label: 'Not Starting',         icon: 'power-outline'         },
    { id: 'cleaning',    label: 'Deep Cleaning',        icon: 'sparkles-outline'      },
    { id: 'remote',      label: 'Remote Issue',         icon: 'radio-outline'         },
    { id: 'other',       label: 'Other Issue',          icon: 'construct-outline'     },
  ],
  appliance: [
    { id: 'washing',     label: 'Washing Machine',      icon: 'ellipse-outline'       },
    { id: 'fridge',      label: 'Refrigerator',         icon: 'cube-outline'          },
    { id: 'microwave',   label: 'Microwave / Oven',     icon: 'radio-outline'         },
    { id: 'tv',          label: 'TV Repair',            icon: 'tv-outline'            },
    { id: 'geyser',      label: 'Geyser / Water Heater',icon: 'flame-outline'         },
    { id: 'mixer',       label: 'Mixer / Grinder',      icon: 'nutrition-outline'     },
    { id: 'purifier',    label: 'Water Purifier',       icon: 'water-outline'         },
    { id: 'other',       label: 'Other Appliance',      icon: 'construct-outline'     },
  ],
  cctv: [
    { id: 'install',     label: 'Camera Installation',  icon: 'videocam-outline'      },
    { id: 'offline',     label: 'Camera Offline',       icon: 'eye-off-outline'       },
    { id: 'dvr',         label: 'DVR / NVR Issue',      icon: 'server-outline'        },
    { id: 'cable',       label: 'Cable Fault',          icon: 'git-commit-outline'    },
    { id: 'monitor',     label: 'Monitor Issue',        icon: 'desktop-outline'       },
    { id: 'night',       label: 'Night Vision Issue',   icon: 'moon-outline'          },
    { id: 'other',       label: 'Other Issue',          icon: 'construct-outline'     },
  ],
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function initials(name?: string) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function go(route: string) {
  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  router.push(route as any);
}

function etaFromDist(km: number): string {
  const mins = Math.max(5, Math.round(km * 8 + 4));
  return `${mins} mins`;
}

function seededRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  const x = Math.sin(Math.abs(h)) * 10000;
  return x - Math.floor(x);
}

function techRating(id: string) {
  const r = seededRandom(id + 'rating');
  return (4.3 + r * 0.7).toFixed(1);
}

function techReviews(id: string) {
  const r = seededRandom(id + 'reviews');
  return String(Math.floor(200 + r * 800));
}

export default function CustomerHomeScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const { settings: insuranceSettings, refresh: refreshInsuranceSettings } = useInsuranceSettings();
  const [techs, setTechs]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const locationFetched = useRef(false);

  // Refresh insurance settings when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      refreshInsuranceSettings();
    }, [refreshInsuranceSettings])
  );

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom + 16;

  // Lead submission state
  const [selectedCategory, setSelectedCategory] = useState('phone');
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [issueDesc, setIssueDesc] = useState('');
  const [submittingLead, setSubmittingLead] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [detectedLocation, setDetectedLocation] = useState('');

  const switchCategory = useCallback((catId: string) => {
    setSelectedCategory(catId);
    setSelectedIssues([]);
  }, []);

  const toggleIssue = useCallback((id: string) => {
    setSelectedIssues(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }, []);

  const currentCatDef = SERVICE_CATEGORIES.find(c => c.id === selectedCategory)!;
  const currentChips  = CATEGORY_CHIPS[selectedCategory] ?? [];

  const submitLead = useCallback(async () => {
    if (submittingLead) return;
    if (selectedIssues.length === 0) {
      Alert.alert('Select an issue', 'Please select at least one issue before submitting.');
      return;
    }
    setSubmittingLead(true);
    try {
      const chips = CATEGORY_CHIPS[selectedCategory] ?? [];
      const issueLabels = selectedIssues
        .map(id => chips.find(c => c.id === id)?.label || id)
        .join(', ');
      const catLabel = SERVICE_CATEGORIES.find(c => c.id === selectedCategory)?.label || selectedCategory;
      const locationStr = detectedLocation || (profile?.city ? `${profile.city}${profile.state ? `, ${profile.state}` : ''}` : '');
      const title = `${catLabel}: ${issueLabels}${locationStr ? ` — ${locationStr}` : ''}`;
      const description = issueDesc.trim() || `Customer needs ${catLabel} help with: ${issueLabels}.`;
      const res = await apiRequest('POST', '/api/leads', {
        customerId: profile?.id || '',
        customerName: profile?.name || '',
        title,
        description,
        category: selectedCategory,
        location: locationStr,
        contactNumber: profile?.phone || '',
      });
      const data = await res.json();
      if (data.success) {
        setLeadSubmitted(true);
        setSelectedIssues([]);
        setIssueDesc('');
      } else {
        Alert.alert('Error', data.message || 'Failed to submit. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setSubmittingLead(false);
    }
  }, [selectedCategory, selectedIssues, issueDesc, profile, submittingLead, detectedLocation]);

  const firstName = profile?.name?.split(' ')[0] ?? 'User';
  const city = profile?.city
    ? `${profile.city}${profile.state ? `, ${profile.state}` : ''}`
    : 'Detecting location...';

  const fetchTechs = useCallback(async (lat?: number, lng?: number) => {
    try {
      setLoading(true);
      let url: string;
      if (lat != null && lng != null) {
        url = `/api/technicians/nearby?lat=${lat}&lng=${lng}&radius=50`;
      } else {
        url = '/api/technicians/nearby?lat=17.3850&lng=78.4867&radius=50';
      }
      const res  = await apiRequest('GET', url);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.technicians ?? []);
      setTechs(list.slice(0, 6));
    } catch {
      setTechs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (locationFetched.current) return;
    locationFetched.current = true;
    (async () => {
      const onCoords = async (lat: number, lng: number) => {
        setUserLat(lat);
        setUserLng(lng);
        fetchTechs(lat, lng);
        if (profile?.id) {
          apiRequest('POST', `/api/profiles/${profile.id}/location`, { latitude: String(lat), longitude: String(lng) }).catch(() => {});
        }
        // Reverse geocode (native only)
        if (Platform.OS !== 'web') {
          try {
            const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
            if (geo) {
              const parts = [geo.city || geo.subregion, geo.region].filter(Boolean);
              if (parts.length > 0) setDetectedLocation(parts.join(', '));
            }
          } catch { /* fallback to profile city */ }
        }
      };

      try {
        if (Platform.OS === 'web') {
          if (typeof navigator !== 'undefined' && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (pos) => onCoords(pos.coords.latitude, pos.coords.longitude),
              () => fetchTechs(),
              { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
            );
          } else {
            fetchTechs();
          }
        } else {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            await onCoords(loc.coords.latitude, loc.coords.longitude);
          } else {
            fetchTechs();
          }
        }
      } catch {
        fetchTechs();
      }
    })();
  }, [fetchTechs, profile?.id]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: BG }}
      contentContainerStyle={{
        paddingTop: topPad + 16,
        paddingBottom: botPad + 100,
        paddingHorizontal: 16,
      }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greetText}>{getGreeting()}</Text>
          <Text style={styles.nameText}>Hello, {firstName}!</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable style={styles.bellBtn} onPress={() => go('/create')}>
            <Ionicons name="add-circle-outline" size={22} color={FORE} />
          </Pressable>
          <Pressable style={styles.bellBtn} onPress={() => go('/chats')}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={FORE} />
            <View style={styles.bellDot} />
          </Pressable>
        </View>
      </View>

      {/* ── Location ──────────────────────────────────────────────────────── */}
      <Pressable style={styles.locationRow}>
        <Ionicons name="location-outline" size={15} color={PRIMARY} />
        <Text style={styles.locationText} numberOfLines={1}>{city}</Text>
        <Ionicons name="chevron-forward" size={14} color={MUTED} />
      </Pressable>


      {/* ── Mobile Protection Plan Banner ───────────────────────────────── */}
      <Pressable style={styles.banner} onPress={() => go('/insurance')}>
        <View style={styles.bannerContent}>
          <View style={styles.bannerBadge}>
            <Text style={styles.bannerBadgeTxt}>{insuranceSettings.planName ?? 'Mobile Protection Plan'}</Text>
          </View>
          <Text style={styles.bannerTitle}>{insuranceSettings.planTagline ?? 'Protect Your Phone'}</Text>
          <Text style={styles.bannerDesc}>
            ₹{(insuranceSettings.monthlyPrice ?? 249).toLocaleString('en-IN')}/month ({insuranceSettings.minMonths ?? 3}-month min) or ₹{(insuranceSettings.yearlyPrice ?? 1499).toLocaleString('en-IN')}/year{'\n'}{insuranceSettings.savingsText ?? 'Save up to ₹4000 on repairs'}
          </Text>
          <View style={styles.bannerTags}>
            {(insuranceSettings.features?.length ? insuranceSettings.features : ['Screen damage', 'Doorstep service']).map((f, i) => (
              <Text key={i} style={styles.bannerTag}>{f}</Text>
            ))}
          </View>
          <View style={styles.bannerBtn}>
            <Text style={styles.bannerBtnTxt}>{insuranceSettings.buttonText ?? 'Get Protection'}</Text>
          </View>
        </View>
        <View style={styles.bannerShield}>
          <Ionicons name="shield-checkmark" size={72} color="rgba(255,255,255,0.35)" />
        </View>
      </Pressable>

      {/* ── Quick Services ────────────────────────────────────────────────── */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Quick Services</Text>
        <Pressable onPress={() => go('/technician-map')}>
          <Text style={styles.seeAll}>Find Technician</Text>
        </Pressable>
      </View>
      <View style={styles.servicesGrid}>
        {SERVICES.map(s => (
          <Pressable key={s.id} style={styles.serviceCard}>
            <View style={[styles.serviceIcon, { backgroundColor: s.bg }]}>
              <Ionicons name={s.icon as any} size={22} color={s.color} />
            </View>
            <Text style={styles.serviceLabel}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── Book a Service ─────────────────────────────────────────────────── */}
      <View style={styles.leadCard}>
        <View style={styles.leadCardHeader}>
          <View style={[styles.leadCardHeaderIcon, { backgroundColor: currentCatDef.color }]}>
            <Ionicons name={currentCatDef.icon as any} size={18} color="#fff" />
          </View>
          <Text style={styles.leadCardTitle}>Book a {currentCatDef.label}</Text>
        </View>

        {/* Category selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catScrollContent}>
          {SERVICE_CATEGORIES.map(cat => {
            const active = selectedCategory === cat.id;
            return (
              <Pressable
                key={cat.id}
                style={[styles.catTab, active && { backgroundColor: cat.color, borderColor: cat.color }]}
                onPress={() => switchCategory(cat.id)}
              >
                <Ionicons name={cat.icon as any} size={13} color={active ? '#fff' : MUTED} />
                <Text style={[styles.catTabText, active && { color: '#fff', fontFamily: 'Inter_700Bold' }]}>{cat.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Auto-detected info pills */}
        <View style={styles.leadInfoRow}>
          <Ionicons name="call-outline" size={14} color={PRIMARY} />
          <Text style={styles.leadInfoText}>{profile?.phone || 'No phone detected'}</Text>
          <View style={styles.leadInfoBadge}>
            <Text style={styles.leadInfoBadgeText}>Auto</Text>
          </View>
        </View>
        <View style={[styles.leadInfoRow, { marginBottom: 16 }]}>
          <Ionicons name="location-outline" size={14} color={PRIMARY} />
          <Text style={styles.leadInfoText} numberOfLines={1}>
            {detectedLocation || (profile?.city ? `${profile.city}${profile.state ? `, ${profile.state}` : ''}` : 'Detecting location...')}
          </Text>
          <View style={styles.leadInfoBadge}>
            <Text style={styles.leadInfoBadgeText}>GPS</Text>
          </View>
        </View>

        {/* Issue chips — dynamic per category */}
        <Text style={styles.leadChipLabel}>What's the issue? <Text style={{ color: PRIMARY }}>*</Text></Text>
        <View style={styles.leadChipsGrid}>
          {currentChips.map(chip => {
            const active = selectedIssues.includes(chip.id);
            return (
              <Pressable
                key={chip.id}
                style={[styles.issueChip, active && { backgroundColor: currentCatDef.color, borderColor: currentCatDef.color }]}
                onPress={() => toggleIssue(chip.id)}
              >
                <Ionicons name={chip.icon as any} size={13} color={active ? '#fff' : FORE} />
                <Text style={[styles.issueChipText, active && styles.issueChipTextActive]}>{chip.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Optional extra description */}
        <TextInput
          style={styles.leadDescInput}
          placeholder="Additional details (optional)"
          placeholderTextColor={MUTED}
          value={issueDesc}
          onChangeText={setIssueDesc}
          multiline
          numberOfLines={2}
          maxLength={200}
        />

        {/* Success state */}
        {leadSubmitted ? (
          <View style={styles.leadSuccessCard}>
            <View style={styles.leadSuccessIcon}>
              <Ionicons name="checkmark-circle" size={36} color={GREEN} />
            </View>
            <Text style={styles.leadSuccessTitle}>Request Submitted!</Text>
            <Text style={styles.leadSuccessDesc}>
              Technicians near you have been notified. They will call you on{' '}
              <Text style={{ fontFamily: 'Inter_700Bold' }}>{profile?.phone || 'your number'}</Text> shortly.
            </Text>
            <Pressable style={styles.leadSubmitAnotherBtn} onPress={() => setLeadSubmitted(false)}>
              <Ionicons name="add-circle-outline" size={16} color={PRIMARY} />
              <Text style={styles.leadSubmitAnotherText}>Submit Another Request</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={[styles.leadSubmitBtn, submittingLead && { opacity: 0.65 }]}
            onPress={submitLead}
            disabled={submittingLead}
          >
            {submittingLead
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <Ionicons name="send-outline" size={16} color="#fff" />
                  <Text style={styles.leadSubmitTxt}>Submit Request</Text>
                </>
            }
          </Pressable>
        )}
      </View>

      {/* ── Nearby Technicians ────────────────────────────────────────────── */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Nearby Technicians</Text>
        <Pressable onPress={() => go('/technician-map')}>
          <Text style={styles.seeAll}>View All</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={PRIMARY} style={{ marginVertical: 28 }} />
      ) : techs.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="people-outline" size={36} color={MUTED} />
          <Text style={styles.emptyTxt}>No technicians found nearby</Text>
          <Text style={styles.emptySubTxt}>Try expanding your search area</Text>
        </View>
      ) : (
        <View style={styles.techList}>
          {techs.map((tech, i) => (
            <TechCard key={tech.id ?? i} tech={tech} />
          ))}
        </View>
      )}

      {/* ── Ask for Repair ────────────────────────────────────────────────── */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Ask for Repair</Text>
      </View>
      <Pressable style={styles.askRepairCard} onPress={() => go('/create')}>
        <View style={styles.askRepairIcon}>
          <Ionicons name="create-outline" size={28} color={PRIMARY} />
        </View>
        <View style={styles.askRepairContent}>
          <Text style={styles.askRepairTitle}>Post Your Repair Request</Text>
          <Text style={styles.askRepairDesc}>Tell technicians what you need repaired</Text>
        </View>
        <View style={styles.askRepairArrow}>
          <Ionicons name="chevron-forward" size={18} color={MUTED} />
        </View>
      </Pressable>
    </ScrollView>
  );
}

// ── Tech Card ───────────────────────────────────────────────────────────────
function TechCard({ tech }: { tech: any }) {
  const { profile, startConversation } = useApp();
  const distNum  = typeof tech.distance === 'number' ? tech.distance : null;
  const distStr  = distNum != null ? `${distNum.toFixed(1)} km` : null;
  const eta      = distNum != null ? etaFromDist(distNum) : `${15 + Math.floor(seededRandom(tech.id + 'eta') * 20)} mins`;
  const rating   = techRating(tech.id ?? '0');
  const reviews  = techReviews(tech.id ?? '0');
  const isVerified = true;

  const handleChat = async () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (tech.id) {
      // Open technician's profile where user can see details and chat option
      router.push({ pathname: '/user-profile', params: { id: tech.id } });
    }
  };

  return (
    <View style={styles.techCard}>
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        {tech.avatar ? (
          <Image
            source={{ uri: tech.avatar }}
            style={styles.avatar}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitials}>{initials(tech.name)}</Text>
          </View>
        )}
        {tech.availableForJobs !== 'false' && <View style={styles.onlineDot} />}
      </View>

      {/* Info */}
      <View style={styles.techInfo}>
        {/* Name + Verified */}
        <View style={styles.techNameRow}>
          <Text style={styles.techName} numberOfLines={1}>{tech.name ?? 'Technician'}</Text>
          {isVerified && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={11} color="#27AE60" />
              <Text style={styles.verifiedTxt}>Verified</Text>
            </View>
          )}
        </View>

        {/* Title */}
        <Text style={styles.techTitle}>Mobile Repair Expert</Text>

        {/* Rating + Distance */}
        <View style={styles.techMeta}>
          <Ionicons name="star" size={12} color={AMBER} />
          <Text style={styles.ratingTxt}>{rating}</Text>
          <Text style={styles.reviewsTxt}>({reviews})</Text>
          {distStr && (
            <>
              <View style={styles.metaDivider} />
              <Ionicons name="location-outline" size={12} color={MUTED} />
              <Text style={styles.distTxt}>{distStr}</Text>
            </>
          )}
        </View>
      </View>

      {/* Right side */}
      <View style={styles.techRight}>
        <View style={styles.etaRow}>
          <Ionicons name="time-outline" size={12} color={GREEN} />
          <Text style={styles.etaTxt}>{eta}</Text>
        </View>
        <Pressable style={styles.chatBtn} onPress={handleChat}>
          <Ionicons name="chatbubble-outline" size={16} color="#FFF" />
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const SHADOW = Platform.select({
  ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8 },
  android: { elevation: 3 },
  default: { boxShadow: '0 2px 8px rgba(0,0,0,0.07)' },
});

const styles = StyleSheet.create({
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  greetText:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  nameText:       { fontSize: 22, fontFamily: 'Inter_700Bold', color: FORE, marginTop: 1 },
  bellBtn:        { width: 42, height: 42, borderRadius: 21, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', ...SHADOW },
  bellDot:        { position: 'absolute', top: 9, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: PRIMARY, borderWidth: 2, borderColor: CARD },

  locationRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 },
  locationText:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, flex: 1 },

  searchBox:      { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 14, paddingHorizontal: 14, height: 50, marginBottom: 18, ...SHADOW },
  searchInput:    { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: FORE },

  banner:         { borderRadius: 18, marginBottom: 24, overflow: 'hidden', backgroundColor: PRIMARY, flexDirection: 'row', alignItems: 'center', minHeight: 152, ...SHADOW },
  bannerContent:  { flex: 1, padding: 18, zIndex: 1 },
  bannerBadge:    { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10 },
  bannerBadgeTxt: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFF' },
  bannerTitle:    { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#FFF', marginBottom: 6 },
  bannerDesc:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.88)', marginBottom: 14 },
  bannerTags:     { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  bannerTag:      { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#FFF', backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  bannerBtn:      { alignSelf: 'flex-start', backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 22 },
  bannerBtnTxt:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: PRIMARY },
  bannerShield:   { paddingRight: 14, alignItems: 'center', justifyContent: 'center' },
  adBannerImage:  { width: '100%', height: 152 },

  sectionRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle:   { fontSize: 17, fontFamily: 'Inter_700Bold', color: FORE },
  seeAll:         { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: PRIMARY },

  servicesGrid:   { flexDirection: 'row', gap: 10, marginBottom: 26 },
  serviceCard:    { flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 14, paddingVertical: 14, alignItems: 'center', gap: 8, ...SHADOW },
  serviceIcon:    { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  serviceLabel:   { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: FORE, textAlign: 'center' },

  techList:       { gap: 12, marginBottom: 16 },
  emptyBox:       { alignItems: 'center', paddingVertical: 36, gap: 8 },
  emptyTxt:       { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: FORE },
  emptySubTxt:    { fontFamily: 'Inter_400Regular', fontSize: 13, color: MUTED },

  techCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...SHADOW,
  },

  avatarWrap: { position: 'relative' },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: '#EEE',
  },
  avatarFallback: {
    backgroundColor: PRIMARY_L,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#FFD5C2',
  },
  avatarInitials: { fontSize: 18, fontFamily: 'Inter_700Bold', color: PRIMARY },
  onlineDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: GREEN, borderWidth: 2, borderColor: CARD,
  },

  techInfo:     { flex: 1, minWidth: 0 },
  techNameRow:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2, flexWrap: 'wrap' },
  techName:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: FORE, flexShrink: 1 },

  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#E8F5ED', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
  },
  verifiedTxt:  { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#27AE60' },

  techTitle:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 5 },

  techMeta:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingTxt:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: FORE },
  reviewsTxt:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  metaDivider:  { width: 3, height: 3, borderRadius: 2, backgroundColor: BORDER, marginHorizontal: 3 },
  distTxt:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },

  techRight:    { alignItems: 'flex-end', gap: 10 },
  etaRow:       { flexDirection: 'row', alignItems: 'center', gap: 3 },
  etaTxt:       { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: GREEN },

  chatBtn: {
    backgroundColor: PRIMARY,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },

  askRepairCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
    ...SHADOW,
  },
  askRepairIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: PRIMARY_L,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askRepairContent: { flex: 1, minWidth: 0 },
  askRepairTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FORE, marginBottom: 2 },
  askRepairDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  askRepairArrow: { paddingLeft: 8 },

  // Lead submission card
  leadCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 18,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: BORDER,
    ...SHADOW,
  },
  leadCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  leadCardHeaderIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center',
  },
  leadCardTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: FORE,
    flex: 1,
  },
  catScroll: {
    marginBottom: 14,
    marginHorizontal: -2,
  },
  catScrollContent: {
    gap: 8,
    paddingHorizontal: 2,
  },
  catTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  catTabText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: MUTED,
  },
  leadInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    marginBottom: 2,
  },
  leadInfoText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: FORE,
    flex: 1,
  },
  leadInfoBadge: {
    backgroundColor: PRIMARY_L,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  leadInfoBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: PRIMARY,
  },
  leadChipLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: MUTED,
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  leadChipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  issueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  issueChipActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  issueChipText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: FORE,
  },
  issueChipTextActive: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
  },
  leadDescInput: {
    marginBottom: 14,
    backgroundColor: BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: FORE,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  leadSubmitBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  leadSubmitTxt: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: 0.3,
  },
  leadSuccessCard: {
    alignItems: 'center',
    backgroundColor: GREEN_L,
    borderRadius: 14,
    padding: 20,
    marginTop: 4,
  },
  leadSuccessIcon: {
    marginBottom: 8,
  },
  leadSuccessTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: GREEN,
    marginBottom: 6,
  },
  leadSuccessDesc: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: FORE,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },
  leadSubmitAnotherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: PRIMARY,
  },
  leadSubmitAnotherText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: PRIMARY,
  },
});
