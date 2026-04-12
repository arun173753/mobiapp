import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform,
  ScrollView, Alert, ActivityIndicator, Dimensions,
  TextInput, Modal, FlatList, KeyboardAvoidingView, Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { WebView } from 'react-native-webview';
import Colors from '@/constants/colors';
import { useApp } from '@/lib/context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { openLink } from '@/lib/open-link';
import { Course, CourseChapter, CourseVideo, CourseEnrollment, LiveClass, CourseNotice, INDIAN_LANGUAGES } from '@/lib/types';

const C = Colors.light;
const { width } = Dimensions.get('window');

type TabKey = 'overview' | 'content' | 'live' | 'students' | 'notices';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'information-circle-outline' },
  { key: 'content', label: 'Content', icon: 'folder-outline' },
  { key: 'live', label: 'Live', icon: 'videocam-outline' },
  { key: 'students', label: 'Students', icon: 'people-outline' },
  { key: 'notices', label: 'Notices', icon: 'megaphone-outline' },
];

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function getLanguageName(code: string): string {
  const lang = INDIAN_LANGUAGES.find(l => l.code === code);
  return lang ? lang.name : code;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function CourseDetailScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, startConversation } = useApp();

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [enrollment, setEnrollment] = useState<CourseEnrollment | null>(null);
  const [enrollmentChecked, setEnrollmentChecked] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  const [showLiveModal, setShowLiveModal] = useState(false);
  const [liveTitle, setLiveTitle] = useState('');
  const [liveDesc, setLiveDesc] = useState('');
  const [liveDuration, setLiveDuration] = useState('60');
  const [liveDate, setLiveDate] = useState('');
  const [liveTime, setLiveTime] = useState('');
  const [creatingLive, setCreatingLive] = useState(false);

  const [showNoticeModal, setShowNoticeModal] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [creatingNotice, setCreatingNotice] = useState(false);

  const [studentSearch, setStudentSearch] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState('');

  const { data: course, isLoading } = useQuery<Course>({
    queryKey: ['/api/courses', courseId],
    enabled: !!courseId,
  });

  const { data: liveClassesData = [] } = useQuery<LiveClass[]>({
    queryKey: [`/api/courses/${courseId}/live-classes`],
    enabled: !!courseId && (activeTab === 'live'),
  });

  const { data: studentsData = [] } = useQuery<CourseEnrollment[]>({
    queryKey: [`/api/courses/${courseId}/students`],
    enabled: !!courseId && (activeTab === 'students'),
  });

  const { data: noticesData = [] } = useQuery<CourseNotice[]>({
    queryKey: [`/api/courses/${courseId}/notices`],
    enabled: !!courseId && (activeTab === 'notices'),
  });

  const checkEnrollment = useCallback(async () => {
    if (!courseId || !profile) {
      setEnrollmentChecked(true);
      return;
    }
    try {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/enrollments/check?courseId=${courseId}&studentId=${profile.id}`, baseUrl);
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        if (data.enrollment) setEnrollment(data.enrollment);
      }
    } catch (e) {
      console.warn('[CourseDetail] Enrollment check failed:', e);
    } finally {
      setEnrollmentChecked(true);
    }
  }, [courseId, profile]);

  useEffect(() => { checkEnrollment(); }, [checkEnrollment]);

  const isEnrolled = enrollment && enrollment.status === 'active';
  const isTeacher = profile?.id === course?.teacherId;

  const handleEnroll = async () => {
    if (!course || !profile) return;
    setEnrolling(true);
    try {
      const res = await apiRequest('POST', '/api/payments/create-order', {
        courseId: course.id,
        studentId: profile.id,
        studentName: profile.name,
        studentPhone: profile.phone,
      });
      const data = await res.json();
      if (data.success && data.alreadyEnrolled) {
        setEnrollment(data.enrollment);
        Alert.alert('Already Enrolled', 'You already have access to this course.');
        setEnrolling(false);
        return;
      }
      if (data.success && data.free) {
        setEnrollment(data.enrollment);
        Alert.alert('Enrolled!', `You now have free access to "${course.title}"`);
        setEnrolling(false);
        return;
      }
      if (data.success && data.orderId) {
        const baseUrl = getApiUrl();
        const params = new URLSearchParams({
          orderId: data.orderId,
          amount: data.amount.toString(),
          keyId: data.keyId,
          courseName: course.title,
          teacherName: course.teacherName,
          studentName: profile.name,
          studentPhone: profile.phone || '',
          studentEmail: profile.email || '',
          courseId: course.id,
          studentId: profile.id,
        });
        const checkoutUrl = `${baseUrl}/api/payments/checkout?${params.toString()}`;
        if (Platform.OS === 'web') {
          const payWindow = window.open(checkoutUrl, '_blank', 'width=500,height=700');
          const checkInterval = setInterval(async () => {
            try {
              await checkEnrollment();
              if (enrollment?.status === 'active') {
                clearInterval(checkInterval);
                setEnrolling(false);
              }
            } catch {}
          }, 3000);
          setTimeout(() => {
            clearInterval(checkInterval);
            setEnrolling(false);
            checkEnrollment();
          }, 120000);
        } else {
          setPaymentUrl(checkoutUrl);
          setShowPaymentModal(true);
          setEnrolling(false);
        }
        return;
      }
      Alert.alert('Error', data.message || 'Could not start payment');
    } catch (e: any) {
      Alert.alert('Error', 'Could not start payment. Please try again.');
    } finally {
      setEnrolling(false);
    }
  };

  const handlePaymentMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'payment_success' && data.enrollment) {
        setEnrollment(data.enrollment);
        setShowPaymentModal(false);
        setPaymentUrl('');
        Alert.alert('Payment Successful!', `You now have access to "${course?.title}"`);
        queryClient.invalidateQueries({ queryKey: ['/api/courses', courseId] });
      } else if (data.type === 'payment_failed') {
        setShowPaymentModal(false);
        setPaymentUrl('');
        Alert.alert('Payment Failed', data.message || 'Please try again.');
      } else if (data.type === 'payment_cancelled') {
        setShowPaymentModal(false);
        setPaymentUrl('');
      } else if (data.type === 'payment_error') {
        setShowPaymentModal(false);
        setPaymentUrl('');
        Alert.alert('Error', data.message || 'Network error. Please try again.');
      }
    } catch {}
  };

  const handleChatWithTeacher = async () => {
    if (!course || !profile) return;
    try {
      const convoId = await startConversation(course.teacherId, course.teacherName, 'teacher');
      if (convoId) router.push({ pathname: '/chat/[id]', params: { id: convoId } });
    } catch (e) {
      Alert.alert('Error', 'Could not start conversation');
    }
  };

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const handleVideoPress = (video: CourseVideo) => {
    if (!course) return;
    const canPlay = isEnrolled || isTeacher || video.isDemo === 1;
    if (!canPlay) {
      Alert.alert('Locked', 'Enroll in this course to access this video.');
      return;
    }
    router.push({
      pathname: '/course-player' as any,
      params: { courseId: course.id, videoId: video.id },
    });
  };

  const handleCreateLiveClass = async () => {
    if (!course || !profile || !liveTitle.trim() || !liveDate.trim() || !liveTime.trim()) {
      Alert.alert('Error', 'Please fill in title, date and time');
      return;
    }
    setCreatingLive(true);
    try {
      const dateTimeStr = `${liveDate.trim()}T${liveTime.trim()}`;
      const scheduledAt = new Date(dateTimeStr).getTime();
      if (isNaN(scheduledAt)) {
        Alert.alert('Error', 'Invalid date/time. Use YYYY-MM-DD and HH:MM format');
        setCreatingLive(false);
        return;
      }
      await apiRequest('POST', `/api/courses/${course.id}/live-classes`, {
        teacherId: profile.id,
        teacherName: profile.name,
        title: liveTitle.trim(),
        description: liveDesc.trim(),
        scheduledAt,
        duration: parseInt(liveDuration) || 60,
      });
      setShowLiveModal(false);
      setLiveTitle('');
      setLiveDesc('');
      setLiveDuration('60');
      setLiveDate('');
      setLiveTime('');
      queryClient.invalidateQueries({ queryKey: [`/api/courses/${courseId}/live-classes`] });
    } catch (e) {
      Alert.alert('Error', 'Failed to schedule live class');
    } finally {
      setCreatingLive(false);
    }
  };

  const handleDeleteLiveClass = (id: string) => {
    const doDelete = async () => {
      try {
        await apiRequest('DELETE', `/api/live-classes/${id}`);
        queryClient.invalidateQueries({ queryKey: [`/api/courses/${courseId}/live-classes`] });
      } catch (e) {
        Alert.alert('Error', 'Failed to delete');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this live class?')) doDelete();
    } else {
      Alert.alert('Delete', 'Delete this live class?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const handleCreateNotice = async () => {
    if (!course || !profile || !noticeTitle.trim()) {
      Alert.alert('Error', 'Please enter a title');
      return;
    }
    setCreatingNotice(true);
    try {
      await apiRequest('POST', `/api/courses/${course.id}/notices`, {
        teacherId: profile.id,
        teacherName: profile.name,
        title: noticeTitle.trim(),
        message: noticeMessage.trim(),
      });
      setShowNoticeModal(false);
      setNoticeTitle('');
      setNoticeMessage('');
      queryClient.invalidateQueries({ queryKey: [`/api/courses/${courseId}/notices`] });
    } catch (e) {
      Alert.alert('Error', 'Failed to create notice');
    } finally {
      setCreatingNotice(false);
    }
  };

  const handleDeleteNotice = (id: string) => {
    const doDelete = async () => {
      try {
        await apiRequest('DELETE', `/api/notices/${id}`);
        queryClient.invalidateQueries({ queryKey: [`/api/courses/${courseId}/notices`] });
      } catch (e) {
        Alert.alert('Error', 'Failed to delete');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this notice?')) doDelete();
    } else {
      Alert.alert('Delete', 'Delete this notice?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  if (isLoading || !enrollmentChecked) {
    return (
      <View style={[styles.container, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.loadingBack} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </View>
    );
  }

  if (!course) {
    return (
      <View style={[styles.container, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.loadingBack} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>
        <View style={styles.centerState}>
          <Text style={styles.emptyText}>Course not found</Text>
        </View>
      </View>
    );
  }

  const coverUri = course.coverImage
    ? (course.coverImage.startsWith('/') ? `${getApiUrl()}${course.coverImage}` : course.coverImage)
    : null;
  const rating = parseFloat(course.rating) || 0;
  const chapters = course.chapters || [];

  const filteredStudents = studentsData.filter(s =>
    s.studentName.toLowerCase().includes(studentSearch.toLowerCase())
  );

  const visibleTabs = isTeacher
    ? TABS
    : TABS.filter(t => t.key !== 'students');

  return (
    <View style={styles.container} testID="course-detail-screen">
      {/* Hero + Back */}
      <View style={styles.heroSection}>
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={styles.coverImage} contentFit="cover" />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Ionicons name="school" size={48} color={C.textTertiary} />
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(245,245,245,0.85)', C.background]}
          style={styles.coverGradient}
        />
        <View style={[styles.heroOverlay, { paddingTop: (Platform.OS === 'web' ? webTopInset : insets.top) + 8 }]}>
          <Pressable onPress={() => router.back()} style={styles.circleBtn} hitSlop={12} testID="course-detail-back">
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </Pressable>
          {isTeacher && (
            <Pressable
              onPress={() => router.push({ pathname: '/create-course' as any, params: { courseId: course.id } })}
              style={styles.circleBtn}
              hitSlop={12}
            >
              <Ionicons name="create-outline" size={20} color="#FFF" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Mini Header Info */}
      <View style={styles.miniHeader}>
        <Text style={styles.title} numberOfLines={2}>{course.title}</Text>
        <View style={styles.miniStats}>
          <View style={styles.statChip}>
            <Ionicons name="videocam" size={13} color={C.primary} />
            <Text style={styles.statValue}>{course.totalVideos}</Text>
          </View>
          <View style={styles.statChip}>
            <Ionicons name="people" size={13} color={C.primary} />
            <Text style={styles.statValue}>{course.enrollmentCount}</Text>
          </View>
          <View style={styles.statChip}>
            <Ionicons name="time" size={13} color={C.primary} />
            <Text style={styles.statValue}>{formatDuration(course.totalDuration)}</Text>
          </View>
          {rating > 0 && (
            <View style={styles.statChip}>
              <Ionicons name="star" size={13} color="#FFD60A" />
              <Text style={styles.statValue}>{rating.toFixed(1)}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarScroll}>
          {visibleTabs.map(tab => (
            <Pressable
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Ionicons
                name={tab.icon as any}
                size={16}
                color={activeTab === tab.key ? C.primary : C.textTertiary}
              />
              <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Tab Content */}
      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'overview' && (
          <OverviewTab
            course={course}
            isTeacher={isTeacher}
            isEnrolled={!!isEnrolled}
            enrollment={enrollment}
            enrolling={enrolling}
            onEnroll={handleEnroll}
            onChat={handleChatWithTeacher}
          />
        )}
        {activeTab === 'content' && (
          <ContentTab
            chapters={chapters}
            expandedChapters={expandedChapters}
            toggleChapter={toggleChapter}
            handleVideoPress={handleVideoPress}
            isEnrolled={!!isEnrolled}
            isTeacher={isTeacher}
          />
        )}
        {activeTab === 'live' && (
          <LiveClassesTab
            classes={liveClassesData}
            isTeacher={isTeacher}
            onAdd={() => setShowLiveModal(true)}
            onDelete={handleDeleteLiveClass}
            courseId={courseId || ''}
            profile={profile}
          />
        )}
        {activeTab === 'students' && (
          <StudentsTab
            students={filteredStudents}
            search={studentSearch}
            onSearchChange={setStudentSearch}
          />
        )}
        {activeTab === 'notices' && (
          <NoticesTab
            notices={noticesData}
            isTeacher={isTeacher}
            onAdd={() => setShowNoticeModal(true)}
            onDelete={handleDeleteNotice}
          />
        )}
      </ScrollView>

      {/* Bottom Bar */}
      {activeTab === 'overview' && !isTeacher && !isEnrolled && (
        <View style={[styles.bottomBar, { paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 12 }]}>
          <Pressable
            testID="enroll-btn"
            style={[styles.enrollBtn, enrolling && { opacity: 0.6 }]}
            onPress={handleEnroll}
            disabled={enrolling}
          >
            {enrolling ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Text style={styles.enrollBtnText}>Enroll Now</Text>
                <Text style={styles.enrollBtnPrice}>{'\u20B9'}{course.price}</Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      {/* Payment WebView Modal */}
      <Modal visible={showPaymentModal} animationType="slide" onRequestClose={() => { setShowPaymentModal(false); setPaymentUrl(''); checkEnrollment(); }}>
        <View style={{ flex: 1, backgroundColor: '#0D0D0D' }}>
          <View style={[styles.paymentHeader, { paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 8 }]}>
            <Pressable onPress={() => { setShowPaymentModal(false); setPaymentUrl(''); checkEnrollment(); }} hitSlop={12}>
              <Ionicons name="close" size={24} color="#FFF" />
            </Pressable>
            <Text style={styles.paymentHeaderTitle}>Payment</Text>
            <View style={{ width: 24 }} />
          </View>
          {paymentUrl ? (
            Platform.OS === 'web' ? (
              <iframe src={paymentUrl} style={{ flex: 1, width: '100%', height: '100%', border: 'none' } as any} />
            ) : (
              <WebView
                source={{ uri: paymentUrl }}
                style={{ flex: 1 }}
                onMessage={handlePaymentMessage}
                javaScriptEnabled
                domStorageEnabled
                cacheEnabled
                thirdPartyCookiesEnabled
                sharedCookiesEnabled
                renderToHardwareTextureAndroid
                decelerationRate="normal"
                mixedContentMode="always"
                startInLoadingState
                renderLoading={() => (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D0D' }}>
                    <ActivityIndicator size="large" color="#FF6B35" />
                    <Text style={{ color: '#999', marginTop: 12 }}>Loading payment...</Text>
                  </View>
                )}
              />
            )
          ) : null}
        </View>
      </Modal>

      {/* Schedule Live Class Modal */}
      <Modal visible={showLiveModal} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Schedule Live Class</Text>
              <Pressable onPress={() => setShowLiveModal(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color={C.text} />
              </Pressable>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Class title"
              placeholderTextColor={C.textTertiary}
              value={liveTitle}
              onChangeText={setLiveTitle}
            />
            <TextInput
              style={[styles.modalInput, { height: 80 }]}
              placeholder="Description (optional)"
              placeholderTextColor={C.textTertiary}
              value={liveDesc}
              onChangeText={setLiveDesc}
              multiline
            />
            <View style={styles.modalRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalLabel}>Date (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="2026-02-20"
                  placeholderTextColor={C.textTertiary}
                  value={liveDate}
                  onChangeText={setLiveDate}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.modalLabel}>Time (HH:MM)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="14:00"
                  placeholderTextColor={C.textTertiary}
                  value={liveTime}
                  onChangeText={setLiveTime}
                />
              </View>
            </View>
            <View style={styles.modalRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalLabel}>Duration (minutes)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="60"
                  placeholderTextColor={C.textTertiary}
                  value={liveDuration}
                  onChangeText={setLiveDuration}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <Pressable
              style={[styles.modalSubmitBtn, creatingLive && { opacity: 0.6 }]}
              onPress={handleCreateLiveClass}
              disabled={creatingLive}
            >
              {creatingLive ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.modalSubmitText}>Schedule Class</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Create Notice Modal */}
      <Modal visible={showNoticeModal} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Post a Notice</Text>
              <Pressable onPress={() => setShowNoticeModal(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color={C.text} />
              </Pressable>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Notice title"
              placeholderTextColor={C.textTertiary}
              value={noticeTitle}
              onChangeText={setNoticeTitle}
            />
            <TextInput
              style={[styles.modalInput, { height: 100 }]}
              placeholder="Message"
              placeholderTextColor={C.textTertiary}
              value={noticeMessage}
              onChangeText={setNoticeMessage}
              multiline
            />
            <Pressable
              style={[styles.modalSubmitBtn, creatingNotice && { opacity: 0.6 }]}
              onPress={handleCreateNotice}
              disabled={creatingNotice}
            >
              {creatingNotice ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.modalSubmitText}>Post Notice</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/* ====== TAB COMPONENTS ====== */

function OverviewTab({ course, isTeacher, isEnrolled, enrollment, enrolling, onEnroll, onChat }: {
  course: Course; isTeacher: boolean; isEnrolled: boolean;
  enrollment: CourseEnrollment | null; enrolling: boolean;
  onEnroll: () => void; onChat: () => void;
}) {
  const rating = parseFloat(course.rating) || 0;
  return (
    <View>
      {/* Teacher */}
      <View style={styles.teacherRow}>
        {course.teacherAvatar ? (
          <Image
            source={{ uri: course.teacherAvatar.startsWith('/') ? `${getApiUrl()}${course.teacherAvatar}` : course.teacherAvatar }}
            style={styles.teacherAvatar}
          />
        ) : (
          <View style={[styles.teacherAvatar, styles.teacherAvatarPlaceholder]}>
            <Text style={styles.teacherInitial}>{course.teacherName[0]}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.teacherName}>{course.teacherName}</Text>
          <Text style={styles.teacherLabel}>Teacher</Text>
        </View>
        {isEnrolled && !isTeacher && (
          <Pressable onPress={onChat} style={styles.chatIcon} hitSlop={8}>
            <Ionicons name="chatbubble-outline" size={20} color={C.primary} />
          </Pressable>
        )}
      </View>

      {/* Price & Access */}
      <View style={styles.priceBadge}>
        <View>
          <Text style={styles.priceText}>{'\u20B9'}{course.price}</Text>
          <Text style={styles.accessText}>{course.accessDays} days access</Text>
        </View>
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryBadgeText}>
            {course.category === 'course' ? 'Full Course' : course.category === 'tutorial' ? 'Tutorial' : 'Workshop'}
          </Text>
        </View>
      </View>

      {/* Enrolled Banner */}
      {isEnrolled && enrollment && (
        <View style={styles.enrolledBanner}>
          <Ionicons name="checkmark-circle" size={18} color={C.success} />
          <Text style={styles.enrolledText}>Enrolled</Text>
          <Text style={styles.expiresText}>Expires: {formatDate(enrollment.expiresAt)}</Text>
        </View>
      )}

      {/* Language */}
      <View style={styles.infoRow}>
        <Ionicons name="language-outline" size={18} color={C.textSecondary} />
        <Text style={styles.infoText}>{getLanguageName(course.language)}</Text>
      </View>

      {/* Description */}
      {course.description ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About this course</Text>
          <Text style={styles.descText}>{course.description}</Text>
        </View>
      ) : null}

      {/* Quick Stats */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Course Details</Text>
        <View style={styles.detailsGrid}>
          <DetailItem icon="videocam-outline" label="Videos" value={`${course.totalVideos}`} />
          <DetailItem icon="time-outline" label="Duration" value={formatDuration(course.totalDuration)} />
          <DetailItem icon="people-outline" label="Enrolled" value={`${course.enrollmentCount}`} />
          {rating > 0 && <DetailItem icon="star-outline" label="Rating" value={rating.toFixed(1)} />}
          <DetailItem icon="folder-outline" label="Chapters" value={`${(course.chapters || []).length}`} />
          <DetailItem icon="calendar-outline" label="Created" value={formatDate(course.createdAt)} />
        </View>
      </View>
    </View>
  );
}

function DetailItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.detailItem}>
      <Ionicons name={icon as any} size={20} color={C.primary} />
      <Text style={styles.detailValue}>{value}</Text>
      <Text style={styles.detailLabel}>{label}</Text>
    </View>
  );
}

function ContentTab({ chapters, expandedChapters, toggleChapter, handleVideoPress, isEnrolled, isTeacher }: {
  chapters: CourseChapter[]; expandedChapters: Set<string>;
  toggleChapter: (id: string) => void; handleVideoPress: (v: CourseVideo) => void;
  isEnrolled: boolean; isTeacher: boolean;
}) {
  if (chapters.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="folder-open-outline" size={48} color={C.textTertiary} />
        <Text style={styles.emptyStateText}>No chapters added yet</Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.contentSummary}>
        {chapters.length} chapters
      </Text>
      {chapters.map((chapter, idx) => {
        const isExpanded = expandedChapters.has(chapter.id);
        const videos = chapter.videos || [];
        return (
          <View key={chapter.id} style={styles.chapterCard}>
            <Pressable
              style={styles.chapterHeader}
              onPress={() => toggleChapter(chapter.id)}
            >
              <View style={styles.chapterIconWrap}>
                <Ionicons name="folder" size={20} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.chapterTitle}>{chapter.title}</Text>
                <Text style={styles.chapterSubtitle}>{videos.length} videos</Text>
              </View>
              <Ionicons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={C.textTertiary}
              />
            </Pressable>
            {isExpanded && videos.length > 0 && (
              <View style={styles.videoList}>
                {videos.map((video) => {
                  const canPlay = isEnrolled || isTeacher || video.isDemo === 1;
                  return (
                    <Pressable
                      key={video.id}
                      style={styles.videoItem}
                      onPress={() => handleVideoPress(video)}
                    >
                      <View style={[styles.playIcon, canPlay && styles.playIconUnlocked]}>
                        <Ionicons
                          name={canPlay ? 'play' : 'lock-closed'}
                          size={11}
                          color={canPlay ? '#FFF' : C.textTertiary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.videoTitle} numberOfLines={1}>{video.title}</Text>
                        <Text style={styles.videoDuration}>{formatDuration(video.duration)}</Text>
                      </View>
                      {video.isDemo === 1 && (
                        <View style={styles.freeBadge}>
                          <Text style={styles.freeBadgeText}>FREE</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

interface LivePoll {
  id: string;
  classId: string;
  courseId: string;
  teacherId: string;
  type: 'poll' | 'quiz';
  question: string;
  options: string[];
  correctOption: number;
  status: 'active' | 'closed';
  voteCounts: number[];
  myVote: number | null;
  timerSeconds: number;
  createdAt: number;
}

function PollCard({ poll, isTeacher, currentUserId, teacherId, onVote, onClose, onDelete }: {
  poll: LivePoll; isTeacher: boolean; currentUserId?: string; teacherId: string;
  onVote: (pollId: string, idx: number) => void;
  onClose: (pollId: string) => void;
  onDelete: (pollId: string) => void;
}) {
  const totalVotes = poll.voteCounts.reduce((a, b) => a + b, 0);
  const hasVoted = poll.myVote !== null;
  const showResults = hasVoted || poll.status === 'closed' || isTeacher;
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const barAnims = useRef(poll.options.map(() => new Animated.Value(0))).current;
  const glowAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (poll.status !== 'active' || !poll.timerSeconds || poll.timerSeconds <= 0) return;
    const elapsed = Math.floor((Date.now() - poll.createdAt) / 1000);
    const remaining = poll.timerSeconds - elapsed;
    if (remaining <= 0) { setTimeLeft(0); return; }
    setTimeLeft(remaining);
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) { clearInterval(interval); onClose(poll.id); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [poll.id]);

  useEffect(() => {
    if (poll.status === 'active') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 0.5, duration: 900, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      ).start();
    } else {
      glowAnim.setValue(1);
    }
  }, [poll.status]);

  useEffect(() => {
    if (!showResults) return;
    poll.options.forEach((_, i) => {
      const pct = totalVotes > 0 ? (poll.voteCounts[i] || 0) / totalVotes : 0;
      Animated.timing(barAnims[i], { toValue: pct, duration: 600, useNativeDriver: false }).start();
    });
  }, [poll.voteCounts, showResults]);

  const isQuiz = poll.type === 'quiz';
  const accentColor = isQuiz ? '#FF6B2C' : '#4A6CF7';

  return (
    <View style={[pollStyles.card, { borderColor: poll.status === 'active' ? accentColor + '50' : C.border, borderWidth: 1 }]}>
      <View style={pollStyles.cardHeader}>
        <View style={[pollStyles.typeBadge, { backgroundColor: accentColor + '18' }]}>
          <Ionicons name={isQuiz ? 'school' : 'stats-chart'} size={13} color={accentColor} />
          <Text style={[pollStyles.typeText, { color: accentColor }]}>{isQuiz ? 'Quiz' : 'Poll'}</Text>
        </View>

        {poll.status === 'active' && (
          <Animated.View style={[pollStyles.activeBadge, { opacity: glowAnim }]}>
            <View style={pollStyles.activeDot} />
            <Text style={pollStyles.activeText}>Live</Text>
          </Animated.View>
        )}
        {poll.status === 'closed' && (
          <View style={pollStyles.closedBadge}>
            <Ionicons name="lock-closed" size={10} color={C.textSecondary} />
            <Text style={pollStyles.closedText}>Closed</Text>
          </View>
        )}

        {timeLeft !== null && timeLeft > 0 && poll.status === 'active' && (
          <View style={[pollStyles.timerBadge, { backgroundColor: timeLeft <= 10 ? '#FF3B3020' : '#FFD60A20' }]}>
            <Ionicons name="timer-outline" size={12} color={timeLeft <= 10 ? '#FF3B30' : '#FFD60A'} />
            <Text style={[pollStyles.timerText, { color: timeLeft <= 10 ? '#FF3B30' : '#FFD60A' }]}>{timeLeft}s</Text>
          </View>
        )}

        {isTeacher && (
          <View style={pollStyles.adminActions}>
            {poll.status === 'active' && (
              <Pressable onPress={() => onClose(poll.id)} hitSlop={8} style={pollStyles.adminBtn}>
                <Ionicons name="lock-closed-outline" size={16} color={C.textSecondary} />
              </Pressable>
            )}
            <Pressable onPress={() => onDelete(poll.id)} hitSlop={8} style={pollStyles.adminBtn}>
              <Ionicons name="trash-outline" size={16} color="#FF3B30" />
            </Pressable>
          </View>
        )}
      </View>

      <Text style={pollStyles.question}>{poll.question}</Text>

      <View style={pollStyles.options}>
        {poll.options.map((opt, i) => {
          const pct = totalVotes > 0 ? Math.round((poll.voteCounts[i] || 0) / totalVotes * 100) : 0;
          const isSelected = poll.myVote === i;
          const isCorrect = isQuiz && poll.status === 'closed' && poll.correctOption === i;
          const isWrong = isQuiz && poll.status === 'closed' && isSelected && poll.correctOption !== i;
          const isWinner = !isQuiz && poll.status === 'closed' && (poll.voteCounts[i] || 0) === Math.max(...poll.voteCounts);

          let borderColor = C.border;
          let textColor = C.text;
          if (isCorrect) { borderColor = '#34C759'; textColor = '#34C759'; }
          else if (isWrong) { borderColor = '#FF3B30'; textColor = '#FF3B30'; }
          else if (isSelected && !showResults) { borderColor = accentColor; textColor = accentColor; }
          else if (isSelected && showResults) { borderColor = accentColor; }
          else if (isWinner && poll.status === 'closed') { borderColor = '#FFD60A'; }

          const barColor = isCorrect ? '#34C75930' : isWrong ? '#FF3B3025' : isWinner ? '#FFD60A25' : accentColor + '18';

          return (
            <Pressable
              key={i}
              style={[pollStyles.optionBtn, { borderColor, borderWidth: isSelected || isCorrect || isWrong ? 1.5 : 1 }]}
              onPress={() => !hasVoted && poll.status === 'active' && !isTeacher ? onVote(poll.id, i) : undefined}
              disabled={hasVoted || poll.status === 'closed' || isTeacher}
            >
              {showResults && (
                <Animated.View style={[pollStyles.optionBar, {
                  width: barAnims[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  backgroundColor: barColor,
                }]} />
              )}
              <View style={pollStyles.optionContent}>
                <View style={[pollStyles.optionIndex, { backgroundColor: isSelected ? accentColor : isCorrect ? '#34C759' : C.border, borderColor: isSelected ? accentColor : isCorrect ? '#34C759' : C.border }]}>
                  <Text style={[pollStyles.optionIndexText, { color: isSelected || isCorrect ? '#FFF' : C.textTertiary }]}>{String.fromCharCode(65 + i)}</Text>
                </View>
                <Text style={[pollStyles.optionText, { color: textColor, flex: 1 }]}>{opt}</Text>
                {showResults && <Text style={[pollStyles.optionPct, { color: isCorrect ? '#34C759' : isWrong ? '#FF3B30' : accentColor }]}>{pct}%</Text>}
                {isCorrect && <Ionicons name="checkmark-circle" size={18} color="#34C759" />}
                {isWrong && <Ionicons name="close-circle" size={18} color="#FF3B30" />}
                {isWinner && !isQuiz && poll.status === 'closed' && !isSelected && <Ionicons name="trophy" size={15} color="#FFD60A" />}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <Text style={pollStyles.voteCount}>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</Text>
        {!hasVoted && poll.status === 'active' && !isTeacher && (
          <Text style={{ fontSize: 11, color: C.textTertiary, fontFamily: 'Inter_400Regular' }}>Tap an option to vote</Text>
        )}
        {hasVoted && poll.status === 'active' && isQuiz && (
          <Text style={{ fontSize: 11, color: '#4A6CF7', fontFamily: 'Inter_500Medium' }}>Voted! Waiting for results...</Text>
        )}
        {poll.status === 'closed' && isQuiz && poll.myVote !== null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {poll.myVote === poll.correctOption
              ? <><Ionicons name="checkmark-circle" size={14} color="#34C759" /><Text style={{ fontSize: 11, color: '#34C759', fontFamily: 'Inter_600SemiBold' }}>Correct!</Text></>
              : <><Ionicons name="close-circle" size={14} color="#FF3B30" /><Text style={{ fontSize: 11, color: '#FF3B30', fontFamily: 'Inter_600SemiBold' }}>Incorrect</Text></>
            }
          </View>
        )}
      </View>
    </View>
  );
}

function PollsPanel({ classId, courseId, isTeacher, profile }: {
  classId: string; courseId: string; isTeacher: boolean; profile: any;
}) {
  const [polls, setPolls] = useState<LivePoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pollType, setPollType] = useState<'poll' | 'quiz'>('poll');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [correctOption, setCorrectOption] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newPollBanner, setNewPollBanner] = useState(false);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const prevCountRef = useRef(0);

  const loadPolls = useCallback(async (silent = false) => {
    try {
      const res = await apiRequest('GET', `/api/live-classes/${classId}/polls?userId=${profile?.id || ''}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setPolls(prev => {
          if (!silent && data.length > prevCountRef.current && prevCountRef.current > 0 && !isTeacher) {
            setNewPollBanner(true);
            Animated.sequence([
              Animated.timing(bannerAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
              Animated.delay(3000),
              Animated.timing(bannerAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
            ]).start(() => setNewPollBanner(false));
          }
          prevCountRef.current = data.length;
          return data;
        });
      }
    } catch (e) {
      console.warn('[Polls] Load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [classId, profile?.id, isTeacher]);

  useEffect(() => {
    loadPolls();
    const interval = setInterval(() => loadPolls(true), 3000);
    return () => clearInterval(interval);
  }, [loadPolls]);

  const handleVote = async (pollId: string, optionIndex: number) => {
    if (!profile) return;
    try {
      const res = await apiRequest('POST', `/api/polls/${pollId}/vote`, { userId: profile.id, optionIndex });
      const data = await res.json();
      if (data.success) {
        setPolls(prev => prev.map(p => p.id === pollId ? { ...p, myVote: optionIndex, voteCounts: data.voteCounts } : p));
      } else {
        Alert.alert('Already Voted', data.message || 'Failed to vote');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to vote');
    }
  };

  const handleClose = async (pollId: string) => {
    if (!profile) return;
    try {
      await apiRequest('PATCH', `/api/polls/${pollId}/close`, { teacherId: profile.id });
      setPolls(prev => prev.map(p => p.id === pollId ? { ...p, status: 'closed' } : p));
    } catch (e) {
      Alert.alert('Error', 'Failed to close poll');
    }
  };

  const handleDelete = async (pollId: string) => {
    if (!profile) return;
    Alert.alert('Delete Poll', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await apiRequest('DELETE', `/api/polls/${pollId}`, { teacherId: profile.id });
          setPolls(prev => prev.filter(p => p.id !== pollId));
        } catch (e) {
          Alert.alert('Error', 'Failed to delete poll');
        }
      }},
    ]);
  };

  const handleCreate = async () => {
    const validOptions = pollOptions.filter(o => o.trim());
    if (!pollQuestion.trim() || validOptions.length < 2) {
      Alert.alert('Error', 'Enter a question and at least 2 options');
      return;
    }
    if (!profile) return;
    setCreating(true);
    try {
      const res = await apiRequest('POST', `/api/live-classes/${classId}/polls`, {
        courseId, teacherId: profile.id, type: pollType,
        question: pollQuestion.trim(), options: validOptions,
        correctOption: pollType === 'quiz' ? correctOption : -1,
        timerSeconds,
      });
      const data = await res.json();
      if (data.success && data.poll) {
        setPolls(prev => [data.poll, ...prev]);
        setShowCreateModal(false);
        setPollQuestion(''); setPollOptions(['', '']); setCorrectOption(0); setPollType('poll'); setTimerSeconds(0);
      } else {
        Alert.alert('Error', data.message || 'Failed to create');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to create poll');
    } finally {
      setCreating(false);
    }
  };

  const quizPolls = polls.filter(p => p.type === 'quiz' && p.status === 'closed');
  const myScore = quizPolls.filter(p => p.myVote !== null && p.myVote === p.correctOption).length;
  const showScore = !isTeacher && quizPolls.length > 0;

  const TIMER_OPTIONS = [
    { label: 'No Timer', value: 0 },
    { label: '15s', value: 15 },
    { label: '30s', value: 30 },
    { label: '60s', value: 60 },
    { label: '2 min', value: 120 },
  ];

  return (
    <View style={pollStyles.panel}>
      {newPollBanner && (
        <Animated.View style={[pollStyles.newPollBanner, { opacity: bannerAnim, transform: [{ translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
          <Ionicons name="notifications" size={14} color="#FFF" />
          <Text style={pollStyles.newPollBannerText}>New poll launched by teacher!</Text>
        </Animated.View>
      )}

      <View style={pollStyles.panelHeader}>
        <Ionicons name="bar-chart" size={16} color={C.primary} />
        <Text style={pollStyles.panelTitle}>Polls & Quizzes</Text>
        <View style={pollStyles.pollCount}>
          <Text style={{ fontSize: 11, color: C.primary, fontFamily: 'Inter_700Bold' }}>{polls.length}</Text>
        </View>
        {showScore && (
          <View style={pollStyles.scoreBadge}>
            <Ionicons name="trophy" size={12} color="#FFD60A" />
            <Text style={pollStyles.scoreText}>{myScore}/{quizPolls.length}</Text>
          </View>
        )}
        {isTeacher && (
          <Pressable onPress={() => setShowCreateModal(true)} style={pollStyles.createBtn}>
            <Ionicons name="add" size={16} color="#FFF" />
            <Text style={pollStyles.createBtnText}>Launch</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="small" color={C.primary} style={{ marginVertical: 16 }} />
      ) : polls.length === 0 ? (
        <View style={pollStyles.emptyPoll}>
          <Ionicons name="bar-chart-outline" size={40} color={C.textTertiary} />
          <Text style={pollStyles.emptyPollText}>{isTeacher ? 'Launch a poll or quiz for your students' : 'No polls or quizzes yet'}</Text>
          {isTeacher && (
            <Pressable onPress={() => setShowCreateModal(true)} style={[pollStyles.createBtn, { marginTop: 8 }]}>
              <Ionicons name="add" size={16} color="#FFF" />
              <Text style={pollStyles.createBtnText}>Launch First Poll</Text>
            </Pressable>
          )}
        </View>
      ) : (
        polls.map(poll => (
          <PollCard
            key={poll.id}
            poll={poll}
            isTeacher={isTeacher}
            currentUserId={profile?.id}
            teacherId={profile?.id || ''}
            onVote={handleVote}
            onClose={handleClose}
            onDelete={handleDelete}
          />
        ))
      )}

      <Modal visible={showCreateModal} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={{ width: '100%' }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>
            <View style={[styles.modalCard, { maxHeight: '92%' }]}>
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name={pollType === 'quiz' ? 'school' : 'bar-chart'} size={20} color={pollType === 'quiz' ? '#FF6B2C' : '#4A6CF7'} />
                  <Text style={styles.modalTitle}>Launch {pollType === 'quiz' ? 'Quiz' : 'Poll'}</Text>
                </View>
                <Pressable onPress={() => setShowCreateModal(false)} hitSlop={12}>
                  <Ionicons name="close" size={24} color={C.text} />
                </Pressable>
              </View>

              <View style={pollStyles.typeSwitch}>
                {(['poll', 'quiz'] as const).map(t => (
                  <Pressable
                    key={t}
                    style={[pollStyles.typeSwitchBtn, pollType === t && { backgroundColor: t === 'quiz' ? '#FF6B2C' : C.primary }]}
                    onPress={() => setPollType(t)}
                  >
                    <Ionicons name={t === 'quiz' ? 'school-outline' : 'stats-chart-outline'} size={14} color={pollType === t ? '#FFF' : C.textSecondary} />
                    <Text style={[pollStyles.typeSwitchText, { color: pollType === t ? '#FFF' : C.textSecondary }]}>{t === 'quiz' ? 'Quiz' : 'Poll'}</Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                style={[styles.modalInput, { minHeight: 70, textAlignVertical: 'top' }]}
                placeholder={pollType === 'quiz' ? 'Ask a question with a correct answer...' : 'Ask your students something...'}
                placeholderTextColor={C.textTertiary}
                value={pollQuestion}
                onChangeText={setPollQuestion}
                multiline
              />

              <Text style={styles.modalLabel}>
                {pollType === 'quiz' ? 'Answer Options (tap circle to mark correct)' : 'Answer Options'}
              </Text>
              {pollOptions.map((opt, i) => (
                <View key={i} style={pollStyles.optionRow}>
                  {pollType === 'quiz' ? (
                    <Pressable onPress={() => setCorrectOption(i)} style={{ marginRight: 8 }}>
                      <Ionicons
                        name={correctOption === i ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        color={correctOption === i ? '#34C759' : C.textTertiary}
                      />
                    </Pressable>
                  ) : (
                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: C.textSecondary }}>{String.fromCharCode(65 + i)}</Text>
                    </View>
                  )}
                  <TextInput
                    style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                    placeholderTextColor={C.textTertiary}
                    value={opt}
                    onChangeText={v => { const next = [...pollOptions]; next[i] = v; setPollOptions(next); }}
                  />
                  {pollOptions.length > 2 && (
                    <Pressable onPress={() => { setPollOptions(pollOptions.filter((_, j) => j !== i)); if (correctOption >= pollOptions.length - 1) setCorrectOption(0); }} hitSlop={8} style={{ marginLeft: 8 }}>
                      <Ionicons name="remove-circle-outline" size={20} color="#FF3B30" />
                    </Pressable>
                  )}
                </View>
              ))}
              {pollOptions.length < 6 && (
                <Pressable onPress={() => setPollOptions([...pollOptions, ''])} style={pollStyles.addOptionBtn}>
                  <Ionicons name="add-circle-outline" size={18} color={C.primary} />
                  <Text style={pollStyles.addOptionText}>Add option</Text>
                </Pressable>
              )}

              <Text style={[styles.modalLabel, { marginTop: 12 }]}>Timer (auto-close)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                {TIMER_OPTIONS.map(opt => (
                  <Pressable
                    key={opt.value}
                    style={[pollStyles.timerOption, timerSeconds === opt.value && { backgroundColor: C.primary, borderColor: C.primary }]}
                    onPress={() => setTimerSeconds(opt.value)}
                  >
                    <Text style={[pollStyles.timerOptionText, { color: timerSeconds === opt.value ? '#FFF' : C.textSecondary }]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable style={[styles.modalSubmitBtn, creating && { opacity: 0.6 }, { marginTop: 16, backgroundColor: pollType === 'quiz' ? '#FF6B2C' : C.primary }]} onPress={handleCreate} disabled={creating}>
                {creating
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <>
                    <Ionicons name="rocket-outline" size={16} color="#FFF" />
                    <Text style={styles.modalSubmitText}>Launch {pollType === 'quiz' ? 'Quiz' : 'Poll'}{timerSeconds > 0 ? ` (${timerSeconds}s)` : ''}</Text>
                  </>
                }
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function LiveClassesTab({ classes, isTeacher, onAdd, onDelete, courseId, profile }: {
  classes: LiveClass[]; isTeacher: boolean;
  onAdd: () => void; onDelete: (id: string) => void;
  courseId: string; profile: any;
}) {
  const [expandedClass, setExpandedClass] = useState<string | null>(null);
  const upcoming = classes.filter(c => c.status === 'scheduled' && c.scheduledAt > Date.now());
  const past = classes.filter(c => c.status !== 'scheduled' || c.scheduledAt <= Date.now());

  return (
    <View>
      {isTeacher && (
        <Pressable style={styles.addBtn} onPress={onAdd}>
          <Ionicons name="add-circle" size={20} color="#FFF" />
          <Text style={styles.addBtnText}>Schedule Live Class</Text>
        </Pressable>
      )}

      {upcoming.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Upcoming</Text>
          {upcoming.map(lc => (
            <View key={lc.id}>
              <LiveClassCard lc={lc} isTeacher={isTeacher} onDelete={onDelete} expanded={expandedClass === lc.id} onToggle={() => setExpandedClass(expandedClass === lc.id ? null : lc.id)} />
              {expandedClass === lc.id && <PollsPanel classId={lc.id} courseId={courseId} isTeacher={isTeacher} profile={profile} />}
            </View>
          ))}
        </>
      )}

      {past.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Past Classes</Text>
          {past.map(lc => (
            <View key={lc.id}>
              <LiveClassCard lc={lc} isTeacher={isTeacher} onDelete={onDelete} isPast expanded={expandedClass === lc.id} onToggle={() => setExpandedClass(expandedClass === lc.id ? null : lc.id)} />
              {expandedClass === lc.id && <PollsPanel classId={lc.id} courseId={courseId} isTeacher={isTeacher} profile={profile} />}
            </View>
          ))}
        </>
      )}

      {classes.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="videocam-off-outline" size={48} color={C.textTertiary} />
          <Text style={styles.emptyStateText}>No live classes scheduled</Text>
        </View>
      )}
    </View>
  );
}

function LiveClassCard({ lc, isTeacher, onDelete, isPast, expanded, onToggle }: {
  lc: LiveClass; isTeacher: boolean; onDelete: (id: string) => void; isPast?: boolean;
  expanded?: boolean; onToggle?: () => void;
}) {
  const isLive = lc.status === 'live';
  return (
    <Pressable onPress={onToggle} style={[styles.liveCard, isPast && { opacity: 0.7 }, expanded && { borderColor: C.primary, borderWidth: 1 }]}>
      <View style={styles.liveCardHeader}>
        <View style={[styles.liveStatusDot, isLive ? { backgroundColor: '#FF3B30' } : isPast ? { backgroundColor: C.textTertiary } : { backgroundColor: C.success }]} />
        <Text style={styles.liveCardTitle} numberOfLines={1}>{lc.title}</Text>
        {isTeacher && (
          <Pressable onPress={() => onDelete(lc.id)} hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={C.error} />
          </Pressable>
        )}
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={C.textSecondary} style={{ marginLeft: 4 }} />
      </View>
      {lc.description ? <Text style={styles.liveCardDesc} numberOfLines={2}>{lc.description}</Text> : null}
      <View style={styles.liveCardMeta}>
        <View style={styles.liveCardMetaItem}>
          <Ionicons name="calendar-outline" size={14} color={C.textSecondary} />
          <Text style={styles.liveCardMetaText}>{formatDateTime(lc.scheduledAt)}</Text>
        </View>
        <View style={styles.liveCardMetaItem}>
          <Ionicons name="time-outline" size={14} color={C.textSecondary} />
          <Text style={styles.liveCardMetaText}>{lc.duration} min</Text>
        </View>
      </View>
      {isLive && lc.meetingUrl ? (
        <Pressable 
          style={styles.joinLiveBtn}
          onPress={() => openLink(lc.meetingUrl!, 'Live Session')}
        >
          <Ionicons name="videocam" size={16} color="#FFF" />
          <Text style={styles.joinLiveText}>{isTeacher ? 'Start Class' : 'Join Now'}</Text>
        </Pressable>
      ) : isTeacher && lc.status === 'scheduled' ? (
        <Pressable 
          style={[styles.joinLiveBtn, { backgroundColor: C.success }]}
          onPress={() => {
            Alert.prompt(
              'Start Live Class',
              'Enter the meeting URL (Zoom, YouTube, etc.)',
              [
                { text: 'Cancel', style: 'cancel' },
                { 
                  text: 'Go Live', 
                  onPress: async (url) => {
                    if (!url) return;
                    try {
                      await apiRequest('PATCH', `/api/live-classes/${lc.id}/status`, { 
                        status: 'live', 
                        meetingUrl: url 
                      });
                      queryClient.invalidateQueries({ queryKey: [`/api/courses/${courseId}/live-classes`] });
                      onToggle?.(); 
                    } catch (e) {
                      Alert.alert('Error', 'Failed to start live class');
                    }
                  }
                }
              ]
            );
          }}
        >
          <Ionicons name="play-circle" size={16} color="#FFF" />
          <Text style={styles.joinLiveText}>Start Class</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function StudentsTab({ students, search, onSearchChange }: {
  students: CourseEnrollment[]; search: string; onSearchChange: (s: string) => void;
}) {
  return (
    <View>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={C.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search students..."
          placeholderTextColor={C.textTertiary}
          value={search}
          onChangeText={onSearchChange}
        />
      </View>
      <Text style={styles.contentSummary}>{students.length} students enrolled</Text>
      {students.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={48} color={C.textTertiary} />
          <Text style={styles.emptyStateText}>No students enrolled yet</Text>
        </View>
      ) : (
        students.map(s => (
          <View key={s.id} style={styles.studentCard}>
            <View style={styles.studentInitials}>
              <Text style={styles.studentInitialsText}>{getInitials(s.studentName)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.studentName}>{s.studentName}</Text>
              <Text style={styles.studentMeta}>
                Enrolled {formatDate(s.createdAt)}
              </Text>
            </View>
            <View style={[styles.statusBadge,
              s.status === 'active' ? styles.statusActive : styles.statusExpired
            ]}>
              <Text style={[styles.statusText,
                s.status === 'active' ? { color: C.success } : { color: C.error }
              ]}>
                {s.status}
              </Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function NoticesTab({ notices, isTeacher, onAdd, onDelete }: {
  notices: CourseNotice[]; isTeacher: boolean;
  onAdd: () => void; onDelete: (id: string) => void;
}) {
  return (
    <View>
      {isTeacher && (
        <Pressable style={styles.addBtn} onPress={onAdd}>
          <Ionicons name="add-circle" size={20} color="#FFF" />
          <Text style={styles.addBtnText}>Post Notice</Text>
        </Pressable>
      )}

      {notices.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="megaphone-outline" size={48} color={C.textTertiary} />
          <Text style={styles.emptyStateText}>No notices posted</Text>
        </View>
      ) : (
        notices.map(n => (
          <View key={n.id} style={styles.noticeCard}>
            <View style={styles.noticeHeader}>
              <Text style={styles.noticeTitle}>{n.title}</Text>
              {isTeacher && (
                <Pressable onPress={() => onDelete(n.id)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={C.error} />
                </Pressable>
              )}
            </View>
            {n.message ? <Text style={styles.noticeMessage}>{n.message}</Text> : null}
            <View style={styles.noticeFooter}>
              <Text style={styles.noticeTime}>{timeAgo(n.createdAt)}</Text>
              <Text style={styles.noticeAuthor}>by {n.teacherName}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

/* ====== POLL STYLES ====== */
const pollStyles = StyleSheet.create({
  panel: {
    backgroundColor: C.surface,
    borderRadius: 14,
    marginTop: 4,
    marginBottom: 8,
    borderTopWidth: 2,
    borderTopColor: C.primary + '50',
    paddingBottom: 12,
    overflow: 'hidden',
  },
  newPollBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#34C759', paddingHorizontal: 14, paddingVertical: 10,
  },
  newPollBannerText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFF', flex: 1 },
  panelHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  panelTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, flex: 1 },
  pollCount: {
    backgroundColor: C.primary + '18', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  scoreBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFD60A20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  scoreText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFD60A' },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  createBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  emptyPoll: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyPollText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textTertiary, textAlign: 'center', paddingHorizontal: 20 },

  card: {
    margin: 10, marginBottom: 6,
    backgroundColor: C.background,
    borderRadius: 14,
    padding: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' as const },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  typeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  closedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.border, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  closedText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSecondary },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#34C75918', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  activeDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#34C759' },
  activeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#34C759' },
  timerBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  timerText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  adminActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' as any },
  adminBtn: { padding: 4, backgroundColor: C.surface, borderRadius: 6 },

  question: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 14, lineHeight: 24 },
  options: { gap: 9 },
  optionBtn: {
    borderRadius: 12, padding: 0, overflow: 'hidden',
    position: 'relative' as const, minHeight: 48, backgroundColor: C.surface,
  },
  optionBar: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    borderRadius: 12,
  },
  optionContent: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 12,
    gap: 10,
  },
  optionIndex: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  optionIndexText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  optionText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  optionPct: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  voteCount: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textTertiary },

  typeSwitch: {
    flexDirection: 'row', gap: 8, marginBottom: 14,
    backgroundColor: C.background, borderRadius: 12, padding: 4,
  },
  typeSwitchBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10,
  },
  typeSwitchText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  optionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  addOptionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 2,
  },
  addOptionText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },
  timerOption: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  timerOptionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});

/* ====== STYLES ====== */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  loadingBack: { paddingHorizontal: 16, paddingVertical: 8 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: C.textTertiary, fontSize: 16, fontFamily: 'Inter_400Regular' },

  heroSection: { position: 'relative' as const },
  coverImage: { width, height: 180 },
  coverPlaceholder: {
    width, height: 140,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  coverGradient: {
    position: 'absolute' as const,
    bottom: 0, left: 0, right: 0, height: 100,
  },
  heroOverlay: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  circleBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },

  miniHeader: { paddingHorizontal: 16, marginTop: -20 },
  title: {
    color: C.text, fontSize: 20, fontFamily: 'Inter_700Bold',
    lineHeight: 26, marginBottom: 8,
  },
  miniStats: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 14, borderWidth: 1, borderColor: C.border,
  },
  statValue: {
    color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_500Medium',
  },

  tabBar: {
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface, marginTop: 8,
  },
  tabBarScroll: { paddingHorizontal: 12 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: C.primary },
  tabLabel: {
    color: C.textTertiary, fontSize: 13, fontFamily: 'Inter_500Medium',
  },
  tabLabelActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },

  tabContent: { flex: 1 },

  /* Overview */
  teacherRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 12, marginTop: 8,
  },
  teacherAvatar: { width: 42, height: 42, borderRadius: 21 },
  teacherAvatarPlaceholder: {
    backgroundColor: C.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  teacherInitial: { color: C.primary, fontSize: 18, fontFamily: 'Inter_700Bold' },
  teacherName: { color: C.text, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  teacherLabel: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular' },
  chatIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },

  priceBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface, paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 14, borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  priceText: { color: C.primary, fontSize: 24, fontFamily: 'Inter_700Bold' },
  accessText: { color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  categoryBadge: {
    backgroundColor: C.primaryMuted,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
  },
  categoryBadgeText: {
    color: C.primary, fontSize: 12, fontFamily: 'Inter_600SemiBold',
  },

  enrolledBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(52,199,89,0.1)',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    marginBottom: 12,
  },
  enrolledText: {
    color: C.success, fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1,
  },
  expiresText: {
    color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular',
  },

  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 12,
  },
  infoText: { color: C.textSecondary, fontSize: 14, fontFamily: 'Inter_400Regular' },

  section: { marginTop: 12, marginBottom: 8 },
  sectionTitle: {
    color: C.text, fontSize: 16, fontFamily: 'Inter_600SemiBold', marginBottom: 10,
  },
  descText: {
    color: C.textSecondary, fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22,
  },

  detailsGrid: {
    flexDirection: 'row', flexWrap: 'wrap' as const, gap: 10,
  },
  detailItem: {
    width: (width - 52) / 3, backgroundColor: C.surface,
    borderRadius: 14, padding: 14, alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: C.border,
  },
  detailValue: { color: C.text, fontSize: 16, fontFamily: 'Inter_700Bold' },
  detailLabel: { color: C.textTertiary, fontSize: 11, fontFamily: 'Inter_400Regular' },

  /* Content tab */
  contentSummary: {
    color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_500Medium',
    marginBottom: 12, marginTop: 8,
  },
  chapterCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 10,
    overflow: 'hidden' as const,
  },
  chapterHeader: {
    flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12,
  },
  chapterIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  chapterTitle: {
    color: C.text, fontSize: 15, fontFamily: 'Inter_600SemiBold',
  },
  chapterSubtitle: {
    color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2,
  },
  videoList: { borderTopWidth: 1, borderTopColor: C.border },
  videoItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: C.borderLight,
  },
  playIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  playIconUnlocked: { backgroundColor: C.primary },
  videoTitle: { color: C.text, fontSize: 14, fontFamily: 'Inter_500Medium' },
  videoDuration: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  freeBadge: {
    backgroundColor: 'rgba(52,199,89,0.12)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  freeBadgeText: { color: C.success, fontSize: 10, fontFamily: 'Inter_700Bold' },

  /* Live Classes */
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14, height: 46, marginBottom: 16, marginTop: 8,
  },
  addBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  liveCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10,
  },
  liveCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  liveStatusDot: { width: 8, height: 8, borderRadius: 4 },
  liveCardTitle: { color: C.text, fontSize: 15, fontFamily: 'Inter_600SemiBold', flex: 1 },
  liveCardDesc: { color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 8 },
  liveCardMeta: { flexDirection: 'row', gap: 16, marginTop: 4 },
  liveCardMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveCardMetaText: { color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_400Regular' },
  joinLiveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#FF3B30', borderRadius: 10, height: 38, marginTop: 10,
  },
  joinLiveText: { color: '#FFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  /* Students */
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 12, height: 44,
    borderWidth: 1, borderColor: C.border, marginBottom: 12, marginTop: 8,
  },
  searchInput: {
    flex: 1, color: C.text, fontSize: 14, fontFamily: 'Inter_400Regular',
  },
  studentCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  studentInitials: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  studentInitialsText: { color: C.primary, fontSize: 15, fontFamily: 'Inter_700Bold' },
  studentName: { color: C.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  studentMeta: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
  },
  statusActive: { backgroundColor: 'rgba(52,199,89,0.1)' },
  statusExpired: { backgroundColor: 'rgba(255,59,48,0.1)' },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'capitalize' as const },

  /* Notices */
  noticeCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10,
  },
  noticeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6,
  },
  noticeTitle: { color: C.text, fontSize: 15, fontFamily: 'Inter_600SemiBold', flex: 1 },
  noticeMessage: {
    color: C.textSecondary, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 8,
  },
  noticeFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  noticeTime: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular' },
  noticeAuthor: { color: C.textTertiary, fontSize: 12, fontFamily: 'Inter_400Regular' },

  /* Empty */
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyStateText: { color: C.textTertiary, fontSize: 14, fontFamily: 'Inter_400Regular' },

  /* Bottom */
  bottomBar: {
    position: 'absolute' as const, bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: C.background,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  enrollBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: C.primary, borderRadius: 25, height: 52,
  },
  enrollBtnText: { color: '#FFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  enrollBtnPrice: { color: 'rgba(255,255,255,0.8)', fontSize: 16, fontFamily: 'Inter_600SemiBold' },

  paymentHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: '#0D0D0D', borderBottomWidth: 1, borderBottomColor: '#222',
  },
  paymentHeaderTitle: {
    color: '#FFF', fontSize: 17, fontFamily: 'Inter_600SemiBold',
  },

  /* Modal */
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16,
  },
  modalTitle: { color: C.text, fontSize: 18, fontFamily: 'Inter_700Bold' },
  modalInput: {
    backgroundColor: C.background, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 12, color: C.text, fontSize: 14, fontFamily: 'Inter_400Regular',
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  modalRow: { flexDirection: 'row', marginBottom: 4 },
  modalLabel: {
    color: C.textSecondary, fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 4,
  },
  modalSubmitBtn: {
    backgroundColor: C.primary, borderRadius: 14, height: 48,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  modalSubmitText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
});
