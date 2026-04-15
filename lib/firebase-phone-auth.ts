import { Platform, Alert } from 'react-native';
import { apiRequest, getApiUrl } from './query-client';

let currentSessionToken: string | null = null;

export async function initializeRecaptcha(phone: string): Promise<void> {
  // Firebase OTP system - initialization handled by backend
  return;
}

export async function sendFirebaseOTP(phone: string): Promise<{ success: boolean; verifierId?: string; error?: string }> {
  try {
    // Use backend OTP system that works reliably
    // Backend stores OTP and returns it in dev mode for testing
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (!digits || digits.length !== 10) {
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
    console.log('[Firebase OTP] Verifying code (backend session):', code);
    const result = await verifyFallbackOTP(phone, code);

    if (!result.success) {
      return { success: false, error: result.error || 'Invalid OTP', verified: false };
    }

    const data = result.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') {
      console.error('[Firebase OTP] Missing response body from /api/otp/verify');
      return { success: false, error: 'Invalid server response', verified: false };
    }

    console.log('[Firebase OTP] OTP verified; has sessionToken:', !!(data as any).sessionToken);
    return {
      success: true,
      verified: true,
      sessionToken: String((data as any).sessionToken || ''),
      profile: (data as any).profile,
      isNewUser: (data as any).isNewUser as boolean | undefined,
    };
  } catch (e: any) {
    console.error('[Firebase OTP] Verify error:', e);
    return { success: false, error: e?.message || 'Network error', verified: false };
  }
}

export async function sendFallbackOTP(phone: string): Promise<{ success: boolean; otp?: string; smsSent?: boolean; error?: string }> {
  try {
    const res = await apiRequest('POST', '/api/otp/send', { phone });
    const data = await res.json();
    
    if (data.success) {
      console.log('[Fallback OTP] Generated. smsSent:', data.smsSent);
      return { success: true, otp: data.otp, smsSent: data.smsSent };
    }
    
    return { success: false, error: data.message || 'Failed to send OTP' };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Network error' };
  }
}

export async function verifyFallbackOTP(phone: string, code: string): Promise<any> {
  try {
    const deviceId = await (await import('./device-fingerprint')).getDeviceId();
    const baseUrl = getApiUrl();
    const res = await fetch(new URL('/api/otp/verify', baseUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp: code, deviceId }),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    
    if (data.success) {
      console.log('[Fallback OTP] Verified successfully');
      return { success: true, data };
    }
    
    return { success: false, error: data.message || 'Invalid OTP' };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Network error' };
  }
}

