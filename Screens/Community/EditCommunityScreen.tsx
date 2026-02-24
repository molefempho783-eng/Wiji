import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
  FlatList,
  SafeAreaView,
} from "react-native";
import { RouteProp, useRoute, useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import {
  doc,
  updateDoc,
  collection,
  onSnapshot,
  deleteDoc,
  getDocs,
} from "firebase/firestore";
import { db, auth, storage } from "../../firebaseConfig";
import { getDownloadURL, ref, uploadBytes, deleteObject } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "../context/ThemeContext";
import createStyles, { FONT_SIZES } from "../context/appStyles";
import { Ionicons } from "@expo/vector-icons";
import { Community, RootStackParamList } from "../../types";

const DEFAULT_COMMUNITY_LOGO = require("../../assets/community-placeholder.png");

type EditCommunityScreenRouteProp = RouteProp<
  RootStackParamList,
  "EditCommunityScreen"
>;
type EditCommunityScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  "EditCommunityScreen"
>;

const EditCommunityScreen = () => {
  const route = useRoute<EditCommunityScreenRouteProp>();
  const navigation = useNavigation<EditCommunityScreenNavigationProp>();
  const { community } = route.params;
  const { colors, isThemeLoading } = useTheme();
  const styles = createStyles(colors).editCommunityScreen;
  const globalStyles = createStyles(colors).global;

  const [name, setName] = useState(community.name || "");
  const [description, setDescription] = useState(community.description || "");
  const [communityLogoUri, setCommunityLogoUri] = useState<string | null>(
    community.logo || null
  );
  const [loading, setLoading] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [groupChats, setGroupChats] = useState<
    { id: string; name: string; profilePic?: string }[]
  >([]);

  const user = auth.currentUser;
  const isCreator = user && community.createdBy === user.uid;

  // --- Redirect unauthorized users ---
  useEffect(() => {
    if (!user || !isCreator) {
      Alert.alert(
        "Access Denied",
        "You do not have permission to edit this community."
      );
      navigation.goBack();
    }
  }, [user, isCreator, navigation]);

  // --- Real-time group list ---
  const loadGroupChats = useCallback(() => {
    const chatsRef = collection(db, "communities", community.id, "groupChats");
    const unsubscribe = onSnapshot(chatsRef, (snap) => {
      const chats = snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name || "Untitled",
        profilePic: d.data().profilePic || null,
      }));
      setGroupChats(chats);
    });
    return unsubscribe;
  }, [community.id]);

  useEffect(() => {
    const unsub = loadGroupChats();
    return () => unsub();
  }, [loadGroupChats]);

  // --- Delete Group Functionality ---
  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    Alert.alert(
      "Delete Group",
      `Are you sure you want to delete "${groupName}"? This will remove all messages and related media.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const groupRef = doc(
                db,
                "communities",
                community.id,
                "groupChats",
                groupId
              );

              // Delete all messages
              const messagesRef = collection(
                db,
                "communities",
                community.id,
                "groupChats",
                groupId,
                "messages"
              );
              const messagesSnap = await getDocs(messagesRef);
              for (const messageDoc of messagesSnap.docs) {
                await deleteDoc(messageDoc.ref);
              }

              // Delete group image if exists
              const picPath = `group_chats/${community.id}/${groupId}.jpg`;
              const picRef = ref(storage, picPath);
              try {
                await deleteObject(picRef);
              } catch {}

              // Delete group wallet (if any)
              const walletRef = doc(db, "groupWallets", groupId);
              try {
                await deleteDoc(walletRef);
              } catch {}

              // Delete group document
              await deleteDoc(groupRef);

              Alert.alert("Deleted", `"${groupName}" has been removed.`);
            } catch (error) {
              console.error("Error deleting group:", error);
            }
          },
        },
      ]
    );
  };

  // --- COMMUNITY DELETION FEATURE ADDED ---
  const handleDeleteCommunity = async () => {
    if (!user || !isCreator) {
      Alert.alert(
        "Permission Denied",
        "You are not authorized to delete this community."
      );
      return;
    }

    Alert.alert(
      "Delete Community",
      `Are you sure you want to permanently delete "${community.name}"?\n\nThis will remove all groups, messages, and media.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              // Delete all group chats under the community
              const groupsRef = collection(db, "communities", community.id, "groupChats");
              const groupsSnap = await getDocs(groupsRef);

              for (const groupDoc of groupsSnap.docs) {
                const groupId = groupDoc.id;

                // Delete all messages
                const messagesRef = collection(
                  db,
                  "communities",
                  community.id,
                  "groupChats",
                  groupId,
                  "messages"
                );
                const messagesSnap = await getDocs(messagesRef);
                for (const messageDoc of messagesSnap.docs) {
                  await deleteDoc(messageDoc.ref);
                }

                // Delete group chat image
                const groupPicPath = `group_chats/${community.id}/${groupId}.jpg`;
                try {
                  await deleteObject(ref(storage, groupPicPath));
                } catch {}

                // Delete group wallet if exists
                try {
                  await deleteDoc(doc(db, "groupWallets", groupId));
                } catch {}

                // Delete group chat doc
                await deleteDoc(groupDoc.ref);
              }

              // Delete community logo
              if (community.logo) {
                try {
                  const logoRef = ref(storage, `community_logos/${community.id}.jpg`);
                  await deleteObject(logoRef);
                } catch {}
              }

              // Delete the community document
              await deleteDoc(doc(db, "communities", community.id));

              Alert.alert("Deleted", "Community deleted successfully!");
navigation.navigate("Tabs", { screen: "CommunityScreen" });
            } catch (error) {
              console.error("Error deleting community:", error);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  // --- Upload Image ---
  const handleImagePick = async () => {
    if (isPickingImage) return;
    setIsPickingImage(true);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission required",
        "Please grant media library permissions."
      );
      setIsPickingImage(false);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets.length > 0) {
      setCommunityLogoUri(result.assets[0].uri);
    }
    setIsPickingImage(false);
  };

  const uploadCommunityLogo = async (uri: string): Promise<string | null> => {
    if (!user) return null;
    const fileName = `community_logos/${community.id}.jpg`;
    const storageRef = ref(storage, fileName);
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      return downloadURL;
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Error", "Community name is required.");
      return;
    }

    if (!user || !isCreator) {
      Alert.alert("Error", "You are not authorized to edit this community.");
      return;
    }

    setLoading(true);
    let newLogoURL: string | null = communityLogoUri;

    if (communityLogoUri && communityLogoUri !== community.logo) {
      newLogoURL = await uploadCommunityLogo(communityLogoUri);
      if (!newLogoURL) {
        setLoading(false);
        return;
      }
    }

    try {
      const communityRef = doc(db, "communities", community.id);
      await updateDoc(communityRef, {
        name: trimmedName,
        description: description.trim(),
        logo: newLogoURL,
      });
      Alert.alert("Success", "Community updated successfully!");
      navigation.goBack();
    } catch (error) {
      console.error("Error updating community:", error);
    } finally {
      setLoading(false);
    }
  };

  // --- UI ---
  if (isThemeLoading || !isCreator) {
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={globalStyles.loadingOverlayText}>
          {isThemeLoading ? "Loading theme..." : "Checking permissions..."}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={globalStyles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollViewContent}>
        {loading && (
          <View style={styles.loadingOverlayScreen}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingOverlayText}>Processing...</Text>
          </View>
        )}

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons
            name="arrow-back"
            size={FONT_SIZES.xxlarge}
            color={colors.textPrimary}
          />
        </TouchableOpacity>

        <Text style={styles.header}>Edit Community</Text>

        <TouchableOpacity
          onPress={handleImagePick}
          style={styles.logoContainer}
          disabled={loading || isPickingImage}
        >
          {communityLogoUri ? (
            <Image
              source={{ uri: communityLogoUri }}
              style={styles.logoImage}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                backgroundColor: colors.primaryLight,
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
                {name
                  .split(' ')
                  .map(w => w[0])
                  .join('')
                  .substring(0, 2)
                  .toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.addLogoText}>
            {communityLogoUri ? "Change Logo" : "Add Logo"}
          </Text>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder="Community Name"
          placeholderTextColor={colors.placeholderText}
          value={name}
          onChangeText={setName}
          editable={!loading}
        />

        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Description (optional)"
          placeholderTextColor={colors.placeholderText}
          value={description}
          onChangeText={setDescription}
          multiline
          editable={!loading}
        />

        <TouchableOpacity
          style={styles.saveButton}
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.activeFilterText} />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>

        {/* --- GROUP MANAGEMENT SECTION --- */}
        <Text style={[styles.header, { marginTop: 30 }]}>
          Manage Group Chats
        </Text>

        {groupChats.length > 0 ? (
          groupChats.map((chat) => (
            <View
              key={chat.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderColor: colors.borderColor,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {chat.profilePic ? (
                  <Image
                    source={{ uri: chat.profilePic }}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      marginRight: 10,
                    }}
                  />
                ) : (
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      marginRight: 10,
                      backgroundColor: colors.cardBackground,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: colors.text }}>
                      {chat.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={{ color: colors.text, fontSize: 16 }}>
                  {chat.name}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => handleDeleteGroup(chat.id, chat.name)}
              >
                <Ionicons
                  name="trash-outline"
                  size={22}
                  color={colors.error || "red"}
                />
              </TouchableOpacity>
            </View>
          ))
        ) : (
          <Text
            style={{
              textAlign: "center",
              color: colors.textSecondary,
              marginTop: 10,
            }}
          >
            No group chats yet.
          </Text>
        )}

        {/* --- DELETE COMMUNITY BUTTON --- */}
        <TouchableOpacity
          style={[
            styles.saveButton,
            { backgroundColor: "red", marginTop: 40 },
          ]}
          onPress={handleDeleteCommunity}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>
            Delete Community
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default EditCommunityScreen;
