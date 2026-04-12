// OLD NEARBY SCREEN - DEPRECATED
// Use /nearby instead
// This file is kept for backward compatibility but should not be used

import { Redirect } from 'expo-router';

export default function DeprecatedNearbyShops() {
  return <Redirect href="/nearby" />;
}
