// components/CoachTour.tsx
// First-time "coach marks": dims the screen, spotlights one button at a time and explains it.
// Each tour is shown once per install (AsyncStorage) and only while its screen is focused.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { BRAND } from "../Screens/context/brand";

export type Rect = { x: number; y: number; width: number; height: number };

export interface TourStep {
  title: string;
  body: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Element to spotlight (measured on screen). Leave out for a centred card. */
  target?: React.RefObject<any>;
  /** Or an exact rectangle in window coordinates. */
  rect?: Rect;
  /** Or a function that measures something custom (used for the bottom tab bar). */
  getRect?: () => Promise<Rect | null>;
}

export const ALL_TOURS = ["tabs", "communities", "chats", "map", "calls", "wallet", "rides"] as const;
const storageKey = (id: string) => `@wiji_tour_seen_${id}`;

// Tiny event bus so a tour can start right after the one it waits for finishes.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

async function hasSeen(id: string) {
  try {
    return (await AsyncStorage.getItem(storageKey(id))) === "true";
  } catch {
    return true; // if storage fails, don't trap the user in a tour
  }
}

async function markSeen(id: string) {
  try {
    await AsyncStorage.setItem(storageKey(id), "true");
  } catch {}
  notify();
}

/** Show every tour again (used when someone replays the walkthrough). */
export async function resetAllTours() {
  try {
    await AsyncStorage.multiRemove(ALL_TOURS.map(storageKey));
  } catch {}
  notify();
}

interface Props {
  id: (typeof ALL_TOURS)[number];
  steps: TourStep[];
  /** Wait until this tour has been seen before starting. */
  after?: (typeof ALL_TOURS)[number];
  /** Give the screen time to lay out before measuring (ms). */
  delay?: number;
}

const PAD = 8;

const CoachTour: React.FC<Props> = ({ id, steps, after, delay = 700 }) => {
  const isFocused = useIsFocused();
  const { width: W, height: H } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where the overlay itself sits on screen, measured the same way as the buttons.
  // On Android, button positions are measured from below the status bar while the overlay
  // starts at the very top, so we subtract this to keep the highlight on target.
  const overlayRef = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const measureOverlay = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y, width, height) => setOrigin({ x, y, width, height }));
  }, []);

  const check = useCallback(async () => {
    if (!isFocused || visible) return;
    if (await hasSeen(id)) return;
    if (after && !(await hasSeen(after))) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setIndex(0);
      setVisible(true);
    }, delay);
  }, [id, after, delay, isFocused, visible]);

  useEffect(() => {
    check();
    listeners.add(check);
    return () => {
      listeners.delete(check);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [check]);

  // Hide if the user leaves the screen mid-tour; it resumes next time they come back.
  useEffect(() => {
    if (!isFocused && visible) setVisible(false);
  }, [isFocused, visible]);

  // Measure the current step's target.
  useEffect(() => {
    if (!visible) return;
    const step = steps[index];
    if (!step) return;
    if (step.rect) {
      setRect(step.rect);
      return;
    }
    if (step.getRect) {
      let cancelled = false;
      setRect(null);
      step.getRect().then((r) => !cancelled && setRect(r));
      return () => {
        cancelled = true;
      };
    }
    const node = step.target?.current;
    if (!node?.measureInWindow) {
      setRect(null);
      return;
    }
    setRect(null);
    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      setRect(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  }, [visible, index, steps]);

  const finish = useCallback(() => {
    setVisible(false);
    markSeen(id);
  }, [id]);

  const next = () => (index < steps.length - 1 ? setIndex(index + 1) : finish());

  if (!visible) return null;
  const step = steps[index];
  const isLast = index === steps.length - 1;

  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  const OW = origin?.width || W;
  const OH = origin?.height || H;
  // Wait for the overlay to be measured before drawing a spotlight, so it never flashes in the wrong place
  const hole =
    rect && origin
      ? {
          x: Math.max(0, rect.x - ox - PAD),
          y: Math.max(0, rect.y - oy - PAD),
          w: Math.min(OW, rect.width + PAD * 2),
          h: rect.height + PAD * 2,
        }
      : null;
  // Put the card below the spotlight when it's in the top half, above it otherwise.
  const cardPos = hole
    ? hole.y + hole.h / 2 < OH / 2
      ? { top: hole.y + hole.h + 14 }
      : { bottom: OH - hole.y + 14 }
    : { top: OH * 0.3 };

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={finish} onShow={measureOverlay}>
      <View ref={overlayRef} collapsable={false} style={StyleSheet.absoluteFill} onLayout={measureOverlay}>
      {hole ? (
        <>
          <View style={[styles.dim, { left: 0, top: 0, width: W, height: hole.y }]} />
          <View style={[styles.dim, { left: 0, top: hole.y + hole.h, width: W, bottom: 0 }]} />
          <View style={[styles.dim, { left: 0, top: hole.y, width: hole.x, height: hole.h }]} />
          <View style={[styles.dim, { left: hole.x + hole.w, top: hole.y, right: 0, height: hole.h }]} />
          <View pointerEvents="none" style={[styles.ring, { left: hole.x, top: hole.y, width: hole.w, height: hole.h }]} />
        </>
      ) : (
        <View style={[styles.dim, StyleSheet.absoluteFillObject]} />
      )}

      <View style={[styles.card, cardPos]}>
        <View style={styles.headerRow}>
          {step.icon ? (
            <View style={styles.iconBadge}>
              <Ionicons name={step.icon} size={18} color="#fff" />
            </View>
          ) : null}
          <Text style={styles.counter}>
            {index + 1} of {steps.length}
          </Text>
        </View>
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.body}>{step.body}</Text>
        <View style={styles.actions}>
          {!isLast ? (
            <TouchableOpacity onPress={finish} hitSlop={10} accessibilityRole="button">
              <Text style={styles.skip}>Skip tips</Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
          <TouchableOpacity onPress={next} style={styles.nextBtn} accessibilityRole="button">
            <Text style={styles.nextText}>{isLast ? "Got it" : "Next"}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  dim: { position: "absolute", backgroundColor: "rgba(10, 7, 22, 0.78)" },
  ring: { position: "absolute", borderRadius: 16, borderWidth: 3, borderColor: BRAND.mint },
  card: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: BRAND.violet,
    alignItems: "center",
    justifyContent: "center",
  },
  counter: { color: "#77718C", fontSize: 13, fontWeight: "600" },
  title: { color: BRAND.ink, fontSize: 19, fontWeight: "800" },
  body: { color: "#4A4560", fontSize: 15, lineHeight: 22, marginTop: 6 },
  actions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16 },
  skip: { color: "#77718C", fontSize: 15, fontWeight: "600" },
  nextBtn: { backgroundColor: BRAND.violet, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 22 },
  nextText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});

export default CoachTour;
