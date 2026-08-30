import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IntroSplashControlsProps = {
  soundOn: boolean;
  onToggleSound: () => void;
  onSkip: () => void;
};

export function IntroSplashControls({ soundOn, onToggleSound, onSkip }: IntroSplashControlsProps) {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 12) + 8;

  return (
    <View style={[styles.topBar, { top: topPad }]} pointerEvents="box-none">
      <Pressable style={styles.btn} onPress={onToggleSound} hitSlop={12}>
        <Ionicons name={soundOn ? 'volume-high' : 'volume-mute'} size={20} color="#FFFFFF" />
        <Text style={styles.btnText}>{soundOn ? 'Sound on' : 'Sound'}</Text>
      </Pressable>
      <Pressable style={styles.btn} onPress={onSkip} hitSlop={12}>
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 20,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  skipText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
});
