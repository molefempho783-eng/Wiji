// Business verification: the owner tells Wiji who runs the business and uploads documents.
// Customers can only pay a business in Wiji once the Wiji team has verified it.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Location from "expo-location";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import ThemedMapView from "../../components/ThemedMapView";
import AddressInput from "../../components/AddressInput";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import {
  BUSINESS_DOCS,
  BUSINESS_TYPES,
  BizDocMeta,
  STATUS_TEXT,
  businessProblems,
  needsRegistration,
  saveBusinessDraft,
  submitBusiness,
  uploadBusinessDoc,
} from "../../services/business";

/** Text box that saves while typing (and when the screen closes), so nothing is lost. */
const Field = ({ label, value, onSave, colors, ...opts }: any) => {
  const typed = useRef(value || "");
  const saved = useRef((value || "").trim());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    const v = typed.current.trim();
    if (v !== saved.current) {
      saved.current = v;
      saveRef.current(v);
    }
  };
  useEffect(() => () => flush(), []);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 6 }}>{label}</Text>
      <TextInput
        defaultValue={value || ""}
        onChangeText={(t) => {
          typed.current = t;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 600);
        }}
        onBlur={flush}
        placeholderTextColor={colors.placeholderText}
        style={{ backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontSize: 15 }}
        {...opts}
      />
    </View>
  );
};

