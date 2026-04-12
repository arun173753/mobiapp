export interface CancelSignal {
  cancelled: boolean;
}

let _cancelSignal: CancelSignal | null = null;
let _xhr: XMLHttpRequest | null = null;
let _progress = 0;
let _message = '';
let _fileName = '';
let _isUploading = false;
let _bannerSuppressed = false;
const _listeners: Set<() => void> = new Set();

function notify() {
  _listeners.forEach(fn => fn());
}

export const UploadManager = {
  startTus(fileName: string, cancelSignal: CancelSignal) {
    _cancelSignal = cancelSignal;
    _xhr = null;
    _isUploading = true;
    _progress = 0;
    _message = 'Starting upload...';
    _fileName = fileName;
    notify();
  },

  start(xhr: XMLHttpRequest, fileName: string) {
    _xhr = xhr;
    _cancelSignal = null;
    _isUploading = true;
    _progress = 0;
    _message = 'Starting upload...';
    _fileName = fileName;
    notify();
  },

  update(progress: number, message: string) {
    _progress = progress;
    _message = message;
    notify();
  },

  finish() {
    _xhr = null;
    _cancelSignal = null;
    _isUploading = false;
    _progress = 100;
    notify();
    setTimeout(() => {
      _progress = 0;
      _message = '';
      _fileName = '';
      notify();
    }, 2000);
  },

  cancel() {
    if (_xhr) { _xhr.abort(); _xhr = null; }
    if (_cancelSignal) { _cancelSignal.cancelled = true; _cancelSignal = null; }
    _isUploading = false;
    _progress = 0;
    _message = '';
    _fileName = '';
    notify();
  },

  isUploading: () => _isUploading,
  getProgress: () => _progress,
  getMessage: () => _message,
  getFileName: () => _fileName,
  suppressBanner: (val: boolean) => { _bannerSuppressed = val; notify(); },
  isBannerSuppressed: () => _bannerSuppressed,

  subscribe(fn: () => void): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};
