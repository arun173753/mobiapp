/**
 * Bunny Stream — Direct upload from device to Bunny CDN.
 *
 * Strategy:
 *  - Native (iOS/Android): Manual TUS chunked upload reading 8MB chunks
 *    from expo-file-system. The entire file is NEVER loaded into RAM.
 *  - Web: Standard tus-js-client with blob (file is already in browser memory).
 *
 * Flow:
 *  1. POST /api/bunny/create-video  → get videoId + signature
 *  2. TUS upload directly to video.bunnycdn.com/tusupload
 *  3. Poll GET /api/bunny/video-status/:videoId until encoded
 */

import { Platform } from 'react-native';
import { apiRequest } from '@/lib/query-client';
import type { CancelSignal } from '@/lib/upload-manager';

export interface BunnyVideoSlot {
  videoId: string;
  libraryId: string;
  signature: string;
  expires: number;
  uploadUrl: string;
  playbackUrl: string;
  directUrl: string;
}

export interface UploadProgress {
  percent: number;
  message: string;
}

export type ProgressCallback = (p: UploadProgress) => void;

export async function createBunnyVideoSlot(title: string): Promise<BunnyVideoSlot> {
  const res = await apiRequest('POST', '/api/bunny/create-video', { title });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Failed to create video slot');
  return data as BunnyVideoSlot;
}

async function uploadDirectVideo(uri: string, onProgress?: ProgressCallback): Promise<{ videoId: string; playbackUrl: string; directUrl: string }> {
  onProgress?.({ percent: 0, message: 'Uploading video directly...' });
  const res = await apiRequest('POST', '/api/videos/upload', { uri });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Failed to upload video');
  return data;
}

function formatETA(seconds: number): string {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds)}s`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

/**
 * Native chunked TUS upload.
 * Reads 8MB at a time from expo-file-system. The full video file is never
 * loaded into JS memory — only one chunk at a time.
 */
async function uploadNativeChunked(
  uri: string,
  slot: BunnyVideoSlot,
  fileSize: number,
  onProgress?: ProgressCallback,
  cancelSignal?: CancelSignal,
): Promise<void> {
  const FileSystem = await import('expo-file-system');
  const CHUNK = 8 * 1024 * 1024;

  onProgress?.({ percent: 1, message: 'Connecting to upload server...' });

  const metaParts = [
    `filetype ${btoa('video/mp4')}`,
    `videoId ${btoa(slot.videoId)}`,
    `libraryId ${btoa(String(slot.libraryId))}`,
  ];

  const createRes = await fetch('https://video.bunnycdn.com/tusupload', {
    method: 'POST',
    headers: {
      'AuthorizationSignature': slot.signature,
      'AuthorizationExpire': String(slot.expires),
      'VideoId': slot.videoId,
      'LibraryId': String(slot.libraryId),
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(fileSize),
      'Upload-Metadata': metaParts.join(','),
      'Content-Length': '0',
    },
  });

  if (createRes.status !== 201) {
    let errText = '';
    try { errText = await createRes.text(); } catch {}
    throw new Error(`Upload server rejected the request (${createRes.status})${errText ? ': ' + errText.slice(0, 200) : ''}`);
  }

  let uploadUrl = createRes.headers.get('Location') || '';
  if (!uploadUrl) throw new Error('Upload server did not return a location URL');
  if (!uploadUrl.startsWith('http')) uploadUrl = `https://video.bunnycdn.com${uploadUrl}`;

  let offset = 0;
  const startTime = Date.now();
  let prevOffset = 0;
  let prevTime = startTime;

  onProgress?.({ percent: 2, message: 'Upload starting...' });

  while (offset < fileSize) {
    if (cancelSignal?.cancelled) throw new Error('CANCELLED');

    const chunkSize = Math.min(CHUNK, fileSize - offset);

    const b64 = await (FileSystem as any).readAsStringAsync(uri, {
      encoding: 'base64',
      position: offset,
      length: chunkSize,
    });

    if (cancelSignal?.cancelled) throw new Error('CANCELLED');

    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const chunkBlob = new Blob([bytes], { type: 'application/octet-stream' });

    const patchRes = await fetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(chunkSize),
      },
      body: chunkBlob,
    });

    if (patchRes.status !== 204 && patchRes.status !== 200 && patchRes.status !== 201) {
      throw new Error(`Chunk upload failed (HTTP ${patchRes.status}). Check your connection and try again.`);
    }

    offset += chunkSize;

    const now = Date.now();
    const windowSec = Math.max(0.1, (now - prevTime) / 1000);
    const windowBytes = offset - prevOffset;
    prevOffset = offset;
    prevTime = now;

    const instantSpeed = windowBytes / windowSec;
    const totalSec = Math.max(0.1, (now - startTime) / 1000);
    const avgSpeed = offset / totalSec;
    const speed = instantSpeed > 0 ? instantSpeed * 0.7 + avgSpeed * 0.3 : avgSpeed;

    const remainingBytes = fileSize - offset;
    const etaSec = speed > 0 ? remainingBytes / speed : 0;
    const pct = Math.min(99, Math.round((offset / fileSize) * 100));
    const speedStr = formatSpeed(speed);
    const etaStr = etaSec > 1 ? ` • ${formatETA(etaSec)} left` : '';

    onProgress?.({ percent: pct, message: `${pct}% • ${speedStr}${etaStr}` });
  }
}

