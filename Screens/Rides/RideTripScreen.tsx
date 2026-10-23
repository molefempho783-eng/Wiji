// Passenger trip screen: finding a driver, verified driver card + trip PIN, live tracking,
// Share my trip, emergency button, then pay and report.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Image, Modal, ScrollView, Share, StyleSheet, Text, TouchableOpacity, Vibration, View } from "react-native";
import * as Haptics from "expo-haptics";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import ThemedMapView from "../../components/ThemedMapView";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { doc, onSnapshot } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { db, storage } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import { RootStackParamList } from "../../types";
import {
  EMERGENCY_NUMBERS,
  callNumber,
  createTripShare,
  driverStatsText,
  formatRand,
  getSafetySettings,
  raiseEmergency,
  shareTripWithFriends,
  updateRide,
} from "../../services/rides";

import RateTrip from "../../components/RateTrip";
import { LatLng, distanceToRouteM, fmtDistance, fmtDuration, usePlannedRoute } from "../../services/routes";

type Nav = StackNavigationProp<RootStackParamList>;

// Off-route check: warn after 2 updates in a row more than 250 m from the suggested route; clear again under 150 m
const OFF_ROUTE_M = 250;
const BACK_ON_ROUTE_M = 150;
type Route = RouteProp<RootStackParamList, "RideTripScreen">;

const RideTripScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { rideId, paid: justPaid } = useRoute<Route>().params;
  const mapRef = useRef<MapView>(null);
  const [ride, setRide] = useState<any | null | undefined>(undefined);
  const [pin, setPin] = useState<string | null>(null);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sosOpen, setSosOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => onSnapshot(doc(db, "rides", rideId), (s) => setRide(s.exists() ? s.data() : null), () => setRide(null)), [rideId]);
  useEffect(() => onSnapshot(doc(db, "ridePins", rideId), (s) => setPin(s.data()?.pin || null), () => undefined), [rideId]);

  const driverUid = ride?.driverUid;
  const active = ride && ["accepted", "arrived", "in_progress"].includes(ride.status);
  useEffect(() => {
    if (!driverUid || !active) return;
    return onSnapshot(doc(db, "drivers_live", driverUid), (s) => {
      const d = s.data();
      if (d?.lat && d?.lng) setDriverPos({ lat: d.lat, lng: d.lng });
    });
  }, [driverUid, active]);

  /* ---------- Suggested route, the driver's actual path, and the off-route check ---------- */
  // The trip itself: pickup → destination (shown from the start so you know the expected way)
  const tripRoute = usePlannedRoute(ride?.pickup, ride?.dropoff);
  // Driver on the way: from where they accepted → pickup
  const [approachFrom, setApproachFrom] = useState<LatLng | null>(null);
  useEffect(() => {
    if (ride?.status === "accepted" && driverPos && !approachFrom) setApproachFrom(driverPos);
  }, [ride?.status, driverPos?.lat]);
  const approachRoute = usePlannedRoute(ride?.status === "accepted" ? approachFrom : null, ride?.pickup);

  const [trail, setTrail] = useState<LatLng[]>([]);
  const [offBy, setOffBy] = useState<number | null>(null); // metres off route, when off
  const [offDismissed, setOffDismissed] = useState(false);
  const offCount = useRef(0);
  useEffect(() => {
    if (ride?.status !== "in_progress" || !driverPos) return;
    // Where the driver has actually driven
    setTrail((t) => {
      const last = t[t.length - 1];
      return !last || distanceToRouteM(driverPos, [last]) > 15 ? [...t, driverPos].slice(-2000) : t;
    });
    if (!tripRoute?.points.length) return;
    const d = distanceToRouteM(driverPos, tripRoute.points);
    if (d > OFF_ROUTE_M) {
      offCount.current += 1;
      if (offCount.current >= 2) setOffBy(d);
    } else if (d < BACK_ON_ROUTE_M) {
      offCount.current = 0;
      setOffBy(null);
      setOffDismissed(false);
    }
  }, [driverPos?.lat, driverPos?.lng, ride?.status, tripRoute]);

  /* ---------- Driver arrived / nearly there: alert on this screen too ---------- */
  // The server also sends a push when the driver taps "Arrived"; this makes sure it can't be missed
  // while the passenger is looking at the trip.
  const prevStatus = useRef<string | undefined>(undefined);
  const [arrivedBanner, setArrivedBanner] = useState(false);
  const nearAlerted = useRef(false);
  const [driverNear, setDriverNear] = useState(false);
  useEffect(() => {
    const s = ride?.status;
    if (prevStatus.current && prevStatus.current !== s && s === "arrived") {
      setArrivedBanner(true);
      if (AppState.currentState === "active") {
        Vibration.vibrate([0, 400, 200, 400]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
    }
    if (s && s !== "arrived") setArrivedBanner(false);
    prevStatus.current = s;
  }, [ride?.status]);
  useEffect(() => {
    if (ride?.status !== "accepted" || !driverPos || !ride?.pickup || nearAlerted.current) return;
    if (distanceToRouteM(driverPos, [ride.pickup]) < 200) {
      nearAlerted.current = true;
      setDriverNear(true);
      Vibration.vibrate(300);
    }
  }, [driverPos?.lat, driverPos?.lng, ride?.status]);

  // Driver's rating and number of trips (public on their driver profile)
  const [driverStats, setDriverStats] = useState<any | null>(null);
  useEffect(() => {
    if (!driverUid) return;
    return onSnapshot(doc(db, "drivers", driverUid), (s) => setDriverStats(s.data() || null), () => undefined);
  }, [driverUid]);

  useEffect(() => {
    if (ride?.driver?.photoPath) getDownloadURL(ref(storage, ride.driver.photoPath)).then(setPhoto).catch(() => setPhoto(null));
  }, [ride?.driver?.photoPath]);

  // Fit the map to pickup, destination and the driver
  useEffect(() => {
    if (!ride) return;
    const routePts = (tripRoute?.points || []).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 40)) === 0);
    const pts = [ride.pickup, ride.dropoff, driverPos, ...routePts].filter(Boolean).map((p: any) => ({ latitude: p.lat, longitude: p.lng }));
    if (pts.length) mapRef.current?.fitToCoordinates(pts, { edgePadding: { top: 120, bottom: 360, left: 60, right: 60 }, animated: true });
  }, [ride?.pickup?.lat, ride?.dropoff?.lat, driverPos?.lat, driverPos?.lng, tripRoute]);

  const openDriverProfile = () => {
    if (ride?.driverUid) navigation.navigate("UserProfileScreen", { userId: ride.driverUid });
  };

  const getShareUrl = async () => {
    if (shareUrl) return shareUrl;
    const { url } = await createTripShare(rideId);
    setShareUrl(url);
    return url;
  };

  const tripMessage = (url: string) => {
    const v = ride?.driver?.vehicle || {};
    return `I'm on a Wiji ride${ride?.driver ? ` with ${ride.driver.firstName}, ${[v.colour, v.make].filter(Boolean).join(" ")} ${v.plate || ""}` : ""}. Follow my trip live: ${url}`;
  };

  const shareTrip = async () => {
    setBusy("share");
    try {
      const s = await getSafetySettings();
      const chooseApp = async () => Share.share({ message: tripMessage(await getShareUrl()) });
      if (s.trustedUids.length) {
        Alert.alert("Share my trip", "Send your live trip to:", [
          {
            text: "My trusted friends on Wiji",
            onPress: async () => {
              try {
                const r = await shareTripWithFriends(rideId);
                Alert.alert("Trip shared", `${r.sent} trusted friend${r.sent > 1 ? "s were" : " was"} notified and can follow your trip live.`);
              } catch (e: any) {
                Alert.alert("Couldn't share", e.message);
              }
            },
          },
          { text: "Someone else (choose an app)", onPress: () => chooseApp().catch(() => undefined) },
          { text: "Cancel", style: "cancel" },
        ]);
      } else {
        Alert.alert("Share my trip", "You haven't chosen any trusted friends yet.", [
          { text: "Choose trusted friends", onPress: () => navigation.navigate("TrustedContactsScreen") },
          { text: "Share with an app", onPress: () => chooseApp().catch(() => undefined) },
          { text: "Cancel", style: "cancel" },
        ]);
      }
    } catch (e: any) {
      Alert.alert("Couldn't share", e.message);
    } finally {
      setBusy(null);
    }
  };

  const alertSafetyTeam = async () => {
    setBusy("sos");
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const pos = await Location.getLastKnownPositionAsync();
        lat = pos?.coords.latitude;
        lng = pos?.coords.longitude;
      } catch {}
      // The server alerts the safety team and your trusted friends (with your location and live trip)
      await raiseEmergency({ rideId, lat, lng });
      Alert.alert("Help is on the way", "The Wiji safety team and your trusted friends have been alerted. If you're in immediate danger, call SAPS on 10111 or 112.");
    } catch {
      Alert.alert("Couldn't send the alert", "Call SAPS on 10111 or 112 now.", [
        { text: "Call 10111", onPress: () => callNumber("10111") },
        { text: "OK", style: "cancel" },
      ]);
    } finally {
      setBusy(null);
    }
  };

  const act = (key: string, fn: () => Promise<any>) => async () => {
    setBusy(key);
    try {
      await fn();
    } catch (e: any) {
      Alert.alert("Something went wrong", e.message);
    } finally {
      setBusy(null);
    }
  };

  if (ride === undefined) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }
  if (!ride) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, padding: 24 }}>
        <Text style={{ color: colors.text }}>This ride couldn't be found.</Text>
      </SafeAreaView>
    );
  }

  const v = ride.driver?.vehicle || {};
  const searching = ["requested", "offered"].includes(ride.status);
  const ended = ["completed", "cancelled", "no_drivers"].includes(ride.status);
  const card = { backgroundColor: colors.cardBackground, borderRadius: 18, padding: 16 } as const;
  const btn = (label: string, icon: any, onPress: () => void, tone: "primary" | "plain" | "danger" = "plain", key?: string) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      disabled={!!busy}
      style={{
        flex: 1,
        minHeight: 48,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: 10,
        backgroundColor: tone === "primary" ? colors.primary : tone === "danger" ? "transparent" : colors.cardHighlight,
        borderWidth: tone === "danger" ? 1 : 0,
        borderColor: colors.error,
      }}
    >
      {busy === key ? (
        <ActivityIndicator color={tone === "primary" ? "#fff" : colors.primary} />
      ) : (
        <>
          <Ionicons name={icon} size={18} color={tone === "primary" ? "#fff" : tone === "danger" ? colors.error : colors.primary} />
          <Text style={{ color: tone === "primary" ? "#fff" : tone === "danger" ? colors.error : colors.primary, fontWeight: "700", fontSize: 14 }}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemedMapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        showsUserLocation
        initialRegion={{ latitude: ride.pickup.lat, longitude: ride.pickup.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
      >
        {tripRoute && !["cancelled", "no_drivers"].includes(ride.status) ? (
          <Polyline
            coordinates={tripRoute.points.map((q) => ({ latitude: q.lat, longitude: q.lng }))}
            strokeColor={ride.status === "in_progress" ? "#6C2BD9" : "rgba(108,43,217,0.55)"}
            strokeWidth={6}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}
        {approachRoute && ride.status === "accepted" ? (
          <Polyline
            coordinates={approachRoute.points.map((q) => ({ latitude: q.lat, longitude: q.lng }))}
            strokeColor="#15102B"
            strokeWidth={4}
            lineDashPattern={[8, 8]}
          />
        ) : null}
        {trail.length > 1 ? (
          <Polyline coordinates={trail.map((q) => ({ latitude: q.lat, longitude: q.lng }))} strokeColor={offBy ? "#E65100" : "#0E9F87"} strokeWidth={4} zIndex={2} />
        ) : null}
        <Marker coordinate={{ latitude: ride.pickup.lat, longitude: ride.pickup.lng }} title="Pickup" pinColor="#6C2BD9" />
        <Marker coordinate={{ latitude: ride.dropoff.lat, longitude: ride.dropoff.lng }} title="Destination" pinColor="#0E9F87" />
        {driverPos && active ? (
          <Marker coordinate={{ latitude: driverPos.lat, longitude: driverPos.lng }} title={ride.driver?.firstName || "Driver"}>
            <View style={{ backgroundColor: "#15102B", borderRadius: 16, padding: 6, borderWidth: 2, borderColor: "#fff" }}>
              <Ionicons name="car" size={18} color="#3EF0D0" />
            </View>
          </Marker>
        ) : null}
      </ThemedMapView>

      <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", padding: 12 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.round} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color="#15102B" />
        </TouchableOpacity>
        {!ended ? (
          <TouchableOpacity onPress={() => setSosOpen(true)} style={[styles.round, { backgroundColor: "#B00020", width: undefined, paddingHorizontal: 14, flexDirection: "row", gap: 6 }]} accessibilityLabel="Emergency">
            <Ionicons name="alert-circle" size={20} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "800" }}>SOS</Text>
          </TouchableOpacity>
        ) : null}
      </SafeAreaView>

      {tripRoute && (ride.status === "in_progress" || searching || ride.status === "accepted" || ride.status === "arrived") ? (
        <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 64, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: offBy && ride.status === "in_progress" ? "#E65100" : "rgba(21,16,43,0.88)" }}>
          <Ionicons name={offBy && ride.status === "in_progress" ? "warning" : ride.status === "in_progress" ? "checkmark-circle" : "navigate"} size={16} color={offBy && ride.status === "in_progress" ? "#fff" : "#3EF0D0"} />
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
            {ride.status === "in_progress"
              ? offBy
                ? `Off the suggested route · ${fmtDistance(offBy)} away`
                : "On the suggested route"
              : `Suggested route · ${fmtDistance(tripRoute.distanceM)} · about ${fmtDuration(tripRoute.durationS)}`}
          </Text>
        </View>
      ) : null}

      <ScrollView
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "62%" }}
        contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 12, gap: 10 }}
      >
        {offBy && !offDismissed && ride.status === "in_progress" ? (
          <View style={[card, { borderWidth: 2, borderColor: "#E65100" }]} accessibilityLiveRegion="assertive">
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              <Ionicons name="warning" size={24} color="#E65100" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>Your driver has left the suggested route</Text>
                <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 2, lineHeight: 18 }}>
                  About {fmtDistance(offBy)} away from it. This is often a detour around traffic, but if you feel unsafe, share your trip or get help.
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              {btn("Share trip", "share-social", shareTrip, "plain", "offshare")}
              {btn("I'm OK", "checkmark", () => setOffDismissed(true), "plain")}
              {btn("SOS", "alert-circle", () => setSosOpen(true), "danger")}
            </View>
          </View>
        ) : null}

        {(arrivedBanner || ride.status === "arrived") && ride.driver ? (
          <View style={[card, { backgroundColor: colors.primary }]} accessibilityLiveRegion="assertive">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="location" size={26} color="#fff" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>{ride.driver.firstName} has arrived</Text>
                <Text style={{ color: "#fff", opacity: 0.9, fontSize: 13, marginTop: 2 }}>
                  Look for the {[v.colour, v.make].filter(Boolean).join(" ")} {v.plate}. Check the photo, then give your PIN.
                </Text>
              </View>
            </View>
          </View>
        ) : driverNear && ride.status === "accepted" && ride.driver ? (
          <View style={[card, { borderWidth: 2, borderColor: colors.primary }]}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>{ride.driver.firstName} is almost there</Text>
            <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 2 }}>Get ready to meet your driver at the pickup point.</Text>
          </View>
        ) : null}

        {searching ? (
          <View style={card}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <ActivityIndicator color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>Finding a verified driver</Text>
                <Text style={{ color: colors.secondaryText, fontSize: 13 }}>Estimated fare {formatRand(ride.fareCents)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", marginTop: 12 }}>{btn("Cancel", "close", act("cancel", () => updateRide(rideId, "cancel")), "danger", "cancel")}</View>
          </View>
        ) : null}

        {ride.status === "no_drivers" ? (
          <View style={card}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>No drivers free right now</Text>
            <Text style={{ color: colors.secondaryText, marginTop: 4 }}>Wiji Rides is in a small pilot, so there aren't many drivers yet. Please try again in a few minutes.</Text>
            <View style={{ flexDirection: "row", marginTop: 12 }}>{btn("Try again", "refresh", () => navigation.replace("RideRequestScreen"), "primary")}</View>
          </View>
        ) : null}

        {ride.driver && active ? (
          <View style={card}>
            <Text style={{ color: colors.secondaryText, fontSize: 13, fontWeight: "600" }}>
              {ride.status === "accepted" ? "YOUR DRIVER IS ON THE WAY" : ride.status === "arrived" ? "YOUR DRIVER HAS ARRIVED" : "ON YOUR TRIP"}
            </Text>
            <TouchableOpacity
              onPress={openDriverProfile}
              accessibilityRole="button"
              accessibilityLabel={`View ${ride.driver.firstName}'s profile`}
              style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 10 }}
            >
              {photo ? (
                <Image source={{ uri: photo }} style={{ width: 64, height: 64, borderRadius: 32 }} accessibilityLabel={`Photo of ${ride.driver.firstName}`} />
              ) : (
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.cardHighlight, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="person" size={30} color={colors.primary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>{ride.driver.firstName}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.secondaryText} />
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="shield-checkmark" size={15} color={colors.accent} />
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>Verified by Wiji</Text>
                </View>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 2 }}>{driverStatsText(driverStats)}</Text>
                <Text style={{ color: colors.secondaryText, fontSize: 14, marginTop: 2 }}>{[v.colour, v.make, v.model].filter(Boolean).join(" ")}</Text>
              </View>
              <View style={{ backgroundColor: "#FFD84D", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 2, borderColor: "#15102B" }}>
                <Text style={{ color: "#15102B", fontWeight: "900", fontSize: 15 }}>{v.plate}</Text>
              </View>
            </TouchableOpacity>

            {ride.status !== "in_progress" && pin ? (
              <View style={{ marginTop: 14, backgroundColor: colors.cardHighlight, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Ionicons name="key" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>Your trip PIN. Check the plate and photo first, then tell the driver:</Text>
                </View>
                <Text style={{ color: colors.primary, fontSize: 28, fontWeight: "900", letterSpacing: 4 }}>{pin}</Text>
              </View>
            ) : null}

            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              {btn("Share my trip", "share-social-outline", shareTrip, "primary", "share")}
            </View>
            {ride.status !== "in_progress" ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                {btn("This isn't my driver", "warning-outline", () =>
                  Alert.alert("Don't get in", "We'll cancel this trip at no cost and the safety team will follow up.", [
                    { text: "Keep trip", style: "cancel" },
                    { text: "Cancel and report", style: "destructive", onPress: act("mismatch", () => updateRide(rideId, "not_my_driver")) },
                  ]), "danger", "mismatch")}
                {btn("Cancel", "close", act("cancel", () => updateRide(rideId, "cancel")), "plain", "cancel")}
              </View>
            ) : null}
          </View>
        ) : null}

        {ride.status === "completed" ? (
          <View style={card}>
            <Ionicons name="checkmark-circle" size={36} color={colors.accent} />
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginTop: 6 }}>You've arrived</Text>
            <Text style={{ color: colors.secondaryText, marginTop: 2 }}>Fare {formatRand(ride.fareCents)} · {ride.distanceKm} km</Text>
            {ride.driver ? (
              <TouchableOpacity
                onPress={openDriverProfile}
                accessibilityRole="button"
                accessibilityLabel={`View ${ride.driver.firstName}'s profile`}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, padding: 10, borderRadius: 14, backgroundColor: colors.cardHighlight }}
              >
                {photo ? (
                  <Image source={{ uri: photo }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                ) : (
                  <Ionicons name="person-circle" size={40} color={colors.primary} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "800" }}>{ride.driver.firstName}</Text>
                  <Text style={{ color: colors.secondaryText, fontSize: 12 }}>{driverStatsText(driverStats)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.secondaryText} />
              </TouchableOpacity>
            ) : null}
            {ride.paid || justPaid ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                <Text style={{ color: colors.text, fontWeight: "800" }}>Paid {formatRand(ride.fareCents)}</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                {btn(`Pay ${formatRand(ride.fareCents)}`, "card-outline", () =>
                  navigation.navigate("PayScreen", { payeeUid: ride.driverUid, amount: ride.fareCents / 100, note: "Wiji ride", rideId }), "primary")}
              </View>
            )}
            <RateTrip rideId={rideId} driverName={ride.driver?.firstName || "your driver"} existing={ride.rating} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              {btn("Report a problem", "flag-outline", () => navigation.navigate("IncidentReportScreen", { rideId }), "plain")}
              {btn("Done", "home-outline", () => navigation.goBack(), "plain")}
            </View>
          </View>
        ) : null}

        {ride.status === "cancelled" ? (
          <View style={card}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>Trip cancelled</Text>
            <Text style={{ color: colors.secondaryText, marginTop: 4 }}>
              {ride.cancelReason === "not_my_driver"
                ? "Thanks for checking. The safety team will follow up on this driver."
                : ride.cancelledBy === "driver"
                ? "Your driver cancelled. You weren't charged."
                : "You cancelled this trip. You weren't charged."}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              {ride.driverUid ? btn("Report a problem", "flag-outline", () => navigation.navigate("IncidentReportScreen", { rideId }), "plain") : null}
              {btn("New ride", "car-outline", () => navigation.replace("RideRequestScreen"), "primary")}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={sosOpen} transparent animationType="slide" onRequestClose={() => setSosOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.cardBackground, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, gap: 10 }}>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}>Do you need help?</Text>
            <Text style={{ color: colors.secondaryText, fontSize: 14 }}>If you're in immediate danger, call the police first.</Text>
            <TouchableOpacity
              onPress={() => {
                setSosOpen(false);
                alertSafetyTeam();
              }}
              style={{ backgroundColor: "#B00020", borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Ionicons name="alert-circle" size={24} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800", flex: 1 }}>Alert the Wiji safety team and my trusted friends</Text>
            </TouchableOpacity>
            {EMERGENCY_NUMBERS.map((n) => (
              <TouchableOpacity
                key={n.number}
                onPress={() => callNumber(n.number)}
                style={{ backgroundColor: colors.cardHighlight, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <Ionicons name="call" size={20} color={colors.primary} />
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 }}>{n.label}</Text>
                <Text style={{ color: colors.primary, fontWeight: "800" }}>{n.number === "0800428428" ? "0800 428 428" : n.number}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setSosOpen(false)} style={{ padding: 12, alignItems: "center" }}>
              <Text style={{ color: colors.secondaryText, fontWeight: "700" }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  round: {
    height: 44,
    width: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
});

export default RideTripScreen;
