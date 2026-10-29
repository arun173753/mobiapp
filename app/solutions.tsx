import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  confirmSolutionsDelete,
  deleteSolutionsBrand,
  deriveSolutionsBrands,
  fetchSolutionsFolders,
  renameSolutionsBrand,
  setSolutionsBrandDemo,
  uploadSolutionsBrandLogo,
  SolutionsBrand,
  SolutionsModel,
} from "@/lib/solutions-api";
import { PremiumFolderGrid, PremiumFolderGridItem } from "@/components/folders/PremiumFolderGrid";
import SolutionsNameEditModal from "@/components/solutions/SolutionsNameEditModal";
import { useApp } from "@/lib/context";
import { isAdminUser } from "@/lib/types";
import { canOpenFullHardwareSolutions } from "@/lib/subscription-gate";
import { useTrialCountdown } from "@/lib/use-trial-countdown";

/** Material 3-inspired palette. Bright blue primary + off-white canvas + soft white cards. */
const PRIMARY = "#1E66F5";
const PRIMARY_DARK = "#1A54CC";
const BG = "#F1F5FB";
const TEXT = "#0F172A";
const MUTED = "#64748B";

export default function SolutionsScreen() {
  const { profile } = useApp();
  const { subscribed, statusReady } = useTrialCountdown();
  const isAdmin = isAdminUser(profile);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<SolutionsModel[]>([]);
  const [query, setQuery] = useState("");
  const [editBrand, setEditBrand] = useState<string | null>(null);
  const [editBrandValue, setEditBrandValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await fetchSolutionsFolders();
      setModels(data);
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load"));
      setModels([]);
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const brands: SolutionsBrand[] = useMemo(() => deriveSolutionsBrands(models), [models]);

  const filteredBrands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.name.toLowerCase().includes(q));
  }, [brands, query]);

  const openBrand = useCallback((b: SolutionsBrand) => {
    const access = canOpenFullHardwareSolutions(profile) || subscribed;
    if (!access && !b.isDemo) {
      if (!statusReady) return;
      router.push("/subscription-paywall" as any);
      return;
    }
    router.push(`/solutions-brand?name=${encodeURIComponent(b.name)}` as any);
  }, [profile, statusReady, subscribed]);

  const onAddBrandLogo = useCallback(async (name: string) => {
    try {
      await uploadSolutionsBrandLogo(name, "hardware");
      await load(true);
    } catch (e: any) {
      Alert.alert("Logo failed", e?.message || "Could not update brand logo.");
    }
  }, [load]);

  const onDeleteBrand = useCallback(async (name: string) => {
    const ok = await confirmSolutionsDelete(
      "Delete brand",
      `Delete "${name}" and every uploaded folder/file under it? This cannot be undone.`,
    );
    if (!ok) return;
    try {
      await deleteSolutionsBrand(models, name);
      await load(true);
    } catch (e: any) {
      Alert.alert("Delete failed", e?.message || "Could not delete this brand.");
    }
  }, [load, models]);

  const onSaveBrandName = useCallback(async () => {
    const from = String(editBrand || "").trim();
    const to = editBrandValue.trim();
    if (!from || !to) return;
    setEditSaving(true);
    try {
      await renameSolutionsBrand(from, to, "hardware");
      setEditBrand(null);
      await load(true);
    } catch (e: any) {
      Alert.alert("Rename failed", e?.message || "Could not rename brand.");
    } finally {
      setEditSaving(false);
    }
  }, [editBrand, editBrandValue, load]);

  const onToggleDemo = useCallback(async (name: string, next: boolean) => {
    try {
      await setSolutionsBrandDemo(name, next, "hardware");
      await load(true);
    } catch (e: any) {
      Alert.alert("Demo failed", e?.message || "Could not update free demo.");
    }
  }, [load]);

  const fullAccess = canOpenFullHardwareSolutions(profile) || subscribed;
  const demoBrands = useMemo(() => filteredBrands.filter((b) => b.isDemo), [filteredBrands]);
  const otherBrands = useMemo(() => filteredBrands.filter((b) => !b.isDemo), [filteredBrands]);

  const toGridItem = useCallback((b: SolutionsBrand): PremiumFolderGridItem => ({
    id: b.name,
    name: b.name,
    imageUrl: b.brandImageUrl,
    countLabel: `${b.fileCount} file${b.fileCount === 1 ? "" : "s"} · ${b.folderCount} folder${b.folderCount === 1 ? "" : "s"}`,
    fallbackIcon: "folder",
    badge: b.isDemo ? "FREE DEMO" : undefined,
    locked: !fullAccess && !b.isDemo && statusReady,
    onPress: () => openBrand(b),
    onEditImage: isAdmin ? () => { void onAddBrandLogo(b.name); } : undefined,
    onEditName: isAdmin
      ? () => {
          setEditBrand(b.name);
          setEditBrandValue(b.name);
        }
      : undefined,
    onDelete: isAdmin ? () => { void onDeleteBrand(b.name); } : undefined,
    onToggleDemo: isAdmin ? () => { void onToggleDemo(b.name, !b.isDemo); } : undefined,
    demoOn: Boolean(b.isDemo),
  }), [fullAccess, isAdmin, onAddBrandLogo, onDeleteBrand, onToggleDemo, openBrand, statusReady]);

  const brandItems = useMemo<PremiumFolderGridItem[]>(
    () => otherBrands.map(toGridItem),
    [otherBrands, toGridItem],
  );

  const demoHeader = demoBrands.length === 0 && !isAdmin ? null : (
    <View style={styles.demoWrap}>
      <View style={styles.demoHead}>
        <Ionicons name="play-circle" size={22} color="#B45309" />
        <View style={{ flex: 1 }}>
          <Text style={styles.demoTitle}>Hardware Solutions Demo</Text>
          <Text style={styles.demoHint}>
            {isAdmin
              ? "Tap Free demo on a brand to let everyone open it without a subscription."
              : "Open these models freely. Other models need a subscription."}
          </Text>
        </View>
      </View>
      {demoBrands.length === 0 ? (
        <Text style={styles.demoEmpty}>No free demo models yet.</Text>
      ) : (
        <View style={styles.demoGrid}>
          {demoBrands.map((b) => {
            const item = toGridItem(b);
            return (
              <View key={b.name} style={styles.demoCard}>
                <Pressable onPress={item.onPress}>
                  <View style={styles.demoImageWrap}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.demoImage} contentFit="contain" />
                    ) : (
                      <Ionicons name="folder" size={36} color="#1E66F5" />
                    )}
                    <View style={styles.demoBadge}>
                      <Text style={styles.demoBadgeText}>FREE DEMO</Text>
                    </View>
                  </View>
                  <Text style={styles.demoCardName} numberOfLines={1}>{b.name}</Text>
                  <Text style={styles.demoCardCount}>{item.countLabel}</Text>
                </Pressable>
                {isAdmin ? (
                  <Pressable onPress={item.onToggleDemo} style={styles.demoOffBtn}>
                    <Text style={styles.demoOffText}>Remove demo</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {otherBrands.length > 0 ? <Text style={styles.allTitle}>All models</Text> : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor={PRIMARY_DARK} barStyle="light-content" />

      {/* Blue Material-3 top app bar */}
      <View style={styles.appBar}>
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
          }}
          hitSlop={12}
          style={({ pressed }) => [styles.appBarBtn, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="menu" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.appBarTitle}>Hardware Solutions</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={MUTED} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search brand…"
            placeholderTextColor={MUTED}
            style={styles.searchInput}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={MUTED} />
            </Pressable>
          )}
        </View>
        {isAdmin ? (
          <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 11, marginTop: 8, fontFamily: "Inter_500Medium" }}>
            Admin: use Add logo and Edit name on each brand.
          </Text>
        ) : null}
      </View>

      {loading ? (
        <BrandGridShimmer />
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={36} color="#EF4444" />
          <Text style={[styles.centerText, { marginTop: 10, textAlign: "center" }]}>{error}</Text>
          <Pressable onPress={() => load(false)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <PremiumFolderGrid
          items={brandItems}
          header={demoHeader}
          hideEmpty={demoBrands.length > 0}
          emptyTitle={query ? "No brands match your search" : "No solutions yet"}
          emptyHint={query ? "Try a different keyword." : "The admin will upload brands and folders soon."}
          contentPaddingBottom={40}
          refreshing={refreshing}
          onRefresh={() => { void load(true); }}
        />
      )}

      <SolutionsNameEditModal
        visible={!!editBrand}
        title="Edit brand name"
        modelLabel="Brand name"
        model={editBrandValue}
        onChangeModel={setEditBrandValue}
        saving={editSaving}
        onSave={() => { void onSaveBrandName(); }}
        onClose={() => setEditBrand(null)}
      />
    </View>
  );
}

function BrandGridShimmer() {
  const placeholders = Array.from({ length: 6 });
  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.grid}>
        {placeholders.map((_, i) => (
          <View key={i} style={[styles.card, styles.cardShimmer]}>
            <View style={[styles.cardImageWrap, { backgroundColor: "#E2E8F0" }]} />
            <View style={{ height: 14, width: "70%", backgroundColor: "#E2E8F0", borderRadius: 6, marginTop: 12 }} />
            <View style={{ height: 10, width: "40%", backgroundColor: "#EEF2F7", borderRadius: 6, marginTop: 6 }} />
          </View>
        ))}
      </View>
      <View style={{ alignItems: "center", marginTop: 8 }}>
        <ActivityIndicator size="small" color={PRIMARY} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  appBar: {
    backgroundColor: PRIMARY,
    paddingTop: Platform.OS === "android" ? 36 : 52,
    paddingBottom: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  appBarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  appBarTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },

  searchWrap: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  searchBar: {
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    color: TEXT,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    padding: 0,
  },

  scroll: {
    padding: 14,
    paddingBottom: 36,
  },
  cardShimmer: { opacity: 0.6 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  centerText: { color: TEXT, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  retryBtn: {
    marginTop: 14,
    backgroundColor: PRIMARY,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 22,
  },
  retryText: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 13 },

  demoWrap: { paddingHorizontal: 2, paddingBottom: 8 },
  demoHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFBEB",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    marginBottom: 12,
  },
  demoTitle: { color: "#92400E", fontFamily: "Inter_700Bold", fontSize: 15 },
  demoHint: { color: "#B45309", fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  demoEmpty: { color: MUTED, fontFamily: "Inter_400Regular", fontSize: 13, marginBottom: 12, paddingHorizontal: 4 },
  demoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  demoCard: {
    width: "47%",
    flexGrow: 1,
    maxWidth: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  demoImageWrap: {
    width: "100%",
    aspectRatio: 1.35,
    borderRadius: 12,
    backgroundColor: "#FFFBEB",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  demoImage: { width: "100%", height: "100%" },
  demoBadge: {
    position: "absolute",
    left: 8,
    top: 8,
    backgroundColor: "#F59E0B",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  demoBadgeText: { color: "#FFFFFF", fontSize: 10, fontFamily: "Inter_700Bold" },
  demoCardName: { color: TEXT, marginTop: 8, fontSize: 14, fontFamily: "Inter_700Bold", textAlign: "center" },
  demoCardCount: { color: MUTED, fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  demoOffBtn: { marginTop: 8, alignItems: "center" },
  demoOffText: { color: "#B45309", fontSize: 11, fontFamily: "Inter_700Bold" },
  allTitle: {
    color: TEXT,
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 2,
  },

  emptyWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 56, paddingHorizontal: 24 },
  emptyTitle: { color: TEXT, fontFamily: "Inter_700Bold", fontSize: 15, marginTop: 12 },
  emptyHint: { color: MUTED, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4, textAlign: "center" },
});
