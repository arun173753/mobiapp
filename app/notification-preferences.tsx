import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Switch, ScrollView, Platform, Pressable, ActivityIndicator, FlatList, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { useApp } from '@/lib/context';

const C = Colors.light;
const PRIMARY = '#FF6B2C';

export default function NotificationPreferencesScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useApp();
  const [prefs, setPrefs] = useState({
    orders: true,
    messages: true,
    marketing: true,
    system: true,
  });
  const [saving, setSaving] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);

  useEffect(() => {
    if (user?.notificationPrefs) {
      try {
        setPrefs(JSON.parse(user.notificationPrefs));
      } catch (e) {
        console.error('Failed to parse prefs', e);
      }
    }
  }, [user]);

  useEffect(() => {
    if (user?.id) {
      fetchNotifications();
    }
  }, [user]);

  const fetchNotifications = async () => {
    if (!user?.id) return;
    setLoadingNotifs(true);
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}/api/notifications/history?userId=${user.id}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setNotifications(data);
      }
    } catch (e) {
      console.error('[Notifications] Fetch error:', e);
    } finally {
      setLoadingNotifs(false);
    }
  };

  const toggleSwitch = async (key: keyof typeof prefs) => {
    const newPrefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(newPrefs);
    
    try {
      setSaving(true);
      await apiRequest('PATCH', '/api/profile', {
        notificationPrefs: JSON.stringify(newPrefs)
      });
    } catch (error) {
      console.error('Failed to update prefs', error);
      setPrefs(prefs);
    } finally {
      setSaving(false);
    }
  };

  const renderItem = (key: keyof typeof prefs, title: string, description: string, icon: keyof typeof Ionicons.glyphMap) => (
    <View style={styles.item}>
      <View style={styles.itemIcon}>
        <Ionicons name={icon} size={22} color={PRIMARY} />
      </View>
      <View style={styles.itemContent}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemDescription}>{description}</Text>
      </View>
      <Switch
        value={prefs[key]}
        onValueChange={() => toggleSwitch(key)}
        trackColor={{ false: '#3A3A3C', true: PRIMARY }}
        thumbColor={Platform.OS === 'ios' ? '#FFFFFF' : prefs[key] ? '#FFFFFF' : '#AEAEB2'}
      />
    </View>
  );

  const formatTime = (ms: number) => {
    const now = Date.now();
    const diff = now - ms;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(ms).toLocaleDateString();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView style={styles.content}>
        {/* Preferences Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>Transactional</Text>
            {renderItem('orders', 'Order Updates', 'Receive alerts about your purchases and sales', 'cart-outline')}
            {renderItem('messages', 'Messages', 'Get notified when you receive a new message', 'chatbubble-outline')}
          </View>

          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>Updates</Text>
            {renderItem('marketing', 'Promotions', 'Special offers, discounts and news', 'megaphone-outline')}
            {renderItem('system', 'System Alerts', 'Security alerts and app updates', 'shield-checkmark-outline')}
          </View>
        </View>

        {/* Notification History Section */}
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={styles.sectionTitle}>Recent Notifications</Text>
            {loadingNotifs && <ActivityIndicator size="small" color={PRIMARY} />}
          </View>
          
          {notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="notifications-off-outline" size={40} color={C.textTertiary} />
              <Text style={{ color: C.textTertiary, fontSize: 14, marginTop: 8 }}>No notifications yet</Text>
            </View>
          ) : (
            <FlatList
              scrollEnabled={false}
              data={notifications}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <View style={[styles.notificationCard, item.read ? { opacity: 0.6 } : {}]}>
                  {item.image && (
                    <Image 
                      source={{ uri: item.image }} 
                      style={styles.notificationImage} 
                    />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.notificationTitle}>{item.title || item.type}</Text>
                    {item.body && (
                      <Text style={styles.notificationBody} numberOfLines={2}>{item.body}</Text>
                    )}
                    <Text style={styles.notificationTime}>{formatTime(item.createdAt)}</Text>
                  </View>
                  {!item.read && (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PRIMARY, marginLeft: 8 }} />
                  )}
                </View>
              )}
            />
          )}
        </View>
        
        {saving && (
          <Text style={styles.savingText}>Saving changes...</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 56,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 32,
  },
  subsection: {
    marginBottom: 20,
  },
  subsectionTitle: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.textTertiary,
    textTransform: 'uppercase',
    marginBottom: 12,
    letterSpacing: 0.8,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: PRIMARY,
    textTransform: 'uppercase',
    marginBottom: 16,
    marginLeft: 4,
    letterSpacing: 1.2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: PRIMARY + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  itemContent: {
    flex: 1,
    marginRight: 12,
  },
  itemTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    marginBottom: 2,
  },
  itemDescription: {
    fontSize: 12,
    color: C.textSecondary,
  },
  savingText: {
    textAlign: 'center',
    color: PRIMARY,
    fontSize: 12,
    marginTop: -16,
    marginBottom: 32,
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
    backgroundColor: C.surface,
    borderRadius: 16,
  },
  notificationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  notificationImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: C.border,
  },
  notificationTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    marginBottom: 2,
  },
  notificationBody: {
    fontSize: 12,
    color: C.textSecondary,
    marginBottom: 4,
  },
  notificationTime: {
    fontSize: 11,
    color: C.textTertiary,
  },
});
