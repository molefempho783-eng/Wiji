// Pay a driver or business: choose an amount, then pay with a saved card or a new card (Paystack checkout).
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import createStyles from "../context/appStyles";
import { RootStackParamList } from "../../types";
import { payWithCheckout, payWithSavedCard, formatRand } from "../../services/payments";

type Route = RouteProp<RootStackParamList, "PayScreen">;
type Card = { id: string; brand?: string; last4?: string };
type Payee = { role: "driver" | "merchant" | "personal"; businessName: string; verified?: boolean; verification?: string };

const NEW_CARD = "__new__";

const PayScreen = () => {
  const { colors } = useTheme();
  const globalStyles = createStyles(colors).global;
  const navigation = useNavigation<any>();
  const { payeeUid, amount: presetAmount, note: presetNote, orderId, rideId } = useRoute<Route>().params;
  const { user } = useAuth();

  const [payee, setPayee] = useState<Payee | null | undefined>(undefined);
  const [cards, setCards] = useState<Card[]>([]);
  const [method, setMethod] = useState<string>(NEW_CARD);
  const [amount, setAmount] = useState(presetAmount ? String(presetAmount) : "");
  const [note, setNote] = useState(presetNote || "");
  const [saveCard, setSaveCard] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getDoc(doc(db, "payees", payeeUid))
      .then((s) => setPayee(s.exists() && s.data()?.active !== false ? (s.data() as Payee) : null))
      .catch(() => setPayee(null));
    if (user?.uid) {
      getDocs(collection(db, "paymentMethods", user.uid, "cards")).then((s) => {
        const list = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setCards(list);
        if (list.length) setMethod(list[0].id);
      });
    }
  }, [payeeUid, user?.uid]);

  const value = Number(amount.replace(",", "."));
  const valid = Number.isFinite(value) && value >= 5 && value <= 20000;
  const isSelf = user?.uid === payeeUid;

  const pay = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res =
        method === NEW_CARD
          ? await payWithCheckout({ payeeUid, amount: value, note, saveCard, orderId, rideId })
          : await payWithSavedCard({ cardId: method, payeeUid, amount: value, note, orderId, rideId });
      if (res.status === "paid" && rideId) {
        // Ride paid: back to the trip and tell it straight away, so the Pay button goes even
        // before the server's "paid" update reaches the ride document
        navigation.navigate({ name: "RideTripScreen", params: { rideId, paid: true }, merge: true } as any);
        return;
      }
      if (res.status === "paid" && orderId) {
        // Order paid: go straight to tracking it
        navigation.replace("OrderScreen", { orderId });
        return;
      }
      if (res.status === "paid") {
        setResult({ ok: true, text: `${formatRand(Math.round(value * 100))} paid to ${payee?.businessName}` });
      } else if (res.status === "abandoned" || res.status === "pending") {
        setResult({ ok: false, text: "The payment wasn't completed. You haven't been charged." });
      } else {
        setResult({ ok: false, text: "The payment didn't go through. Try another card." });
      }
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
      <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8 }}>Pay</Text>
    </View>
  );

  if (payee === undefined) {
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        {header}
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (!payee || isSelf) {
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        {header}
        <Text style={{ color: colors.text, fontSize: 16, padding: 24, textAlign: "center", lineHeight: 23 }}>
          {isSelf ? "That's your own pay code." : "This person hasn't set up Wiji payments yet."}
        </Text>
      </SafeAreaView>
    );
  }

  if (payee.role === "merchant" && !payee.verified) {
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        {header}
        <View style={{ alignItems: "center", padding: 28 }}>
          <Ionicons name="shield-outline" size={56} color={colors.warning} />
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginTop: 12, textAlign: "center" }}>{payee.businessName}</Text>
          <Text style={{ color: colors.text, fontSize: 16, marginTop: 10, textAlign: "center", lineHeight: 23 }}>
            {payee.verification === "suspended"
              ? "Payments to this business are paused by Wiji."
              : "This business hasn't been verified by Wiji yet, so you can't pay it in the app. This protects you from scams."}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (result?.ok) {
    return (
      <SafeAreaView style={[globalStyles.safeArea, { alignItems: "center", justifyContent: "center", padding: 32 }]}>
        <Ionicons name="checkmark-circle" size={88} color={colors.accent} />
        <Text style={{ color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 16, textAlign: "center" }}>Payment sent</Text>
        <Text style={{ color: colors.secondaryText, fontSize: 16, marginTop: 8, textAlign: "center" }}>{result.text}</Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ marginTop: 28, backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 40 }}
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Done</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const option = (id: string, title: string, sub?: string) => {
    const on = method === id;
    return (
      <TouchableOpacity
        key={id}
        onPress={() => setMethod(id)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 14,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: on ? colors.primary : colors.borderColor,
          backgroundColor: on ? colors.cardHighlight : colors.cardBackground,
          marginBottom: 10,
        }}
      >
        <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? colors.primary : colors.secondaryText} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600", textTransform: "capitalize" }}>{title}</Text>
          {sub ? <Text style={{ color: colors.secondaryText, fontSize: 13 }}>{sub}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={globalStyles.safeArea}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center" }}>
            <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.cardHighlight, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={payee.role === "driver" ? "car" : payee.role === "merchant" ? "storefront" : "person"} size={30} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800", marginTop: 10 }}>{payee.businessName}</Text>
            {payee.role === "personal" ? (
              <Text style={{ color: colors.secondaryText, fontSize: 14 }}>Wiji user · only pay people you know</Text>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="shield-checkmark" size={14} color={colors.accent} />
                <Text style={{ color: colors.secondaryText, fontSize: 14 }}>{payee.role === "driver" ? "Verified driver" : "Verified business"}</Text>
              </View>
            )}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 24 }}>
            <Text style={{ color: colors.text, fontSize: 40, fontWeight: "800" }}>R</Text>
            <TextInput
              editable={!orderId && !rideId}
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ""))}
              placeholder="0"
              placeholderTextColor={colors.placeholderText}
              keyboardType="decimal-pad"
              style={{ color: colors.text, fontSize: 40, fontWeight: "800", minWidth: 80, marginLeft: 4 }}
              accessibilityLabel="Amount in rand"
              autoFocus
            />
          </View>
          {amount && !valid ? (
            <Text style={{ color: colors.error, textAlign: "center" }}>Enter an amount between R5 and R20 000.</Text>
          ) : null}

          <TextInput
            editable={!orderId && !rideId}
            value={note}
            onChangeText={setNote}
            placeholder={payee.role === "driver" ? "What's it for? e.g. Ride to campus" : "What's it for? (optional)"}
            placeholderTextColor={colors.placeholderText}
            maxLength={140}
            style={{
              marginTop: 18,
              backgroundColor: colors.inputBg,
              borderColor: colors.inputBorder,
              borderWidth: 1,
              borderRadius: 14,
              paddingHorizontal: 14,
              height: 50,
              color: colors.text,
              fontSize: 15,
            }}
          />

          <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700", marginTop: 24, marginBottom: 10 }}>Pay with</Text>
          {cards.map((c) => option(c.id, `${c.brand || "Card"} •••• ${c.last4}`, "Saved card"))}
          {option(NEW_CARD, "New card", "You'll enter your card on Paystack's secure page")}
          {method === NEW_CARD ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 }}>
              <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>Save this card for next time</Text>
              <Switch value={saveCard} onValueChange={setSaveCard} trackColor={{ false: colors.borderColor, true: colors.primary }} thumbColor="#fff" />
            </View>
          ) : null}

          {result && !result.ok ? (
            <Text style={{ color: colors.error, marginTop: 16, textAlign: "center", lineHeight: 20 }}>{result.text}</Text>
          ) : null}

          <TouchableOpacity
            onPress={pay}
            disabled={!valid || busy}
            style={{
              marginTop: 20,
              height: 56,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: valid && !busy ? colors.primary : colors.borderColor,
            }}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>
                {valid ? `Pay ${formatRand(Math.round(value * 100))}` : "Pay"}
              </Text>
            )}
          </TouchableOpacity>
          <Text style={{ color: colors.secondaryText, fontSize: 12, textAlign: "center", marginTop: 12, lineHeight: 18 }}>
            <Ionicons name="lock-closed" size={12} color={colors.secondaryText} /> Card payments are processed by Paystack. Wiji never sees your full card number.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default PayScreen;
