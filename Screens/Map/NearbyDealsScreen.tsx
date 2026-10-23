// Deals near you: every active deal within 50 km, closest first. Opened from the orange button on the map.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Linking, Platform, RefreshControl, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import { distanceKm } from "../../services/shop";
import { formatRand } from "../../services/payments";

const RADIUS_KM = 50;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Deal = {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  priceCents?: number;
  businessId?: string;
  businessName?: string;
  location?: string;
  latitude: number;
  longitude: number;
  dealTimeUtc?: string;
  weekdays: number[];
  distance: number;
};

/** Deal days/time are stored in UTC: show them in the phone's own time zone */
function localSchedule(timeUtc = "12:00", daysUtc: number[] = []) {
  const [h, m] = timeUtc.split(":").map(Number);
  let mins = h * 60 + m - new Date().getTimezoneOffset();
  let shift = 0;
  if (mins >= 1440) (mins -= 1440), (shift = 1);
  if (mins < 0) (mins += 1440), (shift = -1);
  const days = daysUtc.map((d) => (d + shift + 7) % 7).sort();
  const time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  return { days, time };
}

const fmtKm = (km: number) => (km < 1 ? `${Math.max(50, Math.round(km * 1000 / 50) * 50)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);

export default function NearbyDealsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    route.params?.latitude != null ? { lat: route.params.latitude, lng: route.params.longitude } : null
  );
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [todayOnly, setTodayOnly] = useState(false);
  const [isBusiness, setIsBusiness] = useState(false);

  // Where am I (if the map didn't pass it)
  useEffect(() => {
    if (center) return;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return setError("Allow location so we can show deals near you.");
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setCenter({ lat: p.coords.latitude, lng: p.coords.longitude });
      } catch (e: any) {
        setError("Couldn't find your location. Check that location is on.");
      }
    })();
  }, [center]);

  // Verified businesses also get a "Post a deal" button
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, "businesses", uid)).then((b) => setIsBusiness(b.exists() && b.data()?.active === true)).catch(() => undefined);
  }, []);

  const load = async () => {
    if (!center) return;
    setError(null);
    try {
      const band = RADIUS_KM / 111;
      const snap = await getDocs(query(collection(db, "mapSpecials"), where("latitude", ">=", center.lat - band), where("latitude", "<=", center.lat + band)));
      const list: Deal[] = [];
      snap.forEach((d) => {
        const x: any = d.data();
        if (x.active === false || typeof x.latitude !== "number" || typeof x.longitude !== "number") return;
        const distance = distanceKm(center, { lat: x.latitude, lng: x.longitude });
        if (distance > RADIUS_KM) return;
        list.push({
          id: d.id,
          title: x.title || "Deal",
          description: x.description,
          imageUrl: x.imageUrl,
          priceCents: typeof x.priceCents === "number" ? x.priceCents : undefined,
          businessId: x.businessId,
          businessName: x.businessName || x.creatorName,
          location: x.location || x.placeName,
          latitude: x.latitude,
          longitude: x.longitude,
          dealTimeUtc: x.dealTimeUtc,
          weekdays: Array.isArray(x.weekdays) ? x.weekdays : [],
          distance,
        });
      });
      list.sort((a, b) => a.distance - b.distance);
      setDeals(list);
    } catch (e: any) {
      setError(e.message || "Couldn't load deals.");
      setDeals([]);
    }
  };
  useEffect(() => {
    load();
  }, [center?.lat, center?.lng]);

  const today = new Date().getDay();
  const shown = useMemo(
    () => (deals || []).filter((d) => !todayOnly || localSchedule(d.dealTimeUtc, d.weekdays).days.includes(today)),
    [deals, todayOnly, today]
  );

  const open = (d: Deal) => {
    if (d.businessId) return navigation.navigate("BusinessShopScreen", { businessId: d.businessId });
    const label = encodeURIComponent(d.location || d.title);
    Linking.openURL(
      Platform.OS === "ios" ? `maps:0,0?q=${label}@${d.latitude},${d.longitude}` : `geo:0,0?q=${d.latitude},${d.longitude}(${label})`
    ).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${d.latitude},${d.longitude}`));
  };

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? "#E65100" : colors.borderColor, backgroundColor: on ? "#E65100" : "transparent" }}
    >
      <Text style={{ color: on ? "#fff" : colors.text, fontWeight: "700" }}>{label}</Text>
    </TouchableOpacity>
  );

  const renderItem = ({ item: d }: { item: Deal }) => {
    const s = localSchedule(d.dealTimeUtc, d.weekdays);
    const isToday = s.days.includes(today);
    return (
      <TouchableOpacity
        onPress={() => open(d)}
        accessibilityRole="button"
        accessibilityLabel={`${d.title}, ${fmtKm(d.distance)} away`}
        style={{ flexDirection: "row", gap: 12, padding: 12, marginHorizontal: 16, marginBottom: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardBackground || colors.background }}
      >
        {d.imageUrl ? (
          <Image source={{ uri: d.imageUrl }} style={{ width: 76, height: 76, borderRadius: 12 }} />
        ) : (
          <View style={{ width: 76, height: 76, borderRadius: 12, backgroundColor: "#FFF3E0", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="pricetag" size={30} color="#E65100" />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Text style={{ flex: 1, color: colors.text, fontWeight: "800", fontSize: 16 }} numberOfLines={2}>{d.title}</Text>
            <Text style={{ color: "#E65100", fontWeight: "800" }}>{fmtKm(d.distance)}</Text>
          </View>
          {d.businessName ? <Text style={{ color: colors.secondaryText || colors.text, fontSize: 13, marginTop: 2 }} numberOfLines={1}>{d.businessName}</Text> : null}
          {d.description ? <Text style={{ color: colors.text, fontSize: 13, marginTop: 4 }} numberOfLines={2}>{d.description}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 }}>
            {d.priceCents ? <Text style={{ color: colors.text, fontWeight: "800" }}>{formatRand(d.priceCents)}</Text> : null}
            {isToday ? (
              <View style={{ backgroundColor: "#E8F5E9", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                <Text style={{ color: "#2E7D32", fontSize: 12, fontWeight: "800" }}>Today · {s.time}</Text>
              </View>
            ) : (
              <Text style={{ color: colors.secondaryText || colors.text, fontSize: 12 }}>
                {s.days.length === 7 ? "Every day" : s.days.map((x) => DAYS[x]).join(", ")} · {s.time}
              </Text>
            )}
            {d.businessId ? <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "800" }}>Order in app ›</Text> : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back" style={{ padding: 8 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>Deals near you</Text>
          <Text style={{ color: colors.secondaryText || colors.text, fontSize: 12 }}>Within {RADIUS_KM} km, closest first</Text>
        </View>
        {isBusiness ? (
          <TouchableOpacity
            onPress={() => navigation.navigate("CreateMapSpecialScreen", center ? { latitude: center.lat, longitude: center.lng } : {})}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#E65100", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8 }}
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "800" }}>Post a deal</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
        {chip(`All${deals ? ` (${deals.length})` : ""}`, !todayOnly, () => setTodayOnly(false))}
        {chip("On today", todayOnly, () => setTodayOnly(true))}
      </View>

      {deals === null && !error ? (
        <ActivityIndicator color="#E65100" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          ListEmptyComponent={
            <View style={{ alignItems: "center", padding: 32 }}>
              <Ionicons name={error ? "location-outline" : "pricetag-outline"} size={44} color={colors.secondaryText || colors.text} />
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 10, textAlign: "center" }}>
                {error || (todayOnly ? "No deals on today" : `No deals within ${RADIUS_KM} km yet`)}
              </Text>
              {!error ? (
                <Text style={{ color: colors.secondaryText || colors.text, marginTop: 6, textAlign: "center" }}>
                  {todayOnly ? "Tap All to see deals on other days." : "Check back soon: local businesses post deals here."}
                </Text>
              ) : null}
            </View>
          }
        />
      )}
    </View>
  );
}
