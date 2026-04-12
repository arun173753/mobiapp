import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { ROLE_LABELS, UserRole } from '@/lib/types';

const BG     = '#1E1E1E';
const BORDER = '#374151';
const DARK   = '#F3F4F6';
const MUTED  = '#9CA3AF';
const AMBER  = '#FF6B2C';

const DARK_BG     = '#1E1E1E';
const DARK_BORDER = '#374151';
const DARK_TEXT   = '#F3F4F6';
const DARK_MUTED  = '#9CA3AF';
const DARK_SKILL  = '#2A2A2A';

const ROLE_ICONS: Record<UserRole, { name: keyof typeof Ionicons.glyphMap; color: string; bg: string }> = {
  technician:   { name: 'construct',  color: '#34C759', bg: '#E8F5ED' },
  teacher:      { name: 'school',     color: '#F59E0B', bg: '#FFFBEB' },
  supplier:     { name: 'cube',       color: '#E8704A', bg: '#FFF1EC' },
  job_provider: { name: 'briefcase',  color: '#5E8BFF', bg: '#EEF3FF' },
  customer:     { name: 'person',     color: '#FF2D55', bg: '#FFEBEF' },
};

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

interface DirectoryCardProps {
  name: string;
  role: UserRole;
  city: string;
  skills: string[];
  experience?: string;
  avatar?: string;
  isOnline?: boolean;
  onPress?: () => void;
  onMessage?: () => void;
  darkMode?: boolean;
}

export default function DirectoryCard({ name, role, city, skills, experience, avatar, isOnline, onPress, onMessage, darkMode }: DirectoryCardProps) {
  const icon = ROLE_ICONS[role] ?? ROLE_ICONS.customer;
  const cardScale = useSharedValue(1);
  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  const cardBg     = darkMode ? DARK_BG : BG;
  const cardBorder = darkMode ? DARK_BORDER : BORDER;
  const textColor  = darkMode ? DARK_TEXT : DARK;
  const mutedColor = darkMode ? DARK_MUTED : MUTED;
  const skillBg    = darkMode ? DARK_SKILL : '#F5F5F5';
  const dotBorder  = darkMode ? DARK_BG : BG;
  const iconBg     = darkMode ? icon.color + '22' : icon.bg;

  return (
    <Animated.View style={cardAnimStyle}>
      <Pressable
        style={({ pressed }) => [styles.card, { backgroundColor: cardBg, borderColor: cardBorder }, pressed && { opacity: 0.92 }]}
        onPress={onPress}
        onPressIn={() => { cardScale.value = withSpring(0.97, { damping: 15 }); }}
        onPressOut={() => { cardScale.value = withSpring(1, { damping: 15 }); }}
      >
        {/* Avatar */}
        <View style={styles.avatarWrap}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={[styles.avatarImg, { borderColor: cardBorder }]} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, { backgroundColor: iconBg }]}>
              <Text style={[styles.avatarText, { color: icon.color }]}>{getInitials(name)}</Text>
            </View>
          )}
          {isOnline !== undefined && (
            <View style={[styles.onlineDot, { backgroundColor: isOnline ? '#34C759' : (darkMode ? '#4B5563' : '#CCC'), borderColor: dotBorder }]} />
          )}
        </View>

        {/* Info */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: textColor }]} numberOfLines={1}>{name}</Text>
            {role === 'technician' && (
              <View style={[styles.verifiedBadge, darkMode && { backgroundColor: '#1A3326' }]}>
                <Text style={[styles.verifiedText, darkMode && { color: '#34C759' }]}>Verified</Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            <View style={[styles.roleChip, { backgroundColor: iconBg }]}>
              <Ionicons name={icon.name} size={11} color={icon.color} />
              <Text style={[styles.roleText, { color: icon.color }]}>{ROLE_LABELS[role]}</Text>
            </View>
            {city.length > 0 && (
              <View style={styles.cityRow}>
                <Ionicons name="location-outline" size={11} color={mutedColor} />
                <Text style={[styles.cityText, { color: mutedColor }]} numberOfLines={1}>{city}</Text>
              </View>
            )}
          </View>
          {skills.length > 0 && (
            <View style={styles.skillsRow}>
              {skills.slice(0, 2).map((s, i) => (
                <View key={i} style={[styles.skillTag, { backgroundColor: skillBg }]}>
                  <Text style={[styles.skillText, { color: mutedColor }]} numberOfLines={1}>{s}</Text>
                </View>
              ))}
              {skills.length > 2 && (
                <Text style={[styles.moreSkills, { color: mutedColor }]}>+{skills.length - 2}</Text>
              )}
            </View>
          )}
        </View>

        {/* Action */}
        {onMessage ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onMessage();
            }}
            hitSlop={8}
            style={[styles.msgBtn, { backgroundColor: iconBg }]}
          >
            <Ionicons name="chatbubble-outline" size={16} color={icon.color} />
          </Pressable>
        ) : (
          <Ionicons name="chevron-forward" size={16} color={mutedColor} />
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: BG,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  avatarWrap: { position: 'relative', marginRight: 12 },
  avatarImg: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, borderColor: BORDER },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  onlineDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, borderColor: BG,
  },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  name: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: DARK, flexShrink: 1 },
  verifiedBadge: { backgroundColor: '#E8F5ED', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  verifiedText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#2E7D52' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  roleChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  roleText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  cityText: { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular', maxWidth: 100 },
  skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  skillTag: { backgroundColor: '#F5F5F5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  skillText: { color: MUTED, fontSize: 11, fontFamily: 'Inter_400Regular' },
  moreSkills: { color: MUTED, fontSize: 11, fontFamily: 'Inter_400Regular', alignSelf: 'center' },
  msgBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});
