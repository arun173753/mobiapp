import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/query-client';

export interface InsuranceSettings {
  planName: string;
  planTagline: string;
  protectionPlanPrice: number;
  yearlyPrice?: number;
  monthlyPrice?: number;
  minMonths: number;
  repairDiscount: number;
  savingsText: string;
  features: string[];
  buttonText: string;
  status: 'active' | 'disabled';
}

const DEFAULT_SETTINGS: InsuranceSettings = {
  planName: 'Mobile Protection Plan',
  planTagline: 'Protect Your Phone',
  protectionPlanPrice: 50,
  yearlyPrice: 1499,
  monthlyPrice: 249,
  minMonths: 3,
  repairDiscount: 500,
  savingsText: 'Save up to ₹4000 on repairs',
  features: ['Screen damage', 'Doorstep service'],
  buttonText: 'Get Protection',
  status: 'active',
};

let cachedSettings: InsuranceSettings | null = null;
let fetchPromise: Promise<InsuranceSettings> | null = null;

export function useInsuranceSettings() {
  const [settings, setSettings] = useState<InsuranceSettings>(cachedSettings ?? DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(!cachedSettings);

  const refresh = useCallback(async () => {
    try {
      cachedSettings = null;
      fetchPromise = null;
      
      if (!fetchPromise) {
        fetchPromise = apiRequest('GET', '/api/settings/insurance')
          .then(r => r.json())
          .then(data => {
            if (data.success && data.settings) {
              cachedSettings = data.settings;
              return data.settings as InsuranceSettings;
            }
            return DEFAULT_SETTINGS;
          })
          .catch(() => DEFAULT_SETTINGS)
          .finally(() => { fetchPromise = null; });
      }
      const result = await fetchPromise;
      setSettings(result);
    } catch {
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cachedSettings) {
      refresh();
    } else {
      setLoading(false);
    }
  }, []);

  return { settings, loading, refresh };
}

export function invalidateInsuranceCache() {
  cachedSettings = null;
  fetchPromise = null;
}
