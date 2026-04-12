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

export async function verifyFirebaseOTP(code: string): Promise<{ success: boolean; error?: string; verified?: boolean }> {
  try {
    // Verify OTP using backend - NO AUTO-LOGIN, just verification
    console.log('[Firebase OTP] Verifying code:', code);
    
    const result = await verifyFallbackOTP('', code); // Phone not needed for verification
    
    if (result.success) {
      console.log('[Firebase OTP] OTP verified successfully');
      return { success: true, verified: true };
    }

    return { success: false, error: result.error || 'Invalid OTP', verified: false };
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
    const res = await apiRequest('POST', '/api/otp/verify', { phone, otp: code, deviceId });
    const data = await res.json();
    
    if (data.success) {
      console.log('[Fallback OTP] Verified successfully');
      return { success: true, data };
    }
    
    return { success: false, error: data.message || 'Invalid OTP' };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Network error' };
  }
}

