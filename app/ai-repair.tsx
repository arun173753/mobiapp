import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable,
  ScrollView, Platform, KeyboardAvoidingView, ActivityIndicator,
  Alert, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import {
  cacheDirectory,
  writeAsStringAsync,
  readAsStringAsync,
  EncodingType,
} from 'expo-file-system/legacy';
import { getApiUrl } from '@/lib/query-client';

const BG      = '#FFFFFF';
const CARD    = '#F9FAFB';
const SURFACE = '#F3F4F6';
const BORDER  = '#E5E7EB';
const TEXT    = '#111827';
const MUTED   = '#6B7280';
const ACCENT  = '#FF6B2C';
const BLUE    = '#3B82F6';
const PURPLE  = '#8B5CF6';
const GREEN   = '#10B981';
const AMBER   = '#F59E0B';

type Tab = 'chat' | 'scan' | 'voice' | 'library';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const QUICK_PROBLEMS = [
  { label: 'No Power', icon: 'battery-dead-outline' as const, color: '#EF4444', query: 'My mobile phone is completely dead and shows no power. What could be the hardware cause and how do I fix it?' },
  { label: 'Charging Issue', icon: 'flash-outline' as const, color: AMBER, query: 'The phone is not charging at all. Battery is fine but not charging. What hardware component should I check?' },
  { label: 'Display Problem', icon: 'phone-portrait-outline' as const, color: BLUE, query: 'The display is not working / showing white lines / black screen but phone turns on. What could be the hardware issue?' },
  { label: 'Network Issue', icon: 'wifi-outline' as const, color: PURPLE, query: 'Phone has no network signal / no SIM detected. What network IC or hardware should I diagnose?' },
  { label: 'Audio Problem', icon: 'volume-mute-outline' as const, color: GREEN, query: 'Phone has no sound / speaker not working / microphone issues. What audio IC or component should I check?' },
  { label: 'Water Damage', icon: 'water-outline' as const, color: '#06B6D4', query: 'Phone got water damaged. What are the steps to diagnose and repair water damaged mobile phone motherboard?' },
  { label: 'Short Circuit', icon: 'warning-outline' as const, color: '#EF4444', query: 'Mobile motherboard has a short circuit. The phone gets hot and battery drains immediately. How to find and fix the short?' },
  { label: 'Backlight', icon: 'sunny-outline' as const, color: AMBER, query: 'Phone screen shows image but no backlight / screen very dim. What backlight IC or fuse should I check?' },
];

const REPAIR_LIBRARY = [
  {
    id: '1', category: 'No Power', icon: 'battery-dead' as const, color: '#EF4444',
    title: 'Dead Phone - No Power Diagnosis',
    description: 'Phone is completely dead, no response when charging or pressing power button.',
    causes: ['Blown fuse on charging line', 'Dead/shorted battery', 'PMIC (Power Management IC) failure', 'Short circuit on main board', 'Damaged power button flex'],
    steps: [
      'Check battery voltage with multimeter (should be 3.7V-4.2V)',
      'Measure current draw when charging (0mA = open circuit, very high = short)',
      'Check F1 fuse on charging line for continuity',
      'Test power button flex cable for continuity',
      'Inject battery voltage to test if PMIC responds',
      'Check for shorted capacitors near PMIC with multimeter diode mode',
      'Reball or replace PMIC if faulty',
    ],
    tools: ['Multimeter', 'DC Power Supply', 'Hot Air Station', 'Soldering Iron', 'BGA Reball Kit'],
    difficulty: 'Advanced',
  },
  {
    id: '2', category: 'Charging Issues', icon: 'flash' as const, color: AMBER,
    title: 'Phone Not Charging - Charging IC Fault',
    description: 'Phone does not charge, shows charging animation but battery does not increase.',
    causes: ['Damaged USB port / charging port pins', 'Faulty Charging IC (e.g., BQ25895)', 'Blown charging fuse', 'Damaged VBUS line', 'Bad battery connection'],
    steps: [
      'Inspect USB port visually for bent or broken pins',
      'Clean port with IPA alcohol and soft brush',
      'Check fuse F7701 (or equivalent) for continuity',
      'Measure VBUS voltage at charging IC input (should be 5V)',
      'Check charging IC output voltage with multimeter',
      'Reflow charging IC with hot air station at 350°C',
      'Replace charging IC if reflow does not resolve',
      'Test with known-good USB cable and charger',
    ],
    tools: ['Multimeter', 'Hot Air Station', 'Soldering Iron', 'IPA Alcohol', 'Flux', 'Tweezers'],
    difficulty: 'Intermediate',
  },
  {
    id: '3', category: 'Display Problems', icon: 'phone-portrait' as const, color: BLUE,
    title: 'No Display / White Screen / Lines on Display',
    description: 'Screen shows white/blank/lines but phone boots (LED, vibration, sound present).',
    causes: ['Damaged display connector on motherboard', 'Faulty display IC', 'Broken display flex cable', 'Dead pixel row (for lines)', 'LCD driver IC failure'],
    steps: [
      'Reseat display flex connector firmly',
      'Test with a known-good display',
      'Check display connector pins for damage or corrosion',
      'Measure display power supply voltage (usually 5.5V-6V)',
      'Inspect display IC with microscope for damaged pads',
      'Reflow display IC area if no visible damage',
      'Replace display IC if problem persists',
    ],
    tools: ['Multimeter', 'Microscope', 'Hot Air Station', 'Soldering Iron', 'Flux', 'Replacement Display'],
    difficulty: 'Advanced',
  },
  {
    id: '4', category: 'Network Issues', icon: 'wifi' as const, color: PURPLE,
    title: 'No Signal / No SIM / Network IC Problem',
    description: 'Phone shows no network, SIM not detected, or signal drops constantly.',
    causes: ['Damaged RF IC (Transceiver)', 'Faulty baseband IC / CPU area', 'Broken antenna connection', 'Damaged SIM card slot', 'Corrupted IMEI (software or hardware)'],
    steps: [
      'Clean SIM slot with IPA alcohol',
      'Test with different SIM card',
      'Check SIM slot pins for damage',
      'Measure SIM card voltage (1.8V or 3V)',
      'Check antenna connections and cables',
      'Inspect RF IC area with microscope',
      'Reflow RF transceiver IC',
      'Replace RF IC if necessary (requires BGA skills)',
    ],
    tools: ['Microscope', 'Hot Air Station', 'BGA Reball Kit', 'Multimeter', 'IPA Alcohol'],
    difficulty: 'Expert',
  },
  {
    id: '5', category: 'Water Damage', icon: 'water' as const, color: '#06B6D4',
    title: 'Water Damaged Phone - Recovery Steps',
    description: 'Phone stopped working after contact with water or other liquid.',
    causes: ['Corrosion on connectors and ICs', 'Short circuit from liquid bridging contacts', 'Oxidized component legs', 'Damaged NAND/CPU from liquid exposure'],
    steps: [
      'IMMEDIATELY power off and remove battery if possible',
      'Disassemble phone completely',
      'Ultrasonic clean the board with IPA alcohol',
      'Use soft brush to scrub corrosion from all components',
      'Dry with hot air at low temperature (60-70°C)',
      'Inspect under microscope for remaining corrosion',
      'Reflow or replace any visibly damaged ICs',
      'Clean all flex connectors with IPA',
      'Test board before reassembly',
    ],
    tools: ['Ultrasonic Cleaner', 'IPA Alcohol 99%', 'Soft Brush', 'Hot Air Station', 'Microscope', 'Tweezers'],
    difficulty: 'Intermediate',
  },
  {
    id: '6', category: 'Short Circuit', icon: 'warning' as const, color: '#EF4444',
    title: 'Motherboard Short Circuit Diagnosis',
    description: 'Battery drains instantly, phone gets hot, or blows fuse immediately.',
    causes: ['Shorted capacitor on power rails', 'Damaged IC with internal short', 'Liquid damage causing bridge', 'Bent pin touching ground plane'],
    steps: [
      'Disconnect battery before testing',
      'Set multimeter to diode mode',
      'Check each power rail: VBAT, VCC, 1.8V, 3.3V rails for short to ground',
      'Apply freezer spray or heat to locate shorted component',
      'Use DC power supply with current limit to locate heat source',
      'Remove suspicious capacitors one by one near short location',
      'Replace shorted component',
      'Verify short is resolved before applying full power',
    ],
    tools: ['Multimeter', 'DC Power Supply', 'Freezer Spray', 'Thermal Camera', 'Hot Air Station', 'Tweezers'],
    difficulty: 'Expert',
  },
];

