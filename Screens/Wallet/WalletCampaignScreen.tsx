// Wallet tab: pay drivers and businesses by card (Paystack), get paid as a driver/business,
// manage saved cards and see recent payments.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import QRCode from "react-native-qrcode-svg";
import { collection, doc, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import createStyles from "../context/appStyles";
import { RootStackParamList } from "../../types";
import CoachTour from "../../components/CoachTour";
import { formatRand, payCodeFor, removeCard } from "../../services/payments";
import { ORDER_STATUS, OrderStatus } from "../../services/shop";

type Nav = StackNavigationProp<RootStackParamList>;

type Payee = { role: "driver" | "merchant" | "personal"; businessName: string; bankName?: string; accountLast4?: string; verified?: boolean; verification?: string; feePercent?: number };
type Card = { id: string; brand?: string; last4?: string; expMonth?: string; expYear?: string; bank?: string };
type Payment = {
  id: string;
  payerUid: string;
  payeeUid: string;
  payerName?: string;
  payeeName?: string;
  amountCents: number;
  status: string;
  note?: string;
  createdAt?: any;
  paidAt?: any;
};

type Period = "today" | "week" | "month" | "all";
const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];
const when = (p: Payment) => p.paidAt?.toMillis?.() ?? p.createdAt?.toMillis?.() ?? 0;
function periodStart(period: Period) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === "today") return d.getTime();
  if (period === "week") {
    const day = (d.getDay() + 6) % 7; // weeks start on Monday
    d.setDate(d.getDate() - day);
    return d.getTime();
  }
  if (period === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return 0;
}
function dayLabel(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  pending: "Pending",
  failed: "Failed",
  abandoned: "Not completed",
  review: "Under review",
};

