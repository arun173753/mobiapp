import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { UploadManager } from '@/lib/upload-manager';

const ORANGE = '#FF6B2C';

export function FloatingUploadBanner() {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    const unsubscribe = UploadManager.subscribe(() => {
      setIsUploading(UploadManager.isUploading());
      setProgress(UploadManager.getProgress());
      setMessage(UploadManager.getMessage());
      setFileName(UploadManager.getFileName());
    });
    return unsubscribe;
  }, []);

  const [suppressed, setSuppressed] = useState(false);

  useEffect(() => {
    const unsub = UploadManager.subscribe(() => {
      setSuppressed(UploadManager.isBannerSuppressed());
    });
    return unsub;
  }, []);

  if (!isUploading && progress === 0) return null;
  if (suppressed) return null;

  const handleCancel = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    UploadManager.cancel();
  };

  return (
    <View style={styles.banner}>
      <View style={styles.topRow}>
        <View style={styles.iconWrap}>
          <Ionicons name="cloud-upload-outline" size={18} color={ORANGE} />
        </View>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {progress === 100 ? 'Upload Complete!' : 'Uploading in background...'}
          </Text>
          {fileName ? <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text> : null}
        </View>
        {isUploading && (
          <Pressable style={styles.cancelBtn} onPress={handleCancel} hitSlop={10}>
            <Ionicons name="close-circle" size={22} color="#999" />
          </Pressable>
        )}
        {!isUploading && progress === 100 && (
          <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
        )}
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${progress}%` as any }]} />
      </View>
      <Text style={styles.pctText}>{message || `${progress}%`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 90 : 90,
    left: 16,
    right: 16,
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    padding: 14,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 12,
    zIndex: 9999,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: ORANGE + '22',
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: { flex: 1 },
  title: { color: '#FFF', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  fileName: { color: '#888', fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  cancelBtn: { padding: 2 },
  barBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#333',
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: ORANGE,
  },
  pctText: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    textAlign: 'right',
  },
});
