import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
  Switch,
  Platform,
} from "react-native";
import { useNavigation, RouteProp, useRoute } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  QueryDocumentSnapshot,
  DocumentData,
  doc,
  getDoc,
} from "firebase/firestore";
import { db, auth, storage } from "../../../firebaseConfig";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";
import { RootStackParamList } from "../../../types";
import { useTheme } from "../../context/ThemeContext";
import createStyles from "../../context/appStyles";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const AVATAR_PLACEHOLDER = require("../../../assets/avatar-placeholder.png");

type CreateGroupChatScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  "CreateGroupChatScreen"
>;
type CreateGroupChatScreenRouteProp = RouteProp<
  RootStackParamList,
  "CreateGroupChatScreen"
>;

const CreateGroupChatScreen = () => {
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupImageUri, setGroupImageUri] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(auth.currentUser);

  // --- Password States ---
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigation = useNavigation<CreateGroupChatScreenNavigationProp>();
  const route = useRoute<CreateGroupChatScreenRouteProp>();
  const { communityId } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors).createGroupChatScreen;

  // Same as CommunityScreen: manual insets so content clears Dynamic Island / notch
  const safeAreaStyle = [
    styles.safeArea,
    Platform.OS !== "web" && {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    },
  ];

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
    });
    return unsubscribe;
  }, []);

  // Community creator can always create; members can create only when enabled by creator.
  const checkCanCreateGroup = async (): Promise<boolean> => {
    if (!user?.uid) return false;
    try {
      const communityRef = doc(db, "communities", communityId);
      const communitySnap = await getDoc(communityRef);
      if (!communitySnap.exists()) return false;
      const data = communitySnap.data();
      if (data.createdBy === user.uid) return true;

      if (data.allowMembersToCreateGroups !== true) return false;

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) return false;
      const joinedCommunities = userSnap.data().joinedCommunities || [];
      return Array.isArray(joinedCommunities) && joinedCommunities.includes(communityId);
    } catch (error) {
      console.error("Error checking membership:", error);
      return false;
    }
  };

  const handleImagePick = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Please grant media permissions.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setGroupImageUri(result.assets[0].uri);
      }
    } catch (error: any) {
      console.error("Failed to pick image", error.message ?? error);
    }
  };

  const uploadImage = async (uri: string): Promise<string | null> => {
    if (!user?.uid) return null;
    setUploadingImage(true);
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const filename = `group_chat_media/${communityId}/${communityId}/${user.uid}/${Date.now()}_${user.uid}.jpg`;
      const storageRef = ref(storage, filename);
      await uploadBytesResumable(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      return downloadURL;
    } catch (error: any) {
      console.error("Upload error", error.message ?? error);
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCreateGroupChat = async () => {
    if (!groupName.trim()) {
      Alert.alert("Missing Info", "Please enter a group name.");
      return;
    }

    // ✅ Password validation
    if (hasPassword) {
      if (!password.trim() || !confirmPassword.trim()) {
        Alert.alert(
          "Missing Password",
          "Please enter and confirm your group password."
        );
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert(
          "Password Mismatch",
          "Passwords do not match. Please try again."
        );
        return;
      }
    }

    setLoading(true);
    try {
      const canCreate = await checkCanCreateGroup();
      if (!canCreate) {
        Alert.alert(
          "Permission Denied",
          "You are not allowed to create groups in this community."
        );
        return;
      }

      let imageUrl: string | null = null;
      if (groupImageUri) imageUrl = await uploadImage(groupImageUri);

      const usersRef = collection(db, "users");
      const q = query(
        usersRef,
        where("joinedCommunities", "array-contains", communityId)
      );
      const snapshot = await getDocs(q);
      const communityMembers: string[] = [];
      snapshot.forEach((doc: QueryDocumentSnapshot<DocumentData>) => {
        const data = doc.data();
        if (data.uid) communityMembers.push(data.uid);
      });
      if (user?.uid && !communityMembers.includes(user.uid)) {
        communityMembers.push(user.uid);
      }

      // Create the group document
      const groupRef = await addDoc(
        collection(db, "communities", communityId, "groupChats"),
        {
          name: groupName.trim(),
          description: groupDescription.trim(),
          profilePic: imageUrl,
          createdBy: user?.uid,
          createdAt: serverTimestamp(),
          members: communityMembers,
          hasPassword,
          password: hasPassword ? password : null,
          hasGroupWallet: false,
        }
      );

      Alert.alert("Success", `Group chat "${groupName}" created successfully!`);
      navigation.goBack();
    } catch (error: any) {
      console.error("Create group error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={safeAreaStyle}>
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 50 }}>
      <Text style={styles.title}>Create New Group Chat</Text>

      {/* Group Image */}
      <View style={{ alignItems: "center", marginBottom: 24 }}>
        <TouchableOpacity
          onPress={handleImagePick}
          disabled={uploadingImage || loading}
          style={{
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: colors.cardBackground,
            borderWidth: 2,
            borderColor: colors.primary,
            justifyContent: "center",
            alignItems: "center",
            overflow: "hidden",
          }}
        >
          {groupImageUri ? (
            <Image source={{ uri: groupImageUri }} style={{ width: "100%", height: "100%" }} />
          ) : (
            <Ionicons name="camera" size={40} color={colors.primary} />
          )}
          {uploadingImage && (
            <View
              style={{
                position: "absolute",
                backgroundColor: "rgba(0,0,0,0.5)",
                width: "100%",
                height: "100%",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <ActivityIndicator color="#fff" />
            </View>
          )}
        </TouchableOpacity>
        <Text style={{ marginTop: 8, color: colors.secondaryText }}>Tap to add group picture</Text>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Group Chat Name"
        placeholderTextColor={colors.placeholderText}
        value={groupName}
        onChangeText={setGroupName}
      />

      <TextInput
        style={[styles.input, { height: 100, textAlignVertical: "top" }]}
        placeholder="Group Description (Optional)"
        placeholderTextColor={colors.placeholderText}
        multiline
        value={groupDescription}
        onChangeText={setGroupDescription}
      />

      {/* Password Protection */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 10 }}>
        <Text style={{ color: colors.text }}>Enable Password Protection</Text>
        <Switch value={hasPassword} onValueChange={setHasPassword} />
      </View>

      {hasPassword && (
        <>
          {/* Password Field */}
          <View style={{ position: "relative", marginBottom: 12 }}>
            <TextInput
              style={[styles.input, { paddingRight: 40 }]}
              placeholder="Enter Group Password"
              placeholderTextColor={colors.placeholderText}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
            />
            <TouchableOpacity
              onPress={() => setShowPassword((prev) => !prev)}
              style={{ position: "absolute", right: 12, top: 15 }}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={22}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Confirm Password Field */}
          <View style={{ position: "relative", marginBottom: 12 }}>
            <TextInput
              style={[styles.input, { paddingRight: 40 }]}
              placeholder="Confirm Group Password"
              placeholderTextColor={colors.placeholderText}
              secureTextEntry={!showConfirmPassword}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            <TouchableOpacity
              onPress={() => setShowConfirmPassword((prev) => !prev)}
              style={{ position: "absolute", right: 12, top: 15 }}
            >
              <Ionicons
                name={showConfirmPassword ? "eye-off-outline" : "eye-outline"}
                size={22}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </>
      )}

      <TouchableOpacity
        style={[styles.createButton, (loading || uploadingImage) && { opacity: 0.6 }]}
        onPress={handleCreateGroupChat}
        disabled={loading || uploadingImage}
      >
        {loading ? <ActivityIndicator color={colors.buttonText} /> : <Text style={styles.createButtonText}>Create Group</Text>}
      </TouchableOpacity>
    </ScrollView>
    </View>
  );
};

export default CreateGroupChatScreen;
