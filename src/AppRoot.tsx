import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors } from '@/src/theme/colors';

type Props = {
  children: React.ReactNode;
};

export function AppRoot({ children }: Props) {
  return (
    <View style={[styles.root, { backgroundColor: Colors.bg }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
