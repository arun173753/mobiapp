import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const DEVICE_ID_KEY = '@mobi_device_id';

export async function getDeviceId(): Promise<string> {
  try {
    const existingId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existingId) {
      return existingId;
    }

    let newId: string;
    try {
      newId = await Crypto.randomUUID();
    } catch (e) {
      // Fallback for devices where Crypto.randomUUID() fails
      newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    }
    
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    return newId;
  } catch (e) {
    console.warn('[DeviceId] Error:', e);
    // Final fallback
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }
}
