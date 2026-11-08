// Wiji promoters: apply with your own code, follow the application, and (once approved) share your
// link and see what you've earned. Opened from Profile → Promoter and from promoter notifications.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, Share, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import { PROGRAM, PRIVACY_URL, PROMOTER_PAGE, PROMOTER_TERMS_URL, SITE, TERMS_URL, applyToPromote, cleanCode, entryDate, entryState, promoterLink, summarise, zar } from "../../services/affiliates";

const KIND: Record<string, string> = { ride: "Trip", order: "Shop order", group: "Paid group", payment: "Payment" };

export async function sharePromoterLink(code: string) {
  const url = promoterLink(code);
  try {
    await Share.share({ message: `Join me on Wiji: rides with verified drivers, card payments and local shops in one app. Sign up with my code ${code}: ${url}` });
  } catch {
    await Clipboard.setStringAsync(url);
    Alert.alert("Link copied", url);
  }
}

const PromoterScreen = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const uid = user?.uid;
  const [aff, setAff] = useState<any | null | undefined>(undefined);
  const [entries, setEntries] = useState<any[]>([]);
  const [signups, setSignups] = useState(0);
  const [payee, setPayee] = useState<any | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const subs = [
      onSnapshot(doc(db, "affiliates", uid), (s) => setAff(s.exists() ? s.data() : null), () => setAff(null)),
      onSnapshot(doc(db, "payees", uid), (s) => setPayee(s.exists() ? s.data() : null), () => setPayee(null)),
    ];
    return () => subs.forEach((u) => u());
  }, [uid]);

  // Commissions and sign-ups only once approved (the rules only let promoters read their own)
  const active = aff?.status === "approved" || aff?.status === "frozen";
  useEffect(() => {
    if (!uid || !active) return;
    const u1 = onSnapshot(query(collection(db, "affiliateLedger"), where("affiliateUid", "==", uid)),
      (s) => setEntries(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setEntries([]));
    const u2 = onSnapshot(query(collection(db, "referrals"), where("affiliateUid", "==", uid)), (s) => setSignups(s.size), () => setSignups(0));
    return () => { u1(); u2(); };
  }, [uid, active]);

  const muted = colors.secondaryText || colors.textSecondary;
  const card = { backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 16, marginBottom: 14 } as const;
  const tone = { good: colors.accent, info: colors.primary, warn: colors.warning, bad: colors.error, muted } as const;

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
      <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8 }}>{active ? "Promote Wiji" : "Become a promoter"}</Text>
    </View>
  );

  if (!uid || aff === undefined) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  /* ---------- waiting for the Wiji team ---------- */
  if (aff?.status === "pending" && !editing) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <View style={[card, { borderColor: colors.primary, flexDirection: "row", gap: 12 }]}>
            <Ionicons name="time-outline" size={26} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>Application sent</Text>
              <Text style={{ color: muted, fontSize: 14, marginTop: 2, lineHeight: 20 }}>
                The Wiji team is checking your application for the code {aff.code}. We'll notify you here when it's approved, usually within 1–2 working days.
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => setEditing(true)} style={{ height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.primary, fontWeight: "800" }}>Change my application</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ---------- apply (or apply again) ---------- */
  if (!active) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <ApplyForm aff={aff} colors={colors} card={card} muted={muted} defaultName={user?.displayName || ""} onSent={() => setEditing(false)} />
      </SafeAreaView>
    );
  }

  /* ---------- approved: share and earnings ---------- */
  const t = summarise(entries);
  const recent = [...entries].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 20);
  const payingPeople = new Set(entries.filter((e) => e.status !== "reversed").map((e) => e.referredUid)).size;
  const stat = (value: string, label: string, sub?: string) => (
    <View style={{ width: "48%", padding: 14, borderRadius: 16, backgroundColor: colors.cardHighlight || colors.borderColor, marginBottom: 10 }}>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: colors.text, fontWeight: "700", marginTop: 2 }}>{label}</Text>
      {sub ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        {aff.status === "frozen" ? (
          <View style={[card, { borderColor: colors.warning, flexDirection: "row", gap: 12 }]}>
            <Ionicons name="pause-circle-outline" size={26} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800" }}>Promoter account paused</Text>
              <Text style={{ color: muted, marginTop: 2, lineHeight: 20 }}>
                {aff.decision?.reason ? `“${aff.decision.reason}” ` : ""}New earnings are kept on hold until the Wiji team has sorted it out.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={card}>
          <Text style={{ color: muted, fontWeight: "700" }}>Your code</Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
            <Text selectable style={{ color: colors.text, fontSize: 30, fontWeight: "800", letterSpacing: 2 }}>{aff.code}</Text>
            <TouchableOpacity
              onPress={async () => { await Clipboard.setStringAsync(aff.code); Alert.alert("Copied", `Your code ${aff.code} is copied.`); }}
              style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.cardHighlight }}
              accessibilityLabel="Copy code"
            >
              <Text style={{ color: colors.primary, fontWeight: "800" }}>Copy</Text>
            </TouchableOpacity>
          </View>
          <Text selectable style={{ color: muted, fontSize: 13, marginTop: 6 }}>{promoterLink(aff.code)}</Text>
          <TouchableOpacity
            onPress={() => sharePromoterLink(aff.code)}
            style={{ marginTop: 14, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
          >
            <Ionicons name="share-social" size={20} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Share my link</Text>
          </TouchableOpacity>
          <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>When you post about Wiji, add #ad or #sponsored so people know you earn from it.</Text>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
          {stat(String(aff.stats?.clicks || 0), "Link visits")}
          {stat(String(signups), "Sign-ups", `${payingPeople} earning you money`)}
          {stat(zar(t.ready), "Ready to pay", `${zar(t.waiting)} in the ${PROGRAM.holdDays}-day hold`)}
          {stat(zar(t.paid), "Paid to you", [t.paying ? `${zar(t.paying)} being sent` : "", t.checking ? `${zar(t.checking)} being checked` : ""].filter(Boolean).join(" · ") || undefined)}
        </View>

        <TouchableOpacity onPress={() => navigation.navigate("PayoutSetupScreen")} style={[card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
          <Ionicons name="card-outline" size={24} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800" }}>Payout account</Text>
            <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>
              {payee ? `${payee.bankName || "Bank"} ••• ${payee.accountLast4}` : "Add the bank account you want to be paid into"}
            </Text>
            <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>Wiji pays promoters by EFT, usually monthly, once at least R{PROGRAM.minPayoutRand} is ready.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={muted} />
        </TouchableOpacity>

        <View style={card}>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: 6 }}>Recent commissions</Text>
          {recent.length ? recent.map((e) => {
            const st = entryState(e);
            return (
              <View key={e.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.borderColor }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>{e.referredName || "Wiji user"}</Text>
                  <Text style={{ color: muted, fontSize: 12 }}>{`${KIND[e.kind] || "Payment"} · ${entryDate(e.createdAt)}`}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: colors.text, fontWeight: "800" }}>{zar(e.commissionCents)}</Text>
                  <Text style={{ color: tone[st.tone], fontSize: 12, fontWeight: "700" }}>{st.label}</Text>
                </View>
              </View>
            );
          }) : (
            <Text style={{ color: muted, lineHeight: 20 }}>Nothing yet. You earn when people who signed up with your code pay, or get paid, in Wiji.</Text>
          )}
          <TouchableOpacity onPress={() => Linking.openURL(`${SITE}/admin/`)} style={{ marginTop: 10 }}>
            <Text style={{ color: colors.primary, fontWeight: "700" }}>Full history on the Wiji website →</Text>
          </TouchableOpacity>
        </View>

        <HowYouEarn colors={colors} card={card} muted={muted} />
      </ScrollView>
    </SafeAreaView>
  );
};

