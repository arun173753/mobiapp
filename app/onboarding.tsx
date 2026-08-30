import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView,
  Platform, Alert, ActivityIndicator, Modal, FlatList, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { fetch as expoFetch } from 'expo/fetch';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { openLink } from '@/lib/open-link';
import * as WebBrowser from 'expo-web-browser';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import {
  UserRole, ROLE_LABELS, SKILLS_LIST, INDIAN_STATES, UserProfile,
  SUPPLIER_SELL_TYPES, TEACHER_TEACH_TYPES, SHOPKEEPER_SELL_TYPES, isHospitalityOwnerRole,
} from '@/lib/types';
import { createVenueProfile, addMenuItem, addHotelRoom } from '@/lib/hospitality-api';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { getDeviceId } from '@/lib/device-fingerprint';
import { normalizeIndianMobileDigits } from '@shared/phone-normalize';

const C = Colors.light;

function sanitizePhoneInput(raw: string): string {
  return String(raw || '').replace(/\D/g, '').slice(0, 10);
}

function isValidIndianMobileInput(raw: string): boolean {
  return normalizeIndianMobileDigits(raw) !== null;
}

const SUPER_ADMIN_PHONE = '8179142535';
const SUPER_ADMIN_EMAIL = 'atozmobilerepaircourse@gmail.com';
const HERO_IMAGE = 'https://storage.googleapis.com/uxpilot-auth.appspot.com/c69a9c90be-00b03d5f25bcd43e70a8.png';

function getRoleRoute(profile: { role?: string; phone?: string; email?: string }): string {
  if (!profile) return '/(tabs)';
  const phone = profile.phone || '';
  const email = profile.email || '';
  const isEmailBased = phone.startsWith('email:');
  const cleanPhone = phone.replace(/\D/g, '').slice(-10);
  if (!isEmailBased && cleanPhone === SUPER_ADMIN_PHONE) return '/admin';
  if (email === SUPER_ADMIN_EMAIL) return '/admin';
  if (profile.role === 'admin') return '/admin';
  if (profile.role === 'customer') return '/(tabs)/customer-home';
  if (isHospitalityOwnerRole(profile.role)) return '/(tabs)/my-venue';
  return '/(tabs)';
}

type RoleCard = { key: UserRole; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; bg: string };

const ROLES: RoleCard[] = [
  { key: 'customer', label: 'Customer', icon: 'person', color: '#EF4444', bg: '#FEF2F2' },
  { key: 'technician', label: 'Technician', icon: 'construct', color: '#22C55E', bg: '#F0FDF4' },
  { key: 'teacher', label: 'Teacher', icon: 'school', color: '#F59E0B', bg: '#FFFBEB' },
  { key: 'supplier', label: 'Supplier', icon: 'cube', color: '#3B82F6', bg: '#EFF6FF' },
  { key: 'shopkeeper', label: 'Shopkeeper', icon: 'storefront', color: '#8B5CF6', bg: '#F5F3FF' },
  { key: 'hotel_owner', label: 'Hotel Owner', icon: 'bed', color: '#6B46C1', bg: '#F3EEFF' },
  { key: 'restaurant_owner', label: 'Restaurant Owner', icon: 'restaurant', color: '#EC4899', bg: '#FDF2F8' },
];

/**
 * Additional "I provide a service" roles. All instant-join, no admin approval.
 */
const PROVIDER_EXTRA_ROLES: RoleCard[] = [
  { key: 'doctor', label: 'Doctor', icon: 'medkit', color: '#EF4444', bg: '#FEF2F2' },
  { key: 'lawyer', label: 'Lawyer', icon: 'briefcase', color: '#64748B', bg: '#F8FAFC' },
  { key: 'software_developer', label: 'Software Dev', icon: 'code-slash', color: '#6366F1', bg: '#EEF2FF' },
  { key: 'digital_marketer', label: 'Digital Marketer', icon: 'megaphone', color: '#EC4899', bg: '#FDF2F8' },
  { key: 'driver', label: 'Driver', icon: 'car', color: '#0EA5E9', bg: '#F0F9FF' },
  { key: 'delivery_partner', label: 'Delivery Partner', icon: 'cube', color: '#14B8A6', bg: '#F0FDFA' },
  { key: 'freelancer', label: 'Freelancer', icon: 'brush', color: '#A855F7', bg: '#FAF5FF' },
  { key: 'service_provider', label: 'Service Provider', icon: 'briefcase', color: '#FF6B2C', bg: '#FFF7ED' },
  { key: 'labour', label: 'Labour', icon: 'barbell', color: '#854D0E', bg: '#FEF7E0' },
  { key: 'cleaner', label: 'Cleaner', icon: 'sparkles', color: '#22D3EE', bg: '#ECFEFF' },
  { key: 'mechanic', label: 'Mechanic', icon: 'cog', color: '#475569', bg: '#F1F5F9' },
  { key: 'electrician', label: 'Electrician', icon: 'flash', color: '#EAB308', bg: '#FEFCE8' },
  { key: 'plumber', label: 'Plumber', icon: 'water', color: '#0284C7', bg: '#E0F2FE' },
  { key: 'carpenter', label: 'Carpenter', icon: 'hammer', color: '#92400E', bg: '#FFFBEB' },
  { key: 'painter', label: 'Painter', icon: 'color-palette', color: '#DB2777', bg: '#FCE7F3' },
  { key: 'welder', label: 'Welder', icon: 'flame', color: '#DC2626', bg: '#FEF2F2' },
];

type Screen = 'welcome' | 'phone' | 'otp' | 'google-phone' | 'details' | 'selfie' | 'skills' | 'sellType' | 'teachType' | 'businessDocs' | 'location' | 'hospitalityItems';

