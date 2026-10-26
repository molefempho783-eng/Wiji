// Screens/Wallet/PulseScreen.tsx — Wiji Pulse: income forecast, slow-week alerts and a
// funding-readiness score for drivers and businesses, built from payments received in Wiji.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Share, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import { DAY_NAMES, PulsePayment, computePulse, profileText, rand, samplePayments, shortDate } from "../../services/pulse";

const WARN = "#E08A00";

const PulseScreen = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const muted = colors.secondaryText || colors.textSecondary;
  const card = { backgroundColor: colors.cardBackground, borderRadius: 16, padding: 16, marginBottom: 14 };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PulsePayment[]>([]);
  const [sample, setSample] = useState(false);
  const [who, setWho] = useState<{ name: string; role: string }>({ name: "Wiji user", role: "Wiji user" });
  const [showHow, setShowHow] = useState(false);

  const load = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const [snap, payee] = await Promise.all([
        getDocs(query(collection(db, "payments"), where("payeeUid", "==", uid), where("status", "==", "paid"))),
        getDoc(doc(db, "payees", uid)),
      ]);
      setPayments(
        snap.docs.map((d) => {
          const p = d.data();
          const at = p.paidAt?.toDate?.() || p.createdAt?.toDate?.() || null;
          return { amountCents: Number(p.amountCents) || 0, at, payerUid: p.payerUid } as PulsePayment;
        }).filter((p) => p.at)
      );
      const pd = payee.data();
      setWho({
        name: pd?.businessName || auth.currentUser?.displayName || "Wiji user",
        role: pd?.role === "driver" ? "Wiji driver" : pd?.role === "merchant" ? "Verified Wiji business" : "Wiji seller",
      });
    } catch (e: any) {
      setError("Couldn't load your payments. Pull down or try again.");
      console.error("Pulse load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const realResult = useMemo(() => computePulse(payments), [payments]);
  const result = useMemo(() => (sample ? computePulse(samplePayments()) : realResult), [sample, realResult]);

  const shareProfile = async () => {
    try {
      await Share.share({ title: "Wiji Pulse income profile", message: profileText(sample ? "Sample business" : who.name, sample ? "Sample" : who.role, result, sample) });
    } catch {}
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 }}>
      <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={26} color={colors.text} />
      </TouchableOpacity>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginLeft: 12, flex: 1 }}>Wiji Pulse</Text>
      {result.enoughData ? (
        <TouchableOpacity onPress={shareProfile} accessibilityLabel="Share income profile">
          <Ionicons name="share-outline" size={24} color={colors.primary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={{ color: muted, marginTop: 10 }}>Reading your payments…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---- Not enough history yet ----
  if (!result.enoughData) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={[card, { alignItems: "center" }]}>
            <Ionicons name="pulse" size={48} color={colors.primary} />
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginTop: 10, textAlign: "center" }}>Your Pulse is warming up</Text>
            <Text style={{ color: muted, textAlign: "center", marginTop: 8, lineHeight: 20 }}>
              {error ||
                `Wiji Pulse learns from the payments you receive in Wiji. After 4 weeks it forecasts your next month, warns you about slow weeks and scores how ready you are for funding. You have ${realResult.weeksOfHistory} week${realResult.weeksOfHistory === 1 ? "" : "s"} so far.`}
            </Text>
            <TouchableOpacity
              onPress={() => setSample(true)}
              style={{ marginTop: 16, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignSelf: "stretch", alignItems: "center" }}
            >
              <Text style={{ color: "#fff", fontWeight: "800" }}>Preview with sample data</Text>
            </TouchableOpacity>
            {error ? (
              <TouchableOpacity onPress={load} style={{ marginTop: 12 }}>
                <Text style={{ color: colors.primary, fontWeight: "700" }}>Try again</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Chart: 12 past weeks + 4 forecast weeks ----
  const forecastAhead = result.forecast; // this week + next 3
  const maxCents = Math.max(1, ...result.history.map((w) => w.totalCents), ...forecastAhead.map((f) => f.highCents));
  const CHART_H = 150;
  const h = (c: number) => Math.max(2, Math.round((c / maxCents) * CHART_H));
  const pastBars = result.history.slice(-8); // keep the chart readable on a phone
  const scoreLabel = result.score >= 80 ? "Funding-ready" : result.score >= 60 ? "Nearly there" : "Building your record";
  const scoreColor = result.score >= 80 ? "#2E9E5B" : result.score >= 60 ? WARN : "#D9534F";
  const nextSlow = forecastAhead.find((f) => f.slow);
  const nextFour = forecastAhead.reduce((a, f) => a + f.expectedCents, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {sample ? (
          <TouchableOpacity onPress={() => setSample(false)} style={{ backgroundColor: "#FFF4E5", borderRadius: 12, padding: 10, marginBottom: 12, flexDirection: "row", alignItems: "center" }}>
            <Ionicons name="flask-outline" size={18} color="#7A4A00" style={{ marginRight: 8 }} />
            <Text style={{ color: "#7A4A00", flex: 1, fontSize: 13 }}>Sample data: this is what Pulse looks like with 12 weeks of payments. Tap to go back.</Text>
          </TouchableOpacity>
        ) : null}

        {/* Headline: next 4 weeks */}
        <View style={card}>
          <Text style={{ color: muted, fontSize: 13 }}>Expected over the next 4 weeks</Text>
          <Text style={{ color: colors.text, fontSize: 32, fontWeight: "800", marginTop: 2 }}>{rand(nextFour)}</Text>
          <Text style={{ color: result.trendPctPerWeek >= 0 ? "#2E9E5B" : "#D9534F", fontWeight: "700", marginTop: 2 }}>
            {result.trendPctPerWeek >= 0 ? "▲" : "▼"} {Math.abs(result.trendPctPerWeek * 100).toFixed(1)}% a week · usual week about {rand(result.baselineCents)}
          </Text>
          {nextSlow ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, backgroundColor: "#FFF4E5", borderRadius: 10, padding: 10 }}>
              <Ionicons name="alert-circle" size={18} color={WARN} style={{ marginRight: 8 }} />
              <Text style={{ color: "#7A4A00", flex: 1, fontSize: 13 }}>
                Slow week ahead: week of {shortDate(nextSlow.start)}, about {rand(nextSlow.expectedCents)}.
              </Text>
            </View>
          ) : null}
        </View>

        {/* Chart */}
        <View style={card}>
          <Text style={{ color: colors.text, fontWeight: "800", marginBottom: 12 }}>Weekly income</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", height: CHART_H + 6 }}>
            {pastBars.map((w) => (
              <View key={w.start.toISOString()} style={{ flex: 1, alignItems: "center" }}>
                <View style={{ width: "62%", height: h(w.totalCents), backgroundColor: colors.primary, borderRadius: 4 }} />
              </View>
            ))}
            <View style={{ width: 1, height: CHART_H, backgroundColor: colors.borderColor || colors.border, marginHorizontal: 2 }} />
            {forecastAhead.map((f) => {
              const tone = f.slow ? WARN : colors.primary;
              return (
                <View key={f.start.toISOString()} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: CHART_H }}>
                  {/* range whisker */}
                  <View style={{ position: "absolute", bottom: h(f.lowCents), height: Math.max(2, h(f.highCents) - h(f.lowCents)), width: 2, backgroundColor: tone, opacity: 0.5 }} />
                  <View style={{ width: "62%", height: h(f.expectedCents), borderWidth: 2, borderStyle: "dashed", borderColor: tone, backgroundColor: tone + "33", borderRadius: 4 }} />
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", marginTop: 6 }}>
            <Text style={{ flex: pastBars.length, color: muted, fontSize: 11 }}>{shortDate(pastBars[0].start)} – last week</Text>
            <Text style={{ flex: forecastAhead.length, color: muted, fontSize: 11, textAlign: "right" }}>forecast →</Text>
          </View>
          <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>
            Solid bars are what you earned. Dashed bars are the forecast, with the line showing the likely range{nextSlow ? "; orange means a slow week" : ""}.
          </Text>
        </View>

        {/* Suggestions */}
        <View style={card}>
          <Text style={{ color: colors.text, fontWeight: "800", marginBottom: 8 }}>What to do</Text>
          {result.tips.map((t, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 8 }}>
              <Ionicons name="bulb-outline" size={16} color={colors.primary} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={{ color: colors.text, flex: 1, lineHeight: 20 }}>{t}</Text>
            </View>
          ))}
          <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>
            Busiest day: {DAY_NAMES[result.busiestDay]} · Quietest: {DAY_NAMES[result.quietestDay]} · This week so far: {rand(result.thisWeek.totalCents)}
          </Text>
        </View>

        {/* Funding-readiness score */}
        <View style={card}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>Funding-readiness score</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 6 }}>
            <Text style={{ color: scoreColor, fontSize: 44, fontWeight: "900" }}>{result.score}</Text>
            <Text style={{ color: muted, fontSize: 18, marginBottom: 8, marginLeft: 4 }}>/100</Text>
            <Text style={{ color: scoreColor, fontWeight: "800", marginBottom: 10, marginLeft: 12 }}>{scoreLabel}</Text>
          </View>
          {result.scoreParts.map((p) => (
            <View key={p.key} style={{ marginTop: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>{p.label}</Text>
                <Text style={{ color: muted }}>{p.points}/{p.max}</Text>
              </View>
              <View style={{ height: 8, backgroundColor: colors.borderColor || colors.border, borderRadius: 4, marginTop: 4, overflow: "hidden" }}>
                <View style={{ width: `${Math.round((p.points / p.max) * 100)}%`, height: 8, backgroundColor: colors.primary }} />
              </View>
              {p.points < p.max * 0.7 ? <Text style={{ color: muted, fontSize: 12, marginTop: 3 }}>{p.tip}</Text> : null}
            </View>
          ))}
          <TouchableOpacity
            onPress={shareProfile}
            style={{ marginTop: 16, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
          >
            <Ionicons name="document-text-outline" size={18} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "800" }}>Share my income profile</Text>
          </TouchableOpacity>
          <Text style={{ color: muted, fontSize: 12, marginTop: 6, textAlign: "center" }}>
            A summary of your Wiji income you can send to a bank or funder. Only you decide who sees it.
          </Text>
        </View>

        {/* How it works */}
        <TouchableOpacity onPress={() => setShowHow((v) => !v)} style={[card, { paddingVertical: 12 }]}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: colors.text, fontWeight: "800", flex: 1 }}>How Pulse works</Text>
            <Ionicons name={showHow ? "chevron-up" : "chevron-down"} size={18} color={muted} />
          </View>
          {showHow ? (
            <Text style={{ color: muted, marginTop: 8, lineHeight: 20 }}>
              Pulse looks at the payments you received in Wiji over the last {result.weeksOfHistory} weeks. It weights recent weeks more, measures your growth trend, and learns your month pattern: payday weeks here are {Math.round(Math.abs(result.paydayLift - 1) * 100)}% {result.paydayLift >= 1 ? "higher" : "lower"} and mid-month weeks {Math.round(Math.abs(1 - result.midMonthLift) * 100)}% {result.midMonthLift <= 1 ? "lower" : "higher"} than usual. Your score combines steady income, growth, track record, income size and number of customers. Cash sales outside Wiji aren't counted.
            </Text>
          ) : null}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default PulseScreen;
