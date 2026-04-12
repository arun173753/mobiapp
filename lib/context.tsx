import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode, useCallback, useRef } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { ADMIN_PHONE, UserProfile, Post, Job, Comment, Conversation, ChatMessage, UserRole, PostCategory } from './types';
import * as Storage from './storage';
import { apiRequest, getApiUrl } from './query-client';
import { playMessageSound, showMessageNotification, registerPushToken } from './notifications';
import { getDeviceId } from './device-fingerprint';

interface AppContextValue {
  profile: UserProfile | null;
  posts: Post[];
  setPosts: React.Dispatch<React.SetStateAction<Post[]>>;
  jobs: Job[];
  conversations: Conversation[];
  allProfiles: UserProfile[];
  isLoading: boolean;
  isOnboarded: boolean;
  hasMorePosts: boolean;
  loadMorePosts: () => Promise<void>;
  hasMoreProfiles: boolean;
  loadMoreProfiles: () => Promise<void>;
  navigationMode: 'default' | 'marketplace';
  setNavigationMode: (mode: 'default' | 'marketplace') => void;
  setProfile: (profile: UserProfile) => Promise<void>;
  completeOnboarding: (profile: UserProfile, sessionToken: string) => Promise<void>;
  loginWithProfile: (profile: UserProfile, sessionToken: string) => Promise<void>;
  addPost: (post: Omit<Post, 'id' | 'createdAt' | 'likes' | 'comments'>) => Promise<void>;
  toggleLike: (postId: string) => Promise<void>;
  addComment: (postId: string, text: string) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
  updatePost: (postId: string, updates: Partial<{ text: string; category: PostCategory }>) => void;
  addJob: (job: Omit<Job, 'id' | 'createdAt'>) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  refreshData: () => Promise<void>;
  startConversation: (otherUserId: string, otherUserName: string, otherUserRole: UserRole) => Promise<string>;
  sendMessage: (convoId: string, text: string, image?: string) => Promise<void>;
  deleteConversation: (convoId: string) => Promise<void>;
  logout: () => Promise<void>;
  totalUnread: number;
  liveChatUnread: number;
  resetLiveChatUnread: () => void;
  setLiveChatActive: (active: boolean) => void;
  loadMessages: (convoId: string) => Promise<ChatMessage[]>;
  pollMessages: (convoId: string, sinceTs: number) => Promise<ChatMessage[]>;
  setActiveChatId: (chatId: string | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

async function syncProfileToServer(profile: UserProfile, deviceId?: string) {
  try {
    const payload: any = {
      id: profile.id,
      name: profile.name,
      phone: profile.phone,
      email: profile.email || '',
      role: profile.role,
      skills: profile.skills,
      city: profile.city,
      state: profile.state,
      experience: profile.experience,
      shopName: profile.shopName || '',
      bio: profile.bio || '',
      avatar: profile.avatar || '',
      sellType: profile.sellType || '',
      teachType: profile.teachType || '',
      shopAddress: profile.shopAddress || '',
      gstNumber: profile.gstNumber || '',
      aadhaarNumber: profile.aadhaarNumber || '',
      panNumber: profile.panNumber || '',
      latitude: profile.latitude || '',
      longitude: profile.longitude || '',
      locationSharing: profile.locationSharing || 'true',
    };
    if (deviceId) payload.deviceId = deviceId;
    await apiRequest('POST', '/api/profiles', payload);
  } catch (e) {
    console.warn('[Sync] Failed to sync profile to server:', e);
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

const POSTS_PAGE_SIZE = 50;

async function fetchPostsFromServer(offset = 0): Promise<Post[]> {
  try {
    // /api/posts is public - use direct fetch without auth
    const baseUrl = getApiUrl();
    const url = new URL(`/api/posts?limit=${POSTS_PAGE_SIZE}&offset=${offset}`, baseUrl);
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) {
      console.warn('[Posts] API returned status:', res.status);
      return [];
    }
    const data = await res.json();
    const posts = (Array.isArray(data) ? data : data.posts || []) as Post[];
    console.log('[Posts] Loaded', posts.length, 'posts from server (offset', offset, ')');
    return posts;
  } catch (e) {
    console.warn('[Posts] Failed to fetch from server:', e);
    return [];
  }
}

async function fetchJobsFromServer(): Promise<Job[]> {
  try {
    // /api/jobs is public - use direct fetch without auth
    const baseUrl = getApiUrl();
    const url = new URL('/api/jobs', baseUrl);
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data : data.jobs || []) as Job[];
  } catch (e) {
    console.warn('[Jobs] Failed to fetch from server:', e);
    return [];
  }
}

const PROFILES_PAGE_SIZE = 500;

async function fetchProfilesFromServer(offset = 0): Promise<UserProfile[]> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL(`/api/profiles?limit=${PROFILES_PAGE_SIZE}&offset=${offset}`, baseUrl);
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    const page = (Array.isArray(data) ? data : data.profiles || []) as UserProfile[];
    console.log('[Profiles] Fetched', page.length, 'profiles (offset', offset, ')');
    return page;
  } catch (e) {
    console.warn('[Profiles] Failed to fetch from server:', e);
    return [];
  }
}

