// Report a problem with a trip. Confidential; serious reports pause the driver while the safety team investigates.
import React, { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useTheme } from "../context/ThemeContext";
import { RootStackParamList } from "../../types";
import { EMERGENCY_NUMBERS, callNumber, reportIncident } from "../../services/rides";

type Route = RouteProp<RootStackParamList, "IncidentReportScreen">;

const CATEGORIES = [
  { key: "sexual_misconduct", label: "Sexual harassment or assault", note: "Handled confidentially by specially trained staff" },
  { key: "threats_violence", label: "Threats or violence" },
  { key: "unsafe_driving", label: "Unsafe, drunk or reckless driving" },
  { key: "driver_mismatch", label: "Driver or car didn't match the app" },
  { key: "route_fare", label: "Route or fare problem" },
  { key: "rudeness", label: "Rude or unprofessional behaviour" },
  { key: "passenger_conduct", label: "Problem with a passenger (drivers)" },
  { key: "other", label: "Something else" },
];

const IncidentReportScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { rideId } = useRoute<Route>().params;
  const [category, setCategory] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ severity: number } | null>(null);

  const submit = async () => {
    if (!category) return;
    setSending(true);
    try {
      const r = await reportIncident(rideId, category, text);
      setDone({ severity: r.severity });
    } catch (e: any) {
      Alert.alert("Couldn't send your report", e.message);
    } finally {
      setSending(false);
    }
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
      <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8 }}>Report a problem</Text>
    </View>
  );

  const support = (
    <View style={{ marginTop: 20, backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 14 }}>
      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>Support, any time</Text>
      <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
        You can also get help from a Thuthuzela Care Centre if you've been sexually assaulted, and open a case with SAPS. If you choose to, Wiji will give the police the trip records they need.
      </Text>
      {EMERGENCY_NUMBERS.map((n) => (
        <TouchableOpacity key={n.number} onPress={() => callNumber(n.number)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 }}>
          <Ionicons name="call-outline" size={18} color={colors.primary} />
          <Text style={{ color: colors.text, flex: 1, fontSize: 14 }}>{n.label}</Text>
          <Text style={{ color: colors.primary, fontWeight: "800" }}>{n.number === "0800428428" ? "0800 428 428" : n.number}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (done) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Ionicons name="shield-checkmark" size={44} color={colors.accent} />
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800", marginTop: 10 }}>Thank you for telling us</Text>
          <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 8 }}>
            {done.severity <= 2
              ? "This is a serious report. The safety team will contact you within an hour, and the driver's account is paused while we investigate."
              : "The safety team will look into it and get back to you within 24 hours."}
          </Text>
          <Text style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20, marginTop: 8 }}>
            Your report is confidential. The other person is told what is alleged so they can respond fairly, but never gets your contact details.
          </Text>
          {support}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.secondaryText, fontSize: 15, lineHeight: 22, marginBottom: 12 }}>
          What happened? Reports are confidential and read by the Wiji safety team.
        </Text>
        {CATEGORIES.map((c) => {
          const on = category === c.key;
          return (
            <TouchableOpacity
              key={c.key}
              onPress={() => setCategory(c.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                padding: 14,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: on ? colors.primary : colors.borderColor,
                backgroundColor: on ? colors.cardHighlight : colors.cardBackground,
                marginBottom: 8,
              }}
            >
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.primary : colors.secondaryText} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>{c.label}</Text>
                {c.note ? <Text style={{ color: colors.secondaryText, fontSize: 12 }}>{c.note}</Text> : null}
              </View>
            </TouchableOpacity>
          );
        })}
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Tell us what happened, in your own words"
          placeholderTextColor={colors.placeholderText}
          multiline
          style={{ marginTop: 10, minHeight: 120, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 14, padding: 12, color: colors.text, fontSize: 15, textAlignVertical: "top" }}
        />
        <TouchableOpacity
          onPress={submit}
          disabled={!category || text.trim().length < 10 || sending}
          style={{
            marginTop: 16,
            height: 54,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: category && text.trim().length >= 10 ? colors.primary : colors.borderColor,
          }}
        >
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Send report</Text>}
        </TouchableOpacity>
        {support}
      </ScrollView>
    </SafeAreaView>
  );
};

export default IncidentReportScreen;
