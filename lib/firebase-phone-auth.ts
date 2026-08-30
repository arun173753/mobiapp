import { Platform, Alert } from 'react-native';
import { normalizeIndianMobileDigits } from '@shared/phone-normalize';
import { apiRequest } from './query-client';
import { API_URL } from './api-config';
import { robustFetch } from './api-client';

let currentSessionToken: string | null = null;

export async function initializeRecaptcha(phone: string): Promise<void> {
  // Firebase OTP system - initialization handled by backend
  return;
}

export async function sendFirebaseOTP(phone: string): Promise<{ success: boolean; verifierId?: string; error?: string }> {
  try {
    // Use backend OTP system that works reliably
    // Backend stores OTP and returns it in dev mode for testing
    const digits = normalizeIndianMobileDigits(phone);
    if (!digits) {
      return { success: false, error: 'Invalid phone number' };
    }

    const fullPhone = `+91${digits}`;
    console.log('[Firebase OTP] Requesting OTP for', fullPhone);

    // Call backend OTP service
    const result = await sendFallbackOTP(fullPhone);
    
    if (result.success) {
      console.log('[Firebase OTP] OTP sent successfully');
      console.log('[Firebase OTP] Dev OTP:', result.otp); // Show in console for testing
      return { success: true, error: result.otp ? `Dev: ${result.otp}` : undefined };
    }

    return { success: false, error: result.error || 'Failed to send OTP' };
  } catch (e: any) {
    console.error('[Firebase OTP] Send error:', e);
    return { success: false, error: e?.message || 'Network error' };
  }
}

export type PhoneVerifyResult = {
  success: boolean;
  error?: string;
  verified?: boolean;
  /** Present when success — required for session persistence */
  sessionToken?: string;
  profile?: unknown;
  isNewUser?: boolean;
};

/**
 * Phone OTP verification goes through the same backend as `verifyFallbackOTP`.
 * Returns the full API payload so callers can persist `sessionToken` + `profile`.
 */
export async function verifyFirebaseOTP(phone: string, code: string): Promise<PhoneVerifyResult> {
  try {
    const national = normalizeIndianMobileDigits(phone);
    if (!national) {
      return { success: false, error: 'Invalid phone number', verified: false };
    }
    console.log('[Firebase OTP] Verifying code (backend session):', code);
    const result = await verifyFallbackOTP(national, code);

    if (!result.success) {
      return { success: false, error: result.error || 'Invalid OTP', verified: false };
    }

    const data = result.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') {
      console.error('[Firebase OTP] Missing response body from /api/otp/verify');
      return { success: false, error: 'Invalid server response', verified: false };
    }

    const sessionToken = String((data as any).sessionToken || '').trim();
    if (!sessionToken) {
      console.error('[Firebase OTP] Verify payload missing sessionToken');
      return { success: false, error: 'Invalid server response', verified: false };
    }

    console.log('[Firebase OTP] OTP verified; has sessionToken:', true);
    return {
      success: true,
      verified: true,
      sessionToken,
      profile: (data as any).profile,
      isNewUser: (data as any).isNewUser as boolean | undefined,
    };
  } catch (e: any) {
    console.error('[Firebase OTP] Verify error:', e);
    return { success: false, error: e?.message || 'Network error', verified: false };
  }
}

export async function sendFallbackOTP(
  phone: string,
  options?: { forceResend?: boolean },
): Promise<{ success: boolean; otp?: string; smsSent?: boolean; error?: string }> {
  try {
    const res = await apiRequest('POST', '/api/otp/send', {
      phone,
      forceResend: options?.forceResend === true,
    });
    const data = await res.json();
    
    if (data.success && (data.sent || data.smsSent || data.alreadySent)) {
      console.log('[Fallback OTP] Delivered. smsSent:', data.smsSent, 'alreadySent:', data.alreadySent);
      return { success: true, otp: data.otp, smsSent: data.smsSent };
    }
    
    return { success: false, error: data.message || 'Failed to send OTP' };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Network error' };
  }
}

export async function verifyFallbackOTP(phone: string, code: string): Promise<any> {
  try {
    const national = normalizeIndianMobileDigits(phone);
    if (!national) {
      return { success: false, error: 'Invalid phone number' };
    }
    const otpDigits = String(code || '').replace(/\D/g, '').slice(0, 6);
    const deviceId = await (await import('./device-fingerprint')).getDeviceId();
    const url = new URL('/api/otp/verify', API_URL).toString();
    const res = await robustFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: national, otp: otpDigits, deviceId }),
      timeoutMs: 90_000,
    });
    const data = (await res.json().catch(() => ({}))) as any;

    if (res.ok && data && data.success === true && typeof data.sessionToken === 'string' && data.sessionToken.trim() !== '') {
      console.log('[Fallback OTP] Verified successfully');
      return { success: true, data };
    }

    const msg = data?.message || (res.ok ? 'Verification failed' : `Request failed (${res.status})`);
    return { success: false, error: typeof msg === 'string' ? msg : 'Invalid OTP' };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Network error' };
  }
}

