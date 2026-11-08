// Profile in "Promoter" mode: apply to be a Wiji promoter, follow the application, or (once approved)
// share your code and see what you've earned.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { PROGRAM, summarise, zar } from "../../services/affiliates";
import { sharePromoterLink } from "./PromoterScreen";

const APP_TEXT: Record<string, { title: string; body: string; button: string; icon: any }> = {
  none: {
    title: "Promote Wiji and earn",
    body: `Get your own code and link. When people you bring in pay or get paid in Wiji, you earn ${PROGRAM.rate}% of Wiji's fee. Nothing to pay, no stock to sell.`,
    button: "Apply to be a promoter",
    icon: "megaphone",
  },
  pending: { title: "Application sent", body: "The Wiji team is checking it. We'll notify you in the app.", button: "View my application", icon: "time-outline" },
  declined: { title: "Application not approved", body: "See the reason and apply again.", button: "View my application", icon: "close-circle-outline" },
};

const PromoterProfilePanel = ({ uid, colors }: { uid: string; colors: any }) => {
  const navigation = useNavigation<any>();
  const [aff, setAff] = useState<any | null | undefined>(undefined);
  const [entries, setEntries] = useState<any[]>([]);
  const [payee, setPayee] = useState<any | null>(null);
  const active = aff?.status === "approved" || aff?.status === "frozen";

  useEffect(() => {
    const u1 = onSnapshot(doc(db, "affiliates", uid), (s) => setAff(s.exists() ? s.data() : null), () => setAff(null));
    const u2 = onSnapshot(doc(db, "payees", uid), (s) => setPayee(s.exists() ? s.data() : null), () => setPayee(null));
    return () => { u1(); u2(); };
  }, [uid]);
  useEffect(() => {
    if (!active) return;
    return onSnapshot(query(collection(db, "affiliateLedger"), where("affiliateUid", "==", uid)),
      (s) => setEntries(s.docs.map((d) => d.data())), () => setEntries([]));
  }, [uid, active]);

  if (aff === undefined) return <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} />;
  const card = { backgroundColor: colors.cardBackground || colors.background, borderRadius: 18, borderWidth: 1, borderColor: colors.borderColor, padding: 16, marginBottom: 14 } as const;
  const muted = colors.secondaryText || colors.textSecondary;
  const open = () => navigation.navigate("PromoterScreen");

  // Not a promoter yet: the application
  if (!active) {
    const t = APP_TEXT[aff?.status || "none"] || APP_TEXT.none;
    return (
      <View style={card}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.cardHighlight || colors.borderColor, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={t.icon} size={28} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>{t.title}</Text>
            <Text style={{ color: muted, fontSize: 13, marginTop: 2, lineHeight: 18 }}>{t.body}</Text>
          </View>
        </View>
        {aff?.status === "declined" && aff?.decision?.reason ? <Text style={{ color: colors.text, marginTop: 10 }}>“{aff.decision.reason}”</Text> : null}
        <TouchableOpacity onPress={open} style={{ marginTop: 14, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{t.button}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const t = summarise(entries);
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
          <Ionicons name={aff.status === "frozen" ? "pause-circle" : "megaphone"} size={18} color={aff.status === "frozen" ? colors.warning : colors.accent} />
          <Text style={{ color: colors.text, fontWeight: "800" }}>{aff.status === "frozen" ? "Promoter account paused" : "Wiji promoter"}</Text>
        </View>
        {aff.status === "frozen" ? <Text style={{ color: muted, marginTop: 4 }}>{aff.decision?.reason || "Earnings are on hold while the Wiji team checks something."}</Text> : null}
        {aff.payoutHold ? <Text style={{ color: colors.warning, marginTop: 4 }}>Automatic payouts are paused. Check your bank details under Payouts, or contact Wiji.</Text> : null}
        <Text selectable style={{ color: colors.text, fontSize: 30, fontWeight: "800", letterSpacing: 2, marginTop: 10 }}>{aff.code}</Text>
        <View style={{ flexDirection: "row", gap: 24, marginTop: 8 }}>
          <View>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}>{aff.stats?.signups || 0}</Text>
            <Text style={{ color: muted, fontSize: 12 }}>sign-ups</Text>
          </View>
          <View>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}>{zar(t.ready + t.waiting + t.paying)}</Text>
            <Text style={{ color: muted, fontSize: 12 }}>earned, not paid yet</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => sharePromoterLink(aff.code)}
          style={{ marginTop: 14, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
        >
          <Ionicons name="share-social" size={20} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Share my link</Text>
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
        {action("stats-chart-outline", "Earnings", open, `${zar(t.paid)} paid so far`)}
        {action("card-outline", "Payouts", () => navigation.navigate("PayoutSetupScreen"), payee ? `${payee.bankName || "Bank"} ••• ${payee.accountLast4}` : "Add your bank account")}
      </View>
    </View>
  );
};

export default PromoterProfilePanel;
