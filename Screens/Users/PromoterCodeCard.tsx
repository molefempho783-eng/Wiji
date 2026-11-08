// "Have a promoter code?": lets a new user add the code of the promoter who told them about Wiji,
// during their first few days. Hidden once a code has been used or the window has passed.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { PROGRAM, claimPromoterCode, cleanCode } from "../../services/affiliates";

const DAY = 24 * 60 * 60 * 1000;

const PromoterCodeCard = ({ uid, colors, created }: { uid: string; colors: any; created?: string }) => {
  const [used, setUsed] = useState<boolean | undefined>(undefined);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getDoc(doc(db, "referrals", uid))
      .then((s) => alive && setUsed(s.exists()))
      .catch(() => alive && setUsed(true)); // if we can't tell, stay out of the way
    return () => { alive = false; };
  }, [uid]);

  const createdMs = created ? Date.parse(created) : NaN;
  const daysLeft = Number.isFinite(createdMs) ? Math.ceil(PROGRAM.claimDays - (Date.now() - createdMs) / DAY) : 0;

  if (added) {
    return (
      <View style={{ backgroundColor: colors.cardBackground || colors.background, borderColor: colors.borderColor, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14, flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
        <Text style={{ color: colors.text, flex: 1 }}>{`Thanks! Your code was added${added ? ` and ${added} will get the credit` : ""}.`}</Text>
      </View>
    );
  }
  if (used !== false || daysLeft <= 0) return null;

  const muted = colors.secondaryText || colors.textSecondary;
  const add = async () => {
    const c = cleanCode(code);
    if (c.length < 4) return Alert.alert("Promoter code", "Type the code the promoter gave you (4 to 15 letters or numbers).");
    setBusy(true);
    try {
      const res = await claimPromoterCode(c);
      setAdded(res?.name || "");
    } catch (e: any) {
      Alert.alert("Promoter code not added", e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ backgroundColor: colors.cardBackground || colors.background, borderColor: colors.borderColor, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="megaphone-outline" size={20} color={colors.primary} />
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>Have a promoter code?</Text>
      </View>
      <Text style={{ color: muted, fontSize: 13, lineHeight: 18, marginTop: 4 }}>
        {`If someone told you about Wiji, add their code so they get credit. You can add one code, once, within ${PROGRAM.claimDays} days of creating your account (${daysLeft} ${daysLeft === 1 ? "day" : "days"} left).`}
      </Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <TextInput
          value={code}
          onChangeText={(v) => setCode(cleanCode(v))}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={15}
          placeholder="e.g. THABO10"
          placeholderTextColor={colors.placeholderText}
          accessibilityLabel="Promoter code"
          style={{ flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.borderColor, paddingHorizontal: 12, color: colors.text, letterSpacing: 1 }}
        />
        <TouchableOpacity
          onPress={add}
          disabled={busy}
          accessibilityRole="button"
          style={{ height: 46, paddingHorizontal: 18, borderRadius: 12, backgroundColor: busy ? muted : colors.primary, alignItems: "center", justifyContent: "center" }}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800" }}>Add</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default PromoterCodeCard;