const WalletScreen = () => {
  const { colors } = useTheme();
  const globalStyles = createStyles(colors).global;
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const uid = user?.uid;

  const [payee, setPayee] = useState<Payee | null | undefined>(undefined);
  const [cards, setCards] = useState<Card[]>([]);
  const [sent, setSent] = useState<Payment[]>([]);
  const [received, setReceived] = useState<Payment[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [period, setPeriod] = useState<Period>("week");
  const [showAllEarnings, setShowAllEarnings] = useState(false);
  const tourScanRef = useRef<View>(null);
  const tourGetPaidRef = useRef<View>(null);
  const tourCardsRef = useRef<View>(null);

  useEffect(() => {
    if (!uid) return;
    const unsubs = [
      onSnapshot(doc(db, "payees", uid), (s) => setPayee(s.exists() ? (s.data() as Payee) : null), () => setPayee(null)),
      onSnapshot(collection(db, "paymentMethods", uid, "cards"), (s) =>
        setCards(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      ),
      onSnapshot(query(collection(db, "payments"), where("payerUid", "==", uid), limit(30)), (s) =>
        setSent(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      ),
      onSnapshot(query(collection(db, "orders"), where("userId", "==", uid), limit(50)), (s) =>
        setOrders(
          s.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .filter((o) => o.status !== "payment_pending")
            .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
            .slice(0, 10)
        )
      ),
      onSnapshot(query(collection(db, "payments"), where("payeeUid", "==", uid), limit(1000)), (s) =>
        setReceived(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  // Payments this person made (money they received is shown under Earnings)
  const activity = useMemo(() => {
    return sent
      .filter((p) => p.status !== "pending" || Date.now() - when(p) < 30 * 60 * 1000)
      .sort((a, b) => when(b) - when(a))
      .slice(0, 15);
  }, [sent]);

  // Earnings: paid payments received, after the Wiji fee
  const feePct = payee?.feePercent ?? 5;
  const net = (cents: number) => Math.round(cents * (1 - feePct / 100));
  const paidIn = useMemo(() => received.filter((p) => p.status === "paid").sort((a, b) => when(b) - when(a)), [received]);
  const totals = useMemo(() => {
    const from = periodStart(period);
    const list = paidIn.filter((p) => when(p) >= from);
    const gross = list.reduce((n, p) => n + (p.amountCents || 0), 0);
    return { count: list.length, gross, net: net(gross), fee: gross - net(gross) };
  }, [paidIn, period, feePct]);
  const earningGroups = useMemo(() => {
    const groups: { label: string; items: Payment[] }[] = [];
    for (const p of paidIn.slice(0, showAllEarnings ? 200 : 10)) {
      const label = dayLabel(when(p));
      if (groups[groups.length - 1]?.label === label) groups[groups.length - 1].items.push(p);
      else groups.push({ label, items: [p] });
    }
    return groups;
  }, [paidIn, showAllEarnings]);

  const confirmRemoveCard = (card: Card) =>
    Alert.alert("Remove card?", `Remove ${card.brand || "card"} ending ${card.last4}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => removeCard(card.id).catch((e) => Alert.alert("Couldn't remove card", e.message)),
      },
    ]);

  const section = { marginTop: 28 } as const;
  const sectionTitle = { color: colors.text, fontSize: 17, fontWeight: "700" as const, marginBottom: 10 };
  const card = {
    backgroundColor: colors.cardBackground,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 16,
  } as const;

  return (
    <SafeAreaView style={globalStyles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 }}>Wallet</Text>
        <Text style={{ color: colors.secondaryText, fontSize: 15, marginTop: 6, lineHeight: 21 }}>
          Pay drivers and businesses by card. Payments are processed securely by Paystack.
        </Text>

        {/* Pay */}
        <TouchableOpacity
          ref={tourScanRef}
          onPress={() => navigation.navigate("ScanToPayScreen")}
          accessibilityRole="button"
          style={{
            marginTop: 20,
            backgroundColor: colors.primary,
            borderRadius: 18,
            padding: 18,
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
          }}
        >
          <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="qr-code-outline" size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>Scan to pay</Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 2 }}>
              Scan a driver's or shop's Wiji pay code
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Get paid */}
        <View style={section} ref={tourGetPaidRef} collapsable={false}>
          <Text style={sectionTitle}>Get paid</Text>
          {payee === undefined ? (
            <ActivityIndicator color={colors.primary} />
          ) : payee?.role === "merchant" && !payee.verified ? (
            <TouchableOpacity onPress={() => navigation.navigate("BusinessVerificationScreen")} style={[card, { borderColor: colors.warning }]} accessibilityRole="button">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name={payee.verification === "submitted" || payee.verification === "in_review" ? "time-outline" : "shield-outline"} size={24} color={colors.warning} />
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800", flex: 1 }}>
                  {payee.verification === "submitted" || payee.verification === "in_review"
                    ? "We're verifying your business"
                    : payee.verification === "suspended"
                    ? "Payments to your business are paused"
                    : payee.verification === "declined"
                    ? "Your business wasn't verified"
                    : "Verify your business to get paid"}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.secondaryText} />
              </View>
              <Text style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20, marginTop: 6 }}>
                {payee.businessName} · {payee.bankName || "your bank"} ••• {payee.accountLast4}. Your pay code appears here once Wiji has verified your business.
              </Text>
            </TouchableOpacity>
          ) : payee ? (
            <View style={[card, { alignItems: "center" }]}>
              <Text style={{ color: colors.secondaryText, fontSize: 13, fontWeight: "600" }}>
                {payee.role === "driver" ? "DRIVER" : payee.role === "merchant" ? "BUSINESS" : "MY"} PAY CODE
              </Text>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginTop: 4 }}>{payee.businessName}</Text>
              {payee.role === "merchant" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                  <Ionicons name="shield-checkmark" size={14} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "700" }}>Verified business</Text>
                </View>
              ) : null}
              <View style={{ backgroundColor: "#fff", padding: 14, borderRadius: 16, marginTop: 14 }}>
                {uid ? <QRCode value={payCodeFor(uid)} size={180} color="#15102B" backgroundColor="#FFFFFF" /> : null}
              </View>
              <Text style={{ color: colors.secondaryText, fontSize: 14, textAlign: "center", marginTop: 12, lineHeight: 20 }}>
                {payee.role === "personal" ? "People" : "Customers"} scan this to pay you. Money goes to {payee.bankName || "your bank"} ••• {payee.accountLast4}.
              </Text>
              <TouchableOpacity onPress={() => navigation.navigate("PayoutSetupScreen")} style={{ marginTop: 12, padding: 6 }}>
                <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 15 }}>Edit payout details</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={card}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>Get paid in Wiji</Text>
              <Text style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20, marginTop: 6 }}>
                Add your bank account to get your own pay code. Friends, riders or customers pay you by card, and the money goes straight into your bank.
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate("PayoutSetupScreen")}
                style={{ marginTop: 14, backgroundColor: colors.cardHighlight, borderRadius: 12, paddingVertical: 12, alignItems: "center" }}
              >
                <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 15 }}>Set up payouts</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Earnings (drivers and businesses) */}
        {payee ? (
          <View style={section}>
            <Text style={sectionTitle}>Earnings</Text>
            <View style={[card, { padding: 18 }]}>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {PERIODS.map((o) => {
                  const on = period === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      onPress={() => setPeriod(o.key)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? colors.primary : colors.cardHighlight }}
                    >
                      <Text style={{ color: on ? "#fff" : colors.primary, fontWeight: "700", fontSize: 13 }}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 16 }}>You earned</Text>
              <Text style={{ color: colors.text, fontSize: 34, fontWeight: "800", letterSpacing: -0.5 }}>{formatRand(totals.net)}</Text>
              <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 2 }}>
                {totals.count} payment{totals.count === 1 ? "" : "s"} · {formatRand(totals.gross)} paid by customers · {formatRand(totals.fee)} Wiji fee ({feePct}%)
              </Text>
              <Text style={{ color: colors.secondaryText, fontSize: 12, marginTop: 10, lineHeight: 17 }}>
                Paystack pays your earnings into {payee.bankName || "your bank"} ••• {payee.accountLast4} on its normal payout schedule.
              </Text>
            </View>

            {paidIn.length ? (
              <View style={[card, { paddingVertical: 4, marginTop: 12 }]}>
                {earningGroups.map((g, gi) => (
                  <View key={g.label + gi}>
                    <Text style={{ color: colors.secondaryText, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginTop: 12, marginBottom: 2 }}>{g.label}</Text>
                    {g.items.map((p) => (
                      <View key={p.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 }}>
                        <Ionicons name="arrow-down-circle" size={26} color={colors.accent} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>
                            {p.payerName || "Customer"}
                          </Text>
                          <Text style={{ color: colors.secondaryText, fontSize: 13 }} numberOfLines={1}>
                            {new Date(when(p)).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                            {p.note ? ` · ${p.note}` : ""}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>+{formatRand(net(p.amountCents))}</Text>
                          <Text style={{ color: colors.secondaryText, fontSize: 12 }}>of {formatRand(p.amountCents)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
                {paidIn.length > 10 ? (
                  <TouchableOpacity onPress={() => setShowAllEarnings((v) => !v)} style={{ paddingVertical: 12, alignItems: "center" }}>
                    <Text style={{ color: colors.primary, fontWeight: "700" }}>{showAllEarnings ? "Show less" : `Show all ${paidIn.length}`}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <Text style={{ color: colors.secondaryText, fontSize: 14, marginTop: 10 }}>No earnings yet. Payments to your pay code show up here.</Text>
            )}
          </View>
        ) : null}

        {/* Saved cards */}
        <View style={section} ref={tourCardsRef} collapsable={false}>
          <Text style={sectionTitle}>Saved cards</Text>
          {cards.length === 0 ? (
            <Text style={{ color: colors.secondaryText, fontSize: 14, lineHeight: 20 }}>
              When you pay with a card, you can save it here for faster payments next time. Paystack keeps your card details, not Wiji.
            </Text>
          ) : (
            <View style={[card, { paddingVertical: 4 }]}>
              {cards.map((c, i) => (
                <View
                  key={c.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 12,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: colors.borderColor,
                    gap: 12,
                  }}
                >
                  <Ionicons name="card-outline" size={22} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600", textTransform: "capitalize" }}>
                      {c.brand || "Card"} •••• {c.last4}
                    </Text>
                    <Text style={{ color: colors.secondaryText, fontSize: 13 }}>
                      {c.bank ? `${c.bank} · ` : ""}Expires {c.expMonth}/{String(c.expYear).slice(-2)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => confirmRemoveCard(c)} hitSlop={10} accessibilityLabel="Remove card">
                    <Ionicons name="trash-outline" size={20} color={colors.secondaryText} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Orders from shops */}
        {orders.length ? (
          <View style={section}>
            <Text style={sectionTitle}>Your orders</Text>
            <View style={[card, { paddingVertical: 4 }]}>
              {orders.map((o, i) => {
                const live = ["paid", "preparing", "ready", "out_for_delivery"].includes(o.status);
                return (
                  <TouchableOpacity
                    key={o.id}
                    onPress={() => navigation.navigate("OrderScreen", { orderId: o.id })}
                    style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.borderColor, gap: 12 }}
                  >
                    <Ionicons name="bag-handle" size={24} color={live ? colors.primary : colors.secondaryText} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>{o.businessName}</Text>
                      <Text style={{ color: live ? colors.primary : colors.secondaryText, fontSize: 13 }}>
                        {ORDER_STATUS[o.status as OrderStatus]?.label || o.status}
                      </Text>
                    </View>
                    <Text style={{ color: colors.text, fontWeight: "700" }}>{formatRand(o.totalCents || 0)}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.secondaryText} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Activity */}
        <View style={section}>
          <Text style={sectionTitle}>Your payments</Text>
          {activity.length === 0 ? (
            <Text style={{ color: colors.secondaryText, fontSize: 14 }}>No payments yet.</Text>
          ) : (
            <View style={[card, { paddingVertical: 4 }]}>
              {activity.map((p, i) => {
                const incoming = false;
                const ok = p.status === "paid";
                return (
                  <View
                    key={p.id}
                    style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.borderColor, gap: 12 }}
                  >
                    <Ionicons
                      name={incoming ? "arrow-down-circle" : "arrow-up-circle"}
                      size={26}
                      color={incoming ? colors.accent : colors.primary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>
                        {incoming ? `From ${p.payerName || "a customer"}` : `To ${p.payeeName || "payee"}`}
                      </Text>
                      <Text style={{ color: ok ? colors.secondaryText : colors.error, fontSize: 13 }}>
                        {STATUS_LABEL[p.status] || p.status}
                        {when(p) ? ` · ${new Date(when(p)).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}` : ""}
                      </Text>
                    </View>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>
                      {incoming ? "+" : "−"}
                      {formatRand(p.amountCents)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
      <CoachTour
        id="wallet"
        after="tabs"
        steps={[
          {
            icon: "wallet",
            title: "Your Wallet",
            body: "Pay drivers and shops by card, and get paid if you drive or run a business. Card payments are secured by Paystack, and Wiji never sees your card number.",
          },
          {
            icon: "qr-code",
            target: tourScanRef,
            title: "Scan to pay",
            body: "Scan the driver's or shop's Wiji pay code, enter the amount and pay by card. You'll see their name and a 'Verified' badge before you pay.",
          },
          {
            icon: "cash",
            target: tourGetPaidRef,
            title: "Get paid",
            body: "Drive or run a business? Add your bank account here to get your own pay code. Businesses are checked by Wiji first, then your earnings show up here.",
          },
          {
            icon: "card",
            target: tourCardsRef,
            title: "Saved cards",
            body: "Save a card when you pay to make the next payment faster. You can remove it any time.",
          },
        ]}
      />
    </SafeAreaView>
  );
};

export default WalletScreen;
