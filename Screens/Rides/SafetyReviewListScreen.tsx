// Safety team only: driver applications waiting for review, plus adding team members (admins).
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import createStyles from "../context/appStyles";
import { RootStackParamList } from "../../types";
import { grantSafetyRole, isAdmin, isBootstrapAdmin, isSafetyStaff } from "../../services/drivers";
import { auth } from "../../firebaseConfig";

type Nav = StackNavigationProp<RootStackParamList>;

const SafetyReviewListScreen = () => {
  const { colors } = useTheme();
  const globalStyles = createStyles(colors).global;
  const navigation = useNavigation<Nav>();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [admin, setAdmin] = useState(false);
  const [apps, setApps] = useState<any[] | null>(null);
  const [email, setEmail] = useState("");
  const [granting, setGranting] = useState(false);

  useEffect(() => {
    isSafetyStaff(true).then(setAllowed).catch(() => setAllowed(false));
    isAdmin().then(setAdmin).catch(() => setAdmin(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    return onSnapshot(
      query(collection(db, "driver_applications"), where("status", "in", ["submitted", "in_review"])),
      (s) => {
        const list = s.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
        list.sort((a, b) => (a.submittedAt?.toMillis?.() ?? 0) - (b.submittedAt?.toMillis?.() ?? 0)); // oldest first
        setApps(list);
      },
      () => setApps([])
    );
  }, [allowed]);

  const grant = async (role: "safety" | "admin" | "none") => {
    setGranting(true);
    try {
      await grantSafetyRole(email.trim(), role);
      Alert.alert("Done", role === "none" ? "Their safety-team access was removed." : `They now have the ${role} role. They need to sign out and in again.`);
      setEmail("");
    } catch (e: any) {
      Alert.alert("Couldn't update role", e.message);
    } finally {
      setGranting(false);
    }
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
      <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8 }}>Safety team</Text>
    </View>
  );

  if (allowed === null) {
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        {header}
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }
  if (!allowed) {
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        {header}
        <Text style={{ color: colors.text, padding: 24, fontSize: 16 }}>This area is only for the Wiji safety team.</Text>
        {isBootstrapAdmin() ? (
          <TouchableOpacity
            onPress={async () => {
              try {
                await grantSafetyRole(auth.currentUser?.email || "", "admin");
                const ok = await isSafetyStaff(true);
                setAllowed(ok);
                setAdmin(ok);
              } catch (e: any) {
                Alert.alert("Couldn't activate", e.message);
              }
            }}
            style={{ marginHorizontal: 24, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Activate my admin access</Text>
          </TouchableOpacity>
        ) : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={globalStyles.safeArea}>
      {header}
      <FlatList
        data={apps || []}
        keyExtractor={(a) => a.uid}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <View>
            {admin ? (
              <View style={{ backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 14, marginBottom: 20 }}>
                <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>Team access</Text>
                <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 4 }}>Give someone's Wiji account access to driver reviews.</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Their Wiji email"
                  placeholderTextColor={colors.placeholderText}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={{ marginTop: 10, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 46, color: colors.text }}
                />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  {(["safety", "admin", "none"] as const).map((r) => (
                    <TouchableOpacity
                      key={r}
                      disabled={!email.includes("@") || granting}
                      onPress={() => grant(r)}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: r === "none" ? colors.cardHighlight : colors.primary, opacity: email.includes("@") ? 1 : 0.5 }}
                    >
                      <Text style={{ color: r === "none" ? colors.text : "#fff", fontWeight: "700" }}>
                        {r === "none" ? "Remove" : r === "safety" ? "Reviewer" : "Admin"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 4 }}>Driver applications</Text>
            <Text style={{ color: colors.secondaryText, fontSize: 13, marginBottom: 14 }}>Oldest first. Every action you take is logged.</Text>
            {apps === null ? <ActivityIndicator color={colors.primary} /> : null}
            {apps?.length === 0 ? <Text style={{ color: colors.secondaryText }}>Nothing waiting for review.</Text> : null}
          </View>
        }
        renderItem={({ item }) => {
          const passed = Object.values(item.checks || {}).filter((c: any) => c?.result === "passed").length;
          const total = Object.keys(item.checks || {}).length || 7;
          return (
            <TouchableOpacity
              onPress={() => navigation.navigate("SafetyReviewDetailScreen", { uid: item.uid })}
              style={{ backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <Ionicons name="person-circle-outline" size={36} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{item.personal?.fullName || "Unnamed"}</Text>
                <Text style={{ color: colors.secondaryText, fontSize: 13 }}>
                  {item.vehicle?.make} {item.vehicle?.model} · {item.personal?.homeArea || "area not given"}
                </Text>
                <Text style={{ color: colors.secondaryText, fontSize: 13 }}>
                  {item.status === "submitted" ? "New" : "In review"} · {passed}/{total} checks passed
                  {item.submittedAt?.toDate ? ` · submitted ${item.submittedAt.toDate().toLocaleDateString()}` : ""}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.secondaryText} />
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
};

export default SafetyReviewListScreen;
