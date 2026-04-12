import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Theme } from '../theme/theme';

type Props = {
  size?: number;
  strokeWidth?: number;
  progress: number; // 0..1
  label?: string;
  valueText?: string;
  color?: string;
};

export function ProgressRing({
  size = 84,
  strokeWidth = 10,
  progress,
  label,
  valueText,
  color = Theme.colors.primary,
}: Props) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  const dashOffset = c * (1 - p);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={Theme.colors.stroke}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={dashOffset}
          fill="none"
          rotation={-90}
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
      <View style={styles.center}>
        {valueText ? <Text style={styles.value}>{valueText}</Text> : null}
        {label ? <Text style={styles.label}>{label}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    color: Theme.colors.text,
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 0.2,
  },
  label: {
    color: Theme.colors.muted,
    fontWeight: '700',
    fontSize: 11,
    marginTop: 2,
  },
});

