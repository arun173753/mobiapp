import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, TextInput, Modal, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { T } from '@/constants/techTheme';
import { useApp } from '@/lib/context';
import { SKILLS_LIST } from '@/lib/types';
import { apiRequest } from '@/lib/query-client';

// Extended skills for mobile repair professionals
const SKILL_CATEGORIES: { name: string; icon: keyof typeof Ionicons.glyphMap; color: string; skills: string[] }[] = [
  {
    name: 'Mobile Repair',
    icon: 'phone-portrait-outline',
    color: '#3B82F6',
    skills: ['Mobile Repair', 'PCB Repair', 'Chip Level Repair', 'Screen Replacement', 'Battery Replacement', 'Water Damage Repair', 'Camera Repair', 'Charging Port Repair'],
  },
  {
    name: 'Computer & Laptop',
    icon: 'laptop-outline',
    color: '#8B5CF6',
    skills: ['Laptop Repair', 'Computer Hardware', 'Networking', 'Software Installation', 'Data Recovery', 'Virus Removal'],
  },
  {
    name: 'Electronics',
    icon: 'tv-outline',
    color: '#10B981',
    skills: ['TV Repair', 'AC Repair', 'Refrigerator Repair', 'Washing Machine Repair', 'Microwave Repair', 'Printer Repair', 'CCTV Installation'],
  },
  {
    name: 'Home & Trade',
    icon: 'home-outline',
    color: '#F59E0B',
    skills: ['Electrical Wiring', 'Plumbing', 'Carpentry', 'Painting', 'Welding', 'Solar Panel Installation', 'Auto Mechanic'],
  },
];

function getSkillIcon(skill: string): keyof typeof Ionicons.glyphMap {
  const s = skill.toLowerCase();
  if (s.includes('mobile') || s.includes('phone') || s.includes('screen') || s.includes('pcb') || s.includes('chip') || s.includes('battery') || s.includes('water') || s.includes('camera') || s.includes('charging')) return 'phone-portrait-outline';
  if (s.includes('laptop') || s.includes('computer') || s.includes('hardware') || s.includes('software') || s.includes('data') || s.includes('virus')) return 'laptop-outline';
  if (s.includes('network')) return 'wifi-outline';
  if (s.includes('tv') || s.includes('television')) return 'tv-outline';
  if (s.includes('ac') || s.includes('air')) return 'snow-outline';
  if (s.includes('refrigerator') || s.includes('fridge')) return 'cube-outline';
  if (s.includes('wash')) return 'water-outline';
  if (s.includes('micro')) return 'fast-food-outline';
  if (s.includes('print')) return 'print-outline';
  if (s.includes('cctv') || s.includes('camera')) return 'videocam-outline';
  if (s.includes('electric')) return 'flash-outline';
  if (s.includes('plumb')) return 'water-outline';
  if (s.includes('solar')) return 'sunny-outline';
  if (s.includes('auto') || s.includes('mechanic')) return 'car-outline';
  return 'construct-outline';
}

function getSkillColor(skill: string): string {
  const s = skill.toLowerCase();
  if (s.includes('mobile') || s.includes('phone') || s.includes('pcb') || s.includes('chip')) return '#3B82F6';
  if (s.includes('laptop') || s.includes('computer') || s.includes('network')) return '#8B5CF6';
  if (s.includes('tv') || s.includes('ac') || s.includes('refrigerator') || s.includes('cctv')) return '#10B981';
  return '#F59E0B';
}

