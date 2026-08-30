import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView, Platform, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  Easing, FadeInDown, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { useApp } from '@/lib/context';
import { canBookRide } from '@/lib/types';
import { normalizeImageUri, pickProfilePhotoRaw } from '@/lib/image-helpers';
import { apiRequest } from '@/lib/query-client';

const PANEL_W = 300;
const TEXT = '#111827';
const MUTED = '#6B7280';
const BORDER = '#E5E7EB';
const SURFACE = '#FFFFFF';
const PRIMARY = '#10B981';
const BLUE = '#3B82F6';
const SLIDE_MS = 280;
const SLIDE_EASE = Easing.bezier(0.22, 1, 0.36, 1);

type NavItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  badge?: number;
  onPress: () => void;
};

type Props = {
  schematicsUrl?: string;
  webToolsUrl?: string;
  onSchematicsPress?: () => void;
  variant?: 'header' | 'tab';
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type NavDrawerApi = {
  openNav: () => void;
  closeNav: () => void;
  isOpen: boolean;
};

const NavDrawerContext = createContext<NavDrawerApi | null>(null);

export function useNavDrawer(): NavDrawerApi {
  const ctx = useContext(NavDrawerContext);
  if (!ctx) {
    return { openNav: () => {}, closeNav: () => {}, isOpen: false };
  }
  return ctx;
}

export function NavDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo<NavDrawerApi>(() => ({
    openNav: () => setOpen(true),
    closeNav: () => setOpen(false),
    isOpen: open,
  }), [open]);

  return (
    <NavDrawerContext.Provider value={value}>
      {children}
      <HomeNavMenu hideTrigger open={open} onOpenChange={setOpen} />
    </NavDrawerContext.Provider>
  );
}

const FLOAT_PAD = 8;
const PROFILE_BTN_SIZE = 40;
const POST_BTN_SIZE = 40;
const SHOP_BTN_W = 210;
const SHOP_BTN_H = 40;

function clampFloatPos(x: number, y: number, w: number, h: number, screenW: number, screenH: number) {
  return {
    x: Math.max(FLOAT_PAD, Math.min(screenW - w - FLOAT_PAD, x)),
    y: Math.max(FLOAT_PAD, Math.min(screenH - h - FLOAT_PAD, y)),
  };
}

async function saveFloatPos(key: string, x: number, y: number) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ x, y }));
  } catch {}
}

function DraggableFloat({
  storageKey,
  defaultX,
  defaultY,
  width,
  height,
  hidden,
  onTap,
  accessibilityLabel,
  style,
  children,
}: {
  storageKey: string;
  defaultX: number;
  defaultY: number;
  width: number;
  height: number;
  hidden: boolean;
  onTap: () => void;
  accessibilityLabel: string;
  style?: object;
  children: React.ReactNode;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const posX = useSharedValue(defaultX);
  const posY = useSharedValue(defaultY);
  const startX = useSharedValue(defaultX);
  const startY = useSharedValue(defaultY);
  const screenW = useSharedValue(winW);
  const screenH = useSharedValue(winH);
  const boxW = useSharedValue(width);
  const boxH = useSharedValue(height);
  const dragging = useSharedValue(0);

  useEffect(() => {
    boxW.value = width;
    boxH.value = height;
  }, [width, height, boxW, boxH]);

  useEffect(() => {
    screenW.value = winW;
    screenH.value = winH;
    const next = clampFloatPos(posX.value, posY.value, width, height, winW, winH);
    posX.value = next.x;
    posY.value = next.y;
  }, [winW, winH, width, height, posX, posY, screenW, screenH]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as { x?: number; y?: number };
        if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return;
        const next = clampFloatPos(parsed.x, parsed.y, width, height, winW, winH);
        posX.value = next.x;
        posY.value = next.y;
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [storageKey, posX, posY, width, height, winW, winH]);

  const onDragEnd = (tx: number, ty: number, x: number, y: number) => {
    if (Math.abs(tx) < 8 && Math.abs(ty) < 8) {
      onTap();
      return;
    }
    void saveFloatPos(storageKey, x, y);
  };

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin(() => {
          startX.value = posX.value;
          startY.value = posY.value;
          dragging.value = 1;
        })
        .onUpdate((e) => {
          const next = clampFloatPos(
            startX.value + e.translationX,
            startY.value + e.translationY,
            boxW.value,
            boxH.value,
            screenW.value,
            screenH.value,
          );
          posX.value = next.x;
          posY.value = next.y;
        })
        .onEnd((e) => {
          dragging.value = 0;
          const next = clampFloatPos(posX.value, posY.value, boxW.value, boxH.value, screenW.value, screenH.value);
          posX.value = withSpring(next.x, { damping: 18, stiffness: 220 });
          posY.value = withSpring(next.y, { damping: 18, stiffness: 220 });
          runOnJS(onDragEnd)(e.translationX, e.translationY, next.x, next.y);
        })
        .onFinalize(() => {
          dragging.value = 0;
        }),
    [onTap, storageKey],
  );

  const moveStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: posX.value },
      { translateY: posY.value },
      { scale: dragging.value ? 1.08 : 1 },
    ],
  }));

  if (hidden) return null;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[{ position: 'absolute', top: 0, left: 0, zIndex: 80, width, height }, style, moveStyle]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

