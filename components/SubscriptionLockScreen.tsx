import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ActivityIndicator, Linking,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';

const C = Colors.dark;
const { width: SCREEN_W } = Dimensions.get('window');

interface SubStatus {
  required: boolean;
  active: boolean;
  amount?: string;
  period?: string;
  role?: string;
  subscriptionEnd?: number;
}

export default function SubscriptionLockScreen({ children }: { children: React.ReactNode }) {
  const { profile } = useApp();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<SubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const res = await apiRequest('GET', `/api/subscription/status/${profile.id}`);
      const data = await res.json();
      if (data.success) {
        setStatus(data);
      }
    } catch (e) {
      console.warn('[Sub] Check failed:', e);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const handlePay = async () => {
    if (!profile?.id) return;
    setPaying(true);
    try {
      const res = await apiRequest('POST', '/api/subscription/create-order', {
        userId: profile.id,
        userName: profile.name,
        userPhone: profile.phone,
      });
      const data = await res.json();
      if (data.success) {
        const baseUrl = getApiUrl();
        const checkoutUrl = `${baseUrl}/api/subscription/checkout?orderId=${data.orderId}&amount=${data.amount}&keyId=${data.keyId}&role=${data.role}&displayAmount=${data.displayAmount}&userName=${encodeURIComponent(profile.name)}&userPhone=${encodeURIComponent(profile.phone)}&userEmail=${encodeURIComponent(profile.email || '')}&userId=${profile.id}`;
        
        if (Platform.OS === 'web') {
          window.open(checkoutUrl, '_blank');
        } else {
          await Linking.openURL(checkoutUrl);
        }
        setTimeout(checkStatus, 5000);
        setTimeout(checkStatus, 15000);
        setTimeout(checkStatus, 30000);
      }
    } catch (e) {
      console.warn('[Sub] Payment failed:', e);
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (!status || !status.required || status.active) {
    return <>{children}</>;
  }

  const roleLabel = status.role === 'technician' ? 'Technician' : status.role === 'supplier' ? 'Supplier' : status.role === 'teacher' ? 'Teacher' : status.role || '';
  const amount = String(parseInt(status.amount || '0', 10) || 0);
  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={styles.overlay}>
      <View style={[styles.darkOverlay, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 40 }]}>
        <View style={styles.lockIconContainer}>
          <View style={styles.lockCircle}>
            <Ionicons name="lock-closed" size={48} color="#FF6B35" />
          </View>
        </View>

        <Text style={styles.lockTitle}>Subscription Required</Text>
        <Text style={styles.lockSubtitle}>
          {roleLabel} plan required to access all features
        </Text>

        <View style={styles.planCard}>
          <View style={styles.planHeader}>
            <Ionicons name="diamond" size={24} color="#FFD60A" />
            <Text style={styles.planName}>{roleLabel} Plan</Text>
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.rupeeSign}>{'\u20B9'}</Text>
            <Text style={styles.priceAmount}>{amount}</Text>
            <Text style={styles.pricePeriod}>/month</Text>
          </View>

          <View style={styles.featuresList}>
            <FeatureItem text="Access to full directory & map" />
            <FeatureItem text="Send & receive messages" />
            <FeatureItem text="Post in social feed" />
            <FeatureItem text="Browse & apply for jobs" />
            {status.role === 'supplier' && <FeatureItem text="List products in shop" />}
            {status.role === 'technician' && <FeatureItem text="Get job notifications" />}
            {status.role === 'teacher' && <FeatureItem text="Publish courses & earn revenue" />}
          </View>
        </View>

        <Pressable
          style={[styles.payButton, paying && styles.payButtonDisabled]}
          onPress={handlePay}
          disabled={paying}
        >
          {paying ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Ionicons name="card" size={20} color="#FFF" />
              <Text style={styles.payButtonText}>Subscribe Now - {'\u20B9'}{amount}/mo</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.securedBy}>
          {'\uD83D\uDD12'} Secured by Razorpay
        </Text>

        <Pressable onPress={checkStatus} style={styles.refreshLink}>
          <Ionicons name="refresh" size={16} color={C.textSecondary} />
          <Text style={styles.refreshText}>Already paid? Tap to refresh</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FeatureItem({ text }: { text: string }) {
  return (
    <View style={styles.featureItem}>
      <Ionicons name="checkmark-circle" size={18} color="#34C759" />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  darkOverlay: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  lockIconContainer: {
    marginBottom: 20,
  },
  lockCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,107,53,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(255,107,53,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  lockSubtitle: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
    maxWidth: 300,
  },
  planCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 24,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  planName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFD60A',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 20,
    gap: 2,
  },
  rupeeSign: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FF6B35',
    marginBottom: 4,
  },
  priceAmount: {
    fontSize: 44,
    fontWeight: '800',
    color: '#FF6B35',
    lineHeight: 48,
  },
  pricePeriod: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 6,
    marginLeft: 4,
  },
  featuresList: {
    gap: 10,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    fontSize: 14,
    color: '#D1D1D6',
  },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FF6B35',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: '100%',
    maxWidth: 360,
    marginBottom: 12,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFF',
  },
  securedBy: {
    fontSize: 12,
    color: '#666',
    marginBottom: 16,
  },
  refreshLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  refreshText: {
    fontSize: 13,
    color: C.textSecondary,
  },
});