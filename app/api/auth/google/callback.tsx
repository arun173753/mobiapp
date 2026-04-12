import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getApiUrl } from '@/lib/query-client';

export default function GoogleCallbackPage() {
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing sign-in...');

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const processCallback = async () => {
      if (params.error) {
        setStatus('error');
        setMessage(`Google returned an error: ${params.error}`);
        return;
      }

      if (!params.code) {
        setStatus('error');
        setMessage('No authorization code received.');
        return;
      }

      try {
        const url = new URL('/api/auth/google/process-code', getApiUrl()).toString();
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: params.code, state: params.state || '' }),
        });

        const data = await res.json();

        if (data.success) {
          setStatus('success');
          setMessage('Signed in successfully! Go back to the Mobi app to continue.');
        } else {
          setStatus('error');
          setMessage(data.message || 'Authentication failed.');
        }
      } catch (e: any) {
        console.error('[GoogleCallback] Error:', e);
        setStatus('error');
        setMessage('Could not connect to the server. Please try again.');
      }
    };

    processCallback();
  }, []);

  return (
    <View style={styles.container}>
      {status === 'loading' && (
        <>
          <ActivityIndicator size="large" color="#FF6B35" />
          <Text style={styles.text}>{message}</Text>
        </>
      )}
      {status === 'success' && (
        <>
          <Text style={styles.checkmark}>{'\u2713'}</Text>
          <Text style={styles.title}>Signed in!</Text>
          <Text style={styles.text}>{message}</Text>
          <Text style={styles.sub}>You can close this window</Text>
        </>
      )}
      {status === 'error' && (
        <>
          <Text style={styles.errorIcon}>!</Text>
          <Text style={[styles.title, { color: '#FF6B35' }]}>Sign-in Failed</Text>
          <Text style={styles.text}>{message}</Text>
          <Text style={styles.sub}>Please go back to the Mobi app and try again</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0F',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  checkmark: {
    fontSize: 48,
    color: '#4CAF50',
    marginBottom: 16,
  },
  errorIcon: {
    fontSize: 48,
    color: '#FF6B35',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '600' as const,
    color: '#fff',
    marginBottom: 8,
  },
  text: {
    fontSize: 15,
    color: '#aaa',
    textAlign: 'center' as const,
    marginTop: 16,
  },
  sub: {
    fontSize: 13,
    color: '#666',
    marginTop: 16,
  },
});
