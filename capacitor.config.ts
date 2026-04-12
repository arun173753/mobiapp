import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'Mobiapp.com',
  appName: 'Mobi',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#FFD000",
      showSpinner: false,
      androidScaleType: "CENTER_CROP"
    }
  }
};

export default config;
