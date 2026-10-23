import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Image, View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { ResizeMode, Video } from "expo-av";
import { SafeAreaView } from "react-native-safe-area-context";
import PagerView from "react-native-pager-view";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RootStackParamList } from "../types";
import { BRAND, BRAND_BG_GRADIENT, BRAND_BUTTON_GRADIENT } from "./context/brand";
import { resetAllTours } from "../components/CoachTour";

type Nav = StackNavigationProp<RootStackParamList, "OnboardingScreen">;
type Route = RouteProp<RootStackParamList, "OnboardingScreen">;
type IconName = keyof typeof Ionicons.glyphMap;

/* ---------- Video background ---------- */
// Replace assets/onboarding-bg.mp4 with your own clip (portrait, 10–15 s, under ~5 MB, no sound needed).
const BG_VIDEO = require("../assets/onboarding-bg.mp4");

const VideoBackground = () => {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={[...BRAND_BG_GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
      {!reduceMotion && !failed ? (
        <Video
          source={BG_VIDEO}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isLooping
          isMuted
          onError={() => setFailed(true)}
        />
      ) : null}
      {/* Dark tint so text stays readable over any video */}
      <LinearGradient
        colors={["rgba(21,16,43,0.55)", "rgba(21,16,43,0.72)", "rgba(21,16,43,0.92)"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
};

/* ---------- Small building blocks for the mock previews ---------- */

const Card: React.FC<{ children: React.ReactNode; style?: object }> = ({ children, style }) => (
  <View style={[styles.card, style]}>{children}</View>
);

const Pill: React.FC<{ label: string; filled?: boolean }> = ({ label, filled }) => (
  <View style={[styles.pill, filled ? styles.pillFilled : styles.pillOutline]}>
    <Text style={[styles.pillText, { color: filled ? BRAND.ink : BRAND.mint }]}>{label}</Text>
  </View>
);

const IconBadge: React.FC<{ icon: IconName; bg?: string; color?: string }> = ({ icon, bg = BRAND.violet, color = "#fff" }) => (
  <View style={[styles.iconBadge, { backgroundColor: bg }]}>
    <Ionicons name={icon} size={20} color={color} />
  </View>
);

/* ---------- Previews: show what each part of the app looks like ---------- */

const WelcomePreview = () => (
  <View style={{ alignItems: "center" }}>
    <Image source={require("../assets/logo.png")} style={styles.logo} resizeMode="contain" accessibilityLabel="Wiji logo" />
    <View style={styles.featureRow}>
      {[
        { icon: "people" as IconName, label: "Communities" },
        { icon: "chatbubbles" as IconName, label: "Chats & calls" },
        { icon: "map" as IconName, label: "Things to do" },
        { icon: "car" as IconName, label: "Safe rides" },
        { icon: "wallet" as IconName, label: "Pay & get paid" },
      ].map((f) => (
        <View key={f.label} style={styles.featureChip}>
          <Ionicons name={f.icon} size={16} color={BRAND.mint} />
          <Text style={styles.featureChipText}>{f.label}</Text>
        </View>
      ))}
    </View>
  </View>
);

const CommunityPreview = () => (
  <View style={{ gap: 10 }}>
    <Card>
      <View style={styles.row}>
        <IconBadge icon="school" />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>My Community</Text>
          <Text style={styles.cardMeta}>128 members · 4 group chats</Text>
        </View>
        <Pill label="Join" filled />
      </View>
    </Card>
    <Card style={{ opacity: 0.75 }}>
      <View style={styles.row}>
        <IconBadge icon="football" bg={BRAND.inkSoft} color={BRAND.mint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Sunday Soccer</Text>
          <Text style={styles.cardMeta}>Group chat · 23 online</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={BRAND.mutedOnInk} />
      </View>
    </Card>
  </View>
);

const ChatPreview = () => (
  <Card style={{ gap: 8 }}>
    <View style={[styles.bubble, styles.bubbleThem]}>
      <Text style={styles.bubbleText}>Are you coming to the braai later?</Text>
    </View>
    <View style={[styles.bubble, styles.bubbleMe]}>
      <Text style={[styles.bubbleText, { color: "#fff" }]}>Yes! Leaving now</Text>
    </View>
    <View style={[styles.row, styles.callStrip]}>
      <Ionicons name="call" size={16} color={BRAND.ink} />
      <Text style={styles.callStripText}>Voice call · 02:14</Text>
    </View>
  </Card>
);

const MapPreview = () => (
  <View style={{ gap: 10 }}>
    <View style={styles.fakeMap}>
      <View style={[styles.mapRoad, { top: 40, transform: [{ rotate: "-8deg" }] }]} />
      <View style={[styles.mapRoad, { left: 120, top: -20, width: 14, height: 200 }]} />
      <View style={[styles.mapPin, { left: 70, top: 22 }]}>
        <Ionicons name="football" size={14} color="#fff" />
      </View>
      <View style={[styles.mapPin, { left: 190, top: 54, backgroundColor: BRAND.mint }]}>
        <Ionicons name="pricetag" size={13} color={BRAND.ink} />
      </View>
    </View>
    <Card>
      <Text style={styles.cardMeta}>I want to…</Text>
      <Text style={styles.cardTitle}>Play 5-a-side soccer</Text>
      <Text style={styles.cardMeta}>Sat 10:00 · Hatfield Park · 3 going</Text>
      <View style={{ flexDirection: "row", marginTop: 10 }}>
        <Pill label="Request to join" filled />
      </View>
    </Card>
  </View>
);

const RidePreview = () => (
  <View style={{ gap: 10 }}>
    <Card>
      <View style={styles.row}>
        <IconBadge icon="person" bg={BRAND.inkSoft} color={BRAND.mint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Thabo · White Toyota Corolla</Text>
          <Text style={styles.cardMeta}>CA 123-456 · arriving in 3 min</Text>
        </View>
        <Ionicons name="shield-checkmark" size={20} color={BRAND.mint} />
      </View>
      <View style={[styles.row, { marginTop: 12, justifyContent: "space-between" }]}>
        <Text style={styles.cardMeta}>Your trip PIN</Text>
        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: 6 }}>4821</Text>
      </View>
    </Card>
    <View style={[styles.row, { gap: 8 }]}>
      <Pill label="Share my trip" filled />
      <View style={[styles.pill, { backgroundColor: "#D7263D" }]}>
        <Text style={[styles.pillText, { color: "#fff" }]}>SOS</Text>
      </View>
    </View>
  </View>
);

const WalletPreview = () => (
  <View style={{ gap: 10 }}>
    <Card>
      <View style={styles.row}>
        <IconBadge icon="qr-code" />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Scan to pay</Text>
          <Text style={styles.cardMeta}>Pay a driver or shop by card</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={BRAND.mutedOnInk} />
      </View>
    </Card>
    <Card>
      <View style={styles.row}>
        <Ionicons name="checkmark-circle" size={22} color={BRAND.mint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>R85 paid to Kabelo</Text>
          <Text style={styles.cardMeta}>Visa •••• 4242 · Secured by Paystack</Text>
        </View>
      </View>
    </Card>
    <Card style={{ opacity: 0.85 }}>
      <Text style={styles.cardMeta}>Drivers and businesses: you earned this week</Text>
      <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 2 }}>R1 240</Text>
    </Card>
  </View>
);

const ReadyPreview = () => (
  <Card style={{ gap: 14 }}>
    {[
      { icon: "person-circle" as IconName, text: "Add a profile photo so people recognise you" },
      { icon: "people" as IconName, text: "Join one community you care about" },
      { icon: "shield-checkmark" as IconName, text: "Pick trusted friends for safer rides (Map → car button)" },
    ].map((s, i) => (
      <View key={s.text} style={styles.row}>
        <View style={styles.stepNum}>
          <Text style={styles.stepNumText}>{i + 1}</Text>
        </View>
        <Text style={[styles.cardTitle, { flex: 1, fontWeight: "600", fontSize: 15 }]}>{s.text}</Text>
      </View>
    ))}
  </Card>
);

/* ---------- Slide content ---------- */

interface Slide {
  key: string;
  kicker: string;
  title: string;
  body: string;
  /** Which tab this feature lives in, so people can find it after the walkthrough. */
  where?: { icon: IconName; tab: string; how: string };
  Preview: React.FC;
}

const SLIDES: Slide[] = [
  {
    key: "welcome",
    kicker: "Welcome to Wiji",
    title: "Your people and your plans, in one app",
    body: "Join communities, chat and call friends, find things to do, get a safe ride and pay by card. Here's a 1-minute tour.",
    Preview: WelcomePreview,
  },
  {
    key: "communities",
    kicker: "Communities",
    title: "Find your people",
    body: "Join communities for your campus, area, church or hobby. Each community has group chats inside it.",
    where: { icon: "people-outline", tab: "Communities tab", how: "Browse Explore and tap Join, or tap + to start your own." },
    Preview: CommunityPreview,
  },
  {
    key: "chats",
    kicker: "Chats & calls",
    title: "Message and call friends",
    body: "Find people in Explore, open their profile and send a message. Once you've chatted, you can voice-call them for free.",
    where: { icon: "chatbubbles-outline", tab: "Chats and Calls tabs", how: "Chats has your friends and Explore. Calls lists people you can ring." },
    Preview: ChatPreview,
  },
  {
    key: "map",
    kicker: "Map",
    title: "See what's happening nearby",
    body: "Post what you want to do: a game, a study session, a braai. People nearby ask to join, and you plan it together in the activity chat. Price-tag pins are local deals.",
    where: { icon: "map-outline", tab: "Map tab", how: "Tap + to post an activity. Tap a pin to see details and join." },
    Preview: MapPreview,
  },
  {
    key: "rides",
    kicker: "Rides",
    title: "Get a safe ride",
    body: "Every driver is ID-checked and verified by Wiji. Check the photo, car and plate, then give the driver your trip PIN. Share your live trip with trusted friends, and press SOS if you ever need help.",
    where: { icon: "car-outline", tab: "Map tab → car button", how: "Search where you're going, pick it from the list and tap Request ride. Want to drive? Go to Profile and choose Driver." },
    Preview: RidePreview,
  },
  {
    key: "wallet",
    kicker: "Wallet",
    title: "Pay and get paid",
    body: "Scan a driver's or shop's pay code and pay by card. Payments are secured by Paystack. Drivers and verified businesses get paid straight into their bank and can see their earnings.",
    where: { icon: "wallet-outline", tab: "Wallet tab", how: "Tap Scan to pay. To get paid, tap Set up payouts and add your bank account." },
    Preview: WalletPreview,
  },
  {
    key: "ready",
    kicker: "You're ready",
    title: "Start with these 3 steps",
    body: "That's it. You can replay this tour any time from your profile.",
    Preview: ReadyPreview,
  },
];

/* ---------- Screen ---------- */

const OnboardingScreen = () => {
  const [page, setPage] = useState(0);
  const pagerRef = useRef<PagerView>(null);
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const isReplay = !!route.params?.replay || (route.name as string) === "WalkthroughScreen";
  const isLast = page === SLIDES.length - 1;

  const finish = async () => {
    if (isReplay) {
      // Show the on-screen tips again too
      await resetAllTours();
      navigation.goBack();
      return;
    }
    try {
      await AsyncStorage.setItem("@hasSeenOnboarding", "true");
    } catch (error) {
      console.error("Error saving onboarding status:", error);
    }
    navigation.replace("AuthScreen");
  };

  const goTo = (i: number) => pagerRef.current?.setPage(i);

  return (
    <View style={{ flex: 1, backgroundColor: BRAND.ink }}>
      <VideoBackground />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        {/* Top bar: progress + skip */}
        <View style={styles.topBar}>
          <Text style={styles.stepCounter}>
            {page + 1} of {SLIDES.length}
          </Text>
          {!isLast && (
            <TouchableOpacity onPress={finish} hitSlop={12} accessibilityRole="button">
              <Text style={styles.skip}>{isReplay ? "Close" : "Skip"}</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((page + 1) / SLIDES.length) * 100}%` }]} />
        </View>

        <PagerView ref={pagerRef} style={{ flex: 1 }} initialPage={0} onPageSelected={(e) => setPage(e.nativeEvent.position)}>
          {SLIDES.map(({ key, kicker, title, body, where, Preview }) => (
            <ScrollView key={key} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
              <View style={styles.previewArea}>
                <Preview />
              </View>

              <Text style={styles.kicker}>{kicker.toUpperCase()}</Text>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.body}>{body}</Text>

              {where && (
                <View style={styles.whereBox}>
                  <Ionicons name={where.icon} size={22} color={BRAND.mint} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.whereTab}>Where to find it: {where.tab}</Text>
                    <Text style={styles.whereHow}>{where.how}</Text>
                  </View>
                </View>
              )}
            </ScrollView>
          ))}
        </PagerView>

        {/* Bottom actions */}
        <View style={styles.bottomBar}>
          {page > 0 ? (
            <TouchableOpacity onPress={() => goTo(page - 1)} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Previous">
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => (isLast ? finish() : goTo(page + 1))}
            accessibilityRole="button"
          >
            <LinearGradient colors={[...BRAND_BUTTON_GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.nextBtn}>
              <Text style={styles.nextText}>
                {isLast ? (isReplay ? "Done" : "Create my account") : page === 0 ? "Show me around" : "Next"}
              </Text>
              {!isLast && <Ionicons name="arrow-forward" size={20} color="#fff" />}
            </LinearGradient>
          </TouchableOpacity>
        </View>
        {page === 0 && !isReplay ? (
          <TouchableOpacity onPress={finish} style={{ alignSelf: "center", paddingBottom: 12, paddingTop: 2 }} accessibilityRole="button">
            <Text style={{ color: BRAND.mutedOnInk, fontSize: 15 }}>
              I already have an account · <Text style={{ color: "#fff", fontWeight: "700" }}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        ) : null}
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
    height: 40,
  },
  stepCounter: { color: BRAND.mutedOnInk, fontSize: 13, fontWeight: "600" },
  skip: { color: "#fff", fontSize: 15, fontWeight: "600" },
  progressTrack: {
    height: 4,
    marginHorizontal: 24,
    marginTop: 6,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: BRAND.mint },
  page: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 },
  previewArea: { minHeight: 230, justifyContent: "center", marginBottom: 28 },
  kicker: { color: BRAND.mint, fontSize: 12, fontWeight: "800", letterSpacing: 1.4, marginBottom: 8 },
  title: { color: "#fff", fontSize: 28, fontWeight: "800", lineHeight: 34, letterSpacing: -0.5 },
  body: { color: BRAND.mutedOnInk, fontSize: 16, lineHeight: 24, marginTop: 12 },
  whereBox: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    marginTop: 20,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(62,240,208,0.08)",
    borderWidth: 1,
    borderColor: "rgba(62,240,208,0.25)",
  },
  whereTab: { color: "#fff", fontSize: 15, fontWeight: "700" },
  whereHow: { color: BRAND.mutedOnInk, fontSize: 14, lineHeight: 20, marginTop: 2 },

  logo: { width: 120, height: 120, marginBottom: 24 },
  featureRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  featureChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  featureChipText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  card: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cardMeta: { color: BRAND.mutedOnInk, fontSize: 13, marginTop: 2, flexShrink: 1 },
  iconBadge: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  pill: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999 },
  pillFilled: { backgroundColor: BRAND.mint },
  pillOutline: { borderWidth: 1, borderColor: BRAND.mint },
  pillText: { fontSize: 13, fontWeight: "700" },

  bubble: { maxWidth: "80%", paddingVertical: 9, paddingHorizontal: 13, borderRadius: 16 },
  bubbleThem: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.12)", borderBottomLeftRadius: 4 },
  bubbleMe: { alignSelf: "flex-end", backgroundColor: BRAND.violet, borderBottomRightRadius: 4 },
  bubbleText: { color: "#fff", fontSize: 14 },
  callStrip: {
    alignSelf: "center",
    marginTop: 6,
    backgroundColor: BRAND.mint,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    gap: 6,
  },
  callStripText: { color: BRAND.ink, fontWeight: "700", fontSize: 13 },

  fakeMap: {
    height: 120,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: BRAND.inkSoft,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  mapRoad: { position: "absolute", left: -20, width: 400, height: 12, backgroundColor: "rgba(255,255,255,0.08)" },
  mapPin: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: BRAND.violet,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },

  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: BRAND.violet, alignItems: "center", justifyContent: "center" },
  stepNumText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  bottomBar: { flexDirection: "row", gap: 12, paddingHorizontal: 24, paddingBottom: 16, paddingTop: 8 },
  backBtn: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  nextBtn: {
    height: 54,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  nextText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});

export default OnboardingScreen;