export default function AIRepairScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const chatListRef = useRef<FlatList>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [autoPlayNextResponse, setAutoPlayNextResponse] = useState(false);

  // Scan state
  const [scanImage, setScanImage] = useState<{ uri: string; base64?: string | null; mimeType: string } | null>(null);
  const [scanResult, setScanResult] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Library state
  const [librarySearch, setLibrarySearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedSolution, setExpandedSolution] = useState<string | null>(null);

  // Voice Chat state (separate from text chat)
  const [voiceChatMessages, setVoiceChatMessages] = useState<ChatMessage[]>([]);
  const [voiceChatStreaming, setVoiceChatStreaming] = useState(false);
  const [voiceChatStreamingText, setVoiceChatStreamingText] = useState('');
  const [voiceErr, setVoiceErr] = useState<string | null>(null);

  // ─── Chat Logic ─────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    // Add message and keep last 20 messages in memory
    setMessages(prev => {
      const updated = [userMsg, ...prev];
      return updated.slice(0, 20);
    });
    setInputText('');
    setIsStreaming(true);
    setStreamingText('');

    // Include full conversation history (up to 20 recent messages) with system prompt
    const fullHistory = [...messages, userMsg].reverse().map(m => ({
      role: m.role,
      content: m.content,
    }));
    
    const history = [
      { role: 'system' as const, content: 'You are an expert mobile phone hardware repair technician with 20+ years of experience. Help diagnose and repair mobile phone hardware issues. Be specific about components, tools, and repair steps.' },
      ...fullHistory,
    ];

    try {
      const url = new URL('/api/ai/repair/chat', getApiUrl());
      abortRef.current = new AbortController();

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({ messages: history }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'AI service error');
      }

      // Read fallback using raw text for RN Environment without stream readers
      const fullTextResponse = await response.text();
      let fullText = '';
      
      const lines = fullTextResponse.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') break;
          if (!dataStr) continue;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed && typeof parsed.content === 'string') {
              fullText += parsed.content;
            }
          } catch (parseErr) {}
        }
      }

      // Ensure fullText is a string before creating message
      const finalText = String(fullText).trim() || 'Sorry, I could not generate a response. Please try again.';
      
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: finalText,
        timestamp: new Date(),
      };
      
      setMessages(prev => [aiMsg, ...prev]);
      setStreamingText('');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[AI Chat] Error:', err);
        Alert.alert('Error', 'Could not reach AI. Check your connection.');
      }
    } finally {
      setIsStreaming(false);
      setStreamingText('');
    }
  }, [isStreaming, messages]);

  const handleQuickProblem = (query: string) => {
    sendMessage(query);
  };

  const shareAsPost = (content: string) => {
    router.push({
      pathname: '/create',
      params: {
        prefillContent: `🤖 AI Repair Solution\n\n${content}`,
        prefillCategory: 'repair',
      },
    });
  };

  // DEFINE PLAYVICE FIRST (before sendVoiceMessage which uses it)
  const playVoice = useCallback(async (messageId: string, text: string) => {
    try {
      // On web, use browser's Web Speech API (free, instant, no API calls)
      if ((Platform as { OS: string }).OS === 'web') {
        // If already playing this message, stop it
        if (playingMessageId === messageId) {
          console.log('[TTS] Stopping current speech...');
          (window as any).speechSynthesis.cancel();
          setPlayingMessageId(null);
          return;
        }

        // Stop any currently playing speech before starting new one
        console.log('[TTS] Cancelling previous speech...');
        (window as any).speechSynthesis.cancel();
        
        setPlayingMessageId(messageId);
        console.log('[TTS] Playing text:', text.substring(0, 50) + '...');

        try {
          const utterance = new (window as any).SpeechSynthesisUtterance(text);
          utterance.rate = 1;
          utterance.pitch = 1;
          utterance.volume = 1;
          
          utterance.onend = () => {
            console.log('[TTS] Web Speech finished');
            if (playingMessageId === messageId) {
              setPlayingMessageId(null);
            }
          };
          
          utterance.onerror = (event: any) => {
            console.error('[TTS] Web Speech error:', event.error);
            if (playingMessageId === messageId) {
              setPlayingMessageId(null);
            }
          };
          
          console.log('[TTS] Using Web Speech API...');
          (window as any).speechSynthesis.speak(utterance);
          return;
        } catch (webErr: any) {
          console.error('[TTS] Web Speech error:', webErr);
          setPlayingMessageId(null);
          setVoiceErr('Speech synthesis not available on this browser');
          return;
        }
      }

      // On mobile, use React Native Audio with backend TTS
      // Stop current playback
      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
        } catch (e) {
          // Ignore stop errors
        }
        try {
          await soundRef.current.unloadAsync();
        } catch (e) {
          // Ignore unload errors
        }
        soundRef.current = null;
      }

      console.log('[TTS] Requesting audio from backend...');

      if ((Platform as { OS: string }).OS === 'web') {
        const response = await fetch(`${getApiUrl()}/api/ai/repair/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) throw new Error('Could not generate voice');
        const blob = await response.blob();
        if (blob.size === 0) throw new Error('Empty audio response');
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const uri = `data:audio/mpeg;base64,${base64}`;
        const sound = new Audio.Sound();
        soundRef.current = sound;
        await sound.loadAsync({ uri });
      } else {
        const dir = cacheDirectory || '';
        const fileUri = `${dir}tts-${Date.now()}.mp3`;
        const ttsRes = await fetch(`${getApiUrl()}/api/ai/repair/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!ttsRes.ok) {
          throw new Error(`TTS failed with status: ${ttsRes.status}`);
        }
        const arr = new Uint8Array(await ttsRes.arrayBuffer());
        let bs = '';
        for (let i = 0; i < arr.length; i++) bs += String.fromCharCode(arr[i]);
        await writeAsStringAsync(fileUri, btoa(bs), { encoding: EncodingType.Base64 });
        const sound = new Audio.Sound();
        soundRef.current = sound;
        await sound.loadAsync({ uri: fileUri });
      }

      const activeSound = soundRef.current;
      if (!activeSound) return;
      
      let listenerSet = false;
      activeSound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish && listenerSet) {
          console.log('[TTS] Mobile playback finished');
          setPlayingMessageId(null);
          listenerSet = false;
        }
      });
      listenerSet = true;
      
      console.log('[TTS] Playing audio...');
      await activeSound.playAsync();
    } catch (error: any) {
      console.error('[TTS] Playback error:', error);
      setPlayingMessageId(null);
      setVoiceErr(error?.message || 'Could not play voice');
    }
  }, [playingMessageId]);

  // Send voice message to the appropriate chat (DEFINED SECOND, after playVoice)
  const sendVoiceMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const isVoiceTab = activeTab === 'voice';
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    if (isVoiceTab) {
      setVoiceChatMessages(prev => [userMsg, ...prev].slice(0, 20));
      setVoiceChatStreaming(true);
      setVoiceChatStreamingText('');
    } else {
      setMessages(prev => [userMsg, ...prev].slice(0, 20));
      setIsStreaming(true);
      setStreamingText('');
    }

    try {
      const fullHistory = (isVoiceTab ? voiceChatMessages : messages);
      const history = [
        { role: 'system' as const, content: 'You are an expert mobile phone hardware repair technician with 20+ years of experience. Help diagnose and repair mobile phone hardware issues. Be specific about components, tools, and repair steps.' },
        ...fullHistory.map(m => ({ role: m.role, content: m.content })).reverse(),
        userMsg,
      ];

      const url = new URL('/api/ai/repair/chat', getApiUrl());
      abortRef.current = new AbortController();

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({ messages: history }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'AI service error');
      }

      // Read fallback using raw text for RN Environment without stream readers
      const fullTextResponse = await response.text();
      let fullText = '';
      
      const lines = fullTextResponse.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') break;
          if (!dataStr) continue;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed && typeof parsed.content === 'string') {
              fullText += parsed.content;
            }
          } catch (parseErr) {}
        }
      }

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: fullText.trim() || 'No response.',
        timestamp: new Date(),
      };

      if (isVoiceTab) {
        setVoiceChatMessages(prev => [aiMsg, ...prev].slice(0, 20));
        setVoiceChatStreaming(false);
        setVoiceChatStreamingText('');
        // Auto-play TTS response if voice enabled
        if (voiceEnabled && fullText.trim()) {
          setTimeout(() => playVoice(aiMsg.id, fullText), 300);
        }
      } else {
        setMessages(prev => [aiMsg, ...prev].slice(0, 20));
        setIsStreaming(false);
        setStreamingText('');
      }
    } catch (error: any) {
      console.error('[Voice] Message send error:', error);
      if (isVoiceTab) {
        setVoiceChatStreaming(false);
      } else {
        setIsStreaming(false);
      }
    }
  }, [activeTab, messages, voiceChatMessages, voiceEnabled, playVoice]);

  const startVoiceRecord = useCallback(async () => {
    setVoiceErr(null);
    if ((Platform as { OS: string }).OS === 'web') {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      if (!SpeechRecognition) {
        setVoiceErr('Speech recognition not supported on this browser');
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.onstart = () => { setIsRecording(true); };
      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (activeTab === 'voice') { sendVoiceMessage(transcript); } else { sendMessage(transcript); }
      };
      recognition.onerror = (event: any) => {
        console.error('[Voice] Web recognition error:', event.error);
        setIsRecording(false);
        setVoiceErr(event.error || 'Could not understand speech');
      };
      recognition.onend = () => { setIsRecording(false); };
      recognition.start();
      recordingRef.current = recognition as any;
      return;
    }

    // Native: use Expo Audio Recording
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setVoiceErr('Microphone permission is required');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (e: any) {
      console.error('[Voice] Start recording error:', e);
      setVoiceErr('Could not start recording');
    }
  }, [activeTab, sendMessage, sendVoiceMessage]);

  const stopVoiceRecord = useCallback(async () => {
    if ((Platform as { OS: string }).OS === 'web') {
      if (recordingRef.current && (recordingRef.current as any).stop) {
        (recordingRef.current as any).stop();
      }
      setIsRecording(false);
      return;
    }

    // Native: stop Expo Audio recording and send to STT
    const recording = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);
    if (!recording) return;

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    } catch (e) {
      console.warn('[Voice] Stop recording error:', e);
    }

    const uri = recording.getURI();
    if (!uri) { console.warn('[Voice] No URI after recording'); return; }

    try {
      const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
      const mimeType = Platform.OS === 'ios' ? 'audio/m4a' : 'audio/3gp';
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/ai/repair/stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: base64, mimeType }),
      });
      if (!res.ok) {
        console.error('[Voice] STT error:', res.status, await res.text());
        setVoiceErr('Could not transcribe audio');
        return;
      }
      const data = await res.json() as { transcript?: string };
      const transcript = (data.transcript || '').trim();
      if (transcript) {
        if (activeTab === 'voice') { sendVoiceMessage(transcript); } else { sendMessage(transcript); }
      }
    } catch (e: any) {
      console.error('[Voice] STT request error:', e);
      setVoiceErr('Transcription failed');
    }
  }, [activeTab, sendMessage, sendVoiceMessage]);

  // ─── Scan Logic ─────────────────────────────────────────────────────────────

  const pickImage = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (perm.status !== 'granted') {
      Alert.alert('Permission Required', 'Camera/Gallery permission is needed.');
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: 'images',
          quality: 0.7,
          base64: true,
          allowsEditing: true,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          quality: 0.7,
          base64: true,
          allowsEditing: true,
        });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setScanImage({
        uri: asset.uri,
        base64: asset.base64,
        mimeType: asset.mimeType || 'image/jpeg',
      });
      setScanResult('');
    }
  };

  const analyzeImage = async () => {
    if (!scanImage?.base64) {
      Alert.alert('No Image', 'Please select a motherboard image first.');
      return;
    }
    setIsAnalyzing(true);
    setScanResult('');
    try {
      const url = new URL('/api/ai/repair/analyze', getApiUrl());
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: scanImage.base64, mimeType: scanImage.mimeType }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setScanResult(data.analysis);
    } catch (err: any) {
      Alert.alert('Analysis Failed', err.message || 'Could not analyze image.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─── Library Logic ──────────────────────────────────────────────────────────

  const categories = [...new Set(REPAIR_LIBRARY.map(s => s.category))];
  const filteredLibrary = REPAIR_LIBRARY.filter(s => {
    const matchSearch = librarySearch
      ? s.title.toLowerCase().includes(librarySearch.toLowerCase()) ||
        s.description.toLowerCase().includes(librarySearch.toLowerCase()) ||
        s.category.toLowerCase().includes(librarySearch.toLowerCase())
      : true;
    const matchCategory = selectedCategory ? s.category === selectedCategory : true;
    return matchSearch && matchCategory;
  });

  const topPad = insets.top + ((Platform as { OS: string }).OS === 'web' ? 67 : 0);
  const botPad = insets.bottom + ((Platform as { OS: string }).OS === 'web' ? 34 : 0);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const renderChatMessage = useCallback(({ item }: { item: ChatMessage }) => {
    // Validate message structure
    if (!item || !item.role || typeof item.content !== 'string') {
      return null;
    }

    const isUser = item.role === 'user';
    const contentStr = String(item.content).trim();
    const isPlaying = playingMessageId === item.id;
    
    if (!contentStr) {
      return null;
    }

    return (
      <View style={[s.msgRow, isUser ? s.msgRowUser : s.msgRowAI]}>
        {!isUser && (
          <View style={s.aiAvatar}>
            <Ionicons name="hardware-chip" size={16} color={ACCENT} />
          </View>
        )}
        <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleAI]}>
          <Text style={[s.bubbleText, isUser ? s.bubbleTextUser : s.bubbleTextAI]}>
            {contentStr}
          </Text>
          {!isUser && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {voiceEnabled && (
                <Pressable
                  style={[s.actionBtn, isPlaying && { backgroundColor: ACCENT + '30' }]}
                  onPress={() => playVoice(item.id, contentStr)}
                >
                  <Ionicons name={isPlaying ? "pause" : "volume-high"} size={12} color={ACCENT} />
                  <Text style={[s.actionBtnText, { color: ACCENT }]}>{isPlaying ? 'Playing' : 'Listen'}</Text>
                </Pressable>
              )}
              <Pressable
                style={s.actionBtn}
                onPress={() => shareAsPost(contentStr)}
              >
                <Ionicons name="share-outline" size={12} color={MUTED} />
                <Text style={s.actionBtnText}>Share</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    );
  }, [playingMessageId, voiceEnabled, playVoice]);

  const renderChat = () => (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={{ flex: 1 }}>
        {/* Header with conversation count and clear button */}
        {messages.length > 0 && (
          <View style={s.chatHeader}>
            <View style={s.chatHeaderLeft}>
              <Ionicons name="chatbubbles" size={16} color={ACCENT} />
              <Text style={s.chatHeaderText}>Conversation ({messages.length} messages)</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Pressable 
                style={[s.clearBtn, voiceEnabled && { backgroundColor: ACCENT + '15' }]} 
                onPress={() => setVoiceEnabled(!voiceEnabled)}
              >
                <Ionicons name={voiceEnabled ? "volume-high" : "volume-mute"} size={16} color={voiceEnabled ? ACCENT : MUTED} />
                <Text style={[s.clearBtnText, voiceEnabled && { color: ACCENT }]}>{voiceEnabled ? 'Voice On' : 'Voice Off'}</Text>
              </Pressable>
              <Pressable style={s.clearBtn} onPress={() => {
                setMessages([]);
                setInputText('');
                setStreamingText('');
              }}>
                <Ionicons name="close-circle-outline" size={16} color={MUTED} />
                <Text style={s.clearBtnText}>Clear</Text>
              </Pressable>
            </View>
          </View>
        )}
        {messages.length === 0 && !isStreaming ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.quickContainer}
            showsVerticalScrollIndicator={false}
          >
            <View style={s.welcomeBox}>
              <View style={s.welcomeIcon}>
                <Ionicons name="hardware-chip" size={32} color={ACCENT} />
              </View>
              <Text style={s.welcomeTitle}>AI Repair Assistant</Text>
              <Text style={s.welcomeSub}>
                Diagnose any mobile hardware problem instantly. Tap a quick problem, type your question, or use voice.
              </Text>
            </View>
            {/* Prominent "Talk to AI" Button */}
            <View style={s.voicePromptBox}>
              <Pressable
                style={[s.talkToAiBtn, isRecording && { backgroundColor: ACCENT, borderColor: ACCENT }]}
                onPress={() => isRecording ? stopVoiceRecord() : startVoiceRecord()}
              >
                <Ionicons 
                  name={isRecording ? "stop-circle" : "call"} 
                  size={36} 
                  color={isRecording ? '#FFF' : ACCENT}
                />
              </Pressable>
              <Text style={s.voicePromptText}>{isRecording ? 'Listening...' : 'Talk to AI'}</Text>
              <Text style={s.voicePromptSub}>{isRecording ? 'Speak your repair question' : 'Just speak naturally'}</Text>
              {voiceErr ? <Text style={s.voiceErrText}>{voiceErr}</Text> : null}
            </View>
            <Text style={s.quickTitle}>Quick Diagnosis</Text>
            <View style={s.quickGrid}>
              {QUICK_PROBLEMS.map((p) => (
                <Pressable
                  key={p.label}
                  style={[s.quickBtn, { borderColor: p.color + '40' }]}
                  onPress={() => handleQuickProblem(p.query)}
                >
                  <View style={[s.quickIcon, { backgroundColor: p.color + '20' }]}>
                    <Ionicons name={p.icon} size={18} color={p.color} />
                  </View>
                  <Text style={s.quickBtnText}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : (
          <FlatList
            ref={chatListRef}
            data={messages}
            inverted
            keyExtractor={item => item.id}
            renderItem={renderChatMessage}
            contentContainerStyle={s.chatList}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              isStreaming && streamingText ? (
                <View style={[s.msgRow, s.msgRowAI]}>
                  <View style={s.aiAvatar}>
                    <Ionicons name="hardware-chip" size={16} color={ACCENT} />
                  </View>
                  <View style={[s.bubble, s.bubbleAI]}>
                    <Text style={[s.bubbleText, s.bubbleTextAI]}>{streamingText}</Text>
                    <View style={s.typingDots}>
                      <ActivityIndicator size="small" color={ACCENT} />
                    </View>
                  </View>
                </View>
              ) : isStreaming ? (
                <View style={[s.msgRow, s.msgRowAI]}>
                  <View style={s.aiAvatar}>
                    <Ionicons name="hardware-chip" size={16} color={ACCENT} />
                  </View>
                  <View style={[s.bubble, s.bubbleAI, s.typingBubble]}>
                    <ActivityIndicator size="small" color={ACCENT} />
                    <Text style={[s.bubbleText, { color: MUTED, marginLeft: 8 }]}>Analyzing...</Text>
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {/* Input bar */}
        <View style={[s.inputBar, { paddingBottom: botPad + 8 }]}>
          <TextInput
            style={s.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={isRecording ? 'Recording...' : 'Ask a repair question...'}
            placeholderTextColor={isRecording ? ACCENT : MUTED}
            multiline
            maxLength={500}
            onSubmitEditing={() => sendMessage(inputText)}
            editable={!isRecording}
          />
          <Pressable
            style={[s.iconBtn, isRecording && s.iconBtnActive]}
            onPress={() => isRecording ? stopVoiceRecord() : startVoiceRecord()}
          >
            <Ionicons 
              name={isRecording ? "stop-circle" : "mic-outline"} 
              size={18} 
              color={isRecording ? ACCENT : MUTED}
            />
          </Pressable>
          <Pressable
            style={[s.sendBtn, (!inputText.trim() || isStreaming || isRecording) && s.sendBtnDisabled]}
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim() || isStreaming || isRecording}
          >
            <Ionicons name="send" size={18} color="#FFF" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );

  const renderScan = () => (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scanContainer} showsVerticalScrollIndicator={false}>
      <Animated.View entering={FadeInDown.delay(0).duration(400)}>
        <Text style={s.scanTitle}>Motherboard Scan AI</Text>
        <Text style={s.scanSub}>Upload a motherboard or component photo for AI diagnosis</Text>

        {/* Image picker */}
        <View style={s.pickRow}>
          <Pressable style={s.pickBtn} onPress={() => pickImage(true)}>
            <Ionicons name="camera" size={22} color={BLUE} />
            <Text style={s.pickBtnText}>Camera</Text>
          </Pressable>
          <Pressable style={s.pickBtn} onPress={() => pickImage(false)}>
            <Ionicons name="images" size={22} color={PURPLE} />
            <Text style={s.pickBtnText}>Gallery</Text>
          </Pressable>
        </View>

        {/* Image preview */}
        {scanImage ? (
          <View style={s.imagePreview}>
            <Image source={{ uri: scanImage.uri }} style={s.previewImg} resizeMode="contain" />
            <Pressable style={s.removeImg} onPress={() => { setScanImage(null); setScanResult(''); }}>
              <Ionicons name="close-circle" size={24} color="#EF4444" />
            </Pressable>
          </View>
        ) : (
          <View style={s.imagePlaceholder}>
            <Ionicons name="scan-outline" size={48} color={MUTED} />
            <Text style={s.imagePlaceholderText}>No image selected</Text>
            <Text style={s.imagePlaceholderSub}>Take or select a clear photo of the motherboard</Text>
          </View>
        )}

        {/* Analyze button */}
        <Pressable
          style={[s.analyzeBtn, (!scanImage || isAnalyzing) && s.analyzeBtnDisabled]}
          onPress={analyzeImage}
          disabled={!scanImage || isAnalyzing}
        >
          {isAnalyzing ? (
            <>
              <ActivityIndicator size="small" color="#FFF" />
              <Text style={s.analyzeBtnText}>Analyzing Board...</Text>
            </>
          ) : (
            <>
              <Ionicons name="scan" size={18} color="#FFF" />
              <Text style={s.analyzeBtnText}>Analyze Motherboard</Text>
            </>
          )}
        </Pressable>

        {/* Analysis result */}
        {scanResult ? (
          <Animated.View entering={FadeInUp.delay(0).duration(500)} style={s.resultCard}>
            <View style={s.resultHeader}>
              <Ionicons name="hardware-chip" size={18} color={ACCENT} />
              <Text style={s.resultHeaderText}>AI Diagnosis Report</Text>
            </View>
            <Text style={s.resultText}>{scanResult}</Text>
            <Pressable style={s.shareResultBtn} onPress={() => shareAsPost(`📱 Motherboard Analysis\n\n${scanResult}`)}>
              <Ionicons name="share-outline" size={14} color={ACCENT} />
              <Text style={s.shareResultBtnText}>Share Analysis as Post</Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </Animated.View>
    </ScrollView>
  );

  const renderVoiceChat = () => (
    <View style={{ flex: 1 }}>
      {/* Messages */}
      {voiceChatMessages.length > 0 ? (
        <FlatList
          data={voiceChatMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            const contentStr = String(item.content).trim();
            const isPlaying = playingMessageId === item.id;
            
            if (!contentStr) return null;
            
            return (
              <View style={[s.msgRow, isUser ? s.msgRowUser : s.msgRowAI]}>
                {!isUser && (
                  <View style={s.aiAvatar}>
                    <Ionicons name="hardware-chip" size={16} color={ACCENT} />
                  </View>
                )}
                <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleAI]}>
                  <Text style={[s.bubbleText, isUser ? s.bubbleTextUser : s.bubbleTextAI]}>
                    {contentStr}
                  </Text>
                  {!isUser && voiceEnabled && (
                    <Pressable
                      style={[s.actionBtn, isPlaying && { backgroundColor: ACCENT + '30' }]}
                      onPress={() => playVoice(item.id, contentStr)}
                    >
                      <Ionicons name={isPlaying ? "pause" : "volume-high"} size={12} color={ACCENT} />
                      <Text style={[s.actionBtnText, { color: ACCENT }]}>{isPlaying ? 'Playing' : 'Listen'}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          }}
          inverted
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[s.quickContainer, { justifyContent: 'center', alignItems: 'center', paddingBottom: botPad }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: 'center' }}>
            <View style={[s.welcomeIcon, { marginBottom: 20 }]}>
              <Ionicons name="call" size={36} color={ACCENT} />
            </View>
            <Text style={s.welcomeTitle}>Live Voice Chat</Text>
            <Text style={[s.welcomeSub, { marginBottom: 32 }]}>
              Speak naturally with the AI repair expert. Get instant voice guidance.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Voice Chat Button */}
      {!voiceChatStreaming && (
        <View style={{ padding: 16, paddingBottom: botPad + 8, backgroundColor: CARD, borderTopWidth: 1, borderTopColor: BORDER, alignItems: 'center' }}>
          <Pressable
            style={[s.talkToAiBtn, isRecording && { backgroundColor: ACCENT, borderColor: ACCENT }]}
            onPress={() => isRecording ? stopVoiceRecord() : startVoiceRecord()}
          >
            <Ionicons 
              name={isRecording ? "stop-circle" : "call"} 
              size={36} 
              color={isRecording ? '#FFF' : ACCENT}
            />
          </Pressable>
          <Text style={s.voicePromptText}>{isRecording ? 'Listening...' : 'Tap to Speak'}</Text>
          <Text style={s.voicePromptSub}>{isRecording ? 'Say your question' : 'Ask a repair question'}</Text>
          {voiceErr ? <Text style={s.voiceErrText}>{voiceErr}</Text> : null}
        </View>
      )}

      {/* Clear button */}
      {voiceChatMessages.length > 0 && (
        <View style={{ padding: 8, paddingBottom: botPad + 8, backgroundColor: CARD, alignItems: 'center' }}>
          <Pressable 
            style={s.clearBtn}
            onPress={() => setVoiceChatMessages([])}
          >
            <Ionicons name="close-circle-outline" size={16} color={MUTED} />
            <Text style={s.clearBtnText}>Clear</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const renderLibrary = () => (
    <View style={{ flex: 1 }}>
      {/* Search */}
      <View style={s.libSearchRow}>
        <Ionicons name="search" size={16} color={MUTED} />
        <TextInput
          style={s.libSearch}
          value={librarySearch}
          onChangeText={setLibrarySearch}
          placeholder="Search: 'Redmi not charging', 'iPhone display'..."
          placeholderTextColor={MUTED}
        />
        {librarySearch ? (
          <Pressable onPress={() => setLibrarySearch('')}>
            <Ionicons name="close-circle" size={16} color={MUTED} />
          </Pressable>
        ) : null}
      </View>

      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catScroll} contentContainerStyle={s.catScrollContent}>
        <Pressable
          style={[s.catChip, !selectedCategory && s.catChipActive]}
          onPress={() => setSelectedCategory(null)}
        >
          <Text style={[s.catChipText, !selectedCategory && s.catChipTextActive]}>All</Text>
        </Pressable>
        {categories.map(cat => (
          <Pressable
            key={cat}
            style={[s.catChip, selectedCategory === cat && s.catChipActive]}
            onPress={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
          >
            <Text style={[s.catChipText, selectedCategory === cat && s.catChipTextActive]}>{cat}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Solutions */}
      <FlatList
        data={filteredLibrary}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => {
          const isExpanded = expandedSolution === item.id;
          return (
            <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
              <Pressable
                style={s.solutionCard}
                onPress={() => setExpandedSolution(isExpanded ? null : item.id)}
              >
                <View style={s.solutionHeader}>
                  <View style={[s.solutionIcon, { backgroundColor: item.color + '20' }]}>
                    <Ionicons name={item.icon} size={18} color={item.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={s.solutionTitleRow}>
                      <Text style={s.solutionTitle} numberOfLines={isExpanded ? 0 : 1}>{item.title}</Text>
                      <View style={[s.diffBadge, {
                        backgroundColor: item.difficulty === 'Expert' ? '#EF4444' + '30' :
                          item.difficulty === 'Advanced' ? AMBER + '30' :
                          item.difficulty === 'Intermediate' ? BLUE + '30' : GREEN + '30'
                      }]}>
                        <Text style={[s.diffText, {
                          color: item.difficulty === 'Expert' ? '#EF4444' :
                            item.difficulty === 'Advanced' ? AMBER :
                            item.difficulty === 'Intermediate' ? BLUE : GREEN
                        }]}>{item.difficulty}</Text>
                      </View>
                    </View>
                    <Text style={s.solutionDesc} numberOfLines={isExpanded ? 0 : 2}>{item.description}</Text>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={MUTED}
                  />
                </View>

                {isExpanded && (
                  <View style={s.solutionBody}>
                    <Text style={s.solutionSectionTitle}>Possible Hardware Causes</Text>
                    {item.causes.map((c, i) => (
                      <View key={i} style={s.bulletRow}>
                        <View style={[s.bullet, { backgroundColor: item.color }]} />
                        <Text style={s.bulletText}>{c}</Text>
                      </View>
                    ))}

                    <Text style={[s.solutionSectionTitle, { marginTop: 14 }]}>Step-by-Step Repair</Text>
                    {item.steps.map((step, i) => (
                      <View key={i} style={s.stepRow}>
                        <View style={[s.stepNum, { backgroundColor: item.color + '25' }]}>
                          <Text style={[s.stepNumText, { color: item.color }]}>{i + 1}</Text>
                        </View>
                        <Text style={s.stepText}>{step}</Text>
                      </View>
                    ))}

                    <Text style={[s.solutionSectionTitle, { marginTop: 14 }]}>Tools Required</Text>
                    <View style={s.toolsRow}>
                      {item.tools.map((tool, i) => (
                        <View key={i} style={s.toolChip}>
                          <Text style={s.toolChipText}>{tool}</Text>
                        </View>
                      ))}
                    </View>

                    <Pressable style={s.askAIBtn} onPress={() => {
                      setActiveTab('chat');
                      setTimeout(() => sendMessage(`Tell me more about repairing: ${item.title}`), 100);
                    }}>
                      <Ionicons name="hardware-chip-outline" size={14} color={ACCENT} />
                      <Text style={s.askAIBtnText}>Ask AI for more details</Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            </Animated.View>
          );
        }}
        contentContainerStyle={[s.libList, { paddingBottom: botPad + 20 }]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={TEXT} />
        </Pressable>
        <View style={s.headerCenter}>
          <View style={s.headerIcon}>
            <Ionicons name="hardware-chip" size={16} color={ACCENT} />
          </View>
          <Text style={s.headerTitle}>Repair AI</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {([
          { key: 'chat', label: 'AI Chat', icon: 'chatbubble-ellipses-outline' },
          { key: 'scan', label: 'Scan', icon: 'scan-outline' },
          { key: 'voice', label: 'Voice', icon: 'call' },
          { key: 'library', label: 'Library', icon: 'library-outline' },
        ] as const).map(tab => (
          <Pressable
            key={tab.key}
            style={[s.tabBtn, activeTab === tab.key && s.tabBtnActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={activeTab === tab.key ? ACCENT : MUTED}
            />
            <Text style={[s.tabBtnText, activeTab === tab.key && s.tabBtnTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {activeTab === 'chat' && renderChat()}
        {activeTab === 'scan' && renderScan()}
        {activeTab === 'voice' && renderVoiceChat()}
        {activeTab === 'library' && renderLibrary()}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: SURFACE,
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIcon: {
    width: 30, height: 30, borderRadius: 10, backgroundColor: ACCENT + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: TEXT },

  tabBar: {
    flexDirection: 'row', backgroundColor: CARD,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: ACCENT },
  tabBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },
  tabBtnTextActive: { color: ACCENT },

  // Chat
  chatList: { padding: 12, gap: 12 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 8 },
  msgRowUser: { justifyContent: 'flex-end' },
  msgRowAI: { justifyContent: 'flex-start' },
  aiAvatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: ACCENT + '20',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  bubble: { maxWidth: '80%', borderRadius: 16, padding: 12, gap: 6 },
  bubbleUser: { backgroundColor: ACCENT, borderBottomRightRadius: 4 },
  bubbleAI: { backgroundColor: SURFACE, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: BORDER },
  bubbleText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  bubbleTextUser: { color: '#FFF' },
  bubbleTextAI: { color: TEXT },
  typingBubble: { flexDirection: 'row', alignItems: 'center' },
  typingDots: { marginTop: 4 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: BORDER },
  shareBtnText: { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: SURFACE },
  actionBtnText: { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular' },
  iconBtn: { width: 42, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
  iconBtnActive: { backgroundColor: ACCENT + '20' },
  
  chatHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  chatHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatHeaderText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: SURFACE + '80' },
  clearBtnText: { fontSize: 11, color: MUTED, fontFamily: 'Inter_400Regular' },

  quickContainer: { padding: 16, paddingBottom: 32 },
  welcomeBox: { alignItems: 'center', marginBottom: 28, paddingTop: 16 },
  voicePromptBox: { alignItems: 'center', marginVertical: 24, paddingHorizontal: 16 },
  talkToAiBtn: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: ACCENT + '10', borderWidth: 2, borderColor: ACCENT,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  voicePromptText: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: TEXT, marginBottom: 4 },
  voicePromptSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center' },
  voiceErrText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#FF3B30', textAlign: 'center', marginTop: 8, paddingHorizontal: 12 },
  welcomeIcon: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: ACCENT + '20',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: ACCENT + '40',
  },
  welcomeTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 8 },
  welcomeSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', lineHeight: 20 },
  quickTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: TEXT, marginBottom: 12 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CARD, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    width: '47%',
  },
  quickIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  quickBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: TEXT, flex: 1 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 8,
    backgroundColor: CARD, borderTopWidth: 1, borderTopColor: BORDER,
  },
  input: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 20, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 14, paddingVertical: 10, paddingTop: 10,
    color: TEXT, fontSize: 14, fontFamily: 'Inter_400Regular',
    maxHeight: 100, minHeight: 42,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: ACCENT,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: SURFACE },

  // Scan
  scanContainer: { padding: 16, paddingBottom: 32 },
  scanTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 6 },
  scanSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 20, lineHeight: 18 },
  pickRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  pickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, paddingVertical: 12,
  },
  pickBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: TEXT },
  imagePreview: { borderRadius: 16, overflow: 'hidden', marginBottom: 16, position: 'relative' },
  previewImg: { width: '100%', height: 220, backgroundColor: SURFACE },
  removeImg: { position: 'absolute', top: 8, right: 8 },
  imagePlaceholder: {
    height: 180, backgroundColor: SURFACE, borderRadius: 16, borderWidth: 1,
    borderColor: BORDER, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16,
  },
  imagePlaceholderText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: MUTED },
  imagePlaceholderSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', paddingHorizontal: 32 },
  analyzeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 14, marginBottom: 16,
  },
  analyzeBtnDisabled: { backgroundColor: SURFACE },
  analyzeBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  resultCard: {
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1,
    borderColor: ACCENT + '40', overflow: 'hidden',
  },
  resultHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: ACCENT + '15', padding: 12,
    borderBottomWidth: 1, borderBottomColor: ACCENT + '30',
  },
  resultHeaderText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: ACCENT },
  resultText: { padding: 14, fontSize: 13, fontFamily: 'Inter_400Regular', color: TEXT, lineHeight: 20 },
  shareResultBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    margin: 12, marginTop: 0, padding: 10,
    backgroundColor: ACCENT + '15', borderRadius: 10,
    justifyContent: 'center',
  },
  shareResultBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: ACCENT },

  // Library
  libSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SURFACE, margin: 12, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10,
  },
  libSearch: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: TEXT },
  catScroll: { maxHeight: 44 },
  catScrollContent: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  catChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
  },
  catChipActive: { backgroundColor: ACCENT + '20', borderColor: ACCENT },
  catChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  catChipTextActive: { color: ACCENT },
  libList: { padding: 12, gap: 10 },
  solutionCard: {
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1,
    borderColor: BORDER, overflow: 'hidden',
  },
  solutionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 },
  solutionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  solutionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  solutionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: TEXT, flex: 1 },
  diffBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  diffText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  solutionDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 16 },
  solutionBody: {
    paddingHorizontal: 14, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: BORDER,
    paddingTop: 12,
  },
  solutionSectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: TEXT, marginBottom: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 6, flexShrink: 0 },
  bulletText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, flex: 1, lineHeight: 18 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  stepNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  stepText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, flex: 1, lineHeight: 18 },
  toolsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  toolChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
  },
  toolChipText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: MUTED },
  askAIBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: ACCENT + '15', borderWidth: 1, borderColor: ACCENT + '40',
  },
  askAIBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: ACCENT },
});