function useTechFloatHidden() {
  const pathname = usePathname();
  const { profile, isOnboarded } = useApp();
  const isTech = String(profile?.role || '').toLowerCase() === 'technician';
  return !isOnboarded || !isTech || pathname === '/onboarding' || pathname?.includes('onboarding');
}

/** Persistent top profile control — drag to move, tap to open the left nav. */
export function TopProfileButton() {
  const insets = useSafeAreaInsets();
  const { profile } = useApp();
  const { openNav } = useNavDrawer();
  const hidden = useTechFloatHidden();
  const avatarUri = normalizeImageUri(pickProfilePhotoRaw(profile), { allowRelative: true });
  const defaultY = Platform.OS === 'web' ? 75 : Math.max(insets.top, 8) + 8;

  return (
    <DraggableFloat
      storageKey="mobi_profile_btn_pos_v1"
      defaultX={12}
      defaultY={defaultY}
      width={PROFILE_BTN_SIZE}
      height={PROFILE_BTN_SIZE}
      hidden={hidden}
      onTap={openNav}
      accessibilityLabel="Open navigation. Drag to move."
      style={styles.topProfileBtn}
    >
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.topProfileImg} contentFit="cover" />
      ) : (
        <View style={styles.topProfileFallback}>
          <Ionicons name="person" size={18} color={PRIMARY} />
        </View>
      )}
    </DraggableFloat>
  );
}

const RED = '#EF4444';

export function FloatingShopButton() {
  const insets = useSafeAreaInsets();
  const hidden = useTechFloatHidden();
  const top = Platform.OS === 'web' ? 75 : Math.max(insets.top, 8) + 8;

  if (hidden) return null;

  return (
    <View pointerEvents="box-none" style={[styles.shopFloatWrap, { top }]}>
      <Pressable
        onPress={() => router.push('/spare-parts' as any)}
        accessibilityRole="button"
        accessibilityLabel="Buy spare parts and tools"
        style={styles.shopFloatBtn}
      >
        <Ionicons name="hardware-chip-outline" size={16} color={RED} />
        <Text style={styles.shopFloatTxt} numberOfLines={1}>Buy Spare Parts & Tools</Text>
      </Pressable>
    </View>
  );
}

export function FloatingPostButton() {
  const insets = useSafeAreaInsets();
  const hidden = useTechFloatHidden();
  const defaultY = Platform.OS === 'web' ? 75 : Math.max(insets.top, 8) + 8;

  return (
    <DraggableFloat
      storageKey="mobi_post_btn_pos_v1"
      defaultX={60}
      defaultY={defaultY}
      width={POST_BTN_SIZE}
      height={POST_BTN_SIZE}
      hidden={hidden}
      onTap={() => router.push('/create' as any)}
      accessibilityLabel="Create post. Drag to move."
      style={styles.postFloatBtn}
    >
      <Ionicons name="add-circle-outline" size={20} color={PRIMARY} />
    </DraggableFloat>
  );
}

