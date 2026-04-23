import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  FlatList,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
  RefreshControl,
} from "react-native";
import { RouteProp, useRoute, useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  arrayUnion,
  collection,
  onSnapshot,
  deleteDoc,
} from "firebase/firestore";
import { deleteObject, ref } from "firebase/storage";
import { Ionicons } from "@expo/vector-icons";

import { RootStackParamList, Community } from "../../types";
import { db, auth, storage } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import createStyles, { FONT_SIZES } from "../context/appStyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform } from "react-native";

const DEFAULT_COMMUNITY_LOGO = require("../../assets/community-placeholder.png");

type CommunityDetailScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  "CommunityDetailScreen"
>;
type CommunityDetailScreenRouteProp = RouteProp<
  RootStackParamList,
  "CommunityDetailScreen"
>;

const CommunityDetailScreen = () => {
  const route = useRoute<CommunityDetailScreenRouteProp>();
  const { community } = route.params;

  const [communityData, setCommunityData] = useState<Community>(community);
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [isMember, setIsMember] = useState(false);
  const [groupChats, setGroupChats] = useState<
    { id: string; name: string; profilePic?: string; lastMessageText?: string; unreadCount?: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCreateGroupHint, setShowCreateGroupHint] = useState(false);

  const navigation = useNavigation<CommunityDetailScreenNavigationProp>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors).communityDetailScreen;
  const globalStyles = createStyles(colors).global;

  const isCreator = !!uid && communityData.createdBy === uid;
  const canCreateGroup =
    isCreator || (!!isMember && communityData.allowMembersToCreateGroups === true);

  // Track auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return unsub;
  }, []);

  // ✅ Check membership or creator status
  const checkMembership = useCallback(async () => {
    if (!uid) return;
    try {
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);
      const joinedCommunities: string[] = userSnap.exists()
        ? userSnap.data().joinedCommunities || []
        : [];

      let member = joinedCommunities.includes(community.id);

      // Also allow if user is the creator
      const communityRef = doc(db, "communities", community.id);
      const communitySnap = await getDoc(communityRef);
      if (
        communitySnap.exists() &&
        communitySnap.data().createdBy === uid
      ) {
        member = true;
      }

      setIsMember(member);
    } catch (error: any) {
      console.error("Error checking membership:", error);
    }
  }, [uid, community.id]);

  // ✅ Fetch full community data
  const fetchFullCommunityData = useCallback(async () => {
    try {
      const communityDocRef = doc(db, "communities", community.id);
      const communitySnap = await getDoc(communityDocRef);
      if (communitySnap.exists()) {
        setCommunityData({
          ...(communitySnap.data() as Community),
          id: communitySnap.id,
        });
      }
    } catch (error: any) {
      console.error("Error fetching full community data:", error);
    }
  }, [community.id]);

  // ✅ Real-time group chat listener (preview + unread like activity chats)
  useEffect(() => {
    const currentUid = auth.currentUser?.uid;
    const chatsRef = collection(db, "communities", community.id, "groupChats");
    const unsubscribe = onSnapshot(chatsRef, (snapshot) => {
      const chats = snapshot.docs.map((d) => {
        const data = d.data();
        const unreadCount =
          currentUid && data.unreadCount && typeof data.unreadCount[currentUid] === "number"
            ? data.unreadCount[currentUid]
            : 0;
        return {
          id: d.id,
          name: data.name || data.title || "Untitled",
          profilePic: data.profilePic || null,
          lastMessageText: data.lastMessageText,
          unreadCount,
        };
      });
      setGroupChats(chats);
    });

    return () => unsubscribe();
  }, [community.id]);

  // Load function (reusable for refresh)
  const loadData = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    // Run both operations in parallel for faster loading
    await Promise.all([
      fetchFullCommunityData(),
      checkMembership(),
    ]);
    setLoading(false);
    setRefreshing(false);
  }, [uid, fetchFullCommunityData, checkMembership]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Pull to refresh handler
  const onRefresh = useCallback(() => {
    if (!uid) return;
    setRefreshing(true);
    loadData();
  }, [uid, loadData]);

  // ✅ Join community button
  const handleJoinCommunity = async () => {
    if (!uid) {
      Alert.alert("Error", "You must be logged in to join a community.");
      return;
    }

    setJoining(true);
    try {
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(userRef, { joinedCommunities: [community.id] });
      } else {
        await updateDoc(userRef, {
          joinedCommunities: arrayUnion(community.id),
        });
      }

      setIsMember(true);
      Alert.alert("Joined", "You are now a member of this community!");
    } catch (error: any) {
      console.error("Failed to join community:", error);
    } finally {
      setJoining(false);
    }
  };

  // ✅ Delete community
  const handleDeleteCommunity = async () => {
    if (!uid || !isCreator) {
      Alert.alert(
        "Permission Denied",
        "You are not authorized to delete this community."
      );
      return;
    }

    Alert.alert(
      "Delete Community",
      `Are you sure you want to delete "${communityData.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setIsDeleting(true);
            try {
              if (communityData.logo) {
                const imagePath = `community_logos/${communityData.id}.jpg`;
                const logoRef = ref(storage, imagePath);
                await deleteObject(logoRef);
              }
              const communityDocRef = doc(db, "communities", communityData.id);
              await deleteDoc(communityDocRef);
              Alert.alert("Deleted", "Community deleted successfully.");
              navigation.goBack();
            } catch (error) {
              console.error("Failed to delete community:", error);
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  // ✅ UI loading states
  if (loading) {
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textSecondary, marginTop: 10 }}>
          Loading community details...
        </Text>
      </View>
    );
  }

  const contentStyle = [
    styles.scrollViewContent,
    Platform.OS !== "web" && { paddingTop: insets.top },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView
      contentContainerStyle={[
        contentStyle,
        // Keep content clear of floating create-group button.
        canCreateGroup && { paddingBottom: 110 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {isDeleting && (
        <View style={globalStyles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={globalStyles.loadingOverlayText}>
            Deleting community...
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.headerContainer}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={globalStyles.backButton}
        >
          <Ionicons
            name="arrow-back"
            size={FONT_SIZES.xxlarge}
            color={colors.textPrimary}
          />
        </TouchableOpacity>
        <Text style={styles.header} numberOfLines={1}>
          {communityData.name}
        </Text>
        {isCreator ? (
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() =>
              navigation.navigate("EditCommunityScreen", {
                community: communityData,
              })
            }
          >
            <Ionicons
              name="settings-outline"
              size={24}
              style={styles.settingsIcon}
            />
          </TouchableOpacity>
        ) : (
          <View style={[styles.settingsButton, { width: 40 }]} />
        )}
      </View>

      {/* Logo */}
      {communityData.logo ? (
      <Image
          source={{ uri: communityData.logo }}
        style={styles.communityLogo}
      />
      ) : (
        <View
          style={{
            width: styles.communityLogo.width,
            height: styles.communityLogo.height,
            borderRadius: styles.communityLogo.width / 2,
            backgroundColor: colors.primaryLight,
            alignSelf: 'center',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: colors.primary,
              fontSize: FONT_SIZES.large,
              fontWeight: 'bold',
            }}
          >
            {communityData.name
              .split(' ')
              .map(w => w[0])
              .join('')
              .substring(0, 2)
              .toUpperCase()}
          </Text>
        </View>
      )}

      {/* Description */}
      <Text style={styles.description}>
        {communityData.description || "No description provided."}
      </Text>

      {/* ✅ Join Button */}
      {!isMember && !isCreator ? (
        <View style={{ alignItems: "center", marginTop: 20 }}>
          <Text
            style={{ color: colors.textSecondary, fontSize: 16, marginBottom: 10 }}
          >
            Join this community to access group chats
          </Text>
          <TouchableOpacity
            style={[styles.joinButton, joining && { opacity: 0.6 }]}
            onPress={handleJoinCommunity}
            disabled={joining}
          >
            {joining ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.joinButtonText}>Join Community</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* ✅ Group Chats */}
          <Text style={styles.subHeader}>Group Chats</Text>
          {groupChats.length > 0 ? (
            <FlatList
              data={groupChats}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const initials =
                  item.name
                    ?.split(" ")
                    .map((n: string) => n[0])
                    .join("")
                    .substring(0, 2)
                    .toUpperCase() || "??";
                const hasUnread = (item.unreadCount ?? 0) > 0;
                const preview =
                  item.lastMessageText != null && String(item.lastMessageText).trim() !== ""
                    ? String(item.lastMessageText).trim()
                    : null;

                return (
                  <TouchableOpacity
                    style={styles.groupChatItem}
                    onPress={() =>
                      navigation.navigate("GroupChatScreen", {
                        groupId: item.id,
                        groupName: item.name,
                        communityId: community.id,
                      })
                    }
                  >
                    {item.profilePic ? (
                      <Image
                        source={{ uri: item.profilePic }}
                        style={styles.groupChatAvatar}
                      />
                    ) : (
                      <View style={styles.groupChatAvatarFallback}>
                        <Text style={styles.groupChatAvatarText}>{initials}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.groupChatText}>{item.name}</Text>
                      {preview != null && (
                        <Text
                          style={[styles.groupChatText, { fontSize: FONT_SIZES.small, opacity: 0.8 }]}
                          numberOfLines={1}
                        >
                          {preview}
                        </Text>
                      )}
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
                        }}
                      >
                        <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "700" }}>
                          {(item.unreadCount ?? 0) > 99 ? "99+" : String(item.unreadCount ?? 0)}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
              scrollEnabled={false}
              contentContainerStyle={styles.flatListContent}
            />
          ) : (
            <Text style={styles.noGroupsText}>No group chats available.</Text>
          )}

        </>
      )}
    </ScrollView>
    {canCreateGroup && showCreateGroupHint && (
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          right: 92,
          bottom: insets.bottom + 40,
          backgroundColor: colors.cardBackground,
          borderWidth: 1,
          borderColor: colors.borderColor,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
          zIndex: 1000,
          elevation: 13,
        }}
      >
        <Text style={{ color: colors.textPrimary, fontSize: FONT_SIZES.small }}>
          {isCreator ? "Create group chat" : "Create group in this community"}
        </Text>
      </View>
    )}
    {canCreateGroup && (
      <Pressable
        style={{
          position: "absolute",
          width: 60,
          height: 60,
          borderRadius: 30,
          right: 20,
          bottom: insets.bottom + 24,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.primary,
          elevation: 12,
          shadowColor: colors.shadowColor,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.5,
          shadowRadius: 15,
          zIndex: 999,
        }}
        onPress={() => {
          setShowCreateGroupHint(false);
          navigation.navigate("CreateGroupChatScreen", {
            communityId: communityData.id,
          });
        }}
        onLongPress={() => setShowCreateGroupHint(true)}
        onPressOut={() => setShowCreateGroupHint(false)}
        onHoverIn={() => setShowCreateGroupHint(true)}
        onHoverOut={() => setShowCreateGroupHint(false)}
      >
        <Ionicons name="add" size={32} color={colors.buttonText} />
      </Pressable>
    )}
    </View>
  );
};

export default CommunityDetailScreen;
