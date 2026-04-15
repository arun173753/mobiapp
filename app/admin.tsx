import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Platform, Alert, ScrollView, TextInput, Switch, ActivityIndicator, RefreshControl, TouchableOpacity, Modal, KeyboardAvoidingView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { ROLE_LABELS, UserRole, ADMIN_PHONE, SubscriptionSetting, isAdminUser } from '@/lib/types';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { invalidateInsuranceCache } from '@/lib/use-insurance-settings';
import { getSessionToken } from '@/lib/storage';
import { openLink } from '@/lib/open-link';
import { getBestUserLocation } from '@/lib/location-user';

const LEGACY_ADMIN_PHONE_DIGITS = new Set(['8179142535', '9876543210', '9398391742']);

/** Same session in query as header — some web stacks drop custom headers on GET. Server accepts both. */
function withLeadAuthQuery(
  route: string,
  token: string | null,
  profile: { phone?: string; email?: string; role?: string } | null | undefined,
): string {
  const parts: string[] = [];
  if (token) parts.push(`sessionToken=${encodeURIComponent(token)}`);
  if (isAdminUser(profile)) {
    const digits = (profile?.phone || '').replace(/\D/g, '');
    const last10 = digits.slice(-10);
    if (LEGACY_ADMIN_PHONE_DIGITS.has(last10)) {
      parts.push(`phone=${encodeURIComponent(last10)}`);
    }
  }
  if (parts.length === 0) return route;
  const sep = route.includes('?') ? '&' : '?';
  return `${route}${sep}${parts.join('&')}`;
}

// Admin API helper: sends session token in both header (via apiRequest) and
// body so it reaches the server even if a proxy/polyfill strips custom headers.
// Also sends phone as a secondary auth factor (same pattern used by notify-all, send-sms etc.)
async function adminRequest(method: string, route: string, body?: Record<string, unknown>) {
  const token = await getSessionToken();
  return apiRequest(method, route, { ...body, sessionToken: token ?? undefined, phone: ADMIN_PHONE });
}

async function adminDeleteRequest(route: string) {
  const token = await getSessionToken();
  return apiRequest('DELETE', route, { sessionToken: token ?? undefined, phone: ADMIN_PHONE });
}

const C = Colors.light;

type AdminTab = 'dashboard' | 'users' | 'posts' | 'jobs' | 'bookings' | 'subscriptions' | 'revenue' | 'links' | 'notifications' | 'payouts' | 'email' | 'insurance' | 'ads' | 'listings' | 'reels' | 'protection-plans' | 'protection-claims' | 'pro-plan' | 'leads';

const ROLE_COLORS: Record<UserRole | 'admin', string> = {
  technician: '#34C759',
  teacher: '#FFD60A',
  supplier: '#FF6B2C',
  shopkeeper: '#A855F7',
  job_provider: '#5E8BFF',
  customer: '#FF2D55',
  admin: '#8E8E93',
};

/** Matches server `getDefaultPushNotificationImageUrl` fallback for preview + rich push. */
const DEFAULT_PUSH_NOTIFICATION_IMAGE = 'https://arunmobi-app.web.app/notification-default.png';

