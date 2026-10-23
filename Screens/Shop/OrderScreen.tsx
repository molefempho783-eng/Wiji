// Order tracking for the customer: live status, what was ordered, and cancel while it's still allowed.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import { RootStackParamList } from "../../types";
import { formatRand } from "../../services/payments";
import { ORDER_STATUS, OrderStatus, shortOrderId, updateOrderStatus } from "../../services/shop";

type Route = RouteProp<RootStackParamList, "OrderScreen">;

const OrderScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { orderId } = useRoute<Route>().params;
  const [order, setOrder] = useState<any | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => onSnapshot(doc(db, "orders", orderId), (s) => setOrder(s.exists() ? { id: s.id, ...s.data() } : null), () => setOrder(null)), [orderId]);

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
      <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8 }}>
        {order ? `Order #${shortOrderId(order.id)}` : "Order"}
      </Text>
    </View>
  );

  if (order === undefined) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }
  if (!order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <Text style={{ color: colors.text, padding: 24 }}>This order couldn't be found.</Text>
      </SafeAreaView>
    );
  }

  const status = order.status as OrderStatus;
  const delivery = order.fulfilment === "delivery";
  const steps: { key: OrderStatus; label: string }[] = [
    { key: "paid", label: "Order placed" },
    { key: "preparing", label: "Preparing" },
    delivery ? { key: "out_for_delivery", label: "Out for delivery" } : { key: "ready", label: "Ready to collect" },
    { key: "completed", label: delivery ? "Delivered" : "Collected" },
  ];
  const reached = (k: OrderStatus) => {
    const order = ["paid", "preparing", delivery ? "out_for_delivery" : "ready", "completed"];
    return order.indexOf(status) >= order.indexOf(k);
  };
  const tone = ORDER_STATUS[status]?.tone || "info";
  const toneColor = { good: colors.accent, info: colors.primary, warn: colors.warning, bad: colors.error }[tone];
  const card = { backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 16, marginTop: 12 } as const;

  const cancel = () =>
    Alert.alert("Cancel this order?", status === "payment_pending" ? "You haven't paid for it yet." : `You'll get your ${formatRand(order.totalCents)} back on your card.`, [
      { text: "Keep order", style: "cancel" },
      {
        text: "Cancel order",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            const r = await updateOrderStatus(order.id, "cancelled");
            if (r.refunded) Alert.alert("Order cancelled", "Your refund is on its way. Card refunds usually take 5–10 working days.");
          } catch (e: any) {
            Alert.alert("Couldn't cancel", e.message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={{ color: colors.secondaryText, fontSize: 14 }}>{order.businessName}</Text>
        <Text style={{ color: toneColor, fontSize: 26, fontWeight: "800", marginTop: 2 }}>{ORDER_STATUS[status]?.label || status}</Text>

        {status === "cancelled" ? (
          <View style={[card, { borderColor: colors.error }]}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>
              Cancelled by {order.cancelledBy === "business" ? order.businessName : "you"}
            </Text>
            {order.cancelReason ? <Text style={{ color: colors.secondaryText, marginTop: 4 }}>“{order.cancelReason}”</Text> : null}
            {order.refunded ? <Text style={{ color: colors.text, marginTop: 6 }}>Your money is being refunded to your card (5–10 working days).</Text> : null}
          </View>
        ) : status === "payment_pending" ? (
          <View style={card}>
            <Text style={{ color: colors.text }}>This order isn't paid yet, so the shop hasn't received it.</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("PayScreen", { payeeUid: order.ownerId, amount: order.totalCents / 100, note: `Order #${shortOrderId(order.id)}`, orderId: order.id })}
              style={{ marginTop: 12, height: 50, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Pay {formatRand(order.totalCents)}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={card}>
            {steps.map((st, i) => {
              const done = reached(st.key);
              return (
                <View key={st.key} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}>
                  <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={24} color={done ? colors.accent : colors.borderColor} />
                  <Text style={{ color: done ? colors.text : colors.secondaryText, fontSize: 15, fontWeight: done ? "700" : "400" }}>{st.label}</Text>
                </View>
              );
            })}
            {status === "ready" ? (
              <Text style={{ color: colors.text, marginTop: 8, lineHeight: 20 }}>
                Go to {order.businessName} and show order number <Text style={{ fontWeight: "800" }}>#{shortOrderId(order.id)}</Text>.
              </Text>
            ) : null}
          </View>
        )}

        <View style={card}>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, marginBottom: 8 }}>Your order</Text>
          {(order.items || []).map((l: any, i: number) => (
            <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
              <Text style={{ color: colors.text, flex: 1 }}>
                {l.qty} × {l.name}
                {l.kind === "deal" ? "  (deal)" : ""}
              </Text>
              <Text style={{ color: colors.text }}>{formatRand(l.lineCents)}</Text>
            </View>
          ))}
          {order.deliveryFeeCents ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
              <Text style={{ color: colors.secondaryText }}>Delivery</Text>
              <Text style={{ color: colors.secondaryText }}>{formatRand(order.deliveryFeeCents)}</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 8, marginTop: 6, borderTopWidth: 1, borderTopColor: colors.borderColor }}>
            <Text style={{ color: colors.text, fontWeight: "800" }}>Total</Text>
            <Text style={{ color: colors.text, fontWeight: "800" }}>{formatRand(order.totalCents)}</Text>
          </View>
        </View>

        <View style={card}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name={delivery ? "bicycle" : "storefront"} size={20} color={colors.primary} />
            <Text style={{ color: colors.text, fontWeight: "700" }}>{delivery ? "Delivery" : "Collect from the shop"}</Text>
          </View>
          {delivery ? <Text style={{ color: colors.secondaryText, marginTop: 4 }}>{order.deliveryAddress}</Text> : null}
          {order.note ? <Text style={{ color: colors.secondaryText, marginTop: 4 }}>Note: {order.note}</Text> : null}
          <TouchableOpacity onPress={() => navigation.navigate("BusinessShopScreen", { businessId: order.businessId })} style={{ marginTop: 10 }}>
            <Text style={{ color: colors.primary, fontWeight: "700" }}>View shop</Text>
          </TouchableOpacity>
        </View>

        {["payment_pending", "paid"].includes(status) ? (
          <TouchableOpacity onPress={cancel} disabled={busy} style={{ marginTop: 20, alignSelf: "center", padding: 8 }}>
            {busy ? <ActivityIndicator color={colors.error} /> : <Text style={{ color: colors.error, fontWeight: "700" }}>Cancel order</Text>}
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

export default OrderScreen;
