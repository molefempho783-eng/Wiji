// Passenger: choose a destination from search suggestions (or tap the map), see the fare and request a ride.
// Typed text alone is never used as a destination: it must be a suggested place or a map pin, so it really exists.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, Text, TextInput, TouchableOpacity, View, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, { Marker, PROVIDER_GOOGLE, MapPressEvent } from "react-native-maps";
import ThemedMapView from "../../components/ThemedMapView";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { collection, doc, getDocs, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import { RootStackParamList } from "../../types";
import { ACTIVE_STATUSES, Point, estimateFareCents, formatRand, getSafetySettings, requestRide } from "../../services/rides";
import { PlaceSuggestion, newSearchSession, resolvePlace, searchPlaces } from "../../services/places";
import CoachTour from "../../components/CoachTour";

type Nav = StackNavigationProp<RootStackParamList>;

async function addressFor(p: { lat: number; lng: number }) {
  try {
    const [r] = await Location.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lng });
    if (!r) return "";
    return [r.name && r.name !== r.street ? r.name : null, r.street, r.district || r.subregion, r.city].filter(Boolean).join(", ");
  } catch {
    return "";
  }
}

const RideRequestScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [contactsCount, setContactsCount] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showList, setShowList] = useState(false);
  const session = useRef(newSearchSession());
  const searchSeq = useRef(0);
  const tourSearchRef = useRef<View>(null);
  const tourFriendsRef = useRef<View>(null);
  const tourDriveRef = useRef<View>(null);
  // Driver status decides what the "Drive with Wiji" card says and where it goes
  const [driverStatus, setDriverStatus] = useState<string | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    const u1 = onSnapshot(doc(db, "drivers", user.uid), (d) => setDriverStatus(d.exists() ? String(d.data().status || "") : null), () => undefined);
    const u2 = onSnapshot(doc(db, "driver_applications", user.uid), (d) => setApplicationStatus(d.exists() ? String(d.data().status || "") : null), () => undefined);
    return () => {
      u1();
      u2();
    };
  }, [user?.uid]);

  // Applying to drive now lives on the Profile screen (Driver); only existing drivers get a shortcut here
  const driveCard: { title: string; sub: string; go: () => void } | null =
    driverStatus === "active"
      ? { title: "Driver mode", sub: "Go online and start accepting rides", go: () => navigation.navigate("DriverHomeScreen") }
      : driverStatus === "suspended" || driverStatus === "paused"
      ? { title: "Your driver account is paused", sub: "Tap to see why and what to do next", go: () => navigation.navigate("DriverHomeScreen") }
      : null;

  // Resume an active ride if there is one
  useEffect(() => {
    if (!user?.uid) return;
    getDocs(query(collection(db, "rides"), where("riderUid", "==", user.uid), where("status", "in", ACTIVE_STATUSES), limit(1)))
      .then((s) => {
        if (!s.empty) navigation.replace("RideTripScreen", { rideId: s.docs[0].id });
      })
      .catch(() => undefined);
  }, [user?.uid, navigation]);

  useEffect(() => {
    getSafetySettings().then((s) => setContactsCount(s.trustedUids.length)).catch(() => setContactsCount(0));
    const unsub = navigation.addListener("focus", () =>
      getSafetySettings().then((s) => setContactsCount(s.trustedUids.length)).catch(() => undefined)
    );
    return unsub;
  }, [navigation]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location needed", "Wiji needs your location to set your pickup point.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setPickup({ ...p, address: await addressFor(p) });
      mapRef.current?.animateToRegion({ latitude: p.lat, longitude: p.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    })();
  }, []);

  const setDestination = async (p: { lat: number; lng: number }) => {
    setDropoff({ ...p, address: "Finding address…" });
    setDropoff({ ...p, address: (await addressFor(p)) || "Pinned location" });
  };

  const onMapPress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    Keyboard.dismiss();
    setSearch("");
    setShowList(false);
    setSuggestions([]);
    setDestination({ lat: latitude, lng: longitude });
  };

  // Live suggestions while typing (short pause so we don't search on every key press)
  useEffect(() => {
    if (!showList) return;
    const q = search.trim();
    const seq = ++searchSeq.current;
    if (q.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchPlaces(q, session.current, pickup ? { lat: pickup.lat, lng: pickup.lng } : undefined);
      if (seq === searchSeq.current) {
        setSuggestions(r);
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, showList]);

  const onChangeSearch = (t: string) => {
    setSearch(t);
    setShowList(true);
    if (dropoff) setDropoff(null); // typing again means the old destination no longer applies
  };

  const pickSuggestion = async (sug: PlaceSuggestion) => {
    Keyboard.dismiss();
    searchSeq.current++;
    setShowList(false);
    setSuggestions([]);
    setSearch(sug.title);
    setSearching(true);
    const place = await resolvePlace(sug, session.current);
    session.current = newSearchSession();
    setSearching(false);
    if (!place) {
      Alert.alert("Couldn't load that place", "Try another suggestion, or tap the map to drop a pin.");
      return;
    }
    setDropoff(place);
    mapRef.current?.animateToRegion({ latitude: place.lat, longitude: place.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 });
  };

  const clearSearch = () => {
    searchSeq.current++;
    setSearch("");
    setSuggestions([]);
    setShowList(false);
    setSearching(false);
    setDropoff(null);
  };

  const estimate = pickup && dropoff ? estimateFareCents(pickup, dropoff) : null;

  const request = async () => {
    if (!pickup || !dropoff) return;
    setRequesting(true);
    try {
      const { rideId } = await requestRide(pickup, dropoff);
      navigation.replace("RideTripScreen", { rideId });
    } catch (e: any) {
      Alert.alert("Couldn't request a ride", e.message);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemedMapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        showsUserLocation
        onPress={onMapPress}
        initialRegion={{ latitude: -25.7479, longitude: 28.2293, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
      >
        {pickup ? <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} title="Pickup" pinColor="#6C2BD9" /> : null}
        {dropoff ? <Marker coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }} title="Destination" pinColor="#0E9F87" /> : null}
      </ThemedMapView>

      <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        <View style={{ margin: 12, backgroundColor: colors.cardBackground, borderRadius: 18, padding: 12, elevation: 6, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800", flex: 1 }}>Get a ride</Text>
            <TouchableOpacity ref={tourFriendsRef} onPress={() => navigation.navigate("TrustedContactsScreen")} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="people-outline" size={18} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>
                {contactsCount ? `${contactsCount} trusted friend${contactsCount > 1 ? "s" : ""}` : "Add trusted friends"}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#6C2BD9" }} />
            <Text style={{ color: colors.text, fontSize: 14, flex: 1 }} numberOfLines={1}>
              {pickup ? pickup.address || "Your current location" : "Finding your location…"}
            </Text>
          </View>
          <View ref={tourSearchRef} collapsable={false} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: "#0E9F87" }} />
            <TextInput
              value={search}
              onChangeText={onChangeSearch}
              onFocus={() => search.trim().length >= 2 && !dropoff && setShowList(true)}
              onSubmitEditing={() => suggestions[0] && pickSuggestion(suggestions[0])}
              returnKeyType="search"
              autoCorrect={false}
              placeholder={dropoff?.address || "Where to? Search, or tap the map"}
              placeholderTextColor={dropoff ? colors.text : colors.placeholderText}
              accessibilityLabel="Destination"
              style={{ flex: 1, color: colors.text, fontSize: 14, backgroundColor: colors.inputBg, borderRadius: 10, paddingHorizontal: 10, height: 40, borderWidth: 1, borderColor: dropoff ? colors.primary : colors.inputBorder }}
            />
            {searching ? (
              <ActivityIndicator color={colors.primary} />
            ) : search || dropoff ? (
              <TouchableOpacity onPress={clearSearch} hitSlop={10} accessibilityLabel="Clear destination">
                <Ionicons name="close-circle" size={20} color={colors.secondaryText} />
              </TouchableOpacity>
            ) : null}
          </View>
          {dropoff && !showList && dropoff.address !== "Finding address…" ? (
            <Text style={{ color: colors.secondaryText, fontSize: 12, marginTop: 4, marginLeft: 18 }} numberOfLines={1}>
              {dropoff.address}
            </Text>
          ) : null}
          {showList && search.trim().length >= 2 ? (
            <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: colors.borderColor }}>
              {suggestions.map((sug) => (
                <TouchableOpacity
                  key={sug.id}
                  onPress={() => pickSuggestion(sug)}
                  accessibilityRole="button"
                  accessibilityLabel={`${sug.title}, ${sug.subtitle}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 }}
                >
                  <Ionicons name="location-outline" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>
                      {sug.title}
                    </Text>
                    {sug.subtitle ? (
                      <Text style={{ color: colors.secondaryText, fontSize: 12 }} numberOfLines={1}>
                        {sug.subtitle}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              ))}
              {!searching && !suggestions.length ? (
                <Text style={{ color: colors.secondaryText, fontSize: 13, paddingVertical: 10 }}>
                  No places found. Check the spelling, or tap the map to drop a pin.
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </SafeAreaView>

      {driveCard && !dropoff && !showList ? (
        <TouchableOpacity
          ref={tourDriveRef}
          onPress={driveCard.go}
          accessibilityRole="button"
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: insets.bottom + 12,
            backgroundColor: colors.cardBackground,
            borderRadius: 18,
            padding: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            elevation: 6,
            shadowColor: "#000",
            shadowOpacity: 0.15,
            shadowRadius: 10,
          }}
        >
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.cardHighlight, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="car-sport-outline" size={24} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>{driveCard.title}</Text>
            <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 2 }}>{driveCard.sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.secondaryText} />
        </TouchableOpacity>
      ) : null}

      {dropoff && pickup ? (
        <View style={{ position: "absolute", left: 12, right: 12, bottom: insets.bottom + 12, backgroundColor: colors.cardBackground, borderRadius: 18, padding: 16, elevation: 6, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View>
              <Text style={{ color: colors.secondaryText, fontSize: 13 }}>Wiji Ride · about {estimate?.km} km</Text>
              <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800" }}>{estimate ? formatRand(estimate.cents) : "—"}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="shield-checkmark" size={18} color={colors.accent} />
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>Verified drivers only</Text>
            </View>
          </View>
          <Text style={{ color: colors.secondaryText, fontSize: 12, marginTop: 6 }}>
            Estimated fare. You'll see your driver's photo, car and plate before pickup, and get a trip PIN to share only with them.
          </Text>
          <TouchableOpacity
            onPress={request}
            disabled={requesting}
            style={{ marginTop: 12, height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
          >
            {requesting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>Request ride</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
      <CoachTour
        id="rides"
        after="tabs"
        delay={1200}
        steps={[
          {
            icon: "search",
            target: tourSearchRef,
            title: "Where to?",
            body: "Start typing and pick your destination from the list, or tap the map to drop a pin. You'll see the estimated fare before you request.",
          },
          {
            icon: "people",
            target: tourFriendsRef,
            title: "Trusted friends",
            body: "Choose up to 5 Wiji friends who can follow your trip live. If you press SOS, they're alerted along with the Wiji safety team.",
          },
          {
            icon: "shield-checkmark",
            title: "Riding safely",
            body: "Before you get in, check the driver's photo, car and plate match the app. Only give your trip PIN to that driver.",
          },
        ]}
      />
    </View>
  );
};

export default RideRequestScreen;