/** Fine-tune the exact spot: the pin starts at the confirmed address; drag it or use where you are. Shown to customers on the Wiji map. */
const LocationPicker = ({
  value,
  onChange,
  colors,
}: {
  value?: { lat: number; lng: number };
  onChange: (p: { lat: number; lng: number }) => void;
  colors: any;
}) => {
  const [busy, setBusy] = useState(false);
  const mapRef = useRef<MapView>(null);

  // Follow the pin when the address changes
  useEffect(() => {
    if (value) mapRef.current?.animateToRegion({ latitude: value.lat, longitude: value.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }, 400);
  }, [value?.lat, value?.lng]);

  const set = (p: { lat: number; lng: number }) => {
    onChange(p);
    mapRef.current?.animateToRegion({ latitude: p.lat, longitude: p.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 });
  };

  const useHere = async () => {
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return Alert.alert("Location needed", "Allow location access, or search for your shop's address instead.");
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      set({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      Alert.alert("Couldn't get your location", "Search for your shop's address instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 4 }}>Exact spot on the map</Text>
      <Text style={{ color: colors.secondaryText, fontSize: 12, marginBottom: 8 }}>
        Customers see your shop here. The pin starts at your address: hold and drag it to your entrance, or stand at your shop and tap "Use where I am".
      </Text>
      <View style={{ height: 180, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: value ? colors.primary : colors.borderColor }}>
        <ThemedMapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          scrollEnabled={false}
          pitchEnabled={false}
          rotateEnabled={false}
          initialRegion={
            value
              ? { latitude: value.lat, longitude: value.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }
              : { latitude: -25.7479, longitude: 28.2293, latitudeDelta: 0.2, longitudeDelta: 0.2 }
          }
        >
          {value ? (
            <Marker
              draggable
              coordinate={{ latitude: value.lat, longitude: value.lng }}
              onDragEnd={(e) => onChange({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
              pinColor="#6C2BD9"
            />
          ) : null}
        </ThemedMapView>
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <TouchableOpacity
          onPress={useHere}
          disabled={busy}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 42, borderRadius: 10, backgroundColor: colors.cardHighlight }}
        >
          {busy ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="locate" size={18} color={colors.primary} />}
          <Text style={{ color: colors.primary, fontWeight: "700" }}>Use where I am</Text>
        </TouchableOpacity>
      </View>
      {value ? <Text style={{ color: colors.accent, fontSize: 12, marginTop: 6 }}>✓ Location set. Drag the pin to adjust.</Text> : null}
    </View>
  );
};

const BusinessVerificationScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [app, setApp] = useState<any | null | undefined>(undefined);
  const [payee, setPayee] = useState<any | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    const u1 = onSnapshot(doc(db, "business_verifications", user.uid), (s) => setApp(s.exists() ? s.data() : null), () => setApp(null));
    const u2 = onSnapshot(doc(db, "payees", user.uid), (s) => setPayee(s.exists() ? s.data() : null), () => setPayee(null));
    return () => {
      u1();
      u2();
    };
  }, [user?.uid]);

  if (app === undefined || payee === undefined) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  const status: string = app?.decision?.outcome === "changes_requested" && app?.status === "draft" ? "changes_requested" : app?.status || "not_started";
  const editable = !app || app.status === "draft";
  const d = app?.details || {};
  const docs = app?.documents || {};
  const hasPayout = !!payee?.subaccountCode;
  const problems = businessProblems(app, hasPayout);
  const st = STATUS_TEXT[status] || STATUS_TEXT.not_started;
  const toneColor = { good: colors.accent, info: colors.primary, warn: colors.warning, bad: colors.error }[st.tone];

  const saveDetail = (k: string) => (v: string) => saveBusinessDraft({ details: { [k]: v } }).catch((e) => Alert.alert("Couldn't save", e.message));

  const pick = async (meta: BizDocMeta, from: "camera" | "gallery" | "file") => {
    try {
      let uri: string | undefined;
      let mime = "image/jpeg";
      if (from === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return Alert.alert("Camera needed", "Allow camera access to take this photo.");
        const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
        if (r.canceled) return;
        uri = r.assets[0].uri;
      } else if (from === "gallery") {
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
        if (r.canceled) return;
        uri = r.assets[0].uri;
        mime = r.assets[0].mimeType || "image/jpeg";
      } else {
        const r = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], copyToCacheDirectory: true });
        if (r.canceled) return;
        const a = r.assets[0];
        if (a.size && a.size > 10 * 1024 * 1024) return Alert.alert("File too big", "Choose a file smaller than 10 MB, or take a photo instead.");
        uri = a.uri;
        mime = a.mimeType || ((a.name || uri).toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      }
      setBusy(meta.key);
      await uploadBusinessDoc(meta.key, uri, mime);
    } catch (e: any) {
      Alert.alert("Upload failed", e.message || "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy("submit");
    try {
      await submitBusiness();
      Alert.alert("Sent for verification", "The Wiji team will check your business, usually within 1–2 working days. We'll notify you.");
    } catch (e: any) {
      Alert.alert("Not quite ready", e.message);
    } finally {
      setBusy(null);
    }
  };

  const card = { backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 14 } as const;
  const smallBtn = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.cardHighlight,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8 }}>Business verification</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {/* Status */}
        <View style={[card, { borderColor: toneColor, flexDirection: "row", gap: 12 }]}>
          <Ionicons
            name={st.tone === "good" ? "shield-checkmark" : st.tone === "bad" ? "close-circle" : st.tone === "info" ? "time-outline" : "alert-circle-outline"}
            size={26}
            color={toneColor}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{st.title}</Text>
            <Text style={{ color: colors.secondaryText, fontSize: 14, marginTop: 2, lineHeight: 20 }}>{st.body}</Text>
            {app?.decision?.reason && ["changes_requested", "declined", "suspended"].includes(status) ? (
              <Text style={{ color: colors.text, fontSize: 14, marginTop: 8, lineHeight: 20 }}>“{app.decision.reason}”</Text>
            ) : null}
          </View>
        </View>

        {!hasPayout ? (
          <TouchableOpacity onPress={() => navigation.navigate("PayoutSetupScreen")} style={[card, { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 }]}>
            <Ionicons name="card-outline" size={22} color={colors.primary} />
            <Text style={{ color: colors.text, flex: 1, fontSize: 14 }}>First add the bank account your business gets paid into.</Text>
            <Text style={{ color: colors.primary, fontWeight: "700" }}>Set up</Text>
          </TouchableOpacity>
        ) : null}

        {editable ? (
          <>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 24, marginBottom: 12 }}>About the business</Text>
            <Field label="Business name (what customers see)" value={d.tradingName} onSave={saveDetail("tradingName")} colors={colors} placeholder="e.g. Mama Thandi's Kitchen" />
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 6 }}>Business type</Text>
            {BUSINESS_TYPES.map((t) => {
              const on = d.type === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => saveDetail("type")(t.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[card, { marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10, borderColor: on ? colors.primary : colors.borderColor, borderWidth: on ? 2 : 1 }]}
                >
                  <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.primary : colors.secondaryText} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{t.label}</Text>
                    <Text style={{ color: colors.secondaryText, fontSize: 12 }}>{t.help}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <View style={{ height: 6 }} />
            {needsRegistration(d.type) ? (
              <Field label="CIPC registration number" value={d.cipcNumber} onSave={saveDetail("cipcNumber")} colors={colors} placeholder="e.g. 2019/123456/07" keyboardType="numbers-and-punctuation" />
            ) : null}
            <Field label="What do you sell?" value={d.category} onSave={saveDetail("category")} colors={colors} placeholder="e.g. Food, hair salon, groceries, taxi rank stall" />
            <AddressInput
              label="Business address"
              value={d.addressVerified && Number.isFinite(d.location?.lat) ? { address: d.address, lat: d.location.lat, lng: d.location.lng } : null}
              initialQuery={d.addressVerified ? undefined : d.address}
              onChange={(v) =>
                saveBusinessDraft({ details: { address: v.address, addressVerified: true, location: { lat: v.lat, lng: v.lng } } }).catch((e) => Alert.alert("Couldn't save", e.message))
              }
              help="Choose your address from the suggestions so customers and Wiji can find you."
            />
            <LocationPicker
              value={Number.isFinite(d.location?.lat) ? d.location : undefined}
              onChange={(p) => saveBusinessDraft({ details: { location: { lat: p.lat, lng: p.lng } } }).catch((e) => Alert.alert("Couldn't save", e.message))}
              colors={colors}
            />
            <Field label="Owner's full name (as on ID)" value={d.ownerName} onSave={saveDetail("ownerName")} colors={colors} placeholder="e.g. Thandi Nkosi" autoCapitalize="words" />
            <Field label="Contact number" value={d.phone} onSave={saveDetail("phone")} colors={colors} placeholder="e.g. 082 123 4567" keyboardType="phone-pad" />

            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 12, marginBottom: 12 }}>Documents</Text>
            {BUSINESS_DOCS.filter((m) => m.key !== "registration" || needsRegistration(d.type)).map((m) => {
              const done = !!docs[m.key]?.path;
              return (
                <View key={m.key} style={[card, { marginBottom: 12 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={22} color={done ? colors.accent : colors.secondaryText} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{m.label}</Text>
                      <Text style={{ color: colors.secondaryText, fontSize: 12 }}>{m.help}</Text>
                    </View>
                    {busy === m.key ? <ActivityIndicator color={colors.primary} /> : null}
                  </View>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                    <TouchableOpacity style={smallBtn} onPress={() => pick(m, "camera")} disabled={!!busy}>
                      <Ionicons name="camera-outline" size={18} color={colors.primary} />
                      <Text style={{ color: colors.primary, fontWeight: "700" }}>{done ? "Retake" : "Take photo"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={smallBtn}
                      disabled={!!busy}
                      onPress={() =>
                        Alert.alert(`Upload ${m.label.toLowerCase()}`, "Where is the document?", [
                          { text: "Photo in my gallery", onPress: () => pick(m, "gallery") },
                          { text: "PDF or other file", onPress: () => pick(m, "file") },
                          { text: "Cancel", style: "cancel" },
                        ])
                      }
                    >
                      <Ionicons name="document-attach-outline" size={18} color={colors.primary} />
                      <Text style={{ color: colors.primary, fontWeight: "700" }}>Upload file</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            {problems.length ? (
              <View style={[card, { borderColor: colors.warning, marginTop: 8 }]}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15, marginBottom: 6 }}>Still needed</Text>
                {problems.map((p) => (
                  <Text key={p} style={{ color: colors.text, fontSize: 14, lineHeight: 22 }}>• {p}</Text>
                ))}
              </View>
            ) : null}
            <Text style={{ color: colors.secondaryText, fontSize: 13, lineHeight: 19, marginTop: 12 }}>
              Your ID and documents are only seen by you and the Wiji team. Customers see your business name and that it's verified.
            </Text>
            <TouchableOpacity
              onPress={submit}
              disabled={!!problems.length || !!busy}
              style={{ marginTop: 16, height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: problems.length ? colors.borderColor : colors.primary }}
            >
              {busy === "submit" ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}>Send for verification</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <View style={[card, { marginTop: 16 }]}>
            <Text style={{ color: colors.secondaryText, fontSize: 13 }}>BUSINESS</Text>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 2 }}>{d.tradingName}</Text>
            <Text style={{ color: colors.secondaryText, fontSize: 14, marginTop: 4 }}>
              {BUSINESS_TYPES.find((t) => t.key === d.type)?.label}
              {d.category ? ` · ${d.category}` : ""}
            </Text>
            <Text style={{ color: colors.secondaryText, fontSize: 14, marginTop: 2 }}>{d.address}</Text>
            {status === "verified" ? (
              <TouchableOpacity
                onPress={() => navigation.replace("BusinessDashboardScreen")}
                style={{ marginTop: 14, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
              >
                <Ionicons name="storefront" size={20} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Open my shop</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default BusinessVerificationScreen;
