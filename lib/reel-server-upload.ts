/**
 * Fallback reel upload: multipart to API → server streams to Bunny Storage (or local dev).
 * Prefer Bunny Stream TUS in `bunny-stream.ts` when configured.
 */
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { API_URL } from "@/lib/api-config";
import { getSessionToken } from "@/lib/storage";

export async function uploadReelVideoViaMultipartApi(
  uri: string,
  opts: {
    mimeType?: string;
    fileName?: string;
    webFile?: Blob | File | null;
    onProgress?: (pct: number, msg: string) => void;
  },
): Promise<{ videoId?: string; playbackUrl: string; directUrl?: string; url?: string; mode?: string }> {
  const url = `${API_URL.replace(/\/+$/, "")}/api/reels/upload-video`;
  const token = (await getSessionToken())?.trim();

  if (Platform.OS === "web") {
    let file = opts.webFile;
    if (!file || !(file instanceof Blob)) {
      // Expo ImagePicker on web can sometimes omit `asset.file`. Try fetching the `uri` as a Blob.
      try {
        const r = await fetch(uri);
        const b = await r.blob();
        if (b && b.size > 0) file = b;
      } catch {
        // ignore
      }
    }
    if (!file || !(file instanceof Blob)) {
      throw new Error("Web upload needs access to the original file. Please pick the video again.");
    }
    const fd = new FormData();
    fd.append("video", file as Blob, opts.fileName || "reel.mp4");
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.timeout = 5 * 60 * 1000;
      if (token) {
        xhr.setRequestHeader("x-session-token", token);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
          opts.onProgress?.(pct, `${pct}% uploading…`);
        }
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300 && body.success) {
            resolve(body);
          } else {
            reject(new Error(body.message || `Upload failed (${xhr.status})`));
          }
        } catch {
          reject(new Error("Invalid response from upload server"));
        }
      };
      xhr.onerror = () => {
        reject(new Error("Network error during video upload"));
      };
      xhr.ontimeout = () => {
        reject(new Error("Video upload timed out"));
      };
      xhr.send(fd);
    });
  }

  const task = FileSystem.createUploadTask(
    url,
    uri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: "video",
      mimeType: opts.mimeType || "video/mp4",
      headers: token
        ? { "x-session-token": token, Authorization: `Bearer ${token}` }
        : {},
    },
    (p) => {
      const total = p.totalBytesExpectedToSend ?? 0;
      const sent = p.totalBytesSent ?? 0;
      if (total > 0) {
        const pct = Math.min(99, Math.round((sent / total) * 100));
        opts.onProgress?.(pct, `${pct}% uploading…`);
      }
    },
  );

  const result = await task.uploadAsync();
  if (!result || result.status !== 200) {
    throw new Error(`Video upload failed (${result?.status ?? "unknown"})`);
  }
  let body: { success?: boolean; url?: string; playbackUrl?: string; directUrl?: string; videoId?: string; message?: string };
  try {
    body = JSON.parse(result.body || "{}");
  } catch {
    throw new Error("Invalid response from upload server");
  }
  const playbackUrl = String(body.playbackUrl || body.url || "").trim();
  if (!body.success || !playbackUrl) {
    throw new Error(body.message || "Video upload failed");
  }
  return {
    videoId: body.videoId,
    playbackUrl,
    directUrl: body.directUrl,
    url: body.url,
    mode: body.mode,
  };
}
