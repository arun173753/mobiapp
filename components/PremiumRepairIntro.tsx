import React, { useEffect, useMemo, useState } from "react";
import { Dimensions, Image, Platform, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import LottieView from "lottie-react-native";
import Animated, {
  Easing,
  Extrapolation,
  type SharedValue,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

type PremiumRepairIntroProps = {
  visible: boolean;
  onDone: () => void;
  durationMs?: number;
  logoSource?: Parameters<typeof Image>[0]["source"];
  lottieSource?: object;
};

type Particle = {
  key: string;
  x: number;
  y: number;
  delay: number;
  driftX: number;
  driftY: number;
  size: number;
};

const DEFAULT_TOTAL_MS = 6000;
const INTRO_START_DELAY_MS = 1000;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const AnimatedLottie = Animated.createAnimatedComponent(LottieView);

export function PremiumRepairIntro({
  visible,
  onDone,
  durationMs = DEFAULT_TOTAL_MS,
  logoSource = require("../assets/images/icon.png"),
  lottieSource = require("../assets/animations/repair-lab-intro.json"),
}: PremiumRepairIntroProps) {
  const progress = useSharedValue(0);
  const [lottieFailed, setLottieFailed] = useState(false);

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: 12 }).map((_, i) => ({
        key: `p-${i}`,
        x: SCREEN_W * (0.12 + ((i * 0.073) % 0.76)),
        y: SCREEN_H * (0.18 + ((i * 0.097) % 0.62)),
        delay: i * 60,
        driftX: (i % 2 === 0 ? 1 : -1) * (12 + i * 1.5),
        driftY: -18 - i * 1.2,
        size: 2 + (i % 4),
      })),
    [],
  );

  useEffect(() => {
    if (!visible) {
      progress.value = 0;
      return;
    }
    setLottieFailed(false);
    progress.value = 0;
    progress.value = withDelay(
      INTRO_START_DELAY_MS,
      withTiming(
        1,
        { duration: durationMs, easing: Easing.bezier(0.2, 0.8, 0.2, 1) },
        (finished) => {
          if (finished) runOnJS(onDone)();
        },
      ),
    );
  }, [durationMs, onDone, progress, visible]);

  const overlayStyle = useAnimatedStyle(() => {
    return { opacity: 1 };
  });

  const cameraStyle = useAnimatedStyle(() => {
    const zoom = interpolate(progress.value, [0, 0.5, 1], [1.1, 1.04, 1.02], Extrapolation.CLAMP);
    const panY = interpolate(progress.value, [0, 1], [16, -6], Extrapolation.CLAMP);
    return { transform: [{ scale: zoom }, { translateY: panY }] };
  });

  const technicianHandStyle = useAnimatedStyle(() => {
    const sweep = interpolate(progress.value, [0.08, 0.28, 0.5], [-26, 24, -4], Extrapolation.CLAMP);
    const opacity = interpolate(progress.value, [0, 0.05, 0.62], [0, 1, 0.6], Extrapolation.CLAMP);
    return { opacity, transform: [{ translateX: sweep }, { rotate: "-14deg" }] };
  });

  const sparkStyle = useAnimatedStyle(() => {
    const pulse = interpolate(progress.value, [0.18, 0.24, 0.3, 0.36], [0, 1, 0.2, 0.9], Extrapolation.CLAMP);
    const scale = interpolate(progress.value, [0.16, 0.36], [0.7, 1.15], Extrapolation.CLAMP);
    return { opacity: pulse, transform: [{ scale }] };
  });

  const phoneScreenStyle = useAnimatedStyle(() => {
    const glow = interpolate(progress.value, [0.44, 0.62, 0.72], [0, 0.92, 0.84], Extrapolation.CLAMP);
    return { opacity: glow };
  });

  const logoStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0.5, 0.68, 0.92], [0, 1, 1], Extrapolation.CLAMP);
    const scale = interpolate(progress.value, [0.5, 0.74], [0.78, 1], Extrapolation.CLAMP);
    return { opacity, transform: [{ scale }] };
  });

  const welcomeTextStyle = useAnimatedStyle(() => {
    // Primary heading: appears near 1.2s and gets subtle pulse.
    const opacity = interpolate(progress.value, [0.18, 0.24, 0.42, 0.5], [0, 1, 0.92, 1], Extrapolation.CLAMP);
    const translateY = interpolate(progress.value, [0.2, 0.28], [20, 0], Extrapolation.CLAMP);
    const scale = interpolate(progress.value, [0.2, 0.3, 0.42, 0.54], [0.92, 1, 1.03, 1], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }, { scale }],
    };
  });

  const taglineStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0.42, 0.5, 1], [0, 1, 1], Extrapolation.CLAMP);
    const translateY = interpolate(progress.value, [0.42, 0.52], [16, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const taglineSubStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0.52, 0.62, 1], [0, 1, 1], Extrapolation.CLAMP);
    const translateY = interpolate(progress.value, [0.52, 0.62], [10, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const lottieStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.08], [0, 1], Extrapolation.CLAMP);
    const scale = interpolate(progress.value, [0, 0.5, 1], [0.98, 1.03, 1.06], Extrapolation.CLAMP);
    return { opacity, transform: [{ scale }] };
  });

  const circuitStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0.08, 0.28, 1], [0, 0.55, 0.75], Extrapolation.CLAMP);
    return { opacity };
  });

  const circuitPulseStyle = useAnimatedStyle(() => {
    const pulse = interpolate(progress.value, [0.26, 0.38, 0.52, 0.66, 0.8, 1], [0.75, 1, 0.82, 1, 0.88, 1], Extrapolation.CLAMP);
    return {
      transform: [{ scale: pulse }],
      opacity: pulse,
    };
  });

  const lightSweepStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0.2, 0.32, 0.88, 1], [0, 0.45, 0.45, 0.2], Extrapolation.CLAMP);
    const translateX = interpolate(progress.value, [0.2, 0.95], [-SCREEN_W * 0.45, SCREEN_W * 0.45], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateX }, { rotate: "-18deg" }],
    };
  });

  const logoShimmerStyle = useAnimatedStyle(() => {
    const shimmerIn = interpolate(progress.value, [0.56, 0.78], [0, 1], Extrapolation.CLAMP);
    const shimmerOut = interpolate(progress.value, [0.82, 1], [1, 0.3], Extrapolation.CLAMP);
    const translateX = interpolate(progress.value, [0.56, 0.86], [-150, 150], Extrapolation.CLAMP);
    return {
      opacity: shimmerIn * shimmerOut,
      transform: [{ translateX }, { rotate: "-12deg" }],
    };
  });

  const logoEdgePulseStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0.56, 0.74, 0.88, 1], [0.2, 0.65, 0.38, 0.55], Extrapolation.CLAMP);
    return { opacity };
  });

  if (!visible) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.overlay, overlayStyle]}>
      <Animated.View style={[styles.camera, cameraStyle]}>
        <LinearGradient colors={["#091A32", "#050C1A", "#02060F", "#000000"]} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={["rgba(0,148,255,0.2)", "rgba(0,0,0,0)"]} style={styles.bgNebulaA} />
        <LinearGradient colors={["rgba(0,220,255,0.15)", "rgba(0,0,0,0)"]} style={styles.bgNebulaB} />
        <LinearGradient colors={["rgba(0,0,0,0.12)", "rgba(0,0,0,0)", "rgba(0,0,0,0.42)"]} style={StyleSheet.absoluteFill} />
        <Animated.View style={[styles.lightSweep, lightSweepStyle]}>
          <LinearGradient colors={["rgba(0,0,0,0)", "rgba(101,219,255,0.45)", "rgba(0,0,0,0)"]} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={[styles.circuitLayer, circuitStyle]}>
          <View style={styles.circuitLineA} />
          <View style={styles.circuitLineB} />
          <View style={styles.circuitLineC} />
          <View style={styles.circuitLineD} />
          <Animated.View style={[styles.circuitNodeA, circuitPulseStyle]} />
          <Animated.View style={[styles.circuitNodeB, circuitPulseStyle]} />
          <Animated.View style={[styles.circuitNodeC, circuitPulseStyle]} />
          <Animated.View style={[styles.circuitNodeD, circuitPulseStyle]} />
        </Animated.View>

        {!lottieFailed ? (
          <AnimatedLottie
            source={lottieSource as any}
            autoPlay
            loop
            resizeMode="cover"
            style={[StyleSheet.absoluteFillObject, lottieStyle]}
            onAnimationFailure={() => setLottieFailed(true)}
            onAnimationFinish={() => {
              // Keep overlay timing controlled by Reanimated; this callback is for diagnostics only.
            }}
            renderMode={Platform.OS === "android" ? "HARDWARE" : "AUTOMATIC"}
          />
        ) : (
          <>
            <View style={styles.workshopGlowA} />
            <View style={styles.workshopGlowB} />
          </>
        )}

        {particles.map((p) => (
          <FloatingParticle key={p.key} particle={p} progress={progress} />
        ))}

        <View style={styles.phoneShell}>
          <View style={styles.phoneFrame}>
            <Animated.View style={[styles.phoneScreenOn, phoneScreenStyle]} />
            <View style={styles.phoneBoard}>
              <Animated.View style={[styles.sparkCore, sparkStyle]} />
              <Ionicons name="hardware-chip-outline" size={28} color="#72BEFF" />
            </View>
          </View>
        </View>

        <Animated.View style={[styles.handTool, technicianHandStyle]}>
          <Ionicons name="build-outline" size={24} color="#C9D6E8" />
        </Animated.View>

        <Animated.View style={[styles.logoWrap, logoStyle]}>
          <LinearGradient colors={["rgba(178,236,255,0.26)", "rgba(80,184,255,0.12)", "rgba(0,0,0,0)"]} style={styles.logoGlow} />
          <View style={styles.logoBackdrop} />
          <Animated.View style={[styles.logoEdgePulse, logoEdgePulseStyle]} />
          <View style={styles.logoClip}>
            <LinearGradient colors={["rgba(255,255,255,0.07)", "rgba(255,255,255,0.01)"]} style={styles.logoCardGlass} />
            <Animated.View style={[styles.logoShimmer, logoShimmerStyle]}>
              <LinearGradient colors={["rgba(0,0,0,0)", "rgba(111,211,255,0.18)", "rgba(0,0,0,0)"]} style={StyleSheet.absoluteFill} />
            </Animated.View>
            <Image source={logoSource} style={styles.logo} resizeMode="cover" />
          </View>
        </Animated.View>

        <Animated.View style={[styles.welcomeWrap, welcomeTextStyle]}>
          <LinearGradient colors={["rgba(98,236,255,0.46)", "rgba(0,158,255,0.2)", "rgba(0,0,0,0)"]} style={styles.welcomeGlow} />
          <Animated.Text style={styles.welcomeTitle}>WELCOME TO MOBI</Animated.Text>
        </Animated.View>

        <Animated.View style={[styles.taglineWrap, taglineStyle]}>
          <Animated.Text style={styles.taglineMain}>LEARN, GROW AND FIND CUSTOMERS</Animated.Text>
          <Animated.Text style={[styles.taglineSub, taglineSubStyle]}>INDIA&apos;S BIGGEST APP</Animated.Text>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

