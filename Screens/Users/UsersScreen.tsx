// Screens/Users/UsersScreen.tsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Image,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../types";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp,
  where,
  query,
  getDoc,
  getDocs,
  updateDoc,
  arrayUnion,
} from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import createStyles, { FONT_SIZES } from "../context/appStyles";
import { TabView, SceneMap, TabBar } from "react-native-tab-view";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DEFAULT_AVATAR = require("../../assets/avatar-placeholder.png");
const PROFILE_HEADER_HINT_SEEN_KEY = "@Square_has_seen_profile_tap_hint";

type NavigationProp = StackNavigationProp<RootStackParamList, "ChatRoomScreen">;

type UserRow = {
  id: string;
  username: string;
  profilePic?: string;
  aboutMe?: string;
  profilePhotos?: string[];
};

type ChatDoc = {
  participants: string[];
  unreadFor?: Record<string, boolean>;
  unreadCount?: Record<string, number>;
  lastMessageText?: string;
  lastMessageSenderId?: string;
  lastMessageTimestamp?: any;
};

type ConversationRow = {
  chatId: string;
  otherId: string;
  lastMessageText?: string;
  lastMessageTimestamp?: any;
  unreadCount: number;
};

const UsersScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const { colors } = useTheme();
  const styles = createStyles(colors).usersScreen;
  const globalStyles = createStyles(colors).global;

  const [index, setIndex] = useState(0);
  const [routes] = useState([
    { key: "friends", title: "Friends" },
    { key: "explore", title: "Explore" },
  ]);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadByUser, setUnreadByUser] = useState<Record<string, boolean>>({});
  const [unreadCountByUser, setUnreadCountByUser] = useState<Record<string, number>>({});
  const [previewByUser, setPreviewByUser] = useState<
    Record<string, { text?: string; senderId?: string; ts?: any }>
  >({});
  const [currentUserData, setCurrentUserData] = useState<UserRow | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [showProfileTapHint, setShowProfileTapHint] = useState<boolean | null>(null);

  const { user: currentUser } = useAuth();

  /** One-time hint: "Tap to edit profile" - only show until user has tapped header once */
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(PROFILE_HEADER_HINT_SEEN_KEY);
        if (mounted) setShowProfileTapHint(seen !== "true");
      } catch {
        if (mounted) setShowProfileTapHint(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  /** 🟢 Load users function (reusable for refresh) */
  const loadUsers = useCallback(() => {
    if (!currentUser) return () => {};

    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: UserRow[] = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((u) => u.id !== currentUser.uid);
        list.sort((a, b) =>
          String(a.username || "").localeCompare(String(b.username || ""))
        );
        setUsers(list);
        setLoading(false);
        setRefreshing(false);
      },
      (err) => {
        console.error("Users load error", err);
        setLoading(false);
        setRefreshing(false);
      }
    );

    return unsub;
  }, [currentUser]);

  /** 🟢 Real-time all users listener */
  useFocusEffect(
    useCallback(() => {
      if (!currentUser) return;
      return loadUsers();
    }, [currentUser, loadUsers])
  );

  /** Pull to refresh handler */
  const onRefresh = useCallback(() => {
    if (!currentUser) return;
    setRefreshing(true);
    // Trigger reload by unsubscribing and resubscribing
    loadUsers();
  }, [currentUser, loadUsers]);


  /** 👤 Fetch current user's profile (for header progress + avatar) */
  const fetchCurrentUserProfile = useCallback(async () => {
    if (!currentUser) return;
    try {
      const docRef = doc(db, "users", currentUser.uid);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setCurrentUserData({ ...(snap.data() as UserRow), id: currentUser.uid });
      }
    } catch (err) {
      console.error("Error fetching user profile:", err);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchCurrentUserProfile();
  }, [fetchCurrentUserProfile]);

  useFocusEffect(
    useCallback(() => {
      fetchCurrentUserProfile();
    }, [fetchCurrentUserProfile])
  );

  /** Chats list from user doc chatIds + per-chat-doc listeners (does not rely on collection query) */
  const [chatDocsByChatId, setChatDocsByChatId] = useState<Record<string, ConversationRow>>({});

  /** 🔄 Listen to current user doc for chatIds, then subscribe to each chat doc */
  useEffect(() => {
    if (!currentUser) {
      setChatDocsByChatId({});
      return;
    }

    const chatUnsubs: Record<string, () => void> = {};
    const userRef = doc(db, "users", currentUser.uid);

    const unsubscribeUser = onSnapshot(userRef, (userSnap) => {
      let chatIds: string[] = userSnap.exists()
        ? (userSnap.data().chatIds as string[] | undefined) ?? []
        : [];
      if (!Array.isArray(chatIds)) chatIds = [];

      if (chatIds.length === 0) {
        getDocs(query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid)))
          .then((snap) => {
            if (snap.empty) return;
            const ids = snap.docs.map((d) => d.id);
            if (ids.length === 0) return;
            updateDoc(userRef, { chatIds: ids }).catch(() => {});
          })
          .catch(() => {});
      }

      const currentSet = new Set(chatIds);
      Object.keys(chatUnsubs).forEach((id) => {
        if (!currentSet.has(id)) {
          chatUnsubs[id]();
          delete chatUnsubs[id];
          setChatDocsByChatId((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
      });

      chatIds.forEach((chatId) => {
        if (chatUnsubs[chatId]) return;
        const chatRef = doc(db, "chats", chatId);
        chatUnsubs[chatId] = onSnapshot(chatRef, (chatSnap) => {
          if (!chatSnap.exists()) {
            setChatDocsByChatId((prev) => {
              const next = { ...prev };
              delete next[chatId];
              return next;
            });
            return;
          }
          const data = chatSnap.data() as ChatDoc;
          const participants = data?.participants;
          const otherId = Array.isArray(participants)
            ? participants.find((p: string) => p !== currentUser.uid)
            : participants && typeof participants === "object"
              ? Object.keys(participants).find((k) => k !== currentUser.uid)
              : undefined;
          if (!otherId) return;
          const countVal = data?.unreadCount?.[currentUser.uid];
          const myUnread = data?.unreadFor?.[currentUser.uid] === true;
          const unreadCount =
            typeof countVal === "number" && countVal >= 0 ? countVal : myUnread ? 1 : 0;
          const row: ConversationRow = {
            chatId,
            otherId,
            lastMessageText: data?.lastMessageText,
            lastMessageTimestamp: data?.lastMessageTimestamp,
            unreadCount,
          };
          setChatDocsByChatId((prev) => ({ ...prev, [chatId]: row }));
        });
      });
    });

    return () => {
      unsubscribeUser();
      Object.values(chatUnsubs).forEach((u) => u());
    };
  }, [currentUser]);

  /** Derived sorted conversations + update preview/unread maps for Friends/Explore */
  useEffect(() => {
    const list = Object.values(chatDocsByChatId).sort((a, b) => {
      const aMs = a.lastMessageTimestamp?.toMillis?.() ?? (a.lastMessageTimestamp?.seconds != null ? a.lastMessageTimestamp.seconds * 1000 : 0);
      const bMs = b.lastMessageTimestamp?.toMillis?.() ?? (b.lastMessageTimestamp?.seconds != null ? b.lastMessageTimestamp.seconds * 1000 : 0);
      return bMs - aMs;
    });
    setConversations(list);
    const unreadMap: Record<string, boolean> = {};
    const unreadCountMap: Record<string, number> = {};
    const previews: Record<string, { text?: string; senderId?: string; ts?: any }> = {};
    list.forEach((row) => {
      unreadCountMap[row.otherId] = row.unreadCount;
      unreadMap[row.otherId] = row.unreadCount > 0;
      previews[row.otherId] = { text: row.lastMessageText, ts: row.lastMessageTimestamp };
    });
    setUnreadByUser(unreadMap);
    setUnreadCountByUser(unreadCountMap);
    setPreviewByUser(previews);
  }, [chatDocsByChatId]);

  /** Friends tab = people with existing chat history */
  const friends = useMemo(() => {
    const ids = new Set(conversations.map((row) => row.otherId));
    return users.filter((u) => ids.has(u.id));
  }, [users, conversations]);

  /** 🔍 Search filter logic */
  const filteredList = (base: UserRow[]) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (u) =>
        String(u.username || "").toLowerCase().includes(q) ||
        String(u.aboutMe || "").toLowerCase().includes(q)
    );
  };

