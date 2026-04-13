import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs, usePathname } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import Colors from "@/constants/colors";
import { useApp } from "@/lib/context";
import SubscriptionLockScreen from "@/components/SubscriptionLockScreen";
import { isAdminUser } from "@/lib/types";

const C = Colors.light;

function NativeTabLayout() {
  const { profile, navigationMode } = useApp();
  const isCustomer = profile?.role === 'customer';
  const isTechnician = profile?.role === 'technician';
  const isTeacher = profile?.role === 'teacher';
  const isSupplier = profile?.role === 'supplier';
  const isShopkeeper = profile?.role === 'shopkeeper';
  const isAdminTabs = isAdminUser(profile);

  const getRoleTab = () => {
    if (isTeacher) return { name: 'content', icon: 'radio', label: 'Live' };
    if (isSupplier || isShopkeeper) return { name: 'products', icon: 'cube', label: 'My Store' };
    return { name: 'marketplace', icon: 'bag', label: 'Shop' };
  };

  const roleTab = getRoleTab();

  if (isCustomer) {
    return (
      <NativeTabs initialRouteName="customer-home">
        <NativeTabs.Trigger name="customer-home">
          <Icon sf={{ default: "house", selected: "house.fill" }} />
          <Label>Home</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="directory">
          <Icon sf={{ default: "wrench.and.screwdriver", selected: "wrench.and.screwdriver.fill" }} />
          <Label>Directory</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="buy-sell">
          <Icon sf={{ default: "tag", selected: "tag.fill" }} />
          <Label>Buy & Sell</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="create">
          <Icon sf={{ default: "plus.circle", selected: "plus.circle.fill" }} />
          <Label>Training</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="orders">
          <Icon sf={{ default: "wrench.adjustable", selected: "wrench.adjustable.fill" }} />
          <Label>Ask for Repair</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="marketplace">
          <Icon sf={{ default: "bag", selected: "bag.fill" }} />
          <Label>Shop</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="support" hidden />
        <NativeTabs.Trigger name="index" hidden />
        <NativeTabs.Trigger name="jobs" hidden />
        <NativeTabs.Trigger name="content" hidden />
        <NativeTabs.Trigger name="products" hidden />
        <NativeTabs.Trigger name="nearby" hidden />
        <NativeTabs.Trigger name="profile" hidden />
        <NativeTabs.Trigger name="tech-market" hidden />
        <NativeTabs.Trigger name="nearby-shops" hidden />
        <NativeTabs.Trigger name="learn" hidden />
        <NativeTabs.Trigger name="reels-tab" hidden />
        <NativeTabs.Trigger name="leads" hidden />
      </NativeTabs>
    );
  }

  if (isTechnician) {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="index">
          <Icon sf={{ default: "house", selected: "house.fill" }} />
          <Label>Home</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="directory">
          <Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
          <Label>Directory</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="leads">
          <Icon sf={{ default: "briefcase", selected: "briefcase.fill" }} />
          <Label>Leads</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="marketplace">
          <Icon sf={{ default: "bag", selected: "bag.fill" }} />
          <Label>Shop</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="tech-market">
          <Icon sf={{ default: "tag", selected: "tag.fill" }} />
          <Label>Buy & Sell</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="reels-tab" hidden />
        <NativeTabs.Trigger name="create" hidden />
        <NativeTabs.Trigger name="nearby" hidden />
        <NativeTabs.Trigger name="customer-home" hidden />
        <NativeTabs.Trigger name="orders" hidden />
        <NativeTabs.Trigger name="jobs" hidden />
        <NativeTabs.Trigger name="technician-jobs" hidden />
        <NativeTabs.Trigger name="profile" hidden />
        <NativeTabs.Trigger name="buy-sell" hidden />
        <NativeTabs.Trigger name="content" hidden={true} />
        <NativeTabs.Trigger name="products" hidden={true} />
        <NativeTabs.Trigger name="nearby-shops" hidden />
        <NativeTabs.Trigger name="learn" hidden />
      </NativeTabs>
    );
  }

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="directory">
        <Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
        <Label>Directory</Label>
      </NativeTabs.Trigger>
      {isAdminTabs ? (
        <NativeTabs.Trigger name="leads">
          <Icon sf={{ default: "briefcase", selected: "briefcase.fill" }} />
          <Label>Leads</Label>
        </NativeTabs.Trigger>
      ) : (
        <NativeTabs.Trigger name="leads" hidden />
      )}
      <NativeTabs.Trigger name="create">
        <Icon sf={{ default: "plus.circle", selected: "plus.circle.fill" }} />
        <Label>Post</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name={roleTab.name}>
        <Icon sf={{ default: roleTab.icon, selected: `${roleTab.icon}.fill` }} />
        <Label>{roleTab.label}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="customer-home" hidden />
      <NativeTabs.Trigger name="nearby-shops" hidden />
      <NativeTabs.Trigger name="nearby" hidden />
      <NativeTabs.Trigger name="orders" hidden />
      <NativeTabs.Trigger name="jobs" hidden />
      <NativeTabs.Trigger name="technician-jobs" hidden />
      <NativeTabs.Trigger name="buy-sell" hidden />
      <NativeTabs.Trigger name="tech-market" hidden />
      <NativeTabs.Trigger name="content" hidden={true} />
      <NativeTabs.Trigger name="products" hidden={true} />
      <NativeTabs.Trigger name="learn" hidden={true} />
      <NativeTabs.Trigger name="marketplace" hidden={true} />
      <NativeTabs.Trigger name="reels-tab" hidden />
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const isWeb = Platform.OS === "web";
  const isIOS = Platform.OS === "ios";
  const pathname = usePathname();
  const { profile, navigationMode } = useApp();
  const isCustomer = profile?.role === 'customer';
  const isTechnician = profile?.role === 'technician';
  const isTeacher = profile?.role === 'teacher';
  const isSupplier = profile?.role === 'supplier';
  const isShopkeeper = profile?.role === 'shopkeeper';
  const isAdminTabs = isAdminUser(profile);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.tabIconSelected,
        tabBarInactiveTintColor: C.tabIconDefault,
        tabBarStyle: {
          position: "absolute",
          display: pathname === '/reels' ? 'none' : 'flex',
          backgroundColor: isIOS ? "transparent" : C.surface,
          borderTopWidth: 1,
          borderTopColor: C.border,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.08,
          shadowRadius: 8,
          height: isWeb ? 84 : undefined,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint="light"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: C.surface },
              ]}
            />
          ) : null,
      }}
    >
      {/* --- Tab 1: Home (customer) or Feed (others) --- */}
      <Tabs.Screen
        name="customer-home"
        options={{
          title: "Home",
          href: isCustomer ? '/customer-home' : null,
          tabBarIcon: ({ focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={20} color={focused ? "#4F46E5" : "#999"} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          href: isCustomer ? null : '/',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={24} color={color} />
          ),
        }}
      />
      {/* --- Tab 2: Find Nearby (customer) or Directory (others) --- */}
      <Tabs.Screen
        name="directory"
        options={{
          title: isCustomer ? "Find Nearby" : "Directory",
          href: '/directory',
          tabBarIcon: ({ focused }) => (
            <Ionicons
              name={isCustomer ? (focused ? "construct" : "construct-outline") : (focused ? "people" : "people-outline")}
              size={20}
              color={isCustomer ? (focused ? "#F59E0B" : "#999") : (focused ? "#4F46E5" : "#999")}
            />
          ),
        }}
      />
      {/* --- Reels tab: hidden from navigation --- */}
      <Tabs.Screen
        name="reels-tab"
        options={{
          title: "Reels",
          href: null,
          tabBarIcon: ({ focused }) => (
            <Ionicons name={focused ? "play-circle" : "play-circle-outline"} size={24} color={focused ? "#8B5CF6" : "#999"} />
          ),
        }}
      />
      {/* --- Tab 3 (customer only): Buy & Sell --- */}
      <Tabs.Screen
        name="buy-sell"
        options={{
          title: "Buy & Sell",
          href: isCustomer ? '/buy-sell' : null,
          tabBarIcon: ({ focused }) => (
            <Ionicons name={focused ? "pricetag" : "pricetag-outline"} size={20} color={focused ? "#EF4444" : "#999"} />
          ),
        }}
      />
      {/* --- Nearby/Suppliers (hidden for all) --- */}
      <Tabs.Screen
        name="nearby"
        options={{
          href: null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "storefront" : "storefront-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="nearby-shops"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: "Post",
          href: null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "add-circle" : "add-circle-outline"} size={24} color={color} />
          ),
        }}
      />
      {/* --- Tab 4/5: Ask for Repair (customer) or Role tab (others) --- */}
      <Tabs.Screen
        name="orders"
        options={{
          title: isCustomer ? "Ask for Repair" : "Orders",
          href: isCustomer ? '/orders' : null,
          tabBarIcon: ({ focused }) => (
            <Ionicons name={focused ? "help-circle" : "help-circle-outline"} size={20} color={focused ? "#8B5CF6" : "#999"} />
          ),
        }}
      />
      <Tabs.Screen
        name="content"
        options={{
          title: "Live",
          href: isTeacher && navigationMode === 'default' ? '/content' : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "radio" : "radio-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: "My Store",
          href: (isSupplier || isShopkeeper) && navigationMode === 'default' ? '/products' : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "cube" : "cube-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="marketplace"
        options={{
          title: "Shop",
          href: (isCustomer || isTechnician) && navigationMode === 'default' ? '/marketplace' : null,
          tabBarIcon: ({ focused }) => {
            let iconColor = "#999";
            if (focused) {
              iconColor = isCustomer ? "#F97316" : "#4F46E5";
            }
            return <Ionicons name={focused ? "bag" : "bag-outline"} size={20} color={iconColor} />;
          },
        }}
      />
      {/* --- Tab 5: Buy & Sell (technician) or Profile (other non-customer roles) --- */}
      <Tabs.Screen
        name="leads"
        options={{
          title: "Leads",
          href:
            !isCustomer &&
            (isTechnician || isAdminTabs) &&
            navigationMode === 'default'
              ? '/leads'
              : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "briefcase" : "briefcase-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tech-market"
        options={{
          title: "Buy & Sell",
          href: isTechnician ? '/tech-market' : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "pricetag" : "pricetag-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          href: null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={22} color={color} />
          ),
        }}
      />
      {/* --- Hidden screens --- */}
      <Tabs.Screen
        name="support"
        options={{
          title: "Support",
          href: null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "headset" : "headset-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: "Jobs",
          href: null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "briefcase" : "briefcase-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="technician-jobs"
        options={{
          title: "Jobs",
          href: null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "construct" : "construct-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: "Learn",
          href: null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "bulb" : "bulb-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { profile } = useApp();
  const isAdmin = isAdminUser(profile);
  const needsSub = (profile?.role === 'technician' || profile?.role === 'supplier' || profile?.role === 'shopkeeper' || profile?.role === 'teacher') && !isAdmin;

  const tabs = isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;

  if (needsSub) {
    return <SubscriptionLockScreen>{tabs}</SubscriptionLockScreen>;
  }

  return tabs;
}
