import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Theme } from '../theme/theme';

type Props = {
  label: string;
  value: string | number | null | undefined;
};

export function StatRow({ label, value }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>
        {value === null || value === undefined || value === '' ? '—' : value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.stroke,
  },
  label: {
    color: Theme.colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  value: {
    color: Theme.colors.text,
    fontSize: 13,
    fontWeight: '700',
    maxWidth: '55%',
    textAlign: 'right',
  },
});

