import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  FlatList,
  Modal,
  Switch,
} from "react-native";
import { RouteProp, useRoute, useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../../types";
import { db, auth } from "../../../firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../context/ThemeContext";
import createStyles, { FONT_SIZES } from "../../context/appStyles";

interface GroupTransaction {
  id: string;
  userId: string;
  username?: string;
  type: "DEPOSIT" | "WITHDRAWAL";
  amount: number;
  createdAt: any;
  method?: "wallet" | "paypal";
  gross?: number;
  grossCurrency?: string;
}

const GroupWalletScreen = () => {
  const route = useRoute<RouteProp<RootStackParamList, "GroupWalletScreen">>();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { groupId, groupName, communityId } = route.params;

  const { colors } = useTheme();
  const styles = createStyles(colors).groupWalletScreen;
  const globalStyles = createStyles(colors).global;
  const functions = getFunctions();
  const depositToGroupWallet = httpsCallable(functions, "depositToGroupWallet");

  const [balance, setBalance] = useState<number | null>(null);
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<GroupTransaction[]>([]);
  const [visibility, setVisibility] = useState({
    showBalance: true,
    showAnalytics: true,
    showTransactions: true,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [depositing, setDepositing] = useState(false);
  const currentUser = auth.currentUser;

  // ✅ Fetch wallet info
  useEffect(() => {
    const walletRef = doc(db, "groupWallets", groupId);
    const unsubscribe = onSnapshot(walletRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setBalance(data.balance ?? 0);
        setCreatorId(data.createdBy || null);
        setVisibility(
          data.visibility || {
            showBalance: true,
            showAnalytics: true,
            showTransactions: true,
          }
        );
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [groupId]);

  // ✅ Fetch transactions
  useEffect(() => {
    const txRef = collection(db, "groupWallets", groupId, "transactions");
    const q = query(txRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const txs = snap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as GroupTransaction[];
      setTransactions(txs);
    });
    return () => unsub();
  }, [groupId]);

  // ✅ Deposit handler
  const handleDeposit = async (method: "wallet" | "paypal") => {
    setDepositing(true);
    try {
      const amount = 50;
      const result: any = await depositToGroupWallet({ groupId, amount, method });
      if (result.data?.ok)
        Alert.alert("Success", `Deposited R${amount} via ${method}`);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Deposit failed.");
    } finally {
      setDepositing(false);
    }
  };

  // ✅ Toggle visibility and update Firestore
  const toggleVisibility = async (field: keyof typeof visibility) => {
    const walletRef = doc(db, "groupWallets", groupId);
    const newValue = !visibility[field];
    setVisibility((prev) => ({ ...prev, [field]: newValue }));
    try {
      await updateDoc(walletRef, { [`visibility.${field}`]: newValue });
    } catch (err) {
      console.error("Visibility update error:", err);
    }
  };

  // ✅ Group analytics
  const analytics = useMemo(() => {
    const totalDeposits = transactions
      .filter((tx) => tx.type === "DEPOSIT")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const uniqueUsers = new Set(transactions.map((tx) => tx.userId)).size;
    return { totalDeposits, totalTx: transactions.length, uniqueUsers };
  }, [transactions]);

  if (loading) {
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textPrimary }}>Loading wallet...</Text>
      </View>
    );
  }

  const isCreator = creatorId === currentUser?.uid;

  return (
    <View style={[styles.safeArea, { flex: 1 }]}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons
            name="arrow-back"
            size={FONT_SIZES.xxlarge}
            color={colors.textPrimary}
          />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>{groupName} Wallet</Text>

        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {/* Info Button */}
          <TouchableOpacity
            onPress={() =>
              navigation.navigate("GroupDetailsScreen", {
                groupId,
                groupName,
                communityId,
              })
            }
            style={{ marginRight: 15 }}
          >
            <Ionicons
              name="information-circle-outline"
              size={FONT_SIZES.xxlarge}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          {/* ⚙️ Settings (creator only) */}
          {isCreator && (
            <TouchableOpacity
              onPress={() => setShowSettings(true)}
              style={{ marginRight: 10 }}
            >
              <Ionicons
                name="settings-outline"
                size={FONT_SIZES.xxlarge}
                color={colors.textPrimary}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Main Content */}
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* Balance */}
        {visibility.showBalance && (
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Current Balance</Text>
            <Text style={styles.balanceValue}>
              R{(balance ?? 0).toFixed(2)}
            </Text>
          </View>
        )}

        {/* Deposit Buttons */}
        <View style={styles.depositContainer}>
          <TouchableOpacity
            style={[styles.depositButton, { backgroundColor: colors.primary }]}
            onPress={() => handleDeposit("wallet")}
            disabled={depositing}
          >
            <Text style={styles.depositButtonText}>
              Deposit R50 (Wallet)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.depositButton, { backgroundColor: "#0070BA" }]}
            onPress={() => handleDeposit("paypal")}
            disabled={depositing}
          >
            <Text style={styles.depositButtonText}>
              Deposit R50 (PayPal)
            </Text>
          </TouchableOpacity>
        </View>

        {/* Analytics Section */}
        {visibility.showAnalytics && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.historyTitle}>📊 Group Analytics</Text>
            <Text style={styles.analyticsText}>
              Total Deposits: R{analytics.totalDeposits.toFixed(2)}
            </Text>
            <Text style={styles.analyticsText}>
              Unique Contributors: {analytics.uniqueUsers}
            </Text>
            <Text style={styles.analyticsText}>
              Total Transactions: {analytics.totalTx}
            </Text>
          </View>
        )}

        {/* Transactions Section */}
        {visibility.showTransactions && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.historyTitle}>💸 Recent Transactions</Text>
            <FlatList
              data={transactions}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const displayName =
                  item.username ||
                  (item.userId ? item.userId.slice(0, 10) + "..." : "Unknown");
                const amountValue = Number(item.amount ?? item.gross ?? 0).toFixed(2);
                return (
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingVertical: 10,
                      borderBottomWidth: 0.6,
                      borderColor: colors.border,
                    }}
                  >
                    <TouchableOpacity
                      onPress={() =>
                        navigation.navigate("UserProfileScreen", {
                          userId: item.userId,
                        })
                      }
                    >
                      <Text
                        style={{
                          color: colors.primary,
                          fontWeight: "600",
                        }}
                      >
                        {displayName}
                      </Text>
                    </TouchableOpacity>
                    <Text
                      style={{
                        color:
                          item.type === "DEPOSIT" ? "#22c55e" : "#ef4444",
                        fontWeight: "700",
                      }}
                    >
                      {item.type === "DEPOSIT" ? "+" : "-"}R{amountValue}
                    </Text>
                  </View>
                );
              }}
            />
          </View>
        )}
      </ScrollView>

      {/* ⚙️ Visibility Settings Modal */}
      <Modal visible={showSettings} transparent animationType="slide">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View
            style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 12,
              padding: 20,
              width: "85%",
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "700",
                marginBottom: 12,
                color: colors.textPrimary,
              }}
            >
              Visibility Settings
            </Text>
              {/* Fixed list — options never disappear */}
<View
  style={{
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  }}
>
  <Text style={{ color: colors.textPrimary, fontSize: 16 }}>
    Show Balance
  </Text>
  <Switch
    value={visibility.showBalance}
    onValueChange={() => toggleVisibility("showBalance")}
  />
</View>

<View
  style={{
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  }}
>
  <Text style={{ color: colors.textPrimary, fontSize: 16 }}>
    Show Analytics
  </Text>
  <Switch
    value={visibility.showAnalytics}
    onValueChange={() => toggleVisibility("showAnalytics")}
  />
</View>

<View
  style={{
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  }}
>
  <Text style={{ color: colors.textPrimary, fontSize: 16 }}>
    Show Transactions
  </Text>
  <Switch
    value={visibility.showTransactions}
    onValueChange={() => toggleVisibility("showTransactions")}
  />
</View>

        

            <TouchableOpacity
              onPress={() => setShowSettings(false)}
              style={{ marginTop: 15, alignSelf: "flex-end" }}
            >
              <Text style={{ color: colors.primary, fontWeight: "600" }}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default GroupWalletScreen;
