// After a trip: rate the driver 1–5 stars, with quick tags and an optional comment. Saved once per trip.
import React, { useState } from "react";
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "../Screens/context/ThemeContext";
import { RATING_TAGS, rateRide } from "../services/rides";

const LABELS = ["", "Very bad", "Not great", "Okay", "Good", "Excellent"];

export default function RateTrip({ rideId, driverName, existing }: { rideId: string; driverName: string; existing?: { stars: number; tags?: string[] } | null }) {
  const { colors } = useTheme();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const muted = colors.secondaryText || colors.textSecondary;

  if (existing?.stars) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>You rated {driverName}</Text>
        <Text style={{ color: "#F5A623", fontSize: 16 }}>{"★".repeat(existing.stars)}<Text style={{ color: colors.borderColor }}>{"★".repeat(5 - existing.stars)}</Text></Text>
      </View>
    );
  }

  const choices = stars >= 4 ? RATING_TAGS.good : stars > 0 ? RATING_TAGS.bad : [];
  const submit = async () => {
    if (!stars) return;
    setBusy(true);
    try {
      await rateRide(rideId, stars, tags, comment);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e: any) {
      Alert.alert("Couldn't save your rating", e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.borderColor }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>How was your trip with {driverName}?</Text>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }} accessibilityRole="adjustable" accessibilityLabel={`Rating: ${stars} of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity
            key={n}
            onPress={() => {
              Haptics.selectionAsync().catch(() => undefined);
              if ((n >= 4) !== (stars >= 4)) setTags([]);
              setStars(n);
            }}
            accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}
            hitSlop={6}
          >
            <Ionicons name={n <= stars ? "star" : "star-outline"} size={36} color={n <= stars ? "#F5A623" : muted} />
          </TouchableOpacity>
        ))}
      </View>
      {stars ? <Text style={{ color: muted, marginTop: 4 }}>{LABELS[stars]}</Text> : <Text style={{ color: muted, marginTop: 4 }}>Tap a star. Your name isn't shown to the driver.</Text>}

      {choices.length ? (
        <>
          <Text style={{ color: colors.text, fontWeight: "700", marginTop: 12 }}>{stars >= 4 ? "What went well?" : "What went wrong?"}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {choices.map((t) => {
              const on = tags.includes(t);
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: on ? colors.primary : colors.borderColor, backgroundColor: on ? colors.primary : "transparent" }}
                >
                  <Text style={{ color: on ? "#fff" : colors.text, fontWeight: "600", fontSize: 13 }}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Anything else? (optional)"
            placeholderTextColor={colors.placeholderText}
            maxLength={300}
            multiline
            style={{ marginTop: 10, minHeight: 60, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.inputBg, borderRadius: 12, padding: 10, color: colors.text, textAlignVertical: "top" }}
          />
          {stars <= 2 ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>Low ratings are checked by the Wiji safety team. If something serious happened, also tap "Report a problem".</Text> : null}
          <TouchableOpacity
            onPress={submit}
            disabled={busy}
            style={{ marginTop: 12, height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Submit rating</Text>}
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
}