function FloatingParticle({ particle, progress }: { particle: Particle; progress: SharedValue<number> }) {
  const drift = useSharedValue(0);

  useEffect(() => {
    drift.value = withDelay(
      particle.delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 950, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 950, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [drift, particle.delay]);

  const style = useAnimatedStyle(() => {
    const baseOpacity = interpolate(progress.value, [0.03, 0.18, 0.88], [0, 1, 0], Extrapolation.CLAMP);
    const x = particle.x + particle.driftX * drift.value;
    const y = particle.y + particle.driftY * drift.value;
    const inLogoBand = particle.y > SCREEN_H * 0.62;
    const opacityMultiplier = inLogoBand ? 0.38 : 1;
    return {
      opacity: baseOpacity * (0.48 + drift.value * 0.45) * opacityMultiplier,
      transform: [{ translateX: x }, { translateY: y }],
    };
  });

  return <Animated.View style={[styles.particle, style, { width: particle.size, height: particle.size, borderRadius: particle.size }]} />;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    backgroundColor: "#000000",
  },
  camera: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#000000",
    margin: -16,
    padding: 16,
  },
  workshopGlowA: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 180,
    backgroundColor: "rgba(0,118,255,0.24)",
    top: 90,
    left: -40,
  },
  workshopGlowB: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 160,
    backgroundColor: "rgba(0,206,255,0.18)",
    right: -30,
    bottom: 160,
  },
  bgNebulaA: {
    position: "absolute",
    width: SCREEN_W * 1.15,
    height: SCREEN_H * 0.52,
    top: -40,
    left: -30,
    borderBottomRightRadius: 240,
  },
  bgNebulaB: {
    position: "absolute",
    width: SCREEN_W * 1.1,
    height: SCREEN_H * 0.5,
    right: -40,
    bottom: 30,
    borderTopLeftRadius: 220,
  },
  circuitLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  lightSweep: {
    position: "absolute",
    width: SCREEN_W * 0.42,
    height: SCREEN_H * 0.9,
    top: SCREEN_H * 0.1,
    left: SCREEN_W * 0.3,
  },
  circuitLineA: {
    position: "absolute",
    top: SCREEN_H * 0.18,
    left: SCREEN_W * 0.1,
    width: SCREEN_W * 0.32,
    height: 2,
    backgroundColor: "rgba(111,208,255,0.34)",
  },
  circuitLineB: {
    position: "absolute",
    top: SCREEN_H * 0.18,
    left: SCREEN_W * 0.41,
    width: 2,
    height: SCREEN_H * 0.16,
    backgroundColor: "rgba(111,208,255,0.3)",
  },
  circuitLineC: {
    position: "absolute",
    top: SCREEN_H * 0.62,
    right: SCREEN_W * 0.08,
    width: SCREEN_W * 0.36,
    height: 2,
    backgroundColor: "rgba(76,194,255,0.3)",
  },
  circuitLineD: {
    position: "absolute",
    top: SCREEN_H * 0.49,
    right: SCREEN_W * 0.23,
    width: 2,
    height: SCREEN_H * 0.14,
    backgroundColor: "rgba(76,194,255,0.26)",
  },
  circuitNodeA: {
    position: "absolute",
    top: SCREEN_H * 0.174,
    left: SCREEN_W * 0.09,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(141,226,255,0.82)",
  },
  circuitNodeB: {
    position: "absolute",
    top: SCREEN_H * 0.332,
    left: SCREEN_W * 0.406,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: "rgba(141,226,255,0.78)",
  },
  circuitNodeC: {
    position: "absolute",
    top: SCREEN_H * 0.614,
    right: SCREEN_W * 0.075,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: "rgba(122,218,255,0.75)",
  },
  circuitNodeD: {
    position: "absolute",
    top: SCREEN_H * 0.486,
    right: SCREEN_W * 0.218,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(122,218,255,0.65)",
  },
  particle: {
    position: "absolute",
    backgroundColor: "#7ED4FF",
    shadowColor: "#43A2FF",
    shadowOpacity: 0.9,
    shadowRadius: 5,
  },
  phoneShell: {
    position: "absolute",
    alignSelf: "center",
    top: SCREEN_H * 0.22,
    width: 180,
    height: 320,
    borderRadius: 28,
    backgroundColor: "#0A1220",
    borderWidth: 1,
    borderColor: "rgba(115,157,199,0.45)",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#4CB4FF",
    shadowOpacity: 0.35,
    shadowRadius: 22,
  },
  phoneFrame: {
    width: 158,
    height: 292,
    borderRadius: 24,
    backgroundColor: "#060C15",
    borderWidth: 1,
    borderColor: "rgba(148,198,255,0.2)",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  phoneBoard: {
    width: 96,
    height: 150,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(96,167,239,0.35)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20,42,70,0.45)",
  },
  sparkCore: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(84,190,255,0.58)",
  },
  handTool: {
    position: "absolute",
    top: SCREEN_H * 0.36,
    left: SCREEN_W * 0.18,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "rgba(15,23,36,0.86)",
    borderWidth: 1,
    borderColor: "rgba(124,184,245,0.36)",
    alignItems: "center",
    justifyContent: "center",
  },
  phoneScreenOn: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(80,198,255,0.17)",
  },
  logoWrap: {
    position: "absolute",
    alignSelf: "center",
    bottom: SCREEN_H * 0.08,
    width: 232,
    height: 182,
    alignItems: "center",
    justifyContent: "center",
  },
  logoGlow: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 85,
  },
  logo: {
    width: 254,
    height: 188,
  },
  logoBackdrop: {
    position: "absolute",
    width: 236,
    height: 172,
    borderRadius: 18,
    backgroundColor: "rgba(0, 0, 0, 0.28)",
    borderWidth: 0,
    borderColor: "transparent",
    shadowColor: "#57C3FF",
    shadowOpacity: 0.42,
    shadowRadius: 18,
  },
  logoClip: {
    width: 236,
    height: 172,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#f1d736",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0,
    borderColor: "transparent",
  },
  logoEdgePulse: {
    position: "absolute",
    width: 236,
    height: 172,
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: "rgba(85,196,255,0.85)",
    shadowColor: "#66CAFF",
    shadowOpacity: 0.45,
    shadowRadius: 14,
  },
  logoCardGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
  },
  logoShimmer: {
    position: "absolute",
    width: 100,
    height: 240,
    top: -30,
  },
  welcomeWrap: {
    position: "absolute",
    alignSelf: "center",
    top: SCREEN_H * 0.095,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    overflow: "hidden",
  },
  welcomeGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
  },
  welcomeTitle: {
    color: "#FFFFFF",
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.2,
    textAlign: "center",
    textShadowColor: "rgba(122,233,255,1)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  taglineWrap: {
    position: "absolute",
    alignSelf: "center",
    top: SCREEN_H * 0.165,
    paddingHorizontal: 14,
  },
  taglineMain: {
    color: "rgba(236,251,255,1)",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    letterSpacing: 1.2,
    textAlign: "center",
    textShadowColor: "rgba(122,226,255,0.95)",
    textShadowRadius: 13,
  },
  taglineSub: {
    marginTop: 6,
    color: "rgba(208,243,255,1)",
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    letterSpacing: 1.4,
    textAlign: "center",
    textShadowColor: "rgba(88,208,255,0.9)",
    textShadowRadius: 10,
  },
});
