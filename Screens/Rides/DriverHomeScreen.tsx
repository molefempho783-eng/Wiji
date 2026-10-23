// Driver mode: go online (shares live position while this screen is open), receive ride offers,
// then run the trip: arrived -> passenger's PIN to start -> complete. Emergency button always available.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import ThemedMapView from "../../components/ThemedMapView";
import { fmtDistance, fmtDuration, usePlannedRoute } from "../../services/routes";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { collection, doc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import { RootStackParamList } from "../../types";
import { EMERGENCY_NUMBERS, callNumber, driverStatsText, formatRand, raiseEmergency, respondToOffer, updateRide } from "../../services/rides";

type Nav = StackNavigationProp<RootStackParamList>;

const DriverHomeScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const uid = user?.uid;
  const mapRef = useRef<MapView>(null);
  const watcher = useRef<Location.LocationSubscription | null>(null);

  const [driver, setDriver] = useState<any | null | undefined>(undefined);
  const [online, setOnline] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [offer, setOffer] = useState<any | null>(null);
  const [trip, setTrip] = useState<any | null>(null);
  // Suggested route the passenger also sees: to the pickup first, then pickup → destination
  const [approachFrom, setApproachFrom] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (trip?.status !== "accepted") setApproachFrom(null);
  }, [trip?.status]);
  useEffect(() => {
    if (trip?.status === "accepted" && pos && !approachFrom) setApproachFrom(pos);
  }, [trip?.status, pos?.lat, approachFrom]);
  const tripRoute = usePlannedRoute(trip?.pickup, trip?.dropoff);
  const approachRoute = usePlannedRoute(trip?.status === "accepted" ? approachFrom : null, trip?.pickup);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, "drivers", uid), (s) => setDriver(s.exists() ? s.data() : null), () => setDriver(null));
  }, [uid]);

  // Offers sent to me
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(query(collection(db, "rides"), where("offeredTo", "==", uid), where("status", "==", "offered")), (s) => {
      setOffer(s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() });
    });
  }, [uid]);

  // Last finished trip (paid yet? rated?) and recent passenger comments
  const [lastRide, setLastRide] = useState<any | null>(null);
  const lastRideId = driver?.lastRideId;
  useEffect(() => {
    if (!lastRideId) return setLastRide(null);
    return onSnapshot(doc(db, "rides", lastRideId), (s) => setLastRide(s.exists() ? { id: s.id, ...s.data() } : null), () => undefined);
  }, [lastRideId]);
  const [comments, setComments] = useState<{ stars: number; comment: string; tags: string[]; at: number }[]>([]);
  useEffect(() => {
    if (!uid) return;
    getDocs(query(collection(db, "driverRatings"), where("driverUid", "==", uid), limit(50)))
      .then((s) =>
        setComments(
          s.docs
            .map((d) => ({ stars: d.data().stars, comment: d.data().comment || "", tags: d.data().tags || [], at: d.data().createdAt?.toMillis?.() || 0 }))
            .filter((r) => r.comment || r.tags.length)
            .sort((a, b) => b.at - a.at)
            .slice(0, 3)
        )
      )
      .catch(() => undefined);
  }, [uid, driver?.ratingCount]);

  // My active trip
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, "rides"), where("driverUid", "==", uid), where("status", "in", ["accepted", "arrived", "in_progress"])),
      (s) => setTrip(s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() })
    );
  }, [uid]);

  // Countdown for offers
  useEffect(() => {
    if (!offer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [offer]);

  const stopSharing = async () => {
    watcher.current?.remove();
    watcher.current = null;
    if (uid) await setDoc(doc(db, "drivers_live", uid), { online: false, updatedAt: serverTimestamp() }, { merge: true }).catch(() => undefined);
  };

  // Go offline when leaving driver mode
  useEffect(() => () => {
    stopSharing();
  }, []);

  // Paused or suspended while online: stop sharing
  useEffect(() => {
    if (online && driver && driver.status !== "active") {
      setOnline(false);
      stopSharing();
    }
  }, [driver?.status]);

  const toggleOnline = async (next: boolean) => {
    if (!uid) return;
    if (!next) {
      if (trip) return Alert.alert("Finish your trip first", "You can go offline once the current trip is complete.");
      setOnline(false);
      await stopSharing();
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return Alert.alert("Location needed", "Passengers need to see where you are while you're online.");
    setOnline(true);
    watcher.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 15 },
      (p) => {
        const here = { lat: p.coords.latitude, lng: p.coords.longitude };
        setPos(here);
        setDoc(
          doc(db, "drivers_live", uid),
          { online: true, lat: here.lat, lng: here.lng, heading: p.coords.heading ?? null, updatedAt: serverTimestamp() },
          { merge: true }
        ).catch(() => undefined);
      }
    );
  };

  const act = (key: string, fn: () => Promise<any>) => async () => {
    setBusy(key);
    try {
      await fn();
    } catch (e: any) {
      Alert.alert("Couldn't do that", e.message);
    } finally {
      setBusy(null);
    }
  };

  const navigateTo = (p: { lat: number; lng: number }) =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`);

  const sos = () =>
    Alert.alert("Do you need help?", "Alert the Wiji safety team, or call for help.", [
      {
        text: "Alert safety team",
        style: "destructive",
        onPress: async () => {
          await raiseEmergency({ rideId: trip?.id, lat: pos?.lat, lng: pos?.lng }).catch(() => undefined);
          Alert.alert("Safety team alerted", "If you're in immediate danger, call SAPS on 10111.");
        },
      },
      { text: `Call SAPS ${EMERGENCY_NUMBERS[0].number}`, onPress: () => callNumber(EMERGENCY_NUMBERS[0].number) },
      { text: "Cancel", style: "cancel" },
    ]);

  const header = (
    <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.round} accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={22} color="#15102B" />
      </TouchableOpacity>
      <View style={[styles.round, { flex: 1, width: undefined, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14 }]}>
        <Text style={{ color: "#15102B", fontWeight: "800", fontSize: 15 }}>{online ? "You're online" : "You're offline"}</Text>
        <Switch
          value={online}
          onValueChange={toggleOnline}
          disabled={driver?.status !== "active"}
          trackColor={{ false: "#ccc", true: "#0E9F87" }}
          thumbColor="#fff"
          accessibilityLabel="Go online"
        />
      </View>
      <TouchableOpacity onPress={sos} style={[styles.round, { backgroundColor: "#B00020" }]} accessibilityLabel="Emergency">
        <Ionicons name="alert-circle" size={22} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );

  if (driver === undefined) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  const card = { backgroundColor: colors.cardBackground, borderRadius: 18, padding: 16 } as const;
  const big = (label: string, onPress: () => void, key: string, tone: "primary" | "plain" | "danger" = "primary") => (
    <TouchableOpacity
      onPress={onPress}
      disabled={!!busy}
      style={{
        flex: 1,
        height: 52,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tone === "primary" ? colors.primary : tone === "danger" ? "transparent" : colors.cardHighlight,
        borderWidth: tone === "danger" ? 1 : 0,
        borderColor: colors.error,
      }}
    >
      {busy === key ? (
        <ActivityIndicator color={tone === "primary" ? "#fff" : colors.primary} />
      ) : (
        <Text style={{ color: tone === "primary" ? "#fff" : tone === "danger" ? colors.error : colors.primary, fontWeight: "800", fontSize: 15 }}>{label}</Text>
      )}
    </TouchableOpacity>
  );

  const secondsLeft = offer ? Math.max(0, Math.round(((offer.offerExpiresAt?.toMillis?.() ?? now) - now) / 1000)) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemedMapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        showsUserLocation
        followsUserLocation={online}
        initialRegion={{ latitude: -25.7479, longitude: 28.2293, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
      >
        {tripRoute ? (
          <Polyline coordinates={tripRoute.points.map((q) => ({ latitude: q.lat, longitude: q.lng }))} strokeColor={trip?.status === "in_progress" ? "#6C2BD9" : "rgba(108,43,217,0.45)"} strokeWidth={6} lineCap="round" lineJoin="round" />
        ) : null}
        {approachRoute && trip?.status === "accepted" ? (
          <Polyline coordinates={approachRoute.points.map((q) => ({ latitude: q.lat, longitude: q.lng }))} strokeColor="#0E9F87" strokeWidth={6} lineCap="round" lineJoin="round" />
        ) : null}
        {trip ? <Marker coordinate={{ latitude: trip.pickup.lat, longitude: trip.pickup.lng }} title="Pickup" pinColor="#6C2BD9" /> : null}
        {trip ? <Marker coordinate={{ latitude: trip.dropoff.lat, longitude: trip.dropoff.lng }} title="Destination" pinColor="#0E9F87" /> : null}
      </ThemedMapView>
      {header}

      <ScrollView style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "60%" }} contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 12, gap: 10 }}>
        {!driver || driver.status !== "active" ? (
          <View style={card}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>
              {!driver ? "You're not a verified driver yet" : driver.status === "suspended" ? "Your driver account is paused" : "Your driver account is paused"}
            </Text>
            <Text style={{ color: colors.secondaryText, marginTop: 4, lineHeight: 20 }}>
              {!driver
                ? "Apply on your Profile: choose Driver. You can go online once the safety team has approved you."
                : driver.suspendedReason || driver.pausedReason || "Contact the Wiji safety team for details."}
            </Text>
            {!driver ? (
              <View style={{ flexDirection: "row", marginTop: 12 }}>{big("Apply to drive", () => navigation.navigate("DriverApplicationScreen"), "apply")}</View>
            ) : null}
          </View>
        ) : null}

        {driver && !trip && !offer ? (
          <View style={card}>
            <Text style={{ color: colors.secondaryText, fontSize: 12, fontWeight: "700" }}>YOUR DRIVER PROFILE</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 18, marginTop: 8 }}>
              <View>
                <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800" }}>
                  {driver.ratingCount ? `★ ${Number(driver.ratingAvg || 0).toFixed(1)}` : "★ —"}
                </Text>
                <Text style={{ color: colors.secondaryText, fontSize: 12 }}>{driver.ratingCount ? `${driver.ratingCount} rating${driver.ratingCount === 1 ? "" : "s"}` : "No ratings yet"}</Text>
              </View>
              <View>
                <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800" }}>{driver.trips || 0}</Text>
                <Text style={{ color: colors.secondaryText, fontSize: 12 }}>trips</Text>
              </View>
            </View>
            <Text style={{ color: colors.secondaryText, fontSize: 12, marginTop: 6 }}>Passengers see this on your profile: {driverStatsText(driver)}</Text>
            {lastRide && lastRide.status === "completed" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: colors.cardHighlight }}>
                <Ionicons name={lastRide.paid ? "checkmark-circle" : "time-outline"} size={20} color={lastRide.paid ? colors.accent : colors.secondaryText} />
                <Text style={{ color: colors.text, flex: 1 }}>
                  Last trip · {formatRand(lastRide.fareCents)} · {lastRide.paid ? "Paid" : "Waiting for the passenger to pay"}
                  {lastRide.rating ? ` · ${"★".repeat(lastRide.rating.stars)}` : ""}
                </Text>
              </View>
            ) : null}
            {comments.map((r, i) => (
              <View key={i} style={{ marginTop: 10 }}>
                <Text style={{ color: "#F5A623" }}>{"★".repeat(r.stars)}<Text style={{ color: colors.secondaryText }}> {r.tags.join(" · ")}</Text></Text>
                {r.comment ? <Text style={{ color: colors.text, fontStyle: "italic" }}>“{r.comment}”</Text> : null}
              </View>
            ))}
          </View>
        ) : null}

        {offer && !trip ? (
          <View style={[card, { borderWidth: 2, borderColor: colors.primary }]}>
            <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 13 }}>NEW RIDE REQUEST · {secondsLeft}s</Text>
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 4 }}>{formatRand(offer.fareCents)}</Text>
            <Text style={{ color: colors.secondaryText, fontSize: 14 }}>
              Pickup {offer.offerPickupKm} km away · trip {offer.distanceKm} km
            </Text>
            <Text style={{ color: colors.text, marginTop: 8 }} numberOfLines={2}>From: {offer.pickup?.address || "Pinned location"}</Text>
            <Text style={{ color: colors.text, marginTop: 2 }} numberOfLines={2}>To: {offer.dropoff?.address || "Pinned location"}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              {big("Decline", act("decline", () => respondToOffer(offer.id, false)), "decline", "plain")}
              {big("Accept", act("accept", () => respondToOffer(offer.id, true)), "accept")}
            </View>
          </View>
        ) : null}

        {trip ? (
          <View style={card}>
            <Text style={{ color: colors.secondaryText, fontWeight: "700", fontSize: 13 }}>
              {trip.status === "accepted" ? "HEAD TO PICKUP" : trip.status === "arrived" ? "WAITING FOR PASSENGER" : "ON TRIP"}
            </Text>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginTop: 4 }}>{trip.riderFirstName}</Text>
            <Text style={{ color: colors.text, marginTop: 6 }} numberOfLines={2}>
              {trip.status === "in_progress" ? `To: ${trip.dropoff?.address || "Pinned location"}` : `Pickup: ${trip.pickup?.address || "Pinned location"}`}
              {(trip.status === "accepted" ? approachRoute : tripRoute)
                ? ` · ${fmtDistance((trip.status === "accepted" ? approachRoute : tripRoute)!.distanceM)}, about ${fmtDuration((trip.status === "accepted" ? approachRoute : tripRoute)!.durationS)}`
                : ""}
            </Text>
            <Text style={{ color: colors.secondaryText, marginTop: 2 }}>Fare {formatRand(trip.fareCents)}</Text>

            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              {big("Navigate", () => navigateTo(trip.status === "in_progress" ? trip.dropoff : trip.pickup), "nav", "plain")}
              {trip.status === "accepted" ? big("I've arrived", act("arrived", () => updateRide(trip.id, "arrived")), "arrived") : null}
              {trip.status === "in_progress"
                ? big("Complete trip", () =>
                    Alert.alert("Complete this trip?", "Only end the trip once the passenger has arrived.", [
                      { text: "Not yet", style: "cancel" },
                      { text: "Complete", onPress: act("complete", () => updateRide(trip.id, "complete")) },
                    ]), "complete")
                : null}
            </View>

            {trip.status === "arrived" ? (
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: colors.text, fontWeight: "700" }}>Ask the passenger for their 4-digit trip PIN</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TextInput
                    value={pin}
                    onChangeText={(t) => setPin(t.replace(/\D/g, "").slice(0, 4))}
                    keyboardType="number-pad"
                    placeholder="PIN"
                    placeholderTextColor={colors.placeholderText}
                    style={{ flex: 1, height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.inputBg, color: colors.text, fontSize: 22, fontWeight: "800", textAlign: "center", letterSpacing: 6 }}
                  />
                  {big("Start trip", act("start", async () => {
                    await updateRide(trip.id, "start", pin);
                    setPin("");
                  }), "start")}
                </View>
              </View>
            ) : null}

            {trip.status !== "in_progress" ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                {big("Cancel trip", () =>
                  Alert.alert("Cancel this trip?", "Frequent cancellations affect your account.", [
                    { text: "Keep trip", style: "cancel" },
                    { text: "Cancel trip", style: "destructive", onPress: act("cancel", () => updateRide(trip.id, "cancel")) },
                  ]), "cancel", "danger")}
              </View>
            ) : null}
            <TouchableOpacity onPress={() => navigation.navigate("IncidentReportScreen", { rideId: trip.id })} style={{ alignItems: "center", paddingTop: 12 }}>
              <Text style={{ color: colors.secondaryText, fontWeight: "700" }}>Report a problem with this passenger</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {driver?.status === "active" && !offer && !trip ? (
          <View style={card}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>{online ? "Waiting for ride requests" : "Go online to get ride requests"}</Text>
            <Text style={{ color: colors.secondaryText, marginTop: 4, lineHeight: 20 }}>
              {online
                ? "Keep Wiji open on this screen. You'll get a notification and see the request here."
                : `${driver.vehicle?.colour || ""} ${driver.vehicle?.make || ""} · ${driver.vehicle?.plate || ""} · ${driver.trips || 0} trips`}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  round: {
    height: 48,
    width: 48,
    borderRadius: 24,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
});

export default DriverHomeScreen;