async function fetchConversationsFromServer(userId: string): Promise<Conversation[]> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL(`/api/conversations/${userId}`, baseUrl);
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return (data as any[]).map((c: any) => ({
      id: c.id,
      participantIds: [c.participant1Id, c.participant2Id],
      participantNames: [c.participant1Name, c.participant2Name],
      participantRoles: [c.participant1Role, c.participant2Role] as UserRole[],
      lastMessage: c.lastMessage || undefined,
      lastMessageSenderId: c.lastMessageSenderId || undefined,
      lastMessageAt: c.lastMessageAt,
      messages: [],
      unreadCount: 0,
    }));
  } catch (e) {
    console.warn('[Chat] Failed to fetch conversations:', e);
    return [];
  }
}

async function fetchMessagesFromServer(conversationId: string): Promise<ChatMessage[]> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL(`/api/messages/${conversationId}`, baseUrl);
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return (data as any[]).map((m: any) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: m.senderName,
      text: m.text || '',
      image: m.image || undefined,
      createdAt: m.createdAt,
    }));
  } catch (e) {
    console.warn('[Chat] Failed to fetch messages:', e);
    return [];
  }
}

async function pollMessagesFromServer(conversationId: string, sinceTs: number): Promise<ChatMessage[]> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL(`/api/messages/${conversationId}/since/${sinceTs}`, baseUrl);
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return (data as any[]).map((m: any) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: m.senderName,
      text: m.text || '',
      image: m.image || undefined,
      createdAt: m.createdAt,
    }));
  } catch (e) {
    return [];
  }
}

