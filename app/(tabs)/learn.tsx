import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiRequest } from '@/lib/query-client';
import Colors from '@/constants/colors';

const C = Colors.light;

export default function LearnScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [learnLink, setLearnLink] = useState<string | null>(null);

  useEffect(() => {
    fetchLearnLink();
  }, []);

  const fetchLearnLink = async () => {
    try {
      const res = await apiRequest('GET', '/api/admin/links');
      const data = await res.json();
      setLearnLink(data?.learn_link || null);
    } catch (e) {
      console.error('[Learn] Error fetching link:', e);
    } finally {
      setLoading(false);
    }
  };

  const openLearnLink = () => {
    if (learnLink) {
      router.push({
        pathname: '/live-link',
        params: { link: learnLink, title: 'Learning Platform' },
      } as any);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 60 }} />
      </View>
    );
  }

  if (!learnLink) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, paddingHorizontal: 20 }]}>
        <View style={styles.emptyState}>
          <Ionicons name="book-outline" size={52} color={C.textTertiary} />
          <Text style={styles.emptyTitle}>Learn Link Not Available</Text>
          <Text style={styles.emptyText}>The learn link has not been configured yet.</Text>
          <Pressable onPress={fetchLearnLink} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingHorizontal: 20 }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Ionicons name="book" size={48} color="#8B5CF6" />
            <Text style={styles.orgCode}>Org Code: Wcpdlu</Text>
          </View>
          <Text style={styles.title}>Learn & Grow</Text>
          <Text style={styles.subtitle}>Access exclusive repair tutorials and courses</Text>
        </View>

        <Pressable onPress={openLearnLink} style={styles.button}>
          <Ionicons name="open-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
          <Text style={styles.buttonText}>Open Learning Platform</Text>
        </Pressable>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#3B82F6" />
          <Text style={styles.infoText}>Access step-by-step guides, video tutorials, and expert tips to improve your repair skills.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  content: { flex: 1, justifyContent: 'center', gap: 24 },
  
  emptyState: { alignItems: 'center', gap: 12, marginVertical: 60 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  emptyText: { fontSize: 14, color: C.textTertiary, textAlign: 'center' },
  retryBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 },
  retryBtnText: { color: '#FFF', fontFamily: 'Inter_600SemiBold' },

  header: { alignItems: 'center', gap: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%' },
  orgCode: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#EF4444', marginLeft: 'auto' },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 16, color: C.textSecondary, textAlign: 'center' },

  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#8B5CF6', borderRadius: 14, paddingVertical: 14,
  },
  buttonText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#FFF' },

  infoBox: {
    flexDirection: 'row', gap: 12, backgroundColor: '#F0F9FF', borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: '#BFDBFE',
  },
  infoText: { flex: 1, fontSize: 14, color: C.text, fontFamily: 'Inter_500Medium', lineHeight: 20 },
});
