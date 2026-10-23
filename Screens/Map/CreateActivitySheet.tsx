// Create an activity in four short steps: What → When → Where → Review.
// Replaces the old single long form with typed dates (YYYY-MM-DD) and times (HH:MM).
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import ThemedMapView from "../../components/ThemedMapView";
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import { PlaceSuggestion, newSearchSession, resolvePlace, searchPlaces } from "../../services/places";

export type ActivityKind =
  | "food-and-drinks" | "night-life" | "outdoor" | "sightseeing" | "entertainment"
  | "shopping" | "wellness" | "social" | "fitness" | "other";

const KINDS: { key: ActivityKind; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; ideas: string[] }[] = [
  { key: "food-and-drinks", label: "Food & drinks", icon: "restaurant", color: "#FF6B6B", ideas: ["Grab a coffee", "Dinner out", "Braai", "Lunch break"] },
  { key: "social", label: "Hang out", icon: "people", color: "#E91E63", ideas: ["Chill and chat", "Study session", "Meet new people", "Board games"] },
  { key: "fitness", label: "Fitness", icon: "barbell", color: "#2ECC71", ideas: ["Morning run", "Gym session", "Soccer match", "Cycle"] },
  { key: "outdoor", label: "Outdoors", icon: "leaf", color: "#27AE60", ideas: ["Hike", "Picnic in the park", "Sunset walk", "Swim"] },
  { key: "night-life", label: "Night out", icon: "wine", color: "#9B59B6", ideas: ["Drinks tonight", "Live music", "Club night"] },
  { key: "entertainment", label: "Entertainment", icon: "musical-notes", color: "#E74C3C", ideas: ["Movie night", "Comedy show", "Gaming session"] },
  { key: "sightseeing", label: "Explore", icon: "camera", color: "#3498DB", ideas: ["Explore the city", "Museum visit", "Photo walk"] },
  { key: "shopping", label: "Shopping", icon: "bag", color: "#F39C12", ideas: ["Mall trip", "Market visit", "Thrifting"] },
  { key: "wellness", label: "Wellness", icon: "heart", color: "#1ABC9C", ideas: ["Yoga", "Meditation", "Spa day"] },
  { key: "other", label: "Something else", icon: "sparkles", color: "#95A5A6", ideas: [] },
];
const kindOf = (k: ActivityKind) => KINDS.find((x) => x.key === k)!;

const STEPS = ["What", "When", "Where", "Review"];
const DURATIONS = [
  { mins: 30, label: "30 min" },
  { mins: 60, label: "1 hour" },
  { mins: 120, label: "2 hours" },
  { mins: 180, label: "3 hours" },
  { mins: 240, label: "Half day" },
];
const MAX_AHEAD_DAYS = 60;

type Place = { lat: number; lng: number; address: string; source: "here" | "search" | "pin" };

/** Round up to the next `step` minutes */
const roundUp = (d: Date, step = 15) => {
  const r = new Date(d);
  r.setSeconds(0, 0);
  const m = r.getMinutes();
  r.setMinutes(Math.ceil((m + 1) / step) * step);
  return r;
};
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
function dayLabel(d: Date) {
  const today = new Date();
  const tomorrow = new Date(Date.now() + 864e5);
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
}
export function formatWhen(start: Date, end: Date) {
  const endPart = sameDay(start, end) ? hhmm(end) : `${dayLabel(end)} ${hhmm(end)}`;
  return `${dayLabel(start)} · ${hhmm(start)} – ${endPart}`;
}
const durationText = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
};

async function addressFor(lat: number, lng: number) {
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!a) return "Pinned location";
    const street = [a.streetNumber, a.street].filter(Boolean).join(" ") || a.name;
    return [street, a.district || a.subregion, a.city].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(", ") || "Pinned location";
  } catch {
    return "Pinned location";
  }
}

type Props = {
  visible: boolean;
  onClose: () => void;
  userLocation: { lat: number; lng: number } | null;
  /** Called after the activity is saved, so the map can fly to it */
  onCreated: (a: { id: string; lat: number; lng: number; title: string }) => void;
};

