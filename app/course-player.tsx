import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as Sharing from 'expo-sharing';
import {
  View, Text, StyleSheet, Pressable, Platform, Alert,
  ScrollView, ActivityIndicator, Dimensions, Modal, PanResponder, TextInput, KeyboardAvoidingView,
  StatusBar, Share,
} from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { resolveBunnyPlaybackUrl, getBunnyMp4Url, isBunnyUrl, getBunnyEmbedUrl } from '@/lib/bunny-cdn';
import { File as FSFile, Paths, getInfoAsync, deleteAsync, createDownloadResumable } from 'expo-file-system';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
} from 'react-native-reanimated';
import { Video, ResizeMode, AVPlaybackStatus, Audio } from 'expo-av';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { getApiUrl } from '@/lib/query-client';
import { INDIAN_LANGUAGES, Course, CourseVideo, CourseChapter, CourseEnrollment } from '@/lib/types';

const C = Colors.light;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VIDEO_HEIGHT = SCREEN_WIDTH * (9 / 16);
const ACCENT = '#FF6B2C';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const BUNNY_CDN = 'https://Mobistorage.b-cdn.net';

function getBackendUrl(): string {
  return getApiUrl();
}

function resolveVideoUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    if (isBunnyUrl(url)) return resolveBunnyPlaybackUrl(url);
    return url;
  }
  const match = url.match(/^\/api\/gcs\/(.+)$/);
  if (match) {
    return `${BUNNY_CDN}/${match[1]}`;
  }
  return `${getApiUrl()}${url}`;
}

function formatTime(secs: number): string {
  const totalSecs = Math.floor(secs);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hrs > 0) return `${hrs}:${pad(mins)}:${pad(s)}`;
  return `${mins}:${pad(s)}`;
}

function formatDurationShort(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) return `${mins}:${secs.toString().padStart(2, '0')}`;
  return `0:${secs.toString().padStart(2, '0')}`;
}