const HowYouEarn = ({ colors, card, muted }: any) => (
  <View style={card}>
    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: 6 }}>How you earn</Text>
    {[
      `Wiji keeps a small fee on payments in the app. You get ${PROGRAM.rate}% of what Wiji keeps after Paystack's fee.`,
      `People who sign up with your code: you earn on their payments for ${PROGRAM.payerDays} days after their first one.`,
      `Drivers, businesses and paid-group creators you bring in: you earn on the payments they receive for ${PROGRAM.payeeDays} days after their first one.`,
      `A commission can be paid ${PROGRAM.holdDays} days after the payment it came from, in case of a refund.`,
      "Nothing is paid for sign-ups alone, for your own payments, or for payments between you and people you referred.",
    ].map((line) => (
      <View key={line} style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
        <Text style={{ color: colors.primary }}>•</Text>
        <Text style={{ color: muted, flex: 1, lineHeight: 20 }}>{line}</Text>
      </View>
    ))}
  </View>
);

const ApplyForm = ({ aff, colors, card, muted, defaultName, onSent }: any) => {
  const again = aff?.status === "declined" || aff?.status === "pending";
  const [name, setName] = useState<string>(again ? aff.name || "" : defaultName);
  const [code, setCode] = useState<string>(again ? aff.code || "" : "");
  const [channels, setChannels] = useState<string>(again ? aff.channels || "" : "");
  const [audience, setAudience] = useState<string>(again ? aff.audience || "" : "");
  const [agree, setAgree] = useState(false);
  const [sending, setSending] = useState(false);

  const input = { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontSize: 15 } as const;
  const label = (t: string, sub?: string) => (
    <View style={{ marginBottom: 6, marginTop: 14 }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>{t}</Text>
      {sub ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );

  const send = async () => {
    if (name.trim().length < 2) return Alert.alert("Your name", "Enter your name or the name you post as.");
    if (code.length < 4) return Alert.alert("Your code", "Your code needs 4 to 15 letters or numbers.");
    if (channels.trim().length < 3) return Alert.alert("Where you'll promote", "Tell us where you'll share Wiji, for example @yourname on TikTok.");
    if (!agree) return Alert.alert("Promoter terms", "Please read and accept the promoter terms.");
    setSending(true);
    try {
      await applyToPromote({ name, code, channels, audience, acceptTerms: true });
      onSent?.();
      Alert.alert("Application sent", "The Wiji team will check it and notify you here, usually within 1–2 working days.");
    } catch (e: any) {
      Alert.alert("Couldn't send it", e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {aff?.status === "declined" ? (
        <View style={[card, { borderColor: colors.error, flexDirection: "row", gap: 12 }]}>
          <Ionicons name="close-circle" size={26} color={colors.error} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800" }}>Your last application wasn't approved</Text>
            {aff.decision?.reason ? <Text style={{ color: colors.text, marginTop: 4 }}>“{aff.decision.reason}”</Text> : null}
            <Text style={{ color: muted, marginTop: 4 }}>You can change it and apply again below.</Text>
          </View>
        </View>
      ) : (
        <View style={[card, { flexDirection: "row", gap: 12 }]}>
          <Ionicons name="megaphone-outline" size={28} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>Earn by sharing Wiji</Text>
            <Text style={{ color: muted, marginTop: 2, lineHeight: 20 }}>
              Get your own code and link. When people you bring in use Wiji, you earn a share of Wiji's fee. Great for influencers, campus reps and anyone with a following.
            </Text>
          </View>
        </View>
      )}

      {label("Your name", "Your name, or the name you post as")}
      <TextInput style={input} value={name} onChangeText={setName} maxLength={60} placeholder="Thabo M" placeholderTextColor={colors.placeholderText} />

      {label("The code you want", "4 to 15 letters or numbers. People type it when they sign up.")}
      <TextInput
        style={[input, { fontWeight: "800", letterSpacing: 1.5 }]}
        value={code}
        onChangeText={(v) => setCode(cleanCode(v))}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={15}
        placeholder="THABO10"
        placeholderTextColor={colors.placeholderText}
      />

      {label("Where you'll promote Wiji", "Your handles, pages or places, e.g. campus or your street")}
      <TextInput style={input} value={channels} onChangeText={setChannels} maxLength={300} placeholder="@thabo on TikTok and Instagram, Hatfield campus" placeholderTextColor={colors.placeholderText} />

      {label("Your audience (optional)", "Who follows you, and roughly how many")}
      <TextInput
        style={[input, { minHeight: 90, paddingTop: 12, textAlignVertical: "top" }]}
        value={audience}
        onChangeText={setAudience}
        maxLength={600}
        multiline
        placeholder="About 3 000 students in Pretoria follow me on TikTok"
        placeholderTextColor={colors.placeholderText}
      />

      <View style={[card, { marginTop: 18 }]}>
        <Text style={{ color: colors.text, fontWeight: "800", marginBottom: 4 }}>Promoter terms</Text>
        {[
          `You earn ${PROGRAM.rate}% of the fee Wiji keeps (after Paystack's fee) on payments by people you bring in for ${PROGRAM.payerDays} days, and on payments to drivers, businesses and group creators you bring in for ${PROGRAM.payeeDays} days.`,
          `Nothing is paid for sign-ups alone. A commission can be paid ${PROGRAM.holdDays} days after the payment it came from, in case of a refund. Wiji pays by bank transfer, usually monthly, once at least R${PROGRAM.minPayoutRand} is ready.`,
          `People must type your code when they sign up, or within ${PROGRAM.claimDays} days of creating their account.`,
          "Say you're paid to promote Wiji: add #ad or #sponsored to your posts.",
          "No fake accounts, using your own code, spam or misleading claims. If we find any, we cancel those earnings and may close your promoter account.",
          "Wiji can change these terms or the rate; we'll tell you before it affects you.",
        ].map((line) => (
          <View key={line} style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <Text style={{ color: colors.primary }}>•</Text>
            <Text style={{ color: muted, flex: 1, fontSize: 13, lineHeight: 19 }}>{line}</Text>
          </View>
        ))}
        <View style={{ marginTop: 12, gap: 8 }}>
          {([["How the programme works", PROMOTER_PAGE], ["Full promoter terms", PROMOTER_TERMS_URL], ["Wiji Terms and Conditions", TERMS_URL], ["Privacy Policy", PRIVACY_URL]] as [string, string][]).map(([label, url]) => (
            <TouchableOpacity key={url} onPress={() => Linking.openURL(url)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="open-outline" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        onPress={() => setAgree(!agree)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agree }}
        style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", marginBottom: 18 }}
      >
        <Ionicons name={agree ? "checkbox" : "square-outline"} size={24} color={agree ? colors.primary : muted} />
        <Text style={{ color: colors.text, flex: 1, lineHeight: 20 }}>I accept the promoter terms, the Wiji Terms and Conditions and the Privacy Policy.</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={send}
        disabled={sending}
        style={{ height: 52, borderRadius: 14, backgroundColor: sending ? muted : colors.primary, alignItems: "center", justifyContent: "center" }}
      >
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{aff?.status === "pending" ? "Update my application" : "Send application"}</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
};

export default PromoterScreen;
