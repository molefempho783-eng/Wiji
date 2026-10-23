// Address field that only accepts real places: the user picks one of the predicted addresses
// (Google Places, or OpenStreetMap as a fallback) or uses where they are. Free text is never saved.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useTheme } from "../Screens/context/ThemeContext";
import { PlaceKind, PlaceSuggestion, newSearchSession, resolvePlace, searchPlaces } from "../services/places";

export type VerifiedAddress = { address: string; lat: number; lng: number };

type Props = {
  label: string;
  value: VerifiedAddress | null;
  onChange: (v: VerifiedAddress) => void;
  placeholder?: string;
  /** Rank suggestions near here */
  near?: { lat: number; lng: number } | null;
  /** "area" = suburbs, towns and cities only */
  kind?: PlaceKind;
  allowCurrentLocation?: boolean;
  /** Text to start searching with, e.g. an old typed address that was never confirmed */
  initialQuery?: string;
  help?: string;
};

async function describeHere(lat: number, lng: number, kind: PlaceKind) {
  const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
  if (!a) return null;
  const area = [a.district || a.subregion, a.city].filter((v, i, arr) => v && arr.indexOf(v) === i);
  if (kind === "area") return area.join(", ") || null;
  const street = [a.streetNumber, a.street].filter(Boolean).join(" ") || a.name;
  return [street, ...area, a.postalCode].filter(Boolean).join(", ") || null;
}

export default function AddressInput({ label, value, onChange, placeholder, near, kind = "any", allowCurrentLocation = true, initialQuery, help }: Props) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState(!value);
  const [q, setQ] = useState(value ? "" : initialQuery || "");
  const [sugs, setSugs] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState<"here" | "pick" | null>(null);
  const session = useRef(newSearchSession());
  const seq = useRef(0);
  const muted = colors.secondaryText || colors.textSecondary;

  useEffect(() => {
    if (!value) setEditing(true);
  }, [value]);

  useEffect(() => {
    if (!editing) return;
    const t = q.trim();
    const my = ++seq.current;
    setSearched(false);
    if (t.length < 2) {
      setSugs([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const h = setTimeout(async () => {
      const r = await searchPlaces(t, session.current, near || undefined, kind);
      if (my !== seq.current) return;
      setSugs(r);
      setSearching(false);
      setSearched(true);
    }, 300);
    return () => clearTimeout(h);
  }, [q, editing]);

  const done = (v: VerifiedAddress) => {
    onChange(v);
    setEditing(false);
    setQ("");
    setSugs([]);
  };

  const pick = async (s: PlaceSuggestion) => {
    seq.current++;
    setBusy("pick");
    try {
      const p = await resolvePlace(s, session.current);
      session.current = newSearchSession();
      if (!p) return Alert.alert("Couldn't load that place", "Try another suggestion.");
      done({ address: kind === "area" ? [s.title, s.subtitle.split(",")[0]].filter(Boolean).join(", ") : p.address, lat: p.lat, lng: p.lng });
    } finally {
      setBusy(null);
    }
  };

  const useHere = async () => {
    setBusy("here");
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return Alert.alert("Location needed", "Allow location access, or search for the address instead.");
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const text = await describeHere(pos.coords.latitude, pos.coords.longitude, kind);
      if (!text) return Alert.alert("Couldn't find an address here", "Search for the address instead.");
      done({ address: text, lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      Alert.alert("Couldn't get your location", "Search for the address instead.");
    } finally {
      setBusy(null);
    }
  };

  const labelEl = <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 6 }}>{label}</Text>;

  // Confirmed
  if (value && !editing) {
    return (
      <View style={{ marginBottom: 14 }}>
        {labelEl}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.inputBg }}>
          <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "600" }}>{value.address}</Text>
            <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{kind === "area" ? "Confirmed area" : "Confirmed address"}</Text>
          </View>
          <TouchableOpacity onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel={`Change ${label}`} style={{ padding: 6 }}>
            <Text style={{ color: colors.primary, fontWeight: "800" }}>Change</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const typedButNotPicked = q.trim().length >= 2;
  return (
    <View style={{ marginBottom: 14 }}>
      {labelEl}
      <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: typedButNotPicked ? colors.primary : colors.inputBorder, backgroundColor: colors.inputBg, borderRadius: 12, paddingHorizontal: 12 }}>
        <Ionicons name="search" size={18} color={muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={placeholder || (kind === "area" ? "Search your suburb or town" : "Start typing the street address")}
          placeholderTextColor={colors.placeholderText}
          autoCorrect={false}
          style={{ flex: 1, minHeight: 48, color: colors.text, marginLeft: 8, fontSize: 15 }}
        />
        {searching || busy === "pick" ? <ActivityIndicator size="small" color={colors.primary} /> : q ? (
          <TouchableOpacity onPress={() => setQ("")} accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={20} color={muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {sugs.length ? (
        <View style={{ borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12, marginTop: 6, overflow: "hidden", backgroundColor: colors.inputBg }}>
          {sugs.map((s, i) => (
            <TouchableOpacity
              key={s.id}
              onPress={() => pick(s)}
              disabled={!!busy}
              style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingHorizontal: 12, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: colors.inputBorder }}
            >
              <Ionicons name={kind === "area" ? "map-outline" : "location-outline"} size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "700" }} numberOfLines={1}>{s.title}</Text>
                {s.subtitle ? <Text style={{ color: muted, fontSize: 12 }} numberOfLines={1}>{s.subtitle}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {allowCurrentLocation ? (
        <TouchableOpacity onPress={useHere} disabled={!!busy} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 }}>
          {busy === "here" ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="navigate" size={18} color={colors.primary} />}
          <Text style={{ color: colors.primary, fontWeight: "700" }}>{kind === "area" ? "Use the area I'm in now" : "Use where I am now"}</Text>
        </TouchableOpacity>
      ) : null}

      {searched && !sugs.length ? (
        <Text style={{ color: "#C62828", fontSize: 12, marginTop: 2 }}>
          {kind === "area" ? "We couldn't find that area. Check the spelling, e.g. \"Hatfield\"." : "We couldn't find that address. Try the street number and name with the suburb, e.g. \"123 Burnett St, Hatfield\"."}
        </Text>
      ) : typedButNotPicked && !searching ? (
        <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>Tap one of the suggestions to confirm it.</Text>
      ) : help ? (
        <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{help}</Text>
      ) : null}
      {value ? (
        <TouchableOpacity onPress={() => (setEditing(false), setQ(""))} style={{ paddingTop: 6 }}>
          <Text style={{ color: muted, fontSize: 12 }}>Keep “{value.address}”</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
