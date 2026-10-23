// The business owner's shop: live orders, menu, deals and shop settings.
// Reached from the deals (price tag) button on the Map once the business is verified.
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
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
import { useNavigation, useRoute } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import { formatRand } from "../../services/payments";
import { Business, MenuItem, ORDER_STATUS, OrderStatus, shortOrderId, updateOrderStatus } from "../../services/shop";

type Tab = "orders" | "menu" | "deals" | "settings";

const BusinessDashboardScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const uid = user?.uid || "";
  const [biz, setBiz] = useState<Business | null | undefined>(undefined);
  const route = useRoute<any>();
  const [tab, setTab] = useState<Tab>((route.params?.tab as Tab) || "orders");
  useEffect(() => {
    if (route.params?.tab) setTab(route.params.tab);
  }, [route.params?.tab]);
  const [orders, setOrders] = useState<any[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [editing, setEditing] = useState<Partial<MenuItem> | null>(null);
  const [cancelling, setCancelling] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const u1 = onSnapshot(doc(db, "businesses", uid), (s) => {
      const b = s.exists() ? ({ id: s.id, ...(s.data() as any) } as Business) : null;
      setBiz(b);
      if (!b || !b.active) navigation.replace("BusinessVerificationScreen");
    });
    const u2 = onSnapshot(query(collection(db, "orders"), where("ownerId", "==", uid)), (s) =>
      setOrders(
        s.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((o) => o.status !== "payment_pending")
          .sort((a, b) => (b.paidAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0) - (a.paidAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0))
      )
    );
    const u3 = onSnapshot(collection(db, "businesses", uid, "menu"), (s) =>
      setMenu(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => a.name.localeCompare(b.name)))
    );
    const u4 = onSnapshot(query(collection(db, "mapSpecials"), where("createdBy", "==", uid)), (s) =>
      setDeals(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
    );
    return () => [u1, u2, u3, u4].forEach((u) => u());
  }, [uid]);

  const active = useMemo(() => orders.filter((o) => ["paid", "preparing", "ready", "out_for_delivery"].includes(o.status)), [orders]);
  const done = useMemo(() => orders.filter((o) => ["completed", "cancelled"].includes(o.status)).slice(0, 30), [orders]);

  if (biz === undefined || !biz) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  const card = { backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 14, marginBottom: 12 } as const;
  const setShop = (patch: Record<string, any>) => updateDoc(doc(db, "businesses", uid), { ...patch, updatedAt: serverTimestamp() }).catch((e) => Alert.alert("Couldn't save", e.message));

  const move = async (o: any, status: OrderStatus) => {
    setBusy(o.id);
    try {
      await updateOrderStatus(o.id, status);
    } catch (e: any) {
      Alert.alert("Couldn't update the order", e.message);
    } finally {
      setBusy(null);
    }
  };

  const orderCard = (o: any) => {
    const st = o.status as OrderStatus;
    const delivery = o.fulfilment === "delivery";
    const btn = (label: string, onPress: () => void, primary = true) => (
      <TouchableOpacity
        onPress={onPress}
        disabled={busy === o.id}
        style={{ flex: primary ? 1 : 0, paddingHorizontal: 14, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: primary ? colors.primary : "transparent", borderWidth: primary ? 0 : 1, borderColor: colors.error }}
      >
        {busy === o.id && primary ? <ActivityIndicator color="#fff" /> : <Text style={{ color: primary ? "#fff" : colors.error, fontWeight: "800" }}>{label}</Text>}
      </TouchableOpacity>
    );
    return (
      <View key={o.id} style={[card, st === "paid" ? { borderColor: colors.primary, borderWidth: 2 } : null]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>#{shortOrderId(o.id)} · {o.buyerName}</Text>
          <Text style={{ color: colors.text, fontWeight: "800" }}>{formatRand(o.totalCents)}</Text>
        </View>
        <Text style={{ color: st === "cancelled" ? colors.error : colors.secondaryText, fontSize: 13, marginTop: 2 }}>
          {ORDER_STATUS[st]?.label || st} · {delivery ? "Delivery" : "Collect"}
          {o.paidAt?.toDate ? ` · ${o.paidAt.toDate().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}` : ""}
        </Text>
        <View style={{ marginTop: 8 }}>
          {(o.items || []).map((l: any, i: number) => (
            <Text key={i} style={{ color: colors.text, fontSize: 15 }}>
              {l.qty} × {l.name}
            </Text>
          ))}
        </View>
        {o.note ? <Text style={{ color: colors.text, marginTop: 6, fontStyle: "italic" }}>“{o.note}”</Text> : null}
        {delivery && o.deliveryAddress ? (
          <TouchableOpacity
            onPress={() =>
              Linking.openURL(
                o.deliveryLocation
                  ? `https://www.google.com/maps/dir/?api=1&destination=${o.deliveryLocation.lat},${o.deliveryLocation.lng}`
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.deliveryAddress)}`
              )
            }
            style={{ flexDirection: "row", gap: 6, marginTop: 6, alignItems: "center" }}
          >
            <Ionicons name="navigate" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, flex: 1 }}>{o.deliveryAddress}</Text>
          </TouchableOpacity>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          {st === "paid" ? btn("Accept & start preparing", () => move(o, "preparing")) : null}
          {st === "preparing" ? btn(delivery ? "Out for delivery" : "Ready for collection", () => move(o, delivery ? "out_for_delivery" : "ready")) : null}
          {st === "ready" || st === "out_for_delivery" ? btn(delivery ? "Delivered" : "Collected", () => move(o, "completed")) : null}
          {st === "paid" || st === "preparing" ? btn("Cancel", () => setCancelling(o), false) : null}
        </View>
      </View>
    );
  };

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "orders", label: "Orders", badge: active.filter((o) => o.status === "paid").length },
    { key: "menu", label: "Menu" },
    { key: "deals", label: "Deals" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }} numberOfLines={1}>{biz.name}</Text>
          <Text style={{ color: biz.isOpen !== false ? colors.accent : colors.secondaryText, fontSize: 12, fontWeight: "700" }}>
            {biz.isOpen !== false ? "Open: taking orders" : "Closed: not taking orders"}
          </Text>
        </View>
        <Switch
          value={biz.isOpen !== false}
          onValueChange={(v) => setShop({ isOpen: v })}
          trackColor={{ false: colors.borderColor, true: colors.primary }}
          thumbColor="#fff"
          accessibilityLabel="Shop open"
        />
      </View>

      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 8 }}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: "center", backgroundColor: tab === t.key ? colors.primary : colors.cardHighlight, flexDirection: "row", justifyContent: "center", gap: 4 }}
          >
            <Text style={{ color: tab === t.key ? "#fff" : colors.primary, fontWeight: "700", fontSize: 13 }}>{t.label}</Text>
            {t.badge ? (
              <View style={{ backgroundColor: colors.error, borderRadius: 9, minWidth: 18, paddingHorizontal: 4, alignItems: "center" }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{t.badge}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {tab === "orders" ? (
          <>
            {!active.length ? (
              <View style={[card, { alignItems: "center", padding: 24 }]}>
                <Ionicons name="receipt-outline" size={36} color={colors.secondaryText} />
                <Text style={{ color: colors.secondaryText, marginTop: 8, textAlign: "center" }}>
                  No orders to handle right now. New paid orders appear here and you'll get a notification.
                </Text>
              </View>
            ) : (
              active.map(orderCard)
            )}
            {done.length ? <Text style={{ color: colors.secondaryText, fontWeight: "700", marginTop: 12, marginBottom: 8 }}>EARLIER</Text> : null}
            {done.map(orderCard)}
          </>
        ) : null}

        {tab === "menu" ? (
          <>
            <TouchableOpacity
              onPress={() => setEditing({ available: true })}
              style={{ height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginBottom: 14 }}
            >
              <Ionicons name="add" size={22} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "800" }}>Add menu item</Text>
            </TouchableOpacity>
            {!menu.length ? <Text style={{ color: colors.secondaryText, textAlign: "center" }}>Add what you sell so customers can order it.</Text> : null}
            {menu.map((m) => (
              <View key={m.id} style={[card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
                {m.photoUrl ? <Image source={{ uri: m.photoUrl }} style={{ width: 50, height: 50, borderRadius: 10 }} /> : null}
                <TouchableOpacity style={{ flex: 1 }} onPress={() => setEditing(m)}>
                  <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{m.name}</Text>
                  <Text style={{ color: colors.secondaryText, fontSize: 13 }}>
                    {formatRand(m.priceCents)}
                    {m.category ? ` · ${m.category}` : ""}
                    {m.available ? "" : " · Sold out"}
                  </Text>
                </TouchableOpacity>
                <Switch
                  value={m.available}
                  onValueChange={(v) => updateDoc(doc(db, "businesses", uid, "menu", m.id), { available: v, name: m.name, priceCents: m.priceCents })}
                  trackColor={{ false: colors.borderColor, true: colors.primary }}
                  thumbColor="#fff"
                  accessibilityLabel={`${m.name} available`}
                />
              </View>
            ))}
          </>
        ) : null}

        {tab === "deals" ? (
          <>
            <TouchableOpacity
              onPress={() => navigation.navigate("CreateMapSpecialScreen", { latitude: biz.latitude, longitude: biz.longitude })}
              style={{ height: 48, borderRadius: 14, backgroundColor: "#E65100", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginBottom: 14 }}
            >
              <Ionicons name="pricetag" size={20} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "800" }}>Add a deal</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.secondaryText, fontSize: 13, marginBottom: 12 }}>
              Deals show on the map at your shop, and nearby people get a reminder. Give a deal a price so customers can buy it in the app.
            </Text>
            {deals.map((d) => (
              <View key={d.id} style={[card, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>{d.title}</Text>
                  <Text style={{ color: colors.secondaryText, fontSize: 13 }}>
                    {d.priceCents ? formatRand(d.priceCents) : "No price (not sold in app)"}
                    {d.active === false ? " · Hidden" : ""}
                  </Text>
                </View>
                <Switch
                  value={d.active !== false}
                  onValueChange={(v) => updateDoc(doc(db, "mapSpecials", d.id), { active: v, updatedAt: serverTimestamp() })}
                  trackColor={{ false: colors.borderColor, true: colors.primary }}
                  thumbColor="#fff"
                  accessibilityLabel={`${d.title} visible`}
                />
                <TouchableOpacity
                  onPress={() =>
                    Alert.alert("Delete deal?", d.title, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => deleteDoc(doc(db, "mapSpecials", d.id)) },
                    ])
                  }
                  accessibilityLabel={`Delete ${d.title}`}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.secondaryText} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        ) : null}

        {tab === "settings" ? (
          <ShopSettings biz={biz} colors={colors} onSave={setShop} onPreview={() => navigation.navigate("BusinessShopScreen", { businessId: uid })} />
        ) : null}
      </ScrollView>

      <MenuEditor uid={uid} item={editing} onClose={() => setEditing(null)} colors={colors} />
      <CancelOrder
        order={cancelling}
        colors={colors}
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          const o = cancelling;
          setCancelling(null);
          setBusy(o.id);
          try {
            const r = await updateOrderStatus(o.id, "cancelled", reason);
            Alert.alert("Order cancelled", r.refunded ? "The customer is being refunded." : "The customer has been told.");
          } catch (e: any) {
            Alert.alert("Couldn't cancel", e.message);
          } finally {
            setBusy(null);
          }
        }}
      />
    </SafeAreaView>
  );
};

/* ---------- Shop settings ---------- */
const ShopSettings = ({ biz, colors, onSave, onPreview }: { biz: Business; colors: any; onSave: (p: any) => void; onPreview: () => void }) => {
  const [fee, setFee] = useState(biz.deliveryFeeCents ? String(biz.deliveryFeeCents / 100) : "");
  const [desc, setDesc] = useState(biz.description || "");
  const row = (label: string, sub: string, value: boolean, onChange: (v: boolean) => void) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderColor }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{label}</Text>
        <Text style={{ color: colors.secondaryText, fontSize: 13 }}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: colors.borderColor, true: colors.primary }} thumbColor="#fff" />
    </View>
  );
  const input = { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, color: colors.text } as const;
  return (
    <View>
      {row("Collection", "Customers pick up at your shop", biz.collectEnabled !== false, (v) => {
        if (!v && !biz.deliveryEnabled) return Alert.alert("Keep one option", "Turn on delivery first, so customers can still order.");
        onSave({ collectEnabled: v });
      })}
      {row("Delivery", "You deliver orders yourself", !!biz.deliveryEnabled, (v) => {
        if (!v && biz.collectEnabled === false) return Alert.alert("Keep one option", "Turn on collection first, so customers can still order.");
        onSave({ deliveryEnabled: v });
      })}
      {biz.deliveryEnabled ? (
        <View style={{ marginTop: 14 }}>
          <Text style={{ color: colors.text, fontWeight: "700", marginBottom: 6 }}>Delivery fee (R)</Text>
          <TextInput
            value={fee}
            onChangeText={(t) => setFee(t.replace(/[^\d.,]/g, ""))}
            onEndEditing={() => {
              const v = fee.trim() ? Number(fee.replace(",", ".")) : 0;
              if (!Number.isFinite(v) || v < 0 || v > 500) return Alert.alert("Check the fee", "Enter a fee from R0 to R500.");
              onSave({ deliveryFeeCents: Math.round(v * 100) });
            }}
            placeholder="0 for free delivery"
            placeholderTextColor={colors.placeholderText}
            keyboardType="decimal-pad"
            style={input}
          />
        </View>
      ) : null}
      <Text style={{ color: colors.text, fontWeight: "700", marginTop: 16, marginBottom: 6 }}>About your shop</Text>
      <TextInput
        value={desc}
        onChangeText={setDesc}
        onEndEditing={() => onSave({ description: desc.trim().slice(0, 300) })}
        placeholder="e.g. Home-made kotas and bunny chows, open till late"
        placeholderTextColor={colors.placeholderText}
        multiline
        maxLength={300}
        style={[input, { minHeight: 80, textAlignVertical: "top", paddingTop: 10 }]}
      />
      <Text style={{ color: colors.secondaryText, fontSize: 12, marginTop: 6 }}>
        To change your shop's name, address or location, contact Wiji support so we can re-verify it.
      </Text>
      <TouchableOpacity onPress={onPreview} style={{ marginTop: 20, flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Ionicons name="eye-outline" size={20} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: "700" }}>See my shop as customers do</Text>
      </TouchableOpacity>
    </View>
  );
};

/* ---------- Add / edit a menu item ---------- */
const MenuEditor = ({ uid, item, onClose, colors }: { uid: string; item: Partial<MenuItem> | null; onClose: () => void; colors: any }) => {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(item?.name || "");
    setPrice(item?.priceCents ? String(item.priceCents / 100) : "");
    setDescription(item?.description || "");
    setCategory(item?.category || "");
    setPhoto(item?.photoUrl || null);
  }, [item]);

  const pickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, allowsEditing: true, aspect: [1, 1] });
    if (!r.canceled) setPhoto(r.assets[0].uri);
  };

  const save = async () => {
    const p = Number(price.replace(",", "."));
    if (!name.trim()) return Alert.alert("Name", "Give the item a name.");
    if (!Number.isFinite(p) || p < 1 || p > 20000) return Alert.alert("Price", "Enter a price between R1 and R20,000.");
    setSaving(true);
    try {
      const id = item?.id || doc(collection(db, "businesses", uid, "menu")).id;
      let photoUrl = item?.photoUrl || null;
      if (photo && photo !== item?.photoUrl) {
        const path = `business_public/${uid}/menu/${id}.jpg`;
        await uploadBytes(ref(storage, path), await (await fetch(photo)).blob(), { contentType: "image/jpeg" });
        photoUrl = await getDownloadURL(ref(storage, path));
      }
      await setDoc(doc(db, "businesses", uid, "menu", id), {
        name: name.trim().slice(0, 80),
        priceCents: Math.round(p * 100),
        description: description.trim().slice(0, 300),
        category: category.trim().slice(0, 40),
        available: item?.available !== false,
        photoUrl: photoUrl || null,
        updatedAt: serverTimestamp(),
      });
      onClose();
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message);
    } finally {
      setSaving(false);
    }
  };

  const input = { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48, color: colors.text, marginBottom: 12 } as const;
  return (
    <Modal visible={!!item} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close" style={{ padding: 6 }}>
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8, flex: 1 }}>{item?.id ? "Edit item" : "New menu item"}</Text>
            {item?.id ? (
              <TouchableOpacity
                onPress={() =>
                  Alert.alert("Delete item?", item.name, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => deleteDoc(doc(db, "businesses", uid, "menu", item.id!)).then(onClose) },
                  ])
                }
                accessibilityLabel="Delete item"
                style={{ padding: 6 }}
              >
                <Ionicons name="trash-outline" size={22} color={colors.error} />
              </TouchableOpacity>
            ) : null}
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <TouchableOpacity onPress={pickPhoto} style={{ alignSelf: "center", marginBottom: 16 }}>
              {photo ? (
                <Image source={{ uri: photo }} style={{ width: 120, height: 120, borderRadius: 16 }} />
              ) : (
                <View style={{ width: 120, height: 120, borderRadius: 16, backgroundColor: colors.cardHighlight, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="camera-outline" size={30} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: 12, marginTop: 4 }}>Add photo</Text>
                </View>
              )}
            </TouchableOpacity>
            <TextInput value={name} onChangeText={setName} placeholder="Name, e.g. Kota with chips" placeholderTextColor={colors.placeholderText} style={input} maxLength={80} />
            <TextInput value={price} onChangeText={(t) => setPrice(t.replace(/[^\d.,]/g, ""))} placeholder="Price in Rand, e.g. 45" placeholderTextColor={colors.placeholderText} keyboardType="decimal-pad" style={input} maxLength={8} />
            <TextInput value={category} onChangeText={setCategory} placeholder="Section (optional), e.g. Mains, Drinks" placeholderTextColor={colors.placeholderText} style={input} maxLength={40} />
            <TextInput value={description} onChangeText={setDescription} placeholder="Description (optional)" placeholderTextColor={colors.placeholderText} multiline style={[input, { minHeight: 80, textAlignVertical: "top", paddingTop: 10 }]} maxLength={300} />
            <TouchableOpacity onPress={save} disabled={saving} style={{ height: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginTop: 8 }}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Save</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

/* ---------- Cancel with a reason (refunds the customer) ---------- */
const CancelOrder = ({ order, colors, onClose, onConfirm }: { order: any | null; colors: any; onClose: () => void; onConfirm: (reason: string) => void }) => {
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [order?.id]);
  return (
    <Modal visible={!!order} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: colors.background, borderRadius: 18, padding: 20 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>Cancel order #{order ? shortOrderId(order.id) : ""}?</Text>
          <Text style={{ color: colors.secondaryText, marginTop: 6 }}>The customer gets a full refund and sees your reason.</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Sorry, we've run out of chips today"
            placeholderTextColor={colors.placeholderText}
            multiline
            style={{ marginTop: 12, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 70, color: colors.text, textAlignVertical: "top" }}
          />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cardHighlight }}>
              <Text style={{ color: colors.primary, fontWeight: "700" }}>Keep order</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => (reason.trim().length >= 5 ? onConfirm(reason.trim()) : Alert.alert("Add a reason", "Tell the customer why (at least a few words)."))}
              style={{ flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.error }}
            >
              <Text style={{ color: "#fff", fontWeight: "800" }}>Cancel & refund</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default BusinessDashboardScreen;
