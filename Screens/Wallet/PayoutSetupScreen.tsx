// Drivers and businesses add the bank account they get paid into (a Paystack subaccount).
// Whether someone is paid as a driver or a business comes from Wiji's records (approved driver
// or not); the server decides it too, so it can't be changed from the app.
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
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
import { useNavigation } from "@react-navigation/native";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import createStyles from "../context/appStyles";
import { AccountType, Bank, listBanks, registerPayee } from "../../services/payments";

const ACCOUNT_TYPES: { key: AccountType; label: string }[] = [
  { key: "cheque", label: "Cheque / current" },
  { key: "savings", label: "Savings" },
  { key: "transmission", label: "Transmission" },
];

const PayoutSetupScreen = () => {
  const { colors } = useTheme();
  const globalStyles = createStyles(colors).global;
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const [role, setRole] = useState<"driver" | "merchant" | "personal" | null>(null);
  const [existing, setExisting] = useState<any | null>(null);
  const [name, setName] = useState("");
  const [holder, setHolder] = useState("");
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [account, setAccount] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksError, setBanksError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listBanks().then(setBanks).catch((e) => setBanksError(e.message));
  }, []);

  // Role from Firebase: approved driver -> driver, otherwise business
  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;
    let filled = false;
    const unsub = onSnapshot(
      doc(db, "drivers", uid),
      async (s) => {
        const drv = s.data();
        const biz = (await getDoc(doc(db, "business_verifications", uid)).catch(() => null))?.data();
        const r = drv?.verified ? "driver" : ["verified", "suspended"].includes(biz?.status) ? "merchant" : "personal";
        setRole(r);
        if (filled) return;
        filled = true;
        const payee = (await getDoc(doc(db, "payees", uid)).catch(() => null))?.data() || null;
        setExisting(payee);
        if (payee) {
          setName(payee.businessName || "");
          setHolder(payee.accountHolder || "");
          setAccountType(payee.accountType || null);
        } else if (r === "driver") {
          setName(drv?.firstName || "");
        } else if (r === "merchant") {
          if (biz?.details?.tradingName) setName(biz.details.tradingName);
        } else {
          const me = (await getDoc(doc(db, "users", uid)).catch(() => null))?.data();
          if (me?.username) setName(me.username);
        }
      },
      () => setRole("personal")
    );
    return unsub;
  }, [user?.uid]);

  // Pre-select the saved bank once the list has loaded
  useEffect(() => {
    if (!bank && existing?.bankCode && banks.length) setBank(banks.find((b) => b.code === existing.bankCode) || null);
  }, [banks, existing?.bankCode]);

  const filtered = useMemo(
    () => banks.filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase())),
    [banks, search]
  );

  const errors = {
    name: name.trim().length < 2 ? (role === "merchant" ? "Enter your business name." : "Enter your name.") : "",
    holder: holder.trim().length < 3 ? "Enter the name on the bank account, exactly as your bank has it." : "",
    accountType: !accountType ? "Choose the account type." : "",
    bank: !bank ? "Choose your bank." : "",
    account: !/^\d{6,16}$/.test(account) ? "Account numbers are 6 to 16 digits, with no spaces." : "",
    confirm: confirm !== account ? "The account numbers don't match." : "",
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (k: keyof typeof errors) => (touched[k] && errors[k] ? errors[k] : "");

  const save = async () => {
    setTouched({ name: true, holder: true, accountType: true, bank: true, account: true, confirm: true });
    if (!valid || !bank || !accountType) return;
    setSaving(true);
    try {
      await registerPayee({
        businessName: name.trim(),
        accountHolder: holder.trim(),
        accountType,
        bankCode: bank.code,
        bankName: bank.name,
        accountNumber: account,
      });
      {
        Alert.alert(existing ? "Payout details updated" : "You're ready to get paid", "Your pay code is in the Wallet tab.", [
          { text: "OK", onPress: () => navigation.goBack() },
        ]);
      }
    } catch (e: any) {
      Alert.alert("Couldn't save payout details", e.message);
    } finally {
      setSaving(false);
    }
  };

  const label = { color: colors.text, fontSize: 14, fontWeight: "700" as const, marginBottom: 8, marginTop: 20 };
  const input = (err?: string) =>
    ({
      backgroundColor: colors.inputBg,
      borderColor: err ? colors.error : colors.inputBorder,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 14,
      height: 52,
      color: colors.text,
      fontSize: 16,
    }) as const;
  const errText = (msg: string) => (msg ? <Text style={{ color: colors.error, fontSize: 13, marginTop: 6 }}>{msg}</Text> : null);

  if (!role) {
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={globalStyles.safeArea}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8 }}>{existing ? "Payout details" : "Set up payouts"}</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* Who you're paid as (from Wiji's records) */}
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: colors.cardHighlight, borderRadius: 16, padding: 14 }}>
            <Ionicons name={role === "driver" ? "car" : role === "merchant" ? "storefront" : "person"} size={26} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>
                {role === "driver" ? "Getting paid as a verified driver" : role === "merchant" ? "Getting paid as a verified business" : "Getting paid by other Wiji users"}
              </Text>
              <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 2, lineHeight: 18 }}>
                {role === "driver"
                  ? "Riders pay you by card in Wiji, and Paystack pays it into this account, minus a small Wiji fee."
                  : role === "merchant"
                  ? "Customers pay for your menu and deals in Wiji, and Paystack pays it into this account, minus a small Wiji fee."
                  : "Friends and other users can pay you by card using your pay code. Paystack pays it into this account, minus a small Wiji fee."}
              </Text>
            </View>
          </View>
          {role === "personal" ? (
            <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 10, lineHeight: 18 }}>
              Drive or run a business? Apply to drive from Get a ride, or tap the deals button on the Map to verify your business.
            </Text>
          ) : null}

          {existing ? (
            <Text style={{ color: colors.secondaryText, fontSize: 14, marginTop: 16 }}>
              Currently paid into {existing.bankName || "your bank"} ••• {existing.accountLast4}. To change it, enter the new details below.
            </Text>
          ) : null}

          <Text style={label}>{role === "merchant" ? "Business name (shown to customers)" : role === "driver" ? "Your name (shown to riders)" : "Your name (shown to people who pay you)"}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            placeholder={role === "merchant" ? "e.g. Mama's Kota Corner" : "e.g. Thabo M."}
            placeholderTextColor={colors.placeholderText}
            style={input(show("name"))}
            maxLength={80}
          />
          {errText(show("name"))}

          <Text style={label}>Bank</Text>
          <TouchableOpacity
            onPress={() => setPickerOpen(true)}
            style={[input(show("bank")), { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
            accessibilityRole="button"
          >
            <Text style={{ color: bank ? colors.text : colors.placeholderText, fontSize: 16 }}>{bank?.name || "Choose your bank"}</Text>
            <Ionicons name="chevron-down" size={20} color={colors.secondaryText} />
          </TouchableOpacity>
          {banksError ? errText(`Couldn't load banks: ${banksError}`) : errText(show("bank"))}

          <Text style={label}>Account holder name</Text>
          <TextInput
            value={holder}
            onChangeText={setHolder}
            onBlur={() => setTouched((t) => ({ ...t, holder: true }))}
            placeholder="As it appears on your bank statement"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="words"
            style={input(show("holder"))}
            maxLength={80}
          />
          {errText(show("holder"))}

          <Text style={label}>Account type</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {ACCOUNT_TYPES.map((t) => {
              const on = accountType === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => {
                    setAccountType(t.key);
                    setTouched((x) => ({ ...x, accountType: true }));
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={{
                    paddingHorizontal: 14,
                    height: 42,
                    justifyContent: "center",
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: on ? colors.primary : colors.borderColor,
                    backgroundColor: on ? colors.cardHighlight : colors.cardBackground,
                  }}
                >
                  <Text style={{ color: on ? colors.primary : colors.text, fontWeight: "700" }}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {errText(show("accountType"))}

          <Text style={label}>Account number</Text>
          <TextInput
            value={account}
            onChangeText={(t) => setAccount(t.replace(/[^\d]/g, ""))}
            onBlur={() => setTouched((t) => ({ ...t, account: true }))}
            placeholder="Digits only"
            placeholderTextColor={colors.placeholderText}
            keyboardType="number-pad"
            style={input(show("account"))}
            maxLength={16}
          />
          {errText(show("account"))}

          <Text style={label}>Confirm account number</Text>
          <TextInput
            value={confirm}
            onChangeText={(t) => setConfirm(t.replace(/[^\d]/g, ""))}
            onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
            placeholder="Type it again"
            placeholderTextColor={colors.placeholderText}
            keyboardType="number-pad"
            contextMenuHidden
            style={input(show("confirm"))}
            maxLength={16}
          />
          {errText(show("confirm"))}
          {!show("confirm") && confirm.length >= 6 && confirm === account ? (
            <Text style={{ color: colors.accent, fontSize: 13, marginTop: 6 }}>✓ Account numbers match</Text>
          ) : null}

          <Text style={{ color: colors.secondaryText, fontSize: 13, lineHeight: 19, marginTop: 20 }}>
            Payouts go to exactly this account, so double-check it. If you change it later, the Wiji team is told so we can check it was really you. Paystack may ask for more details to verify your identity.
          </Text>

          <TouchableOpacity
            onPress={save}
            disabled={saving}
            style={{
              marginTop: 20,
              height: 54,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: valid ? colors.primary : colors.borderColor,
            }}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Save payout details</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={[globalStyles.safeArea, { padding: 16 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search banks"
              placeholderTextColor={colors.placeholderText}
              style={[input(), { flex: 1 }]}
              autoFocus
            />
          </View>
          {banks.length === 0 && !banksError ? <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} /> : null}
          <FlatList
            data={filtered}
            keyExtractor={(b) => b.code + b.name}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  setBank(item);
                  setTouched((t) => ({ ...t, bank: true }));
                  setPickerOpen(false);
                  setSearch("");
                }}
                style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderColor }}
              >
                <Text style={{ color: colors.text, fontSize: 16 }}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

export default PayoutSetupScreen;