/**
 * Web upload via tus-js-client (browser Blob is already in memory).
 */
async function uploadWebTus(
  file: Blob,
  slot: BunnyVideoSlot,
  onProgress?: ProgressCallback,
  cancelSignal?: CancelSignal,
): Promise<void> {
  const { Upload } = await import('tus-js-client');
  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(file as any, {
      endpoint: slot.uploadUrl || 'https://video.bunnycdn.com/tusupload',
      retryDelays: [0, 3000, 5000, 10000, 20000],
      storeFingerprintForResuming: false,
      headers: {
        AuthorizationSignature: slot.signature,
        AuthorizationExpire: String(slot.expires),
        VideoId: slot.videoId,
        LibraryId: String(slot.libraryId),
      },
      metadata: {
        filetype: file.type || 'video/mp4',
        videoId: slot.videoId,
        libraryId: String(slot.libraryId),
      },
      chunkSize: 8 * 1024 * 1024,
      onError(error) {
        reject(new Error(`Upload failed: ${error.message || error}`));
      },
      onProgress(bytesUploaded, bytesTotal) {
        if (cancelSignal?.cancelled) { upload.abort(); reject(new Error('CANCELLED')); return; }
        const percent = bytesTotal > 0 ? Math.min(99, Math.round((bytesUploaded / bytesTotal) * 100)) : 0;
        onProgress?.({ percent, message: `${percent}% uploading...` });
      },
      onSuccess() {
        onProgress?.({ percent: 100, message: 'Upload complete — processing...' });
        resolve();
      },
    });
    upload.start();
  });
}

export async function uploadToBunnyStream(
  uri: string,
  slot: BunnyVideoSlot,
  onProgress?: ProgressCallback,
  cancelSignal?: CancelSignal,
  fileSize?: number,
): Promise<void> {
  if (Platform.OS !== 'web') {
    const FileSystem = await import('expo-file-system');
    let size = fileSize ?? 0;
    if (!size) {
      const info = await (FileSystem as any).getInfoAsync(uri, { size: true }) as any;
      size = info.size ?? 0;
    }
    if (!size) throw new Error('Cannot determine video file size. Please try selecting the video again.');
    return uploadNativeChunked(uri, slot, size, onProgress, cancelSignal);
  } else {
    onProgress?.({ percent: 0, message: 'Loading video file...' });
    const r = await fetch(uri);
    const file = await r.blob();
    return uploadWebTus(file, slot, onProgress, cancelSignal);
  }
}

export async function waitForBunnyEncoding(
  videoId: string,
  onProgress?: ProgressCallback,
  timeoutMs = 30 * 60 * 1000, // 30 minutes for large videos
): Promise<string> {
  const start = Date.now();
  let pollingCount = 0;
  while (Date.now() - start < timeoutMs) {
    pollingCount++;
    await new Promise(r => setTimeout(r, pollingCount > 20 ? 10000 : 4000)); // Slower polling after initial checks
    try {
      const res = await apiRequest('GET', `/api/bunny/video-status/${videoId}`);
      const data = await res.json();
      if (!data.success) continue;
      const pct = data.encodeProgress ?? 0;
      if (data.status === 3) {
        onProgress?.({ percent: 100, message: 'Encoding complete!' });
        return data.playbackUrl;
      } else if (data.status === 4) {
        throw new Error('Bunny encoding failed');
      } else {
        const label = ['Queued', 'Processing', 'Encoding'][data.status] ?? 'Encoding';
        onProgress?.({ percent: pct, message: `${label}... ${pct}%` });
      }
    } catch (e: any) {
      if (e?.message?.startsWith('Bunny encoding failed')) throw e;
    }
  }
  throw new Error('Encoding timed out after 30 minutes. The video may be too large or taking longer than expected to process.');
}

export async function uploadVideoToBunnyStream(
  uri: string,
  title: string,
  onProgress?: ProgressCallback,
  cancelSignal?: CancelSignal,
  waitForEncoding = false,
  fileSize?: number,
): Promise<{ videoId: string; playbackUrl: string; directUrl: string }> {
  onProgress?.({ percent: 0, message: 'Preparing upload...' });
  try {
    const slot = await createBunnyVideoSlot(title);

    onProgress?.({ percent: 1, message: 'Starting upload...' });
    await uploadToBunnyStream(uri, slot, p => {
      onProgress?.({ percent: Math.max(1, Math.round(p.percent * 0.95)), message: p.message });
    }, cancelSignal, fileSize);

    if (waitForEncoding) {
      const finalUrl = await waitForBunnyEncoding(slot.videoId, p =>
        onProgress?.({ percent: 95 + Math.round(p.percent * 0.05), message: p.message }),
      );
      return { videoId: slot.videoId, playbackUrl: finalUrl, directUrl: slot.directUrl };
    }

    return { videoId: slot.videoId, playbackUrl: slot.playbackUrl, directUrl: slot.directUrl };
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (message.includes('Failed to create video slot') || message.includes('Failed to create Bunny Stream video') || message.includes('503') || message.includes('502')) {
      return uploadDirectVideo(uri, onProgress);
    }
    throw error;
  }
}
