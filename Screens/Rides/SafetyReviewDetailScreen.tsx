// Safety team only: review one driver application — see documents, record each check, then decide.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { doc, onSnapshot } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { db, storage } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import createStyles from "../context/appStyles";
import { RootStackParamList } from "../../types";
import { CHECK_LABELS, CHECK_ORDER, PERSONAL_DOCS, VEHICLE_DOCS, reviewApplication } from "../../services/drivers";

type Route = RouteProp<RootStackParamList, "SafetyReviewDetailScreen">;

/** Which documents a reviewer should look at for each check. */
const CHECK_DOCS: Record<string, string[]> = {
  identity: ["idDocument", "selfie"],
  licence: ["licence"],
  prdp: ["prdp"],
  criminalRecord: [],
  vehicle: ["licenceDisc", "roadworthy", "carFront", "carBack", "carLeft", "carRight"],
  insurance: ["insurance"],
  operatingLicence: ["operatingLicence"],
};

const DocPreview = ({ path, contentType, label, expiry, colors }: any) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (path) getDownloadURL(ref(storage, path)).then(setUrl).catch(() => setUrl(null));
  }, [path]);
  const isPdf = contentType === "application/pdf";
  return (
    <TouchableOpacity
      onPress={() => url && Linking.openURL(url)}
      style={{ width: "48%", marginBottom: 12 }}
      accessibilityLabel={`Open ${label}`}
    >
      <View style={{ height: 110, borderRadius: 12, backgroundColor: colors.cardHighlight, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
        {!path ? (
          <Text style={{ color: colors.error, fontSize: 12 }}>Missing</Text>
        ) : !url ? (
          <ActivityIndicator color={colors.primary} />
        ) : isPdf ? (
          <Ionicons name="document-text-outline" size={36} color={colors.primary} />
        ) : (
          <Image source={{ uri: url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        )}
      </View>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 4 }} numberOfLines={1}>{label}</Text>
      {expiry ? <Text style={{ color: colors.secondaryText, fontSize: 12 }}>Expires {expiry}</Text> : null}
    </TouchableOpacity>
  );
};

const SafetyReviewDetailScreen = () => {
  const { colors } = useTheme();
  const globalStyles = createStyles(colors).global;
  const navigation = useNavigation();
  const { uid } = useRoute<Route>().params;
  const [app, setApp] = useState<any | null | undefined>(undefined);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        doc(db, "driver_applications", uid),
        (s) => setApp(s.exists() ? s.data() : null),
        () => setApp(null)
      ),
    [uid]
  );

  const run = async (key: string, fn: () => Promise<any>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) Alert.alert("Done", done, [{ text: "OK", onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message);
    } finally {
      setBusy(null);
    }
  };

  const confirm = (title: string, message: string, onYes: () => void) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: "destructive", onPress: onYes },
    ]);

  if (app === undefined) {
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }
  if (!app) {
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        <Text style={{ color: colors.text, padding: 24 }}>Application not found, or you don't have access.</Text>
      </SafeAreaView>
    );
  }

  const docs = app.documents || {};
  const allDocs = [...PERSONAL_DOCS, ...VEHICLE_DOCS];
  const allPassed = CHECK_ORDER.every((c) => app.checks?.[c]?.result === "passed");
  const card = { backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 14, marginBottom: 16 } as const;
  const h = { color: colors.text, fontSize: 16, fontWeight: "700" as const, marginBottom: 8 };
  const row = (k: string, v: any) => (
    <View key={k} style={{ flexDirection: "row", paddingVertical: 4 }}>
      <Text style={{ color: colors.secondaryText, width: 110, fontSize: 14 }}>{k}</Text>
      <Text style={{ color: colors.text, flex: 1, fontSize: 14 }} selectable>{v || "—"}</Text>
    </View>
  );

  return (
    <SafeAreaView style={globalStyles.safeArea}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8, flex: 1 }} numberOfLines={1}>
          {app.personal?.fullName || "Application"}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {app.reverify ? (
          <View style={[card, { borderWidth: 1.5, borderColor: colors.warning, marginBottom: 12 }]}>
            <Text style={h}>Re-verification</Text>
            <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
              {app.changedDocs?.length
                ? `Changed: ${app.changedDocs.map((k: string) => (k === "vehicle" ? "car details" : k)).join(", ")}. Checks marked "passed before" don't depend on anything that changed.`
                : "The driver is still updating their documents."}{" "}
              Declining pauses their driver account; asking for changes doesn't.
            </Text>
          </View>
        ) : null}
        <View style={card}>
          <Text style={h}>Applicant</Text>
          {row("Name", app.personal?.fullName)}
          {row(app.personal?.idType === "passport" ? "Passport" : "SA ID", app.personal?.idNumber)}
          {row("Phone", app.personal?.phone)}
          {row("Area", app.personal?.homeArea)}
          {row("Induction", app.induction?.passed ? "Passed" : "Not done")}
        </View>
        <View style={card}>
          <Text style={h}>Vehicle</Text>
          {row("Car", `${app.vehicle?.year || ""} ${app.vehicle?.make || ""} ${app.vehicle?.model || ""}`.trim())}
          {row("Colour", app.vehicle?.colour)}
          {row("Plate", app.vehicle?.plate)}
        </View>

        <Text style={[h, { fontSize: 18 }]}>Checks</Text>
        <Text style={{ color: colors.secondaryText, fontSize: 13, marginBottom: 12 }}>
          Mark each check after you've verified it. A failed check needs a note explaining why.
        </Text>
        {CHECK_ORDER.map((c) => {
          const r = app.checks?.[c]?.result || "pending";
          return (
            <View key={c} style={card}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons
                  name={r === "passed" ? "checkmark-circle" : r === "failed" ? "close-circle" : "time-outline"}
                  size={22}
                  color={r === "passed" ? colors.accent : r === "failed" ? colors.error : colors.secondaryText}
                />
                <Text style={[h, { marginBottom: 0, flex: 1 }]}>{CHECK_LABELS[c]}</Text>
              </View>
              {c === "criminalRecord" ? (
                <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 8 }}>
                  Run the check through the background-screening provider using the ID above, then record the result here.
                </Text>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 10 }}>
                  {CHECK_DOCS[c].map((k) => {
                    const meta = allDocs.find((m) => m.key === k);
                    return <DocPreview key={k} path={docs[k]?.path} contentType={docs[k]?.contentType} expiry={docs[k]?.expiry} label={meta?.label || k} colors={colors} />;
                  })}
                </View>
              )}
              {app.checks?.[c]?.carriedOver && r === "passed" ? <Text style={{ color: colors.secondaryText, fontSize: 12, marginTop: 4 }}>Passed before. Nothing it depends on changed.</Text> : null}
              {app.checks?.[c]?.note ? <Text style={{ color: colors.text, fontSize: 13, marginTop: 6 }}>Note: {app.checks[c].note}</Text> : null}
              <TextInput
                value={notes[c] || ""}
                onChangeText={(t) => setNotes({ ...notes, [c]: t })}
                placeholder="Note (required if failing)"
                placeholderTextColor={colors.placeholderText}
                style={{ marginTop: 10, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, minHeight: 42, color: colors.text }}
                multiline
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                {(["passed", "failed"] as const).map((res) => (
                  <TouchableOpacity
                    key={res}
                    disabled={!!busy}
                    onPress={() => run(`${c}-${res}`, () => reviewApplication({ uid, action: "setCheck", check: c, result: res, note: notes[c] }))}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 10,
                      alignItems: "center",
                      backgroundColor: res === "passed" ? colors.accent : colors.cardHighlight,
                      borderWidth: res === "failed" ? 1 : 0,
                      borderColor: colors.error,
                    }}
                  >
                    {busy === `${c}-${res}` ? (
                      <ActivityIndicator color={res === "passed" ? "#fff" : colors.error} />
                    ) : (
                      <Text style={{ color: res === "passed" ? "#fff" : colors.error, fontWeight: "700" }}>{res === "passed" ? "Pass" : "Fail"}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}

        <Text style={[h, { fontSize: 18 }]}>Decision</Text>
        <TouchableOpacity
          disabled={!allPassed || !!busy}
          onPress={() =>
            confirm("Approve this driver?", "Their verified profile goes live and they can start driving.", () =>
              run("approve", () => reviewApplication({ uid, action: "approve" }), "Driver approved.")
            )
          }
          style={{ height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: allPassed ? colors.primary : colors.borderColor }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{allPassed ? "Approve driver" : "Approve (all checks must pass)"}</Text>
        </TouchableOpacity>

        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Reason shown to the applicant (for changes or decline)"
          placeholderTextColor={colors.placeholderText}
          style={{ marginTop: 16, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 80, color: colors.text, textAlignVertical: "top" }}
          multiline
        />
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <TouchableOpacity
            disabled={reason.trim().length < 10 || !!busy}
            onPress={() => run("changes", () => reviewApplication({ uid, action: "requestChanges", reason }), "The applicant was asked to make changes.")}
            style={{ flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cardHighlight, opacity: reason.trim().length < 10 ? 0.5 : 1 }}
          >
            <Text style={{ color: colors.primary, fontWeight: "700" }}>Request changes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={reason.trim().length < 10 || !!busy}
            onPress={() =>
              confirm("Decline this application?", "The applicant will see your reason in general terms and can ask for a review.", () =>
                run("decline", () => reviewApplication({ uid, action: "decline", reason }), "Application declined.")
              )
            }
            style={{ flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.error, opacity: reason.trim().length < 10 ? 0.5 : 1 }}
          >
            <Text style={{ color: colors.error, fontWeight: "700" }}>Decline</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default SafetyReviewDetailScreen;
