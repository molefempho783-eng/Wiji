// Profile in "Driver" mode: apply to drive, follow the application, or (once verified)
// see your rating and trips and open driver mode.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { driverStatsText } from "../../services/rides";

const APP_TEXT: Record<string, { title: string; body: string; button: string }> = {
  none: {
    title: "Drive with Wiji",
    body: "Earn on your own time. Apply with your ID, driver's licence, PrDP and car papers. The Wiji safety team checks everything before you can take rides.",
    button: "Apply to drive",
  },
  draft: { title: "Finish your application", body: "Pick up where you left off. Your details are saved as you go.", button: "Continue application" },
  submitted: { title: "Application sent", body: "The Wiji safety team will check your documents. We'll notify you in the app.", button: "View my application" },
  in_review: { title: "Being checked", body: "The Wiji safety team is checking your documents now. We'll notify you in the app.", button: "View my application" },
  declined: { title: "Application not approved", body: "See the reason and what you can do next.", button: "View my application" },
};

const DriverProfilePanel = ({ uid, colors }: { uid: string; colors: any }) => {
  const navigation = useNavigation<any>();
  const [driver, setDriver] = useState<any | null | undefined>(undefined);
  const [app, setApp] = useState<any | null | undefined>(undefined);
  const [payee, setPayee] = useState<any | null>(null);

  useEffect(() => {
    const u1 = onSnapshot(doc(db, "drivers", uid), (s) => setDriver(s.exists() ? s.data() : null), () => setDriver(null));
    const u2 = onSnapshot(doc(db, "driver_applications", uid), (s) => setApp(s.exists() ? s.data() : null), () => setApp(null));
    const u3 = onSnapshot(doc(db, "payees", uid), (s) => setPayee(s.exists() ? s.data() : null), () => setPayee(null));
    return () => [u1, u2, u3].forEach((u) => u());
  }, [uid]);

  if (driver === undefined || app === undefined) return <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} />;
  const card = { backgroundColor: colors.cardBackground || colors.background, borderRadius: 18, borderWidth: 1, borderColor: colors.borderColor, padding: 16, marginBottom: 14 } as const;
  const muted = colors.secondaryText || colors.textSecondary;

  // Not a driver yet: the application
  if (!driver) {
    const t = APP_TEXT[app?.status || "none"] || APP_TEXT.none;
    return (
      <View style={card}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.cardHighlight || colors.borderColor, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={app?.status === "submitted" || app?.status === "in_review" ? "time-outline" : "car-sport"} size={28} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>{t.title}</Text>
            <Text style={{ color: muted, fontSize: 13, marginTop: 2, lineHeight: 18 }}>{t.body}</Text>
          </View>
        </View>
        {app?.decision?.reason && app?.status !== "submitted" && app?.status !== "in_review" ? (
          <Text style={{ color: colors.text, marginTop: 10 }}>“{app.decision.reason}”</Text>
        ) : null}
        <TouchableOpacity
          onPress={() => navigation.navigate("DriverApplicationScreen")}
          style={{ marginTop: 14, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{t.button}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const paused = driver.status !== "active";
  // Soonest document expiry (from the verified profile), for the "My documents" tile
  const today = new Date().toISOString().slice(0, 10);
  const soonest = Object.entries({ ...(driver.docExpiries || {}), ...(driver.nextCheckDue ? { annualRecheck: driver.nextCheckDue } : {}) })
    .map(([k, d]) => ({ k, days: Math.round((Date.parse(String(d)) - Date.parse(today)) / 864e5) }))
    .sort((a, b) => a.days - b.days)[0];
  const updating = app?.reverify && ["draft", "submitted", "in_review"].includes(app?.status);
  const docsSub = updating
    ? app.status === "draft" ? "Update not sent yet" : "Update being checked"
    : soonest && soonest.days < 0
    ? "Something expired. Update now"
    : soonest && soonest.days <= 30
    ? `Something expires in ${soonest.days} day${soonest.days === 1 ? "" : "s"}`
    : "Licence, PrDP, car papers";
  const action = (icon: any, label: string, onPress: () => void, sub?: string) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      style={{ width: "48%", padding: 14, borderRadius: 16, backgroundColor: colors.cardHighlight || colors.borderColor, marginBottom: 10 }}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={24} color={colors.primary} />
      <Text style={{ color: colors.text, fontWeight: "800", marginTop: 8 }}>{label}</Text>
      {sub ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{sub}</Text> : null}
    </TouchableOpacity>
  );

  return (
    <View>
      <View style={card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="shield-checkmark" size={18} color={colors.accent} />
          <Text style={{ color: colors.text, fontWeight: "800" }}>{paused ? "Driver account paused" : "Verified Wiji driver"}</Text>
        </View>
        {paused ? <Text style={{ color: muted, marginTop: 4 }}>{driver.suspendedReason || driver.pausedReason || "Contact the Wiji safety team for details."}</Text> : null}
        {paused && driver.pausedForExpiry ? (
          <TouchableOpacity
            onPress={() => navigation.navigate("DriverApplicationScreen")}
            style={{ marginTop: 10, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.primary, fontWeight: "800" }}>Upload renewed documents</Text>
          </TouchableOpacity>
        ) : null}
        <View style={{ flexDirection: "row", gap: 24, marginTop: 12 }}>
          <View>
            <Text style={{ color: colors.text, fontSize: 28, fontWeight: "800" }}>{driver.ratingCount ? `★ ${Number(driver.ratingAvg || 0).toFixed(1)}` : "★ —"}</Text>
            <Text style={{ color: muted, fontSize: 12 }}>{driver.ratingCount ? `${driver.ratingCount} rating${driver.ratingCount === 1 ? "" : "s"}` : "No ratings yet"}</Text>
          </View>
          <View>
            <Text style={{ color: colors.text, fontSize: 28, fontWeight: "800" }}>{driver.trips || 0}</Text>
            <Text style={{ color: muted, fontSize: 12 }}>trips</Text>
          </View>
        </View>
        <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>Shown to passengers: {driverStatsText(driver)}</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate("DriverHomeScreen")}
          style={{ marginTop: 14, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
        >
          <Ionicons name="car" size={20} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Open driver mode</Text>
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
        {action("cash-outline", "Earnings", () => navigation.navigate("Tabs", { screen: "WalletScreen" }))}
        {action("card-outline", "Payouts", () => navigation.navigate("PayoutSetupScreen"), payee ? `${payee.bankName || "Bank"} ••• ${payee.accountLast4}` : "Add your bank account")}
        {action(soonest && soonest.days <= 30 && !updating ? "warning-outline" : "document-text-outline", "My documents", () => navigation.navigate("DriverApplicationScreen"), docsSub)}
        {action("people-outline", "Trusted friends", () => navigation.navigate("TrustedContactsScreen"), "Who can follow your trips")}
      </View>
    </View>
  );
};

export default DriverProfilePanel;
