import { Audio } from 'expo-av';
import { Platform } from 'react-native';

let notificationSound: Audio.Sound | null = null;

const NOTIFICATION_URL = 'https://cdn.pixabay.com/audio/2022/12/12/audio_e8c0aed15a.mp3';

export async function playNotificationSound() {
  try {
    if (Platform.OS === 'web') {
      try {
        const audio = new window.Audio(NOTIFICATION_URL);
        audio.volume = 0.5;
        await audio.play();
      } catch {}
      return;
    }

    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: false,
      shouldDuckAndroid: true,
    });

    if (notificationSound) {
      try {
        await notificationSound.unloadAsync();
      } catch {}
    }

    const { sound } = await Audio.Sound.createAsync(
      { uri: NOTIFICATION_URL },
      { volume: 0.5, shouldPlay: true }
    );
    notificationSound = sound;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        notificationSound = null;
      }
    });
  } catch {}
}
