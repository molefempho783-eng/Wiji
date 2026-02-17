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
  Alert,
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
  orderBy,
  updateDoc,
  limit,
  arrayUnion,
  writeBatch,
} from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import createStyles, { FONT_SIZES } from "../context/appStyles";
import { TabView, SceneMap, TabBar } from "react-native-tab-view";

const DEFAULT_AVATAR = require("../../assets/avatar-placeholder.png");

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
  const [friends, setFriends] = useState<UserRow[]>([]);
  const [friendRequests, setFriendRequests] = useState<Set<string>>(new Set()); // Users who sent friend requests to current user
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

  const { user: currentUser } = useAuth();

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

  /** 🔄 Load friends from user document */
  useEffect(() => {
    if (!currentUser) return;

    const userRef = doc(db, "users", currentUser.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const friendsData = snap.data().friends;
        let friendsList: string[] = [];
        
        // Handle both array (legacy) and map (new) formats
        if (Array.isArray(friendsData)) {
          friendsList = friendsData;
        } else if (friendsData && typeof friendsData === 'object') {
          // Map format: { [userId]: true }
          friendsList = Object.keys(friendsData).filter(uid => friendsData[uid] === true);
        }
        
        const friendsDataList = users.filter((u) => friendsList.includes(u.id));
        setFriends(friendsDataList);
      }
    });

    return unsub;
  }, [currentUser, users]);

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

  /** Friend requests (from first-message check) — run once when we have chat docs */
  useEffect(() => {
    if (!currentUser || Object.keys(chatDocsByChatId).length === 0) return;
    const requestSenderIds = new Set<string>();
    (async () => {
      try {
        const friendsUserRef = doc(db, "users", currentUser.uid);
        const friendsUserSnap = await getDoc(friendsUserRef);
        const friendsData = friendsUserSnap.exists() ? friendsUserSnap.data()?.friends ?? null : null;
        let friendsList: string[] = [];
        if (Array.isArray(friendsData)) friendsList = friendsData;
        else if (friendsData && typeof friendsData === "object") friendsList = Object.keys(friendsData).filter((uid) => friendsData[uid] === true);
        const chatIds = Object.keys(chatDocsByChatId);
        for (const chatId of chatIds) {
          const row = chatDocsByChatId[chatId];
          if (!row || friendsList.includes(row.otherId)) continue;
          try {
            const messagesRef = collection(db, "chats", chatId, "messages");
            const messagesSnap = await getDocs(query(messagesRef, orderBy("createdAt", "asc"), limit(1)));
            if (messagesSnap.docs.length > 0) {
              const firstMessage = messagesSnap.docs[0].data();
              const firstSenderId = firstMessage.senderId || firstMessage.senderUid;
              if (firstSenderId === row.otherId) requestSenderIds.add(row.otherId);
            }
          } catch (_) {}
        }
        setFriendRequests(requestSenderIds);
      } catch (_) {}
    })();
  }, [currentUser, Object.keys(chatDocsByChatId).sort().join(",")]);

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
    console.log(`Explore tab: ${filtered.length} users (out of ${users.length} total, ${friends.length} friends)`);
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

  /** Normalize friends field (array or map or missing) to a map { [uid]: true } for safe writes */
  const friendsToMap = (data: { friends?: unknown } | null | undefined): Record<string, boolean> => {
    if (!data?.friends) return {};
    const f = data.friends;
    if (Array.isArray(f)) return Object.fromEntries((f as string[]).map((id) => [id, true]));
    if (typeof f === "object" && f !== null)
      return Object.fromEntries(
        Object.entries(f as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => [k, true])
      );
    return {};
  };

  /** ✅ Accept friend request — read-modify-write both docs as maps, batch so both succeed or both fail */
  const handleAcceptFriend = async (userId: string) => {
    if (!currentUser) return;
    try {
      const currentUserRef = doc(db, "users", currentUser.uid);
      const otherUserRef = doc(db, "users", userId);
      const [currentSnap, otherSnap] = await Promise.all([getDoc(currentUserRef), getDoc(otherUserRef)]);

      const myFriends = friendsToMap(currentSnap.exists() ? currentSnap.data() : null);
      const theirFriends = friendsToMap(otherSnap.exists() ? otherSnap.data() : null);
      const myNew = { ...myFriends, [userId]: true };
      const theirNew = { ...theirFriends, [currentUser.uid]: true };

      const batch = writeBatch(db);
      batch.update(currentUserRef, { friends: myNew });
      batch.update(otherUserRef, { friends: theirNew });
      await batch.commit();

      Alert.alert("Success", "Friend request accepted!");
    } catch (error: any) {
      console.error("Error accepting friend:", error);
      console.error("Error details:", error.code, error.message);
      console.error("Accept friend request failed:", error.message || error.code);
    }
  };

  /** 🧩 Render explore user row (with accept button if friend request sent) */
  const renderExploreRow = ({ item }: { item: UserRow }) => {
    const isFriend = friends.some(f => f.id === item.id);
    const hasSentRequest = friendRequests.has(item.id);
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

        {!isFriend && hasSentRequest && (
          <TouchableOpacity
            style={{
              backgroundColor: colors.primary,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 8,
              marginLeft: 8,
            }}
            onPress={(e) => {
              e.stopPropagation();
              handleAcceptFriend(item.id);
            }}
          >
            <Text style={{ color: colors.buttonText || '#fff', fontWeight: '600' }}>
              Accept Friend request
            </Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  /** 🧭 Tab scenes */
  const FriendsRoute = () => (
    <View style={{ flex: 1 }}>
      <TextInput
        style={styles.searchBar}
        placeholder="Search friends..."
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
              No friends yet. Send a message to someone to send a friend request!
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
      {/* Header with Profile Pic and profile strength bar */}
      <View style={styles.headerContainer}>
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

        <TouchableOpacity
          onPress={() => navigation.navigate("ProfileScreen")}
          style={{ marginLeft: 12 }}
        >
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
        </TouchableOpacity>
      </View>

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