async function validateSessionWithServer(sessionToken: string, phone: string): Promise<boolean> {
  try {
    const baseUrl = getApiUrl();
    const url = new URL('/api/session/validate', baseUrl);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken, phone }),
    });
    if (!res.ok) return false;
    const data = await res.json() as any;
    return data.valid === true;
  } catch (e) {
    console.warn('[Session] Validation failed:', e);
    return true;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [allProfiles, setAllProfiles] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const postsOffsetRef = useRef(0);
  const [hasMoreProfiles, setHasMoreProfiles] = useState(false);
  const profilesOffsetRef = useRef(0);
  const [liveChatUnread, setLiveChatUnread] = useState(0);
  const [navigationMode, setNavigationMode] = useState<'default' | 'marketplace'>('default');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastConvoTimestamps = useRef<Record<string, number>>({});
  const activeChatIdRef = useRef<string | null>(null);
  const isOnLiveChatRef = useRef(false);

  const setActiveChatId = useCallback((chatId: string | null) => {
    activeChatIdRef.current = chatId;
  }, []);

  const resetLiveChatUnread = useCallback(() => {
    setLiveChatUnread(0);
    isOnLiveChatRef.current = true;
  }, []);

  const setLiveChatActive = useCallback((active: boolean) => {
    isOnLiveChatRef.current = active;
    if (active) setLiveChatUnread(0);
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  // Poll live chat for new messages to track unread badge (replaces Socket.IO)
  useEffect(() => {
    if (!profile || !isOnboarded) return;
    let lastLiveChatTs = Date.now();

    const checkLiveChat = async () => {
      if (isOnLiveChatRef.current || !profile?.id) return;
      try {
        const res = await apiRequest('GET', `/api/live-chat/messages?limit=5&after=${lastLiveChatTs}`);
        if (res.status === 401) {
          console.log('[Context] Session expired during live chat poll');
          return;
        }
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const newMsgs = data.filter((m: any) => m.senderId !== profile.id);
          if (newMsgs.length > 0) {
            setLiveChatUnread(prev => prev + newMsgs.length);
            const latest = newMsgs[newMsgs.length - 1];
            playMessageSound();
            showMessageNotification(latest.senderName || 'Live Chat', latest.message || '📷 Image');
          }
          const maxTs = Math.max(...data.map((m: any) => typeof m.createdAt === 'number' ? m.createdAt : 0));
          if (maxTs > lastLiveChatTs) lastLiveChatTs = maxTs;
        }
      } catch (e) {}
    };

    // Disabled - conversations already polled every 60s in main polling interval
    // const liveChatPollInterval = setInterval(checkLiveChat, 120000);
    // return () => clearInterval(liveChatPollInterval);
  }, [profile?.id, isOnboarded]);

  useEffect(() => {
    if (profile && isOnboarded) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      const sendHeartbeat = async () => {
        try {
          await apiRequest('POST', '/api/heartbeat', { userId: profile.id });
        } catch (e) {}
      };
      sendHeartbeat();

      let pollCount = 0;
      pollingRef.current = setInterval(async () => {
        if (!profile?.id) return;
        try {
          // Only fetch conversations + heartbeat (critical for chat)
          // Heavy data (posts, jobs, profiles) only fetched on manual refresh
          const serverConvos = await fetchConversationsFromServer(profile.id);
          if (serverConvos.length > 0) {
            for (const convo of serverConvos) {
              const prevTs = lastConvoTimestamps.current[convo.id] || 0;
              const newTs = convo.lastMessageAt || 0;
              if (newTs > prevTs && prevTs > 0 && convo.lastMessage) {
                const isFromMe = convo.lastMessageSenderId === profile.id;
                const isActiveChat = activeChatIdRef.current === convo.id;
                if (!isFromMe && !isActiveChat) {
                  const otherIdx = convo.participantIds[0] === profile.id ? 1 : 0;
                  const senderName = convo.participantNames[otherIdx];
                  playMessageSound();
                  showMessageNotification(senderName, convo.lastMessage || '');
                }
              }
              lastConvoTimestamps.current[convo.id] = newTs;
            }
            setConversations(serverConvos);
          }
          sendHeartbeat();
        } catch (e) {
          console.warn('[Poll] Error:', e);
        }
      }, 60000);

      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    }
  }, [profile?.id, isOnboarded]);

  const loadData = async () => {
    try {
      const savedProfile = await Storage.getProfile();
      const onboarded = await Storage.isOnboarded();
      const sessionToken = await Storage.getSessionToken();

      if (savedProfile && onboarded && sessionToken) {
        setProfileState(savedProfile);
        setIsOnboarded(true);

        // Fetch primary screen data (Posts) to unblock UI immediately
        const serverPosts = await fetchPostsFromServer(0);
        postsOffsetRef.current = serverPosts.length;
        setHasMorePosts(serverPosts.length >= POSTS_PAGE_SIZE);
        setPosts(serverPosts);
        
        // Immediately unblock the UI!
        setIsLoading(false);

        // Fetch secondary heavy data in the background silently
        Promise.all([
          fetchJobsFromServer(),
          fetchProfilesFromServer(0),
          fetchConversationsFromServer(savedProfile.id)
        ]).then(([serverJobs, serverProfiles, serverConvos]) => {
          profilesOffsetRef.current = serverProfiles.length;
          setHasMoreProfiles(serverProfiles.length >= PROFILES_PAGE_SIZE);
          setJobs(serverJobs);
          setAllProfiles(serverProfiles);
          if (serverConvos.length > 0) setConversations(serverConvos);

          const serverProfile = serverProfiles.find((p: any) => p.id === savedProfile.id);
          if (serverProfile && serverProfile.id) {
            setProfileState(serverProfile);
            Storage.saveProfile(serverProfile).catch(() => {});
          }
        }).catch(err => console.warn('[Background Sync] Error:', err));

        // Register push token in background (non-blocking with timeout)
        Promise.race([
          registerPushToken(savedProfile.id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
        ]).catch(() => {});
      } else {
        setIsOnboarded(false);
        setProfileState(null);
        setIsLoading(false);
      }
    } catch (e) {
      console.error('Failed to load data:', e);
      setIsOnboarded(false);
      setProfileState(null);
      setIsLoading(false);
    }
  };

  const refreshData = useCallback(async () => {
    const [serverPosts, serverJobs, serverProfiles] = await Promise.all([
      fetchPostsFromServer(0),
      fetchJobsFromServer(),
      fetchProfilesFromServer(0),
    ]);
    postsOffsetRef.current = serverPosts.length;
    setHasMorePosts(serverPosts.length >= POSTS_PAGE_SIZE);
    profilesOffsetRef.current = serverProfiles.length;
    setHasMoreProfiles(serverProfiles.length >= PROFILES_PAGE_SIZE);
    setPosts(serverPosts);
    setJobs(serverJobs);
    setAllProfiles(serverProfiles);

    if (profile) {
      const serverConvos = await fetchConversationsFromServer(profile.id);
      setConversations(serverConvos);
    }
  }, [profile]);

  const loadMoreProfiles = useCallback(async () => {
    if (!hasMoreProfiles) return;
    try {
      const moreProfiles = await fetchProfilesFromServer(profilesOffsetRef.current);
      if (moreProfiles.length === 0) {
        setHasMoreProfiles(false);
        return;
      }
      profilesOffsetRef.current += moreProfiles.length;
      setHasMoreProfiles(moreProfiles.length >= PROFILES_PAGE_SIZE);
      setAllProfiles(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newProfiles = moreProfiles.filter(p => !existingIds.has(p.id));
        return [...prev, ...newProfiles];
      });
    } catch (e) {
      console.warn('[Profiles] loadMoreProfiles error:', e);
    }
  }, [hasMoreProfiles]);

  const loadMorePosts = useCallback(async () => {
    if (!hasMorePosts) return;
    try {
      const morePosts = await fetchPostsFromServer(postsOffsetRef.current);
      if (morePosts.length === 0) {
        setHasMorePosts(false);
        return;
      }
      postsOffsetRef.current += morePosts.length;
      setHasMorePosts(morePosts.length >= POSTS_PAGE_SIZE);
      setPosts(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newPosts = morePosts.filter(p => !existingIds.has(p.id));
        return [...prev, ...newPosts];
      });
    } catch (e) {
      console.warn('[Posts] loadMorePosts error:', e);
    }
  }, [hasMorePosts]);

  const setProfile = useCallback(async (p: UserProfile) => {
    try {
      await Storage.saveProfile(p);
      setProfileState(p);
      syncProfileToServer(p).catch(() => {});
    } catch (e) {
      console.error('[Context] setProfile error:', e);
      setProfileState(p);
    }
  }, []);

  const completeOnboarding = useCallback(async (p: UserProfile, sessionToken: string) => {
    try {
      await Storage.saveProfile(p);
      await Storage.setOnboarded();
      await Storage.saveSessionToken(sessionToken);
      setProfileState(p);
      setIsOnboarded(true);
      const deviceId = await getDeviceId();
      syncProfileToServer(p, deviceId).catch(() => {});
      await refreshData().catch(() => {});
      registerPushToken(p.id, sessionToken).catch(() => {});
    } catch (e) {
      console.error('[Context] completeOnboarding error:', e);
      setProfileState(p);
      setIsOnboarded(true);
    }
  }, [refreshData]);

  const loginWithProfile = useCallback(async (p: UserProfile, sessionToken: string) => {
    try {
      await Storage.saveProfile(p);
      await Storage.setOnboarded();
      await Storage.saveSessionToken(sessionToken);
      setProfileState(p);
      setIsOnboarded(true);

      // Fetch primary data quickly to unblock login transition
      const serverPosts = await fetchPostsFromServer(0);
      postsOffsetRef.current = serverPosts.length;
      setHasMorePosts(serverPosts.length >= POSTS_PAGE_SIZE);
      setPosts(serverPosts);

      // background secondary data
      Promise.all([
        fetchJobsFromServer(),
        fetchConversationsFromServer(p.id),
        fetchProfilesFromServer(0),
      ]).then(([serverJobs, serverConvos, serverProfiles]) => {
        profilesOffsetRef.current = serverProfiles.length;
        setHasMoreProfiles(serverProfiles.length >= PROFILES_PAGE_SIZE);
        setJobs(serverJobs);
        setConversations(serverConvos);
        setAllProfiles(serverProfiles);
      }).catch(err => console.warn('[Login Sync] Error:', err));

      registerPushToken(p.id, sessionToken).catch(() => {});
    } catch (e) {
      console.error('[Context] loginWithProfile error:', e);
      setProfileState(p);
      setIsOnboarded(true);
    }
  }, []);

  const uploadLocalImage = useCallback(async (localUri: string): Promise<string | null> => {
    try {
      const baseUrl = getApiUrl();
      const uploadUrl = new URL('/api/upload', baseUrl).toString();

      if (Platform.OS === 'web') {
        const response = await globalThis.fetch(localUri);
        const blob = await response.blob();
        const formData = new FormData();
        formData.append('image', blob, 'chat-image.jpg');
        const uploadRes = await globalThis.fetch(uploadUrl, { method: 'POST', body: formData });
        const data = await uploadRes.json();
        if (data.url) return new URL(data.url, baseUrl).toString();
        return null;
      } else {
        const formData = new FormData();
        formData.append('image', {
          uri: localUri,
          name: 'chat-image.jpg',
          type: 'image/jpeg',
        } as any);
        const uploadRes = await expoFetch(uploadUrl, { method: 'POST', body: formData });
        const data = await uploadRes.json();
        if (data.url) return new URL(data.url, baseUrl).toString();
        return null;
      }
    } catch (e) {
      console.warn('[Context] Image upload failed:', e);
      return null;
    }
  }, []);

  const addPost = useCallback(async (postData: Omit<Post, 'id' | 'createdAt' | 'likes' | 'comments'>) => {
    try {
      let finalImages = postData.images || [];
      console.log('[addPost] START: images received from create screen:', finalImages);
      const isLocalUri = (uri: string) => uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('ph://') || uri.startsWith('blob:') || uri.startsWith('data:');
      const localImages = finalImages.filter(isLocalUri);
      if (localImages.length > 0) {
        const uploaded = await Promise.all(localImages.map(uri => uploadLocalImage(uri)));
        finalImages = finalImages.map(uri => {
          if (isLocalUri(uri)) {
            const idx = localImages.indexOf(uri);
            return uploaded[idx] || '';
          }
          return uri;
        }).filter(u => u !== '');
      }

      console.log('[addPost] SENDING TO API:', { userId: postData.userId, textLen: postData.text.length, imageCount: finalImages.length, imageUrls: finalImages });
      const res = await apiRequest('POST', '/api/posts', {
        userId: postData.userId,
        userName: postData.userName,
        userRole: postData.userRole,
        userAvatar: postData.userAvatar || '',
        text: postData.text,
        images: finalImages,
        videoUrl: (postData as any).videoUrl || '',
        category: postData.category,
      });
      const data = await res.json();
      console.log('[addPost] API RESPONSE:', { success: data.success, postId: data.post?.id, receivedImages: data.post?.images?.length || 0 });
      if (data.success && data.post) {
        console.log('[addPost] SUCCESS - Post stored:', { id: data.post.id, images: data.post.images });
        setPosts(prev => [data.post, ...prev]);
      } else {
        throw new Error(data.message || 'Server did not return post');
      }
    } catch (e) {
      console.error('[addPost] ERROR:', e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, [uploadLocalImage]);

  const toggleLike = useCallback(async (postId: string) => {
    if (!profile) return;
    try {
      const res = await apiRequest('POST', `/api/posts/${postId}/like`, { userId: profile.id });
      const data = await res.json();
      if (data.success) {
        setPosts(prev => prev.map(p => {
          if (p.id !== postId) return p;
          return { ...p, likes: data.likes };
        }));
      }
    } catch (e) {
      console.error('[Posts] Failed to toggle like:', e);
    }
  }, [profile]);

  const addComment = useCallback(async (postId: string, text: string) => {
    if (!profile) return;
    try {
      const res = await apiRequest('POST', `/api/posts/${postId}/comment`, {
        userId: profile.id,
        userName: profile.name,
        text,
      });
      const data = await res.json();
      if (data.success && data.comment) {
        setPosts(prev => prev.map(p => {
          if (p.id !== postId) return p;
          return { ...p, comments: [...p.comments, data.comment] };
        }));
      }
    } catch (e) {
      console.error('[Posts] Failed to add comment:', e);
    }
  }, [profile]);

  const deletePostCb = useCallback(async (postId: string) => {
    try {
      await apiRequest('DELETE', `/api/posts/${postId}`);
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch (e) {
      console.error('[Posts] Failed to delete:', e);
    }
  }, []);

  const updatePostCb = useCallback((postId: string, updates: Partial<{ text: string; category: PostCategory }>) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...updates } : p));
  }, []);

  const addJob = useCallback(async (jobData: Omit<Job, 'id' | 'createdAt'>) => {
    try {
      const res = await apiRequest('POST', '/api/jobs', jobData);
      const data = await res.json();
      if (data.success && data.job) {
        setJobs(prev => [data.job, ...prev]);
      }
    } catch (e) {
      console.error('[Jobs] Failed to create:', e);
    }
  }, []);

  const deleteJobCb = useCallback(async (jobId: string) => {
    try {
      await apiRequest('DELETE', `/api/jobs/${jobId}`);
      setJobs(prev => prev.filter(j => j.id !== jobId));
    } catch (e) {
      console.error('[Jobs] Failed to delete:', e);
    }
  }, []);

  const startConversation = useCallback(async (otherUserId: string, otherUserName: string, otherUserRole: UserRole): Promise<string> => {
    if (!profile) return '';

    try {
      const res = await apiRequest('POST', '/api/conversations', {
        participant1Id: profile.id,
        participant1Name: profile.name,
        participant1Role: profile.role,
        participant2Id: otherUserId,
        participant2Name: otherUserName,
        participant2Role: otherUserRole,
      });
      const data = await res.json();
      const convo = data.conversation;

      const mappedConvo: Conversation = {
        id: convo.id,
        participantIds: [convo.participant1Id, convo.participant2Id],
        participantNames: [convo.participant1Name, convo.participant2Name],
        participantRoles: [convo.participant1Role, convo.participant2Role] as UserRole[],
        lastMessage: convo.lastMessage || undefined,
        lastMessageAt: convo.lastMessageAt,
        messages: [],
        unreadCount: 0,
      };

      setConversations(prev => {
        const exists = prev.find(c => c.id === mappedConvo.id);
        if (exists) return prev;
        return [mappedConvo, ...prev];
      });

      return convo.id;
    } catch (e) {
      console.error('[Chat] Start conversation error:', e);
      return '';
    }
  }, [profile]);

  const sendMessage = useCallback(async (convoId: string, text: string, image?: string) => {
    if (!profile) return;

    const trimmedText = (text || '').trim();
    let cleanImage = image || '';

    if (cleanImage && (cleanImage.startsWith('file://') || cleanImage.startsWith('content://') || cleanImage.startsWith('ph://'))) {
      console.log('[Context] Intercepting local URI, uploading first:', cleanImage.substring(0, 50));
      const serverUrl = await uploadLocalImage(cleanImage);
      if (serverUrl) {
        cleanImage = serverUrl;
      } else {
        console.warn('[Context] Upload failed, cannot send image');
        return;
      }
    }

    if (!trimmedText && !cleanImage) return;

    try {
      const res = await apiRequest('POST', '/api/messages', {
        conversationId: convoId,
        senderId: profile.id,
        senderName: profile.name,
        text: trimmedText,
        image: cleanImage,
      });

      const data = await res.json();
      if (!data.success || !data.message) return;

      const newMsg: ChatMessage = {
        id: data.message.id,
        senderId: data.message.senderId,
        senderName: data.message.senderName,
        text: data.message.text || '',
        image: data.message.image || undefined,
        createdAt: data.message.createdAt,
      };

      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.id !== convoId) return c;
          return {
            ...c,
            messages: [...c.messages, newMsg],
            lastMessage: cleanImage ? (trimmedText || 'Sent an image') : trimmedText,
            lastMessageAt: Date.now(),
          };
        });
        return updated.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      });
    } catch (e) {
      console.warn('[Chat] Send message failed:', e);
    }
  }, [profile, uploadLocalImage]);

  const deleteConversationCb = useCallback(async (convoId: string) => {
    try {
      await apiRequest('DELETE', `/api/conversations/${convoId}`);
      setConversations(prev => prev.filter(c => c.id !== convoId));
    } catch (e) {
      console.error('[Chat] Delete conversation error:', e);
    }
  }, []);

  const loadMessages = useCallback(async (convoId: string): Promise<ChatMessage[]> => {
    const msgs = await fetchMessagesFromServer(convoId);
    setConversations(prev => prev.map(c => {
      if (c.id !== convoId) return c;
      return { ...c, messages: msgs };
    }));
    return msgs;
  }, []);

  const pollMessages = useCallback(async (convoId: string, sinceTs: number): Promise<ChatMessage[]> => {
    const newMsgs = await pollMessagesFromServer(convoId, sinceTs);
    if (newMsgs.length > 0) {
      setConversations(prev => prev.map(c => {
        if (c.id !== convoId) return c;
        const existingIds = new Set(c.messages.map(m => m.id));
        const uniqueNew = newMsgs.filter(m => !existingIds.has(m.id));
        if (uniqueNew.length === 0) return c;
        return { ...c, messages: [...c.messages, ...uniqueNew] };
      }));
    }
    return newMsgs;
  }, []);

  const logout = useCallback(async () => {
    try {
      await Storage.clearAll();
      setProfileState(null);
      setPosts([]);
      setJobs([]);
      setConversations([]);
      setAllProfiles([]);
      setIsOnboarded(false);
      if (pollingRef.current) clearInterval(pollingRef.current);
    } catch (e) {
      console.error('[Logout] Error:', e);
    }
  }, []);

  const totalUnread = useMemo(() =>
    conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations]
  );

  const value = useMemo(() => ({
    profile,
    posts,
    setPosts,
    jobs,
    conversations,
    allProfiles,
    isLoading,
    isOnboarded,
    hasMorePosts,
    loadMorePosts,
    hasMoreProfiles,
    loadMoreProfiles,
    navigationMode,
    setNavigationMode,
    setProfile,
    completeOnboarding,
    loginWithProfile,
    addPost,
    toggleLike,
    addComment,
    deletePost: deletePostCb,
    updatePost: updatePostCb,
    addJob,
    deleteJob: deleteJobCb,
    refreshData,
    startConversation,
    sendMessage,
    deleteConversation: deleteConversationCb,
    logout,
    totalUnread,
    liveChatUnread,
    resetLiveChatUnread,
    setLiveChatActive,
    loadMessages,
    pollMessages,
    setActiveChatId,
  }), [profile, posts, jobs, conversations, allProfiles, isLoading, isOnboarded, hasMorePosts, loadMorePosts, hasMoreProfiles, loadMoreProfiles, navigationMode, setProfile, completeOnboarding, loginWithProfile, addPost, toggleLike, addComment, deletePostCb, updatePostCb, addJob, deleteJobCb, refreshData, startConversation, sendMessage, deleteConversationCb, logout, totalUnread, liveChatUnread, resetLiveChatUnread, setLiveChatActive, loadMessages, pollMessages, setActiveChatId]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
