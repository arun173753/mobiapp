import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import {
  confirmSolutionsDelete,
  deleteSolutionsFile,
  deleteSolutionsFolder,
  fetchSolutionsFolders,
  mergeSolutionsModelsByName,
  renameSolutionsFolder,
  sortSolutionsFoldersByFileCount,
  uploadSolutionsBrandLogo,
  uploadSolutionsFolderLogo,
  SolutionsCategory,
  SolutionsFile,
  SolutionsModel,
} from "@/lib/solutions-api";
import SolutionsNameEditModal from "@/components/solutions/SolutionsNameEditModal";
import { useApp } from "@/lib/context";
import { isAdminUser } from "@/lib/types";
import { canOpenFullHardwareSolutions } from "@/lib/subscription-gate";
import { useTrialCountdown } from "@/lib/use-trial-countdown";

/** Material 3 palette (matches solutions home). */
const PRIMARY = "#1E66F5";
const PRIMARY_DARK = "#1A54CC";
const BG = "#F1F5FB";
const CARD = "#FFFFFF";
const TEXT = "#0F172A";
const MUTED = "#64748B";
const BORDER = "rgba(15,23,42,0.08)";

type Params = { name?: string };

export default function SolutionsBrandScreen() {
  const params = useLocalSearchParams<Params>();
  const brandName = String(params?.name || "").trim();
  const { profile } = useApp();
  const { subscribed, statusReady } = useTrialCountdown();
  const isAdmin = isAdminUser(profile);
  const fullAccess = canOpenFullHardwareSolutions(profile) || subscribed;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<SolutionsModel[]>([]);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [editFolder, setEditFolder] = useState<{ id: string; model: string; category: string } | null>(null);
  const [editModel, setEditModel] = useState("");
  const [editCategory, setEditCategory] = useState("");
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

  const brand: SolutionsModel | null = useMemo(() => {
    if (!brandName) return null;
    return mergeSolutionsModelsByName(models, brandName);
  }, [models, brandName]);

  const folders: SolutionsCategory[] = useMemo(
    () => sortSolutionsFoldersByFileCount(brand?.categories || []),
    [brand],
  );
  const brandIsDemo = Boolean(brand?.isDemo);
  const canOpenBrand = fullAccess || brandIsDemo;

  const openFile = (file: SolutionsFile) => {
    if (!canOpenBrand) {
      router.push("/subscription-paywall" as any);
      return;
    }
    const target =
      `/solutions-viewer?id=${encodeURIComponent(String(file.id || ""))}` +
      `&name=${encodeURIComponent(String(file.name || ""))}` +
      `&kind=${encodeURIComponent(String(file.kind || ""))}`;
    router.push(target as any);
  };

  const onAddBrandLogo = useCallback(async () => {
    if (!brandName) return;
    try {
      await uploadSolutionsBrandLogo(brandName, "hardware");
      await load(true);
    } catch (e: any) {
      Alert.alert("Logo failed", e?.message || "Could not update brand logo.");
    }
  }, [brandName, load]);

  const onAddFolderLogo = useCallback(async (folderId: string) => {
    try {
      await uploadSolutionsFolderLogo(folderId);
      await load(true);
    } catch (e: any) {
      Alert.alert("Logo failed", e?.message || "Could not update folder logo.");
    }
  }, [load]);

  const onDeleteFolder = useCallback(async (folder: SolutionsCategory) => {
    const ok = await confirmSolutionsDelete(
      "Delete folder",
      `Delete "${folder.name}" and all uploaded files inside it? This cannot be undone.`,
    );
    if (!ok) return;
    try {
      const remainingBefore = folders.filter((c) => c.name !== folder.name).length;
      await deleteSolutionsFolder(folder.folderId || "by-name", brandName, folder.name);
      setOpenFolderId((prev) => (prev === folder.folderId ? null : prev));
      await load(true);
      if (remainingBefore === 0) {
        if (router.canGoBack()) router.back();
        else router.replace("/solutions" as any);
      }
    } catch (e: any) {
      Alert.alert("Delete failed", e?.message || "Could not delete this folder.");
    }
  }, [brandName, folders, load]);

  const onDeleteFile = useCallback(async (file: SolutionsFile) => {
    if (!file.id) return;
    const ok = await confirmSolutionsDelete(
      "Delete file",
      `Delete "${file.name}"? This cannot be undone.`,
    );
    if (!ok) return;
    try {
      await deleteSolutionsFile(file.id);
      await load(true);
    } catch (e: any) {
      Alert.alert("Delete failed", e?.message || "Could not delete this file.");
    }
  }, [load]);

  const onSaveFolderName = useCallback(async () => {
    if (!editFolder?.id) return;
    const model = editModel.trim();
    const category = editCategory.trim();
    if (!model || !category) return;
    setEditSaving(true);
    try {
      await renameSolutionsFolder(editFolder.id, model, category);
      setEditFolder(null);
      await load(true);
      if (model !== brandName) {
        router.replace(`/solutions-brand?name=${encodeURIComponent(model)}` as any);
      }
    } catch (e: any) {
      Alert.alert("Rename failed", e?.message || "Could not rename folder.");
    } finally {
      setEditSaving(false);
    }
  }, [brandName, editCategory, editFolder, editModel, load]);

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor={PRIMARY_DARK} barStyle="light-content" />

      {/* Blue app bar with back button + brand name */}
      <View style={styles.appBar}>
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/solutions" as any);
          }}
          hitSlop={12}
          style={({ pressed }) => [styles.appBarBtn, pressed && { opacity: 0.7 }]}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.appBarTitle} numberOfLines={1}>
          {brandName ? brandName.toUpperCase() : "Brand"}
        </Text>
        {isAdmin ? (
          <Pressable
            onPress={() => { void onAddBrandLogo(); }}
            hitSlop={12}
            style={({ pressed }) => [styles.appBarBtn, pressed && { opacity: 0.7 }]}
            accessibilityLabel="Add brand logo"
          >
            <Ionicons name="image-outline" size={22} color="#FFFFFF" />
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {loading ? (
        <FolderListShimmer />
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={36} color="#EF4444" />
          <Text style={[styles.centerText, { marginTop: 10, textAlign: "center" }]}>{error}</Text>
          <Pressable onPress={() => load(false)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : !brand ? (
        <View style={styles.center}>
          <Ionicons name="folder-open-outline" size={42} color={MUTED} />
          <Text style={[styles.centerText, { marginTop: 12 }]}>Brand not found</Text>
          <Text style={{ color: MUTED, fontSize: 12, marginTop: 4, textAlign: "center" }}>
            This brand may have been renamed or removed.
          </Text>
        </View>
      ) : !canOpenBrand && !statusReady ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : !canOpenBrand ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed" size={42} color="#F59E0B" />
          <Text style={[styles.centerText, { marginTop: 12 }]}>Subscribe to open this model</Text>
          <Text style={{ color: MUTED, fontSize: 13, marginTop: 6, textAlign: "center", paddingHorizontal: 24 }}>
            Free demo models are at the top of Hardware Solutions.
          </Text>
          <Pressable onPress={() => router.push("/subscription-paywall" as any)} style={styles.retryBtn}>
            <Text style={styles.retryText}>View plans</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={PRIMARY} />}
        >
          {folders.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="folder-outline" size={48} color={MUTED} />
              <Text style={styles.emptyTitle}>No folders yet</Text>
              <Text style={styles.emptyHint}>The admin hasn't added any folders for this brand.</Text>
            </View>
          ) : (
            folders.map((f) => {
              const folderKey = f.folderId || `${brandName}::${f.name}`;
              return (
              <FolderCard
                key={folderKey}
                folder={f}
                expanded={openFolderId === folderKey}
                isAdmin={isAdmin}
                onToggle={() =>
                  setOpenFolderId((prev) => (prev === folderKey ? null : folderKey))
                }
                onOpenFile={openFile}
                onAddLogo={f.folderId ? () => { void onAddFolderLogo(f.folderId!); } : undefined}
                onEditName={
                  f.folderId
                    ? () => {
                        setEditFolder({ id: f.folderId!, model: brandName, category: f.name });
                        setEditModel(brandName);
                        setEditCategory(f.name);
                      }
                    : undefined
                }
                onDelete={f.folderId ? () => { void onDeleteFolder(f); } : undefined}
                onDeleteFile={isAdmin ? (file) => { void onDeleteFile(file); } : undefined}
              />
              );
            })
          )}
        </ScrollView>
      )}

      <SolutionsNameEditModal
        visible={!!editFolder}
        title="Edit folder name"
        modelLabel="Brand / Model"
        categoryLabel="Folder name"
        showCategory
        model={editModel}
        category={editCategory}
        onChangeModel={setEditModel}
        onChangeCategory={setEditCategory}
        saving={editSaving}
        onSave={() => { void onSaveFolderName(); }}
        onClose={() => setEditFolder(null)}
      />
    </View>
  );
}

