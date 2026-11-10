// Report a municipal problem in three short steps: What → Where → Review.
// Works like CreateActivitySheet, but there is no time, no joining and no group chat,
// and the reporter can stay anonymous (their user id never goes on the public report).
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import ThemedMapView from "../../components/ThemedMapView";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import { PlaceSuggestion, newSearchSession, resolvePlace, searchPlaces } from "../../services/places";
import { REPORT_CATEGORIES, ReportCategory, reportCategory } from "./reports";

const STEPS = ["What", "Where", "Review"];

type Place = { lat: number; lng: number; address: string; source: "here" | "search" | "pin" };

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

/** Random file name that says nothing about who uploaded it */
const randomName = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}.jpg`;

type Props = {
  visible: boolean;
  onClose: () => void;
  userLocation: { lat: number; lng: number } | null;
  /** Called after the report is saved, so the map can fly to it */
  onCreated: (r: { id: string; lat: number; lng: number; title: string }) => void;
};

export default function CreateReportSheet({ visible, onClose, userLocation, onCreated }: Props) {
  const { colors } = useTheme() as any;
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [anonymous, setAnonymous] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<{ id: string; lat: number; lng: number; title: string } | null>(null);
  const session = useRef(newSearchSession());
  const mapRef = useRef<MapView>(null);
  const searchTimer = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);

  const c = category ? reportCategory(category) : null;
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
    mapRef.current?.animateToRegion({ latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 }, 400);
  };

  // Fresh form every time it opens
  useEffect(() => {
    if (!visible) return;
    setStep(0);
    setCategory(null);
    setTitle("");
    setDescription("");
    setPhotoUri(null);
    setPlace(null);
    setQuery("");
    setSuggestions([]);
    setAnonymous(true);
    setSaving(false);
    setProgress(null);
    setDone(null);
    session.current = newSearchSession();
    if (userLocation) useWhereIAm();
  }, [visible]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  const problem = (() => {
    if (step === 0) {
      if (!category) return "Choose what kind of problem it is";
      if (title.trim().length < 3) return "Describe the problem in a few words";
      return null;
    }
    if (step === 1) return place ? null : "Choose where the problem is";
    return null;
  })();

  const next = () => {
    Keyboard.dismiss();
    if (problem) return;
    Haptics.selectionAsync().catch(() => undefined);
    if (step < 2) setStep(step + 1);
    else post();
  };
  const back = () => (step > 0 ? setStep(step - 1) : onClose());

  /* ---------- photo ---------- */
  const pickPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      return Alert.alert("Permission needed", fromCamera ? "Allow camera access to take a photo of the problem." : "Allow photo access to add a picture of the problem.");
    }
    // allowsEditing re-saves the picture, which drops the phone's hidden photo details (EXIF)
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, quality: 0.7, exif: false };
    const result = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!result.canceled && result.assets?.[0]?.uri) setPhotoUri(result.assets[0].uri);
  };
  const choosePhoto = () =>
    Alert.alert("Add a photo", "A picture helps the municipality find and fix it faster.", [
      { text: "Take photo", onPress: () => pickPhoto(true) },
      { text: "Choose from gallery", onPress: () => pickPhoto(false) },
      { text: "Cancel", style: "cancel" },
    ]);

  const uploadPhoto = async (uri: string) => {
    const blob = await (await fetch(uri)).blob();
    const r = storageRef(storage, `municipal_reports/${randomName()}`);
    await new Promise<void>((resolve, reject) => {
      const task = uploadBytesResumable(r, blob, { contentType: "image/jpeg" });
      task.on("state_changed", (s) => setProgress(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0), reject, () => resolve());
    });
    return getDownloadURL(r);
  };

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
    mapRef.current?.animateToRegion({ latitude: r.lat, longitude: r.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 }, 400);
  };
  const dropPin = async (lat: number, lng: number) => {
    setPlace({ lat, lng, address: "Finding address…", source: "pin" });
    const address = await addressFor(lat, lng);
    setPlace({ lat, lng, address, source: "pin" });
  };

  /* ---------- save ---------- */
  const post = async () => {
    const user = auth.currentUser;
    if (!user || !place || !category) return;
    setSaving(true);
    try {
      let photoUrl: string | undefined;
      if (photoUri) {
        try {
          photoUrl = await uploadPhoto(photoUri);
        } catch {
          setProgress(null);
          const goOn = await new Promise<boolean>((res) =>
            Alert.alert("Photo didn't upload", "Send the report without the photo?", [
              { text: "Cancel", style: "cancel", onPress: () => res(false) },
              { text: "Send without photo", onPress: () => res(true) },
            ])
          );
          if (!goOn) return;
        }
      }
      let name: string | undefined;
      if (!anonymous) {
        name = user.displayName || "Someone";
        try {
          const u = await getDoc(doc(db, "users", user.uid));
          if (u.exists()) name = u.data().username || u.data().displayName || name;
        } catch {}
      }
      const t = title.trim().slice(0, 80);
      const reportRef = doc(collection(db, "municipalReports"));
      const batch = writeBatch(db);
      batch.set(reportRef, {
        category,
        title: t,
        ...(description.trim() ? { description: description.trim().slice(0, 500) } : {}),
        ...(photoUrl ? { photoUrl } : {}),
        latitude: place.lat,
        longitude: place.lng,
        location: place.address,
        anonymous,
        ...(anonymous ? {} : { reporterUid: user.uid, reporterName: name }),
        status: "open",
        affectedBy: [],
        fixedVotes: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // Private: lets the reporter (and the Wiji team, for abuse) find their report without showing it publicly
      batch.set(doc(db, "municipalReportOwners", reportRef.id), { uid: user.uid, createdAt: serverTimestamp() });
      await batch.commit();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setDone({ id: reportRef.id, lat: place.lat, lng: place.lng, title: t });
    } catch (e: any) {
      Alert.alert("Couldn't send your report", e?.message || "Check your connection and try again.");
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  /* ---------- UI pieces ---------- */
  const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5, borderColor: on ? colors.primary : line, backgroundColor: on ? colors.primary : "transparent" }}
    >
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

  const PreviewCard = () =>
    c ? (
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: line, backgroundColor: card, overflow: "hidden" }}>
        <View style={{ height: 6, backgroundColor: c.color }} />
        {photoUri ? <Image source={{ uri: photoUri }} style={{ width: "100%", height: 160 }} resizeMode="cover" /> : null}
        <View style={{ padding: 16, flexDirection: "row", gap: 14 }}>
          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: c.color, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={c.icon} size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>{title.trim() || "Your report"}</Text>
            <Text style={{ color: c.color, fontWeight: "800", fontSize: 12, marginTop: 2 }}>{c.label.toUpperCase()}</Text>
            {place ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
                <Ionicons name="location-outline" size={16} color={muted} />
                <Text style={{ color: colors.text, flex: 1 }} numberOfLines={2}>{place.address}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
              <Ionicons name={anonymous ? "eye-off-outline" : "person-outline"} size={16} color={muted} />
              <Text style={{ color: colors.text, flex: 1 }}>{anonymous ? "Reported anonymously" : "Shows your name"}</Text>
            </View>
            {description.trim() ? <Text style={{ color: muted, marginTop: 10, lineHeight: 19 }}>{description.trim()}</Text> : null}
          </View>
        </View>
      </View>
    ) : null;

  /* ---------- steps ---------- */
  const What = (
    <View>
      <Heading title="What's the problem?" sub="Pick a type, then say what's wrong in a few words." />
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
        {REPORT_CATEGORIES.map((x) => {
          const on = category === x.key;
          return (
            <TouchableOpacity
              key={x.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => undefined);
                setCategory(x.key);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={{
                width: "48.5%", flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginBottom: 10,
                borderRadius: 14, borderWidth: 2, borderColor: on ? x.color : line, backgroundColor: on ? `${x.color}1F` : card,
              }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: x.color, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={x.icon} size={19} color="#fff" />
              </View>
              <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }} numberOfLines={2}>{x.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Label>What's wrong?</Label>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder={c?.ideas[0] ? `e.g. ${c.ideas[0].toLowerCase()}` : "e.g. huge pothole in the left lane"}
        placeholderTextColor={muted}
        maxLength={80}
        returnKeyType="done"
        style={{ borderWidth: 1, borderColor: line, backgroundColor: card, color: colors.text, borderRadius: 14, paddingHorizontal: 14, height: 52, fontSize: 16 }}
      />
      {c && c.ideas.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
          {c.ideas.map((idea) => <Chip key={idea} label={idea} on={title === idea} onPress={() => setTitle(idea)} />)}
        </ScrollView>
      ) : null}

      <Label>More details (optional)</Label>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="How long has it been like this? How bad is it? Any reference number from the municipality?"
        placeholderTextColor={muted}
        maxLength={500}
        multiline
        style={{ borderWidth: 1, borderColor: line, backgroundColor: card, color: colors.text, borderRadius: 14, padding: 14, minHeight: 90, textAlignVertical: "top", fontSize: 15 }}
      />

      <Label>Photo (optional)</Label>
      {photoUri ? (
        <View style={{ borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: line }}>
          <Image source={{ uri: photoUri }} style={{ width: "100%", height: 180 }} resizeMode="cover" />
          <TouchableOpacity
            onPress={() => setPhotoUri(null)}
            accessibilityLabel="Remove photo"
            style={{ position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 16, padding: 6 }}
          >
            <Ionicons name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          onPress={choosePhoto}
          accessibilityRole="button"
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 56, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", borderColor: line, backgroundColor: card }}
        >
          <Ionicons name="camera-outline" size={22} color={colors.primary} />
          <Text style={{ color: colors.text, fontWeight: "700" }}>Add a photo</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const Where = (
    <View>
      <Heading title="Where is it?" sub="Use where you are, search for the street, or tap the map to move the pin to the exact spot." />
      <TouchableOpacity
        onPress={useWhereIAm}
        accessibilityRole="button"
        style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 2, borderColor: place?.source === "here" ? colors.primary : line, backgroundColor: card }}
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
            placeholder="Search a street or place"
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
              <TouchableOpacity key={s.id} onPress={() => choose(s)} style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: line }}>
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

      <View style={{ height: 220, borderRadius: 16, overflow: "hidden", marginTop: 12, borderWidth: 1, borderColor: line }}>
        <ThemedMapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          initialRegion={{
            latitude: place?.lat ?? userLocation?.lat ?? -25.7479,
            longitude: place?.lng ?? userLocation?.lng ?? 28.2293,
            latitudeDelta: 0.008,
            longitudeDelta: 0.008,
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
              pinColor={c?.color || colors.primary}
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
      <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>Tip: hold and drag the pin to exactly where the problem is.</Text>
    </View>
  );

  const Review = (
    <View>
      <Heading title="Ready to report?" sub="This is how people nearby will see it on the map." />
      <PreviewCard />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: line, backgroundColor: card, marginTop: 16 }}>
        <Ionicons name={anonymous ? "eye-off" : "person"} size={22} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>Stay anonymous</Text>
          <Text style={{ color: muted, fontSize: 13, lineHeight: 18 }}>
            {anonymous ? "Other people won't see who reported this." : "Your username will show on the report."}
          </Text>
        </View>
        <Switch value={anonymous} onValueChange={setAnonymous} trackColor={{ true: colors.primary }} accessibilityLabel="Stay anonymous" />
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 12 }}>
        <Ionicons name="information-circle-outline" size={16} color={muted} style={{ marginTop: 1 }} />
        <Text style={{ color: muted, fontSize: 12, flex: 1, lineHeight: 17 }}>
          People nearby can say it affects them too, and mark it fixed once it's sorted. No group chat is created. The Wiji team can see who sent a report, but only uses this to stop fake or abusive reports.
        </Text>
      </View>
    </View>
  );

  const Done = done ? (
    <View style={{ alignItems: "center", paddingTop: 30, paddingBottom: 10 }}>
      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: c?.color || colors.primary, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="checkmark" size={46} color="#fff" />
      </View>
      <Text style={{ color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 18 }}>Reported</Text>
      <Text style={{ color: muted, textAlign: "center", marginTop: 6, lineHeight: 20, paddingHorizontal: 20 }}>
        “{done.title}” is on the map{anonymous ? " anonymously" : ""}. People nearby can back it up so it gets attention faster.
      </Text>
    </View>
  ) : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined} onRequestClose={done ? onClose : back}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: Platform.OS === "ios" ? 12 : insets.top + 6, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <TouchableOpacity onPress={done ? onClose : back} accessibilityLabel={step === 0 || done ? "Close" : "Back"} style={{ padding: 6 }}>
              <Ionicons name={step === 0 || done ? "close" : "arrow-back"} size={26} color={colors.text} />
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{done ? "Sent" : "Report a problem"}</Text>
            <Text style={{ color: muted, fontWeight: "700", width: 38, textAlign: "right" }}>{done ? "" : `${step + 1}/3`}</Text>
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
          {done ? Done : [What, Where, Review][step]}
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
              {problem && (step > 0 || category) ? <Text style={{ color: muted, textAlign: "center", marginBottom: 8, fontSize: 13 }}>{problem}</Text> : null}
              <TouchableOpacity
                onPress={next}
                disabled={!!problem || saving}
                accessibilityRole="button"
                style={{ height: 54, borderRadius: 16, backgroundColor: problem ? line : colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
              >
                {saving ? (
                  <>
                    <ActivityIndicator color="#fff" />
                    {progress !== null ? <Text style={{ color: "#fff", fontWeight: "700" }}>Uploading photo {Math.round(progress * 100)}%</Text> : null}
                  </>
                ) : (
                  <>
                    <Text style={{ color: problem ? muted : "#fff", fontWeight: "800", fontSize: 17 }}>{step === 2 ? "Send report" : "Next"}</Text>
                    <Ionicons name={step === 2 ? "megaphone" : "arrow-forward"} size={18} color={problem ? muted : "#fff"} />
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
