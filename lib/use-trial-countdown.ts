import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useApp } from '@/lib/context';
import { apiRequest } from '@/lib/query-client';
import type { SubStatus } from '@/lib/subscription-status';

export function formatTrialRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function openSubscriptionScreen() {
  router.push('/subscription-paywall' as any);
}

export function useTrialCountdown() {
  const { profile } = useApp();
  const [status, setStatus] = useState<SubStatus | null>(null);
  const [statusReady, setStatusReady] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);

  const fetchStatus = useCallback(async () => {
    if (!profile?.id) {
      setStatusReady(true);
      return;
    }
    try {
      const res = await apiRequest('GET', `/api/subscription/status/${profile.id}`);
      const data = await res.json();
      if (data?.success) setStatus(data);
    } catch (e) {
      console.warn('[Trial] status', e);
    } finally {
      setStatusReady(true);
    }
  }, [profile?.id]);

  useEffect(() => {
    void fetchStatus();
    const i = setInterval(fetchStatus, 30000);
    return () => clearInterval(i);
  }, [fetchStatus]);

  const trialEndMs = Number(status?.trialEnd || status?.trialEndsAt || 0);
  const trialActive = Boolean(
    status &&
    !status.active &&
    trialEndMs > Date.now() &&
    (status.trialActive !== false || status.accessAllowed),
  );

  useEffect(() => {
    if (!trialActive || !trialEndMs) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      const r = Math.max(0, trialEndMs - Date.now());
      setRemainingMs(r);
      if (r <= 0) void fetchStatus();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [fetchStatus, trialActive, trialEndMs]);

  const visible = trialActive && remainingMs > 0;
  const accessAllowed = Boolean(status?.active || status?.accessAllowed || trialActive);
  const subscriptionEndMs = Number(status?.subscriptionEnd || 0);
  /** Paid plan, running trial, or a subscription end date still in the future. */
  const subscribed = Boolean(status?.active || trialActive || subscriptionEndMs > Date.now());

  return {
    visible,
    remainingMs,
    label: visible ? formatTrialRemaining(remainingMs) : '',
    refresh: fetchStatus,
    accessAllowed,
    subscribed,
    statusReady,
  };
}
