// Profile in "Business" mode: the shop's identity and everything a business owner manages,
// instead of the personal profile fields. Verification starts here too.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Switch, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { db, storage } from "../../firebaseConfig";
import { STATUS_TEXT } from "../../services/business";

const BusinessProfilePanel = ({ uid, colors }: { uid: string; colors: any }) => {
  const navigation = useNavigation<any>();
  const [verification, setVerification] = useState<any | null | undefined>(undefined);
  const [biz, setBiz] = useState<any | null | undefined>(undefined);
  const [payee, setPayee] = useState<any | null>(null);
  const [cover, setCover] = useState<string | null>(null);

  useEffect(() => {
    const u1 = onSnapshot(doc(db, "business_verifications", uid), (s) => setVerification(s.exists() ? s.data() : null), () => setVerification(null));
    const u2 = onSnapshot(doc(db, "businesses", uid), (s) => setBiz(s.exists() ? s.data() : null), () => setBiz(null));
    const u3 = onSnapshot(doc(db, "payees", uid), (s) => setPayee(s.exists() ? s.data() : null), () => setPayee(null));
    return () => [u1, u2, u3].forEach((u) => u());
  }, [uid]);

  useEffect(() => {
    if (biz?.coverPath) getDownloadURL(ref(storage, biz.coverPath)).then(setCover).catch(() => setCover(null));
  }, [biz?.coverPath]);

  if (verification === undefined || biz === undefined) return <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} />;

  const card = { backgroundColor: colors.cardBackground || colors.background, borderRadius: 18, borderWidth: 1, borderColor: colors.borderColor, padding: 16, marginBottom: 14 } as const;
  const status: string = verification?.decision?.outcome === "changes_requested" && verification?.status === "draft" ? "changes_requested" : verification?.status || "not_started";
  const live = !!biz?.active;

  // Not verified yet: explain and continue verification
  if (!live) {
    const st = STATUS_TEXT[status] || STATUS_TEXT.not_started;
    const waiting = ["submitted", "in_review"].includes(status);
    return (
      <View style={card}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.cardHighlight || colors.borderColor, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={waiting ? "time-outline" : status === "suspended" ? "pause-circle" : "storefront"} size={28} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>{verification?.details?.tradingName || st.title}</Text>
            <Text style={{ color: colors.secondaryText || colors.text, fontSize: 13, marginTop: 2, lineHeight: 18 }}>{st.body}</Text>
          </View>
        </View>
        {verification?.decision?.reason && ["changes_requested", "declined", "suspended"].includes(status) ? (
          <Text style={{ color: colors.text, marginTop: 10 }}>“{verification.decision.reason}”</Text>
        ) : null}
        <TouchableOpacity
          onPress={() => navigation.navigate("BusinessVerificationScreen")}
          style={{ marginTop: 14, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>
            {waiting ? "View my application" : status === "not_started" ? "Set up my business" : "Continue verification"}
          </Text>
        </TouchableOpacity>
        <Text style={{ color: colors.secondaryText || colors.text, fontSize: 12, marginTop: 10, lineHeight: 17 }}>
          Once Wiji verifies your business, it appears on the map and customers can order and pay in the app.
        </Text>
      </View>
    );
  }

  const action = (icon: any, label: string, onPress: () => void, badge?: string) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      style={{ width: "48%", padding: 14, borderRadius: 16, backgroundColor: colors.cardHighlight || colors.borderColor, marginBottom: 10 }}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={24} color={colors.primary} />
      <Text style={{ color: colors.text, fontWeight: "800", marginTop: 8 }}>{label}</Text>
      {badge ? <Text style={{ color: colors.secondaryText || colors.text, fontSize: 12, marginTop: 2 }}>{badge}</Text> : null}
    </TouchableOpacity>
  );

  return (
    <View>
      <View style={[card, { padding: 0, overflow: "hidden" }]}>
        <View style={{ height: 130, backgroundColor: colors.cardHighlight || colors.borderColor }}>
          {cover ? <Image source={{ uri: cover }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="storefront" size={44} color={colors.primary} />
            </View>
          )}
        </View>
        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", flexShrink: 1 }}>{biz.name}</Text>
            <Ionicons name="shield-checkmark" size={18} color={colors.accent} />
          </View>
          <Text style={{ color: colors.secondaryText || colors.text, fontSize: 13, marginTop: 2 }}>{[biz.category, biz.address].filter(Boolean).join(" · ")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "700" }}>{biz.isOpen !== false ? "Open: taking orders" : "Closed"}</Text>
              <Text style={{ color: colors.secondaryText || colors.text, fontSize: 12 }}>Customers can only order while you're open</Text>
            </View>
            <Switch
              value={biz.isOpen !== false}
              onValueChange={(v) => updateDoc(doc(db, "businesses", uid), { isOpen: v, updatedAt: serverTimestamp() })}
              trackColor={{ false: colors.borderColor, true: colors.primary }}
              thumbColor="#fff"
              accessibilityLabel="Shop open"
            />
          </View>
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
        {action("receipt-outline", "Orders", () => navigation.navigate("BusinessDashboardScreen", { tab: "orders" }))}
        {action("restaurant-outline", "Menu", () => navigation.navigate("BusinessDashboardScreen", { tab: "menu" }))}
        {action("pricetag-outline", "Deals", () => navigation.navigate("BusinessDashboardScreen", { tab: "deals" }))}
        {action("settings-outline", "Shop settings", () => navigation.navigate("BusinessDashboardScreen", { tab: "settings" }))}
        {action("card-outline", "Payouts", () => navigation.navigate("PayoutSetupScreen"), payee ? `${payee.bankName || "Bank"} ••• ${payee.accountLast4}` : "Add your bank account")}
        {action("eye-outline", "View my shop", () => navigation.navigate("BusinessShopScreen", { businessId: uid }))}
      </View>
      <Text style={{ color: colors.secondaryText || colors.text, fontSize: 12, marginBottom: 14, lineHeight: 17 }}>
        To change your shop's name, address or location, contact Wiji support so we can re-verify it.
      </Text>
      <TouchableOpacity
        onPress={() => Linking.openURL("https://communitychat-f3fb0.web.app")}
        style={[card, { flexDirection: "row", alignItems: "center", gap: 12 }]}
        accessibilityRole="link"
      >
        <Ionicons name="desktop-outline" size={26} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>Manage on a computer</Text>
          <Text style={{ color: colors.secondaryText || colors.text, fontSize: 12, marginTop: 2 }}>
            communitychat-f3fb0.web.app: orders, menu and prices, customers and sales, with the same email and password
          </Text>
        </View>
        <Ionicons name="open-outline" size={18} color={colors.secondaryText || colors.text} />
      </TouchableOpacity>
    </View>
  );
};

export default BusinessProfilePanel;
