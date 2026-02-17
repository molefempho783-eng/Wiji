import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  Image,
  StyleSheet 
} from "react-native";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native"; 
import { StackNavigationProp } from "@react-navigation/stack";
import { db, auth, storage } from "../../../firebaseConfig";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList } from "../../../types"; 
import { useTheme } from '../../context/ThemeContext'; 
import createStyles from '../../context/appStyles'; 
import { SPACING, FONT_SIZES } from '../../context/appStyles'; 
import { Ionicons } from '@expo/vector-icons'; 

type GroupDetailsScreenRouteProp = RouteProp<RootStackParamList, "GroupDetailsScreen">;
type GroupDetailsScreenNavigationProp = StackNavigationProp<RootStackParamList, "GroupDetailsScreen">;

const GroupDetailsScreen = () => {
  const route = useRoute<GroupDetailsScreenRouteProp>();
  const navigation = useNavigation<GroupDetailsScreenNavigationProp>();
  const { groupId, communityId, groupName } = route.params;

  const [groupData, setGroupData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(groupName);
  const [editedDescription, setEditedDescription] = useState("");
  const [isCreator, setIsCreator] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [membersProfiles, setMembersProfiles] = useState<any[]>([]);
  const [groupImageUri, setGroupImageUri] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const { colors } = useTheme(); 
  const styles = createStyles(colors).groupDetailsScreen;
  const globalStyles = createStyles(colors).global; 

  const currentUserId = auth.currentUser?.uid;

  useEffect(() => {
    const fetchGroupDetails = async () => {
      try {
        const groupDocRef = doc(db, "communities", communityId, "groupChats", groupId);
        const docSnap = await getDoc(groupDocRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setGroupData(data);
          setEditedName(data.name || groupName);
          setEditedDescription(data.description || "");
          setIsCreator(data.createdBy === currentUserId);
          
          // Check if current user is a member
          const memberUids = data.members || [];
          setIsMember(memberUids.includes(currentUserId));

          // Fetch member profiles
          let fetchedProfiles: any[] = [];
          if (memberUids.length > 0) {
            const profilePromises = memberUids.map(async (uid: string) => {
              const userDocRef = doc(db, "users", uid);
              const userSnap = await getDoc(userDocRef);
              if (userSnap.exists()) {
                const userData = userSnap.data();
                return { uid, username: userData.username, profilePic: userData.profilePic };
              }
              return { uid, username: "Unknown User", profilePic: undefined };
            });
            fetchedProfiles = await Promise.all(profilePromises);
          }
          setMembersProfiles(fetchedProfiles);

        } else {
          Alert.alert("Error", "Group not found.");
          navigation.goBack();
        }
      } catch (error: any) {
        console.error("Error fetching group details:", error);
        Alert.alert("Error", "Failed to load group details.");
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    };

    fetchGroupDetails();
  }, [groupId, communityId, currentUserId, groupName, navigation]);

  const handleImagePick = async () => {
    if (!isMember) {
      Alert.alert("Permission Denied", "You must be a member to change the group profile picture.");
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant camera roll permissions to change the profile picture.');
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
        await uploadAndUpdateImage(result.assets[0].uri);
      }
    } catch (error: any) {
      Alert.alert('Error', `Failed to pick image: ${error.message}`);
    }
  };

  const uploadAndUpdateImage = async (uri: string) => {
    if (!currentUserId) return;
    setUploadingImage(true);
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const filename = `group_chats/${communityId}/${groupId}_${Date.now()}_${currentUserId}.jpg`;
      const storageRef = ref(storage, filename);
      
      await uploadBytesResumable(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      
      const groupDocRef = doc(db, "communities", communityId, "groupChats", groupId);
      await updateDoc(groupDocRef, {
        profilePic: downloadURL,
      });
      
      setGroupData((prev: any) => ({ ...prev, profilePic: downloadURL }));
      setGroupImageUri(null);
      Alert.alert("Success", "Profile picture updated!");
    } catch (error: any) {
      console.error('Image upload error:', error);
      Alert.alert('Upload Error', `Failed to upload image: ${error.message}`);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!editedName.trim()) {
      Alert.alert("Input Error", "Group name cannot be empty.");
      return;
    }
    setLoading(true);
    try {
      const groupDocRef = doc(db, "communities", communityId, "groupChats", groupId);
      await updateDoc(groupDocRef, {
        name: editedName.trim(),
        description: editedDescription.trim(),
      });
      setGroupData((prev: any) => ({ ...prev, name: editedName.trim(), description: editedDescription.trim() }));
      setIsEditing(false);
      Alert.alert("Success", "Group details updated!");
    } catch (error: any) {
      console.error("Error saving group details:", error);
      Alert.alert("Error", `Failed to save changes: ${error.message || "Please try again."}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedName(groupData.name || groupName);
    setEditedDescription(groupData.description || "");
  };

  if (loading) {
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textPrimary, marginTop: SPACING.medium }}>Loading group details...</Text>
      </View>
    );
  }

  if (!groupData) {
    return (
      <View style={globalStyles.centeredContainer}>
        <Text style={globalStyles.errorText}>Group details could not be loaded.</Text> 
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollViewContent}>
        {/* Header with Back Button */}
        <View style={styles.headerContainer}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={FONT_SIZES.xxlarge} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Group Details</Text>
          {isMember && !isEditing && (
            <TouchableOpacity onPress={() => setIsEditing(true)} style={styles.editButton}>
              <Ionicons name="create-outline" size={FONT_SIZES.xlarge} color={colors.primary} />
            </TouchableOpacity>
          )}
          {isMember && isEditing && (
            <View style={styles.editButtonsContainer}>
              <TouchableOpacity onPress={handleSave} style={[styles.saveButton, { marginRight: SPACING.small }]}>
                <Ionicons name="checkmark" size={FONT_SIZES.xlarge} color={colors.buttonText} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCancelEdit} style={styles.cancelButton}>
                <Ionicons name="close" size={FONT_SIZES.xlarge} color={colors.buttonText} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Profile Picture Section */}
        <View style={{ alignItems: 'center', marginBottom: SPACING.large }}>
          <TouchableOpacity
            onPress={handleImagePick}
            disabled={uploadingImage || !isMember}
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: colors.cardBackground,
              borderWidth: 2,
              borderColor: colors.primary,
              justifyContent: 'center',
              alignItems: 'center',
              overflow: 'hidden',
              opacity: isMember ? 1 : 0.6,
            }}
          >
            {groupData?.profilePic ? (
              <Image source={{ uri: groupData.profilePic }} style={{ width: '100%', height: '100%' }} />
            ) : (
              <View style={{ width: '100%', height: '100%', backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: colors.primary, fontSize: FONT_SIZES.xxlarge, fontWeight: 'bold' }}>
                  {groupData?.name?.substring(0, 2).toUpperCase() || '??'}
                </Text>
              </View>
            )}
            {uploadingImage && (
              <View style={{ position: 'absolute', backgroundColor: 'rgba(0,0,0,0.5)', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
            {isMember && !uploadingImage && (
              <View style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: colors.primary, borderRadius: 15, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="camera" size={16} color={colors.buttonText} />
              </View>
            )}
          </TouchableOpacity>
          {isMember && (
            <Text style={{ marginTop: SPACING.small, color: colors.secondaryText, fontSize: FONT_SIZES.small }}>
              Tap to change profile picture
            </Text>
          )}
        </View>

        {/* Group Name */}
        <View style={styles.detailSection}>
          <Text style={styles.label}>Group Name</Text>
          {isEditing ? (
            <TextInput
              style={styles.input}
              value={editedName}
              onChangeText={setEditedName}
              placeholder="Enter group name"
              placeholderTextColor={colors.textSecondary}
            />
          ) : (
            <Text style={styles.valueText}>{groupData.name}</Text>
          )}
        </View>

        {/* Group Description */}
        <View style={styles.detailSection}>
          <Text style={styles.label}>Description</Text>
          {isEditing ? (
            <TextInput
              style={[styles.input, styles.descriptionInput]}
              value={editedDescription}
              onChangeText={setEditedDescription}
              placeholder="Enter group description (optional)"
              placeholderTextColor={colors.textSecondary}
              multiline
            />
          ) : (
            <Text style={styles.valueText}>{groupData.description || "No description"}</Text>
          )}
        </View>

        {/* Group Members */}
        <View style={styles.detailSection}>
          <Text style={styles.label}>Members ({membersProfiles.length})</Text>
          <View style={styles.membersList}>
             {membersProfiles.map((member) => (
                <TouchableOpacity 
                    key={member.uid}
                    onPress={() => navigation.navigate("UserProfileScreen", { userId: member.uid })} // Navigate to UserProfileScreen
                    style={styles.memberItem}
                >
                    {member.profilePic ? (
                    <Image source={{ uri: member.profilePic }} style={styles.memberAvatar} />
                    ) : (
                    <View style={[styles.memberAvatar, styles.memberAvatarFallback]}>
                        <Text style={styles.memberAvatarFallbackText}>{member.username?.charAt(0).toUpperCase() || '?'}</Text>
                    </View>
        )}
        <Text style={styles.memberName}>{member.username}</Text>
      </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.detailSection}>
            <Text style={styles.label}>Created By</Text>
            <Text style={styles.valueText}>{isCreator ? 'You' : groupData.createdBy}</Text>
        </View>

        <View style={styles.detailSection}>
            <Text style={styles.label}>Created At</Text>
            <Text style={styles.valueText}>{groupData.createdAt?.toDate().toLocaleString() || 'N/A'}</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
};

export default GroupDetailsScreen;