// A verified business's shop, as customers see it: deals and menu, a basket, and checkout
// (collect or delivery). Prices shown here are re-checked by the server when the order is placed.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { db, storage } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import { RootStackParamList } from "../../types";
import { formatRand } from "../../services/payments";
import { Business, CartLine, MenuItem, createOrder, shortOrderId } from "../../services/shop";
import AddressInput, { VerifiedAddress } from "../../components/AddressInput";

type Route = RouteProp<RootStackParamList, "BusinessShopScreen">;

const BusinessShopScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { businessId } = useRoute<Route>().params;
  const { user } = useAuth();
  const [biz, setBiz] = useState<Business | null | undefined>(undefined);
  const [cover, setCover] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(doc(db, "businesses", businessId), (s) => setBiz(s.exists() ? ({ id: s.id, ...(s.data() as any) } as Business) : null), () => setBiz(null));
    const u2 = onSnapshot(collection(db, "businesses", businessId, "menu"), (s) =>
      setMenu(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => String(a.category || "").localeCompare(String(b.category || "")) || a.name.localeCompare(b.name)))
    );
    const u3 = onSnapshot(query(collection(db, "mapSpecials"), where("businessId", "==", businessId)), (s) =>
      setDeals(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((d) => d.active !== false))
    );
    return () => {
      u1();
      u2();
      u3();
    };
  }, [businessId]);

  useEffect(() => {
    if (biz?.coverPath) getDownloadURL(ref(storage, biz.coverPath)).then(setCover).catch(() => setCover(null));
  }, [biz?.coverPath]);

  const isOwner = user?.uid === biz?.ownerId;
  const canOrder = !!biz && biz.active && biz.isOpen !== false && !isOwner;
  const lines = Object.values(cart);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((n, l) => n + l.priceCents * l.qty, 0);

  const add = (line: Omit<CartLine, "qty">, delta: number) =>
    setCart((prev) => {
      const key = `${line.kind}:${line.id}`;
      const qty = Math.max(0, Math.min(20, (prev[key]?.qty || 0) + delta));
      const next = { ...prev };
      if (qty === 0) delete next[key];
      else next[key] = { ...line, qty };
      return next;
    });
  const qtyOf = (kind: string, id: string) => cart[`${kind}:${id}`]?.qty || 0;

  const stepper = (line: Omit<CartLine, "qty">, disabled = false) => {
    const q = qtyOf(line.kind, line.id);
    if (disabled) return null;
    return q === 0 ? (
      <TouchableOpacity
        onPress={() => add(line, 1)}
        accessibilityLabel={`Add ${line.name}`}
        style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
      >
        <Ionicons name="add" size={22} color="#fff" />
      </TouchableOpacity>
    ) : (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TouchableOpacity onPress={() => add(line, -1)} accessibilityLabel={`Remove one ${line.name}`} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardHighlight, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="remove" size={20} color={colors.primary} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontWeight: "800", minWidth: 16, textAlign: "center" }}>{q}</Text>
        <TouchableOpacity onPress={() => add(line, 1)} accessibilityLabel={`Add one ${line.name}`} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  };

  if (biz === undefined) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }
  if (!biz || !biz.active) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, padding: 24 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginBottom: 16 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 16 }}>This shop isn't available right now.</Text>
      </SafeAreaView>
    );
  }

  const card = { backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 14 } as const;
  const categories = Array.from(new Set(menu.map((m) => m.category || "Menu")));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: count ? 120 : 40 }}>
        {/* Cover */}
        <View style={{ height: 200, backgroundColor: colors.cardHighlight }}>
          {cover ? <Image source={{ uri: cover }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="storefront" size={56} color={colors.primary} />
            </View>
          )}
          <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0 }}>
            <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back" style={{ margin: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
          </SafeAreaView>
        </View>

        <View style={{ padding: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: "800", flexShrink: 1 }}>{biz.name}</Text>
            <Ionicons name="shield-checkmark" size={18} color={colors.accent} accessibilityLabel="Verified business" />
          </View>
          <Text style={{ color: colors.secondaryText, fontSize: 14, marginTop: 2 }}>{[biz.category, biz.address].filter(Boolean).join(" · ")}</Text>
          {biz.description ? <Text style={{ color: colors.text, fontSize: 14, marginTop: 8, lineHeight: 20 }}>{biz.description}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: biz.isOpen !== false ? colors.cardHighlight : colors.borderColor }}>
              <Text style={{ color: biz.isOpen !== false ? colors.accent : colors.secondaryText, fontWeight: "700", fontSize: 12 }}>{biz.isOpen !== false ? "Open now" : "Closed"}</Text>
            </View>
            {biz.collectEnabled !== false ? <Text style={{ color: colors.secondaryText, fontSize: 13 }}>· Collect</Text> : null}
            {biz.deliveryEnabled ? <Text style={{ color: colors.secondaryText, fontSize: 13 }}>· Delivery {biz.deliveryFeeCents ? formatRand(biz.deliveryFeeCents) : "free"}</Text> : null}
            <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${biz.latitude},${biz.longitude}`)}>
              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>· Directions</Text>
            </TouchableOpacity>
          </View>
          {isOwner ? (
            <View style={[card, { marginTop: 14, borderColor: colors.primary }]}>
              <Text style={{ color: colors.text }}>This is how customers see your shop.</Text>
            </View>
          ) : null}

          {/* Deals */}
          {deals.length ? (
            <>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 24, marginBottom: 10 }}>Deals</Text>
              {deals.map((d) => (
                <View key={d.id} style={[card, { flexDirection: "row", gap: 12, alignItems: "center", marginBottom: 10, borderColor: "#E65100" }]}>
                  <Ionicons name="pricetag" size={22} color="#E65100" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{d.title}</Text>
                    {d.description ? <Text style={{ color: colors.secondaryText, fontSize: 13 }} numberOfLines={2}>{d.description}</Text> : null}
                    {d.priceCents ? <Text style={{ color: colors.text, fontWeight: "800", marginTop: 4 }}>{formatRand(d.priceCents)}</Text> : null}
                  </View>
                  {d.priceCents ? stepper({ kind: "deal", id: d.id, name: d.title, priceCents: d.priceCents }, !canOrder) : null}
                </View>
              ))}
            </>
          ) : null}

          {/* Menu */}
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 24, marginBottom: 4 }}>Menu</Text>
          {!menu.length ? <Text style={{ color: colors.secondaryText, marginTop: 6 }}>No menu yet.</Text> : null}
          {categories.map((cat) => (
            <View key={cat}>
              {categories.length > 1 ? <Text style={{ color: colors.secondaryText, fontWeight: "700", fontSize: 12, textTransform: "uppercase", marginTop: 14, marginBottom: 6 }}>{cat}</Text> : null}
              {menu.filter((m) => (m.category || "Menu") === cat).map((m) => (
                <View key={m.id} style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderColor, opacity: m.available ? 1 : 0.5 }}>
                  {m.photoUrl ? <Image source={{ uri: m.photoUrl }} style={{ width: 60, height: 60, borderRadius: 12 }} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{m.name}</Text>
                    {m.description ? <Text style={{ color: colors.secondaryText, fontSize: 13 }} numberOfLines={2}>{m.description}</Text> : null}
                    <Text style={{ color: colors.text, fontWeight: "700", marginTop: 4 }}>{m.available ? formatRand(m.priceCents) : "Sold out"}</Text>
                  </View>
                  {stepper({ kind: "menu", id: m.id, name: m.name, priceCents: m.priceCents }, !canOrder || !m.available)}
                </View>
              ))}
            </View>
          ))}
          {!isOwner && biz.isOpen === false ? (
            <Text style={{ color: colors.secondaryText, marginTop: 16 }}>This shop is closed right now, so you can't order.</Text>
          ) : null}
        </View>
      </ScrollView>

      {count > 0 ? (
        <TouchableOpacity
          onPress={() => setCheckoutOpen(true)}
          style={{ position: "absolute", left: 16, right: 16, bottom: 16, height: 56, borderRadius: 18, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", paddingHorizontal: 18 }}
        >
          <View style={{ backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>{count}</Text>
          </View>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16, flex: 1, marginLeft: 12 }}>View basket</Text>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{formatRand(subtotal)}</Text>
        </TouchableOpacity>
      ) : null}

      <Checkout
        visible={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        biz={biz}
        lines={lines}
        onChange={add}
        colors={colors}
        onPlaced={(orderId, totalCents) => {
          setCheckoutOpen(false);
          setCart({});
          navigation.navigate("PayScreen", { payeeUid: biz.ownerId, amount: totalCents / 100, note: `Order #${shortOrderId(orderId)} · ${biz.name}`, orderId });
        }}
      />
    </SafeAreaView>
  );
};