const exploreUsers = useMemo(() => {
  // Collect IDs of friends
  const friendIds = new Set(friends.map((u) => u.id));

  // Show all users except friends and self
  let filtered = users.filter(
    (u) => !friendIds.has(u.id) && u.id !== currentUser?.uid
  );

  // Debug logging
  if (__DEV__) {
    console.log(`Explore tab: ${filtered.length} users (out of ${users.length} total, ${friends.length} with chat history)`);
  }

  // Apply search
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (u) =>
        String(u.username || "").toLowerCase().includes(q) ||
        String(u.aboutMe || "").toLowerCase().includes(q)
    );
  }

  return filtered;
}, [users, friends, searchQuery, currentUser]);

  /** 💬 Start chat — create doc, add chatId to both users’ lists, then navigate */
  const handleStartChat = async (user: UserRow) => {
    if (!currentUser) return;
    try {
      const chatId = [currentUser.uid, user.id].sort().join("_");
      const chatRef = doc(db, "chats", chatId);
      await setDoc(chatRef, {
        participants: [currentUser.uid, user.id],
        createdAt: serverTimestamp(),
        unreadFor: { [currentUser.uid]: false, [user.id]: false },
        unreadCount: { [currentUser.uid]: 0, [user.id]: 0 },
      }, { merge: true });
      await updateDoc(doc(db, "users", currentUser.uid), { chatIds: arrayUnion(chatId) });
      try {
        await updateDoc(doc(db, "users", user.id), { chatIds: arrayUnion(chatId) });
      } catch (_) {
        // Recipient’s doc may restrict updates; Cloud Function will add when message is sent
      }
      navigation.navigate("ChatRoomScreen", { chatId, recipientId: user.id });
    } catch (e: any) {
      console.error("Error starting chat:", e);
      console.error("Could not start chat:", e?.message);
    }
  };

  /** 🧩 Render each user row */
  const renderRow = ({ item }: { item: UserRow }) => {
    const unreadBool = !!unreadByUser[item.id];
    const count = unreadCountByUser[item.id];
    const unreadCount = typeof count === "number" ? count : (unreadBool ? 1 : 0);
    const hasUnread = unreadCount > 0 || unreadBool;
    const preview = previewByUser[item.id];

    return (
      <TouchableOpacity
        style={styles.userCard}
        onPress={() => handleStartChat(item)}
      >
        {item.profilePic ? (
          <Image source={{ uri: item.profilePic }} style={styles.memberAvatar} />
        ) : (
          <View style={[styles.memberAvatar, styles.memberAvatarFallback]}>
            <Text style={styles.memberAvatarFallbackText}>
              {item.username?.charAt(0).toUpperCase() || "?"}
            </Text>
          </View>
        )}

        <View style={styles.userCardContent}>
          <Text style={styles.userCardUsername}>{item.username}</Text>
          <Text style={styles.lastMessagePreview} numberOfLines={1}>
            {(preview?.text != null && String(preview.text).trim() !== "")
              ? String(preview.text).trim()
              : (item.aboutMe?.trim() || "Tap to start chat")}
          </Text>
        </View>

        {hasUnread && (
          <View
            style={{
              minWidth: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: "#E53935",
              marginLeft: 8,
              paddingHorizontal: 6,
              justifyContent: "center",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "700" }}>
              {unreadCount > 99 ? "99+" : String(unreadCount)}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  /** 🧩 Render explore user row */
  const renderExploreRow = ({ item }: { item: UserRow }) => {
    const unreadBool = !!unreadByUser[item.id];
    const count = unreadCountByUser[item.id];
    const unreadCount = typeof count === "number" ? count : (unreadBool ? 1 : 0);
    const hasUnread = unreadCount > 0 || unreadBool;
    const preview = previewByUser[item.id];
    
    return (
      <TouchableOpacity
        style={styles.userCard}
        onPress={() => handleStartChat(item)}
      >
        {item.profilePic ? (
          <Image source={{ uri: item.profilePic }} style={styles.memberAvatar} />
        ) : (
          <View style={[styles.memberAvatar, styles.memberAvatarFallback]}>
            <Text style={styles.memberAvatarFallbackText}>
              {item.username?.charAt(0).toUpperCase() || "?"}
            </Text>
          </View>
        )}

        <View style={styles.userCardContent}>
          <Text style={styles.userCardUsername}>{item.username}</Text>
          <Text style={styles.lastMessagePreview} numberOfLines={1}>
            {(preview?.text != null && String(preview.text).trim() !== "")
              ? String(preview.text).trim()
              : (item.aboutMe?.trim() || "Tap to chat")}
          </Text>
        </View>

        {hasUnread && (
          <View
            style={{
              minWidth: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: "#E53935",
              marginLeft: 8,
              paddingHorizontal: 6,
              justifyContent: "center",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "700" }}>
              {unreadCount > 99 ? "99+" : String(unreadCount)}
            </Text>
          </View>
        )}

      </TouchableOpacity>
    );
  };

  /** 🧭 Tab scenes */
  const FriendsRoute = () => (
    <View style={{ flex: 1 }}>
      <TextInput
        style={styles.searchBar}
        placeholder="Search chats..."
        placeholderTextColor={colors.placeholderText as string}
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {loading && !refreshing ? (
        <View style={globalStyles.centeredContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredList(friends)}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          ListEmptyComponent={
            <Text style={styles.noResultsText}>
              No chats yet. Start a chat from Explore to see people here.
            </Text>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </View>
  );

  const ExploreRoute = () => (
    <View style={{ flex: 1 }}>
      <TextInput
        style={styles.searchBar}
        placeholder="Search all users..."
        placeholderTextColor={colors.placeholderText as string}
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {loading && !refreshing ? (
        <View style={globalStyles.centeredContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredList(exploreUsers)}
          keyExtractor={(item) => item.id}
          renderItem={renderExploreRow}
          ListEmptyComponent={
            <Text style={styles.noResultsText}>No users found.</Text>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </View>
  );

  const renderScene = SceneMap({
    friends: FriendsRoute,
    explore: ExploreRoute,
  });

  /** Profile strength (Tinder-style: profile photo + 6 photos + about = 8) */
  const profileCompleted =
    (currentUserData?.profilePic ? 1 : 0) +
    Math.min(currentUserData?.profilePhotos?.length ?? 0, 6) +
    (currentUserData?.aboutMe?.trim() ? 1 : 0);
  const profileTotal = 8;
  const profileProgress = profileTotal > 0 ? profileCompleted / profileTotal : 0;

  /** 🖥 UI */
  return (
    <SafeAreaView style={globalStyles.safeArea} edges={["top", "left", "right"]}>
      {/* Header with Profile Pic and profile strength bar - whole header taps to Profile */}
      <TouchableOpacity
        style={styles.headerContainer}
        onPress={async () => {
          if (showProfileTapHint) {
            try {
              await AsyncStorage.setItem(PROFILE_HEADER_HINT_SEEN_KEY, "true");
            } catch {}
            setShowProfileTapHint(false);
          }
          navigation.navigate("ProfileScreen");
        }}
        activeOpacity={0.8}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.pageTitle} numberOfLines={1}>
            {currentUserData?.username || currentUser?.displayName || currentUser?.email?.split("@")[0] || "User"}
          </Text>
          <View style={styles.headerProgressRow}>
            <View
              style={[
                styles.headerProgressBg,
                { backgroundColor: colors.borderColor || "#e0e0e0" },
              ]}
            >
              <View
                style={[
                  styles.headerProgressFill,
                  {
                    width: `${Math.round(profileProgress * 100)}%`,
                    backgroundColor: colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={[styles.headerProgressText, { color: colors.primary }]}>
              {profileCompleted}/{profileTotal}
            </Text>
          </View>
        </View>

        <View style={{ marginLeft: 12 }}>
          {currentUserData?.profilePic ? (
            <Image
              source={{ uri: currentUserData.profilePic }}
              style={styles.memberAvatar}
            />
          ) : (
            <View
              style={[styles.memberAvatar, styles.memberAvatarFallback]}
            >
              <Text style={styles.memberAvatarFallbackText}>
                {currentUserData?.username?.charAt(0).toUpperCase() || "?"}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {showProfileTapHint === true && (
        <View
          style={{
            position: 'absolute',
            top: 56,
            left: 16,
            right: 16,
            alignItems: 'center',
            zIndex: 10,
          }}
          pointerEvents="box-none"
        >
          {/* Pointer (triangle) pointing up at the header */}
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: 8,
              borderRightWidth: 8,
              borderBottomWidth: 10,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: colors.primary + '22',
              alignSelf: 'center',
            }}
          />
          <View
            style={{
              backgroundColor: colors.primary + '22',
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 16,
              borderTopRightRadius: 4,
              borderTopLeftRadius: 4,
              maxWidth: 280,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.15,
              shadowRadius: 6,
              elevation: 4,
            }}
          >
            <Text style={{ fontSize: 13, color: colors.text }}>
              Tap above to edit your profile
            </Text>
          </View>
        </View>
      )}

      <TabView
        navigationState={{ index, routes }}
        renderScene={renderScene}
        onIndexChange={setIndex}
        swipeEnabled
        initialLayout={{ width: 360 }}
        renderTabBar={(props) => (
          <TabBar
            {...props}
            style={{
              backgroundColor: colors.background,
              elevation: 0,
              borderBottomWidth: 1,
              borderBottomColor: colors.borderColor,
            }}
            indicatorStyle={{ height: 3, backgroundColor: colors.primary }}
            activeColor={colors.primary}
            inactiveColor={colors.secondaryText}
          />
        )}
      />
    </SafeAreaView>
  );
};

export default UsersScreen;
