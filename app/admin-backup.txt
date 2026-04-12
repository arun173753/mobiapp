import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Platform, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/lib/context';
import { PRIMARY, C } from '@/lib/theme';

export default function AdminScreen() {
  const { profile } = useApp();
  const router = useRouter();
  
  // Simple admin check - no complex logic
  const cleanPhone = (profile?.phone || '').replace(/\D/g, '');
  const isAdmin = profile?.role === 'admin' || cleanPhone === '8179142535' || cleanPhone === '9876543210' || profile?.email === 'atozmobilerepaircourse@gmail.com';

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg }}>
        <Ionicons name="lock-closed" size={48} color={C.textSecondary} />
        <Text style={{ fontSize: 18, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16 }}>
          Admin Access Required
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: PRIMARY, borderRadius: 8 }}>
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold' }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return <AdminDashboard />;
}

function AdminDashboard() {
  const { posts, allProfiles, refreshData } = useApp();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTimeout(() => setLoading(false), 500);
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg }}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  const totalUsers = allProfiles?.length || 0;
  const totalPosts = posts?.length || 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 20 }}>
        <Text style={{ fontSize: 28, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 20 }}>
          Admin Dashboard
        </Text>

        {/* Stats */}
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
          <View style={{ flex: 1, backgroundColor: C.surface, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
            <Text style={{ fontSize: 12, color: C.textSecondary, fontFamily: 'Inter_400Regular' }}>Total Users</Text>
            <Text style={{ fontSize: 28, fontFamily: 'Inter_700Bold', color: PRIMARY, marginTop: 8 }}>{totalUsers}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: C.surface, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
            <Text style={{ fontSize: 12, color: C.textSecondary, fontFamily: 'Inter_400Regular' }}>Total Posts</Text>
            <Text style={{ fontSize: 28, fontFamily: 'Inter_700Bold', color: '#34C759', marginTop: 8 }}>{totalPosts}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={{ gap: 10 }}>
          <Pressable
            onPress={async () => {
              try {
                await refreshData();
                alert('Data refreshed');
              } catch (e) {
                alert('Refresh failed');
              }
            }}
            style={{ backgroundColor: PRIMARY, paddingVertical: 12, borderRadius: 8, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold' }}>Refresh Data</Text>
          </Pressable>

          <Pressable
            onPress={() => router.back()}
            style={{ backgroundColor: C.surface, paddingVertical: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: C.border }}
          >
            <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold' }}>Go Back</Text>
          </Pressable>
        </View>

        <Text style={{ fontSize: 12, color: C.textTertiary, fontFamily: 'Inter_400Regular', marginTop: 20, textAlign: 'center' }}>
          Admin Panel v1.0 - Core Features Only
        </Text>
      </View>
    </ScrollView>
  );
}