function AnimatedNavRow({ item, index, playKey }: { item: NavItem; index: number; playKey: number }) {
  return (
    <Animated.View
      key={`${playKey}-${item.key}`}
      entering={FadeInDown.delay(50 + index * 48).duration(340).springify()}
    >
      <Pressable
        onPress={item.onPress}
        style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
      >
        <View style={[styles.itemIcon, { backgroundColor: item.color + '18' }]}>
          <Ionicons name={item.icon} size={18} color={item.color} />
        </View>
        <Text style={styles.itemLabel}>{item.label}</Text>
        {item.badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.badge > 99 ? '99+' : item.badge}</Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={16} color="#BDBDBD" />
      </Pressable>
    </Animated.View>
  );
}

export function HomeNavMenu({
  schematicsUrl,
  webToolsUrl,
  onSchematicsPress,
  variant = 'header',
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const { profile, totalUnread } = useApp();
  const [internalOpen, setInternalOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [fetchedSchematics, setFetchedSchematics] = useState('');
  const [fetchedTools, setFetchedTools] = useState('');
  const [animKey, setAnimKey] = useState(0);
  const slide = useSharedValue(-PANEL_W);
  const dim = useSharedValue(0);
  const isControlled = typeof openProp === 'boolean';
  const open = isControlled ? openProp : internalOpen;

  const isTech = profile?.role === 'technician';
  const showBookRide = canBookRide(profile?.role);
  const avatarUri = normalizeImageUri(pickProfilePhotoRaw(profile), { allowRelative: true });
  const schematics = schematicsUrl || fetchedSchematics;
  const toolsUrl = webToolsUrl || fetchedTools;

  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (schematicsUrl || webToolsUrl) return;
    apiRequest('GET', '/api/app-settings')
      .then((r) => r.json())
      .then((data) => {
        if (data?.schematics_url) setFetchedSchematics(String(data.schematics_url));
        if (data?.web_tools_url) setFetchedTools(String(data.web_tools_url));
      })
      .catch(() => {});
  }, [schematicsUrl, webToolsUrl]);

  useEffect(() => {
    if (open) {
      setShown(true);
      setAnimKey((k) => k + 1);
    }
    slide.value = withTiming(open ? 0 : -PANEL_W, { duration: SLIDE_MS, easing: SLIDE_EASE }, (finished) => {
      if (finished && !open) runOnJS(setShown)(false);
    });
    dim.value = withTiming(open ? 1 : 0, { duration: SLIDE_MS, easing: SLIDE_EASE });
  }, [open, slide, dim]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slide.value }],
  }));

  const dimStyle = useAnimatedStyle(() => ({
    opacity: dim.value,
  }));

  const close = () => setOpen(false);

  const go = (href: string) => {
    close();
    router.navigate(href as any);
  };

  const primaryItems = useMemo<NavItem[]>(() => {
    if (!isTech) return [];
    return [
      { key: 'home', label: 'Home', icon: 'home-outline', color: PRIMARY, onPress: () => go('/') },
      { key: 'dir', label: 'Directory', icon: 'people-outline', color: '#4F46E5', onPress: () => go('/directory') },
      { key: 'spares', label: 'Spare Parts', icon: 'hardware-chip-outline', color: PRIMARY, onPress: () => go('/marketplace') },
      { key: 'learn', label: 'Learn', icon: 'book-outline', color: '#3B82F6', onPress: () => go('/courses') },
      { key: 'fixes', label: 'Hardware Solutions', icon: 'build-outline', color: '#F59E0B', onPress: () => go('/solutions') },
      { key: 'leads', label: 'Leads', icon: 'briefcase-outline', color: '#4F46E5', onPress: () => go('/leads') },
      { key: 'jobs', label: 'Jobs', icon: 'construct-outline', color: '#6366F1', onPress: () => go('/jobs') },
    ];
  }, [isTech]);

  const extraItems = useMemo<NavItem[]>(() => {
    const list: NavItem[] = [
      {
        key: 'chats',
        label: 'Messages',
        icon: 'chatbubbles-outline',
        color: TEXT,
        badge: totalUnread > 0 ? totalUnread : undefined,
        onPress: () => go('/chats'),
      },
      {
        key: 'live-chat',
        label: 'Live Chat',
        icon: 'chatbubble-ellipses-outline',
        color: BLUE,
        onPress: () => go('/live-chat'),
      },
    ];
    if (showBookRide) {
      list.push({
        key: 'ride',
        label: 'Book Ride',
        icon: 'bicycle-outline',
        color: '#CA8A04',
        onPress: () => go('/bike-taxi'),
      });
    }
    list.push({
      key: 'create',
      label: 'Create Post',
      icon: 'add-circle-outline',
      color: PRIMARY,
      onPress: () => go('/create'),
    });
    if (schematics) {
      list.push({
        key: 'schematics',
        label: 'Schematics',
        icon: 'document-text-outline',
        color: '#CA8A04',
        onPress: () => {
          close();
          if (onSchematicsPress) {
            onSchematicsPress();
            return;
          }
          router.navigate({ pathname: '/webview', params: { url: schematics, title: 'Schematics' } } as any);
        },
      });
    }
    if (toolsUrl) {
      list.push({
        key: 'web-tools',
        label: 'Web Tools',
        icon: 'globe-outline',
        color: BLUE,
        onPress: () => {
          close();
          router.navigate({ pathname: '/webview', params: { url: toolsUrl, title: 'Web Tools' } } as any);
        },
      });
    }
    list.push({
      key: 'settings',
      label: 'Settings',
      icon: 'settings-outline',
      color: MUTED,
      onPress: () => go('/notification-preferences'),
    });
    return list;
  }, [showBookRide, schematics, toolsUrl, totalUnread, onSchematicsPress]);

  const topPad = (Platform.OS === 'web' ? 24 : Math.max(insets.top, 12)) + 8;
  const botPad = (Platform.OS === 'web' ? 24 : insets.bottom) + 16;

  return (
    <>
      {hideTrigger ? null : (
        <Pressable
          onPress={() => setOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Open navigation menu"
          style={variant === 'tab' ? styles.tabDotsBtn : styles.dotsBtn}
        >
          <Ionicons name="ellipsis-vertical" size={variant === 'tab' ? 20 : 18} color={TEXT} />
          {variant === 'tab' ? <Text style={styles.tabDotsLabel}>More</Text> : null}
        </Pressable>
      )}

      <Modal
        visible={shown}
        transparent
        animationType="none"
        onRequestClose={close}
      >
        <View style={styles.overlay}>
          <Animated.View style={[styles.dim, dimStyle]} />
          <Pressable style={styles.overlayDismiss} onPress={close} />
          <Animated.View
            style={[
              styles.panel,
              panelStyle,
              { paddingTop: topPad, paddingBottom: botPad },
            ]}
          >
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Menu</Text>
              <Pressable onPress={close} hitSlop={10} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={TEXT} />
              </Pressable>
            </View>

            <View style={styles.profileRow}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.profileAvatar} contentFit="cover" />
              ) : (
                <View style={styles.profileAvatarFallback}>
                  <Ionicons name="person" size={18} color={PRIMARY} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName} numberOfLines={1}>
                  {profile?.name || 'Your profile'}
                </Text>
                <Text style={styles.profileHint}>Technician</Text>
              </View>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.menuScroll}
            >
              {primaryItems.map((item, index) => (
                <AnimatedNavRow key={item.key} item={item} index={index} playKey={animKey} />
              ))}
              {primaryItems.length > 0 && extraItems.length > 0 ? (
                <View style={styles.sectionDown}>
                  <View style={styles.sectionDivider} />
                  <Text style={styles.sectionLabel}>More</Text>
                </View>
              ) : null}
              {extraItems.map((item, index) => (
                <AnimatedNavRow
                  key={item.key}
                  item={item}
                  index={primaryItems.length + index}
                  playKey={animKey}
                />
              ))}
            </ScrollView>

            <Animated.View
              key={`profile-${animKey}`}
              entering={FadeInDown.delay(50 + (primaryItems.length + extraItems.length) * 48).duration(340).springify()}
            >
              <Pressable
                onPress={() => go('/profile')}
                style={({ pressed }) => [styles.profileFooter, pressed && styles.itemPressed]}
                accessibilityRole="button"
                accessibilityLabel="Open profile"
              >
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.profileFooterAvatar} contentFit="cover" />
                ) : (
                  <View style={[styles.itemIcon, { backgroundColor: PRIMARY + '18' }]}>
                    <Ionicons name="person-circle-outline" size={20} color={PRIMARY} />
                  </View>
                )}
                <Text style={styles.itemLabel}>Profile</Text>
                <Ionicons name="chevron-forward" size={16} color="#BDBDBD" />
              </Pressable>
            </Animated.View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  topProfileBtn: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 80,
    width: PROFILE_BTN_SIZE,
    height: PROFILE_BTN_SIZE,
    borderRadius: PROFILE_BTN_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: SURFACE,
    borderWidth: 2,
    borderColor: PRIMARY + '55',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.12)', touchAction: 'none', cursor: 'grab' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 8,
      },
    }),
  },
  topProfileImg: { width: 36, height: 36, borderRadius: 18 },
  topProfileFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY + '20',
  },
  shopFloatWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 80,
    alignItems: 'center',
  },
  shopFloatBtn: {
    minWidth: 210,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 20,
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#EF4444',
    paddingHorizontal: 14,
    ...Platform.select({
      web: { boxShadow: '0 2px 10px rgba(239,68,68,0.22)' } as any,
      default: {
        shadowColor: '#EF4444',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.22,
        shadowRadius: 5,
        elevation: 8,
      },
    }),
  },
  shopFloatTxt: {
    color: '#EF4444',
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  postFloatBtn: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: SURFACE,
    borderWidth: 2,
    borderColor: PRIMARY + '55',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.12)', touchAction: 'none', cursor: 'grab' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 8,
      },
    }),
  },
  dotsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER + '80',
  },
  tabDotsBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    minWidth: 56,
  },
  tabDotsLabel: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: TEXT,
    marginTop: 1,
  },
  menuScroll: {
    paddingBottom: 12,
    flexGrow: 1,
  },
  sectionDown: {
    marginTop: 28,
    marginBottom: 4,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 8,
    marginHorizontal: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: MUTED,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  profileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  profileFooterAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: PRIMARY + '40',
  },
  overlay: {
    flex: 1,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,24,39,0.45)',
  },
  overlayDismiss: {
    ...StyleSheet.absoluteFillObject,
  },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: PANEL_W,
    maxWidth: '86%',
    backgroundColor: SURFACE,
    borderRightWidth: 1,
    borderRightColor: BORDER,
    paddingHorizontal: 12,
    zIndex: 2,
    ...Platform.select({
      web: { boxShadow: '8px 0 24px rgba(0,0,0,0.14)' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 4, height: 0 },
        shadowOpacity: 0.14,
        shadowRadius: 12,
        elevation: 12,
      },
    }),
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  panelTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: TEXT,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
  },
  profileAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: PRIMARY + '40',
  },
  profileAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PRIMARY + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: TEXT,
  },
  profileHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: MUTED,
    marginTop: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 10,
  },
  itemPressed: {
    backgroundColor: '#F3F4F6',
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: TEXT,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginRight: 4,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  tabWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function HomeNavMenuTabButton() {
  return (
    <View style={styles.tabWrap}>
      <HomeNavMenu variant="tab" />
    </View>
  );
}
