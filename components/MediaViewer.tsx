import React, { useState } from 'react';
import { View, Modal, StyleSheet, Pressable, Dimensions, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface MediaViewerProps {
  visible: boolean;
  onClose: () => void;
  imageUrl?: string;
  videoUrl?: string;
}

export default function MediaViewer({ visible, onClose, imageUrl, videoUrl }: MediaViewerProps) {
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable
          style={[styles.closeBtn, { top: (Platform.OS === 'web' ? 67 : insets.top) + 10 }]}
          onPress={onClose}
          hitSlop={12}
        >
          <Ionicons name="close" size={28} color="#FFF" />
        </Pressable>

        {imageUrl && (
          <View style={styles.mediaContainer}>
            {isLoading && <ActivityIndicator size="large" color="#FFF" style={styles.loader} />}
            <Image
              source={{ uri: imageUrl }}
              style={styles.fullImage}
              contentFit="contain"
              onLoad={() => setIsLoading(false)}
            />
          </View>
        )}

        {videoUrl && (
          <View style={styles.mediaContainer}>
            {Platform.OS === 'web' ? (
              <WebView
                source={{ uri: videoUrl }}
                style={styles.fullVideo}
                javaScriptEnabled
                domStorageEnabled
                mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback
                allowsFullscreenVideo
                allowsPictureInPictureMediaPlayback
                allowsAirPlayForMediaPlayback
              />
            ) : (
              <Video
                source={{ uri: videoUrl }}
                style={styles.fullVideo}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isMuted={false}
                usePoster={false}
                volume={1.0}
                rate={1.0}
                isLooping={false}
                staysActiveInBackground={false}
              />
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loader: {
    position: 'absolute',
    zIndex: 5,
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  fullVideo: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.7,
  },
});