/* ---------- Checkout sheet ---------- */
const Checkout = ({
  visible,
  onClose,
  biz,
  lines,
  onChange,
  colors,
  onPlaced,
}: {
  visible: boolean;
  onClose: () => void;
  biz: Business;
  lines: CartLine[];
  onChange: (line: Omit<CartLine, "qty">, delta: number) => void;
  colors: any;
  onPlaced: (orderId: string, totalCents: number) => void;
}) => {
  const canCollect = biz.collectEnabled !== false;
  const canDeliver = !!biz.deliveryEnabled;
  const [how, setHow] = useState<"collect" | "delivery">(canCollect ? "collect" : "delivery");
  const [dest, setDest] = useState<VerifiedAddress | null>(null);
  const [unit, setUnit] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const subtotal = lines.reduce((n, l) => n + l.priceCents * l.qty, 0);
  const fee = how === "delivery" ? biz.deliveryFeeCents || 0 : 0;
  const total = subtotal + fee;

  const place = async () => {
    if (how === "delivery" && !dest) return Alert.alert("Delivery address", "Choose your address from the suggestions, or use where you are now.");
    if (total < 500) return Alert.alert("Minimum order", "The minimum order is R5.");
    setBusy(true);
    try {
      const r = await createOrder({
        businessId: biz.id,
        items: lines.map((l) => ({ kind: l.kind, id: l.id, qty: l.qty })),
        fulfilment: how,
        deliveryAddress: how === "delivery" && dest ? [unit.trim(), dest.address].filter(Boolean).join(", ") : undefined,
        deliveryLocation: how === "delivery" && dest ? { lat: dest.lat, lng: dest.lng } : null,
        note: note.trim(),
      });
      onPlaced(r.orderId, r.totalCents);
    } catch (e: any) {
      Alert.alert("Couldn't place the order", e.message);
    } finally {
      setBusy(false);
    }
  };

  const chip = (key: "collect" | "delivery", label: string, sub: string, enabled: boolean) => {
    const on = how === key;
    return (
      <TouchableOpacity
        disabled={!enabled}
        onPress={() => setHow(key)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on, disabled: !enabled }}
        style={{ flex: 1, padding: 12, borderRadius: 14, borderWidth: 2, borderColor: on ? colors.primary : colors.borderColor, backgroundColor: on ? colors.cardHighlight : colors.cardBackground, opacity: enabled ? 1 : 0.4 }}
      >
        <Text style={{ color: colors.text, fontWeight: "800" }}>{label}</Text>
        <Text style={{ color: colors.secondaryText, fontSize: 12 }}>{enabled ? sub : "Not offered"}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close" style={{ padding: 6 }}>
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8 }}>Your basket · {biz.name}</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {lines.map((l) => (
              <View key={`${l.kind}:${l.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderColor }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>{l.name}</Text>
                  <Text style={{ color: colors.secondaryText, fontSize: 13 }}>{formatRand(l.priceCents)} each</Text>
                </View>
                <TouchableOpacity onPress={() => onChange(l, -1)} accessibilityLabel={`Remove one ${l.name}`}>
                  <Ionicons name="remove-circle-outline" size={28} color={colors.primary} />
                </TouchableOpacity>
                <Text style={{ color: colors.text, fontWeight: "800", minWidth: 18, textAlign: "center" }}>{l.qty}</Text>
                <TouchableOpacity onPress={() => onChange(l, 1)} accessibilityLabel={`Add one ${l.name}`}>
                  <Ionicons name="add-circle" size={28} color={colors.primary} />
                </TouchableOpacity>
              </View>
            ))}

            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginTop: 20, marginBottom: 8 }}>How do you want it?</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {chip("collect", "Collect", "Pick it up at the shop", canCollect)}
              {chip("delivery", "Delivery", biz.deliveryFeeCents ? `${formatRand(biz.deliveryFeeCents)} fee` : "Free delivery", canDeliver)}
            </View>

            {how === "delivery" ? (
              <View style={{ marginTop: 14 }}>
                <AddressInput
                  label="Deliver to"
                  value={dest}
                  onChange={setDest}
                  near={{ lat: biz.latitude, lng: biz.longitude }}
                />
                <TextInput
                  value={unit}
                  onChangeText={setUnit}
                  placeholder="Unit, complex or building (optional)"
                  placeholderTextColor={colors.placeholderText}
                  maxLength={80}
                  style={{ backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, color: colors.text, marginTop: -4 }}
                />
                <Text style={{ color: colors.secondaryText, fontSize: 12, marginTop: 6 }}>The shop delivers this order itself.</Text>
              </View>
            ) : (
              <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 10 }}>Collect from {biz.address}. We'll notify you when it's ready.</Text>
            )}

            <Text style={{ color: colors.text, fontWeight: "700", marginTop: 16, marginBottom: 6 }}>Note for the shop (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. no onions, extra sauce"
              placeholderTextColor={colors.placeholderText}
              maxLength={300}
              style={{ backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, color: colors.text }}
            />

            <View style={{ marginTop: 20, gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: colors.secondaryText }}>Items</Text>
                <Text style={{ color: colors.secondaryText }}>{formatRand(subtotal)}</Text>
              </View>
              {how === "delivery" ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: colors.secondaryText }}>Delivery</Text>
                  <Text style={{ color: colors.secondaryText }}>{fee ? formatRand(fee) : "Free"}</Text>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 17 }}>Total</Text>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 17 }}>{formatRand(total)}</Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={place}
              disabled={busy || !lines.length}
              style={{ marginTop: 20, height: 56, borderRadius: 18, backgroundColor: lines.length ? colors.primary : colors.borderColor, alignItems: "center", justifyContent: "center" }}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>Continue to payment · {formatRand(total)}</Text>}
            </TouchableOpacity>
            <Text style={{ color: colors.secondaryText, fontSize: 12, textAlign: "center", marginTop: 8 }}>Card payment secured by Paystack. If the shop cancels, you're refunded.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

export default BusinessShopScreen;
