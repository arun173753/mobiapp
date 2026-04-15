import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Alert, Platform } from "react-native";
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
import { initOneSignal, requestOneSignalPermission } from "@/lib/onesignal";
import { ensureHighPriorityChannel } from "@/lib/notifee";
import { FloatingUploadBanner } from "@/components/FloatingUploadBanner";
import { Buffer } from "buffer";
import { API_URL } from "@/lib/api-config";

SplashScreen.preventAutoHideAsync();

if (typeof window !== "undefined" && !(window as any).Buffer) {
  (window as any).Buffer = Buffer;
}

try {
  console.log("ENV CHECK:", {
    api: process.env.EXPO_PUBLIC_API_URL,
    firebase: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ? "OK" : "MISSING",
  });
  console.log("API URL:", API_URL);
} catch (e) {
  console.error("API URL: (missing)", e);
}

function SecuredApp() {
  const { profile, isOnboarded } = useApp();
  const userId = (isOnboarded && profile?.id) ? profile.id : null;
  return (
    <SecurityProvider userId={userId}>
      <Stack screenOptions={{ headerShown: false, headerBackTitle: "Back", contentStyle: { backgroundColor: '#FAFAFA' } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="map" options={{ animation: 'fade' }} />
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
      // Android: create a high-importance channel for sound/vibration.
      ensureHighPriorityChannel().catch(() => {});

      // OneSignal first (APK / dev client), then system notification permission.
      initOneSignal()
        .then(() => requestOneSignalPermission().catch(() => {}))
        .catch(() => {});
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

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const styleId = "reels-web-video-css";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .reels-web-video::-webkit-media-controls {
        display: none !important;
      }
      .reels-web-video::-webkit-media-controls-enclosure {
        display: none !important;
      }
      .reels-web-video {
        outline: none;
      }
    `;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }

    const focusFallback = () => {
      const body = document.body as HTMLBodyElement | null;
      if (!body) return;
      const hadTabIndex = body.hasAttribute("tabindex");
      if (!hadTabIndex) body.setAttribute("tabindex", "-1");
      try {
        body.focus({ preventScroll: true });
      } catch {
        // ignore
      }
      if (!hadTabIndex) body.removeAttribute("tabindex");
    };

    const syncHiddenState = (node: Element | null) => {
      if (!node || !(node instanceof HTMLElement)) return;
      const hiddenByAria = node.getAttribute("aria-hidden") === "true";
      const hiddenByInert = node.hasAttribute("inert");
      const shouldDisable = hiddenByAria || hiddenByInert;

      if (hiddenByAria && !hiddenByInert) {
        node.inert = true;
        node.dataset.cursorAutoInert = "1";
      } else if (!hiddenByAria && node.dataset.cursorAutoInert === "1") {
        node.inert = false;
        delete node.dataset.cursorAutoInert;
      }

      if (!shouldDisable) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && node.contains(active)) {
        try {
          active.blur();
        } catch {
          // ignore
        }
        focusFallback();
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "attributes") continue;
        syncHiddenState(mutation.target as Element);
      }
    });

    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "inert"],
    });

    return () => observer.disconnect();
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
