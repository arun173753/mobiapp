import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Alert } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StatusBar } from "expo-status-bar";

// import * as ScreenCapture from "expo-screen-capture"; // Disabled for stability
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Ionicons } from "@expo/vector-icons";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AppProvider, useApp } from "@/lib/context";
import { CartProvider } from "@/lib/cart-context";
import { SecurityProvider } from "@/lib/security";
import { requestNotificationPermission, cleanupSounds } from "@/lib/notifications";
import { FloatingUploadBanner } from "@/components/FloatingUploadBanner";
import { Buffer } from "buffer";

SplashScreen.preventAutoHideAsync();

if (typeof window !== "undefined" && !(window as any).Buffer) {
  (window as any).Buffer = Buffer;
}

function SecuredApp() {
  const { profile, isOnboarded } = useApp();
  const userId = (isOnboarded && profile?.id) ? profile.id : null;
  return (
    <SecurityProvider userId={userId}>
      <Stack screenOptions={{ headerShown: false, headerBackTitle: "Back", contentStyle: { backgroundColor: '#FAFAFA' } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="admin" />
        <Stack.Screen name="chats" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="reels" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="upload-reel" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="user-profile" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="add-product" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="product-detail" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="cart" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="checkout" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="supplier-store" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="shop" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="my-orders" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="seller-orders" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="create-course" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="course-detail" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="course-player" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="courses" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="sell-item" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="buy-sell" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="technician-needs" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="live-chat" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="diagnose" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="select-brand" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="select-model" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="repair-services" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="repair-booking" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="insurance" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="ai-repair" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
      <FloatingUploadBanner />
    </SecurityProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Ionicons.font,
  });
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    try {
      requestNotificationPermission();
    } catch (e) {
      console.warn('[Notifications] Init failed:', e);
    }
    return () => { 
      try {
        cleanupSounds();
      } catch (e) {
        console.warn('[Sounds] Cleanup failed:', e);
      }
    };
  }, []);

  // ScreenCapture disabled - can cause crashes on some Android devices
  // useEffect(() => {
  //   if (Platform.OS === 'web') return;
  //   // Feature disabled for stability
  // }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <CartProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <StatusBar style="dark" />
                <SecuredApp />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </CartProvider>
        </AppProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