type PendingMenuItem = { title: string; description: string; price: string; category: string; imageUri?: string };
type PendingRoom = { name: string; description: string; pricePerNight: string; capacity: string; imageUri?: string };

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string; name?: string; google?: string; error?: string }>();
  const { completeOnboarding, loginWithProfile, isOnboarded, profile } = useApp();

  useEffect(() => {
    if (isOnboarded && profile?.id) {
      router.replace(getRoleRoute(profile) as any);
    }
  }, [isOnboarded, profile?.id]);

  // Flow state
  const [screen, setScreen] = useState<Screen>('welcome');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otpMethod, setOtpMethod] = useState<'phone' | 'email'>('phone'); // Phone or Email OTP
  const [otpCode, setOtpCode] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [otpResendTimer, setOtpResendTimer] = useState(0);
  const [otpRateLimitTimer, setOtpRateLimitTimer] = useState(0);
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [sessionToken, setSessionToken] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const otpRefs = [useRef<TextInput>(null), useRef<TextInput>(null), useRef<TextInput>(null), useRef<TextInput>(null), useRef<TextInput>(null), useRef<TextInput>(null)];

  // Google
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleSignedIn, setGoogleSignedIn] = useState(false);
  const pendingGoogleTokenRef = useRef<string | null>(null);

  // Profile fields
  const [userName, setUserName] = useState('');
  const [role, setRole] = useState<UserRole>('technician');
  const [showMoreRoles, setShowMoreRoles] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [city, setCity] = useState('');
  const [userState, setUserState] = useState('');
  const [showStatePicker, setShowStatePicker] = useState(false);
  const [experience, setExperience] = useState('');
  const [shopName, setShopName] = useState('');
  const [selfieUri, setSelfieUri] = useState('');
  const [uploadingSelfie, setUploadingSelfie] = useState(false);
  const [sellTypes, setSellTypes] = useState<string[]>([]);
  const [teachType, setTeachType] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locationGot, setLocationGot] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [checking, setChecking] = useState(false);
  const [otpSendInProgress, setOtpSendInProgress] = useState(false); // Prevent double-send
  const [venueDescription, setVenueDescription] = useState('');
  const [venuePhone, setVenuePhone] = useState('');
  const [pendingMenuItems, setPendingMenuItems] = useState<PendingMenuItem[]>([]);
  const [pendingRooms, setPendingRooms] = useState<PendingRoom[]>([]);
  const [itemTitle, setItemTitle] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [itemCapacity, setItemCapacity] = useState('2');
  const [itemImageUri, setItemImageUri] = useState('');

  const isCustomer = role === 'customer';
  const isSupplier = role === 'supplier';
  const isShopkeeper = role === 'shopkeeper';
  const isTeacher = role === 'teacher';
  const isTechnician = role === 'technician';
  const isHotelOwner = role === 'hotel_owner';
  const isRestaurantOwner = role === 'restaurant_owner';
  const isHospitalityOwner = isHotelOwner || isRestaurantOwner;

  // Handle Google redirect params
  useEffect(() => {
    if (params.error) Alert.alert('Error', params.error);
  }, [params.error]);

  useEffect(() => {
    if (params.email && !googleSignedIn) {
      setGoogleEmail(params.email);
      setGoogleSignedIn(true);
      if (params.name) setUserName(params.name);
      setScreen('google-phone');
      router.setParams({ email: undefined, name: undefined, google: undefined });
    }
  }, [params.email]);

  // OTP timers
  useEffect(() => {
    if (otpResendTimer <= 0) return;
    const t = setInterval(() => setOtpResendTimer(v => v <= 1 ? (clearInterval(t), 0) : v - 1), 1000);
    return () => clearInterval(t);
  }, [otpResendTimer]);

  useEffect(() => {
    if (otpRateLimitTimer <= 0) return;
    const t = setInterval(() => setOtpRateLimitTimer(v => v <= 1 ? (clearInterval(t), 0) : v - 1), 1000);
    return () => clearInterval(t);
  }, [otpRateLimitTimer]);

  // Location auto-capture
  useEffect(() => {
    if (screen === 'location' && !locationGot) captureLocation();
  }, [screen]);

  /** OTP was just sent, or an unexpired OTP already exists — proceed to verify screen. */
  function applyOtpSendSuccess(retryAfterSeconds?: number) {
    const retrySec = Math.max(1, Number(retryAfterSeconds) || 60);
    setOtpSent(true);
    setOtpResendTimer(retrySec);
    setOtpAttempts(0);
    setOtpError('');
    setScreen('otp');
  }

  function parseOtpSendResponse(data: any, resOk: boolean): {
    ok: boolean;
    retryAfterSeconds?: number;
    message?: string;
  } {
    const msg = String(data?.message || '').trim();
    const retrySec = Math.max(0, Number(data?.retryAfterSeconds) || 0);
    const sent = !!(data?.sent || data?.smsSent);
    const alreadySent = !!data?.alreadySent;

    if (sent || alreadySent) {
      return { ok: true, retryAfterSeconds: retrySec > 0 ? retrySec : 60, message: msg };
    }
    if (!resOk && retrySec > 0) {
      return { ok: false, retryAfterSeconds: retrySec, message: msg || 'Too many OTP requests. Please wait.' };
    }
    return { ok: false, message: msg || 'Failed to send OTP' };
  }

  const sendOtp = async (
    phoneOrEmail: string,
    method: 'phone' | 'email' = 'phone',
    options?: { forceResend?: boolean },
  ) => {
    setOtpError('');
    
    // CRITICAL: Prevent double-send - IMMEDIATELY set flags
    if (otpSendInProgress) {
      console.warn('[OTP] Request already in progress - BLOCKED');
      return;
    }
    
    // Prevent if rate limit active
    if (otpRateLimitTimer > 0) {
      console.warn('[OTP] Rate limit active - BLOCKED');
      return;
    }
    
    // Prevent if already sent (within 60s)
    if (otpSent && otpResendTimer > 0) {
      console.warn('[OTP] Resend already in progress - BLOCKED');
      return;
    }

    if (method === 'phone') {
      // Phone OTP - Send SMS via backend
      const digits = normalizeIndianMobileDigits(phoneOrEmail);
      if (!digits) {
        const errorMsg = 'Please enter a valid 10-digit mobile number.';
        console.warn('[OTP] Validation error:', errorMsg, 'Phone:', phoneOrEmail);
        Alert.alert('Invalid Number', errorMsg);
        return;
      }
      
      // CRITICAL: Set flags ONLY AFTER validation passes
      setOtpSending(true);
      setOtpSendInProgress(true);
      setOtpRateLimitTimer(60);
      
      console.log('[OTP-Phone] Sending SMS OTP to phone:', digits);

      try {
        const baseUrl = getApiUrl();
        const res = await expoFetch(`${baseUrl}/api/otp/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: digits, forceResend: options?.forceResend === true }),
        });

        const data = await res.json() as any;
        console.log('[OTP-Phone] Response:', { success: data.success, sent: data.sent, smsSent: data.smsSent, message: data.message });

        const outcome = parseOtpSendResponse(data, res.ok);
        if (!outcome.ok) {
          const errorMsg = outcome.message || 'Failed to send OTP';
          console.error('[OTP-Phone] Failed:', errorMsg);
          setOtpError(errorMsg);
          if (outcome.retryAfterSeconds) {
            setOtpRateLimitTimer(outcome.retryAfterSeconds);
            setOtpResendTimer(outcome.retryAfterSeconds);
          }
          Alert.alert(outcome.retryAfterSeconds ? 'Please wait' : 'Error', errorMsg);
          return;
        }

        console.log('[OTP-Phone] ✓ SMS OTP ready');
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        applyOtpSendSuccess(outcome.retryAfterSeconds);
        setPhone(digits);
      } catch (e: any) {
        const errorMsg = e?.message || 'Unable to send OTP. Please try again.';
        console.error('[OTP-Phone] Error:', errorMsg, e);
        setOtpError(errorMsg);
        Alert.alert('Connection Error', errorMsg);
      } finally {
        setOtpSending(false);
        setOtpSendInProgress(false);
      }
    } else {
      // Email OTP
      const emailTrimmed = phoneOrEmail.trim().toLowerCase();
      if (!emailTrimmed || !emailTrimmed.includes('@')) {
        Alert.alert('Invalid Email', 'Please enter a valid email address.');
        return;
      }
      
      // CRITICAL: Set flags ONLY AFTER validation passes
      setOtpSending(true);
      setOtpSendInProgress(true);
      setOtpRateLimitTimer(60);
      
      console.log('[OTP-Email] Sending OTP to email:', emailTrimmed);

      try {
        const baseUrl = getApiUrl();
        const res = await expoFetch(`${baseUrl}/api/otp/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailTrimmed, forceResend: options?.forceResend === true }),
        });

        const data = await res.json() as any;
        console.log('[OTP-Email] Response:', { success: data.success, sent: data.sent, message: data.message });

        const outcome = parseOtpSendResponse(data, res.ok);
        if (!outcome.ok) {
          const errorMsg = outcome.message || 'Failed to send OTP';
          console.error('[OTP-Email] Failed:', errorMsg);
          setOtpError(errorMsg);
          if (outcome.retryAfterSeconds) {
            setOtpRateLimitTimer(outcome.retryAfterSeconds);
            setOtpResendTimer(outcome.retryAfterSeconds);
          }
          Alert.alert(outcome.retryAfterSeconds ? 'Please wait' : 'Error', errorMsg);
          return;
        }

        console.log('[OTP-Email] ✓ OTP ready');
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        applyOtpSendSuccess(outcome.retryAfterSeconds);
        setEmail(emailTrimmed);
      } catch (e: any) {
        const errorMsg = e?.message || 'Unable to send email. Please try again.';
        console.error('[OTP-Email] Error:', errorMsg, e);
        setOtpError(errorMsg);
        Alert.alert('Connection Error', errorMsg);
      } finally {
        setOtpSending(false);
        setOtpSendInProgress(false);
      }
    }
  };

  const verifyOtp = async () => {
    const code = otpCode.replace(/\D/g, '');
    if (code.length < 6) { Alert.alert('Incomplete', 'Please enter all 6 digits.'); return; }
    if (otpAttempts >= 3) {
      Alert.alert('Too Many Attempts', 'Please request a new OTP.');
      setOtpError('Maximum attempts reached.');
      return;
    }
    setOtpAttempts(a => a + 1);
    setOtpVerifying(true);
    setOtpError('');
    
    try {
      console.log('[OTP] Verifying code:', code, 'method:', otpMethod);
      let verifyResult: any = null;
      
      if (otpMethod === 'email') {
        // Email OTP: Use backend verification
        console.log('[OTP-Email] Verifying email OTP');
        const baseUrl = getApiUrl();
        const res = await fetch(`${baseUrl}/api/otp/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, otp: code, deviceId: await getDeviceId() }),
        });
        
        const data = await res.json() as any;
        console.log('[OTP-Email] Verify response:', { success: data.success, isNewUser: data.isNewUser });
        
        if (!data.success) {
          console.error('[OTP-Email] Verification failed:', data.message);
          setOtpError(data.message || 'Invalid OTP');
          Alert.alert('Verification Failed', data.message || 'Invalid OTP. Please try again.');
          return;
        }
        
        verifyResult = data;
      } else {
        // Phone OTP: Try Firebase first, then fallback
        // PRIMARY: Try Firebase if not using fallback
        if (!usingFallback) {
          try {
            console.log('[OTP-Phone] PRIMARY: Verifying with Firebase');
            const { verifyFirebaseOTP } = await import('@/lib/firebase-phone-auth');
            const fbResult = await verifyFirebaseOTP(phone, code);
            
            if (fbResult.success) {
              // Must keep server fields (sessionToken, profile, isNewUser) — do not replace with a stub
              console.log('[OTP-Phone] ✓ Primary verification successful');
              verifyResult = fbResult as any;
            } else {
              console.warn('[OTP-Phone] Firebase verification failed, trying fallback');
            }
          } catch (e) {
            console.warn('[OTP-Phone] Firebase verification error, trying fallback');
          }
        }
        
        // FALLBACK: Verify via backend
        if (!verifyResult) {
          console.log('[OTP-Phone] FALLBACK: Verifying via backend');
          const { verifyFallbackOTP } = await import('@/lib/firebase-phone-auth');
          const result = await verifyFallbackOTP(phone, code);
          
          if (!result.success) {
            console.error('[OTP-Phone] Verification failed:', result.error);
            setOtpError(result.error);
            Alert.alert('Verification Failed', result.error);
            return;
          }
          verifyResult = result.data;
        }
      }
      
      console.log('[OTP] ✓ Verification successful');
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      if (verifyResult.isNewUser === false && verifyResult.profile) {
        const p = { 
          ...verifyResult.profile, 
          skills: Array.isArray(verifyResult.profile.skills) 
            ? verifyResult.profile.skills 
            : (() => { try { return JSON.parse(verifyResult.profile.skills || '[]'); } catch { return []; } })() 
        };
        await loginWithProfile(p, verifyResult.sessionToken || '');
        router.replace(getRoleRoute(p) as any);
        return;
      }
      
      setSessionToken(verifyResult.sessionToken || '');
      setIsNewUser(true);
      setScreen('details');
    } catch (e: any) {
      const msg = e?.message || 'Verification failed';
      console.error('[OTP] Error:', msg);
      setOtpError(msg);
      Alert.alert('Error', msg);
    } finally {
      setOtpVerifying(false);
    }
  };


  const handleGooglePhoneSubmit = async () => {
    const phoneToSend = normalizeIndianMobileDigits(phone);
    if (!phoneToSend) { Alert.alert('Invalid Number', 'Please enter a valid 10-digit mobile number.'); return; }
    setChecking(true);
    try {
      const deviceId = await getDeviceId();
      const res = await apiRequest('POST', '/api/auth/google-phone-login', { email: googleEmail, phone: phoneToSend, deviceId });
      const data = await res.json();
      if (data.success) {
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (data.exists && data.profile) {
          await loginWithProfile(data.profile, data.sessionToken || '');
          router.replace(getRoleRoute(data.profile) as any);
          return;
        }
        setSessionToken(data.sessionToken || '');
        setPhone(phoneToSend);
        setIsNewUser(true);
        setScreen('details');
      } else {
        Alert.alert('Error', data.message || 'Login failed');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not connect to server.');
    } finally {
      setChecking(false);
    }
  };

  const takeSelfie = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Camera Required', 'Please allow camera access.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7, cameraType: ImagePicker.CameraType.front });
    if (!result.canceled && result.assets[0]) setSelfieUri(result.assets[0].uri);
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (!result.canceled && result.assets[0]) setSelfieUri(result.assets[0].uri);
  };

  const uploadSelfie = async (uri: string): Promise<string | null> => {
    try {
      const baseUrl = getApiUrl();
      const uploadUrl = new URL('/api/upload', baseUrl).toString();
      if (Platform.OS === 'web') {
        const blob = await (await globalThis.fetch(uri)).blob();
        const fd = new FormData();
        fd.append('image', blob, 'selfie.jpg');
        const r = await globalThis.fetch(uploadUrl, { method: 'POST', body: fd });
        const d = await r.json();
        return d.url ? new URL(d.url, baseUrl).toString() : null;
      } else {
        const fd = new FormData();
        fd.append('image', { uri, name: 'selfie.jpg', type: 'image/jpeg' } as any);
        const r = await globalThis.fetch(uploadUrl, { method: 'POST', body: fd as any });
        const d = await r.json();
        return d.url ? new URL(d.url, baseUrl).toString() : null;
      }
    } catch { return null; }
  };

  const captureLocation = async () => {
    if (locationGot) return;
    setGettingLocation(true);
    try {
      if (Platform.OS === 'web') {
        if (!navigator.geolocation) return;
        await new Promise<void>((res) => navigator.geolocation.getCurrentPosition(
          (p) => { setLatitude(p.coords.latitude.toString()); setLongitude(p.coords.longitude.toString()); setLocationGot(true); res(); },
          () => res(),
          { timeout: 8000 }
        ));
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLatitude(loc.coords.latitude.toString());
        setLongitude(loc.coords.longitude.toString());
        setLocationGot(true);
      }
    } catch {} finally { setGettingLocation(false); }
  };

  const handleComplete = async () => {
    if (!city.trim() || !userState.trim()) { Alert.alert('Required', 'Please enter your city and state.'); return; }
    if (isHospitalityOwner && !shopName.trim()) { Alert.alert('Required', 'Please enter your business name.'); return; }
    if (isHospitalityOwner && !shopAddress.trim()) { Alert.alert('Required', 'Please enter your business address.'); return; }
    setUploadingSelfie(true);
    let avatarUrl = '';
    if (selfieUri) {
      const uploaded = await uploadSelfie(selfieUri);
      if (uploaded) { avatarUrl = uploaded; }
      else if (!isHospitalityOwner) { Alert.alert('Upload Failed', 'Could not upload your photo. Please try again.'); setUploadingSelfie(false); return; }
    }
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const cleanPhone = normalizeIndianMobileDigits(phone) || sanitizePhoneInput(phone);
    const p: UserProfile = {
      id: Crypto.randomUUID(),
      name: userName.trim(),
      phone: cleanPhone,
      email: googleEmail || undefined,
      role, skills: selectedSkills,
      city: city.trim(), state: userState.trim(),
      experience: experience.trim(),
      shopName: shopName.trim() || undefined, bio: isHospitalityOwner ? venueDescription.trim() : '',
      avatar: avatarUrl || undefined,
      sellType: (isSupplier || isShopkeeper) ? sellTypes.join(', ') : undefined,
      teachType: isTeacher ? teachType : undefined,
      shopAddress: (isSupplier || isHospitalityOwner) ? shopAddress.trim() : undefined,
      gstNumber: (isSupplier || isShopkeeper) ? gstNumber.trim() : undefined,
      aadhaarNumber: (isSupplier || isTeacher || isShopkeeper) ? aadhaarNumber.trim() : undefined,
      panNumber: (isSupplier || isTeacher || isShopkeeper) ? panNumber.trim() : undefined,
      latitude: latitude || undefined, longitude: longitude || undefined,
      locationSharing: 'true', createdAt: Date.now(),
    };
    await completeOnboarding(p, sessionToken);

    if (isHospitalityOwner) {
      try {
        const venueRes = await createVenueProfile({
          ownerId: p.id,
          ownerName: p.name,
          venueType: isHotelOwner ? 'hotel' : 'restaurant',
          name: shopName.trim(),
          description: venueDescription.trim(),
          address: shopAddress.trim(),
          city: city.trim(),
          state: userState.trim(),
          latitude: latitude || '',
          longitude: longitude || '',
          phone: venuePhone.trim() || cleanPhone.slice(-10),
          whatsapp: venuePhone.trim() || cleanPhone.slice(-10),
        });
        if (venueRes.success && venueRes.venue?.id) {
          const venueId = venueRes.venue.id;
          if (isRestaurantOwner) {
            for (const item of pendingMenuItems) {
              let imageUrl = '';
              if (item.imageUri) imageUrl = (await uploadSelfie(item.imageUri)) || '';
              await addMenuItem(venueId, {
                ownerId: p.id,
                title: item.title,
                description: item.description,
                price: item.price,
                category: item.category,
                image: imageUrl,
              });
            }
          } else {
            for (const room of pendingRooms) {
              let imageUrl = '';
              if (room.imageUri) imageUrl = (await uploadSelfie(room.imageUri)) || '';
              await addHotelRoom(venueId, {
                ownerId: p.id,
                name: room.name,
                description: room.description,
                pricePerNight: room.pricePerNight,
                capacity: Number(room.capacity) || 2,
                image: imageUrl,
              });
            }
          }
        }
      } catch (e) {
        console.warn('[Onboarding] hospitality venue setup:', e);
      }
    }

    try {
      const welcomeText = isCustomer
        ? `Hey technicians! I just joined Mobi. Based in ${city.trim()}, ${userState.trim()}.`
        : isHospitalityOwner
          ? `Hi, I'm ${userName.trim()}, owner of ${shopName.trim()} (${ROLE_LABELS[role]}) in ${city.trim()}.`
          : `Hi, I'm ${userName.trim()}, a ${ROLE_LABELS[role] || role} from ${city.trim()}, ${userState.trim()}. I'm using Mobi app!`;
      await apiRequest('POST', '/api/posts', { userId: p.id, userName: p.name, userRole: p.role, text: welcomeText, images: [], category: 'repair' });
    } catch {}
    setUploadingSelfie(false);
    router.replace(getRoleRoute(p) as any);
  };

  const getNextScreen = (current: Screen): Screen | null => {
    switch (current) {
      case 'details': return isCustomer ? 'location' : isHospitalityOwner ? 'location' : 'selfie';
      case 'selfie': return isTechnician ? 'skills' : (isSupplier || isShopkeeper) ? 'sellType' : isTeacher ? 'teachType' : 'location';
      case 'skills': return 'location';
      case 'sellType': return 'businessDocs';
      case 'teachType': return 'businessDocs';
      case 'businessDocs': return 'location';
      case 'location': return isHospitalityOwner ? 'hospitalityItems' : null;
      default: return null;
    }
  };

  const nextScreen = () => {
    const next = getNextScreen(screen);
    if (next) setScreen(next);
  };

  const handleOtpDigit = (val: string, idx: number) => {
    const digits = val.replace(/\D/g, '');
    if (digits.length > 1) {
      const all = digits.slice(0, 6);
      setOtpCode(all.padEnd(6, ' ').slice(0, 6).trim());
      otpRefs[Math.min(all.length, 5)]?.current?.focus();
      return;
    }
    const arr = otpCode.split('');
    arr[idx] = digits;
    setOtpCode(arr.join(''));
    if (digits && idx < 5) otpRefs[idx + 1]?.current?.focus();
    if (!digits && idx > 0) otpRefs[idx - 1]?.current?.focus();
  };


  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const botInset = Platform.OS === 'web' ? 34 : insets.bottom;
  const handlePhoneChange = (text: string) => setPhone(sanitizePhoneInput(text));
  const phoneDigitsValid = isValidIndianMobileInput(phone);
  const phoneInputCommonProps = {
    style: s.phoneInput,
    placeholder: 'Enter mobile number',
    placeholderTextColor: '#6B7280',
    keyboardType: 'phone-pad' as const,
    maxLength: 10,
    value: phone,
    onChangeText: handlePhoneChange,
    returnKeyType: 'done' as const,
    selectionColor: '#2563EB',
    autoComplete: 'tel' as const,
    textContentType: 'telephoneNumber' as const,
    importantForAutofill: 'yes' as const,
  };

  // ─── WELCOME SCREEN ──────────────────────────────────────────────────────────
  if (screen === 'welcome') {
    return (
      <KeyboardAvoidingView
        style={s.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? topInset : 0}
      >
        <StatusBar style="light" />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.welcomeScroll}
          bounces={false}
        >
          <View style={s.heroContainer}>
            <Image source={{ uri: HERO_IMAGE }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.1)', 'rgba(255,255,255,0.95)', '#FFFFFF']} style={s.heroGradient} />
          </View>
          <View style={[s.welcomeContent, { paddingBottom: Math.max(botInset, 20) }]}>
            <Text style={s.welcomeTitle}>Welcome to Mobile{'\n'}Technician Community</Text>
            <Text style={s.welcomeSubtitle}>Network, Learn & Grow with technicians across India.</Text>
            <View style={s.welcomeActions}>
              {otpMethod === 'phone' && (
                <>
                  <View style={s.phoneInputRow}>
                    <View style={s.countryCode}><Text style={s.countryCodeText}>+91</Text></View>
                    <TextInput {...phoneInputCommonProps} />
                  </View>
                  {phone.length > 0 && (
                    <Text style={s.phoneHint}>{phone.length}/10 digits</Text>
                  )}
                  <Pressable
                    style={({ pressed }) => [s.primaryBtn, { opacity: pressed ? 0.85 : 1 }, (otpSending || otpRateLimitTimer > 0 || !phoneDigitsValid) && { opacity: 0.5 }]}
                    onPress={() => sendOtp(phone, 'phone')}
                    disabled={otpSending || otpRateLimitTimer > 0 || !phoneDigitsValid}
                  >
                    {otpSending ? (
                      <ActivityIndicator color="#FFF" />
                    ) : otpRateLimitTimer > 0 ? (
                      <Text style={s.primaryBtnText}>Resend in {otpRateLimitTimer}s</Text>
                    ) : (
                      <Text style={s.primaryBtnText}>Get OTP via SMS</Text>
                    )}
                  </Pressable>
                  {otpError && <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 8, textAlign: 'center' }}>{otpError}</Text>}
                </>
              )}
            </View>
            <Text style={s.termsText}>
              By continuing, you agree to our{' '}
              <Text style={s.termsLink} onPress={() => openLink(`${getApiUrl()}/terms`, 'Terms')}>Terms</Text>
              {' '}and{' '}
              <Text style={s.termsLink} onPress={() => openLink(`${getApiUrl()}/privacy`, 'Privacy')}>Privacy Policy</Text>.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── PHONE SCREEN (fallback if navigated directly) ───────────────────────────
  if (screen === 'phone') {
    return (
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? topInset : 0}>
        <StatusBar style="dark" />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[s.formScreen, { paddingTop: topInset + 20, paddingBottom: Math.max(botInset, 20) }]}>
          <Pressable style={s.backBtn} onPress={() => setScreen('welcome')}>
            <Ionicons name="chevron-back" size={24} color="#374151" />
          </Pressable>
          <View style={s.formHeader}>
            <Text style={s.formTitle}>Enter your number</Text>
            <Text style={s.formSubtitle}>We'll send you a one-time password</Text>
          </View>
          <View style={s.phoneInputRow}>
            <View style={s.countryCode}><Text style={s.countryCodeText}>+91</Text></View>
            <TextInput {...phoneInputCommonProps} autoFocus />
          </View>
          {phone.length > 0 && <Text style={s.phoneHint}>{phone.length}/10 digits</Text>}
          <Pressable
            style={({ pressed }) => [s.primaryBtn, { marginTop: 16, opacity: pressed ? 0.85 : 1 }, (otpSending || otpRateLimitTimer > 0 || !phoneDigitsValid) && { opacity: 0.5 }]}
            onPress={() => sendOtp(phone)}
            disabled={otpSending || otpRateLimitTimer > 0 || !phoneDigitsValid}
          >
            {otpSending ? (
              <ActivityIndicator color="#FFF" />
            ) : otpRateLimitTimer > 0 ? (
              <Text style={s.primaryBtnText}>Resend in {otpRateLimitTimer}s</Text>
            ) : (
              <Text style={s.primaryBtnText}>Send OTP</Text>
            )}
          </Pressable>
          {otpRateLimitTimer > 0 && <Text style={s.errorText}>Rate limited. Wait {otpRateLimitTimer}s.</Text>}
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── OTP SCREEN ──────────────────────────────────────────────────────────────
  if (screen === 'otp') {
    return (
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="dark" />
        <View style={[s.formScreen, { paddingTop: topInset + 20, paddingBottom: Math.max(botInset, 20), justifyContent: 'center' }]}>
          <Pressable style={s.backBtn} onPress={() => setScreen('welcome')}>
            <Ionicons name="chevron-back" size={24} color="#374151" />
          </Pressable>
          <View style={[s.formHeader, { marginBottom: 12 }]}>
            <Text style={s.formTitle}>Enter code</Text>
            <Text style={s.formSubtitle}>Check your SMS for the 6-digit code <Text style={{ color: '#10B981', fontWeight: '600' }}>+91 {phone}</Text></Text>
          </View>


          <View style={s.otpContainer}>
            <View style={s.otpRow}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <React.Fragment key={i}>
                  <TextInput
                    ref={otpRefs[i]}
                    style={[s.otpBox, otpCode[i] ? s.otpBoxFilled : null, otpError ? s.otpBoxError : null]}
                    value={otpCode[i] || ''}
                    onChangeText={(v) => handleOtpDigit(v, i)}
                    keyboardType="number-pad"
                    maxLength={1}
                    selectTextOnFocus
                    autoFocus={i === 0}
                    editable={!otpVerifying}
                  />
                  {i === 2 && <Text style={s.otpDivider}>-</Text>}
                </React.Fragment>
              ))}
            </View>

            {otpError && (
              <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="alert-circle" size={16} color="#EF4444" style={{ marginRight: 8 }} />
                  <Text style={{ color: '#EF4444', fontSize: 14 }}>{otpError}</Text>
                </View>
              </View>
            )}

            <View style={s.resendArea}>
              <Text style={s.resendText}>Didn't receive code?</Text>
              <Pressable
                style={[s.resendBtn, otpResendTimer > 0 && { opacity: 0.5 }]}
                onPress={() => otpResendTimer === 0 && sendOtp(phone, 'phone', { forceResend: true })}
                disabled={otpResendTimer > 0 || otpSending}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="reload" size={14} color={otpResendTimer > 0 ? '#9CA3AF' : '#3B82F6'} style={{ marginRight: 6 }} />
                  <Text style={[s.resendBtnText, otpResendTimer > 0 && { color: '#9CA3AF' }]}>
                    {otpSending ? 'Sending...' : 'Resend'}
                  </Text>
                  {otpResendTimer > 0 && (
                    <Text style={s.timerText}> ({otpResendTimer}s)</Text>
                  )}
                </View>
              </Pressable>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [s.primaryBtn, { marginHorizontal: 16, marginTop: 'auto', marginBottom: 24, opacity: (pressed || otpVerifying) ? 0.85 : 1 }]}
            onPress={verifyOtp}
            disabled={otpVerifying || otpCode.replace(/\D/g, '').length < 6}
          >
            {otpVerifying ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={s.primaryBtnText}>Verify & Continue</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── GOOGLE PHONE SCREEN ─────────────────────────────────────────────────────
  if (screen === 'google-phone') {
    return (
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? topInset : 0}>
        <StatusBar style="dark" />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[s.formScreen, { paddingTop: topInset + 20, paddingBottom: Math.max(botInset, 20) }]}>
          <View style={s.formHeader}>
            <Text style={s.formTitle}>Link your number</Text>
            <Text style={s.formSubtitle}>Signed in as {googleEmail}</Text>
          </View>
          <View style={s.phoneInputRow}>
            <View style={s.countryCode}><Text style={s.countryCodeText}>+91</Text></View>
            <TextInput {...phoneInputCommonProps} autoFocus />
          </View>
          {phone.length > 0 && <Text style={s.phoneHint}>{phone.length}/10 digits</Text>}
          <Pressable
            style={({ pressed }) => [s.primaryBtn, { marginTop: 16, opacity: pressed ? 0.85 : 1 }, (!phoneDigitsValid || checking) && { opacity: 0.5 }]}
            onPress={handleGooglePhoneSubmit}
            disabled={checking || !phoneDigitsValid}
          >
            {checking ? <ActivityIndicator color="#FFF" /> : <Text style={s.primaryBtnText}>Continue</Text>}
          </Pressable>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── DETAILS SCREEN ──────────────────────────────────────────────────────────
  if (screen === 'details') {
    return (
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="dark" />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.scrollContent, { paddingTop: topInset + 20, paddingBottom: Math.max(botInset, 24) }]} keyboardShouldPersistTaps="handled">
          <View style={s.formHeader}>
            <Text style={s.formTitle}>Create your profile</Text>
            <Text style={s.formSubtitle}>Tell us about yourself</Text>
          </View>
          <View style={s.field}>
            <Text style={s.label}>Full Name</Text>
            <TextInput style={s.input} placeholder="Your name" placeholderTextColor="#9CA3AF" value={userName} onChangeText={setUserName} />
          </View>
          <View style={s.field}>
            <Text style={s.label}>I am a</Text>
            <View style={s.rolesGrid}>
              {ROLES.map(r => (
                <Pressable key={r.key} style={[s.roleCard, role === r.key && { borderColor: r.color, borderWidth: 2, backgroundColor: r.bg }]} onPress={() => { setRole(r.key); if (Platform.OS !== 'web') Haptics.selectionAsync(); }}>
                  <Ionicons name={r.icon} size={24} color={role === r.key ? r.color : '#6B7280'} />
                  <Text style={[s.roleLabel, role === r.key && { color: r.color, fontWeight: '600' }]}>{r.label}</Text>
                </Pressable>
              ))}
              <Pressable
                style={[s.roleCard, showMoreRoles && { borderColor: '#0F172A', borderWidth: 2 }]}
                onPress={() => { setShowMoreRoles(v => !v); if (Platform.OS !== 'web') Haptics.selectionAsync(); }}
              >
                <Ionicons name={showMoreRoles ? 'chevron-up' : 'add-circle-outline'} size={24} color="#0F172A" />
                <Text style={[s.roleLabel, { color: '#0F172A', fontWeight: '600' }]}>
                  {showMoreRoles ? 'Less' : 'I provide service'}
                </Text>
              </Pressable>
            </View>
            {showMoreRoles && (
              <View style={[s.rolesGrid, { marginTop: 10 }]}>
                {PROVIDER_EXTRA_ROLES.map(r => (
                  <Pressable
                    key={r.key}
                    style={[s.roleCard, role === r.key && { borderColor: r.color, borderWidth: 2, backgroundColor: r.bg }]}
                    onPress={() => { setRole(r.key); if (Platform.OS !== 'web') Haptics.selectionAsync(); }}
                  >
                    <Ionicons name={r.icon} size={24} color={role === r.key ? r.color : '#6B7280'} />
                    <Text style={[s.roleLabel, role === r.key && { color: r.color, fontWeight: '600' }]}>{r.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
          {!isCustomer && !isSupplier && !isHospitalityOwner && (
            <View style={s.field}>
              <Text style={s.label}>Shop / Business Name</Text>
              <TextInput style={s.input} placeholder="e.g. Raj Mobile Repairs" placeholderTextColor="#9CA3AF" value={shopName} onChangeText={setShopName} />
            </View>
          )}
          {isHospitalityOwner && (
            <>
              <View style={s.field}>
                <Text style={s.label}>{isHotelOwner ? 'Hotel Name *' : 'Restaurant Name *'}</Text>
                <TextInput style={s.input} placeholder={isHotelOwner ? 'Grand Palace Hotel' : 'Srinivasa Restaurant'} placeholderTextColor="#9CA3AF" value={shopName} onChangeText={setShopName} />
              </View>
              <View style={s.field}>
                <Text style={s.label}>About your business</Text>
                <TextInput style={[s.input, { height: 80, textAlignVertical: 'top' }]} placeholder="Describe your hotel or restaurant..." placeholderTextColor="#9CA3AF" value={venueDescription} onChangeText={setVenueDescription} multiline />
              </View>
              <View style={s.field}>
                <Text style={s.label}>Business Address *</Text>
                <TextInput style={[s.input, { height: 72, textAlignVertical: 'top' }]} placeholder="Full street address" placeholderTextColor="#9CA3AF" value={shopAddress} onChangeText={setShopAddress} multiline />
              </View>
              <View style={s.field}>
                <Text style={s.label}>Contact Phone</Text>
                <TextInput style={s.input} placeholder="10-digit mobile" placeholderTextColor="#9CA3AF" value={venuePhone} onChangeText={setVenuePhone} keyboardType="phone-pad" maxLength={10} />
              </View>
            </>
          )}
          {isSupplier && (
            <View style={s.field}>
              <Text style={s.label}>Business Name</Text>
              <TextInput style={s.input} placeholder="e.g. Arun Spare Parts" placeholderTextColor="#9CA3AF" value={shopName} onChangeText={setShopName} />
            </View>
          )}
          {!isCustomer && !isHospitalityOwner && (
            <View style={s.field}>
              <Text style={s.label}>Experience</Text>
              <TextInput style={s.input} placeholder="e.g. 3 years" placeholderTextColor="#9CA3AF" value={experience} onChangeText={setExperience} />
            </View>
          )}
          <Pressable
            style={({ pressed }) => [s.primaryBtn, { marginTop: 8, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => {
              if (!userName.trim()) { Alert.alert('Required', 'Please enter your name.'); return; }
              if (isHospitalityOwner && !shopName.trim()) { Alert.alert('Required', 'Please enter your business name.'); return; }
              if (isHospitalityOwner && !shopAddress.trim()) { Alert.alert('Required', 'Please enter your business address.'); return; }
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              nextScreen();
            }}
          >
            <Text style={s.primaryBtnText}>Continue</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── SELFIE SCREEN ───────────────────────────────────────────────────────────
  if (screen === 'selfie') {
    return (
      <View style={[s.screen, { paddingTop: topInset + 20, paddingBottom: Math.max(botInset, 24) }]}>
        <StatusBar style="dark" />
        <View style={s.formHeader}>
          <Text style={s.formTitle}>Add your photo</Text>
          <Text style={s.formSubtitle}>Help people recognise you</Text>
        </View>
        <View style={s.selfieArea}>
          {selfieUri ? (
            <Image source={{ uri: selfieUri }} style={s.selfiePreview} contentFit="cover" />
          ) : (
            <View style={s.selfiePlaceholder}>
              <Ionicons name="person" size={64} color="#D1D5DB" />
            </View>
          )}
        </View>
        <View style={s.selfieButtons}>
          <Pressable style={[s.outlineBtn, { flex: 1 }]} onPress={takeSelfie}>
            <Ionicons name="camera" size={18} color="#3B82F6" />
            <Text style={s.outlineBtnText}>Camera</Text>
          </Pressable>
          <Pressable style={[s.outlineBtn, { flex: 1 }]} onPress={pickPhoto}>
            <Ionicons name="image" size={18} color="#3B82F6" />
            <Text style={s.outlineBtnText}>Gallery</Text>
          </Pressable>
        </View>
        <View style={s.rowButtons}>
          <Pressable style={[s.outlineBtn, { flex: 1 }]} onPress={nextScreen}>
            <Text style={s.outlineBtnText}>Skip</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.primaryBtn, { flex: 2, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => { if (!selfieUri) { nextScreen(); } else nextScreen(); }}
          >
            <Text style={s.primaryBtnText}>Continue</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── SKILLS SCREEN ───────────────────────────────────────────────────────────
  if (screen === 'skills') {
    return (
      <View style={[s.screen, { paddingTop: topInset + 20 }]}>
        <StatusBar style="dark" />
        <View style={[s.formHeader, { paddingHorizontal: 24 }]}>
          <Text style={s.formTitle}>Your skills</Text>
          <Text style={s.formSubtitle}>Select all that apply</Text>
        </View>
        <ScrollView contentContainerStyle={s.skillsGrid}>
          {SKILLS_LIST.map(skill => {
            const selected = selectedSkills.includes(skill);
            return (
              <Pressable
                key={skill}
                style={[s.skillChip, selected && s.skillChipSelected]}
                onPress={() => { if (Platform.OS !== 'web') Haptics.selectionAsync(); setSelectedSkills(prev => prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]); }}
              >
                <Text style={[s.skillChipText, selected && s.skillChipTextSelected]}>{skill}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={[s.bottomBar, { paddingBottom: Math.max(botInset, 16) }]}>
          <Pressable
            style={({ pressed }) => [s.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => { if (selectedSkills.length === 0) { Alert.alert('Required', 'Select at least one skill.'); return; } nextScreen(); }}
          >
            <Text style={s.primaryBtnText}>Continue ({selectedSkills.length} selected)</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── SELL TYPE SCREEN ────────────────────────────────────────────────────────
  if (screen === 'sellType') {
    return (
      <View style={[s.screen, { paddingTop: topInset + 20 }]}>
        <StatusBar style="dark" />
        <View style={[s.formHeader, { paddingHorizontal: 24 }]}>
          <Text style={s.formTitle}>What do you sell?</Text>
          <Text style={s.formSubtitle}>Select all that apply</Text>
        </View>
        <ScrollView contentContainerStyle={s.skillsGrid}>
          {(isShopkeeper ? SHOPKEEPER_SELL_TYPES : SUPPLIER_SELL_TYPES).map(type => {
            const selected = sellTypes.includes(type);
            return (
              <Pressable key={type} style={[s.skillChip, selected && s.skillChipSelected]} onPress={() => setSellTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])}>
                <Text style={[s.skillChipText, selected && s.skillChipTextSelected]}>{type}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={[s.bottomBar, { paddingBottom: Math.max(botInset, 16) }]}>
          <Pressable style={({ pressed }) => [s.primaryBtn, { opacity: pressed ? 0.85 : 1 }]} onPress={() => { if (sellTypes.length === 0) { Alert.alert('Required', 'Select what you sell.'); return; } nextScreen(); }}>
            <Text style={s.primaryBtnText}>Continue</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── TEACH TYPE SCREEN ───────────────────────────────────────────────────────
  if (screen === 'teachType') {
    return (
      <View style={[s.screen, { paddingTop: topInset + 20 }]}>
        <StatusBar style="dark" />
        <View style={[s.formHeader, { paddingHorizontal: 24 }]}>
          <Text style={s.formTitle}>What do you teach?</Text>
        </View>
        <ScrollView contentContainerStyle={s.skillsGrid}>
          {TEACHER_TEACH_TYPES.map(type => (
            <Pressable key={type} style={[s.skillChip, teachType === type && s.skillChipSelected]} onPress={() => setTeachType(type)}>
              <Text style={[s.skillChipText, teachType === type && s.skillChipTextSelected]}>{type}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={[s.bottomBar, { paddingBottom: Math.max(botInset, 16) }]}>
          <Pressable style={({ pressed }) => [s.primaryBtn, { opacity: pressed ? 0.85 : 1 }]} onPress={() => { if (!teachType) { Alert.alert('Required', 'Select what you teach.'); return; } nextScreen(); }}>
            <Text style={s.primaryBtnText}>Continue</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── BUSINESS DOCS SCREEN ────────────────────────────────────────────────────
  if (screen === 'businessDocs') {
    return (
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={[s.scrollContent, { paddingTop: topInset + 20, paddingBottom: Math.max(botInset, 24) }]} keyboardShouldPersistTaps="handled">
          <View style={s.formHeader}>
            <Text style={s.formTitle}>Business details</Text>
            <Text style={s.formSubtitle}>Required for verification</Text>
          </View>
          {isSupplier && (
            <View style={s.field}>
              <Text style={s.label}>Business Address</Text>
              <TextInput style={[s.input, { height: 80, textAlignVertical: 'top' }]} placeholder="Warehouse / office address" placeholderTextColor="#9CA3AF" value={shopAddress} onChangeText={setShopAddress} multiline />
            </View>
          )}
          <View style={s.field}>
            <Text style={s.label}>Aadhaar Number</Text>
            <TextInput style={s.input} placeholder="12-digit Aadhaar" placeholderTextColor="#9CA3AF" value={aadhaarNumber} onChangeText={setAadhaarNumber} keyboardType="number-pad" maxLength={12} />
          </View>
          <View style={s.field}>
            <Text style={s.label}>PAN Number</Text>
            <TextInput style={s.input} placeholder="10-character PAN" placeholderTextColor="#9CA3AF" value={panNumber} onChangeText={v => setPanNumber(v.toUpperCase())} maxLength={10} />
          </View>
          {(isSupplier || isShopkeeper) && (
            <View style={s.field}>
              <Text style={s.label}>GST Number (optional)</Text>
              <TextInput style={s.input} placeholder="GST registration number" placeholderTextColor="#9CA3AF" value={gstNumber} onChangeText={setGstNumber} />
            </View>
          )}
          <Pressable
            style={({ pressed }) => [s.primaryBtn, { marginTop: 8, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => {
              if (isSupplier && !shopAddress.trim()) { Alert.alert('Required', 'Please enter your business address.'); return; }
              if (!isShopkeeper && !aadhaarNumber.trim()) { Alert.alert('Required', 'Please enter your Aadhaar number.'); return; }
              if (!isShopkeeper && !panNumber.trim()) { Alert.alert('Required', 'Please enter your PAN number.'); return; }
              nextScreen();
            }}
          >
            <Text style={s.primaryBtnText}>Continue</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ─── LOCATION SCREEN ─────────────────────────────────────────────────────────
  if (screen === 'location') {
    return (
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={[s.scrollContent, { paddingTop: topInset + 20, paddingBottom: Math.max(botInset, 24) }]} keyboardShouldPersistTaps="handled">
          <View style={s.formHeader}>
            <Text style={s.formTitle}>Your location</Text>
            <Text style={s.formSubtitle}>
              {isHospitalityOwner ? 'GPS helps customers find your hotel or restaurant' : 'Helps connect you with nearby professionals'}
            </Text>
          </View>
          {locationGot && (
            <View style={s.locationBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
              <Text style={{ color: '#22C55E', fontSize: 13, fontWeight: '500', marginLeft: 6 }}>GPS location captured</Text>
            </View>
          )}
          {gettingLocation && (
            <View style={s.locationBadge}>
              <ActivityIndicator size="small" color="#3B82F6" />
              <Text style={{ color: '#3B82F6', fontSize: 13, marginLeft: 8 }}>Getting location...</Text>
            </View>
          )}
          <View style={s.field}>
            <Text style={s.label}>City</Text>
            <TextInput style={s.input} placeholder="Your city" placeholderTextColor="#9CA3AF" value={city} onChangeText={setCity} />
          </View>
          <View style={s.field}>
            <Text style={s.label}>State</Text>
            <Pressable style={s.input} onPress={() => setShowStatePicker(true)}>
              <Text style={{ color: userState ? '#111827' : '#9CA3AF', fontSize: 15 }}>{userState || 'Select state'}</Text>
            </Pressable>
          </View>
          <Pressable
            style={({ pressed }) => [s.primaryBtn, { marginTop: 8, opacity: (pressed || uploadingSelfie) ? 0.85 : 1 }]}
            onPress={() => {
              if (!city.trim() || !userState.trim()) { Alert.alert('Required', 'Please enter your city and state.'); return; }
              if (isHospitalityOwner) nextScreen();
              else handleComplete();
            }}
            disabled={uploadingSelfie}
          >
            {uploadingSelfie ? <ActivityIndicator color="#FFF" /> : (
              <Text style={s.primaryBtnText}>{isHospitalityOwner ? 'Continue' : 'Complete Setup'}</Text>
            )}
          </Pressable>
        </ScrollView>
        <Modal visible={showStatePicker} animationType="slide" presentationStyle="pageSheet">
          <View style={{ flex: 1, paddingTop: topInset }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Select State</Text>
              <Pressable onPress={() => setShowStatePicker(false)}><Ionicons name="close" size={24} color="#6B7280" /></Pressable>
            </View>
            <FlatList
              data={INDIAN_STATES}
              keyExtractor={i => i}
              renderItem={({ item }) => (
                <Pressable style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F9FAFB' }} onPress={() => { setUserState(item); setShowStatePicker(false); }}>
                  <Text style={{ fontSize: 16, color: item === userState ? '#3B82F6' : '#374151', fontWeight: item === userState ? '600' : '400' }}>{item}</Text>
                </Pressable>
              )}
            />
          </View>
        </Modal>
      </KeyboardAvoidingView>
    );
  }

  // ─── HOSPITALITY ITEMS SCREEN ────────────────────────────────────────────────
  if (screen === 'hospitalityItems') {
    const addPendingItem = async () => {
      if (!itemTitle.trim() || !itemPrice.trim()) {
        Alert.alert('Required', isHotelOwner ? 'Room name and price are required.' : 'Item name and price are required.');
        return;
      }
      if (isRestaurantOwner) {
        setPendingMenuItems((prev) => [...prev, {
          title: itemTitle.trim(),
          description: itemDescription.trim(),
          price: itemPrice.trim(),
          category: itemCategory.trim(),
          imageUri: itemImageUri || undefined,
        }]);
      } else {
        setPendingRooms((prev) => [...prev, {
          name: itemTitle.trim(),
          description: itemDescription.trim(),
          pricePerNight: itemPrice.trim(),
          capacity: itemCapacity.trim() || '2',
          imageUri: itemImageUri || undefined,
        }]);
      }
      setItemTitle('');
      setItemDescription('');
      setItemPrice('');
      setItemCategory('');
      setItemCapacity('2');
      setItemImageUri('');
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };

    const pickItemPhoto = async () => {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo access to upload images.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled && result.assets[0]) setItemImageUri(result.assets[0].uri);
    };

    const pendingCount = isRestaurantOwner ? pendingMenuItems.length : pendingRooms.length;

    return (
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={[s.scrollContent, { paddingTop: topInset + 20, paddingBottom: Math.max(botInset, 24) }]} keyboardShouldPersistTaps="handled">
          <View style={s.formHeader}>
            <Text style={s.formTitle}>{isHotelOwner ? 'Add your rooms' : 'Add your menu items'}</Text>
            <Text style={s.formSubtitle}>Upload food items or rooms with photos. You can add more later from My Venue tab.</Text>
          </View>

          <View style={s.field}>
            <Text style={s.label}>{isHotelOwner ? 'Room Name *' : 'Item Name *'}</Text>
            <TextInput style={s.input} placeholder={isHotelOwner ? 'Deluxe AC Room' : 'Masala Dosa'} placeholderTextColor="#9CA3AF" value={itemTitle} onChangeText={setItemTitle} />
          </View>
          <View style={s.field}>
            <Text style={s.label}>Description</Text>
            <TextInput style={[s.input, { height: 72, textAlignVertical: 'top' }]} placeholder="Details..." placeholderTextColor="#9CA3AF" value={itemDescription} onChangeText={setItemDescription} multiline />
          </View>
          {isRestaurantOwner ? (
            <View style={s.field}>
              <Text style={s.label}>Category</Text>
              <TextInput style={s.input} placeholder="Starter, Main course..." placeholderTextColor="#9CA3AF" value={itemCategory} onChangeText={setItemCategory} />
            </View>
          ) : (
            <View style={s.field}>
              <Text style={s.label}>Capacity (guests)</Text>
              <TextInput style={s.input} placeholder="2" placeholderTextColor="#9CA3AF" value={itemCapacity} onChangeText={setItemCapacity} keyboardType="number-pad" />
            </View>
          )}
          <View style={s.field}>
            <Text style={s.label}>{isHotelOwner ? 'Price per night (₹) *' : 'Price (₹) *'}</Text>
            <TextInput style={s.input} placeholder="499" placeholderTextColor="#9CA3AF" value={itemPrice} onChangeText={setItemPrice} keyboardType="decimal-pad" />
          </View>
          <Pressable style={[s.outlineBtn, { marginBottom: 12 }]} onPress={pickItemPhoto}>
            <Ionicons name="image" size={18} color="#3B82F6" />
            <Text style={s.outlineBtnText}>{itemImageUri ? 'Photo selected' : 'Upload photo'}</Text>
          </Pressable>
          {itemImageUri ? (
            <Image source={{ uri: itemImageUri }} style={{ width: '100%', height: 140, borderRadius: 12, marginBottom: 12 }} contentFit="cover" />
          ) : null}
          <Pressable style={({ pressed }) => [s.outlineBtn, { marginBottom: 16, opacity: pressed ? 0.85 : 1 }]} onPress={addPendingItem}>
            <Ionicons name="add-circle-outline" size={18} color="#3B82F6" />
            <Text style={s.outlineBtnText}>Add to list</Text>
          </Pressable>

          {pendingCount > 0 && (
            <View style={{ marginBottom: 16 }}>
              <Text style={[s.label, { marginBottom: 8 }]}>Added ({pendingCount})</Text>
              {(isRestaurantOwner ? pendingMenuItems : pendingRooms).map((entry, idx) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
                  <Text style={{ flex: 1, color: '#374151', fontSize: 14 }}>
                    {'title' in entry ? entry.title : entry.name}
                  </Text>
                  <Text style={{ color: '#6B46C1', fontWeight: '600' }}>
                    ₹{'price' in entry ? entry.price : entry.pricePerNight}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Pressable
            style={({ pressed }) => [s.primaryBtn, { opacity: (pressed || uploadingSelfie) ? 0.85 : 1 }]}
            onPress={handleComplete}
            disabled={uploadingSelfie}
          >
            {uploadingSelfie ? <ActivityIndicator color="#FFF" /> : (
              <Text style={s.primaryBtnText}>{pendingCount > 0 ? 'Complete Setup' : 'Skip & Complete Setup'}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return null;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  // Welcome
  welcomeScroll: { flexGrow: 1 },
  heroContainer: { width: '100%', height: 280, overflow: 'hidden' },
  heroGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%' },
  welcomeContent: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },
  welcomeTitle: { fontSize: 26, fontWeight: '700', color: '#111827', textAlign: 'center', lineHeight: 34, marginBottom: 10 },
  welcomeSubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  welcomeActions: { gap: 12 },
  // Phone input
  phoneInputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#D1D5DB', borderRadius: 14, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  countryCode: { paddingHorizontal: 14, paddingVertical: 16, borderRightWidth: 1, borderRightColor: '#E5E7EB', backgroundColor: '#F3F4F6' },
  countryCodeText: { fontSize: 16, fontWeight: '700', color: '#111827' },
  phoneInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 16, fontSize: 20, color: '#000000', fontWeight: '700', letterSpacing: 1.5, backgroundColor: '#FFFFFF' },
  phoneHint: { fontSize: 12, color: '#6B7280', marginTop: 6, marginLeft: 4, fontWeight: '600' },
  // Buttons
  primaryBtn: { backgroundColor: '#2563EB', borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, shadowColor: '#2563EB', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 14, paddingVertical: 14 },
  outlineBtnText: { fontSize: 15, fontWeight: '600', color: '#3B82F6' },
  termsText: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: 16, lineHeight: 16 },
  termsLink: { color: '#6B7280', textDecorationLine: 'underline' },
  // Form screens
  formScreen: { flex: 1, paddingHorizontal: 24 },
  scrollContent: { paddingHorizontal: 24 },
  formHeader: { marginBottom: 28 },
  formTitle: { fontSize: 26, fontWeight: '700', color: '#111827', marginBottom: 6 },
  formSubtitle: { fontSize: 15, color: '#6B7280', lineHeight: 22 },
  backBtn: { marginBottom: 24, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#F3F4F6' },
  // OTP
  otpContainer: { marginVertical: 32, paddingHorizontal: 16 },
  otpRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 24 },
  otpBox: { width: 56, height: 68, borderWidth: 2, borderColor: '#E5E7EB', borderRadius: 12, textAlign: 'center', fontSize: 28, fontWeight: '700', color: '#111827', backgroundColor: '#FFFFFF', padding: 0, justifyContent: 'center' },
  otpBoxFilled: { borderColor: '#2563EB', backgroundColor: '#EFF6FF', borderWidth: 2 },
  otpBoxError: { borderColor: '#EF4444', backgroundColor: '#FEE2E2', borderWidth: 2 },
  otpDivider: { fontSize: 24, color: '#D1D5DB', marginHorizontal: 4, fontWeight: '600' },
  errorText: { color: '#EF4444', fontSize: 14, marginTop: 0, marginBottom: 16, textAlign: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  errorIcon: { marginRight: 8 },
  resendArea: { marginBottom: 24, alignItems: 'center' },
  resendText: { fontSize: 14, color: '#6B7280', marginBottom: 8 },
  resendBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  resendBtnText: { color: '#3B82F6', fontSize: 15, fontWeight: '600' },
  timerText: { color: '#9CA3AF', fontSize: 14, fontWeight: '400', marginLeft: 4 },
  // Details
  field: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: '#111827', backgroundColor: '#FAFAFA', justifyContent: 'center' },
  rolesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  roleCard: { width: '47%', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 14, padding: 14, alignItems: 'center', gap: 6, backgroundColor: '#FAFAFA' },
  roleLabel: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  // Selfie
  selfieArea: { alignSelf: 'center', marginVertical: 20 },
  selfiePreview: { width: 160, height: 160, borderRadius: 80 },
  selfiePlaceholder: { width: 160, height: 160, borderRadius: 80, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#E5E7EB', borderStyle: 'dashed' },
  selfieButtons: { flexDirection: 'row', gap: 12, marginHorizontal: 24, marginBottom: 16 },
  rowButtons: { flexDirection: 'row', gap: 12, marginHorizontal: 24 },
  // Skills
  skillsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 100 },
  skillChip: { borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FAFAFA' },
  skillChipSelected: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  skillChipText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  skillChipTextSelected: { color: '#2563EB', fontWeight: '700' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  // Location
  locationBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0FDF4', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20 },
});