const NOTIF_ROLE_OPTIONS = [
  { key: 'all', label: 'All Users', color: '#007AFF' },
  { key: 'technician', label: 'Technicians', color: '#34C759' },
  { key: 'teacher', label: 'Teachers', color: '#FFD60A' },
  { key: 'supplier', label: 'Suppliers', color: '#FF6B2C' },
  { key: 'job_provider', label: 'Job Providers', color: '#5E8BFF' },
  { key: 'customer', label: 'Customers', color: '#FF2D55' },
];

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function maskNumber(num: string): string {
  if (!num || num.length < 4) return num || '';
  return num.slice(0, 4) + ' XXXX ' + num.slice(-4);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function UserDetailCard({ user, onBlock, onVerify, onDelete }: { user: any; onBlock: (id: string, name: string, blocked: boolean) => void; onVerify: (id: string, name: string, verified: boolean) => void; onDelete: (id: string, name: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [changingRole, setChangingRole] = useState(false);
  const [roleStatus, setRoleStatus] = useState<{msg: string; ok: boolean} | null>(null);
  const [grantingMonths, setGrantingMonths] = useState<number | null>(null);
  const [subGrantStatus, setSubGrantStatus] = useState<{msg: string; ok: boolean} | null>(null);
  const [localSubEnd, setLocalSubEnd] = useState<number | null>(null);
  const { refreshData } = useApp();
  const roleColor = ROLE_COLORS[user.role as UserRole] || C.textSecondary;
  const profile = user.fullProfile;
  const isBlocked = profile?.blocked === 1;
  const isVerified = profile?.verified === 1;

  const SUB_ROLES: UserRole[] = ['technician', 'teacher', 'supplier', 'shopkeeper'];
  const needsSubSection = SUB_ROLES.includes(user.role as UserRole);
  const subEnd = localSubEnd ?? (profile?.subscriptionEnd || 0);
  const isSubActive = (localSubEnd !== null || profile?.subscriptionActive === 1) && subEnd > Date.now();

  const grantSubscription = async (months: number) => {
    setGrantingMonths(months);
    setSubGrantStatus(null);
    try {
      const res = await adminRequest('POST', '/api/admin/grant-subscription', { userId: user.id, months });
      const data = await res.json();
      if (data.success) {
        setLocalSubEnd(data.subscriptionEnd);
        const expiry = new Date(data.subscriptionEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        setSubGrantStatus({ msg: `Active until ${expiry}`, ok: true });
        refreshData();
      } else {
        setSubGrantStatus({ msg: data.message || 'Failed', ok: false });
      }
    } catch (e: any) {
      setSubGrantStatus({ msg: e?.message || 'Network error', ok: false });
    } finally {
      setGrantingMonths(null);
      setTimeout(() => setSubGrantStatus(null), 4000);
    }
  };

  const changeRole = async (newRole: UserRole) => {
    setShowRolePicker(false);
    setChangingRole(true);
    setRoleStatus(null);
    try {
      const res = await adminRequest('POST', '/api/admin/change-role', { userId: user.id, newRole });
      const data = await res.json();
      if (data.success) {
        setRoleStatus({ msg: `Changed to ${ROLE_LABELS[newRole] || newRole}`, ok: true });
        await refreshData();
      } else {
        setRoleStatus({ msg: data.message || 'Failed', ok: false });
      }
    } catch (e: any) {
      setRoleStatus({ msg: e?.message || 'Network error', ok: false });
    } finally {
      setChangingRole(false);
      setTimeout(() => setRoleStatus(null), 3000);
    }
  };

  const ROLES_LIST: UserRole[] = ['technician', 'teacher', 'supplier', 'shopkeeper', 'customer', 'job_provider'];

  return (
    <View style={[styles.userCard, isBlocked && { borderColor: '#FF3B30', borderWidth: 1 }]}>
      <Pressable onPress={() => { setShowRolePicker(false); setExpanded(!expanded); }}>
      <View style={styles.userCardTop}>
        {profile?.avatar ? (
          <Image source={{ uri: profile.avatar }} style={[styles.userAvatarImg, isBlocked && { opacity: 0.5 }]} contentFit="cover" />
        ) : (
          <View style={[styles.userAvatar, { backgroundColor: roleColor + '20' }, isBlocked && { opacity: 0.5 }]}>
            <Text style={[styles.userAvatarText, { color: roleColor }]}>{getInitials(user.name)}</Text>
          </View>
        )}
        <View style={styles.userInfo}>
          <View style={styles.userNameRow}>
            <Text style={[styles.userName, isBlocked && { color: '#FF3B30' }]} numberOfLines={1}>{user.name}</Text>
            {isVerified && (
              <Ionicons name="checkmark-circle" size={16} color="#34C759" style={{ marginLeft: 4 }} />
            )}
            {isBlocked && (
              <View style={[styles.registeredBadge, { backgroundColor: '#FF3B3015' }]}>
                <Text style={[styles.registeredText, { color: '#FF3B30' }]}>Blocked</Text>
              </View>
            )}
            {!isBlocked && user.isRegistered && (
              <View style={styles.registeredBadge}>
                <Text style={styles.registeredText}>Verified</Text>
              </View>
            )}
          </View>
          <View style={styles.userMeta}>
            <View style={[styles.userRoleBadge, { backgroundColor: roleColor + '15' }]}>
              <Text style={[styles.userRoleText, { color: roleColor }]}>{ROLE_LABELS[user.role as UserRole] || user.role}</Text>
            </View>
            <Pressable
              style={{ marginLeft: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: C.surfaceHighlight, borderRadius: 6 }}
              onPress={(e) => { e.stopPropagation?.(); setShowRolePicker(v => !v); }}
              disabled={changingRole}
            >
              <Text style={{ fontSize: 10, color: C.primary, fontFamily: 'Inter_600SemiBold' }}>
                {changingRole ? 'Saving...' : 'Change Role'}
              </Text>
            </Pressable>
            {user.city ? (
              <View style={styles.userCityRow}>
                <Ionicons name="location-outline" size={12} color={C.textTertiary} />
                <Text style={styles.userCity}>{user.city}</Text>
              </View>
            ) : null}
          </View>
          {profile?.phone && (
            <View style={styles.phoneRow}>
              <Ionicons name="call-outline" size={12} color={C.textTertiary} />
              <Text style={styles.phoneText}>{profile.phone}</Text>
            </View>
          )}
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={C.textTertiary} />
      </View>
      </Pressable>

      {roleStatus && (
        <View style={{ marginTop: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: roleStatus.ok ? '#34C75915' : '#FF3B3015', borderRadius: 8 }}>
          <Text style={{ fontSize: 12, color: roleStatus.ok ? '#34C759' : '#FF3B30', fontFamily: 'Inter_600SemiBold' }}>{roleStatus.msg}</Text>
        </View>
      )}

      {showRolePicker && (
        <View style={{ marginTop: 8, backgroundColor: C.surfaceElevated, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border }}>
          {ROLES_LIST.map(r => (
            <Pressable
              key={r}
              onPress={() => changeRole(r)}
              style={[{
                paddingVertical: 11,
                paddingHorizontal: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                borderBottomWidth: 1,
                borderBottomColor: C.borderLight,
              }, r === user.role && { backgroundColor: C.primary + '15' }]}
            >
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ROLE_COLORS[r] || C.textSecondary }} />
              <Text style={{ fontSize: 14, fontFamily: r === user.role ? 'Inter_600SemiBold' : 'Inter_400Regular', color: r === user.role ? C.primary : C.text }}>
                {ROLE_LABELS[r] || r}
              </Text>
              {r === user.role && <Ionicons name="checkmark" size={14} color={C.primary} style={{ marginLeft: 'auto' }} />}
            </Pressable>
          ))}
          <Pressable
            onPress={() => setShowRolePicker(false)}
            style={{ paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 13, color: C.textTertiary, fontFamily: 'Inter_500Medium' }}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {expanded && profile && (
        <View style={styles.userDetails}>
          {profile.sellType ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Sells</Text>
              <Text style={styles.detailValue}>{profile.sellType}</Text>
            </View>
          ) : null}
          {profile.teachType ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Teaches</Text>
              <Text style={styles.detailValue}>{profile.teachType}</Text>
            </View>
          ) : null}
          {profile.shopName ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Shop</Text>
              <Text style={styles.detailValue}>{profile.shopName}</Text>
            </View>
          ) : null}
          {profile.shopAddress ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Address</Text>
              <Text style={styles.detailValue}>{profile.shopAddress}</Text>
            </View>
          ) : null}
          {profile.gstNumber ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>GST</Text>
              <Text style={styles.detailValue}>{profile.gstNumber}</Text>
            </View>
          ) : null}
          {profile.aadhaarNumber ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Aadhaar</Text>
              <Text style={styles.detailValue}>{maskNumber(profile.aadhaarNumber)}</Text>
            </View>
          ) : null}
          {profile.panNumber ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>PAN</Text>
              <Text style={styles.detailValue}>{profile.panNumber}</Text>
            </View>
          ) : null}
          {profile.experience ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Experience</Text>
              <Text style={styles.detailValue}>{profile.experience}</Text>
            </View>
          ) : null}
          {(() => {
            const rawSkills = profile.skills;
            const skillsArr: string[] = Array.isArray(rawSkills)
              ? rawSkills
              : typeof rawSkills === 'string' && rawSkills.trim().startsWith('[')
                ? (() => { try { return JSON.parse(rawSkills); } catch { return []; } })()
                : typeof rawSkills === 'string' && rawSkills.trim()
                  ? rawSkills.split(',').map((s: string) => s.trim()).filter(Boolean)
                  : [];
            return skillsArr.length > 0 ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Skills</Text>
                <Text style={styles.detailValue}>{skillsArr.join(', ')}</Text>
              </View>
            ) : null;
          })()}
          <Text style={styles.detailPostCount}>{user.postCount} post{user.postCount !== 1 ? 's' : ''}</Text>

          {needsSubSection && (
            <View style={{ marginTop: 12, backgroundColor: C.surfaceElevated, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.borderLight }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 6 }}>
                <Ionicons name="card-outline" size={14} color={isSubActive ? '#34C759' : C.textTertiary} />
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: isSubActive ? '#34C759' : C.textSecondary }}>
                  {isSubActive
                    ? `Active — expires ${new Date(subEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                    : 'No active subscription'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {[1, 2, 3].map(m => (
                  <Pressable
                    key={m}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, backgroundColor: grantingMonths === m ? C.primary + '30' : C.primary + '15', borderWidth: 1, borderColor: C.primary + '40' }}
                    onPress={() => grantSubscription(m)}
                    disabled={grantingMonths !== null}
                  >
                    {grantingMonths === m ? (
                      <ActivityIndicator size="small" color={C.primary} />
                    ) : (
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary }}>+{m} Month{m > 1 ? 's' : ''}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
              {subGrantStatus && (
                <View style={{ marginTop: 8, padding: 6, backgroundColor: subGrantStatus.ok ? '#34C75912' : '#FF3B3012', borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: subGrantStatus.ok ? '#34C759' : '#FF3B30', textAlign: 'center' }}>
                    {subGrantStatus.msg}
                  </Text>
                </View>
              )}
            </View>
          )}

          {confirmDelete ? (
            <View style={{ marginTop: 12, backgroundColor: '#FF3B3010', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#FF3B3040' }}>
              <Text style={{ color: '#FF3B30', fontSize: 13, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginBottom: 10 }}>
                Permanently delete {user.name}? This cannot be undone.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}
                  onPress={() => setConfirmDelete(false)}
                >
                  <Text style={{ color: C.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8, backgroundColor: '#FF3B30' }}
                  onPress={() => { setConfirmDelete(false); onDelete(user.id, user.name); }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Inter_700Bold' }}>Yes, Delete</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: isBlocked ? '#34C75915' : '#FF3B3015', paddingVertical: 10, borderRadius: 10 }}
                onPress={() => onBlock(user.id, user.name, !isBlocked)}
              >
                <Ionicons name={isBlocked ? 'checkmark-circle-outline' : 'ban'} size={16} color={isBlocked ? '#34C759' : '#FF3B30'} />
                <Text style={{ color: isBlocked ? '#34C759' : '#FF3B30', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                  {isBlocked ? 'Unblock' : 'Block'}
                </Text>
              </Pressable>
              {user.role === 'technician' && (
                <Pressable
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: isVerified ? '#FF3B3015' : '#34C75915', paddingVertical: 10, borderRadius: 10 }}
                  onPress={() => onVerify(user.id, user.name, !isVerified)}
                >
                  <Ionicons name={isVerified ? 'close-circle-outline' : 'checkmark-circle-outline'} size={16} color={isVerified ? '#FF3B30' : '#34C759'} />
                  <Text style={{ color: isVerified ? '#FF3B30' : '#34C759', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                    {isVerified ? 'Unverify' : 'Verify'}
                  </Text>
                </Pressable>
              )}
              <Pressable
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FF3B3015', paddingVertical: 10, borderRadius: 10 }}
                onPress={() => setConfirmDelete(true)}
              >
                <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                <Text style={{ color: '#FF3B30', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Delete</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const { profile, posts, jobs, conversations, deletePost, allProfiles, refreshData } = useApp();
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [subscriptions, setSubscriptions] = useState<SubscriptionSetting[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [liveUrl, setLiveUrl] = useState('');
  const [schematicsUrl, setSchematicsUrl] = useState('');
  const [webToolsUrl, setWebToolsUrl] = useState('');
  const [whatsappSupportUrl, setWhatsappSupportUrl] = useState('');
  const [linksLoading, setLinksLoading] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | UserRole>('all');

  const [revenueData, setRevenueData] = useState<any>(null);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [payoutsData, setPayoutsData] = useState<any[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(false);
  const [payoutsUpdating, setPayoutsUpdating] = useState<string | null>(null);
  const [activeSubsList, setActiveSubsList] = useState<any[]>([]);
  const [activeSubsLoading, setActiveSubsLoading] = useState(false);

  const [notifTitle, setNotifTitle] = useState('');
  const [notifBody, setNotifBody] = useState('');
  /** HTTPS image URL (admin upload or pasted URL); empty → server uses default art. */
  const [notifImageUrl, setNotifImageUrl] = useState('');
  /** In-app route when user taps (e.g. /(tabs), /directory). Sent as data.path + OneSignal url when APP domain is set. */
  const [notifOpenPath, setNotifOpenPath] = useState('/(tabs)');
  const [notifImageUploading, setNotifImageUploading] = useState(false);
  const [notifSending, setNotifSending] = useState(false);
  const [notifResult, setNotifResult] = useState<string | null>(null);
  const [pushStats, setPushStats] = useState<{ total: number; withToken: number; byRole?: Record<string, number> } | null>(null);
  const [pushStatsLoading, setPushStatsLoading] = useState(false);
  const [notifTargetRole, setNotifTargetRole] = useState<string>('all');
  const [broadcastPushHistory, setBroadcastPushHistory] = useState<any[]>([]);
  const [broadcastHistoryLoading, setBroadcastHistoryLoading] = useState(false);

  const [smsBody, setSmsBody] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState<string | null>(null);
  const [smsTargetRole, setSmsTargetRole] = useState<string>('all');

  const [emailTargetRole, setEmailTargetRole] = useState<string>('all');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<string | null>(null);

  const [emailStats, setEmailStats] = useState<{ totalWithEmail: number; subscribed: number; unsubscribed: number } | null>(null);
  const [emailCampaignList, setEmailCampaignList] = useState<any[]>([]);
  const [emailStatsLoading, setEmailStatsLoading] = useState(false);
  const [emailScheduleDate, setEmailScheduleDate] = useState('');
  const [emailScheduleTime, setEmailScheduleTime] = useState('');

  const [supportNumber, setSupportNumber] = useState('+918179142535');
  const [whatsappLink, setWhatsappLink] = useState('https://wa.me/918179142535');
  const [supportSaving, setSupportSaving] = useState(false);
  const [unlockingUserId, setUnlockingUserId] = useState<string | null>(null);
  const [deviceSettingsLoading, setDeviceSettingsLoading] = useState(false);
  const [deviceLockEnabled, setDeviceLockEnabled] = useState(false);
  const [deviceLockPrice, setDeviceLockPrice] = useState('100');
  const [lockNotifLoading, setLockNotifLoading] = useState(false);
  const [lockNotifications, setLockNotifications] = useState<any[]>([]);

  // Insurance settings state
  const [insurancePlanName, setInsurancePlanName] = useState('Mobile Protection Plan');
  const [insurancePlanPrice, setInsurancePlanPrice] = useState('50');
  const [insuranceDiscount, setInsuranceDiscount] = useState('500');
  const [insuranceStatus, setInsuranceStatus] = useState<'active' | 'disabled'>('active');
  const [insuranceLoading, setInsuranceLoading] = useState(false);
  const [insuranceSaving, setInsuranceSaving] = useState(false);
  const [insuranceSaved, setInsuranceSaved] = useState(false);

  // Pro Plan settings state
  const [proPlanName, setProPlanName] = useState('Mobile Protection Plan');
  const [proPlanTagline, setProPlanTagline] = useState('Protect Your Phone');
  const [proPlanMonthly, setProPlanMonthly] = useState('249');
  const [proPlanYearly, setProPlanYearly] = useState('1299');
  const [proPlanMinMonths, setProPlanMinMonths] = useState('3');
  const [proPlanSavingsText, setProPlanSavingsText] = useState('Save up to ₹4000 on repairs');
  const [proPlanFeatures, setProPlanFeatures] = useState<string[]>(['Screen damage', 'Doorstep service']);
  const [proPlanNewFeature, setProPlanNewFeature] = useState('');
  const [proPlanButtonText, setProPlanButtonText] = useState('Get Protection');
  const [proPlanStatus, setProPlanStatus] = useState<'active' | 'disabled'>('active');
  const [proPlanLoading, setProPlanLoading] = useState(false);
  const [proPlanSaving, setProPlanSaving] = useState(false);
  const [proPlanSaved, setProPlanSaved] = useState(false);

  // Protection plans state
  const [protectionPlansList, setProtectionPlansList] = useState<any[]>([]);
  const [protectionPlansLoading, setProtectionPlansLoading] = useState(false);
  const [protectionPlanFilter, setProtectionPlanFilter] = useState('all');
  const [protectionPlanSearchQuery, setProtectionPlanSearchQuery] = useState('');
  const [protectionClaimsList, setProtectionClaimsList] = useState<any[]>([]);
  const [protectionClaimsLoading, setProtectionClaimsLoading] = useState(false);
  const [protectionClaimFilter, setProtectionClaimFilter] = useState('all');

  // Ads management state
  const [adsList, setAdsList] = useState<any[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsSeeding, setAdsSeeding] = useState(false);
  const [newAdTitle, setNewAdTitle] = useState('');
  const [newAdDescription, setNewAdDescription] = useState('');
  const [newAdImageUrl, setNewAdImageUrl] = useState('');
  const [newAdLinkUrl, setNewAdLinkUrl] = useState('');
  const [adSaving, setAdSaving] = useState(false);

  // Listings management state
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [listingsSearch, setListingsSearch] = useState('');

  // Reels management state
  const [adminReels, setAdminReels] = useState<any[]>([]);
  const [reelsLoading, setReelsLoading] = useState(false);
  const [reelsError, setReelsError] = useState<string | null>(null);

  // Leads management state
  const [adminLeadsList, setAdminLeadsList] = useState<any[]>([]);
  const [adminLeadsLoading, setAdminLeadsLoading] = useState(false);
  const [adminLeadPrice, setAdminLeadPrice] = useState(50);
  const [adminLeadPriceInput, setAdminLeadPriceInput] = useState('50');
  const [adminLeadPriceSaving, setAdminLeadPriceSaving] = useState(false);
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [addLeadForm, setAddLeadForm] = useState({ title: '', description: '', category: 'repair', location: '', contactNumber: '', customerName: '', price: '' });
  const [addLeadSaving, setAddLeadSaving] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<{ count: number } | null>(null);
  const [reelsSearch, setReelsSearch] = useState('');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  const sortedAdminLeads = useMemo(() => {
    if (!userLocation || adminLeadsList.length === 0) return adminLeadsList;
    const dist = (l: any) => {
      if (!l?.latitude || !l?.longitude) return Number.POSITIVE_INFINITY;
      const la = parseFloat(l.latitude);
      const lo = parseFloat(l.longitude);
      if (Number.isNaN(la) || Number.isNaN(lo)) return Number.POSITIVE_INFINITY;
      return haversineKm(userLocation.lat, userLocation.lng, la, lo);
    };
    return [...adminLeadsList].sort((a, b) => dist(a) - dist(b));
  }, [adminLeadsList, userLocation]);

  const [adminPosts, setAdminPosts] = useState<any[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);

  const [repairBookings, setRepairBookings] = useState<any[]>([]);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairFilter, setRepairFilter] = useState<'all' | 'pending' | 'assigned' | 'completed' | 'cancelled'>('all');
  const [assigningBooking, setAssigningBooking] = useState<any>(null);

  const [technicianSearch, setTechnicianSearch] = useState('');

  const fetchRepairBookings = useCallback(async () => {
    setRepairLoading(true);
    try {
      const res = await apiRequest('GET', '/api/repair-bookings');
      const data = await res.json();
      if (Array.isArray(data)) setRepairBookings(data);
    } catch (err) {
      console.warn('Failed to fetch repair bookings:', err);
    } finally {
      setRepairLoading(false);
    }
  }, []);

  const updateBookingStatus = async (id: string, status: string) => {
    try {
      await apiRequest('PATCH', `/api/repair-bookings/${id}/status`, { status });
      fetchRepairBookings();
    } catch (err) {
      Alert.alert('Error', 'Failed to update booking status');
    }
  };

  const assignTechnician = async (bookingId: string, technician: any) => {
    try {
      await apiRequest('PATCH', `/api/repair-bookings/${bookingId}/status`, {
        status: 'assigned',
        technicianId: technician.id,
        technicianName: technician.name,
        technicianPhone: technician.phone || '',
      });
      setAssigningBooking(null);
      setTechnicianSearch('');
      fetchRepairBookings();
      Alert.alert('Success', `Assigned ${technician.name} to booking`);
    } catch (err) {
      Alert.alert('Error', 'Failed to assign technician');
    }
  };

  const fetchAdminReels = useCallback(async () => {
    console.log('[Admin][Reels] fetch start');
    setReelsLoading(true);
    setReelsError(null);
    try {
      const res = await apiRequest('GET', '/api/reels');
      const data = await res.json();
      const items = Array.isArray(data) ? data : data?.reels || [];
      console.log('[Admin][Reels] fetch success', items.length);
      setAdminReels(items);
    } catch (err) {
      console.error('[Admin][Reels] fetch error', err);
      setReelsError('Failed to load reels');
    } finally {
      setReelsLoading(false);
    }
  }, []);

  const deleteAdminReel = useCallback(async (reelId: string, title: string) => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Delete "${title || 'Untitled Reel'}"? This cannot be undone.`)
      : true;
    if (!confirmed) return;
    console.log('[Admin][Reels] delete start', reelId);
    try {
      const res = await adminDeleteRequest(`/api/admin/reels/${reelId}`);
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setAdminReels(prev => prev.filter(r => r.id !== reelId));
      console.log('[Admin][Reels] delete success', reelId);
    } catch (err) {
      console.error('[Admin][Reels] delete error', err);
      Alert.alert('Error', 'Failed to delete reel');
    }
  }, []);

  const fetchAdminPosts = useCallback(async () => {
    console.log('[Admin][Posts] fetch start');
    setPostsLoading(true);
    setPostsError(null);
    try {
      const res = await apiRequest('GET', '/api/posts');
      const data = await res.json();
      const items = Array.isArray(data) ? data : data?.posts || [];
      console.log('[Admin][Posts] fetch success', items.length);
      setAdminPosts(items);
    } catch (err: any) {
      console.error('[Admin][Posts] fetch error', err);
      setPostsError(err?.message || 'Failed to load posts');
    } finally {
      setPostsLoading(false);
    }
  }, []);

  const handleDeleteAdminPost = useCallback((postId: string, userName: string) => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Delete post by ${userName}?`)
      : true;
    if (!confirmed) return;
    console.log('[Admin][Posts] delete start', postId);
    adminDeleteRequest(`/api/admin/posts/${postId}`)
      .then(res => {
        if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
        setAdminPosts(prev => prev.filter(post => post.id !== postId));
        console.log('[Admin][Posts] delete success', postId);
      })
      .catch(err => {
        console.error('[Admin][Posts] delete error', err);
        Alert.alert('Error', 'Failed to delete post');
      });
  }, []);

  const normalizeMediaUri = useCallback((uri?: string | null) => {
    if (!uri) return '';
    if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
    if (uri.startsWith('file://')) return uri;
    if (uri.includes('b-cdn.net') || uri.includes('cloudfront.net') || uri.includes('storage.googleapis.com')) return uri;
    const baseUrl = getApiUrl();
    return new URL(uri.replace(/^\//, ''), baseUrl).toString();
  }, []);

  useEffect(() => {
    fetchAdminPosts();
  }, [fetchAdminPosts]);

  useEffect(() => {
    if (activeTab !== 'leads') return;
    let cancelled = false;
    (async () => {
      const loc = await getBestUserLocation();
      if (!cancelled && loc) setUserLocation(loc);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'bookings') fetchRepairBookings();
    if (activeTab === 'ads') fetchAds();
    if (activeTab === 'listings') fetchAllProducts();
    if (activeTab === 'reels') fetchAdminReels();
    if (activeTab === 'users' || activeTab === 'dashboard') refreshData();
  }, [activeTab, fetchRepairBookings, fetchAdminReels, refreshData]);

  const fetchAds = async () => {
    setAdsLoading(true);
    try {
      const res = await apiRequest('GET', '/api/ads');
      const data = await res.json();
      if (Array.isArray(data)) setAdsList(data);
    } catch { } finally { setAdsLoading(false); }
  };

  const fetchAllProducts = async () => {
    console.log('[Admin][Listings] fetch start');
    setListingsLoading(true);
    setListingsError(null);
    try {
      const res = await apiRequest('GET', '/api/products');
      const data = await res.json();
      const items = Array.isArray(data) ? data : data?.products || [];
      console.log('[Admin][Listings] fetch success', items.length);
      setAllProducts(items);
    } catch (err) {
      console.error('[Admin][Listings] fetch error', err);
      setListingsError('Failed to load listings');
    } finally { setListingsLoading(false); }
  };

  const createAd = async () => {
    if (!newAdTitle.trim()) { Alert.alert('Error', 'Title is required'); return; }
    setAdSaving(true);
    try {
      const res = await apiRequest('POST', '/api/ads', { title: newAdTitle, description: newAdDescription, imageUrl: newAdImageUrl, linkUrl: newAdLinkUrl, isActive: 1, sortOrder: adsList.length });
      if (res.ok) {
        setNewAdTitle(''); setNewAdDescription(''); setNewAdImageUrl(''); setNewAdLinkUrl('');
        await fetchAds();
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to create ad');
    } finally { setAdSaving(false); }
  };

  const toggleAd = async (ad: any) => {
    try {
      await apiRequest('PATCH', `/api/ads/${ad.id}`, { isActive: ad.isActive ? 0 : 1 });
      await fetchAds();
    } catch { Alert.alert('Error', 'Failed to toggle ad'); }
  };

  const deleteAd = (id: string, title: string) => {
    Alert.alert('Delete Ad', `Delete "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            const res = await adminDeleteRequest(`/api/ads/${id}`);
            if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
            setAdsList(prev => prev.filter(ad => ad.id !== id));
          } catch {
            Alert.alert('Error', 'Failed to delete ad');
          }
        }
      }
    ]);
  };

  const seedSuppliers = async () => {
    setAdsSeeding(true);
    try {
      const res = await apiRequest('POST', '/api/admin/seed-suppliers', {});
      const data = await res.json();
      Alert.alert('Done', data.message || 'Suppliers seeded');
    } catch { Alert.alert('Error', 'Failed to seed suppliers'); } finally { setAdsSeeding(false); }
  };

  const adminDeleteProduct = (id: string, title: string) => {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Delete "${title}"?`)
      : true;
    if (!confirmed) return;
    console.log('[Admin][Listings] delete start', id);
    adminDeleteRequest(`/api/admin/products/${id}`)
      .then(res => {
        if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
        setAllProducts(prev => prev.filter(p => p.id !== id));
        console.log('[Admin][Listings] delete success', id);
      })
      .catch(err => {
        console.error('[Admin][Listings] delete error', err);
        Alert.alert('Error', 'Failed to delete listing');
      });
  };

  const safeImageUri = (uri?: string | null) => {
    if (!uri) return '';
    if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('file://')) return uri;
    if (uri.startsWith('/')) return `${getApiUrl()}${uri}`;
    return uri;
  };

  const safeVideoUri = (uri?: string | null) => {
    if (!uri) return '';
    if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('file://')) return uri;
    if (uri.startsWith('/')) return `${getApiUrl()}${uri}`;
    return uri;
  };

  const renderAds = () => {
    const inputStyle = { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.text, backgroundColor: C.surface, marginTop: 6 };
    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 4 }}>Ads Manager</Text>
        <Text style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16 }}>Manage banner ads displayed in the Shop. Toggle active/inactive or delete.</Text>

        {/* Seed Suppliers */}
        <View style={{ backgroundColor: '#FF6B2C15', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FF6B2C33', marginBottom: 16 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#FF6B2C', marginBottom: 4 }}>Seed Test Suppliers</Text>
          <Text style={{ fontSize: 12, color: C.textSecondary, marginBottom: 10 }}>Add 10 test supplier accounts to populate the Suppliers tab.</Text>
          <Pressable
            style={{ backgroundColor: '#FF6B2C', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
            onPress={seedSuppliers}
            disabled={adsSeeding}
          >
            <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 14 }}>{adsSeeding ? 'Seeding...' : 'Seed 10 Test Suppliers'}</Text>
          </Pressable>
        </View>

        {/* Create New Ad */}
        <View style={{ backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 20 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 12 }}>Create New Ad</Text>
          <Text style={{ fontSize: 12, color: C.textSecondary }}>Title *</Text>
          <TextInput style={inputStyle} value={newAdTitle} onChangeText={setNewAdTitle} placeholder="Ad title" placeholderTextColor={C.textTertiary} />
          <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 10 }}>Description</Text>
          <TextInput style={inputStyle} value={newAdDescription} onChangeText={setNewAdDescription} placeholder="Short description" placeholderTextColor={C.textTertiary} />
          <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 10 }}>Image URL</Text>
          <TextInput style={inputStyle} value={newAdImageUrl} onChangeText={setNewAdImageUrl} placeholder="https://..." placeholderTextColor={C.textTertiary} autoCapitalize="none" />
          <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 10 }}>Link URL</Text>
          <TextInput style={inputStyle} value={newAdLinkUrl} onChangeText={setNewAdLinkUrl} placeholder="https://..." placeholderTextColor={C.textTertiary} autoCapitalize="none" />
          <Pressable
            style={{ marginTop: 14, backgroundColor: C.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
            onPress={createAd} disabled={adSaving}
          >
            <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 15 }}>{adSaving ? 'Creating...' : '+ Create Ad'}</Text>
          </Pressable>
        </View>

        {/* Existing Ads */}
        <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 12 }}>All Ads ({adsList.length})</Text>
        {adsLoading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />
        ) : adsList.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Ionicons name="megaphone-outline" size={48} color={C.textTertiary} />
            <Text style={{ color: C.textSecondary, marginTop: 10 }}>No ads yet. Create one above.</Text>
          </View>
        ) : (
          adsList.map(ad => (
            <View key={ad.id} style={{ backgroundColor: C.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: ad.isActive ? C.primary + '44' : C.border, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                {ad.imageUrl ? (
                  <Image
                    source={{ uri: safeImageUri(ad.imageUrl) }}
                    style={{ width: 70, height: 50, borderRadius: 10, backgroundColor: C.surface }}
                    contentFit="cover"
                  />
                ) : (
                  <View style={{ width: 70, height: 50, borderRadius: 10, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="image-outline" size={24} color={C.textTertiary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{ad.title}</Text>
                  {ad.description ? <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{ad.description}</Text> : null}
                  {ad.linkUrl ? <Text style={{ color: C.primary, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{ad.linkUrl}</Text> : null}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Pressable
                  style={{ flex: 1, paddingVertical: 9, borderRadius: 8, backgroundColor: ad.isActive ? '#34C75915' : '#FF3B3015', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                  onPress={() => toggleAd(ad)}
                >
                  <Ionicons name={ad.isActive ? 'eye' : 'eye-off'} size={15} color={ad.isActive ? '#34C759' : '#FF3B30'} />
                  <Text style={{ color: ad.isActive ? '#34C759' : '#FF3B30', fontWeight: '700', fontSize: 13 }}>{ad.isActive ? 'Active' : 'Hidden'}</Text>
                </Pressable>
                <Pressable
                  style={{ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#FF3B3015', flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  onPress={() => deleteAd(ad.id, ad.title)}
                >
                  <Ionicons name="trash-outline" size={15} color="#FF3B30" />
                  <Text style={{ color: '#FF3B30', fontWeight: '700', fontSize: 13 }}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    );
  };

  const renderListings = () => {
    const filtered = allProducts.filter(p =>
      !listingsSearch || [p.title, p.userName, p.city, p.category].filter(Boolean).join(' ').toLowerCase().includes(listingsSearch.toLowerCase())
    );
    const visible = filtered.slice(0, 12);
    return (
      <View style={{ flex: 1 }}>
        <View style={{ padding: 16, paddingBottom: 8 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 4 }}>All Listings</Text>
          <Text style={{ fontSize: 13, color: C.textSecondary, marginBottom: 12 }}>Delete inappropriate or spam product listings.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.border }}>
            <Ionicons name="search" size={16} color={C.textTertiary} />
            <TextInput
              style={{ flex: 1, color: C.text, fontSize: 14 }}
              placeholder="Search listings..."
              placeholderTextColor={C.textTertiary}
              value={listingsSearch}
              onChangeText={setListingsSearch}
            />
          </View>
        </View>
        {listingsLoading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : listingsError ? (
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold' }}>{listingsError}</Text>
          </View>
        ) : (
          <FlatList
            data={visible}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                <Ionicons name="cube-outline" size={48} color={C.textTertiary} />
                <Text style={{ color: C.textSecondary, marginTop: 10 }}>No listings found</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={{ backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {item.imageUrl ? (
                  <Image source={{ uri: safeImageUri(item.imageUrl) }} style={{ width: 66, height: 66, borderRadius: 10, backgroundColor: C.surfaceElevated }} contentFit="cover" onError={() => console.error('[Admin][Listings] image load error', item.imageUrl)} />
                ) : (
                  <View style={{ width: 66, height: 66, borderRadius: 10, backgroundColor: C.surfaceElevated, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="image-outline" size={20} color={C.textTertiary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{item.title}</Text>
                  <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 2 }}>By {item.userName} · {item.category || 'general'}</Text>
                  {item.city && <Text style={{ color: C.textTertiary, fontSize: 11, marginTop: 1 }}>{item.city}</Text>}
                  {item.price && <Text style={{ color: C.primary, fontSize: 13, fontWeight: '700', marginTop: 2 }}>₹{item.price}</Text>}
                </View>
                <Pressable
                  style={{ padding: 10, borderRadius: 8, backgroundColor: '#FF3B3015' }}
                  onPress={() => adminDeleteProduct(item.id, item.title)}
                >
                  <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                </Pressable>
              </View>
            )}
          />
        )}
      </View>
    );
  };

  const fetchInsuranceSettings = useCallback(async () => {
    setInsuranceLoading(true);
    try {
      const res = await apiRequest('GET', '/api/settings/insurance');
      const data = await res.json();
      if (data.success && data.settings) {
        setInsurancePlanName(data.settings.planName);
        setInsurancePlanPrice(String(data.settings.protectionPlanPrice));
        setInsuranceDiscount(String(data.settings.repairDiscount));
        setInsuranceStatus(data.settings.status);
      }
    } catch { }
    finally { setInsuranceLoading(false); }
  }, []);

  const saveInsuranceSettings = useCallback(async () => {
    setInsuranceSaving(true);
    try {
      const res = await apiRequest('PUT', '/api/admin/settings/insurance', {
        planName: insurancePlanName,
        protectionPlanPrice: parseInt(insurancePlanPrice, 10),
        repairDiscount: parseInt(insuranceDiscount, 10),
        status: insuranceStatus,
      });
      const data = await res.json();
      if (data.success) {
        setInsuranceSaved(true);
        setTimeout(() => setInsuranceSaved(false), 2500);
        if (Platform.OS !== 'web') Alert.alert('Saved', 'Insurance settings updated successfully.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save settings');
    } finally {
      setInsuranceSaving(false);
    }
  }, [insurancePlanName, insurancePlanPrice, insuranceDiscount, insuranceStatus]);

  useEffect(() => {
    if (activeTab === 'insurance') fetchInsuranceSettings();
  }, [activeTab, fetchInsuranceSettings]);

  const fetchProPlanSettings = useCallback(async () => {
    setProPlanLoading(true);
    try {
      const res = await apiRequest('GET', '/api/settings/insurance');
      const data = await res.json();
      if (data.success && data.settings) {
        const s = data.settings;
        if (s.planName) setProPlanName(s.planName);
        if (s.planTagline) setProPlanTagline(s.planTagline);
        if (s.monthlyPrice) setProPlanMonthly(String(s.monthlyPrice));
        if (s.yearlyPrice) setProPlanYearly(String(s.yearlyPrice));
        if (s.minMonths) setProPlanMinMonths(String(s.minMonths));
        if (s.savingsText) setProPlanSavingsText(s.savingsText);
        if (s.features) setProPlanFeatures(Array.isArray(s.features) ? s.features : [s.features]);
        if (s.buttonText) setProPlanButtonText(s.buttonText);
        if (s.status) setProPlanStatus(s.status);
      }
    } catch { }
    finally { setProPlanLoading(false); }
  }, []);

  const saveProPlanSettings = useCallback(async () => {
    setProPlanSaving(true);
    try {
      const res = await apiRequest('PUT', '/api/admin/settings/insurance', {
        planName: proPlanName,
        planTagline: proPlanTagline,
        monthlyPrice: parseInt(proPlanMonthly, 10) || 249,
        yearlyPrice: parseInt(proPlanYearly, 10) || 1299,
        minMonths: parseInt(proPlanMinMonths, 10) || 3,
        savingsText: proPlanSavingsText,
        features: proPlanFeatures,
        buttonText: proPlanButtonText,
        status: proPlanStatus,
      });
      const data = await res.json();
      if (data.success) {
        setProPlanSaved(true);
        setTimeout(() => setProPlanSaved(false), 2500);
        invalidateInsuranceCache();
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save Pro Plan settings');
    } finally {
      setProPlanSaving(false);
    }
  }, [proPlanName, proPlanTagline, proPlanMonthly, proPlanYearly, proPlanMinMonths, proPlanSavingsText, proPlanFeatures, proPlanButtonText, proPlanStatus]);

  useEffect(() => {
    if (activeTab === 'pro-plan') fetchProPlanSettings();
  }, [activeTab, fetchProPlanSettings]);

  // ── Protection Plans ──
  const fetchProtectionPlans = useCallback(async () => {
    setProtectionPlansLoading(true);
    try {
      const res = await apiRequest('GET', `/api/admin/protection/plans?status=${protectionPlanFilter}`);
      const data = await res.json();
      setProtectionPlansList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      console.error('[Admin] Error fetching plans:', e);
      setProtectionPlansList([]);
    } finally { setProtectionPlansLoading(false); }
  }, [protectionPlanFilter]);

  const fetchProtectionClaims = useCallback(async () => {
    setProtectionClaimsLoading(true);
    try {
      const res = await apiRequest('GET', `/api/admin/protection/claims?status=${protectionClaimFilter}`);
      const data = await res.json();
      setProtectionClaimsList(Array.isArray(data) ? data : []);
    } catch { setProtectionClaimsList([]); }
    finally { setProtectionClaimsLoading(false); }
  }, [protectionClaimFilter]);

  const fetchAdminLeads = useCallback(async () => {
    setAdminLeadsLoading(true);
    const token = await getSessionToken();
    const adminLeadsPath = withLeadAuthQuery('/api/admin/leads', token, profile);
    const publicLeadsPath = withLeadAuthQuery('/api/leads?category=all&sort=latest', token, profile);
    try {
      const res = await apiRequest('GET', adminLeadsPath);
      const data = await res.json();
      if (res.ok && data && Array.isArray(data.leads) && data.leads.length > 0) {
        setAdminLeadsList(data.leads);
        setAdminLeadPrice(data.price ?? 50);
        setAdminLeadPriceInput(String(data.price ?? 50));
        return;
      }
      // Same rows as Lead Box when /api/admin/leads is empty or errors; GET /api/leads accepts admin session in query too
      const res2 = await apiRequest('GET', publicLeadsPath);
      const rows = await res2.json();
      if (Array.isArray(rows) && rows.length > 0) {
        setAdminLeadsList(rows.map((l: any) => ({ ...l, claims: l.claims ?? [] })));
        if (data?.price != null) {
          setAdminLeadPrice(data.price);
          setAdminLeadPriceInput(String(data.price));
        }
        return;
      }
      if (data && Array.isArray(data.leads)) {
        setAdminLeadsList(data.leads);
        setAdminLeadPrice(data.price ?? 50);
        setAdminLeadPriceInput(String(data.price ?? 50));
      } else {
        setAdminLeadsList([]);
      }
    } catch {
      try {
        const res2 = await apiRequest('GET', publicLeadsPath);
        const rows = await res2.json();
        setAdminLeadsList(Array.isArray(rows) ? rows.map((l: any) => ({ ...l, claims: l.claims ?? [] })) : []);
      } catch {
        setAdminLeadsList([]);
      }
    } finally {
      setAdminLeadsLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    if (activeTab === 'protection-plans') fetchProtectionPlans();
    if (activeTab === 'protection-claims') fetchProtectionClaims();
    if (activeTab === 'leads') fetchAdminLeads();
  }, [activeTab, fetchProtectionPlans, fetchProtectionClaims, fetchAdminLeads]);

  useEffect(() => {
    if (activeTab === 'protection-plans') {
      const timer = setTimeout(fetchProtectionPlans, 300);
      return () => clearTimeout(timer);
    }
  }, [activeTab, protectionPlanFilter, fetchProtectionPlans]);

  useEffect(() => {
    if (activeTab === 'protection-claims') {
      const timer = setTimeout(fetchProtectionClaims, 300);
      return () => clearTimeout(timer);
    }
  }, [activeTab, protectionClaimFilter, fetchProtectionClaims]);

  const handleProtectionPlanAction = useCallback(async (planId: string, action: 'approve' | 'reject', reason?: string) => {
    try {
      const res = await apiRequest('PUT', `/api/admin/protection/plan/${planId}`, {
        action,
        rejectionReason: reason || ''
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      Alert.alert('Success', action === 'approve' ? 'Plan approved!' : 'Plan rejected.');
      fetchProtectionPlans();
    } catch (e: any) {
      Alert.alert('Error', e.message || `Failed to ${action} plan`);
    }
  }, [fetchProtectionPlans]);

  const handleProtectionClaimAction = useCallback(async (claimId: string, action: string, extra?: any) => {
    try {
      const res = await apiRequest('PUT', `/api/admin/protection/claim/${claimId}`, { action, ...extra });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      Alert.alert('Success', `Claim ${action} successful!`);
      fetchProtectionClaims();
    } catch (e: any) {
      Alert.alert('Error', e.message || `Failed to ${action} claim`);
    }
  }, [fetchProtectionClaims]);

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const cleanProfilePhone = profile?.phone?.replace(/\D/g, "");
  const isAdmin = profile?.role === 'admin' || cleanProfilePhone === "8179142535" || cleanProfilePhone === "9876543210";

  useEffect(() => {
    if (!isAdmin) {
      Alert.alert('Access Denied', 'You do not have admin access.');
      router.back();
    }
  }, [isAdmin]);

  const fetchSubscriptions = useCallback(async () => {
    try {
      setSubLoading(true);
      const res = await apiRequest('GET', '/api/subscription-settings');
      const data = await res.json();
      setSubscriptions(data);
    } catch (e) {
      console.warn('Failed to fetch subscriptions:', e);
    } finally {
      setSubLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'subscriptions') {
      fetchSubscriptions();
    }
  }, [activeTab, fetchSubscriptions]);


  const fetchLinks = useCallback(async () => {
    setLinksLoading(true);
    try {
      const res = await apiRequest('GET', '/api/app-settings');
      const data = await res.json();
      setLiveUrl(data.live_url || '');
      setSchematicsUrl(data.schematics_url || '');
      setWebToolsUrl(data.web_tools_url || '');
      setWhatsappSupportUrl(data.whatsapp_support_link || '');
    } catch (err) {
      console.warn('Failed to fetch links:', err);
    } finally {
      setLinksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'links') fetchLinks();
  }, [activeTab]);

  const fetchDeviceSettings = useCallback(async () => {
    setDeviceSettingsLoading(true);
    try {
      const res = await apiRequest('GET', '/api/app-settings');
      const data = await res.json();
      setDeviceLockEnabled(data.device_lock_enabled === 'true');
      setDeviceLockPrice(data.device_lock_price || '100');
    } catch (err) {
      console.warn('Failed to fetch device settings:', err);
    } finally {
      setDeviceSettingsLoading(false);
    }
  }, []);

  const fetchRevenue = useCallback(async () => {
    setRevenueLoading(true);
    try {
      const res = await apiRequest('GET', '/api/admin/revenue');
      const data = await res.json();
      if (data.success) setRevenueData(data);
    } catch (err) {
      console.warn('Failed to fetch revenue:', err);
    } finally {
      setRevenueLoading(false);
    }
  }, []);

  const fetchActiveSubscriptions = useCallback(async () => {
    setActiveSubsLoading(true);
    try {
      const res = await apiRequest('GET', '/api/admin/active-subscriptions');
      const data = await res.json();
      if (Array.isArray(data)) setActiveSubsList(data);
    } catch (err) {
      console.warn('Failed to fetch active subscriptions:', err);
    } finally {
      setActiveSubsLoading(false);
    }
  }, []);

  const fetchPayouts = useCallback(async () => {
    setPayoutsLoading(true);
    try {
      const res = await apiRequest('GET', '/api/admin/teacher-payouts');
      const data = await res.json();
      if (data.success && Array.isArray(data.payouts)) setPayoutsData(data.payouts);
    } catch (err) {
      console.warn('Failed to fetch payouts:', err);
    } finally {
      setPayoutsLoading(false);
    }
  }, []);

  const updatePayout = useCallback(async (payoutId: string, status: string, adminNotes: string) => {
    setPayoutsUpdating(payoutId);
    try {
      const res = await apiRequest('PATCH', `/api/admin/teacher-payouts/${payoutId}`, { status, adminNotes });
      const data = await res.json();
      if (data.success) {
        setPayoutsData(prev => prev.map(p => p.id === payoutId ? data.payout : p));
      }
    } catch (err) {
      console.warn('Failed to update payout:', err);
    } finally {
      setPayoutsUpdating(null);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'revenue') {
      fetchRevenue();
      fetchActiveSubscriptions();
    }
    if (activeTab === 'payouts') fetchPayouts();
  }, [activeTab, fetchRevenue, fetchActiveSubscriptions, fetchPayouts]);

  useEffect(() => {
    if (activeTab === 'subscriptions') fetchActiveSubscriptions();
  }, [activeTab, fetchActiveSubscriptions]);

  const fetchEmailStats = useCallback(async () => {
    setEmailStatsLoading(true);
    try {
      const res = await apiRequest('GET', '/api/admin/email-stats');
      const data = await res.json();
      if (data.success) {
        setEmailStats(data.stats);
        setEmailCampaignList(data.campaigns || []);
      }
    } catch (e) {
      console.error('[Admin] email-stats error:', e);
    } finally {
      setEmailStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'email') fetchEmailStats();
  }, [activeTab, fetchEmailStats]);


  const toggleSubscription = async (role: string, enabled: boolean) => {
    try {
      await apiRequest('PATCH', `/api/subscription-settings/${role}`, { enabled: enabled ? 1 : 0 });
      setSubscriptions(prev => prev.map(s => s.role === role ? { ...s, enabled: enabled ? 1 : 0 } : s));
    } catch (e) {
      Alert.alert('Error', 'Failed to update subscription setting.');
    }
  };

  const updateSubAmount = async (role: string, amount: string) => {
    try {
      await apiRequest('PATCH', `/api/subscription-settings/${role}`, { amount });
      setSubscriptions(prev => prev.map(s => s.role === role ? { ...s, amount } : s));
    } catch (e) {
      Alert.alert('Error', 'Failed to update amount.');
    }
  };

  const allUsers = useMemo(() => {
    const userMap = new Map<string, any>();

    if (allProfiles) {
      allProfiles.forEach(p => {
        userMap.set(p.id, {
          id: p.id,
          name: p.name,
          role: p.role as UserRole,
          city: p.city || '',
          postCount: 0,
          isRegistered: true,
          fullProfile: p,
        });
      });
    }

    if (posts) {
      posts.forEach(p => {
        if (!p.userId) return;
        if (!userMap.has(p.userId)) {
          userMap.set(p.userId, { id: p.userId, name: p.userName || 'Unknown', role: p.userRole || 'user', city: '', postCount: 0, isRegistered: false, fullProfile: null });
        }
        const user = userMap.get(p.userId)!;
        user.postCount += 1;
      });
    }

    return Array.from(userMap.values());
  }, [allProfiles, posts]);

  const filteredUsers = useMemo(() => {
    let users = allUsers;
    if (userRoleFilter !== 'all') {
      users = users.filter(u => u.role === userRoleFilter);
    }
    if (userSearchQuery.trim()) {
      const q = userSearchQuery.trim().toLowerCase();
      users = users.filter(u =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.fullProfile?.phone || '').includes(q) ||
        (u.city || '').toLowerCase().includes(q)
      );
    }
    return users;
  }, [allUsers, userSearchQuery, userRoleFilter]);

  const stats = useMemo(() => {
    const totalUsers = allUsers.length;
    const registeredUsers = allUsers.filter(u => u.isRegistered).length;
    const totalPosts = posts?.length || 0;
    const totalJobs = jobs?.length || 0;
    const totalChats = conversations?.length || 0;
    const totalLikes = posts?.reduce((sum, p) => sum + (p.likes?.length || 0), 0) || 0;
    const totalComments = posts?.reduce((sum, p) => sum + (p.comments?.length || 0), 0) || 0;
    const roleBreakdown = {
      technician: allUsers.filter(u => u.role === 'technician').length,
      teacher: allUsers.filter(u => u.role === 'teacher').length,
      supplier: allUsers.filter(u => u.role === 'supplier').length,
      job_provider: allUsers.filter(u => u.role === 'job_provider').length,
    };
    return { totalUsers, registeredUsers, totalPosts, totalJobs, totalChats, totalLikes, totalComments, roleBreakdown };
  }, [allUsers, posts, jobs, conversations]);

  const fetchPushStats = useCallback(async () => {
    try {
      setPushStatsLoading(true);
      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}/api/notifications/count`);
      const data = await res.json();
      const count = Number(data?.count ?? 0);
      setPushStats({ total: count, withToken: count, byRole: {} });
    } catch (e) {
      console.warn('Failed to fetch push stats:', e);
    } finally {
      setPushStatsLoading(false);
    }
  }, []);

  const fetchBroadcastPushHistory = useCallback(async () => {
    try {
      setBroadcastHistoryLoading(true);
      const res = await apiRequest('GET', '/api/admin/push-broadcast-history');
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.items)) setBroadcastPushHistory(data.items);
    } catch (e) {
      console.warn('Failed to fetch push broadcast history:', e);
    } finally {
      setBroadcastHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'notifications') {
      fetchPushStats();
      fetchBroadcastPushHistory();
    }
  }, [activeTab, fetchPushStats, fetchBroadcastPushHistory]);

  const fetchLockNotifications = useCallback(async () => {
    try {
      setLockNotifLoading(true);
      const res = await apiRequest('GET', '/api/admin/lock-notifications');
      const data = await res.json();
      setLockNotifications(data.notifications || []);
    } catch (e) {
      console.warn('Failed to fetch lock notifications:', e);
    } finally {
      setLockNotifLoading(false);
    }
  }, []);

  const fetchSupportInfo = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/admin/support-info');
      if (!res.ok) {
        console.warn('Support info fetch failed with status:', res.status);
        return;
      }
      const data = await res.json();
      if (data.success) {
        if (data.supportNumber) setSupportNumber(data.supportNumber);
        if (data.whatsappLink) setWhatsappLink(data.whatsappLink);
      }
    } catch (e) {
      console.warn('Failed to fetch support info:', e);
    }
  }, []);

  useEffect(() => {
  }, [activeTab, fetchLockNotifications, fetchSupportInfo]);

  const saveSupportInfo = useCallback(async () => {
    try {
      setSupportSaving(true);
      await apiRequest('POST', '/api/admin/support-info', { supportNumber, whatsappLink });
      Alert.alert('Saved', 'Support info updated successfully.');
    } catch (e) {
      Alert.alert('Error', 'Failed to save support info.');
    } finally {
      setSupportSaving(false);
    }
  }, [supportNumber, whatsappLink]);

  const unlockUser = useCallback(async (userId: string, userName: string) => {
    Alert.alert('Unlock User', `Unlock ${userName}'s account and reset device binding?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlock',
        onPress: async () => {
          try {
            setUnlockingUserId(userId);
            const res = await apiRequest('POST', '/api/admin/unlock-user', { userId });
            const data = await res.json();
            if (data.success) {
              Alert.alert('Success', `${userName} has been unlocked.`);
              fetchLockNotifications();
              await refreshData();
            } else {
              Alert.alert('Error', data.message || 'Failed to unlock user.');
            }
          } catch (e) {
            Alert.alert('Error', 'Failed to unlock user.');
          } finally {
            setUnlockingUserId(null);
          }
        }
      }
    ]);
  }, [fetchLockNotifications, refreshData]);

  const effectivePushPreviewImage = useMemo(() => {
    const u = notifImageUrl.trim();
    if (!u) return DEFAULT_PUSH_NOTIFICATION_IMAGE;
    if (/^https:\/\/.+\.(jpe?g|png)(\?.*)?$/i.test(u)) return u;
    return DEFAULT_PUSH_NOTIFICATION_IMAGE;
  }, [notifImageUrl]);

  const uploadAdminPushImage = useCallback(async (assetUri: string, mimeType?: string | null) => {
    const token = await getSessionToken();
    const baseUrl = getApiUrl();
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(assetUri)).blob();
      const name = blob.type === 'image/png' ? 'push.png' : 'push.jpg';
      form.append('image', blob, name);
    } else {
      const mime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      form.append('image', { uri: assetUri, name: `push.${ext}`, type: mime } as any);
    }
    const res = await fetch(`${baseUrl}/api/admin/upload-push-image`, {
      method: 'POST',
      headers: {
        ...(token ? { 'x-session-token': token, Authorization: `Bearer ${token}` } : {}),
      },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.url) {
      throw new Error(data.message || `Upload failed (${res.status})`);
    }
    return String(data.url);
  }, []);

  const pickPushNotificationImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission', 'Photo library access is needed to attach an image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.85,
        base64: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setNotifImageUploading(true);
      const a = result.assets[0];
      const url = await uploadAdminPushImage(a.uri, (a as { mimeType?: string }).mimeType);
      setNotifImageUrl(url);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload image (JPG/PNG, max 1MB).');
    } finally {
      setNotifImageUploading(false);
    }
  }, [uploadAdminPushImage]);

  const sendNotificationToAll = useCallback(async () => {
    if (!notifTitle.trim() || !notifBody.trim()) {
      Alert.alert('Error', 'Please enter both title and message.');
      return;
    }
    const img = notifImageUrl.trim();
    if (img && !/^https:\/\/.+\.(jpe?g|png)(\?.*)?$/i.test(img)) {
      Alert.alert('Invalid image URL', 'Use an HTTPS link ending in .jpg, .jpeg, or .png (or upload a file).');
      return;
    }
    try {
      setNotifSending(true);
      setNotifResult(null);
      const endpoint = notifTargetRole === 'all' ? '/api/admin/notify-all' : '/api/admin/notify-role';
      const payload: Record<string, unknown> = { title: notifTitle.trim(), body: notifBody.trim() };
      if (notifTargetRole !== 'all') payload.role = notifTargetRole;
      if (img) payload.image = img;
      const p = notifOpenPath.trim();
      if (p) payload.path = p;
      const res = await adminRequest('POST', endpoint, payload);
      const data = await res.json();
      if (data.success) {
        const roleLabel = notifTargetRole === 'all' ? 'all users' : `all ${notifTargetRole}s`;
        const idHint = data.oneSignalId ? ` · OS id ${String(data.oneSignalId).slice(0, 10)}…` : '';
        setNotifResult(`✅ Sent to ${data.sent} device${data.sent !== 1 ? 's' : ''} (${roleLabel})${idHint}`);
        setNotifTitle('');
        setNotifBody('');
        setNotifImageUrl('');
        setNotifOpenPath('/(tabs)');
        fetchBroadcastPushHistory();
      } else {
        setNotifResult(`❌ Failed: ${data.message || 'Unknown error'}`);
      }
    } catch (e) {
      setNotifResult('❌ Network error');
    } finally {
      setNotifSending(false);
    }
  }, [notifTitle, notifBody, notifImageUrl, notifOpenPath, notifTargetRole]);

  const sendSMS = useCallback(async () => {
    if (!smsBody.trim()) {
      Alert.alert('Error', 'Please enter a message.');
      return;
    }
    try {
      setSmsSending(true);
      setSmsResult(null);
      const payload: any = { message: smsBody.trim() };
      if (smsTargetRole !== 'all') payload.role = smsTargetRole;
      const res = await adminRequest('POST', '/api/admin/send-sms', payload);
      const data = await res.json();
      if (data.success) {
        const roleLabel = smsTargetRole === 'all' ? 'all users' : `all ${smsTargetRole}s`;
        setSmsResult(`✅ Sent ${data.sent}${data.failed ? `, failed ${data.failed}` : ''} (${roleLabel})`);
        setSmsBody('');
      } else {
        setSmsResult(`❌ Failed: ${data.message || 'Unknown error'}`);
      }
    } catch (e) {
      setSmsResult('❌ Network error');
    } finally {
      setSmsSending(false);
    }
  }, [smsBody, smsTargetRole]);

  const sendBulkEmail = useCallback(async (scheduled?: boolean) => {
    if (!emailSubject.trim()) {
      Alert.alert('Error', 'Please enter an email subject.');
      return;
    }
    if (!emailBody.trim()) {
      Alert.alert('Error', 'Please enter the email message.');
      return;
    }
    if (scheduled && (!emailScheduleDate.trim() || !emailScheduleTime.trim())) {
      Alert.alert('Error', 'Please enter both a date (YYYY-MM-DD) and time (HH:MM) to schedule.');
      return;
    }
    try {
      setEmailSending(true);
      setEmailResult(null);
      const payload: any = { subject: emailSubject.trim(), message: emailBody.trim(), role: emailTargetRole };
      if (scheduled && emailScheduleDate && emailScheduleTime) {
        const scheduledAt = new Date(`${emailScheduleDate}T${emailScheduleTime}:00`).getTime();
        if (isNaN(scheduledAt) || scheduledAt < Date.now()) {
          Alert.alert('Error', 'Scheduled time must be in the future.');
          setEmailSending(false);
          return;
        }
        payload.scheduledAt = scheduledAt;
      }
      const res = await apiRequest('POST', '/api/admin/send-email', payload);
      const data = await res.json();
      if (data.success) {
        if (data.scheduled) {
          setEmailResult(`✅ Scheduled! Campaign will send to ${data.total} users on ${new Date(payload.scheduledAt).toLocaleString()}`);
        } else {
          setEmailResult(`✅ Sending to ${data.total} users in batches (Campaign ID: ${data.campaignId})`);
        }
        setEmailSubject('');
        setEmailBody('');
        setEmailScheduleDate('');
        setEmailScheduleTime('');
        setTimeout(() => fetchEmailStats(), 2000);
      } else {
        setEmailResult(`❌ Failed: ${data.message || 'Unknown error'}`);
      }
    } catch (e) {
      setEmailResult('❌ Network error');
    } finally {
      setEmailSending(false);
    }
  }, [emailSubject, emailBody, emailTargetRole, emailScheduleDate, emailScheduleTime, fetchEmailStats]);

  const deleteAdminLeadCb = useCallback(async (id: string) => {
    Alert.alert('Delete Lead', 'Remove this lead and all its claims?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const r = await apiRequest('DELETE', `/api/leads/${id}`);
          const data = await r.json();
          if (data.success) setAdminLeadsList(prev => prev.filter(l => l.id !== id));
          else Alert.alert('Error', data.message || 'Failed to delete');
        } catch { Alert.alert('Error', 'Failed to delete lead'); }
      }},
    ]);
  }, []);

  const saveLeadPrice = useCallback(async () => {
    const p = parseInt(adminLeadPriceInput);
    if (!p || p < 1) { Alert.alert('Invalid Price', 'Enter a valid price (minimum ₹1)'); return; }
    setAdminLeadPriceSaving(true);
    try {
      const r = await apiRequest('POST', '/api/admin/leads/price', { price: p, phone: profile?.phone });
      const data = await r.json();
      if (data.success) {
        setAdminLeadPrice(data.price);
        setAdminLeadPriceInput(String(data.price));
        Alert.alert('Saved', `Lead price set to ₹${data.price}`);
      } else { Alert.alert('Error', data.message || 'Failed to save'); }
    } catch (e: any) { Alert.alert('Error', e?.message || 'Failed to save price'); }
    finally { setAdminLeadPriceSaving(false); }
  }, [adminLeadPriceInput, profile?.phone]);

  const createAdminLead = useCallback(async () => {
    if (!addLeadForm.title.trim()) { Alert.alert('Required', 'Lead title is required'); return; }
    setAddLeadSaving(true);
    try {
      const payload = { ...addLeadForm, phone: profile?.phone };
      const r = await apiRequest('POST', '/api/admin/leads/create', payload);
      const data = await r.json();
      if (data.success) {
        setAdminLeadsList(prev => [{ ...data.lead, purchasedBy: [], claims: [] }, ...prev]);
        setShowAddLeadModal(false);
        setAddLeadForm({ title: '', description: '', category: 'repair', location: '', contactNumber: '', customerName: '', price: '' });
      } else { Alert.alert('Error', data.message || 'Failed to create'); }
    } catch (e: any) { Alert.alert('Error', e?.message || 'Failed to create lead'); }
    finally { setAddLeadSaving(false); }
  }, [addLeadForm, profile?.phone]);

  const importCsvLeads = useCallback(async () => {
    if (!csvText.trim()) { Alert.alert('Empty', 'Paste CSV content first'); return; }
    setCsvImporting(true);
    setCsvResult(null);
    try {
      const lines = csvText.trim().split('\n').filter(l => l.trim());
      // Auto-detect header row
      const firstLine = lines[0].toLowerCase();
      const hasHeader = firstLine.includes('title') || firstLine.includes('contact') || firstLine.includes('name');
      const dataLines = hasHeader ? lines.slice(1) : lines;
      const rows = dataLines.map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        return {
          title: cols[0] || '',
          customerName: cols[1] || '',
          contactNumber: cols[2] || '',
          location: cols[3] || '',
          category: cols[4] || 'repair',
          description: cols[5] || '',
          price: cols[6] || '',
        };
      }).filter(r => r.title);
      if (rows.length === 0) { Alert.alert('No data', 'No valid rows found. Check your CSV format.'); return; }
      const r = await apiRequest('POST', '/api/admin/leads/batch-create', { rows, phone: profile?.phone });
      const data = await r.json();
      if (data.success) {
        setCsvResult({ count: data.count });
        setAdminLeadsList(prev => [...(data.leads || []).map((l: any) => ({ ...l, purchasedBy: [], claims: [] })), ...prev]);
        setCsvText('');
      } else { Alert.alert('Error', data.message || 'Import failed'); }
    } catch (e: any) { Alert.alert('Error', e?.message || 'Import failed'); }
    finally { setCsvImporting(false); }
  }, [csvText, profile?.phone]);

  if (!isAdmin) return null;

  const renderPayouts = () => {
    const pending = payoutsData.filter(p => p.status === 'pending');
    const completed = payoutsData.filter(p => p.status !== 'pending');
    const formatINR = (v: number) => `₹${Math.round((v || 0) / 100).toLocaleString('en-IN')}`;
    const renderCard = (p: any) => (
      <View key={p.id} style={{ backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ color: C.text, fontFamily: 'Inter_700Bold', fontSize: 15 }}>{p.teacherName || 'Unknown Teacher'}</Text>
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: p.status === 'paid' ? '#34C75920' : p.status === 'rejected' ? '#FF3B3020' : '#FFD60A20' }}>
            <Text style={{ color: p.status === 'paid' ? '#34C759' : p.status === 'rejected' ? '#FF3B30' : '#FFD60A', fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' }}>{p.status}</Text>
          </View>
        </View>
        <Text style={{ color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 2 }}>Amount: <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold' }}>{formatINR(Math.round((p.amount || 0) / 100))}</Text></Text>
        {p.upiId ? <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 2 }}>UPI: {p.upiId}</Text> : null}
        {p.bankDetails ? <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 2 }}>Bank: {p.bankDetails}</Text> : null}
        {p.notes ? <Text style={{ color: C.textTertiary, fontSize: 12, fontStyle: 'italic', marginBottom: 4 }}>Note: {p.notes}</Text> : null}
        {p.adminNotes ? <Text style={{ color: C.textTertiary, fontSize: 12, marginBottom: 4 }}>Admin notes: {p.adminNotes}</Text> : null}
        <Text style={{ color: C.textTertiary, fontSize: 11, marginBottom: 8 }}>Requested: {new Date(p.requestedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        {p.status === 'pending' && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              style={{ flex: 1, backgroundColor: '#34C759', borderRadius: 10, paddingVertical: 9, alignItems: 'center' }}
              disabled={payoutsUpdating === p.id}
              onPress={() => Alert.alert('Mark Paid', `Mark ₹${Math.round((p.amount || 0) / 100).toLocaleString('en-IN')} as paid to ${p.teacherName}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Mark Paid', onPress: () => updatePayout(p.id, 'paid', p.adminNotes || '') },
              ])}
            >
              {payoutsUpdating === p.id
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={{ color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 13 }}>Mark Paid</Text>}
            </Pressable>
            <Pressable
              style={{ flex: 1, backgroundColor: '#FF3B3020', borderRadius: 10, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: '#FF3B3040' }}
              disabled={payoutsUpdating === p.id}
              onPress={() => Alert.prompt
                ? Alert.prompt('Reject Payout', 'Enter reason (optional)', (note) => updatePayout(p.id, 'rejected', note || ''))
                : updatePayout(p.id, 'rejected', '')}
            >
              <Text style={{ color: '#FF3B30', fontFamily: 'Inter_700Bold', fontSize: 13 }}>Reject</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={payoutsLoading} onRefresh={fetchPayouts} tintColor={C.textTertiary} />}>
        {payoutsLoading && payoutsData.length === 0 ? (
          <ActivityIndicator color={C.textTertiary} style={{ marginTop: 40 }} />
        ) : payoutsData.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cash-outline" size={36} color={C.textTertiary} />
            <Text style={styles.emptyText}>No payout requests yet</Text>
          </View>
        ) : (
          <>
            {pending.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { paddingHorizontal: 0, marginBottom: 8 }]}>Pending ({pending.length})</Text>
                {pending.map(renderCard)}
              </>
            )}
            {completed.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { paddingHorizontal: 0, marginBottom: 8, marginTop: 12 }]}>Completed ({completed.length})</Text>
                {completed.map(renderCard)}
              </>
            )}
          </>
        )}
      </ScrollView>
    );
  };

  const tabs: { key: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: 'grid' },
    { key: 'users', label: 'Users', icon: 'people' },
    { key: 'bookings', label: 'Bookings', icon: 'calendar' },
    { key: 'subscriptions', label: 'Subs', icon: 'card' },
    { key: 'protection-plans', label: 'Plans', icon: 'shield-checkmark' },
    { key: 'protection-claims', label: 'Claims', icon: 'shield-half' },
    { key: 'revenue', label: 'Revenue', icon: 'trending-up' },
    { key: 'posts', label: 'Posts', icon: 'newspaper' },
    { key: 'jobs', label: 'Jobs', icon: 'briefcase' },
    { key: 'ads', label: 'Ads & Shop', icon: 'megaphone' },
    { key: 'listings', label: 'Listings', icon: 'cube' },
    { key: 'reels', label: 'Reels', icon: 'film' },
    { key: 'links', label: 'Links', icon: 'link' },
    { key: 'notifications', label: 'Notify', icon: 'notifications' },
  ];

  const renderReels = () => {
    const filtered = adminReels.filter(r =>
      !reelsSearch || [r.title, r.userName, r.description].filter(Boolean).join(' ').toLowerCase().includes(reelsSearch.toLowerCase())
    );
    const visible = filtered.slice(0, 10);
    return (
      <View style={{ flex: 1 }}>
        <View style={{ padding: 16, paddingBottom: 8 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 4 }}>All Reels</Text>
          <Text style={{ fontSize: 13, color: C.textSecondary, marginBottom: 12 }}>Manage community reels. Delete inappropriate content.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.border }}>
            <Ionicons name="search" size={16} color={C.textTertiary} />
            <TextInput
              style={{ flex: 1, color: C.text, fontSize: 14 }}
              placeholder="Search reels..."
              placeholderTextColor={C.textTertiary}
              value={reelsSearch}
              onChangeText={setReelsSearch}
            />
          </View>
        </View>
        {reelsLoading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : reelsError ? (
          <View style={{ alignItems: 'center', padding: 40 }}>
            <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold' }}>{reelsError}</Text>
          </View>
        ) : (
          <FlatList
            data={visible}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
            refreshControl={<RefreshControl refreshing={reelsLoading} onRefresh={fetchAdminReels} tintColor={C.primary} />}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                <Ionicons name="film-outline" size={48} color={C.textTertiary} />
                <Text style={{ color: C.textTertiary, marginTop: 12, fontFamily: 'Inter_500Medium' }}>No reels found</Text>
              </View>
            }
            renderItem={({ item }) => {
              const rawVideoUrl = safeVideoUri(item.videoUrl);
              const thumbUri = item.thumbnailUrl
                ? safeImageUri(item.thumbnailUrl)
                : (rawVideoUrl.includes('b-cdn.net') ? `https://vz-610561.b-cdn.net/${rawVideoUrl.match(/b-cdn\.net\/([a-f0-9-]{36})\//)?.[1] || ''}/thumbnail.jpg` : '');
              return (
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: C.surface, borderRadius: 14, marginBottom: 10,
                  overflow: 'hidden', borderWidth: 1, borderColor: C.border,
                }}>
                  {thumbUri ? (
                    <Image source={{ uri: thumbUri }} style={{ width: 70, height: 100 }} contentFit="cover" />
                  ) : (
                    <View style={{ width: 70, height: 100, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="videocam" size={22} color="rgba(255,255,255,0.4)" />
                    </View>
                  )}
                  <View style={{ flex: 1, padding: 12 }}>
                    <Text style={{ color: C.text, fontFamily: 'Inter_700Bold', fontSize: 14 }} numberOfLines={1}>
                      {item.title || 'Untitled Reel'}
                    </Text>
                    <Text style={{ color: C.textSecondary, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {item.userName}
                    </Text>
                    {rawVideoUrl ? (
                      <Pressable
                        onPress={() => router.push({ pathname: '/reels', params: { reelId: String(item.id) } } as any)}
                        style={{
                          marginTop: 8,
                          alignSelf: 'flex-start',
                          backgroundColor: C.primary,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 10,
                        }}
                      >
                        <Text style={{ color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 12 }}>Open full-screen</Text>
                      </Pressable>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Ionicons name="eye-outline" size={13} color={C.textTertiary} />
                        <Text style={{ color: C.textTertiary, fontSize: 12 }}>{item.views || 0}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Ionicons name="heart-outline" size={13} color={C.textTertiary} />
                        <Text style={{ color: C.textTertiary, fontSize: 12 }}>{(item.likes || []).length}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Ionicons name="chatbubble-outline" size={13} color={C.textTertiary} />
                        <Text style={{ color: C.textTertiary, fontSize: 12 }}>{(item.comments || []).length}</Text>
                      </View>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => deleteAdminReel(item.id, item.title || 'Untitled Reel')}
                    style={{ padding: 14 }}
                  >
                    <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                  </Pressable>
                </View>
              );
            }}
          />
        )}
      </View>
    );
  };

  const renderInsurance = () => {
    const ORANGE = '#E8704A';
    const CARD_BG = '#FFF';
    const inputStyle = {
      borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
      color: '#1A1A1A', backgroundColor: CARD_BG, marginTop: 6,
    };
    const labelStyle = { fontSize: 13, fontWeight: '600' as const, color: '#555', marginTop: 12 };
    const sectionStyle = {
      backgroundColor: CARD_BG, borderRadius: 14, padding: 16, marginBottom: 16,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
    };
    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#1A1A1A', marginBottom: 6 }}>Insurance Settings</Text>
        <Text style={{ fontSize: 14, color: '#888', marginBottom: 16 }}>Changes here instantly affect prices across the app and in Razorpay checkout.</Text>

        {insuranceLoading ? (
          <ActivityIndicator size="large" color={ORANGE} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Plan Info */}
            <View style={sectionStyle}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A1A', marginBottom: 4 }}>Plan Details</Text>
              <Text style={labelStyle}>Plan Name</Text>
              <TextInput
                style={inputStyle}
                value={insurancePlanName}
                onChangeText={setInsurancePlanName}
                placeholder="Mobile Protection Plan"
              />
              <Text style={labelStyle}>Monthly Price (₹)</Text>
              <TextInput
                style={inputStyle}
                value={insurancePlanPrice}
                onChangeText={setInsurancePlanPrice}
                keyboardType="numeric"
                placeholder="50"
              />
              <Text style={{ fontSize: 12, color: '#999', marginTop: 4 }}>Razorpay will charge ₹{insurancePlanPrice || '0'} (this value × 100 paise)</Text>
              <Text style={labelStyle}>Repair Discount (₹)</Text>
              <TextInput
                style={inputStyle}
                value={insuranceDiscount}
                onChangeText={setInsuranceDiscount}
                keyboardType="numeric"
                placeholder="500"
              />
            </View>

            {/* Plan Status */}
            <View style={sectionStyle}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A1A', marginBottom: 12 }}>Plan Status</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {(['active', 'disabled'] as const).map(s => (
                  <Pressable
                    key={s}
                    onPress={() => setInsuranceStatus(s)}
                    style={{
                      flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
                      backgroundColor: insuranceStatus === s ? (s === 'active' ? '#34C75920' : '#FF3B3020') : '#F5F5F5',
                      borderWidth: 2,
                      borderColor: insuranceStatus === s ? (s === 'active' ? '#34C759' : '#FF3B30') : 'transparent',
                    }}
                  >
                    <Ionicons
                      name={s === 'active' ? 'checkmark-circle' : 'close-circle'}
                      size={20}
                      color={s === 'active' ? '#34C759' : '#FF3B30'}
                    />
                    <Text style={{ marginTop: 4, fontWeight: '600', fontSize: 13, color: s === 'active' ? '#34C759' : '#FF3B30', textTransform: 'capitalize' }}>
                      {s === 'active' ? 'Active' : 'Disabled'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {insuranceStatus === 'disabled' && (
                <View style={{ backgroundColor: '#FFF3CD', borderRadius: 8, padding: 10, marginTop: 10 }}>
                  <Text style={{ fontSize: 13, color: '#856404' }}>
                    ⚠️ Disabling the plan will hide the protection plan banner and page from customers.
                  </Text>
                </View>
              )}
            </View>

            {/* Preview */}
            <View style={[sectionStyle, { backgroundColor: ORANGE + '10', borderWidth: 1, borderColor: ORANGE + '40' }]}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: ORANGE, marginBottom: 8 }}>Live Preview</Text>
              <Text style={{ fontSize: 13, color: '#555' }}>Banner text:</Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginTop: 2 }}>
                "{insurancePlanName} — Just ₹{insurancePlanPrice}/month + ₹{insuranceDiscount} off on repairs"
              </Text>
              <Text style={{ fontSize: 13, color: '#555', marginTop: 8 }}>Button text:</Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginTop: 2 }}>
                "Activate Plan — ₹{insurancePlanPrice}/mo"
              </Text>
              <Text style={{ fontSize: 13, color: '#555', marginTop: 8 }}>Razorpay amount:</Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginTop: 2 }}>
                {(parseInt(insurancePlanPrice || '0', 10) * 100).toLocaleString()} paise = ₹{insurancePlanPrice}
              </Text>
            </View>

            {/* Save */}
            <Pressable
              onPress={saveInsuranceSettings}
              disabled={insuranceSaving}
              style={{
                backgroundColor: insuranceSaved ? '#34C759' : ORANGE,
                borderRadius: 12, paddingVertical: 14, alignItems: 'center',
                flexDirection: 'row', justifyContent: 'center', gap: 8,
              }}
            >
              {insuranceSaving ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name={insuranceSaved ? 'checkmark' : 'save-outline'} size={18} color="#FFF" />
                  <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>
                    {insuranceSaved ? 'Saved!' : 'Save Changes'}
                  </Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    );
  };

  const renderProPlan = () => {
    const ACCENT = '#E8704A';
    const inp = {
      borderWidth: 1, borderColor: C.border, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
      color: C.text, backgroundColor: C.surface, marginTop: 6,
      fontFamily: 'Inter_400Regular',
    } as const;
    const lbl = { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginTop: 14 } as const;
    const card = {
      backgroundColor: C.surfaceElevated, borderRadius: 14, padding: 16, marginBottom: 14,
      borderWidth: 1, borderColor: C.border,
    } as const;

    const addFeature = () => {
      const val = proPlanNewFeature.trim();
      if (val && !proPlanFeatures.includes(val)) {
        setProPlanFeatures([...proPlanFeatures, val]);
      }
      setProPlanNewFeature('');
    };
    const removeFeature = (f: string) => setProPlanFeatures(proPlanFeatures.filter(x => x !== f));

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 4 }}>Pro Plan Editor</Text>
        <Text style={{ fontSize: 13, color: C.textTertiary, fontFamily: 'Inter_400Regular', marginBottom: 16 }}>
          Edit the protection plan shown to customers on their home screen.
        </Text>

        {proPlanLoading ? (
          <ActivityIndicator size="large" color={ACCENT} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* ── Plan Identity ── */}
            <View style={card}>
              <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text }}>Plan Identity</Text>
              <Text style={lbl}>Plan Name</Text>
              <TextInput style={inp} value={proPlanName} onChangeText={setProPlanName} placeholder="Mobile Protection Plan" placeholderTextColor={C.textTertiary} />
              <Text style={lbl}>Heading / Tagline</Text>
              <TextInput style={inp} value={proPlanTagline} onChangeText={setProPlanTagline} placeholder="Protect Your Phone" placeholderTextColor={C.textTertiary} />
              <Text style={lbl}>Button Text</Text>
              <TextInput style={inp} value={proPlanButtonText} onChangeText={setProPlanButtonText} placeholder="Get Protection" placeholderTextColor={C.textTertiary} />
            </View>

            {/* ── Pricing ── */}
            <View style={card}>
              <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text }}>Pricing</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={lbl}>Monthly Price (₹)</Text>
                  <TextInput style={inp} value={proPlanMonthly} onChangeText={setProPlanMonthly} keyboardType="numeric" placeholder="249" placeholderTextColor={C.textTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={lbl}>Yearly Price (₹)</Text>
                  <TextInput style={inp} value={proPlanYearly} onChangeText={setProPlanYearly} keyboardType="numeric" placeholder="1299" placeholderTextColor={C.textTertiary} />
                </View>
              </View>
              <Text style={lbl}>Minimum Months (monthly plan)</Text>
              <TextInput style={inp} value={proPlanMinMonths} onChangeText={setProPlanMinMonths} keyboardType="numeric" placeholder="3" placeholderTextColor={C.textTertiary} />
              <Text style={lbl}>Savings Text</Text>
              <TextInput style={inp} value={proPlanSavingsText} onChangeText={setProPlanSavingsText} placeholder="Save up to ₹4000 on repairs" placeholderTextColor={C.textTertiary} />
            </View>

            {/* ── Feature Tags ── */}
            <View style={card}>
              <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text }}>Feature Tags</Text>
              <Text style={{ fontSize: 12, color: C.textTertiary, fontFamily: 'Inter_400Regular', marginTop: 4 }}>These appear as pill labels on the customer banner.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {proPlanFeatures.map(f => (
                  <View key={f} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: ACCENT + '15', borderRadius: 16, paddingLeft: 10, paddingRight: 4, paddingVertical: 5, borderWidth: 1, borderColor: ACCENT + '40' }}>
                    <Text style={{ fontSize: 12, color: ACCENT, fontFamily: 'Inter_600SemiBold', marginRight: 4 }}>{f}</Text>
                    <Pressable onPress={() => removeFeature(f)} hitSlop={8}>
                      <Ionicons name="close-circle" size={16} color={ACCENT} />
                    </Pressable>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <TextInput
                  style={[inp, { flex: 1, marginTop: 0 }]}
                  value={proPlanNewFeature}
                  onChangeText={setProPlanNewFeature}
                  placeholder="Add feature tag..."
                  placeholderTextColor={C.textTertiary}
                  onSubmitEditing={addFeature}
                  returnKeyType="done"
                />
                <Pressable onPress={addFeature} style={{ backgroundColor: ACCENT, borderRadius: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="add" size={20} color="#FFF" />
                </Pressable>
              </View>
            </View>

            {/* ── Status ── */}
            <View style={card}>
              <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 12 }}>Plan Status</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {(['active', 'disabled'] as const).map(s => (
                  <Pressable key={s} onPress={() => setProPlanStatus(s)}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
                      backgroundColor: proPlanStatus === s ? (s === 'active' ? '#34C75915' : '#FF3B3015') : C.surface,
                      borderWidth: 2, borderColor: proPlanStatus === s ? (s === 'active' ? '#34C759' : '#FF3B30') : C.border }}>
                    <Ionicons name={s === 'active' ? 'checkmark-circle' : 'close-circle'} size={22} color={s === 'active' ? '#34C759' : '#FF3B30'} />
                    <Text style={{ marginTop: 4, fontFamily: 'Inter_600SemiBold', fontSize: 13, color: s === 'active' ? '#34C759' : '#FF3B30', textTransform: 'capitalize' }}>
                      {s === 'active' ? 'Active' : 'Disabled'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {proPlanStatus === 'disabled' && (
                <View style={{ backgroundColor: '#FFF3CD', borderRadius: 8, padding: 10, marginTop: 10 }}>
                  <Text style={{ fontSize: 13, color: '#856404', fontFamily: 'Inter_400Regular' }}>
                    ⚠️ Disabling hides the protection plan banner from customers.
                  </Text>
                </View>
              )}
            </View>

            {/* ── Live Preview ── */}
            <View style={{ backgroundColor: ACCENT, borderRadius: 16, padding: 16, marginBottom: 16, overflow: 'hidden' }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.8)', marginBottom: 8 }}>LIVE PREVIEW — Customer Home Banner</Text>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 6 }}>
                <Text style={{ fontSize: 11, color: '#FFF', fontFamily: 'Inter_600SemiBold' }}>{proPlanName}</Text>
              </View>
              <Text style={{ fontSize: 17, fontFamily: 'Inter_700Bold', color: '#FFF', marginBottom: 4 }}>{proPlanTagline}</Text>
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', fontFamily: 'Inter_400Regular', marginBottom: 8 }}>
                ₹{proPlanMonthly}/month ({proPlanMinMonths}-month min) or ₹{proPlanYearly}/year{'\n'}{proPlanSavingsText}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {proPlanFeatures.map((f, i) => (
                  <View key={i} style={{ backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 11, color: '#FFF', fontFamily: 'Inter_500Medium' }}>{f}</Text>
                  </View>
                ))}
              </View>
              <View style={{ backgroundColor: '#FFF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7, alignSelf: 'flex-start' }}>
                <Text style={{ fontSize: 12, color: ACCENT, fontFamily: 'Inter_700Bold' }}>{proPlanButtonText}</Text>
              </View>
            </View>

            {/* ── Save ── */}
            <Pressable onPress={saveProPlanSettings} disabled={proPlanSaving}
              style={{ backgroundColor: proPlanSaved ? '#34C759' : ACCENT, borderRadius: 12, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
              {proPlanSaving ? <ActivityIndicator color="#FFF" size="small" /> : (
                <>
                  <Ionicons name={proPlanSaved ? 'checkmark' : 'save-outline'} size={18} color="#FFF" />
                  <Text style={{ color: '#FFF', fontSize: 16, fontFamily: 'Inter_700Bold' }}>{proPlanSaved ? 'Saved!' : 'Save Changes'}</Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    );
  };

  const renderProtectionPlans = () => {
    const PRIMARY = '#FF6B2C';
    const PLAN_FILTERS = ['all', 'pending_verification', 'approved_pending_payment', 'active', 'rejected'];
    const statusLabel: Record<string, string> = {
      all: 'All', pending_verification: 'Pending', approved_pending_payment: 'Approved',
      active: 'Active', rejected: 'Rejected',
    };
    const statusColor: Record<string, string> = {
      pending_verification: '#F59E0B', approved_pending_payment: '#4A90D9',
      active: '#27AE60', rejected: '#E53E3E',
    };
    const cardStyle = {
      backgroundColor: C.surfaceElevated, borderRadius: 14, padding: 14,
      marginBottom: 10, borderWidth: 1, borderColor: C.border,
    };
    const filteredPlans = protectionPlansList.filter(plan => {
      const statusMatch = protectionPlanFilter === 'all' || plan.status === protectionPlanFilter;
      const searchLower = protectionPlanSearchQuery.toLowerCase();
      const searchMatch = !searchLower ||
        (plan.userName && plan.userName.toLowerCase().includes(searchLower)) ||
        (plan.userPhone && plan.userPhone.includes(searchLower)) ||
        (plan.userEmail && plan.userEmail.toLowerCase().includes(searchLower)) ||
        (plan.brand && plan.brand.toLowerCase().includes(searchLower)) ||
        (plan.model && plan.model.toLowerCase().includes(searchLower)) ||
        (plan.imei && plan.imei.includes(searchLower));
      return statusMatch && searchMatch;
    });
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={protectionPlansLoading} onRefresh={fetchProtectionPlans} tintColor={PRIMARY} />}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 14 }}>Mobile Protection Plans</Text>
        <TextInput
          placeholder="Search by name, phone, email, brand, model, or IMEI..."
          placeholderTextColor={C.textSecondary}
          value={protectionPlanSearchQuery}
          onChangeText={setProtectionPlanSearchQuery}
          style={{ backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
            color: C.text, fontSize: 14, marginBottom: 14, borderWidth: 1, borderColor: C.border }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {PLAN_FILTERS.map(f => (
              <TouchableOpacity key={f}
                style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5,
                  borderColor: protectionPlanFilter === f ? PRIMARY : C.border,
                  backgroundColor: protectionPlanFilter === f ? '#FFF3ED' : C.surface }}
                onPress={() => setProtectionPlanFilter(f)}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: protectionPlanFilter === f ? PRIMARY : C.textSecondary }}>
                  {statusLabel[f]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        {protectionPlansLoading ? <ActivityIndicator color={PRIMARY} style={{ marginTop: 40 }} /> :
          filteredPlans.length === 0 ? (
            <View style={cardStyle}><Text style={{ color: C.textSecondary, textAlign: 'center', padding: 20 }}>No plans found</Text></View>
          ) : (
            filteredPlans.map(plan => {
              const devicesArr: any[] = (() => {
                try {
                  if (!plan.devices) return [];
                  return typeof plan.devices === 'string' ? JSON.parse(plan.devices) : plan.devices;
                } catch { return []; }
              })();
              const primaryDevice = devicesArr.length > 0 ? devicesArr[0] : null;
              const deviceName = primaryDevice
                ? `${primaryDevice.brand} ${primaryDevice.model}`
                : plan.brand ? `${plan.brand} ${plan.model}` : 'Device';
              return (
                <View key={plan.id} style={cardStyle}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <Text style={{ color: C.text, fontWeight: '700', fontSize: 16 }}>{deviceName}</Text>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: `${statusColor[plan.status] || '#999'}20` }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: statusColor[plan.status] || '#999' }}>
                        {statusLabel[plan.status] || plan.status}
                      </Text>
                    </View>
                  </View>
                  <View style={{ backgroundColor: '#F8F8F8', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                    <Text style={{ color: C.text, fontWeight: '600', fontSize: 13, marginBottom: 8 }}>Customer Details</Text>
                    <Text style={{ color: C.text, fontSize: 13, marginBottom: 6 }}><Text style={{ fontWeight: '600' }}>Name: </Text>{plan.userName || 'N/A'}</Text>
                    <Text style={{ color: C.text, fontSize: 13, marginBottom: 6 }}><Text style={{ fontWeight: '600' }}>Mobile: </Text>{plan.userPhone || 'N/A'}</Text>
                    <Text style={{ color: C.text, fontSize: 13 }}><Text style={{ fontWeight: '600' }}>Email: </Text>{plan.userEmail || 'N/A'}</Text>
                  </View>
                  {primaryDevice ? (
                    <>
                      <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 2 }}>IMEI: {primaryDevice.imei || 'N/A'}</Text>
                      <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 2 }}>Model No: {primaryDevice.modelNumber || 'N/A'}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 2 }}>IMEI: {plan.imei || 'N/A'}</Text>
                      <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 2 }}>Model No: {plan.modelNumber || 'N/A'}</Text>
                    </>
                  )}
                  <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 2 }}>Plan: {plan.planType === 'yearly' ? 'Yearly ₹1499' : 'Monthly ₹447'} | Claim: {plan.claimUsed ? 'Used' : 'Available'}</Text>
                  <Text style={{ color: C.textSecondary, fontSize: 11, marginBottom: 12 }}>{new Date(plan.createdAt).toLocaleString('en-IN')}</Text>
                  {/* Device images */}
                  <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border }}>
                    <Text style={{ color: C.text, fontWeight: '600', fontSize: 12, marginBottom: 8 }}>
                      {primaryDevice ? 'Device 1 Images:' : 'Device Images:'}
                    </Text>
                    {(() => {
                      const front = primaryDevice ? primaryDevice.frontImage : plan.frontImage;
                      const back = primaryDevice ? primaryDevice.backImage : plan.backImage;
                      if (!front && !back) return (
                        <View style={{ padding: 12, backgroundColor: C.surface, borderRadius: 8, alignItems: 'center' }}>
                          <Text style={{ color: C.textSecondary, fontSize: 12 }}>📸 No images uploaded</Text>
                        </View>
                      );
                      return (
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {front ? (
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: C.textSecondary, fontSize: 11, marginBottom: 4 }}>Front</Text>
                              <Image source={{ uri: front }} style={{ width: '100%', height: 100, borderRadius: 8, backgroundColor: '#F0F0F0' }} contentFit="cover" />
                            </View>
                          ) : (
                            <View style={{ flex: 1, height: 100, backgroundColor: C.surface, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: C.textSecondary, fontSize: 11 }}>No front image</Text>
                            </View>
                          )}
                          {back ? (
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: C.textSecondary, fontSize: 11, marginBottom: 4 }}>Back</Text>
                              <Image source={{ uri: back }} style={{ width: '100%', height: 100, borderRadius: 8, backgroundColor: '#F0F0F0' }} contentFit="cover" />
                            </View>
                          ) : (
                            <View style={{ flex: 1, height: 100, backgroundColor: C.surface, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: C.textSecondary, fontSize: 11 }}>No back image</Text>
                            </View>
                          )}
                        </View>
                      );
                    })()}
                  </View>
                  {/* Additional devices */}
                  {devicesArr.length > 1 && (
                    <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border }}>
                      <Text style={{ color: C.text, fontWeight: '600', fontSize: 12, marginBottom: 8 }}>Additional Devices ({devicesArr.length - 1}):</Text>
                      {devicesArr.slice(1).map((device: any, idx: number) => (
                        <View key={idx} style={{ backgroundColor: '#F8F8F8', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                          <Text style={{ color: C.text, fontWeight: '600', fontSize: 12, marginBottom: 4 }}>Device {idx + 2}</Text>
                          <Text style={{ color: C.textSecondary, fontSize: 12 }}>Brand: {device.brand || '—'}</Text>
                          <Text style={{ color: C.textSecondary, fontSize: 12 }}>Model: {device.model || '—'}</Text>
                          <Text style={{ color: C.textSecondary, fontSize: 12 }}>IMEI: {device.imei || '—'}</Text>
                          {(device.frontImage || device.backImage) && (
                            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                              {device.frontImage ? <View style={{ flex: 1 }}>
                                <Text style={{ color: C.textSecondary, fontSize: 10, marginBottom: 2 }}>Front</Text>
                                <Image source={{ uri: device.frontImage }} style={{ width: '100%', height: 60, borderRadius: 6, backgroundColor: '#F0F0F0' }} contentFit="cover" />
                              </View> : null}
                              {device.backImage ? <View style={{ flex: 1 }}>
                                <Text style={{ color: C.textSecondary, fontSize: 10, marginBottom: 2 }}>Back</Text>
                                <Image source={{ uri: device.backImage }} style={{ width: '100%', height: 60, borderRadius: 6, backgroundColor: '#F0F0F0' }} contentFit="cover" />
                              </View> : null}
                            </View>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                  {plan.status === 'pending_verification' && (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                      <TouchableOpacity
                        style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: '#E8F5ED', alignItems: 'center', justifyContent: 'center', minHeight: 40 }}
                        onPress={() => {
                          if (Platform.OS === 'web') {
                            // @ts-ignore
                            const confirmed = window.confirm('Approve this Mobile Protection Plan application?');
                            if (confirmed) handleProtectionPlanAction(plan.id, 'approve');
                          } else {
                            Alert.alert('Approve Plan', 'Approve this Mobile Protection Plan application?', [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Approve', onPress: () => handleProtectionPlanAction(plan.id, 'approve') },
                            ]);
                          }
                        }}
                        activeOpacity={0.7}>
                        <Text style={{ color: '#27AE60', fontWeight: '700', fontSize: 13 }}>✓ Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: '#FFEEEE', alignItems: 'center', justifyContent: 'center', minHeight: 40 }}
                        onPress={() => {
                          if (Platform.OS === 'web') {
                            // @ts-ignore
                            const reason = window.prompt('Enter reason for rejection:', 'Does not meet eligibility criteria');
                            if (reason !== null) handleProtectionPlanAction(plan.id, 'reject', reason);
                          } else {
                            Alert.alert('Reject Plan', 'This plan will be rejected. Are you sure?', [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Reject', style: 'destructive', onPress: () => handleProtectionPlanAction(plan.id, 'reject', 'Does not meet eligibility criteria') },
                            ]);
                          }
                        }}
                        activeOpacity={0.7}>
                        <Text style={{ color: '#E53E3E', fontWeight: '700', fontSize: 13 }}>✗ Reject</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )
        }
      </ScrollView>
    );
  };

  const renderProtectionClaims = () => {
    const PRIMARY = '#FF6B2C';
    const CLAIM_FILTERS = ['all', 'claim_pending', 'under_review', 'approved', 'assigned', 'completed', 'rejected'];
    const statusLabel: Record<string, string> = {
      all: 'All', claim_pending: 'Pending', under_review: 'Under Review',
      approved: 'Approved', assigned: 'Assigned', completed: 'Completed', rejected: 'Rejected',
    };
    const statusColor: Record<string, string> = {
      claim_pending: '#F59E0B', under_review: '#4A90D9', approved: '#27AE60',
      assigned: '#FF6B2C', completed: '#27AE60', rejected: '#E53E3E',
    };
    const cardStyle = {
      backgroundColor: C.surfaceElevated, borderRadius: 14, padding: 14,
      marginBottom: 10, borderWidth: 1, borderColor: C.border,
    };
    const filtered = protectionClaimsList.filter(c =>
      protectionClaimFilter === 'all' || c.status === protectionClaimFilter
    );
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={protectionClaimsLoading} onRefresh={fetchProtectionClaims} tintColor={PRIMARY} />}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 14 }}>Protection Plan Claims</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {CLAIM_FILTERS.map(f => (
              <TouchableOpacity key={f}
                style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5,
                  borderColor: protectionClaimFilter === f ? PRIMARY : C.border,
                  backgroundColor: protectionClaimFilter === f ? '#FFF3ED' : C.surface }}
                onPress={() => setProtectionClaimFilter(f)}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: protectionClaimFilter === f ? PRIMARY : C.textSecondary }}>
                  {statusLabel[f]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        {protectionClaimsLoading ? <ActivityIndicator color={PRIMARY} style={{ marginTop: 40 }} /> :
          filtered.length === 0 ? (
            <View style={cardStyle}><Text style={{ color: C.textSecondary, textAlign: 'center', padding: 20 }}>No claims found</Text></View>
          ) : (
            filtered.map(claim => (
              <View key={claim.id} style={cardStyle}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>{claim.issue}</Text>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: `${statusColor[claim.status] || '#999'}20` }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: statusColor[claim.status] || '#999' }}>
                      {statusLabel[claim.status] || claim.status}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 2 }}>Device: {claim.model} ({claim.imei})</Text>
                <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 2 }}>Description: {claim.description || '—'}</Text>
                {claim.technicianName ? <Text style={{ color: C.textSecondary, fontSize: 12, marginBottom: 2 }}>Technician: {claim.technicianName}</Text> : null}
                <Text style={{ color: C.textSecondary, fontSize: 11, marginBottom: 8 }}>{new Date(claim.createdAt).toLocaleString('en-IN')}</Text>
                <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border }}>
                  <Text style={{ color: C.text, fontWeight: '600', fontSize: 12, marginBottom: 8 }}>Damage Image:</Text>
                  {claim.damageImage ? (
                    <Image source={{ uri: claim.damageImage }} style={{ width: '100%', height: 120, borderRadius: 8, backgroundColor: '#F0F0F0' }} contentFit="cover" />
                  ) : (
                    <View style={{ width: '100%', height: 80, backgroundColor: C.surface, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: C.textSecondary, fontSize: 12 }}>📸 No damage image uploaded</Text>
                    </View>
                  )}
                </View>
                {claim.status === 'claim_pending' && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <TouchableOpacity
                      style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: '#EBF4FF', alignItems: 'center', justifyContent: 'center', minHeight: 40 }}
                      onPress={() => handleProtectionClaimAction(claim.id, 'under_review')}
                      activeOpacity={0.7}>
                      <Text style={{ color: '#4A90D9', fontWeight: '700', fontSize: 12 }}>Under Review</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: '#FFEEEE', alignItems: 'center', justifyContent: 'center', minHeight: 40 }}
                      onPress={() => handleProtectionClaimAction(claim.id, 'reject', { rejectionReason: 'Claim not eligible' })}
                      activeOpacity={0.7}>
                      <Text style={{ color: '#E53E3E', fontWeight: '700', fontSize: 12 }}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {claim.status === 'under_review' && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <TouchableOpacity
                      style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: '#E8F5ED', alignItems: 'center', justifyContent: 'center', minHeight: 40 }}
                      onPress={() => handleProtectionClaimAction(claim.id, 'approve')}
                      activeOpacity={0.7}>
                      <Text style={{ color: '#27AE60', fontWeight: '700', fontSize: 12 }}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: '#FFEEEE', alignItems: 'center', justifyContent: 'center', minHeight: 40 }}
                      onPress={() => handleProtectionClaimAction(claim.id, 'reject', { rejectionReason: 'Claim rejected after review' })}
                      activeOpacity={0.7}>
                      <Text style={{ color: '#E53E3E', fontWeight: '700', fontSize: 12 }}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {claim.status === 'approved' && (
                  <TouchableOpacity
                    style={{ marginTop: 10, padding: 12, borderRadius: 8, backgroundColor: '#FFF3ED', alignItems: 'center', justifyContent: 'center', minHeight: 44 }}
                    onPress={() => {
                      if (Platform.OS === 'web') {
                        // @ts-ignore
                        const name = window.prompt('Enter technician name:', 'Technician Name');
                        if (name) handleProtectionClaimAction(claim.id, 'assign', { technicianName: name });
                      } else {
                        Alert.alert('Assign Technician', 'Enter technician name to assign:', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Assign', onPress: () => handleProtectionClaimAction(claim.id, 'assign', { technicianName: 'Default Technician' }) },
                        ]);
                      }
                    }}
                    activeOpacity={0.7}>
                    <Text style={{ color: PRIMARY, fontWeight: '700', fontSize: 13 }}>Assign Technician</Text>
                  </TouchableOpacity>
                )}
                {claim.status === 'assigned' && (
                  <TouchableOpacity
                    style={{ marginTop: 10, padding: 12, borderRadius: 8, backgroundColor: '#E8F5ED', alignItems: 'center', justifyContent: 'center', minHeight: 44 }}
                    onPress={() => handleProtectionClaimAction(claim.id, 'complete')}
                    activeOpacity={0.7}>
                    <Text style={{ color: '#27AE60', fontWeight: '700', fontSize: 13 }}>Mark Completed</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )
        }
      </ScrollView>
    );
  };

  const executeBlockUser = async (userId: string, userName: string, block: boolean) => {
    try {
      const res = await adminRequest('POST', '/api/admin/block-user', { userId, blocked: block });
      const data = await res.json();
      if (data.success) {
        Alert.alert('Success', `${userName} has been ${block ? 'blocked' : 'unblocked'}.`);
        await refreshData();
      } else {
        Alert.alert('Error', data.message || 'Failed to update user.');
      }
    } catch (e: any) {
      console.error('Block user error:', e);
      Alert.alert('Error', 'Failed to update user. Please try again.');
    }
  };

  const executeVerifyUser = async (userId: string, userName: string, verify: boolean) => {
    try {
      const res = await apiRequest('PATCH', `/api/profiles/${userId}/verify`, { verified: verify ? 1 : 0 });
      const data = await res.json();
      if (data.success) {
        await refreshData();
        Alert.alert('Success', `${userName} has been ${verify ? 'verified' : 'unverified'}.`);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to verify user.');
    }
  };

  const executeDeleteUser = async (userId: string, userName: string) => {
    try {
      const res = await adminRequest('POST', '/api/admin/delete-user', { userId });
      const data = await res.json();
      if (data.success) {
        await refreshData();
      } else {
        console.error('Delete user failed:', data.message);
      }
    } catch (e: any) {
      console.error('Delete user error:', e);
    }
  };

  const executeRevokeSubscription = async (userId: string, userName: string) => {
    try {
      const res = await adminRequest('POST', '/api/admin/revoke-subscription', { userId });
      const data = await res.json();
      if (data.success) {
        Alert.alert('Success', `${userName}'s subscription has been removed.`);
        await refreshData();
      } else {
        Alert.alert('Error', data.message || 'Failed to remove subscription.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to remove subscription.');
    }
  };

  const handleBlockUser = (userId: string, userName: string, block: boolean) => {
    Alert.alert(
      block ? 'Block User' : 'Unblock User',
      block
        ? `Block ${userName}? They won't be able to log in.`
        : `Unblock ${userName}? They will be able to log in again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: block ? 'Block' : 'Unblock',
          style: block ? 'destructive' : 'default',
          onPress: () => executeBlockUser(userId, userName, block),
        },
      ]
    );
  };

  const handleDeleteUser = (userId: string, userName: string) => {
    executeDeleteUser(userId, userName);
  };

  const handleDeletePost = (postId: string, userName: string) => {
    Alert.alert('Delete Post', `Delete post by ${userName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await adminDeleteRequest(`/api/admin/posts/${postId}`);
            if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
            await refreshData();
          } catch {
            Alert.alert('Error', 'Failed to delete post');
          }
        },
      },
    ]);
  };

  const downloadUsersCSV = () => {
    const url = `${getApiUrl()}/api/admin/export-users`;
    openLink(url, 'Export');
  };

  const renderDashboard = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.dashboardContent}>
      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { borderLeftColor: C.primary }]}>
          <Ionicons name="people" size={24} color={C.primary} />
          <Text style={styles.statNumber}>{stats.totalUsers}</Text>
          <Text style={styles.statLabel}>Total Users</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: '#34C759' }]}>
          <Ionicons name="person-add" size={24} color="#34C759" />
          <Text style={styles.statNumber}>{stats.registeredUsers}</Text>
          <Text style={styles.statLabel}>Registered</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: '#5E8BFF' }]}>
          <Ionicons name="newspaper" size={24} color="#5E8BFF" />
          <Text style={styles.statNumber}>{stats.totalPosts}</Text>
          <Text style={styles.statLabel}>Total Posts</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: '#FFD60A' }]}>
          <Ionicons name="briefcase" size={24} color="#FFD60A" />
          <Text style={styles.statNumber}>{stats.totalJobs}</Text>
          <Text style={styles.statLabel}>Job Listings</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: '#FF6B2C' }]}>
          <Ionicons name="chatbubbles" size={24} color="#FF6B2C" />
          <Text style={styles.statNumber}>{stats.totalChats}</Text>
          <Text style={styles.statLabel}>Conversations</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: '#FF3B30' }]}>
          <Ionicons name="heart" size={24} color="#FF3B30" />
          <Text style={styles.statNumber}>{stats.totalLikes}</Text>
          <Text style={styles.statLabel}>Total Likes</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Users by Role</Text>
        {(Object.entries(stats.roleBreakdown) as [UserRole, number][]).map(([role, count]) => (
          <View key={role} style={styles.roleRow}>
            <View style={styles.roleRowLeft}>
              <View style={[styles.roleDot, { backgroundColor: ROLE_COLORS[role] }]} />
              <Text style={styles.roleLabelText}>{ROLE_LABELS[role]}</Text>
            </View>
            <View style={styles.roleBarContainer}>
              <View style={[styles.roleBar, { width: `${Math.max((count / Math.max(stats.totalUsers, 1)) * 100, 8)}%`, backgroundColor: ROLE_COLORS[role] }]} />
            </View>
            <Text style={styles.roleCount}>{count}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Activity Summary</Text>
        <View style={styles.activityRow}>
          <Text style={styles.activityLabel}>Comments</Text>
          <Text style={styles.activityValue}>{stats.totalComments}</Text>
        </View>
        <View style={styles.activityRow}>
          <Text style={styles.activityLabel}>Avg Likes/Post</Text>
          <Text style={styles.activityValue}>{stats.totalPosts > 0 ? (stats.totalLikes / stats.totalPosts).toFixed(1) : '0'}</Text>
        </View>
        <View style={styles.activityRow}>
          <Text style={styles.activityLabel}>Most Active Role</Text>
          <Text style={styles.activityValue}>
            {ROLE_LABELS[Object.entries(stats.roleBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] as UserRole || 'technician']}
          </Text>
        </View>
      </View>
    </ScrollView>
  );

  const USER_ROLE_FILTERS: { key: 'all' | UserRole; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: '#007AFF' },
    { key: 'technician', label: 'Techs', color: '#34C759' },
    { key: 'teacher', label: 'Teachers', color: '#FFD60A' },
    { key: 'supplier', label: 'Suppliers', color: '#FF6B2C' },
    { key: 'job_provider', label: 'Jobs', color: '#5E8BFF' },
    { key: 'customer', label: 'Customers', color: '#FF2D55' },
  ];

  const renderUsers = () => (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: C.border }}>
          <Ionicons name="search" size={16} color={C.textTertiary} />
          <TextInput
            value={userSearchQuery}
            onChangeText={setUserSearchQuery}
            placeholder="Search by name, phone, city..."
            placeholderTextColor={C.textTertiary}
            style={{ flex: 1, color: C.text, paddingVertical: 10, paddingHorizontal: 8, fontFamily: 'Inter_400Regular', fontSize: 14 }}
            clearButtonMode="while-editing"
          />
          {userSearchQuery.length > 0 && (
            <Pressable onPress={() => setUserSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={C.textTertiary} />
            </Pressable>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingBottom: 2 }}>
          {USER_ROLE_FILTERS.map(f => {
            const active = userRoleFilter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setUserRoleFilter(f.key)}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: active ? f.color : C.surface, borderWidth: 1, borderColor: active ? f.color : C.border }}
              >
                <Text style={{ color: active ? '#fff' : C.textTertiary, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
            {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
            {userRoleFilter !== 'all' ? ` · ${USER_ROLE_FILTERS.find(f => f.key === userRoleFilter)?.label}` : ''}
            {userSearchQuery ? ` · "${userSearchQuery}"` : ''}
          </Text>
          <Pressable
            onPress={downloadUsersCSV}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1C3A57', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#2A5080' }}
          >
            <Ionicons name="download-outline" size={14} color="#5E8BFF" />
            <Text style={{ color: '#5E8BFF', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>Download All ({allUsers.length})</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        data={filteredUsers}
        keyExtractor={(item, index) => item.id || `user-row-${index}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === 'web' ? 34 : 40, paddingHorizontal: 12 }}
        renderItem={({ item }) => <UserDetailCard user={item} onBlock={handleBlockUser} onVerify={executeVerifyUser} onDelete={handleDeleteUser} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{userSearchQuery || userRoleFilter !== 'all' ? 'No users match your search' : 'No users found'}</Text>
          </View>
        }
      />
    </View>
  );

  const renderRevenue = () => {
    const rd = revenueData;
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, paddingTop: 4 }}>
        {revenueLoading && !rd ? (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <Text style={styles.emptyText}>Loading revenue data...</Text>
          </View>
        ) : rd ? (
          <>
            <View style={styles.statsGrid}>
              <View style={[styles.statCard, { borderLeftColor: '#34C759', width: '100%' }]}>
                <Ionicons name="trending-up" size={24} color="#34C759" />
                <Text style={styles.statNumber}>₹{rd.totalRevenue?.toLocaleString('en-IN', { maximumFractionDigits: 0 }) || '0'}</Text>
                <Text style={styles.statLabel}>Total Platform Revenue</Text>
              </View>
              <View style={[styles.statCard, { borderLeftColor: '#5E8BFF' }]}>
                <Ionicons name="card" size={22} color="#5E8BFF" />
                <Text style={styles.statNumber}>₹{rd.subscriptionRevenue?.toLocaleString('en-IN', { maximumFractionDigits: 0 }) || '0'}</Text>
                <Text style={styles.statLabel}>Subscription Revenue</Text>
              </View>
              <View style={[styles.statCard, { borderLeftColor: '#FFD60A' }]}>
                <Ionicons name="school" size={22} color="#FFD60A" />
                <Text style={styles.statNumber}>₹{rd.platformCourseRevenue?.toLocaleString('en-IN', { maximumFractionDigits: 0 }) || '0'}</Text>
                <Text style={styles.statLabel}>Course Commission ({rd.commissionPercent || 30}%)</Text>
              </View>
              <View style={[styles.statCard, { borderLeftColor: '#FF6B2C' }]}>
                <Ionicons name="people" size={22} color="#FF6B2C" />
                <Text style={styles.statNumber}>{rd.activeSubscribers || 0}</Text>
                <Text style={styles.statLabel}>Active Subscribers</Text>
              </View>
              <View style={[styles.statCard, { borderLeftColor: '#FF2D55' }]}>
                <Ionicons name="play-circle" size={22} color="#FF2D55" />
                <Text style={styles.statNumber}>{rd.totalEnrollments || 0}</Text>
                <Text style={styles.statLabel}>Paid Enrollments</Text>
              </View>
              <View style={[styles.statCard, { borderLeftColor: '#34C759' }]}>
                <Ionicons name="gift" size={22} color="#34C759" />
                <Text style={styles.statNumber}>{rd.freeEnrollments || 0}</Text>
                <Text style={styles.statLabel}>Free Enrollments</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Subscription Revenue by Role</Text>
              {[
                { role: 'technician', label: 'Technicians', color: '#34C759' },
                { role: 'teacher', label: 'Teachers', color: '#FFD60A' },
                { role: 'supplier', label: 'Suppliers', color: '#FF6B2C' },
              ].map(({ role, label, color }) => {
                const count = rd.activeSubscribersByRole?.[role] || 0;
                const rev = rd.subscriptionRevenueByRole?.[role] || 0;
                return (
                  <View key={role} style={styles.activityRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                      <Text style={styles.activityLabel}>{label} ({count} active)</Text>
                    </View>
                    <Text style={[styles.activityValue, { color }]}>₹{rev.toLocaleString('en-IN')}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Course Stats</Text>
              <View style={styles.activityRow}>
                <Text style={styles.activityLabel}>Total Courses</Text>
                <Text style={styles.activityValue}>{rd.courseCount || 0}</Text>
              </View>
              <View style={styles.activityRow}>
                <Text style={styles.activityLabel}>Published Courses</Text>
                <Text style={styles.activityValue}>{rd.publishedCourses || 0}</Text>
              </View>
              <View style={styles.activityRow}>
                <Text style={styles.activityLabel}>Total Course Revenue</Text>
                <Text style={styles.activityValue}>₹{rd.courseRevenue?.toLocaleString('en-IN', { maximumFractionDigits: 0 }) || '0'}</Text>
              </View>
              <View style={[styles.activityRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.activityLabel}>Total Payments</Text>
                <Text style={styles.activityValue}>{rd.totalPayments || 0}</Text>
              </View>
            </View>

            {rd.teacherRevenue?.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Top Teacher Earnings</Text>
                {rd.teacherRevenue.map((t: any, i: number) => (
                  <View key={t.teacherId} style={[styles.activityRow, i === rd.teacherRevenue.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityLabel}>{t.name || 'Unknown Teacher'}</Text>
                      <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
                        {t.enrollments} enrollments · {t.courseCount} courses
                      </Text>
                    </View>
                    <Text style={[styles.activityValue, { color: '#FFD60A' }]}>₹{t.amount?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
                Active Subscribers List → go to Subs tab
              </Text>
            </View>
          </>
        ) : (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <Text style={styles.emptyText}>No revenue data available</Text>
          </View>
        )}
      </ScrollView>
    );
  };

  const renderSubscriptions = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.subHeading}>Control subscription settings for each role</Text>
      {(['technician', 'teacher', 'supplier', 'shopkeeper'] as const).map(role => {
        const sub = subscriptions.find(s => s.role === role);
        const enabled = sub?.enabled === 1;
        const amount = sub?.amount || '0';
        const roleColor = ROLE_COLORS[role];
        return (
          <View key={role} style={[styles.subCard, { borderLeftColor: roleColor, borderLeftWidth: 3 }]}>
            <View style={styles.subCardHeader}>
              <View style={styles.subCardLeft}>
                <View style={[styles.subRoleIcon, { backgroundColor: roleColor + '20' }]}>
                  <Ionicons
                    name={role === 'technician' ? 'construct' : role === 'teacher' ? 'school' : 'cube'}
                    size={20}
                    color={roleColor}
                  />
                </View>
                <Text style={styles.subRoleName}>{ROLE_LABELS[role]}</Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={(val) => toggleSubscription(role, val)}
                trackColor={{ false: C.surfaceElevated, true: roleColor + '60' }}
                thumbColor={enabled ? roleColor : C.textTertiary}
              />
            </View>
            {enabled && role === 'teacher' && (
              <View style={styles.subAmountRow}>
                <Text style={styles.subAmountLabel}>Commission on Sales (%)</Text>
                <TextInput
                  style={styles.subAmountInput}
                  value={sub?.commissionPercent || '30'}
                  onChangeText={(val) => {
                    setSubscriptions(prev => prev.map(s => s.role === role ? { ...s, commissionPercent: val } : s));
                  }}
                  onBlur={() => {
                    const cp = sub?.commissionPercent || '30';
                    apiRequest('PATCH', `/api/subscription-settings/${role}`, { commissionPercent: cp }).catch(() => {});
                  }}
                  keyboardType="number-pad"
                  placeholder="30"
                  placeholderTextColor={C.textTertiary}
                />
              </View>
            )}
            {enabled && role !== 'teacher' && (
              <View style={styles.subAmountRow}>
                <Text style={styles.subAmountLabel}>Monthly Amount (₹)</Text>
                <TextInput
                  style={styles.subAmountInput}
                  value={amount}
                  onChangeText={(val) => {
                    setSubscriptions(prev => prev.map(s => s.role === role ? { ...s, amount: val } : s));
                  }}
                  onBlur={() => updateSubAmount(role, amount)}
                  keyboardType="number-pad"
                  placeholder={role === 'technician' ? '99' : '999'}
                  placeholderTextColor={C.textTertiary}
                />
              </View>
            )}
          </View>
        );
      })}

      <View style={[styles.subCard, { borderLeftColor: '#34C759', borderLeftWidth: 3, marginTop: 8 }]}>
        <View style={[styles.subCardHeader, { marginBottom: 12 }]}>
          <View style={styles.subCardLeft}>
            <View style={[styles.subRoleIcon, { backgroundColor: '#34C75920' }]}>
              <Ionicons name="checkmark-circle" size={20} color="#34C759" />
            </View>
            <View>
              <Text style={styles.subRoleName}>Active Subscribers</Text>
              <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
                {activeSubsLoading ? 'Loading...' : `${activeSubsList.length} active`}
              </Text>
            </View>
          </View>
        </View>
        {activeSubsList.length === 0 ? (
          <Text style={{ color: C.textTertiary, fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingVertical: 16 }}>
            {activeSubsLoading ? 'Loading...' : 'No active subscribers'}
          </Text>
        ) : (
          activeSubsList.map((sub, i) => {
            const roleColor = ROLE_COLORS[sub.role as UserRole] || C.textSecondary;
            const daysLeft = sub.subscriptionEnd ? Math.max(0, Math.ceil((sub.subscriptionEnd - Date.now()) / 86400000)) : 0;
            return (
              <View key={sub.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: i < activeSubsList.length - 1 ? 1 : 0, borderBottomColor: C.surfaceElevated }}>
                {sub.avatar ? (
                  <Image source={{ uri: sub.avatar }} style={{ width: 34, height: 34, borderRadius: 17 }} contentFit="cover" />
                ) : (
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: roleColor + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: roleColor, fontSize: 13, fontWeight: '700' }}>{getInitials(sub.name || '')}</Text>
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: C.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>{sub.name || 'Unknown'}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <View style={{ backgroundColor: roleColor + '20', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                      <Text style={{ color: roleColor, fontSize: 10, fontFamily: 'Inter_500Medium' }}>{ROLE_LABELS[sub.role as UserRole] || sub.role || 'member'}</Text>
                    </View>
                    {sub.city ? <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular' }}>{sub.city}</Text> : null}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: daysLeft <= 7 ? '#FF3B30' : '#34C759', fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
                    {daysLeft}d left
                  </Text>
                  <Text style={{ color: C.textTertiary, fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
                    {sub.phone}
                  </Text>
                  <Pressable
                    hitSlop={10}
                    onPress={() => executeRevokeSubscription(sub.id, sub.name)}
                    style={{ marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#FF3B3014' }}
                  >
                    <Text style={{ color: '#FF3B30', fontSize: 10, fontFamily: 'Inter_600SemiBold' }}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );

  const renderPosts = () => (
    <FlatList
      data={posts}
      keyExtractor={item => item.id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: Platform.OS === 'web' ? 34 : 40 }}
      renderItem={({ item }) => (
        <View style={styles.postCard}>
          <View style={styles.postHeader}>
            <View style={styles.postHeaderLeft}>
              <Text style={styles.postAuthor}>{item.userName}</Text>
              <Text style={styles.postTime}>{timeAgo(item.createdAt)}</Text>
            </View>
            <Pressable
              hitSlop={12}
              onPress={() => handleDeletePost(item.id, item.userName)}
            >
              <Ionicons name="trash-outline" size={18} color="#FF3B30" />
            </Pressable>
          </View>
          <Text style={styles.postText} numberOfLines={2}>{item.text || ''}</Text>
          {Array.isArray(item.images) && item.images.length > 0 && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {item.images.slice(0, 3).map((img: string, idx: number) => (
                <Image key={idx} source={{ uri: normalizeMediaUri(img) }} style={{ width: 70, height: 70, borderRadius: 10, backgroundColor: C.surfaceElevated }} contentFit="cover" />
              ))}
            </View>
          )}
          <View style={styles.postStats}>
            <View style={styles.postStatItem}>
              <Ionicons name="heart" size={14} color="#FF3B30" />
              <Text style={styles.postStatText}>{Array.isArray(item.likes) ? item.likes.length : 0}</Text>
            </View>
            <View style={styles.postStatItem}>
              <Ionicons name="chatbubble" size={14} color="#5E8BFF" />
              <Text style={styles.postStatText}>{Array.isArray(item.comments) ? item.comments.length : 0}</Text>
            </View>
            <View style={[styles.categoryTag, { backgroundColor: C.surfaceElevated }]}>
              <Text style={styles.categoryTagText}>{item.category || 'general'}</Text>
            </View>
          </View>
        </View>
      )}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No posts yet</Text>
        </View>
      }
    />
  );


  const saveLink = async (key: string, value: string) => {
    try {
      await apiRequest('PUT', `/api/app-settings/${key}`, { value });
      let label = 'Link';
      if (key === 'live_url') {
        label = 'Mobi Live';
        refreshData();
      }
      else if (key === 'schematics_url') {
        label = 'Schematics';
        refreshData();
      }
      else if (key === 'web_tools_url') {
        label = 'Web Tools';
        refreshData();
      }
      else if (key === 'whatsapp_support_link') {
        label = 'WhatsApp Support';
        refreshData();
      }
      Alert.alert('Saved', `${label} link updated successfully`);
    } catch (err) {
      Alert.alert('Error', 'Failed to save link');
    }
  };

  const renderLinks = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, padding: 16 }}>
      <Text style={[styles.subHeading, { marginBottom: 16 }]}>Manage links that appear in the app header. Users can tap these to open the content inside the app.</Text>

      <View style={[styles.subCard, { borderLeftColor: '#FF3B30', borderLeftWidth: 3, marginBottom: 16 }]}>
        <View style={styles.subCardHeader}>
          <View style={styles.subCardLeft}>
            <View style={[styles.subRoleIcon, { backgroundColor: '#FF3B3020' }]}>
              <Ionicons name="radio" size={20} color="#FF3B30" />
            </View>
            <View>
              <Text style={styles.subRoleName}>Mobi Live Link</Text>
            </View>
          </View>
        </View>
        <Text style={[styles.emptyText, { fontSize: 12, marginTop: 4, marginBottom: 8, textAlign: 'left' }]}>
          This link opens inside the app when users tap the Mobi Live button. Use it for live streams, YouTube videos, etc.
        </Text>
        <TextInput
          style={[styles.subAmountInput, { fontSize: 14, marginBottom: 10 }]}
          placeholder="https://youtube.com/live/..."
          placeholderTextColor={C.textTertiary}
          value={liveUrl}
          onChangeText={setLiveUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Pressable
          style={[styles.tabItemActive, { paddingVertical: 10, borderRadius: 10, alignItems: 'center' }]}
          onPress={() => saveLink('live_url', liveUrl)}
        >
          <Text style={[styles.tabTextActive, { fontSize: 14 }]}>Save Mobi Live Link</Text>
        </Pressable>
        {liveUrl ? (
          <Pressable
            style={{ marginTop: 8, alignItems: 'center' }}
            onPress={() => { setLiveUrl(''); saveLink('live_url', ''); }}
          >
            <Text style={{ color: '#FF3B30', fontSize: 13, fontFamily: 'Inter_500Medium' }}>Remove Link</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.subCard, { borderLeftColor: '#FFD60A', borderLeftWidth: 3, marginBottom: 16 }]}>
        <View style={styles.subCardHeader}>
          <View style={styles.subCardLeft}>
            <View style={[styles.subRoleIcon, { backgroundColor: '#FFD60A20' }]}>
              <Ionicons name="document-text" size={20} color="#FFD60A" />
            </View>
            <Text style={styles.subRoleName}>Schematics Link</Text>
          </View>
        </View>
        <Text style={[styles.emptyText, { fontSize: 12, marginTop: 4, marginBottom: 8, textAlign: 'left' }]}>
          This link opens inside the app when users tap the Schematics button in the header.
        </Text>
        <TextInput
          style={[styles.subAmountInput, { fontSize: 14, marginBottom: 10 }]}
          placeholder="https://..."
          placeholderTextColor={C.textTertiary}
          value={schematicsUrl}
          onChangeText={setSchematicsUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Pressable
          style={[styles.tabItemActive, { paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#FFD60A' }]}
          onPress={() => saveLink('schematics_url', schematicsUrl)}
        >
          <Text style={[styles.tabTextActive, { fontSize: 14, color: '#000' }]}>Save Schematics Link</Text>
        </Pressable>
        {schematicsUrl ? (
          <Pressable
            style={{ marginTop: 8, alignItems: 'center' }}
            onPress={() => { setSchematicsUrl(''); saveLink('schematics_url', ''); }}
          >
            <Text style={{ color: '#FF3B30', fontSize: 13, fontFamily: 'Inter_500Medium' }}>Remove Link</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.subCard, { borderLeftColor: '#5E8BFF', borderLeftWidth: 3, marginBottom: 16 }]}>
        <View style={styles.subCardHeader}>
          <View style={styles.subCardLeft}>
            <View style={[styles.subRoleIcon, { backgroundColor: '#5E8BFF20' }]}>
              <Ionicons name="globe" size={20} color="#5E8BFF" />
            </View>
            <Text style={styles.subRoleName}>Web Tools Link</Text>
          </View>
        </View>
        <Text style={[styles.emptyText, { fontSize: 12, marginTop: 4, marginBottom: 8, textAlign: 'left' }]}>
          This link opens inside the app when users tap the Tools button. Use it for external tools, websites, etc.
        </Text>
        <TextInput
          style={[styles.subAmountInput, { fontSize: 14, marginBottom: 10 }]}
          placeholder="https://example.com/tools"
          placeholderTextColor={C.textTertiary}
          value={webToolsUrl}
          onChangeText={setWebToolsUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Pressable
          style={[styles.tabItemActive, { paddingVertical: 10, borderRadius: 10, alignItems: 'center' }]}
          onPress={() => saveLink('web_tools_url', webToolsUrl)}
        >
          <Text style={[styles.tabTextActive, { fontSize: 14 }]}>Save Web Tools Link</Text>
        </Pressable>
        {webToolsUrl ? (
          <Pressable
            style={{ marginTop: 8, alignItems: 'center' }}
            onPress={() => { setWebToolsUrl(''); saveLink('web_tools_url', ''); }}
          >
            <Text style={{ color: '#FF3B30', fontSize: 13, fontFamily: 'Inter_500Medium' }}>Remove Link</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.subCard, { borderLeftColor: '#25D366', borderLeftWidth: 3 }]}>
        <View style={styles.subCardHeader}>
          <View style={styles.subCardLeft}>
            <View style={[styles.subRoleIcon, { backgroundColor: '#25D36620' }]}>
              <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
            </View>
            <Text style={styles.subRoleName}>WhatsApp Support</Text>
          </View>
        </View>
        <Text style={[styles.emptyText, { fontSize: 12, marginTop: 4, marginBottom: 8, textAlign: 'left' }]}>
          This link opens WhatsApp when users tap the Contact Us button in Settings.
        </Text>
        <TextInput
          style={[styles.subAmountInput, { fontSize: 14, marginBottom: 10 }]}
          placeholder="https://wa.link/..."
          placeholderTextColor={C.textTertiary}
          value={whatsappSupportUrl}
          onChangeText={setWhatsappSupportUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Pressable
          style={[styles.tabItemActive, { paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#25D366' }]}
          onPress={() => saveLink('whatsapp_support_link', whatsappSupportUrl)}
        >
          <Text style={[styles.tabTextActive, { fontSize: 14 }]}>Save WhatsApp Link</Text>
        </Pressable>
        {whatsappSupportUrl ? (
          <Pressable
            style={{ marginTop: 8, alignItems: 'center' }}
            onPress={() => { setWhatsappSupportUrl(''); saveLink('whatsapp_support_link', ''); }}
          >
            <Text style={{ color: '#FF3B30', fontSize: 13, fontFamily: 'Inter_500Medium' }}>Remove Link</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );

  const saveDeviceSetting = async (key: string, value: string) => {
    try {
      await apiRequest('PUT', `/api/app-settings/${key}`, { value });
    } catch (err) {
      Alert.alert('Error', 'Failed to save setting');
    }
  };

  const toggleDeviceLock = async (enabled: boolean) => {
    setDeviceLockEnabled(enabled);
    await saveDeviceSetting('device_lock_enabled', enabled ? 'true' : 'false');
  };

  const resetUserDevice = (userId: string, userName: string) => {
    Alert.alert(
      'Reset Device',
      `Reset device lock for ${userName}? They will be able to login from any device again with 2 free changes.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: async () => {
          try {
            await apiRequest('POST', '/api/admin/reset-device', { userId });
            Alert.alert('Success', `Device reset for ${userName}`);
          } catch (err) {
            Alert.alert('Error', 'Failed to reset device');
          }
        }},
      ]
    );
  };

  const renderNotifications = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, padding: 16 }}>

      <View style={[styles.subCard, { borderLeftColor: '#007AFF', borderLeftWidth: 3, marginBottom: 16 }]}>
        <View style={styles.subCardHeader}>
          <View style={styles.subCardLeft}>
            <View style={[styles.subRoleIcon, { backgroundColor: '#007AFF20' }]}>
              <Ionicons name="stats-chart" size={20} color="#007AFF" />
            </View>
            <View>
              <Text style={styles.subRoleName}>Push Token Stats</Text>
              <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                Devices registered to receive notifications
              </Text>
            </View>
          </View>
          <Pressable onPress={fetchPushStats} style={{ padding: 6 }}>
            <Ionicons name="refresh" size={18} color="#007AFF" />
          </Pressable>
        </View>
        {pushStatsLoading ? (
          <ActivityIndicator size="small" color="#007AFF" style={{ marginTop: 8 }} />
        ) : pushStats ? (
          <>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1, alignItems: 'center', backgroundColor: C.surfaceElevated, borderRadius: 10, padding: 12 }}>
                <Text style={{ fontSize: 22, fontFamily: 'Inter_700Bold', color: '#34C759' }}>{pushStats.withToken}</Text>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textTertiary, marginTop: 2 }}>Registered</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', backgroundColor: C.surfaceElevated, borderRadius: 10, padding: 12 }}>
                <Text style={{ fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text }}>{pushStats.total}</Text>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textTertiary, marginTop: 2 }}>Total Users</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', backgroundColor: C.surfaceElevated, borderRadius: 10, padding: 12 }}>
                <Text style={{ fontSize: 22, fontFamily: 'Inter_700Bold', color: '#FF9F0A' }}>
                  {pushStats.total > 0 ? Math.round((pushStats.withToken / pushStats.total) * 100) : 0}%
                </Text>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textTertiary, marginTop: 2 }}>Coverage</Text>
              </View>
            </View>
            {pushStats.byRole && Object.keys(pushStats.byRole).length > 0 && (
              <View style={{ marginTop: 12, gap: 6 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textTertiary, marginBottom: 4 }}>BY ROLE</Text>
                {Object.entries(pushStats.byRole).map(([role, count]) => {
                  const opt = NOTIF_ROLE_OPTIONS.find(o => o.key === role);
                  return (
                    <View key={role} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: opt?.color || C.textTertiary }} />
                        <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSecondary }}>{opt?.label || role}</Text>
                      </View>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.text }}>{count}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        ) : (
          <Pressable onPress={fetchPushStats} style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: '#007AFF' }}>Tap refresh to load stats</Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.subCard, { borderLeftColor: '#FF6B35', borderLeftWidth: 3 }]}>
        <View style={styles.subCardLeft}>
          <View style={[styles.subRoleIcon, { backgroundColor: '#FF6B3520' }]}>
            <Ionicons name="megaphone" size={20} color="#FF6B35" />
          </View>
          <View>
            <Text style={styles.subRoleName}>Send Notification</Text>
            <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
              Target all users or a specific role
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 14, gap: 12 }}>
          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 8 }}>Target Audience</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {NOTIF_ROLE_OPTIONS.map(opt => (
                <Pressable
                  key={opt.key}
                  onPress={() => setNotifTargetRole(opt.key)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                    backgroundColor: notifTargetRole === opt.key ? opt.color : C.surfaceElevated,
                    borderWidth: 1, borderColor: notifTargetRole === opt.key ? opt.color : C.border,
                  }}
                >
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: notifTargetRole === opt.key ? '#FFF' : C.textSecondary }}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Notification Title</Text>
            <TextInput
              value={notifTitle}
              onChangeText={setNotifTitle}
              placeholder="e.g. New Feature Available!"
              placeholderTextColor={C.textTertiary}
              style={{
                backgroundColor: C.surfaceElevated,
                color: C.text,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                fontSize: 14,
                fontFamily: 'Inter_400Regular',
                borderWidth: 1,
                borderColor: C.border,
              }}
            />
          </View>
          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Message</Text>
            <TextInput
              value={notifBody}
              onChangeText={setNotifBody}
              placeholder="e.g. Check out the latest updates..."
              placeholderTextColor={C.textTertiary}
              multiline
              numberOfLines={4}
              style={{
                backgroundColor: C.surfaceElevated,
                color: C.text,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                fontSize: 14,
                fontFamily: 'Inter_400Regular',
                borderWidth: 1,
                borderColor: C.border,
                minHeight: 100,
                textAlignVertical: 'top',
              }}
            />
          </View>
          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>
              Image (optional)
            </Text>
            <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textTertiary, marginBottom: 8 }}>
              HTTPS JPG/PNG only, max 1MB upload. If empty, a default MOBI image is used for every send.
            </Text>
            <TextInput
              value={notifImageUrl}
              onChangeText={setNotifImageUrl}
              placeholder="https://…/image.jpg or upload below"
              placeholderTextColor={C.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                backgroundColor: C.surfaceElevated,
                color: C.text,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                fontSize: 14,
                fontFamily: 'Inter_400Regular',
                borderWidth: 1,
                borderColor: C.border,
                marginBottom: 10,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <Pressable
                onPress={pickPushNotificationImage}
                disabled={notifImageUploading || notifSending}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: C.surfaceElevated,
                  borderWidth: 1,
                  borderColor: C.border,
                  opacity: notifImageUploading ? 0.6 : 1,
                }}
              >
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text }}>
                  {notifImageUploading ? 'Uploading…' : 'Upload JPG/PNG'}
                </Text>
              </Pressable>
              {!!notifImageUrl.trim() && (
                <Pressable
                  onPress={() => setNotifImageUrl('')}
                  style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FF3B3020' }}
                >
                  <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FF3B30' }}>Clear image</Text>
                </Pressable>
              )}
            </View>
            <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Preview</Text>
            <View
              style={{
                borderRadius: 14,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: C.border,
                backgroundColor: '#0f172a',
                maxWidth: 420,
                alignSelf: 'flex-start',
              }}
            >
              <Image
                source={{ uri: effectivePushPreviewImage }}
                style={{ width: '100%', aspectRatio: 16 / 9, maxHeight: 200 }}
                contentFit="cover"
              />
              <View style={{ padding: 12, backgroundColor: C.surfaceElevated }}>
                <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text }} numberOfLines={1}>
                  {notifTitle.trim() || 'Notification title'}
                </Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSecondary, marginTop: 4 }} numberOfLines={3}>
                  {notifBody.trim() || 'Message body will appear here…'}
                </Text>
              </View>
            </View>
          </View>
          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>
              Open screen on tap (Android)
            </Text>
            <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textTertiary, marginBottom: 8 }}>
              Expo Router path, e.g. /(tabs), /directory, /reels. Server adds full HTTPS launch URL when EXPO_PUBLIC_DOMAIN or APP_DOMAIN is set on the API.
            </Text>
            <TextInput
              value={notifOpenPath}
              onChangeText={setNotifOpenPath}
              placeholder="/(tabs)"
              placeholderTextColor={C.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                backgroundColor: C.surfaceElevated,
                color: C.text,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                fontSize: 14,
                fontFamily: 'Inter_400Regular',
                borderWidth: 1,
                borderColor: C.border,
              }}
            />
          </View>
          {notifResult && (
            <Pressable
              onPress={() => setNotifResult(null)}
              style={{ backgroundColor: notifResult.startsWith('✅') ? '#34C75920' : '#FF3B3020', borderRadius: 8, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: notifResult.startsWith('✅') ? '#34C759' : '#FF3B30', flex: 1 }}>
                {notifResult}
              </Text>
              <Ionicons name="close" size={16} color={notifResult.startsWith('✅') ? '#34C759' : '#FF3B30'} />
            </Pressable>
          )}
          <Pressable
            onPress={sendNotificationToAll}
            disabled={notifSending}
            style={{
              backgroundColor: notifSending ? C.surfaceElevated : '#FF6B35',
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 8,
              marginTop: 4,
            }}
          >
            {notifSending ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="send" size={18} color="#FFF" />
            )}
            <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' }}>
              {notifSending ? 'Sending...' : notifTargetRole === 'all' ? 'Send to All Users' : `Send to ${NOTIF_ROLE_OPTIONS.find(o => o.key === notifTargetRole)?.label || notifTargetRole}`}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.subCard, { borderLeftColor: '#8E8E93', borderLeftWidth: 3, marginTop: 16 }]}>
        <View style={styles.subCardHeader}>
          <View style={styles.subCardLeft}>
            <View style={[styles.subRoleIcon, { backgroundColor: '#8E8E9320' }]}>
              <Ionicons name="time" size={20} color="#8E8E93" />
            </View>
            <View>
              <Text style={styles.subRoleName}>Broadcast history</Text>
              <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                Last 100 admin sends (stored on server)
              </Text>
            </View>
          </View>
          <Pressable onPress={fetchBroadcastPushHistory} style={{ padding: 6 }}>
            <Ionicons name="refresh" size={18} color="#8E8E93" />
          </Pressable>
        </View>
        {broadcastHistoryLoading ? (
          <ActivityIndicator size="small" color="#8E8E93" style={{ marginTop: 10 }} />
        ) : broadcastPushHistory.length === 0 ? (
          <Text style={{ fontSize: 13, color: C.textTertiary, marginTop: 10 }}>No entries yet.</Text>
        ) : (
          <View style={{ marginTop: 10, gap: 8 }}>
            {broadcastPushHistory.slice(0, 30).map((row: any) => (
              <View
                key={row.id}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  backgroundColor: C.surfaceElevated,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text }} numberOfLines={1}>
                  {row.title}
                </Text>
                <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }} numberOfLines={2}>
                  {row.body}
                </Text>
                <Text style={{ fontSize: 10, color: C.textTertiary, marginTop: 6 }}>
                  {row.error
                    ? `Error: ${row.error}`
                    : `Recipients: ${row.recipientCount ?? 0}${row.oneSignalId ? ` · ${String(row.oneSignalId).slice(0, 12)}…` : ''}`}
                  {row.openPath ? ` · ${row.openPath}` : ''}
                  {' · '}
                  {row.createdAt ? new Date(Number(row.createdAt)).toLocaleString() : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={[styles.subCard, { borderLeftColor: '#34C759', borderLeftWidth: 3, marginTop: 16 }]}>
        <View style={styles.subCardLeft}>
          <View style={[styles.subRoleIcon, { backgroundColor: '#34C75920' }]}>
            <Ionicons name="chatbubble-ellipses" size={20} color="#34C759" />
          </View>
          <View>
            <Text style={styles.subRoleName}>Send SMS</Text>
            <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
              Send SMS to users via Twilio
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 14, gap: 12 }}>
          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 8 }}>Target Audience</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {NOTIF_ROLE_OPTIONS.map(opt => (
                <Pressable
                  key={opt.key}
                  onPress={() => setSmsTargetRole(opt.key)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                    backgroundColor: smsTargetRole === opt.key ? opt.color : C.surfaceElevated,
                    borderWidth: 1, borderColor: smsTargetRole === opt.key ? opt.color : C.border,
                  }}
                >
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: smsTargetRole === opt.key ? '#FFF' : C.textSecondary }}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>SMS Message</Text>
            <TextInput
              value={smsBody}
              onChangeText={setSmsBody}
              placeholder="Type your SMS message..."
              placeholderTextColor={C.textTertiary}
              multiline
              numberOfLines={4}
              style={{
                backgroundColor: C.surfaceElevated,
                color: C.text,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                fontSize: 14,
                fontFamily: 'Inter_400Regular',
                borderWidth: 1,
                borderColor: C.border,
                minHeight: 100,
                textAlignVertical: 'top',
              }}
            />
          </View>
          {smsResult && (
            <View style={{ backgroundColor: smsResult.startsWith('✅') ? '#34C75920' : '#FF3B3020', borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: smsResult.startsWith('✅') ? '#34C759' : '#FF3B30' }}>
                {smsResult}
              </Text>
            </View>
          )}
          <Pressable
            onPress={sendSMS}
            disabled={smsSending}
            style={{
              backgroundColor: smsSending ? C.surfaceElevated : '#34C759',
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 8,
              marginTop: 4,
            }}
          >
            {smsSending ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="chatbubble-ellipses" size={18} color="#FFF" />
            )}
            <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' }}>
              {smsSending ? 'Sending SMS...' : smsTargetRole === 'all' ? 'Send SMS to All' : `Send SMS to ${NOTIF_ROLE_OPTIONS.find(o => o.key === smsTargetRole)?.label || smsTargetRole}`}
            </Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        onPress={() => setActiveTab('email')}
        style={[styles.subCard, { borderLeftColor: '#5E8BFF', borderLeftWidth: 3, marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
      >
        <View style={styles.subCardLeft}>
          <View style={[styles.subRoleIcon, { backgroundColor: '#5E8BFF20' }]}>
            <Ionicons name="mail" size={20} color="#5E8BFF" />
          </View>
          <View>
            <Text style={styles.subRoleName}>Email Marketing</Text>
            <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
              Campaigns, analytics, scheduling & more
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
      </Pressable>
    </ScrollView>
  );

  const EMAIL_TARGET_OPTIONS = [
    { key: 'all', label: 'All Users', color: '#FF6B35' },
    { key: 'paid', label: 'Paid Users', color: '#FFD60A' },
    { key: 'technician', label: 'Technicians', color: '#34C759' },
    { key: 'teacher', label: 'Teachers', color: '#AF52DE' },
    { key: 'supplier', label: 'Suppliers', color: '#FF9500' },
    { key: 'customer', label: 'Customers', color: '#5E8BFF' },
    { key: 'job_provider', label: 'Job Providers', color: '#FF2D55' },
  ];

  const CAMPAIGN_STATUS_COLOR: Record<string, string> = {
    sending: '#FFD60A',
    sent: '#34C759',
    scheduled: '#5E8BFF',
    pending: '#888',
    failed: '#FF3B30',
  };

  const renderEmail = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, padding: 16 }}>
      <Text style={[styles.subHeading, { marginBottom: 16 }]}>
        Full email marketing control — campaigns, targeting, scheduling, and analytics.
      </Text>

      {emailStatsLoading ? (
        <ActivityIndicator color="#5E8BFF" style={{ marginBottom: 16 }} />
      ) : emailStats ? (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'With Email', value: emailStats.totalWithEmail, color: '#5E8BFF' },
            { label: 'Subscribed', value: emailStats.subscribed, color: '#34C759' },
            { label: 'Unsubscribed', value: emailStats.unsubscribed, color: '#FF3B30' },
          ].map(stat => (
            <View key={stat.label} style={{ flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
              <Text style={{ fontSize: 22, fontFamily: 'Inter_700Bold', color: stat.color }}>{stat.value}</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSecondary, marginTop: 2 }}>{stat.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.subCard, { borderLeftColor: '#5E8BFF', borderLeftWidth: 3, marginBottom: 16 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
          <View style={[styles.subRoleIcon, { backgroundColor: '#5E8BFF20' }]}>
            <Ionicons name="create" size={20} color="#5E8BFF" />
          </View>
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.subRoleName}>Compose Campaign</Text>
            <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
              Sends in batches of 50 · 2s delay between batches
            </Text>
          </View>
        </View>

        <View style={{ gap: 12 }}>
          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 8 }}>Target Audience</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {EMAIL_TARGET_OPTIONS.map(opt => (
                <Pressable
                  key={opt.key}
                  onPress={() => setEmailTargetRole(opt.key)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                    backgroundColor: emailTargetRole === opt.key ? opt.color : C.surfaceElevated,
                    borderWidth: 1, borderColor: emailTargetRole === opt.key ? opt.color : C.border,
                  }}
                >
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: emailTargetRole === opt.key ? '#FFF' : C.textSecondary }}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Subject Line</Text>
            <TextInput
              value={emailSubject}
              onChangeText={setEmailSubject}
              placeholder="e.g. Exciting Update from Mobi!"
              placeholderTextColor={C.textTertiary}
              style={{ backgroundColor: C.surfaceElevated, color: C.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', borderWidth: 1, borderColor: C.border }}
            />
          </View>

          <View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Message Body</Text>
            <TextInput
              value={emailBody}
              onChangeText={setEmailBody}
              placeholder="Write your email message here..."
              placeholderTextColor={C.textTertiary}
              multiline
              numberOfLines={6}
              style={{ backgroundColor: C.surfaceElevated, color: C.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', borderWidth: 1, borderColor: C.border, minHeight: 130, textAlignVertical: 'top' }}
            />
          </View>

          <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 8 }}>
              <Ionicons name="time-outline" size={12} /> Schedule (optional)
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                value={emailScheduleDate}
                onChangeText={setEmailScheduleDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={C.textTertiary}
                style={{ flex: 1, backgroundColor: C.surfaceElevated, color: C.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, fontFamily: 'Inter_400Regular', borderWidth: 1, borderColor: C.border }}
              />
              <TextInput
                value={emailScheduleTime}
                onChangeText={setEmailScheduleTime}
                placeholder="HH:MM"
                placeholderTextColor={C.textTertiary}
                style={{ width: 90, backgroundColor: C.surfaceElevated, color: C.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, fontFamily: 'Inter_400Regular', borderWidth: 1, borderColor: C.border }}
              />
            </View>
            <Text style={{ fontSize: 11, color: C.textTertiary, fontFamily: 'Inter_400Regular', marginTop: 6 }}>
              Leave blank to send immediately
            </Text>
          </View>

          {emailResult && (
            <View style={{ backgroundColor: emailResult.startsWith('✅') ? '#34C75920' : '#FF3B3020', borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: emailResult.startsWith('✅') ? '#34C759' : '#FF3B30' }}>
                {emailResult}
              </Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => sendBulkEmail(false)}
              disabled={emailSending}
              style={{ flex: 1, backgroundColor: emailSending ? C.surfaceElevated : '#5E8BFF', borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
            >
              {emailSending ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="send" size={16} color="#FFF" />}
              <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' }}>
                {emailSending ? 'Sending...' : 'Send Now'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => sendBulkEmail(true)}
              disabled={emailSending}
              style={{ flex: 1, backgroundColor: emailSending ? C.surfaceElevated : '#FF9500', borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
            >
              <Ionicons name="time" size={16} color="#FFF" />
              <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' }}>Schedule</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={[styles.sectionTitle, { fontSize: 15 }]}>Campaign History</Text>
        <Pressable onPress={fetchEmailStats} style={{ padding: 6 }}>
          <Ionicons name="refresh" size={18} color={C.textSecondary} />
        </Pressable>
      </View>

      {emailCampaignList.length === 0 ? (
        <View style={{ alignItems: 'center', padding: 32 }}>
          <Ionicons name="mail-open-outline" size={40} color={C.textTertiary} />
          <Text style={{ color: C.textTertiary, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 8 }}>No campaigns yet</Text>
        </View>
      ) : (
        emailCampaignList.map((camp) => (
          <View key={camp.id} style={[styles.subCard, { marginBottom: 10, borderLeftColor: CAMPAIGN_STATUS_COLOR[camp.status] || '#888', borderLeftWidth: 3 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text }} numberOfLines={1}>{camp.subject}</Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSecondary, marginTop: 2 }} numberOfLines={2}>{camp.message}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <View style={{ backgroundColor: (CAMPAIGN_STATUS_COLOR[camp.status] || '#888') + '25', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 }}>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: CAMPAIGN_STATUS_COLOR[camp.status] || '#888', textTransform: 'capitalize' }}>{camp.status}</Text>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="people-outline" size={14} color={C.textTertiary} />
                <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSecondary }}>
                  {camp.targetRole === 'all' ? 'All Users' : camp.targetRole}
                </Text>
              </View>
              {camp.total > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="checkmark-circle-outline" size={14} color="#34C759" />
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSecondary }}>{camp.sent}/{camp.total}</Text>
                </View>
              )}
              {camp.failed > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="close-circle-outline" size={14} color="#FF3B30" />
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: '#FF3B30' }}>{camp.failed} failed</Text>
                </View>
              )}
              <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textTertiary, marginLeft: 'auto' }}>
                {camp.sentAt ? new Date(camp.sentAt).toLocaleDateString() : camp.scheduledAt ? `Sched: ${new Date(camp.scheduledAt).toLocaleDateString()}` : new Date(camp.createdAt).toLocaleDateString()}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );

  const renderLeads = () => {
    const catColors: Record<string, string> = {
      repair: '#4F46E5', phone: '#4F46E5', electrician: '#F59E0B', plumber: '#3B82F6', ac: '#06B6D4', appliance: '#8B5CF6', cctv: '#64748B', other: '#8B5CF6',
    };
    const LEAD_CATEGORIES = ['repair', 'electrician', 'plumber', 'ac', 'appliance', 'cctv', 'other'];
    return (
      <>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={adminLeadsLoading} onRefresh={fetchAdminLeads} tintColor={C.primary} />}
        >
          {!userLocation && !adminLeadsLoading && adminLeadsList.length > 0 ? (
            <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textTertiary, marginBottom: 10 }}>
              Location off: distances hidden. Open browser site settings and allow location for this site, then reopen this tab.
            </Text>
          ) : null}
          {/* Price Editor */}
          <View style={{ backgroundColor: C.surfaceElevated, borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: C.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, backgroundColor: C.surface, paddingHorizontal: 12 }}>
                <Text style={{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.textSecondary }}>₹</Text>
                <TextInput
                  value={adminLeadPriceInput}
                  onChangeText={setAdminLeadPriceInput}
                  keyboardType="number-pad"
                  style={{ flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text, paddingVertical: 10, paddingHorizontal: 6 }}
                  placeholder="50"
                  placeholderTextColor={C.textTertiary}
                />
              </View>
              <Pressable
                onPress={saveLeadPrice}
                disabled={adminLeadPriceSaving}
                style={{ backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, opacity: adminLeadPriceSaving ? 0.6 : 1 }}
              >
                {adminLeadPriceSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Save</Text>
                )}
              </Pressable>
            </View>
            <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textTertiary, marginTop: 6 }}>
              Current price: ₹{adminLeadPrice} · Technicians pay this to unlock a lead's contact
            </Text>
          </View>

          {/* Header row with Add Lead + CSV buttons */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Text style={[styles.subHeading, { margin: 0 }]}>
              Customer Leads ({adminLeadsList.length}){userLocation ? ' · nearest first' : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => { setCsvResult(null); setCsvText(''); setShowCsvModal(true); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1E40AF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 }}
              >
                <Ionicons name="document-text-outline" size={15} color="#fff" />
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>CSV</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowAddLeadModal(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>Add Lead</Text>
              </Pressable>
            </View>
          </View>

          {adminLeadsLoading && adminLeadsList.length === 0 ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
          ) : adminLeadsList.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="briefcase-outline" size={40} color={C.textTertiary} />
              <Text style={styles.emptyText}>No leads yet</Text>
            </View>
          ) : (
            sortedAdminLeads.map(lead => {
                const catColor = catColors[lead.category] || '#8B5CF6';
                const claimsCount = lead.claims?.length || 0;
                
                let distText = '';
                if (userLocation && lead.latitude && lead.longitude) {
                  const dist = haversineKm(userLocation.lat, userLocation.lng, parseFloat(lead.latitude), parseFloat(lead.longitude));
                  distText = dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(2)} km`;
                }

                return (
                  <View key={lead.id} style={{ backgroundColor: C.surfaceElevated, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: catColor + '20' }}>
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: catColor }}>
                              {lead.category?.charAt(0).toUpperCase() + lead.category?.slice(1)}
                            </Text>
                          </View>
                          <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: claimsCount > 0 ? '#34C75920' : '#FFD60A20' }}>
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: claimsCount > 0 ? '#34C759' : '#B8860B' }}>
                              {claimsCount} claim{claimsCount !== 1 ? 's' : ''}
                            </Text>
                          </View>
                          {!!distText && (
                            <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: '#007AFF15', flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              <Ionicons name="navigate-outline" size={10} color="#007AFF" />
                              <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: '#007AFF' }}>{distText}</Text>
                            </View>
                          )}
                        </View>
                      <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 4 }}>{lead.title}</Text>
                      {lead.description ? <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSecondary, marginBottom: 4 }} numberOfLines={2}>{lead.description}</Text> : null}
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textTertiary }}>
                        {lead.customerName || 'Customer'} · {lead.contactNumber || lead.contact_number || '—'} · {lead.location || 'No location'}
                      </Text>
                      {lead.latitude && lead.longitude ? (
                        <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textTertiary, marginTop: 2 }}>
                          Coords: {parseFloat(lead.latitude).toFixed(5)}, {parseFloat(lead.longitude).toFixed(5)}
                        </Text>
                      ) : null}
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textTertiary, marginTop: 2 }}>
                        {new Date(lead.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                      {claimsCount > 0 && (
                        <View style={{ marginTop: 8, gap: 4 }}>
                          {lead.claims.map((c: any) => (
                            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Ionicons name="checkmark-circle" size={13} color="#34C759" />
                              <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSecondary }}>
                                {c.technicianName || c.technicianId} · ₹{c.amountPaid}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                    <Pressable
                      onPress={() => deleteAdminLeadCb(lead.id)}
                      style={{ padding: 6, borderRadius: 8, backgroundColor: '#FF3B3015' }}
                    >
                      <Ionicons name="trash-outline" size={17} color="#FF3B30" />
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Add Lead Modal */}
        <Modal
          visible={showAddLeadModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowAddLeadModal(false)}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.background }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Text style={{ fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text }}>Add New Lead</Text>
              <Pressable onPress={() => setShowAddLeadModal(false)} style={{ padding: 6 }}>
                <Ionicons name="close" size={22} color={C.textSecondary} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
              <View>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Lead Title *</Text>
                <TextInput
                  value={addLeadForm.title}
                  onChangeText={v => setAddLeadForm(f => ({ ...f, title: v }))}
                  placeholder="e.g. iPhone Screen Repair — Mumbai"
                  placeholderTextColor={C.textTertiary}
                  style={{ borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, backgroundColor: C.surface }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Customer Name</Text>
                <TextInput
                  value={addLeadForm.customerName}
                  onChangeText={v => setAddLeadForm(f => ({ ...f, customerName: v }))}
                  placeholder="Customer name"
                  placeholderTextColor={C.textTertiary}
                  style={{ borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, backgroundColor: C.surface }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Contact Number</Text>
                <TextInput
                  value={addLeadForm.contactNumber}
                  onChangeText={v => setAddLeadForm(f => ({ ...f, contactNumber: v }))}
                  placeholder="10-digit phone number"
                  placeholderTextColor={C.textTertiary}
                  keyboardType="phone-pad"
                  style={{ borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, backgroundColor: C.surface }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Location / City</Text>
                <TextInput
                  value={addLeadForm.location}
                  onChangeText={v => setAddLeadForm(f => ({ ...f, location: v }))}
                  placeholder="e.g. Hyderabad, Telangana"
                  placeholderTextColor={C.textTertiary}
                  style={{ borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, backgroundColor: C.surface }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 8 }}>Category</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {LEAD_CATEGORIES.map(cat => (
                    <Pressable
                      key={cat}
                      onPress={() => setAddLeadForm(f => ({ ...f, category: cat }))}
                      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: addLeadForm.category === cat ? C.primary : C.border, backgroundColor: addLeadForm.category === cat ? C.primary + '15' : C.surface }}
                    >
                      <Text style={{ fontSize: 13, fontFamily: addLeadForm.category === cat ? 'Inter_600SemiBold' : 'Inter_400Regular', color: addLeadForm.category === cat ? C.primary : C.textSecondary }}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Description (optional)</Text>
                <TextInput
                  value={addLeadForm.description}
                  onChangeText={v => setAddLeadForm(f => ({ ...f, description: v }))}
                  placeholder="Any additional details about the job..."
                  placeholderTextColor={C.textTertiary}
                  multiline
                  numberOfLines={3}
                  style={{ borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, backgroundColor: C.surface, minHeight: 80, textAlignVertical: 'top' }}
                />
              </View>
              <View>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Lead Price (₹) <Text style={{ fontFamily: 'Inter_400Regular' }}>— leave blank for default (₹{adminLeadPrice})</Text></Text>
                <TextInput
                  value={addLeadForm.price}
                  onChangeText={v => setAddLeadForm(f => ({ ...f, price: v }))}
                  placeholder={`Default: ₹${adminLeadPrice}`}
                  placeholderTextColor={C.textTertiary}
                  keyboardType="number-pad"
                  style={{ borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, backgroundColor: C.surface }}
                />
              </View>
              <Pressable
                onPress={createAdminLead}
                disabled={addLeadSaving}
                style={{ backgroundColor: C.primary, borderRadius: 10, padding: 16, alignItems: 'center', opacity: addLeadSaving ? 0.6 : 1, marginTop: 8 }}
              >
                {addLeadSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' }}>Create Lead</Text>
                )}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>

        {/* CSV Import Modal */}
        <Modal
          visible={showCsvModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowCsvModal(false)}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.background }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Text style={{ fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text }}>Import Leads via CSV</Text>
              <Pressable onPress={() => setShowCsvModal(false)} style={{ padding: 6 }}>
                <Ionicons name="close" size={22} color={C.textSecondary} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
              {/* Format guide */}
              <View style={{ backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#BFDBFE' }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#1E40AF', marginBottom: 6 }}>CSV Format (comma-separated)</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: '#1E40AF', lineHeight: 18 }}>
                  Column order:{'\n'}
                  <Text style={{ fontFamily: 'Inter_600SemiBold' }}>title, customerName, contactNumber, location, category, description, price</Text>{'\n\n'}
                  Example:{'\n'}
                  Screen Broken — Hyd, Ravi Kumar, 9876543210, Hyderabad, repair, iPhone screen damage, 75{'\n'}
                  AC Not Cooling, Priya, 8123456789, Secunderabad, ac, Voltas 1.5T,,
                </Text>
              </View>

              <View>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSecondary, marginBottom: 6 }}>Paste CSV Content</Text>
                <TextInput
                  value={csvText}
                  onChangeText={setCsvText}
                  placeholder="Paste your CSV rows here, one lead per line..."
                  placeholderTextColor={C.textTertiary}
                  multiline
                  numberOfLines={10}
                  style={{ borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, backgroundColor: C.surface, minHeight: 180, textAlignVertical: 'top' }}
                />
              </View>

              {csvResult && (
                <View style={{ backgroundColor: '#F0FDF4', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#86EFAC', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
                  <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#16A34A' }}>{csvResult.count} leads imported successfully!</Text>
                </View>
              )}

              <View style={{ gap: 10 }}>
                <Pressable
                  onPress={importCsvLeads}
                  disabled={csvImporting || !csvText.trim()}
                  style={{ backgroundColor: '#1E40AF', borderRadius: 10, padding: 16, alignItems: 'center', opacity: (csvImporting || !csvText.trim()) ? 0.6 : 1 }}
                >
                  {csvImporting
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' }}>Import Leads</Text>
                  }
                </Pressable>
                {csvResult && (
                  <Pressable
                    onPress={() => setShowCsvModal(false)}
                    style={{ borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border }}
                  >
                    <Text style={{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text }}>Done</Text>
                  </Pressable>
                )}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={{ paddingTop: Platform.OS === 'web' ? 67 : 0, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
          <Pressable onPress={() => router.back()} style={{ marginRight: 12, padding: 4 }}>
            <Ionicons name="arrow-back" size={24} color={C.text} />
          </Pressable>
          <Text style={{ fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text, flex: 1 }}>Admin Panel</Text>
          <Pressable onPress={refreshData} style={{ padding: 4 }}>
            <Ionicons name="refresh-outline" size={20} color={C.textSecondary} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 6, paddingBottom: 10 }}>
          {([
            { key: 'dashboard', label: 'Dashboard', icon: 'grid-outline' },
            { key: 'users', label: 'Users', icon: 'people-outline' },
            { key: 'posts', label: 'Posts', icon: 'newspaper-outline' },
            { key: 'listings', label: 'Listings', icon: 'cube-outline' },
            { key: 'reels', label: 'Reels', icon: 'film-outline' },
            { key: 'bookings', label: 'Bookings', icon: 'construct-outline' },
            { key: 'subscriptions', label: 'Subscriptions', icon: 'card-outline' },
            { key: 'revenue', label: 'Revenue', icon: 'stats-chart-outline' },
            { key: 'notifications', label: 'Notifications', icon: 'notifications-outline' },
            { key: 'email', label: 'Email / SMS', icon: 'mail-outline' },
            { key: 'payouts', label: 'Payouts', icon: 'cash-outline' },
            { key: 'pro-plan', label: 'Pro Plan', icon: 'shield-half-outline' },
            { key: 'protection-plans', label: 'Protection', icon: 'shield-checkmark-outline' },
            { key: 'protection-claims', label: 'Claims', icon: 'document-text-outline' },
            { key: 'insurance', label: 'Insurance', icon: 'shield-outline' },
            { key: 'leads', label: 'Customer Leads', icon: 'briefcase-outline' },
            { key: 'ads', label: 'Ads', icon: 'megaphone-outline' },
            { key: 'links', label: 'Links', icon: 'link-outline' },
          ] as { key: AdminTab; label: string; icon: string }[]).map(tab => (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: activeTab === tab.key ? C.primary : C.surfaceElevated, borderWidth: 1, borderColor: activeTab === tab.key ? C.primary : C.border }}
            >
              <Ionicons name={tab.icon as any} size={13} color={activeTab === tab.key ? '#FFF' : C.textSecondary} />
              <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: activeTab === tab.key ? '#FFF' : C.textSecondary }}>{tab.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={{ flex: 1 }}>
        {activeTab === 'dashboard' ? renderDashboard()
        : activeTab === 'users' ? renderUsers()
        : activeTab === 'posts' ? renderPosts()
        : activeTab === 'listings' ? renderListings()
        : activeTab === 'reels' ? renderReels()
        : activeTab === 'bookings' ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {repairLoading ? (
              <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
            ) : repairBookings.length === 0 ? (
              <View style={{ alignItems: 'center', padding: 40 }}>
                <Ionicons name="construct-outline" size={40} color={C.textTertiary} />
                <Text style={{ color: C.textTertiary, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 8 }}>No bookings found</Text>
              </View>
            ) : repairBookings.filter(b => repairFilter === 'all' || b.status === repairFilter).map((b: any) => (
              <View key={b.id} style={{ backgroundColor: C.surfaceElevated, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Inter_700Bold', color: C.text, fontSize: 14 }}>{b.deviceModel || 'Device'}</Text>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: b.status === 'completed' ? '#34C75920' : b.status === 'assigned' ? '#007AFF20' : b.status === 'cancelled' ? '#FF3B3020' : '#FFD60A20' }}>
                    <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: b.status === 'completed' ? '#34C759' : b.status === 'assigned' ? '#007AFF' : b.status === 'cancelled' ? '#FF3B30' : '#B8860B' }}>{b.status}</Text>
                  </View>
                </View>
                <Text style={{ color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4 }}>{b.issue || ''}</Text>
                <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 }}>Customer: {b.userName || b.userId || 'Unknown'}</Text>
                {b.technicianName ? <Text style={{ color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular' }}>Technician: {b.technicianName}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {(['pending','assigned','completed','cancelled'] as const).map(s => (
                    <Pressable key={s} onPress={() => updateBookingStatus(b.id, s)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: b.status === s ? C.primary : C.surface, borderWidth: 1, borderColor: b.status === s ? C.primary : C.border }}>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: b.status === s ? '#FFF' : C.textSecondary }}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        )
        : activeTab === 'subscriptions' ? renderSubscriptions()
        : activeTab === 'revenue' ? renderRevenue()
        : activeTab === 'notifications' ? renderNotifications()
        : activeTab === 'email' ? renderEmail()
        : activeTab === 'payouts' ? renderPayouts()
        : activeTab === 'pro-plan' ? renderProPlan()
        : activeTab === 'protection-plans' ? renderProtectionPlans()
        : activeTab === 'protection-claims' ? renderProtectionClaims()
        : activeTab === 'insurance' ? renderInsurance()
        : activeTab === 'leads' ? renderLeads()
        : activeTab === 'ads' ? renderAds()
        : activeTab === 'links' ? renderLinks()
        : null}
      </View>
    </View>
  );

}

const styles = StyleSheet.create({
  userCard: {
    backgroundColor: C.surfaceElevated,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  userCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userCardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userAvatarImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.surfaceHighlight,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  userInfo: {
    flex: 1,
    gap: 3,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  userName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    flexShrink: 1,
  },
  registeredBadge: {
    backgroundColor: '#34C75915',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  registeredText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#34C759',
  },
  userMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  userRoleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  userRoleText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  userCityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  userCity: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textTertiary,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  phoneText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textTertiary,
  },
  userDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  detailLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.textSecondary,
    minWidth: 70,
  },
  detailValue: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.text,
    flex: 1,
    textAlign: 'right',
  },
  detailPostCount: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.textTertiary,
    marginTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textTertiary,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    paddingHorizontal: 16,
    marginBottom: 6,
    marginTop: 12,
  },
  subAmountInput: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    backgroundColor: C.surface,
    minWidth: 80,
    textAlign: 'right',
  },
  subAmountLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.textSecondary,
    flex: 1,
  },
  subAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 6,
  },
  tabItemActive: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabTextActive: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  subCard: {
    backgroundColor: C.surfaceElevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  subCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  subCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  subHeading: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    marginBottom: 10,
  },
  subRoleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subRoleName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: C.surfaceElevated,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    minWidth: 80,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: C.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: C.text,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dashboardContent: {
    paddingBottom: 40,
  },
  postCard: {
    backgroundColor: C.surfaceElevated,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  postHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  postAuthor: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  postTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textTertiary,
  },
  postText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  postStats: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  postStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  postStatText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textTertiary,
  },
  categoryTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: C.primaryMuted,
  },
  categoryTagText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
  activityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  activityLabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  activityValue: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  roleBarContainer: {
    height: 6,
    backgroundColor: C.borderLight,
    borderRadius: 3,
    flex: 1,
    overflow: 'hidden',
  },
  roleBar: {
    height: 6,
    borderRadius: 3,
  },
  roleCount: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    minWidth: 24,
    textAlign: 'right',
  },
  roleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  roleLabelText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
    flex: 1,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  roleRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 110,
  },
});