export default function CreateActivitySheet({ visible, onClose, userLocation, onCreated }: Props) {
  const { colors, theme } = useTheme() as any;
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ActivityKind | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState<Date>(roundUp(new Date()));
  const [duration, setDuration] = useState<number | null>(120);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [approval, setApproval] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ id: string; lat: number; lng: number; title: string } | null>(null);
  const [iosPicker, setIosPicker] = useState<{ mode: "date" | "time"; value: Date; onSet: (d: Date) => void } | null>(null);
  const session = useRef(newSearchSession());
  const mapRef = useRef<MapView>(null);
  const searchTimer = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);

  const end = customEnd ?? new Date(start.getTime() + (duration || 60) * 60000);
  const k = kind ? kindOf(kind) : null;
  const card = colors.cardBackground || colors.card || colors.background;
  const muted = colors.textSecondary || colors.secondaryText;
  const line = colors.borderColor || colors.border;

  const useWhereIAm = async () => {
    if (!userLocation) return Alert.alert("Location is off", "Turn on location, or search for the place instead.");
    setLocating(true);
    const address = await addressFor(userLocation.lat, userLocation.lng);
    setPlace({ ...userLocation, address, source: "here" });
    setQuery("");
    setSuggestions([]);
    setLocating(false);
    mapRef.current?.animateToRegion({ latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
  };

  // Fresh form every time it opens
  useEffect(() => {
    if (!visible) return;
    setStep(0);
    setKind(null);
    setTitle("");
    setDescription("");
    setStart(roundUp(new Date()));
    setDuration(120);
    setCustomEnd(null);
    setPlace(null);
    setQuery("");
    setSuggestions([]);
    setApproval(false);
    setSaving(false);
    setDone(null);
    setIosPicker(null);
    session.current = newSearchSession();
    if (userLocation) useWhereIAm();
  }, [visible]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  /* ---------- validation per step ---------- */
  const problem = (() => {
    if (step === 0) {
      if (!kind) return "Choose what kind of activity it is";
      if (title.trim().length < 3) return "Say what you want to do";
      return null;
    }
    if (step === 1) {
      if (start.getTime() < Date.now() - 5 * 60000) return "That start time has already passed";
      if (start.getTime() > Date.now() + MAX_AHEAD_DAYS * 864e5) return `Choose a date within ${MAX_AHEAD_DAYS} days`;
      if (end <= start) return "It has to end after it starts";
      if (end.getTime() - start.getTime() > 3 * 864e5) return "Activities can last up to 3 days";
      return null;
    }
    if (step === 2) return place ? null : "Choose where it happens";
    return null;
  })();

  const next = () => {
    Keyboard.dismiss();
    if (problem) return;
    Haptics.selectionAsync().catch(() => undefined);
    if (step < 3) setStep(step + 1);
    else post();
  };
  const back = () => (step > 0 ? setStep(step - 1) : onClose());

  /* ---------- date & time pickers ---------- */
  const pick = (mode: "date" | "time", value: Date, onSet: (d: Date) => void) => {
    Keyboard.dismiss();
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value,
        mode,
        is24Hour: true,
        minimumDate: mode === "date" ? new Date() : undefined,
        maximumDate: mode === "date" ? new Date(Date.now() + MAX_AHEAD_DAYS * 864e5) : undefined,
        onChange: (e: DateTimePickerEvent, d?: Date) => e.type === "set" && d && onSet(d),
      });
    } else {
      setIosPicker({ mode, value, onSet });
    }
  };
  const setStartDate = (d: Date) => {
    const n = new Date(start);
    n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    setStart(n);
    if (customEnd) setCustomEnd(null), setDuration(120);
  };
  const setStartTime = (d: Date) => {
    const n = new Date(start);
    n.setHours(d.getHours(), d.getMinutes(), 0, 0);
    setStart(n);
    if (customEnd) setCustomEnd(null), setDuration(120);
  };
  const setEndTime = (d: Date) => {
    const n = new Date(start);
    n.setHours(d.getHours(), d.getMinutes(), 0, 0);
    if (n <= start) n.setDate(n.getDate() + 1); // e.g. 22:00 → 01:00 ends the next day
    setCustomEnd(n);
    setDuration(null);
  };

  const quickStarts = (() => {
    const now = new Date();
    const list: { label: string; date: Date }[] = [{ label: "Now", date: roundUp(now, 5) }, { label: "In 1 hour", date: roundUp(new Date(Date.now() + 3600e3), 15) }];
    const tonight = new Date(now);
    tonight.setHours(19, 0, 0, 0);
    if (now.getHours() < 18) list.push({ label: "Tonight", date: tonight });
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    list.push({ label: "Tomorrow", date: tomorrow });
    const sat = new Date(now);
    sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7));
    sat.setHours(10, 0, 0, 0);
    if (now.getDay() !== 5) list.push({ label: "Saturday", date: sat });
    return list;
  })();

  /* ---------- place search ---------- */
  const onSearch = (text: string) => {
    setQuery(text);
    clearTimeout(searchTimer.current);
    if (text.trim().length < 2) return setSuggestions([]);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setSuggestions(await searchPlaces(text, session.current, userLocation || undefined));
      } finally {
        setSearching(false);
      }
    }, 300);
  };
  const choose = async (s: PlaceSuggestion) => {
    Keyboard.dismiss();
    setSuggestions([]);
    setQuery(s.title);
    setLocating(true);
    const r = await resolvePlace(s, session.current);
    session.current = newSearchSession();
    setLocating(false);
    if (!r) return Alert.alert("Couldn't find that place", "Try another search, or drop the pin on the map.");
    setPlace({ lat: r.lat, lng: r.lng, address: r.address, source: "search" });
    mapRef.current?.animateToRegion({ latitude: r.lat, longitude: r.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
  };
  const dropPin = async (lat: number, lng: number) => {
    setPlace({ lat, lng, address: "Finding address…", source: "pin" });
    const address = await addressFor(lat, lng);
    setPlace({ lat, lng, address, source: "pin" });
  };

  /* ---------- save ---------- */
  const post = async () => {
    const user = auth.currentUser;
    if (!user || !place || !kind) return;
    setSaving(true);
    try {
      let name = user.displayName || "Someone";
      try {
        const u = await getDoc(doc(db, "users", user.uid));
        if (u.exists()) name = u.data().username || u.data().displayName || name;
      } catch {}
      const t = title.trim().slice(0, 80);
      const ref = await addDoc(collection(db, "activities"), {
        title: t,
        ...(description.trim() ? { description: description.trim().slice(0, 500) } : {}),
        activityType: kind,
        latitude: place.lat,
        longitude: place.lng,
        location: place.address,
        createdBy: user.uid,
        createdByName: name,
        createdAt: serverTimestamp(),
        participants: [user.uid],
        startTime: Timestamp.fromDate(start),
        endTime: Timestamp.fromDate(end),
        visibility: "everyone",
        requiresApproval: approval,
      });
      await setDoc(doc(db, "activityChats", ref.id), { activityId: ref.id, activityTitle: t, createdAt: serverTimestamp() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setDone({ id: ref.id, lat: place.lat, lng: place.lng, title: t });
    } catch (e: any) {
      Alert.alert("Couldn't post your activity", e?.message || "Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- UI pieces ---------- */
  const Chip = ({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: any }) => (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{
        flexDirection: "row", alignItems: "center", gap: 6,
        paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5,
        borderColor: on ? colors.primary : line, backgroundColor: on ? colors.primary : "transparent",
      }}
    >
      {icon ? <Ionicons name={icon} size={15} color={on ? "#fff" : colors.text} /> : null}
      <Text style={{ color: on ? "#fff" : colors.text, fontWeight: "700" }}>{label}</Text>
    </TouchableOpacity>
  );
  const Heading = ({ title: t, sub }: { title: string; sub?: string }) => (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}>{t}</Text>
      {sub ? <Text style={{ color: muted, marginTop: 4, lineHeight: 20 }}>{sub}</Text> : null}
    </View>
  );
  const Label = ({ children }: { children: string }) => (
    <Text style={{ color: colors.text, fontWeight: "800", marginTop: 18, marginBottom: 8 }}>{children}</Text>
  );
  const PickerButton = ({ icon, label, value, onPress }: { icon: any; label: string; value: string; onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: line, backgroundColor: card }}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: muted, fontSize: 12 }}>{label}</Text>
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{value}</Text>
      </View>
    </TouchableOpacity>
  );

  const PreviewCard = () =>
    k ? (
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: line, backgroundColor: card, overflow: "hidden" }}>
        <View style={{ height: 6, backgroundColor: k.color }} />
        <View style={{ padding: 16, flexDirection: "row", gap: 14 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: k.color, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={k.icon} size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>{title.trim() || "Your activity"}</Text>
            <Text style={{ color: k.color, fontWeight: "800", fontSize: 12, marginTop: 2 }}>{k.label.toUpperCase()}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
              <Ionicons name="time-outline" size={16} color={muted} />
              <Text style={{ color: colors.text, flex: 1 }}>{formatWhen(start, end)}</Text>
            </View>
            {place ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                <Ionicons name="location-outline" size={16} color={muted} />
                <Text style={{ color: colors.text, flex: 1 }} numberOfLines={2}>{place.address}</Text>
              </View>
            ) : null}
            {description.trim() ? <Text style={{ color: muted, marginTop: 10, lineHeight: 19 }}>{description.trim()}</Text> : null}
          </View>
        </View>
      </View>
    ) : null;

  /* ---------- steps ---------- */
  const What = (
    <View>
      <Heading title="What do you want to do?" sub="Pick a type, then say it in a few words." />
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
        {KINDS.map((x) => {
          const on = kind === x.key;
          return (
            <TouchableOpacity
              key={x.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => undefined);
                setKind(x.key);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={{
                width: "48.5%", flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginBottom: 10,
                borderRadius: 14, borderWidth: 2, borderColor: on ? x.color : line, backgroundColor: on ? `${x.color}1F` : card,
              }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: x.color, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={x.icon} size={19} color="#fff" />
              </View>
              <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }} numberOfLines={1}>{x.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Label>I want to…</Label>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder={k?.ideas[0] ? `e.g. ${k.ideas[0].toLowerCase()}` : "e.g. go for a jog, grab dinner, watch a movie"}
        placeholderTextColor={muted}
        maxLength={80}
        returnKeyType="done"
        style={{ borderWidth: 1, borderColor: line, backgroundColor: card, color: colors.text, borderRadius: 14, paddingHorizontal: 14, height: 52, fontSize: 16 }}
      />
      {k && k.ideas.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
          {k.ideas.map((idea) => <Chip key={idea} label={idea} on={title === idea} onPress={() => setTitle(idea)} />)}
        </ScrollView>
      ) : null}

      <Label>Details (optional)</Label>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Anything people should know: what to bring, who it's for, cost…"
        placeholderTextColor={muted}
        maxLength={500}
        multiline
        style={{ borderWidth: 1, borderColor: line, backgroundColor: card, color: colors.text, borderRadius: 14, padding: 14, minHeight: 90, textAlignVertical: "top", fontSize: 15 }}
      />
    </View>
  );

  const When = (
    <View>
      <Heading title="When is it?" sub={formatWhen(start, end)} />
      <Label>Starts</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {quickStarts.map((q) => (
          <Chip
            key={q.label}
            label={q.label}
            on={Math.abs(q.date.getTime() - start.getTime()) < 60000}
            onPress={() => {
              setStart(q.date);
              if (customEnd) setCustomEnd(null), setDuration(120);
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <PickerButton icon="calendar-outline" label="Date" value={dayLabel(start)} onPress={() => pick("date", start, setStartDate)} />
        <PickerButton icon="time-outline" label="Time" value={hhmm(start)} onPress={() => pick("time", start, setStartTime)} />
      </View>

      <Label>How long?</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {DURATIONS.map((d) => (
          <Chip key={d.mins} label={d.label} on={!customEnd && duration === d.mins} onPress={() => (setCustomEnd(null), setDuration(d.mins))} />
        ))}
        <Chip
          label={customEnd ? `Until ${hhmm(customEnd)}` : "Pick end time"}
          icon="time-outline"
          on={!!customEnd}
          onPress={() => pick("time", end, setEndTime)}
        />
      </View>
      <Text style={{ color: muted, marginTop: 10 }}>
        Ends {sameDay(start, end) ? "at" : dayLabel(end).toLowerCase() + " at"} {hhmm(end)} · {durationText(Math.round((end.getTime() - start.getTime()) / 60000))}
      </Text>
    </View>
  );

  const Where = (
    <View>
      <Heading title="Where is it?" sub="Use where you are, search for a place, or tap the map to move the pin." />
      <TouchableOpacity
        onPress={useWhereIAm}
        accessibilityRole="button"
        style={{
          flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 2,
          borderColor: place?.source === "here" ? colors.primary : line, backgroundColor: card,
        }}
      >
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
          {locating && place?.source !== "search" ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="navigate" size={18} color="#fff" />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>Where I am now</Text>
          <Text style={{ color: muted, fontSize: 13 }} numberOfLines={1}>
            {userLocation ? (place?.source === "here" ? place.address : "Use my current location") : "Location is off"}
          </Text>
        </View>
        {place?.source === "here" ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
      </TouchableOpacity>

      <View style={{ marginTop: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: line, backgroundColor: card, borderRadius: 14, paddingHorizontal: 12 }}>
          <Ionicons name="search" size={18} color={muted} />
          <TextInput
            value={query}
            onChangeText={onSearch}
            placeholder="Search a place, e.g. Hatfield Plaza"
            placeholderTextColor={muted}
            style={{ flex: 1, height: 50, color: colors.text, fontSize: 16, marginLeft: 8 }}
            returnKeyType="search"
          />
          {searching ? <ActivityIndicator size="small" color={colors.primary} /> : query ? (
            <TouchableOpacity onPress={() => (setQuery(""), setSuggestions([]))} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={20} color={muted} />
            </TouchableOpacity>
          ) : null}
        </View>
        {suggestions.length ? (
          <View style={{ borderWidth: 1, borderColor: line, backgroundColor: card, borderRadius: 14, marginTop: 6, overflow: "hidden" }}>
            {suggestions.slice(0, 5).map((s, i) => (
              <TouchableOpacity
                key={s.id}
                onPress={() => choose(s)}
                style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: line }}
              >
                <Ionicons name="location-outline" size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "700" }} numberOfLines={1}>{s.title}</Text>
                  {s.subtitle ? <Text style={{ color: muted, fontSize: 12 }} numberOfLines={1}>{s.subtitle}</Text> : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ height: 200, borderRadius: 16, overflow: "hidden", marginTop: 12, borderWidth: 1, borderColor: line }}>
        <ThemedMapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          initialRegion={{
            latitude: place?.lat ?? userLocation?.lat ?? -25.7479,
            longitude: place?.lng ?? userLocation?.lng ?? 28.2293,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          showsUserLocation
          toolbarEnabled={false}
          onPress={(e) => dropPin(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
        >
          {place ? (
            <Marker
              coordinate={{ latitude: place.lat, longitude: place.lng }}
              draggable
              onDragEnd={(e) => dropPin(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
              pinColor={k?.color || colors.primary}
            />
          ) : null}
        </ThemedMapView>
      </View>
      {place ? (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 10 }}>
          <Ionicons name="location" size={18} color={colors.primary} />
          <Text style={{ color: colors.text, flex: 1, fontWeight: "600" }}>{place.address}</Text>
        </View>
      ) : null}
      <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>Tip: hold and drag the pin to the exact spot.</Text>
    </View>
  );

  const Review = (
    <View>
      <Heading title="Looks good?" sub="This is how people nearby will see it on the map." />
      <PreviewCard />
      <Label>Who can join?</Label>
      {[
        { on: !approval, set: false, icon: "flash-outline", title: "Anyone nearby", sub: "People can join straight away" },
        { on: approval, set: true, icon: "shield-checkmark-outline", title: "I approve each person", sub: "People ask to join and you accept or decline" },
      ].map((o) => (
        <TouchableOpacity
          key={o.title}
          onPress={() => setApproval(o.set)}
          accessibilityRole="radio"
          accessibilityState={{ selected: o.on }}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 2, borderColor: o.on ? colors.primary : line, backgroundColor: card, marginBottom: 10 }}
        >
          <Ionicons name={o.icon as any} size={22} color={o.on ? colors.primary : colors.text} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800" }}>{o.title}</Text>
            <Text style={{ color: muted, fontSize: 13 }}>{o.sub}</Text>
          </View>
          <Ionicons name={o.on ? "radio-button-on" : "radio-button-off"} size={22} color={o.on ? colors.primary : muted} />
        </TouchableOpacity>
      ))}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 }}>
        <Ionicons name="notifications-outline" size={16} color={muted} />
        <Text style={{ color: muted, fontSize: 12, flex: 1 }}>People nearby get a notification, and a group chat is created for everyone who joins.</Text>
      </View>
    </View>
  );

  const Done = done ? (
    <View style={{ alignItems: "center", paddingTop: 30, paddingBottom: 10 }}>
      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: k?.color || colors.primary, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="checkmark" size={46} color="#fff" />
      </View>
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 18 }}>You're on the map!</Text>
      <Text style={{ color: muted, textAlign: "center", marginTop: 6, lineHeight: 20, paddingHorizontal: 20 }}>
        “{done.title}” is live. We'll let you know when people {approval ? "ask to join" : "join"}.
      </Text>
    </View>
  ) : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined} onRequestClose={back}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: Platform.OS === "ios" ? 12 : insets.top + 6, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <TouchableOpacity onPress={done ? onClose : back} accessibilityLabel={step === 0 || done ? "Close" : "Back"} style={{ padding: 6 }}>
              <Ionicons name={step === 0 || done ? "close" : "arrow-back"} size={26} color={colors.text} />
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{done ? "Posted" : "New activity"}</Text>
            <Text style={{ color: muted, fontWeight: "700", width: 38, textAlign: "right" }}>{done ? "" : `${step + 1}/4`}</Text>
          </View>
          {!done ? (
            <View style={{ flexDirection: "row", gap: 6, marginTop: 12 }}>
              {STEPS.map((label, i) => (
                <TouchableOpacity key={label} style={{ flex: 1 }} disabled={i >= step} onPress={() => setStep(i)} accessibilityLabel={`Step ${i + 1}: ${label}`}>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: i <= step ? colors.primary : line }} />
                  <Text style={{ color: i === step ? colors.primary : muted, fontSize: 11, fontWeight: "700", marginTop: 4 }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {done ? Done : [What, When, Where, Review][step]}
          {iosPicker && Platform.OS === "ios" ? (
            <View style={{ marginTop: 16, borderRadius: 16, borderWidth: 1, borderColor: line, backgroundColor: card, padding: 8 }}>
              <DateTimePicker
                value={iosPicker.value}
                mode={iosPicker.mode}
                display={iosPicker.mode === "date" ? "inline" : "spinner"}
                minimumDate={iosPicker.mode === "date" ? new Date() : undefined}
                maximumDate={iosPicker.mode === "date" ? new Date(Date.now() + MAX_AHEAD_DAYS * 864e5) : undefined}
                onChange={(_e, d) => d && setIosPicker({ ...iosPicker, value: d })}
                themeVariant={theme === "dark" ? "dark" : "light"}
              />
              <TouchableOpacity
                onPress={() => (iosPicker.onSet(iosPicker.value), setIosPicker(null))}
                style={{ alignSelf: "flex-end", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary, margin: 6 }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>

        <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 12) + 4, borderTopWidth: 1, borderTopColor: line, backgroundColor: colors.background }}>
          {done ? (
            <TouchableOpacity
              onPress={() => {
                onCreated(done);
                onClose();
              }}
              style={{ height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>See it on the map</Text>
            </TouchableOpacity>
          ) : (
            <>
              {problem && (step > 0 || kind) ? <Text style={{ color: muted, textAlign: "center", marginBottom: 8, fontSize: 13 }}>{problem}</Text> : null}
              <TouchableOpacity
                onPress={next}
                disabled={!!problem || saving}
                accessibilityRole="button"
                style={{ height: 54, borderRadius: 16, backgroundColor: problem ? line : colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Text style={{ color: problem ? muted : "#fff", fontWeight: "800", fontSize: 17 }}>{step === 3 ? "Post activity" : "Next"}</Text>
                    <Ionicons name={step === 3 ? "send" : "arrow-forward"} size={18} color={problem ? muted : "#fff"} />
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
