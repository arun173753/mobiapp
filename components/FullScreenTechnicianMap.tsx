import React from 'react';
import { Platform } from 'react-native';
import DirectoryMap from './DirectoryMap';
import type { DirectoryMapProps } from './DirectoryMap';
import FullScreenTechnicianMapWeb from './FullScreenTechnicianMap.web';

/**
 * Web: immersive full-screen Google map with zoom-tier markers and bottom sheet.
 * Native: existing react-native-maps DirectoryMap (same data contract).
 */
export default function FullScreenTechnicianMap(props: DirectoryMapProps) {
  if (Platform.OS === 'web') {
    return <FullScreenTechnicianMapWeb {...props} />;
  }
  return <DirectoryMap {...props} />;
}