function FolderCard({
  folder,
  expanded,
  isAdmin,
  onToggle,
  onOpenFile,
  onAddLogo,
  onEditName,
  onDelete,
  onDeleteFile,
}: {
  folder: SolutionsCategory;
  expanded: boolean;
  isAdmin?: boolean;
  onToggle: () => void;
  onOpenFile: (f: SolutionsFile) => void;
  onAddLogo?: () => void;
  onEditName?: () => void;
  onDelete?: () => void;
  onDeleteFile?: (f: SolutionsFile) => void;
}) {
  const fileCount = folder.files.length;
  const hasImage = !!folder.folderImageUrl;
  return (
    <View style={styles.folderCardWrap}>
      <Pressable
        onPress={onToggle}
        android_ripple={{ color: "rgba(30,102,245,0.10)", borderless: false }}
        style={({ pressed }) => [
          styles.folderCard,
          pressed && Platform.OS === "ios" && { transform: [{ scale: 0.99 }] },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${folder.name}, ${fileCount} solutions`}
      >
        <View style={styles.folderIconWrap}>
          {hasImage ? (
            <Image
              source={{ uri: folder.folderImageUrl! }}
              style={styles.folderImage}
              contentFit="contain"
              transition={120}
              cachePolicy="disk"
            />
          ) : (
            <Ionicons name="folder" size={36} color={PRIMARY} />
          )}
        </View>

        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.folderTitle} numberOfLines={1}>
            {folder.name}
          </Text>
          <Text style={styles.folderSubtitle}>
            {fileCount} solution{fileCount === 1 ? "" : "s"}
          </Text>
        </View>

        <View style={styles.folderChevron}>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={MUTED} />
        </View>
      </Pressable>

      {isAdmin && (onAddLogo || onEditName || onDelete) ? (
        <View style={styles.adminRow}>
          {onAddLogo ? (
            <Pressable onPress={onAddLogo} style={styles.adminBtn}>
              <Ionicons name="image-outline" size={14} color={PRIMARY} />
              <Text style={styles.adminBtnText}>{hasImage ? "Change logo" : "Add logo"}</Text>
            </Pressable>
          ) : null}
          {onEditName ? (
            <Pressable onPress={onEditName} style={styles.adminBtn}>
              <Ionicons name="pencil-outline" size={14} color={PRIMARY} />
              <Text style={styles.adminBtnText}>Edit name</Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable onPress={onDelete} style={styles.adminBtnDanger}>
              <Ionicons name="trash-outline" size={14} color="#FF3B30" />
              <Text style={styles.adminBtnDangerText}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {expanded && (
        <View style={styles.fileList}>
          {fileCount === 0 ? (
            <Text style={styles.emptyFolderText}>No files in this folder yet.</Text>
          ) : (
            folder.files.map((file) => {
              const icon =
                file.kind === "pdf"
                  ? "document-text-outline"
                  : file.kind === "image"
                    ? "image-outline"
                    : file.kind === "video"
                      ? "videocam-outline"
                      : "document-outline";
              return (
                <View key={file.id} style={styles.fileRow}>
                  <Pressable
                    onPress={() => onOpenFile(file)}
                    android_ripple={{ color: "rgba(30,102,245,0.08)" }}
                    style={({ pressed }) => [styles.fileOpen, pressed && Platform.OS === "ios" && { opacity: 0.7 }]}
                  >
                    <Ionicons name={icon as any} size={18} color={TEXT} />
                    <Text style={styles.fileName} numberOfLines={1}>
                      {file.name}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={MUTED} />
                  </Pressable>
                  {onDeleteFile ? (
                    <Pressable
                      onPress={() => onDeleteFile(file)}
                      hitSlop={8}
                      style={styles.fileDeleteBtn}
                      accessibilityLabel={`Delete ${file.name}`}
                    >
                      <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                    </Pressable>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

function FolderListShimmer() {
  const placeholders = Array.from({ length: 5 });
  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {placeholders.map((_, i) => (
        <View key={i} style={[styles.folderCard, { opacity: 0.5 }]}>
          <View style={[styles.folderIconWrap, { backgroundColor: "#E2E8F0" }]} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={{ height: 14, width: "55%", backgroundColor: "#E2E8F0", borderRadius: 6 }} />
            <View style={{ height: 10, width: "30%", backgroundColor: "#EEF2F7", borderRadius: 6, marginTop: 6 }} />
          </View>
        </View>
      ))}
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
    flex: 1,
    color: "#FFFFFF",
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    letterSpacing: 0.5,
  },

  scroll: { padding: 14, paddingBottom: 36 },

  folderCardWrap: { marginBottom: 12 },
  folderCard: {
    backgroundColor: CARD,
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  folderIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: "#EEF4FF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: 4,
  },
  folderImage: { width: "100%", height: "100%" },
  folderTitle: { color: TEXT, fontFamily: "Inter_700Bold", fontSize: 16 },
  folderSubtitle: { color: MUTED, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  folderChevron: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5FB",
    marginLeft: 8,
  },
  adminRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
    marginHorizontal: 8,
  },
  adminBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "rgba(30,102,245,0.10)",
  },
  adminBtnText: { color: PRIMARY, fontSize: 12, fontFamily: "Inter_700Bold" },
  adminBtnDanger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "rgba(255,59,48,0.10)",
  },
  adminBtnDangerText: { color: "#FF3B30", fontSize: 12, fontFamily: "Inter_700Bold" },

  fileList: {
    marginTop: 4,
    marginHorizontal: 8,
    backgroundColor: CARD,
    borderRadius: 16,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  fileOpen: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  fileDeleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  fileName: { flex: 1, color: TEXT, fontFamily: "Inter_500Medium", fontSize: 13 },
  emptyFolderText: { color: MUTED, fontFamily: "Inter_400Regular", padding: 16, textAlign: "center", fontSize: 13 },

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

  emptyWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 56, paddingHorizontal: 24 },
  emptyTitle: { color: TEXT, fontFamily: "Inter_700Bold", fontSize: 15, marginTop: 12 },
  emptyHint: { color: MUTED, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4, textAlign: "center" },
});
