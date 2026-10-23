// Trusted friends: up to 5 of your Wiji friends (people you chat with) who get your live trip
// and are alerted if you press the emergency button. Only you can see this list.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useTheme } from "../context/ThemeContext";
import { Friend, MAX_TRUSTED, getSafetySettings, loadFriends, saveSafetySettings } from "../../services/rides";

const TrustedContactsScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [trusted, setTrusted] = useState<string[]>([]);
  const [autoShare, setAutoShare] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([loadFriends(), getSafetySettings()])
      .then(([f, s]) => {
        setFriends(f);
        // Drop anyone who is no longer a friend
        const ids = new Set(f.map((x) => x.uid));
        setTrusted(s.trustedUids.filter((id) => ids.has(id)));
        setAutoShare(s.autoShare);
      })
      .catch(() => setFriends([]));
  }, []);

  const persist = async (nextTrusted: string[], nextAuto = autoShare) => {
    const prev = { trusted, autoShare };
    setTrusted(nextTrusted);
    setAutoShare(nextAuto);
    try {
      await saveSafetySettings({ trustedUids: nextTrusted, autoShare: nextAuto });
    } catch (e: any) {
      setTrusted(prev.trusted);
      setAutoShare(prev.autoShare);
      Alert.alert("Couldn't save", e.message);
    }
  };

  const toggle = (uid: string) => {
    if (trusted.includes(uid)) return persist(trusted.filter((x) => x !== uid));
    if (trusted.length >= MAX_TRUSTED) {
      Alert.alert("Up to 5 trusted friends", "Remove someone first to add another friend.");
      return;
    }
    persist([...trusted, uid]);
  };

  const byId = useMemo(() => new Map((friends || []).map((f) => [f.uid, f])), [friends]);
  const chosen = trusted.map((id) => byId.get(id)).filter(Boolean) as Friend[];
  const others = (friends || []).filter(
    (f) => !trusted.includes(f.uid) && f.username.toLowerCase().includes(search.trim().toLowerCase())
  );

  const row = (f: Friend, on: boolean) => (
    <TouchableOpacity
      key={f.uid}
      onPress={() => toggle(f.uid)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${on ? "Remove" : "Add"} ${f.username} ${on ? "from" : "as"} trusted friend`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: on ? colors.cardHighlight : colors.cardBackground,
        borderRadius: 14,
        borderWidth: on ? 2 : 1,
        borderColor: on ? colors.primary : colors.borderColor,
        padding: 12,
        marginTop: 10,
      }}
    >
      {f.profilePic ? (
        <Image source={{ uri: f.profilePic }} style={{ width: 40, height: 40, borderRadius: 20 }} />
      ) : (
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{f.username.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15, flex: 1 }} numberOfLines={1}>
        {f.username}
      </Text>
      <Ionicons name={on ? "checkmark-circle" : "add-circle-outline"} size={26} color={on ? colors.primary : colors.secondaryText} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", marginLeft: 8 }}>Trusted friends</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.secondaryText, fontSize: 15, lineHeight: 22 }}>
          Pick up to {MAX_TRUSTED} Wiji friends. They get a notification to follow your trip live, and are alerted straight away if you press the emergency button. Only you can see this list.
        </Text>

        {friends === null ? <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} /> : null}

        {friends && friends.length === 0 ? (
          <View style={{ marginTop: 20, backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 16, alignItems: "center" }}>
            <Ionicons name="people-outline" size={36} color={colors.primary} />
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 16, marginTop: 8, textAlign: "center" }}>No friends on Wiji yet</Text>
            <Text style={{ color: colors.secondaryText, fontSize: 14, marginTop: 4, textAlign: "center", lineHeight: 20 }}>
              Your friends are the people you chat with. Start a chat with someone you trust, then come back here to add them.
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("Tabs", { screen: "UserScreen" })}
              style={{ marginTop: 12, paddingHorizontal: 18, height: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Go to Chats</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {friends && friends.length > 0 ? (
          <>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15, marginTop: 20 }}>
              Your trusted friends ({chosen.length}/{MAX_TRUSTED})
            </Text>
            {chosen.length ? (
              chosen.map((f) => row(f, true))
            ) : (
              <Text style={{ color: colors.secondaryText, fontSize: 14, marginTop: 6 }}>None yet. Tap a friend below to add them.</Text>
            )}

            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15, marginTop: 24 }}>Your friends</Text>
            {friends.length > 6 ? (
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search friends"
                placeholderTextColor={colors.placeholderText}
                style={{ marginTop: 10, backgroundColor: colors.inputBg, borderColor: colors.inputBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 44, color: colors.text, fontSize: 15 }}
              />
            ) : null}
            {others.map((f) => row(f, false))}
            {!others.length ? <Text style={{ color: colors.secondaryText, fontSize: 14, marginTop: 6 }}>No other friends to show.</Text> : null}
          </>
        ) : null}

        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 28, backgroundColor: colors.cardBackground, borderRadius: 14, borderWidth: 1, borderColor: colors.borderColor, padding: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>Share every trip automatically</Text>
            <Text style={{ color: colors.secondaryText, fontSize: 13, marginTop: 2 }}>
              As soon as a driver is matched, your trusted friends get a notification with your driver, car and live trip.
            </Text>
          </View>
          <Switch
            value={autoShare}
            onValueChange={(v) => persist(trusted, v)}
            trackColor={{ false: colors.borderColor, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default TrustedContactsScreen;