function getInitials(name: string): string {
  if (!name) return '??';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function SkillsServicesScreen() {
  const insets = useSafeAreaInsets();
  const { profile, setProfile } = useApp();
  const webTop = Platform.OS === 'web' ? 67 : 0;
  const topPad = (Platform.OS === 'web' ? webTop : insets.top) + 0;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const [showAddModal, setShowAddModal] = useState(false);
  const [searchSkill, setSearchSkill] = useState('');
  const [saving, setSaving] = useState(false);

  const skills: string[] = profile?.skills || [];

  const filteredCategories = useMemo(() => {
    const q = searchSkill.toLowerCase().trim();
    if (!q) return SKILL_CATEGORIES;
    return SKILL_CATEGORIES.map(cat => ({
      ...cat,
      skills: cat.skills.filter(s => s.toLowerCase().includes(q)),
    })).filter(cat => cat.skills.length > 0);
  }, [searchSkill]);

  const allFilteredSkills = useMemo(() => {
    const q = searchSkill.toLowerCase().trim();
    if (!q) return [];
    return SKILLS_LIST.filter(s => s.toLowerCase().includes(q) && !SKILL_CATEGORIES.flatMap(c => c.skills).includes(s));
  }, [searchSkill]);

  const saveSkills = async (newSkills: string[]) => {
    if (!profile) return;
    setSaving(true);
    try {
      await apiRequest('POST', '/api/profiles', { ...profile, skills: newSkills });
      await setProfile({ ...profile, skills: newSkills });
    } catch (e) {
      Alert.alert('Error', 'Could not save skills. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const addSkill = async (skill: string) => {
    if (skills.includes(skill)) {
      Alert.alert('Already added', `"${skill}" is already in your skills.`);
      return;
    }
    await saveSkills([...skills, skill]);
  };

  const removeSkill = (skill: string) => {
    Alert.alert('Remove Skill', `Remove "${skill}" from your skills?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => saveSkills(skills.filter(s => s !== skill)),
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={T.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Skills & Services</Text>
        <Pressable
          style={styles.addBtn}
          onPress={() => setShowAddModal(true)}
        >
          <Ionicons name="add" size={20} color="#FFF" />
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: bottomPad + 24, paddingHorizontal: 16, paddingTop: 16, gap: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Card */}
        <Animated.View entering={FadeInDown.delay(0).duration(500).springify()}>
          <View style={styles.profileCard}>
            <View style={styles.profileCardBg} />
            <View style={styles.profileCardContent}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{getInitials(profile?.name || '')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{profile?.name || 'Technician'}</Text>
                <Text style={styles.profileSub}>
                  {skills.length} Active {skills.length === 1 ? 'Skill' : 'Skills'}
                </Text>
                <View style={styles.badgeRow}>
                  <View style={styles.badge}>
                    <Ionicons name="checkmark-circle" size={10} color="#FFF" />
                    <Text style={styles.badgeText}>Verified</Text>
                  </View>
                  {skills.length >= 3 && (
                    <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                      <Ionicons name="star" size={10} color="#FFD60A" />
                      <Text style={styles.badgeText}>Multi-Skill</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Active Skills */}
        <Animated.View entering={FadeInDown.delay(80).duration(500).springify()}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Active Skills</Text>
            <Text style={styles.sectionCount}>{skills.length}</Text>
          </View>

          {skills.length === 0 ? (
            <View style={styles.emptySkills}>
              <View style={styles.emptyIconBg}>
                <Ionicons name="construct-outline" size={32} color={T.accent} />
              </View>
              <Text style={styles.emptyTitle}>No skills added yet</Text>
              <Text style={styles.emptyText}>Add your repair skills to get more job opportunities</Text>
              <Pressable style={styles.emptyAddBtn} onPress={() => setShowAddModal(true)}>
                <Ionicons name="add-circle-outline" size={18} color={T.accent} />
                <Text style={styles.emptyAddBtnText}>Add First Skill</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.skillsGrid}>
              {skills.map((skill, idx) => {
                const color = getSkillColor(skill);
                const icon = getSkillIcon(skill);
                return (
                  <Animated.View
                    key={skill}
                    entering={FadeInDown.delay(idx * 50).duration(400).springify()}
                    style={styles.skillCard}
                  >
                    <View style={[styles.skillIconBg, { backgroundColor: color + '20' }]}>
                      <Ionicons name={icon} size={20} color={color} />
                    </View>
                    <View style={styles.skillInfo}>
                      <Text style={styles.skillName} numberOfLines={1}>{skill}</Text>
                      <Text style={styles.skillMeta}>Active</Text>
                    </View>
                    <Pressable
                      style={styles.removeBtn}
                      onPress={() => removeSkill(skill)}
                      disabled={saving}
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={16} color={T.red} />
                    </Pressable>
                  </Animated.View>
                );
              })}
            </View>
          )}
        </Animated.View>

        {/* Skill Categories */}
        {saving && (
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            <ActivityIndicator color={T.accent} size="small" />
          </View>
        )}
      </ScrollView>

      {/* Add Skill Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
        presentationStyle="pageSheet"
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Skill</Text>
            <Pressable onPress={() => { setShowAddModal(false); setSearchSkill(''); }} hitSlop={12}>
              <Ionicons name="close" size={24} color={T.text} />
            </Pressable>
          </View>

          {/* Search */}
          <View style={styles.modalSearch}>
            <Ionicons name="search-outline" size={18} color={T.muted} />
            <TextInput
              style={styles.modalSearchInput}
              placeholder="Search skills..."
              placeholderTextColor={T.muted}
              value={searchSkill}
              onChangeText={setSearchSkill}
              autoFocus
            />
            {searchSkill.length > 0 && (
              <Pressable onPress={() => setSearchSkill('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={T.muted} />
              </Pressable>
            )}
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            {filteredCategories.map(cat => (
              <View key={cat.name}>
                <View style={styles.catHeader}>
                  <View style={[styles.catIconBg, { backgroundColor: cat.color + '20' }]}>
                    <Ionicons name={cat.icon} size={16} color={cat.color} />
                  </View>
                  <Text style={styles.catName}>{cat.name}</Text>
                  <Text style={styles.catCount}>{cat.skills.length}</Text>
                </View>
                <View style={styles.catSkillsGrid}>
                  {cat.skills.map(skill => {
                    const isAdded = skills.includes(skill);
                    return (
                      <Pressable
                        key={skill}
                        style={[
                          styles.catSkillChip,
                          isAdded && { backgroundColor: cat.color + '20', borderColor: cat.color + '50' },
                        ]}
                        onPress={() => {
                          if (!isAdded) {
                            addSkill(skill);
                            setShowAddModal(false);
                            setSearchSkill('');
                          }
                        }}
                      >
                        <Text style={[
                          styles.catSkillText,
                          isAdded && { color: cat.color },
                        ]}>
                          {skill}
                        </Text>
                        {isAdded ? (
                          <Ionicons name="checkmark-circle" size={14} color={cat.color} />
                        ) : (
                          <Ionicons name="add-circle-outline" size={14} color={T.muted} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            {allFilteredSkills.length > 0 && (
              <View>
                <Text style={[styles.catName, { marginBottom: 10 }]}>Other Skills</Text>
                <View style={styles.catSkillsGrid}>
                  {allFilteredSkills.map(skill => {
                    const isAdded = skills.includes(skill);
                    return (
                      <Pressable
                        key={skill}
                        style={[
                          styles.catSkillChip,
                          isAdded && { backgroundColor: T.accentMuted, borderColor: T.accent + '50' },
                        ]}
                        onPress={() => {
                          if (!isAdded) {
                            addSkill(skill);
                            setShowAddModal(false);
                            setSearchSkill('');
                          }
                        }}
                      >
                        <Text style={[styles.catSkillText, isAdded && { color: T.accent }]}>{skill}</Text>
                        {isAdded ? (
                          <Ionicons name="checkmark-circle" size={14} color={T.accent} />
                        ) : (
                          <Ionicons name="add-circle-outline" size={14} color={T.muted} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: T.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.border,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: T.text,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: T.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  addBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  profileCard: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: T.accent,
    padding: 20,
  },
  profileCardBg: {
    position: 'absolute',
    right: -30,
    bottom: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  profileCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
  },
  profileName: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
    marginBottom: 2,
  },
  profileSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    fontFamily: 'Inter_400Regular',
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 10,
    color: '#FFF',
    fontFamily: 'Inter_600SemiBold',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: T.text,
  },
  sectionCount: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: T.accent,
    backgroundColor: T.accentMuted,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 10,
  },
  emptySkills: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
    backgroundColor: T.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.border,
    borderStyle: 'dashed',
  },
  emptyIconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: T.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: T.text,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: T.muted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.accent,
  },
  emptyAddBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: T.accent,
  },
  skillsGrid: {
    gap: 8,
  },
  skillCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: T.border,
  },
  skillIconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillInfo: {
    flex: 1,
  },
  skillName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: T.text,
    marginBottom: 2,
  },
  skillMeta: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: T.green,
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: T.redMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: T.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: T.text,
  },
  modalSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginVertical: 14,
    backgroundColor: T.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    borderWidth: 1,
    borderColor: T.border,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 15,
    color: T.text,
    fontFamily: 'Inter_400Regular',
  },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingTop: 4,
  },
  catIconBg: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: T.text,
    flex: 1,
  },
  catCount: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: T.muted,
    backgroundColor: T.card,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.border,
  },
  catSkillsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catSkillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
  },
  catSkillText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: T.text,
  },
});