export default function CoursePlayerScreen() {
  useKeepAwake();

  // ── Screenshot & Screen Recording Protection ─────────────────────────
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    if (Platform.OS !== 'web') {
      // Native: FLAG_SECURE (Android prevents screenshots/recordings)
      ScreenCapture.preventScreenCaptureAsync().catch(() => {});
      cleanup = () => { ScreenCapture.allowScreenCaptureAsync().catch(() => {}); };
    } else {
      // Web: disable right-click, keyboard shortcuts, blur on tab switch
      const preventCtxMenu = (e: MouseEvent) => e.preventDefault();
      const preventKeys = (e: KeyboardEvent) => {
        if (
          (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key)) ||
          (e.ctrlKey && e.key === 'U') ||
          e.key === 'F12' ||
          (e.ctrlKey && e.key === 's')
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
      };
      const handleVisibilityChange = () => {
        setTabHidden(document.hidden);
      };
      document.addEventListener('contextmenu', preventCtxMenu);
      document.addEventListener('keydown', preventKeys);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      cleanup = () => {
        document.removeEventListener('contextmenu', preventCtxMenu);
        document.removeEventListener('keydown', preventKeys);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
    return cleanup;
  }, []);

  const { courseId, videoId } = useLocalSearchParams<{ courseId: string; videoId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useApp();
  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const videoRef = useRef<Video>(null);
  const webVideoRef = useRef<any>(null);
  const dubbedAudioRef = useRef<HTMLAudioElement | null>(null);
  const dubbedSoundRef = useRef<any>(null);
  const dubbedAudioActiveRef = useRef(false);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' | null }>({ time: 0, side: null });
  const progressBarWidth = useRef(SCREEN_WIDTH - 32);

  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedModal, setShowSpeedModal] = useState(false);
  const [demoLimitReached, setDemoLimitReached] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [dubbingMessage, setDubbingMessage] = useState('');
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [doubleTapIcon, setDoubleTapIcon] = useState<'left' | 'right' | null>(null);
  const [videoError, setVideoError] = useState(false);

  const [enrollment, setEnrollment] = useState<CourseEnrollment | null>(null);
  const [enrollmentChecked, setEnrollmentChecked] = useState(false);

  const [tabHidden, setTabHidden] = useState(false);
  const [activeTab, setActiveTab] = useState<'lessons' | 'notes' | 'chat' | 'ai'>('lessons');
  const [isLocked, setIsLocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [recommendations, setRecommendations] = useState<{ type: string; title: string; description: string; videoId?: string; icon: string }[]>([]);
  const [recommendationsLoaded, setRecommendationsLoaded] = useState(false);
  const [aiProgress, setAiProgress] = useState<{ completed: number; total: number; percentage: number } | null>(null);
  const [notices, setNotices] = useState<{ id: string; title: string; message: string; createdAt: number }[]>([]);
  const [noticesLoaded, setNoticesLoaded] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ id: string; senderId: string; senderName: string; senderRole: string; message: string; createdAt: number }[]>([]);
  const [chatText, setChatText] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [dubbedUrls, setDubbedUrls] = useState<Record<string, { status: string; url: string }>>({});
  const [isDubbingLoading, setIsDubbingLoading] = useState(false);
  const [dubbedVideoUri, setDubbedVideoUri] = useState<string | null>(null);
  const [isVideoMutedForDub, setIsVideoMutedForDub] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const completedRef = useRef(false);
  const resumedRef = useRef(false);
  const lastProgressSaveRef = useRef(0);

  const controlsOpacitySV = useSharedValue(1);

  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);
  const demoLimitReachedRef = useRef(false);

  const { data: course, isLoading: courseLoading } = useQuery<Course>({
    queryKey: ['/api/courses', courseId],
    enabled: !!courseId,
  });

  useEffect(() => {
    if (!courseId || !profile) {
      setEnrollmentChecked(true);
      return;
    }
    (async () => {
      try {
        const baseUrl = getApiUrl();
        const url = new URL(`/api/enrollments/check?courseId=${courseId}&studentId=${profile.id}`, baseUrl);
        const res = await fetch(url.toString());
        if (res.ok) {
          const data = await res.json();
          if (data.enrollment) setEnrollment(data.enrollment);
        }
      } catch (e) {
        console.warn('[Player] Enrollment check failed:', e);
      } finally {
        setEnrollmentChecked(true);
      }
    })();
  }, [courseId, profile]);

  const isEnrolled = enrollment && enrollment.status === 'active';
  const isTeacher = profile?.id === course?.teacherId;
  const hasFullAccess = !!isEnrolled || !!isTeacher;

  const resumeKey = `mobi_resume_${videoId}`;

  const fetchRecommendations = async (force = false) => {
    if (!courseId) return;
    if (!force && recommendationsLoaded) return;
    setRecommendationsLoaded(false);
    try {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/courses/${courseId}/recommendations`, baseUrl);
      if (profile?.id) url.searchParams.set('studentId', profile.id);
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.recommendations)) setRecommendations(data.recommendations);
        if (data.progress) setAiProgress(data.progress);
      }
    } catch (e) {}
    setRecommendationsLoaded(true);
  };

  useEffect(() => {
    if (activeTab === 'ai' && !recommendationsLoaded) {
      fetchRecommendations();
    }
  }, [courseId, activeTab, recommendationsLoaded, profile?.id]);

  useEffect(() => {
    if (!courseId || activeTab !== 'notes' || noticesLoaded) return;
    (async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await fetch(new URL(`/api/courses/${courseId}/notices`, baseUrl).toString());
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setNotices(data);
        }
      } catch (e) {}
      setNoticesLoaded(true);
    })();
  }, [courseId, activeTab, noticesLoaded]);

  // Chat polling (replaces Socket.IO)
  useEffect(() => {
    if (activeTab !== 'chat') return;
    const baseUrl = getApiUrl();
    let lastTs = 0;

    const loadInitial = async () => {
      try {
        const r = await fetch(new URL('/api/live-chat/messages?limit=30', baseUrl).toString());
        const data = await r.json();
        if (Array.isArray(data)) {
          setChatMessages(data);
          const maxTs = Math.max(...data.map((m: any) => typeof m.createdAt === 'number' ? m.createdAt : 0));
          if (maxTs > 0) lastTs = maxTs;
        }
      } catch {}
    };
    loadInitial();

    const pollInterval = setInterval(async () => {
      try {
        const url = lastTs > 0
          ? new URL(`/api/live-chat/messages?limit=10&after=${lastTs}`, baseUrl).toString()
          : new URL('/api/live-chat/messages?limit=30', baseUrl).toString();
        const r = await fetch(url);
        const data = await r.json();
        if (Array.isArray(data) && data.length > 0) {
          setChatMessages(prev => {
            const ids = new Set(prev.map((m) => m.id));
            const newMsgs = data.filter((m: any) => !ids.has(m.id));
            return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev;
          });
          const maxTs = Math.max(...data.map((m: any) => typeof m.createdAt === 'number' ? m.createdAt : 0));
          if (maxTs > lastTs) lastTs = maxTs;
        }
      } catch {}
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [activeTab]);

  const sendChatMessage = useCallback(async () => {
    if (!chatText.trim() || !profile || isSendingChat) return;
    const text = chatText.trim();
    setChatText('');
    setIsSendingChat(true);
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL('/api/live-chat/messages', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: profile.id,
          senderName: profile.name,
          senderRole: profile.role,
          senderAvatar: profile.avatar || '',
          message: text,
        }),
      });
      const data = await res.json();
      if (data?.message) {
        setChatMessages(prev => {
          if (prev.some(m => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
      }
    } catch {
      setChatText(text);
    } finally {
      setIsSendingChat(false);
    }
  }, [chatText, profile, isSendingChat]);

  useEffect(() => {
    completedRef.current = false;
    resumedRef.current = false;
    if (dubbedAudioRef.current) {
      dubbedAudioRef.current.pause();
      dubbedAudioRef.current.src = '';
      dubbedAudioRef.current = null;
    }
    if (dubbedSoundRef.current) {
      dubbedSoundRef.current.stopAsync().catch(() => {});
      dubbedSoundRef.current.unloadAsync().catch(() => {});
      dubbedSoundRef.current = null;
    }
    dubbedAudioActiveRef.current = false;
    setDubbedVideoUri(null);
    setIsVideoMutedForDub(false);
    setSelectedLanguage(null);
  }, [videoId]);

  useEffect(() => {
    return () => {
      if (dubbedAudioRef.current) {
        dubbedAudioRef.current.pause();
        dubbedAudioRef.current.src = '';
        dubbedAudioRef.current = null;
      }
      if (dubbedSoundRef.current) {
        dubbedSoundRef.current.stopAsync().catch(() => {});
        dubbedSoundRef.current.unloadAsync().catch(() => {});
        dubbedSoundRef.current = null;
      }
    };
  }, []);

  const handleVideoReady = useCallback(async () => {
    if (resumedRef.current || !videoId) return;
    resumedRef.current = true;
    try {
      let seekSecs = 0;
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        const local = localStorage.getItem(`mobi_resume_${videoId}`);
        if (local) seekSecs = parseInt(local, 10) || 0;
      }
      if (profile?.id) {
        try {
          const baseUrl = getApiUrl();
          const resp = await fetch(`${baseUrl}/api/videos/${videoId}/progress?userId=${profile.id}`);
          const data = await resp.json();
          if (data.position && data.position > seekSecs) seekSecs = data.position;
        } catch (e) {}
      }
      if (seekSecs > 5) {
        videoRef.current?.setPositionAsync(seekSecs * 1000);
        if (Platform.OS === 'web' && webVideoRef.current) {
          webVideoRef.current.currentTime = seekSecs;
        }
      }
    } catch (e) {}
  }, [videoId, profile?.id]);

  const allVideos = useMemo(() => {
    const vids: CourseVideo[] = [];
    if (course?.chapters) {
      for (const ch of course.chapters) {
        if (ch.videos) {
          for (const v of ch.videos) vids.push(v);
        }
      }
    }
    return vids;
  }, [course]);

  const chapterMap = useMemo(() => {
    const map: Record<string, CourseChapter> = {};
    if (course?.chapters) {
      for (const ch of course.chapters) {
        map[ch.id] = ch;
      }
    }
    return map;
  }, [course]);

  const currentVideo = useMemo(() => allVideos.find(v => v.id === videoId), [allVideos, videoId]);
  const currentIndex = useMemo(() => allVideos.findIndex(v => v.id === videoId), [allVideos, videoId]);
  const prevVideo = currentIndex > 0 ? allVideos[currentIndex - 1] : null;
  const nextVideo = currentIndex < allVideos.length - 1 ? allVideos[currentIndex + 1] : null;
  const currentChapter = currentVideo ? chapterMap[currentVideo.chapterId] : null;

  const demoDurationSecs = course?.demoDuration ?? 60;

  const videoUri = currentVideo?.videoUrl ? resolveVideoUrl(currentVideo.videoUrl) : '';

  const bunnyEmbedUrl = useMemo(() => isBunnyUrl(videoUri) ? getBunnyEmbedUrl(videoUri, true) : null, [videoUri]);
  // When dubbed audio is active on web, fall back to native <video> so we can mute it and sync dubbed audio
  const useIframe = Platform.OS === 'web' && !!bunnyEmbedUrl && !isVideoMutedForDub;

  const hasFullAccessRef = useRef(hasFullAccess);
  const autoPlayNextRef = useRef(autoPlayNext);
  const nextVideoRef = useRef(nextVideo);
  hasFullAccessRef.current = hasFullAccess;
  autoPlayNextRef.current = autoPlayNext;
  nextVideoRef.current = nextVideo;

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;

    const pos = (status.positionMillis || 0) / 1000;
    const dur = (status.durationMillis || 0) / 1000;

    if (!isSeeking) {
      positionRef.current = pos;
      durationRef.current = dur;
      setPosition(pos);
      if (dur > 0) setDuration(dur);

      if (dur > 5 && pos > 3) {
        try {
          if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
            localStorage.setItem(`mobi_resume_${videoId}`, String(Math.floor(pos)));
          }
        } catch (e) {}
        const now = Date.now();
        if (profile?.id && now - lastProgressSaveRef.current > 5000) {
          lastProgressSaveRef.current = now;
          const baseUrl = getApiUrl();
          fetch(`${baseUrl}/api/videos/${videoId}/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: profile.id, position: Math.floor(pos), duration: Math.floor(dur) }),
          }).catch(() => {});
        }
      }

      if (dur > 0 && !completedRef.current && hasFullAccessRef.current && pos / dur >= 0.9) {
        completedRef.current = true;
        const baseUrl = getApiUrl();
        fetch(new URL(`/api/videos/${videoId}/complete`, baseUrl).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: profile?.id, courseId }),
        }).catch(() => {});
      }
    }

    setIsPlaying(status.isPlaying);
    isPlayingRef.current = status.isPlaying;
    setIsBuffering(status.isBuffering);

    if (dubbedSoundRef.current && !isSeeking) {
      dubbedSoundRef.current.getStatusAsync().then((soundStatus: any) => {
        if (!soundStatus.isLoaded) return;
        const soundPos = (soundStatus.positionMillis || 0) / 1000;
        const drift = Math.abs(soundPos - pos);
        if (drift > 1.5) {
          dubbedSoundRef.current?.setPositionAsync(pos * 1000).catch(() => {});
        }
        if (status.isPlaying && !soundStatus.isPlaying) {
          dubbedSoundRef.current?.playAsync().catch(() => {});
        } else if (!status.isPlaying && soundStatus.isPlaying) {
          dubbedSoundRef.current?.pauseAsync().catch(() => {});
        }
      }).catch(() => {});
    }

    if (!hasFullAccessRef.current && !demoLimitReachedRef.current && pos >= demoDurationSecs) {
      demoLimitReachedRef.current = true;
      setDemoLimitReached(true);
      videoRef.current?.pauseAsync();
    }

    if (status.didJustFinish && autoPlayNextRef.current && nextVideoRef.current && hasFullAccessRef.current) {
      navigateToVideo(nextVideoRef.current);
    }
  }, [isSeeking, demoDurationSecs, videoId, courseId, profile?.id]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    controlsOpacitySV.value = withTiming(1, { duration: 200 });
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (isPlayingRef.current && !demoLimitReachedRef.current) {
        controlsOpacitySV.value = withTiming(0, { duration: 300 });
        setTimeout(() => runOnJS(setControlsVisible)(false), 300);
      }
    }, 4000);
  }, []);

  const toggleControls = useCallback(() => {
    if (controlsVisible) {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      controlsOpacitySV.value = withTiming(0, { duration: 300 });
      setTimeout(() => setControlsVisible(false), 300);
    } else {
      showControls();
    }
  }, [controlsVisible, showControls]);

  const handleDoubleTap = useCallback((side: 'left' | 'right') => {
    if (demoLimitReachedRef.current || useIframe) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDoubleTapIcon(side);
    setTimeout(() => setDoubleTapIcon(null), 600);

    const curPos = positionRef.current;
    const curDur = durationRef.current;

    if (side === 'right') {
      const newPos = Math.min(curPos + 10, curDur);
      if (!hasFullAccessRef.current && newPos >= demoDurationSecs) return;
      if (Platform.OS === 'web' && webVideoRef.current) {
        webVideoRef.current.currentTime = newPos;
      } else {
        videoRef.current?.setPositionAsync(newPos * 1000);
      }
    } else {
      const newPos = Math.max(curPos - 10, 0);
      if (Platform.OS === 'web' && webVideoRef.current) {
        webVideoRef.current.currentTime = newPos;
      } else {
        videoRef.current?.setPositionAsync(newPos * 1000);
      }
    }
  }, [demoDurationSecs, useIframe]);

  const handleVideoTap = useCallback((evt: any) => {
    const now = Date.now();
    const tapX = evt.nativeEvent.locationX;
    const side = tapX < SCREEN_WIDTH / 2 ? 'left' : 'right';

    if (now - lastTapRef.current.time < 300 && lastTapRef.current.side === side) {
      handleDoubleTap(side);
      lastTapRef.current = { time: 0, side: null };
    } else {
      lastTapRef.current = { time: now, side };
      setTimeout(() => {
        if (lastTapRef.current.time === now) {
          toggleControls();
        }
      }, 300);
    }
  }, [handleDoubleTap, toggleControls]);

  const toggleFullscreen = async () => {
    if (Platform.OS === 'web') {
      try {
        if (!(document as any).fullscreenElement) {
          const elem = webVideoRef.current as any;
          if (elem?.requestFullscreen) { await elem.requestFullscreen(); setIsFullscreen(true); }
          else if (elem?.webkitRequestFullscreen) { elem.webkitRequestFullscreen(); setIsFullscreen(true); }
        } else {
          if ((document as any).exitFullscreen) { await (document as any).exitFullscreen(); setIsFullscreen(false); }
          else if ((document as any).webkitExitFullscreen) { (document as any).webkitExitFullscreen(); setIsFullscreen(false); }
        }
      } catch (e) { console.warn('Web fullscreen failed:', e); }
      return;
    }
    try {
      if (!isFullscreen) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        if (Platform.OS === 'android') {
          await NavigationBar.setVisibilityAsync('hidden');
        }
        setIsFullscreen(true);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        if (Platform.OS === 'android') {
          await NavigationBar.setVisibilityAsync('visible');
        }
        setIsFullscreen(false);
      }
    } catch (e) {
      console.warn('Fullscreen toggle failed', e);
    }
  };

  const togglePiP = useCallback(async () => {
    if (Platform.OS === 'web') {
      try {
        const vid = webVideoRef.current as any;
        if (!vid) return;
        if ((document as any).pictureInPictureElement) {
          await (document as any).exitPictureInPicture();
        } else if (vid.requestPictureInPicture) {
          await vid.requestPictureInPicture();
        }
      } catch (e) { console.warn('PiP failed:', e); }
      return;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (Platform.OS !== 'web') {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        if (Platform.OS === 'android') {
          NavigationBar.setVisibilityAsync('visible');
        }
      }
    };
  }, []);

  const togglePlayPause = () => {
    if (demoLimitReachedRef.current) return;
    if (Platform.OS === 'web') {
      const vid = webVideoRef.current;
      if (!vid) return;
      if (isPlaying) {
        vid.pause();
        showControls();
      } else {
        vid.play();
        showControls();
      }
      return;
    }
    if (isPlaying) {
      videoRef.current?.pauseAsync();
      showControls();
    } else {
      videoRef.current?.playAsync();
      showControls();
    }
  };

  const shareCourse = async () => {
    try {
      const shareUrl = `${process.env.EXPO_PUBLIC_DOMAIN || 'https://atozmobilerepair.in'}/course/${courseId}`;
      const message = `Check out this course on Mobi: ${course?.title}\n\n${shareUrl}`;
      
      if (Platform.OS === 'web') {
        if (navigator.share) {
          await navigator.share({
            title: course?.title,
            text: message,
            url: shareUrl,
          }).catch(() => {});
        } else {
          const encodedMsg = encodeURIComponent(message);
          window.open(`https://wa.me/?text=${encodedMsg}`, '_blank');
        }
      } else {
        await Share.share({
          message,
          url: shareUrl,
          title: course?.title,
        });
      }
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.log('Error sharing:', error);
    }
  };

  const downloadVideo = useCallback(async () => {
    if (!currentVideo?.videoUrl || isDownloading) return;
    const mp4Url = isBunnyUrl(currentVideo.videoUrl)
      ? getBunnyMp4Url(currentVideo.videoUrl, '720p')
      : currentVideo.videoUrl;
    if (!mp4Url) {
      Alert.alert('Download Failed', 'Video URL not available for download.');
      return;
    }
    if (Platform.OS === 'web') {
      try {
        setIsDownloading(true);
        const resp = await fetch(mp4Url);
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `${currentVideo.title || 'video'}.mp4`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      } catch (e) {
        Alert.alert('Download Failed', 'Could not download this video. Please try again.');
      } finally {
        setIsDownloading(false);
      }
      return;
    }
    try {
      setIsDownloading(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const fileName = `${(currentVideo.title || 'video').replace(/[^a-z0-9]/gi, '_')}.mp4`;
      const localFile = new FSFile(Paths.document, fileName);
      const existing = await getInfoAsync(localFile.uri);
      if (existing.exists) {
        Alert.alert(
          'Already Downloaded',
          `"${currentVideo.title}" is already saved on your device.`,
          [
            { text: 'OK', onPress: () => {} },
            { text: 'Re-download', onPress: () => {
              deleteAsync(localFile.uri, { idempotent: true }).then(() => downloadVideo());
            }},
          ]
        );
        setIsDownloading(false);
        return;
      }
      const downloadResumable = createDownloadResumable(mp4Url, localFile.uri);
      await downloadResumable.downloadAsync();
      Alert.alert(
        'Download Complete',
        `"${currentVideo.title}" has been saved for offline viewing.`
      );
    } catch (e) {
      console.error('[Download] Failed:', e);
      Alert.alert('Download Failed', 'Could not download this video. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }, [currentVideo, isDownloading]);

  const shareAchievement = async () => {
    try {
      const message = `I just completed "${currentVideo?.title}" in the course "${course?.title}" on Mobi! 🏆\n\nJoin me on Mobi: https://atozmobilerepair.in`;
      
      if (Platform.OS === 'web') {
        if (navigator.share) {
          await navigator.share({
            title: 'Achievement Unlocked!',
            text: message,
          }).catch(() => {});
        } else {
          const encodedMsg = encodeURIComponent(message);
          window.open(`https://wa.me/?text=${encodedMsg}`, '_blank');
        }
      } else {
        await Share.share({
          message,
          title: 'Achievement Unlocked!',
        });
      }
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.log('Error sharing achievement:', error);
    }
  };

  const seekTo = (ratio: number) => {
    if (duration === 0) return;
    let newPos = ratio * duration;
    if (!hasFullAccess && newPos >= demoDurationSecs) {
      newPos = demoDurationSecs - 1;
    }
    if (Platform.OS === 'web' && webVideoRef.current) {
      webVideoRef.current.currentTime = Math.max(0, newPos);
    } else {
      videoRef.current?.setPositionAsync(Math.max(0, newPos) * 1000);
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    setShowSpeedModal(false);
    if (Platform.OS === 'web' && webVideoRef.current) {
      webVideoRef.current.playbackRate = speed;
      if (dubbedAudioRef.current) dubbedAudioRef.current.playbackRate = speed;
    } else {
      videoRef.current?.setRateAsync(speed, true);
      if (dubbedSoundRef.current) dubbedSoundRef.current.setRateAsync(speed, true).catch(() => {});
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleMute = () => {
    setIsMuted(prev => !prev);
    showControls();
  };

  const fetchDubbingStatus = useCallback(async (videoId: string) => {
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL(`/api/dubbing/status/${videoId}`, baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        if (data.languages) setDubbedUrls(data.languages);
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (!currentVideo) return;
    setDubbedVideoUri(null);
    setDubbedUrls({});
    fetchDubbingStatus(currentVideo.id);
    // Always poll so in-progress dubs get picked up automatically
    const interval = setInterval(() => fetchDubbingStatus(currentVideo.id), 15000);
    return () => clearInterval(interval);
  }, [currentVideo?.id]);

  const stopDubbedAudio = useCallback(async () => {
    dubbedAudioActiveRef.current = false;
    setDubbedVideoUri(null);
    setIsVideoMutedForDub(false);
    if (Platform.OS === 'web') {
      if (dubbedAudioRef.current) {
        dubbedAudioRef.current.pause();
        dubbedAudioRef.current.src = '';
        dubbedAudioRef.current = null;
      }
    } else {
      if (dubbedSoundRef.current) {
        try { await dubbedSoundRef.current.stopAsync(); } catch {}
        try { await dubbedSoundRef.current.unloadAsync(); } catch {}
        dubbedSoundRef.current = null;
      }
    }
  }, []);

  const applyDubbedAudio = useCallback(async (audioUrl: string) => {
    dubbedAudioActiveRef.current = true;
    setDubbedVideoUri(audioUrl);
    setIsVideoMutedForDub(true);
    if (Platform.OS === 'web') {
      if (dubbedAudioRef.current) {
        dubbedAudioRef.current.pause();
        dubbedAudioRef.current.src = '';
      }
      const audio = document.createElement('audio') as HTMLAudioElement;
      audio.src = audioUrl;
      audio.playbackRate = webVideoRef.current?.playbackRate || 1;
      dubbedAudioRef.current = audio;
      audio.addEventListener('canplay', () => {
        const targetTime = webVideoRef.current?.currentTime || 0;
        if (audio && Math.abs(audio.currentTime - targetTime) > 0.5) {
          audio.currentTime = targetTime;
        }
      }, { once: true });
      if (!webVideoRef.current?.paused) {
        const p = audio.play();
        if (p !== undefined) {
          p.catch((err: Error) => {
            console.warn('[DubbedAudio] Autoplay blocked:', err.message);
            setDubbingMessage('Press play to hear dubbed audio');
            setTimeout(() => setDubbingMessage(''), 6000);
          });
        }
      }
    } else {
      if (dubbedSoundRef.current) {
        try { await dubbedSoundRef.current.stopAsync(); } catch {}
        try { await dubbedSoundRef.current.unloadAsync(); } catch {}
        dubbedSoundRef.current = null;
      }
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: isPlaying, positionMillis: positionRef.current * 1000, rate: playbackSpeed }
        );
        dubbedSoundRef.current = sound;
      } catch (e) {
        console.warn('[DubbedAudio] Native load failed:', e);
        setIsVideoMutedForDub(false);
        dubbedAudioActiveRef.current = false;
      }
    }
  }, [isPlaying, playbackSpeed]);

  // Auto-apply dubbed audio when the selected language finishes processing
  useEffect(() => {
    if (!selectedLanguage) return;
    const entry = dubbedUrls[selectedLanguage];
    if (entry?.status === 'completed' && entry.url && !dubbedAudioActiveRef.current) {
      const uri = resolveVideoUrl(entry.url);
      applyDubbedAudio(uri);
      setDubbingMessage('Dubbed audio ready!');
      setTimeout(() => setDubbingMessage(''), 3000);
    }
  }, [dubbedUrls, selectedLanguage, applyDubbedAudio]);

  const handleLanguageSelect = async (langCode: string) => {
    setSelectedLanguage(langCode);
    setShowLanguageModal(false);

    const originalLang = course?.language || 'hi';
    if (langCode === originalLang) {
      setDubbingMessage('');
      await stopDubbedAudio();
      return;
    }

    const existing = dubbedUrls[langCode];
    if (existing?.status === 'completed' && existing.url) {
      const uri = resolveVideoUrl(existing.url);
      setDubbingMessage('Dubbed audio loaded!');
      await applyDubbedAudio(uri);
      setTimeout(() => setDubbingMessage(''), 3000);
      return;
    }

    if (existing?.status === 'processing') {
      setDubbingMessage('Dubbing in progress... Check back in a few minutes.');
      setTimeout(() => setDubbingMessage(''), 5000);
      return;
    }

    setIsDubbingLoading(true);
    setDubbingMessage('Starting AI dubbing... This takes a few minutes for long videos.');
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL('/api/dubbing/start', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: currentVideo!.id,
          courseId,
          targetLanguage: langCode,
          sourceLang: originalLang,
        }),
      });
      const data = await res.json();
      if (data.status === 'completed' && data.dubbedVideoUrl) {
        const uri = resolveVideoUrl(data.dubbedVideoUrl);
        setDubbedUrls(prev => ({ ...prev, [langCode]: { status: 'completed', url: data.dubbedVideoUrl } }));
        setDubbingMessage('Dubbed audio loaded!');
        await applyDubbedAudio(uri);
        setTimeout(() => setDubbingMessage(''), 3000);
      } else {
        setDubbedUrls(prev => ({ ...prev, [langCode]: { status: 'processing', url: '' } }));
        setDubbingMessage('AI dubbing started! We\'ll process it in the background. Open the language menu again in a few minutes to check.');
        const pollInterval = setInterval(async () => {
          await fetchDubbingStatus(currentVideo!.id);
        }, 20000);
        setTimeout(() => { clearInterval(pollInterval); setDubbingMessage(''); }, 300000);
      }
    } catch (e) {
      setDubbingMessage('Failed to start dubbing. Please try again.');
      setTimeout(() => setDubbingMessage(''), 4000);
    } finally {
      setIsDubbingLoading(false);
    }
  };

  const navigateToVideo = (video: CourseVideo) => {
    setDemoLimitReached(false);
    demoLimitReachedRef.current = false;
    setPosition(0);
    setVideoError(false);
    router.replace({
      pathname: '/course-player' as any,
      params: { courseId: course!.id, videoId: video.id },
    });
  };

  const progress = duration > 0 ? position / duration : 0;
  const selectedLangObj = INDIAN_LANGUAGES.find(l => l.code === selectedLanguage);

  const controlsAnimStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacitySV.value,
  }));

  const progressPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setIsSeeking(true);
        const x = evt.nativeEvent.locationX;
        const ratio = Math.max(0, Math.min(1, x / progressBarWidth.current));
        const previewPos = ratio * durationRef.current;
        setSeekPreview(previewPos);
        setPosition(previewPos);
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const ratio = Math.max(0, Math.min(1, x / progressBarWidth.current));
        const previewPos = ratio * durationRef.current;
        setSeekPreview(previewPos);
        setPosition(previewPos);
      },
      onPanResponderRelease: (evt) => {
        const x = evt.nativeEvent.locationX;
        const ratio = Math.max(0, Math.min(1, x / progressBarWidth.current));
        seekTo(ratio);
        setIsSeeking(false);
        setSeekPreview(null);
        showControls();
      },
    })
  ).current;

  const [videoLoading, setVideoLoading] = useState(true);

  if (courseLoading || !enrollmentChecked) {
    return (
      <View style={[styles.container, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      </View>
    );
  }

  if (!course || !currentVideo) {
    return (
      <View style={[styles.container, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <View style={styles.centerState}>
          <Ionicons name="videocam-off-outline" size={48} color={C.textTertiary} />
          <Text style={styles.emptyText}>Video not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, isFullscreen && styles.fullscreenContainer]}>
      <StatusBar hidden={isFullscreen} />
      <View style={[
        styles.videoSection,
        isFullscreen ? styles.videoSectionFullscreen : { marginTop: Platform.OS === 'web' ? webTopInset : insets.top }
      ]}>
        {videoUri && !videoError ? (
          useIframe ? (
            <iframe
              key={bunnyEmbedUrl!}
              src={bunnyEmbedUrl!}
              style={{ width: '100%', height: VIDEO_HEIGHT, border: 'none', backgroundColor: '#000', display: 'block' } as any}
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          ) : Platform.OS === 'web' ? (
            <video
              ref={webVideoRef}
              key={videoUri}
              src={videoUri}
              style={{ width: '100%', height: VIDEO_HEIGHT, backgroundColor: '#000', objectFit: 'contain', display: 'block', userSelect: 'none' } as any}
              autoPlay
              playsInline
              muted={isMuted || isVideoMutedForDub}
              onContextMenu={(e: any) => e.preventDefault()}
              controlsList="nodownload"
              onError={(e: any) => {
                console.warn('[Player] Web video error:', e);
              }}
              onPlay={() => {
                setIsPlaying(true); setIsBuffering(false); showControls();
                if (dubbedAudioRef.current) {
                  dubbedAudioRef.current.currentTime = webVideoRef.current?.currentTime || 0;
                  dubbedAudioRef.current.play().catch(() => {});
                }
              }}
              onPause={() => {
                setIsPlaying(false); showControls();
                if (dubbedAudioRef.current) dubbedAudioRef.current.pause();
              }}
              onSeeked={(e: any) => {
                if (dubbedAudioRef.current) {
                  dubbedAudioRef.current.currentTime = e.target.currentTime || 0;
                }
              }}
              {...({ onenterpictureinpicture: () => setIsPiP(true), onleavepictureinpicture: () => setIsPiP(false) } as any)}
              onTimeUpdate={(e: any) => {
                const vid = e.target;
                if (!isSeeking && vid) {
                  const pos = vid.currentTime || 0;
                  const dur = vid.duration || 0;
                  setPosition(pos);
                  if (dur > 0) setDuration(dur);
                  positionRef.current = pos;
                  durationRef.current = dur;
                  if (dubbedAudioRef.current && !dubbedAudioRef.current.paused) {
                    const drift = Math.abs(dubbedAudioRef.current.currentTime - pos);
                    if (drift > 1.5) dubbedAudioRef.current.currentTime = pos;
                  }
                  if (!hasFullAccessRef.current && !demoLimitReachedRef.current && pos >= demoDurationSecs) {
                    demoLimitReachedRef.current = true;
                    setDemoLimitReached(true);
                    vid.pause();
                  }
                  if (dur > 5 && pos > 3) {
                    try {
                      if (typeof localStorage !== 'undefined') {
                        localStorage.setItem(`mobi_resume_${videoId}`, String(Math.floor(pos)));
                      }
                    } catch (e2) {}
                    const now = Date.now();
                    if (profile?.id && now - lastProgressSaveRef.current > 5000) {
                      lastProgressSaveRef.current = now;
                      const baseUrl = getApiUrl();
                      fetch(`${baseUrl}/api/videos/${videoId}/progress`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: profile.id, position: Math.floor(pos), duration: Math.floor(dur) }),
                      }).catch(() => {});
                    }
                  }
                }
              }}
              onWaiting={() => setIsBuffering(true)}
              onCanPlay={() => setIsBuffering(false)}
              onLoadedMetadata={handleVideoReady}
              onEnded={() => {
                if (autoPlayNextRef.current && nextVideoRef.current && hasFullAccessRef.current) {
                  navigateToVideo(nextVideoRef.current);
                }
              }}
            />
          ) : (
            <Video
              ref={videoRef}
              source={{ uri: videoUri }}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls={false}
              shouldPlay={true}
              rate={playbackSpeed}
              volume={1.0}
              isMuted={isMuted || isVideoMutedForDub}
              onPlaybackStatusUpdate={onPlaybackStatusUpdate}
              onReadyForDisplay={handleVideoReady}
              onError={(err: any) => {
                console.warn('[Player] Video error:', JSON.stringify(err));
                setVideoError(true);
                setIsBuffering(false);
              }}
            />
          )
        ) : (
          <View style={[styles.video, styles.videoPlaceholder]}>
            <Ionicons name={videoError ? 'alert-circle-outline' : 'videocam-off-outline'} size={48} color={videoError ? ACCENT : '#555'} />
            <Text style={{ color: '#FFF', marginTop: 8, fontSize: 14, textAlign: 'center', paddingHorizontal: 20 }}>
              {videoError ? 'Video failed to load. Please re-upload this video.' : 'No video available'}
            </Text>
          </View>
        )}

        {tabHidden && Platform.OS === 'web' && (
          <View style={styles.tabHiddenOverlay}>
            <Ionicons name="eye-off-outline" size={40} color="#fff" />
            <Text style={styles.tabHiddenText}>Screen protected</Text>
            <Text style={styles.tabHiddenSub}>Return to this tab to continue watching</Text>
          </View>
        )}

        {useIframe && (
          <View style={styles.iframeControls}>
            <Pressable onPress={() => router.back()} style={styles.iframeBackBtn} hitSlop={12}>
              <Ionicons name="chevron-down" size={22} color="#FFF" />
            </Pressable>
            <Pressable style={styles.iframeDubBtn} onPress={() => setShowLanguageModal(true)}>
              <MaterialIcons name="translate" size={18} color="#FFF" />
              <Text style={styles.iframeDubText}>
                {selectedLanguage ? INDIAN_LANGUAGES.find(l => l.code === selectedLanguage)?.name ?? 'Auto Dub' : 'Auto Dub'}
              </Text>
            </Pressable>
          </View>
        )}

        {!useIframe && <Pressable style={styles.videoTouchArea} onPress={handleVideoTap} />}

        {!useIframe && doubleTapIcon === 'left' && (
          <View style={[styles.doubleTapIndicator, { left: 20 }]}>
            <Ionicons name="play-back" size={28} color="#FFF" />
            <Text style={styles.doubleTapText}>-10s</Text>
          </View>
        )}
        {!useIframe && doubleTapIcon === 'right' && (
          <View style={[styles.doubleTapIndicator, { right: 20 }]}>
            <Ionicons name="play-forward" size={28} color="#FFF" />
            <Text style={styles.doubleTapText}>+10s</Text>
          </View>
        )}

        {!useIframe && isBuffering && !demoLimitReached && (
          <View style={styles.bufferingOverlay}>
            <ActivityIndicator size="large" color="#FFF" />
          </View>
        )}

        {!useIframe && (
          <Animated.View
            style={[styles.controlsOverlay, controlsAnimStyle]}
            pointerEvents={controlsVisible || demoLimitReached ? 'auto' : 'none'}
          >
            <View style={styles.overlayGradientTop} />
            <View style={styles.overlayGradientBottom} />

            <View style={styles.topControls}>
              <Pressable onPress={() => router.back()} style={styles.controlCircle} hitSlop={12}>
                <Ionicons name="chevron-down" size={24} color="#FFF" />
              </Pressable>
              <Text style={styles.videoTitleOverlay} numberOfLines={1}>
                {currentVideo?.title || ''}
              </Text>
              <View style={styles.topRight}>
                <Pressable style={styles.controlCircleSm} onPress={() => setShowLanguageModal(true)}>
                  <MaterialIcons name="translate" size={20} color="#FFF" />
                </Pressable>
                <Pressable style={styles.controlCircleSm} onPress={toggleMute}>
                  <Ionicons name={isMuted ? "volume-mute" : "volume-high"} size={20} color="#FFF" />
                </Pressable>
                <Pressable style={styles.controlCircleSm} onPress={() => setIsLocked(!isLocked)}>
                  <Ionicons name={isLocked ? "lock-closed" : "lock-open"} size={20} color="#FFF" />
                </Pressable>
              </View>
            </View>

            <View style={styles.centerControls}>
              <Pressable
                style={styles.skipCircle}
                onPress={() => handleDoubleTap('left')}
                hitSlop={12}
              >
                <Ionicons name="play-back" size={28} color="#FFF" />
                <Text style={styles.skipLabel}>10s</Text>
              </Pressable>
              <Pressable style={styles.playBtn} onPress={togglePlayPause}>
                {isBuffering
                  ? <ActivityIndicator size="large" color="#FFF" />
                  : <Ionicons name={isPlaying ? "pause" : "play"} size={36} color="#FFF" />
                }
              </Pressable>
              <Pressable
                style={styles.skipCircle}
                onPress={() => handleDoubleTap('right')}
                hitSlop={12}
              >
                <Ionicons name="play-forward" size={28} color="#FFF" />
                <Text style={styles.skipLabel}>10s</Text>
              </Pressable>
            </View>

            <View style={styles.bottomControls}>
              {seekPreview !== null && (
                <View style={styles.seekPreviewBadge}>
                  <Text style={styles.seekPreviewText}>{formatTime(seekPreview)}</Text>
                </View>
              )}
              <View
                style={styles.progressBarContainer}
                onLayout={(e) => { progressBarWidth.current = e.nativeEvent.layout.width; }}
                {...progressPanResponder.panHandlers}
              >
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
                  <View style={[styles.progressThumb, { left: `${progress * 100}%` as any }]} />
                </View>
              </View>
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTime(position)} / {formatTime(duration)}</Text>
                <View style={styles.bottomActions}>
                  <Pressable style={styles.speedBtn} onPress={() => setShowSpeedModal(true)}>
                    <Text style={styles.speedText}>{playbackSpeed}x</Text>
                  </Pressable>
                  {Platform.OS === 'web' && (
                    <Pressable style={styles.controlCircleSm} onPress={togglePiP}>
                      <MaterialIcons name={isPiP ? "picture-in-picture-alt" : "picture-in-picture"} size={20} color="#FFF" />
                    </Pressable>
                  )}
                  <Pressable style={styles.controlCircleSm} onPress={toggleFullscreen}>
                    <MaterialIcons name={isFullscreen ? "fullscreen-exit" : "fullscreen"} size={24} color="#FFF" />
                  </Pressable>
                </View>
              </View>
            </View>
          </Animated.View>
        )}

        {demoLimitReached && (
          <View style={styles.demoOverlay}>
            <View style={styles.demoCard}>
              <Ionicons name="lock-closed" size={36} color={ACCENT} />
              <Text style={styles.demoTitle}>Demo Preview Ended</Text>
              <Text style={styles.demoDesc}>
                Purchase the course to watch full videos.
              </Text>
              <Pressable style={styles.demoEnrollBtn} onPress={() => router.back()}>
                <Text style={styles.demoEnrollText}>Enroll Now</Text>
              </Pressable>
            </View>
          </View>
        )}

        {isLocked && (
          <Pressable
            style={styles.lockOverlay}
            onPress={() => { setIsLocked(false); if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <View style={styles.lockPill}>
              <Ionicons name="lock-closed" size={20} color="#FFF" />
              <Text style={styles.lockPillText}>Tap to unlock</Text>
            </View>
          </Pressable>
        )}
      </View>

      {dubbingMessage !== '' && (
        <View style={styles.dubbingToast}>
          <Ionicons name="information-circle-outline" size={16} color={ACCENT} />
          <Text style={styles.dubbingToastText}>{dubbingMessage}</Text>
        </View>
      )}

      <View style={styles.videoInfoCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Text style={[styles.videoTitle, { flex: 1 }]} numberOfLines={2}>{currentVideo.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {isBunnyUrl(currentVideo.videoUrl || '') && (
              <Pressable onPress={downloadVideo} style={{ padding: 4 }} disabled={isDownloading}>
                {isDownloading
                  ? <ActivityIndicator size="small" color={ACCENT} />
                  : <Ionicons name="download-outline" size={22} color={ACCENT} />
                }
              </Pressable>
            )}
            <Pressable onPress={shareCourse} style={{ padding: 4, marginLeft: 4 }}>
              <Ionicons name="share-social-outline" size={22} color={ACCENT} />
            </Pressable>
          </View>
        </View>
        <View style={styles.videoMeta}>
          {currentChapter && (
            <View style={styles.metaChip}>
              <Ionicons name="folder-outline" size={12} color={ACCENT} />
              <Text style={styles.metaChipText}>{currentChapter.title}</Text>
            </View>
          )}
          <View style={styles.metaChip}>
            <Ionicons name="videocam-outline" size={12} color="#888" />
            <Text style={[styles.metaChipText, { color: '#888' }]}>
              {currentIndex + 1} / {allVideos.length}
            </Text>
          </View>
          {completedRef.current && (
            <Pressable 
              style={[styles.metaChip, { backgroundColor: '#E8F5E9' }]}
              onPress={shareAchievement}
            >
              <Ionicons name="checkmark-circle" size={12} color="#4CAF50" />
              <Text style={[styles.metaChipText, { color: '#4CAF50' }]}>Done</Text>
              <Ionicons name="share-social-outline" size={10} color="#4CAF50" style={{ marginLeft: 4 }} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.tabBar}>
        {([
          { id: 'lessons', label: 'Lessons', icon: 'list' },
          { id: 'ai', label: 'AI Tips', icon: 'bulb-outline' },
          { id: 'notes', label: 'Notes', icon: 'document-text-outline' },
          { id: 'chat', label: 'Chat', icon: 'chatbubble-outline' },
        ] as const).map(tab => (
          <Pressable
            key={tab.id}
            style={[styles.tabItem, activeTab === tab.id && styles.tabItemActive]}
            onPress={() => setActiveTab(tab.id)}
          >
            <Ionicons name={tab.icon as any} size={16} color={activeTab === tab.id ? ACCENT : '#888'} />
            <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      {activeTab === 'lessons' && (
        <ScrollView
          style={styles.bottomScroll}
          contentContainerStyle={{ paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 20 }}
          showsVerticalScrollIndicator={false}
        >
          {nextVideo && autoPlayNext && (
            <View style={styles.upNextCard}>
              <View style={styles.upNextHeader}>
                <Text style={styles.upNextLabel}>Up Next</Text>
                <Ionicons name="play-circle" size={16} color={ACCENT} />
              </View>
              <Pressable style={styles.upNextRow} onPress={() => navigateToVideo(nextVideo)}>
                <View style={styles.upNextThumb}>
                  <Ionicons name="play" size={20} color="#FFF" />
                </View>
                <View style={styles.upNextInfo}>
                  <Text style={styles.upNextTitle} numberOfLines={1}>{nextVideo.title}</Text>
                  {chapterMap[nextVideo.chapterId] && (
                    <Text style={styles.upNextChapter} numberOfLines={1}>
                      {chapterMap[nextVideo.chapterId].title}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={18} color="#999" />
              </Pressable>
            </View>
          )}
          <View style={styles.playlistSection}>
            <Text style={styles.playlistTitle}>Course Content</Text>
            <Text style={styles.playlistSubtitle}>
              {course.chapters?.length || 0} chapters · {allVideos.length} videos
            </Text>
          </View>
          {course.chapters?.map((chapter) => (
            <View key={chapter.id} style={styles.chapterBlock}>
              <View style={styles.chapterHeader}>
                <Ionicons name="folder" size={18} color={ACCENT} />
                <Text style={styles.chapterName} numberOfLines={1}>{chapter.title}</Text>
                <Text style={styles.chapterCount}>{chapter.videos?.length || 0}</Text>
              </View>
              {chapter.videos?.map((vid, vidIdx) => {
                const isCurrentVid = vid.id === videoId;
                const canPlay = hasFullAccess || !!vid.isDemo;
                return (
                  <Pressable
                    key={vid.id}
                    style={[styles.videoItem, isCurrentVid && styles.videoItemActive]}
                    onPress={() => { if (canPlay || hasFullAccess) navigateToVideo(vid); }}
                    disabled={!canPlay && !hasFullAccess}
                  >
                    <View style={styles.videoItemLeft}>
                      {isCurrentVid ? (
                        <View style={styles.nowPlayingDot} />
                      ) : (
                        <Text style={styles.videoItemIndex}>{vidIdx + 1}</Text>
                      )}
                    </View>
                    <View style={styles.videoItemInfo}>
                      <Text
                        style={[styles.videoItemTitle, isCurrentVid && styles.videoItemTitleActive]}
                        numberOfLines={1}
                      >
                        {vid.title}
                      </Text>
                      <View style={styles.videoItemMeta}>
                        {vid.duration ? (
                          <Text style={styles.videoItemDuration}>
                            {formatDurationShort(vid.duration)}
                          </Text>
                        ) : null}
                        {!!vid.isDemo && (
                          <View style={styles.demoBadge}>
                            <Text style={styles.demoBadgeText}>DEMO</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    {!canPlay && !hasFullAccess ? (
                      <Ionicons name="lock-closed-outline" size={16} color="#CCC" />
                    ) : isCurrentVid ? (
                      <View style={styles.nowPlayingBars}>
                        <View style={[styles.bar, styles.bar1]} />
                        <View style={[styles.bar, styles.bar2]} />
                        <View style={[styles.bar, styles.bar3]} />
                      </View>
                    ) : (
                      <Ionicons name="play-circle-outline" size={22} color="#CCC" />
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {activeTab === 'ai' && (
        <ScrollView
          style={styles.bottomScroll}
          contentContainerStyle={{ paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 20, padding: 14 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.aiHeader}>
            <View style={styles.aiHeaderIcon}>
              <Ionicons name="bulb" size={22} color={ACCENT} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.aiHeaderTitle}>AI Study Coach</Text>
                <View style={{ backgroundColor: '#FF6B2C15', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: ACCENT }}>AI POWERED</Text>
                </View>
              </View>
              <Text style={styles.aiHeaderSub}>Personalized recommendations based on your progress</Text>
            </View>
            <Pressable
              onPress={() => fetchRecommendations(true)}
              style={{ padding: 8, borderRadius: 20, backgroundColor: '#FF6B2C10' }}
              disabled={!recommendationsLoaded}
            >
              <Ionicons name="refresh" size={18} color={recommendationsLoaded ? ACCENT : '#CCC'} />
            </Pressable>
          </View>

          {aiProgress && (
            <View style={styles.aiProgressCard}>
              <View style={styles.aiProgressHeader}>
                <Text style={styles.aiProgressLabel}>Course Progress</Text>
                <Text style={styles.aiProgressPct}>{aiProgress.percentage}%</Text>
              </View>
              <View style={styles.aiProgressTrack}>
                <View style={[styles.aiProgressFill, { width: `${aiProgress.percentage}%` as any }]} />
              </View>
              <Text style={styles.aiProgressSub}>{aiProgress.completed} of {aiProgress.total} videos completed</Text>
            </View>
          )}

          {!recommendationsLoaded && (
            <View style={{ alignItems: 'center', paddingTop: 40, gap: 8 }}>
              <ActivityIndicator size="large" color={ACCENT} />
              <Text style={{ color: '#888', marginTop: 4, fontSize: 14 }}>Generating AI recommendations...</Text>
              <Text style={{ color: '#BBB', fontSize: 12 }}>Analyzing your course progress</Text>
            </View>
          )}

          {recommendationsLoaded && recommendations.map((rec, idx) => {
            const iconMap: Record<string, string> = { rocket: 'rocket', 'trending-up': 'trending-up', star: 'star', flag: 'flag', trophy: 'trophy', 'play-circle': 'play-circle', bulb: 'bulb', calendar: 'calendar-outline', 'calendar-outline': 'calendar-outline', refresh: 'refresh', 'checkmark-circle': 'checkmark-circle', flame: 'flame', book: 'book', time: 'time-outline', 'time-outline': 'time-outline' };
            const colorMap: Record<string, string> = { start: '#4CAF50', continue: ACCENT, finish: '#FF9800', complete: '#4CAF50', next: '#2196F3', focus: '#9C27B0', goal: '#607D8B', review: '#00BCD4', challenge: '#E91E63' };
            const bgMap: Record<string, string> = { start: '#E8F5E9', continue: '#FFF3EE', finish: '#FFF8E1', complete: '#E8F5E9', next: '#E3F2FD', focus: '#F3E5F5', goal: '#ECEFF1' };
            const color = colorMap[rec.type] || ACCENT;
            const bg = bgMap[rec.type] || '#FFF3EE';
            const icon = iconMap[rec.icon] || 'information-circle';
            return (
              <Pressable
                key={idx}
                style={[styles.aiRecCard, { borderLeftColor: color }]}
                onPress={() => rec.videoId ? navigateToVideo(allVideos.find(v => v.id === rec.videoId) || allVideos[0]) : undefined}
              >
                <View style={[styles.aiRecIcon, { backgroundColor: bg }]}>
                  <Ionicons name={icon as any} size={20} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.aiRecTitle}>{rec.title}</Text>
                  <Text style={styles.aiRecDesc}>{rec.description}</Text>
                  {rec.videoId && (
                    <View style={styles.aiRecAction}>
                      <Text style={[styles.aiRecActionText, { color }]}>Watch Now</Text>
                      <Ionicons name="chevron-forward" size={14} color={color} />
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}

          {recommendationsLoaded && recommendations.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 40, gap: 10 }}>
              <Ionicons name="bulb-outline" size={40} color="#CCC" />
              <Text style={{ color: '#888', fontSize: 15 }}>Enroll to get personalized recommendations</Text>
            </View>
          )}
        </ScrollView>
      )}

      {activeTab === 'notes' && (
        <ScrollView
          style={styles.bottomScroll}
          contentContainerStyle={{ paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 20, padding: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {!noticesLoaded && (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <ActivityIndicator size="large" color={ACCENT} />
            </View>
          )}
          {noticesLoaded && notices.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 40, gap: 10 }}>
              <Ionicons name="document-text-outline" size={40} color="#CCC" />
              <Text style={{ color: '#888', fontSize: 15 }}>No notes posted yet</Text>
            </View>
          )}
          {notices.map(notice => (
            <View key={notice.id} style={styles.noticeCard}>
              <View style={styles.noticeHeader}>
                <View style={styles.noticeDot} />
                <Text style={styles.noticeTitle}>{notice.title}</Text>
              </View>
              {notice.message ? (
                <Text style={styles.noticeMsg}>{notice.message}</Text>
              ) : null}
              <Text style={styles.noticeDate}>
                {new Date(notice.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      {activeTab === 'chat' && (
        <KeyboardAvoidingView
          style={styles.bottomScroll}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={90}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingVertical: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {chatMessages.length === 0 && (
              <View style={{ alignItems: 'center', paddingTop: 40, gap: 10 }}>
                <Ionicons name="chatbubble-outline" size={40} color="#CCC" />
                <Text style={{ color: '#888', fontSize: 15 }}>Community chat</Text>
              </View>
            )}
            {chatMessages.map(msg => {
              const isMine = msg.senderId === profile?.id;
              return (
                <View key={msg.id} style={[styles.chatRow, isMine && styles.chatRowMine]}>
                  <View style={[styles.chatBubble, isMine && styles.chatBubbleMine]}>
                    {!isMine && <Text style={styles.chatSender}>{msg.senderName}</Text>}
                    <Text style={[styles.chatMsgText, isMine && { color: '#FFF' }]}>{msg.message}</Text>
                    <Text style={[styles.chatTime, isMine && { color: 'rgba(255,255,255,0.6)' }]}>
                      {new Date(msg.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <View style={[styles.chatInputRow, { paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 8 }]}>
            <TextInput
              style={styles.chatInput}
              value={chatText}
              onChangeText={setChatText}
              placeholder="Message the community..."
              placeholderTextColor="#AAA"
              onSubmitEditing={sendChatMessage}
              returnKeyType="send"
            />
            <Pressable style={styles.chatSendBtn} onPress={sendChatMessage}>
              <Ionicons name="send" size={20} color="#FFF" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      <Modal visible={showSpeedModal} transparent animationType="fade" onRequestClose={() => setShowSpeedModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowSpeedModal(false)}>
          <View style={styles.speedModalContent}>
            <Text style={styles.speedModalTitle}>Playback Speed</Text>
            <View style={styles.speedGrid}>
              {SPEEDS.map(s => (
                <Pressable
                  key={s}
                  style={[styles.speedOption, playbackSpeed === s && styles.speedOptionActive]}
                  onPress={() => handleSpeedChange(s)}
                >
                  <Text style={[styles.speedOptionText, playbackSpeed === s && styles.speedOptionTextActive]}>
                    {s}x
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showLanguageModal} transparent animationType="slide" onRequestClose={() => setShowLanguageModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowLanguageModal(false)}>
          <View style={styles.langModalContent}>
            <View style={styles.modalHandle} />
            <Text style={styles.langModalTitle}>Select Language</Text>
            <Text style={styles.langModalSubtitle}>AI-powered audio dubbing</Text>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {INDIAN_LANGUAGES.map(lang => {
                const isOriginal = lang.code === (course?.language || 'hi');
                const dubbed = dubbedUrls[lang.code];
                const statusText = isOriginal ? 'Original' : dubbed?.status === 'completed' ? 'Ready' : dubbed?.status === 'processing' ? 'Processing...' : dubbed?.status === 'failed' ? 'Retry' : 'Tap to dub';
                const statusColor = isOriginal ? '#34C759' : dubbed?.status === 'completed' ? '#34C759' : dubbed?.status === 'processing' ? '#FF9F0A' : dubbed?.status === 'failed' ? '#FF3B30' : '#999';
                return (
                  <Pressable
                    key={lang.code}
                    style={[styles.langItem, selectedLanguage === lang.code && styles.langItemActive]}
                    onPress={() => handleLanguageSelect(lang.code)}
                    disabled={isDubbingLoading}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.langName, selectedLanguage === lang.code && { color: ACCENT }]}>
                        {lang.name}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <Text style={styles.langNative}>{lang.nativeName}</Text>
                        <Text style={[styles.langStatus, { color: statusColor }]}>{statusText}</Text>
                      </View>
                    </View>
                    {selectedLanguage === lang.code ? (
                      <Ionicons name="checkmark-circle" size={22} color={ACCENT} />
                    ) : dubbed?.status === 'processing' ? (
                      <ActivityIndicator size="small" color="#FF9F0A" />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fullscreenContainer: {
    backgroundColor: '#000',
  },
  videoSectionFullscreen: {
    width: '100%',
    height: '100%',
    marginTop: 0,
  },
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  backBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { color: '#999', fontSize: 16 },

  videoSection: {
    width: SCREEN_WIDTH,
    height: VIDEO_HEIGHT,
    backgroundColor: '#000',
    position: 'relative' as const,
  },
  video: { width: '100%', height: '100%' },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  videoTouchArea: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },

  doubleTapIndicator: {
    position: 'absolute' as const,
    top: '50%' as any,
    marginTop: -28,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  doubleTapText: { color: '#FFF', fontSize: 10, fontWeight: '700' as const, marginTop: -2 },

  bufferingOverlay: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  iframeControls: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 10,
  },
  iframeBackBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  iframeDubBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,107,44,0.85)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
  },
  iframeDubText: {
    color: '#FFF', fontSize: 12, fontWeight: '700' as const,
  },
  tabHiddenOverlay: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 99,
    gap: 8,
  },
  tabHiddenText: {
    color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold',
  },
  tabHiddenSub: {
    color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'Inter_400Regular',
    textAlign: 'center' as const, paddingHorizontal: 20,
  },

  controlsOverlay: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'space-between',
  },
  overlayGradientTop: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, height: 100,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  overlayGradientBottom: {
    position: 'absolute' as const,
    bottom: 0, left: 0, right: 0, height: 120,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  topControls: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingTop: 10,
    zIndex: 2,
  },
  videoTitleOverlay: {
    flex: 1, color: '#FFF', fontSize: 13, fontWeight: '600' as const,
    marginHorizontal: 8, textAlign: 'center' as const,
  },
  controlCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  controlCircleSm: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
  },
  topPillText: { color: '#FFF', fontSize: 12, fontWeight: '500' as const },

  centerControls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32,
    zIndex: 2,
  },
  skipCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
    gap: 0,
  },
  skipLabel: {
    color: '#FFF', fontSize: 9, fontWeight: '700' as const, marginTop: -2,
  },
  seekCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  playBtn: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(255,107,44,0.92)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10,
    elevation: 8,
  },

  bottomControls: { paddingHorizontal: 16, paddingBottom: 8, zIndex: 2 },
  seekPreviewBadge: {
    alignSelf: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 8, marginBottom: 4,
  },
  seekPreviewText: { color: '#FFF', fontSize: 13, fontWeight: '600' as const },

  progressBarContainer: { height: 28, justifyContent: 'center' },
  progressTrack: {
    height: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2,
    position: 'relative' as const,
  },
  progressFill: { height: '100%', backgroundColor: ACCENT, borderRadius: 2 },
  progressThumb: {
    position: 'absolute' as const, top: -6,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: ACCENT,
    marginLeft: -8,
    borderWidth: 2.5, borderColor: '#FFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 3,
    elevation: 4,
  },

  timeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 2,
  },
  timeText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '500' as const },
  bottomActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  speedBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10,
  },
  speedText: { color: '#FFF', fontSize: 12, fontWeight: '600' as const },
  autoPlayBtn: { padding: 2 },
  autoPlayBtnActive: {},

  demoOverlay: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.88)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24,
  },
  demoCard: {
    backgroundColor: '#FFF', borderRadius: 20, padding: 28,
    alignItems: 'center', width: '100%', maxWidth: 340,
  },
  demoTitle: { color: '#1A1A1A', fontSize: 18, fontWeight: '600' as const, marginTop: 12, marginBottom: 8 },
  demoDesc: { color: '#666', fontSize: 14, textAlign: 'center' as const, lineHeight: 20, marginBottom: 20 },
  demoEnrollBtn: { backgroundColor: ACCENT, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 25 },
  demoEnrollText: { color: '#FFF', fontSize: 16, fontWeight: '600' as const },

  dubbingToast: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF', marginHorizontal: 16, marginTop: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#EEE',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4,
    elevation: 2,
  },
  dubbingToastText: { color: ACCENT, fontSize: 13, fontWeight: '500' as const },

  bottomScroll: { flex: 1 },

  lockOverlay: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  lockPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 30,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  lockPillText: { color: '#FFF', fontSize: 15, fontWeight: '600' as const },

  tabBar: {
    flexDirection: 'row', backgroundColor: '#FFF',
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14,
    borderBottomWidth: 3, borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: ACCENT },
  tabText: { fontSize: 14, fontWeight: '600' as const, color: '#888' },
  tabTextActive: { color: ACCENT, fontWeight: '700' as const },

  noticeCard: {
    backgroundColor: '#FFF', borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#F0F0F0',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  noticeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  noticeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ACCENT },
  noticeTitle: { color: '#1A1A1A', fontSize: 15, fontWeight: '700' as const, flex: 1 },
  noticeMsg: { color: '#555', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  noticeDate: { color: '#AAA', fontSize: 11 },

  chatRow: { paddingHorizontal: 12, marginBottom: 6 },
  chatRowMine: { alignItems: 'flex-end' },
  chatBubble: {
    maxWidth: '80%', backgroundColor: '#F0F0F0', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start' as const,
  },
  chatBubbleMine: { backgroundColor: ACCENT, alignSelf: 'flex-end' as const },
  chatSender: { color: '#888', fontSize: 11, fontWeight: '600' as const, marginBottom: 2 },
  chatMsgText: { color: '#1A1A1A', fontSize: 14 },
  chatTime: { color: '#AAA', fontSize: 10, marginTop: 2 },
  chatInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingTop: 8,
    backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },
  chatInput: {
    flex: 1, backgroundColor: '#F5F5F5', borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: '#1A1A1A',
  },
  chatSendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center',
  },

  videoInfoCard: {
    backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#F2F2F2',
  },
  videoTitle: { color: '#1A1A1A', fontSize: 22, fontWeight: '900' as const, marginBottom: 12, lineHeight: 28 },
  videoMeta: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 12, marginBottom: 4 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  metaChipText: { fontSize: 13, fontWeight: '600' as const, color: ACCENT },
  videoDesc: {
    color: '#666', fontSize: 14, lineHeight: 20, marginTop: 10,
    borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingTop: 10,
  },

  upNextCard: {
    backgroundColor: '#FFF', marginHorizontal: 12, marginTop: 8,
    padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,107,44,0.15)',
  },
  upNextHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
  },
  upNextLabel: { fontSize: 13, fontWeight: '700' as const, color: ACCENT, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  upNextRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  upNextThumb: {
    width: 48, height: 36, borderRadius: 8, backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center',
  },
  upNextInfo: { flex: 1 },
  upNextTitle: { fontSize: 14, fontWeight: '600' as const, color: '#1A1A1A' },
  upNextChapter: { fontSize: 12, color: '#888', marginTop: 2 },

  playlistSection: { paddingHorizontal: 16, marginTop: 20, marginBottom: 12 },
  playlistTitle: { fontSize: 18, fontWeight: '800' as const, color: '#1A1A1A' },
  playlistSubtitle: { fontSize: 13, color: '#999', marginTop: 4 },

  chapterBlock: { marginHorizontal: 12, marginBottom: 8 },
  chapterHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: '#FFF', borderRadius: 12, marginBottom: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 4,
    elevation: 1,
  },
  chapterName: { flex: 1, fontSize: 14, fontWeight: '600' as const, color: '#1A1A1A' },
  chapterCount: {
    fontSize: 12, fontWeight: '600' as const, color: '#999',
    backgroundColor: '#F0F0F0', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },

  videoItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 18, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  videoItemActive: { backgroundColor: 'rgba(255,107,44,0.05)' },
  videoItemLeft: { width: 32, alignItems: 'center' },
  nowPlayingDot: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: ACCENT,
  },
  videoItemIndex: { fontSize: 14, fontWeight: '700' as const, color: '#DDD' },
  videoItemInfo: { flex: 1, marginLeft: 12 },
  videoItemTitle: { fontSize: 15, fontWeight: '600' as const, color: '#1A1A1A' },
  videoItemTitleActive: { color: ACCENT, fontWeight: '700' as const },
  videoItemMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  videoItemDuration: { fontSize: 12, color: '#999', fontWeight: '500' as const },
  demoBadge: {
    backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
  },
  demoBadgeText: { fontSize: 10, fontWeight: '800' as const, color: '#4CAF50', letterSpacing: 0.5 },

  nowPlayingBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 18 },
  bar: { width: 3.5, backgroundColor: ACCENT, borderRadius: 2 },
  bar1: { height: 8 },
  bar2: { height: 14 },
  bar3: { height: 10 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  speedModalContent: {
    backgroundColor: '#FFF', borderRadius: 20, padding: 24, width: '80%', maxWidth: 300,
  },
  speedModalTitle: { fontSize: 17, fontWeight: '700' as const, color: '#1A1A1A', marginBottom: 16, textAlign: 'center' as const },
  speedGrid: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 10, justifyContent: 'center' },
  speedOption: {
    width: 72, paddingVertical: 12, borderRadius: 14,
    backgroundColor: '#F7F7F7', alignItems: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  speedOptionActive: { borderColor: ACCENT, backgroundColor: 'rgba(255,107,44,0.08)' },
  speedOptionText: { fontSize: 16, fontWeight: '600' as const, color: '#666' },
  speedOptionTextActive: { color: ACCENT },

  langModalContent: {
    backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 34,
    maxHeight: '70%', width: '100%',
    position: 'absolute' as const, bottom: 0,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#DDD', alignSelf: 'center' as const, marginBottom: 16,
  },
  langModalTitle: { color: '#1A1A1A', fontSize: 18, fontWeight: '700' as const, marginBottom: 4 },
  langModalSubtitle: { color: '#999', fontSize: 12, marginBottom: 14 },
  langItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 4,
  },
  langItemActive: { backgroundColor: 'rgba(255,107,44,0.08)' },
  langName: { color: '#1A1A1A', fontSize: 15, fontWeight: '500' as const },
  langNative: { color: '#888', fontSize: 12 },
  langStatus: { fontSize: 10, fontWeight: '500' as const },

  aiHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF', padding: 14, borderRadius: 14, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(255,107,44,0.12)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  aiHeaderIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,107,44,0.1)', alignItems: 'center', justifyContent: 'center',
  },
  aiHeaderTitle: { fontSize: 16, fontWeight: '700' as const, color: '#1A1A1A' },
  aiHeaderSub: { fontSize: 12, color: '#888', marginTop: 2 },

  aiProgressCard: {
    backgroundColor: '#FFF', padding: 14, borderRadius: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#F0F0F0',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  aiProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  aiProgressLabel: { fontSize: 14, fontWeight: '600' as const, color: '#1A1A1A' },
  aiProgressPct: { fontSize: 18, fontWeight: '800' as const, color: ACCENT },
  aiProgressTrack: { height: 8, backgroundColor: '#F0F0F0', borderRadius: 4, overflow: 'hidden' as const },
  aiProgressFill: { height: '100%', backgroundColor: ACCENT, borderRadius: 4 },
  aiProgressSub: { fontSize: 12, color: '#888', marginTop: 6 },

  aiRecCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#FFF', padding: 14, borderRadius: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#F0F0F0',
    borderLeftWidth: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  aiRecIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
  },
  aiRecTitle: { fontSize: 15, fontWeight: '700' as const, color: '#1A1A1A', marginBottom: 4 },
  aiRecDesc: { fontSize: 13, color: '#666', lineHeight: 19 },
  aiRecAction: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  aiRecActionText: { fontSize: 13, fontWeight: '600' as const },
});
