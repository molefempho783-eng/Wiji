import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
  Switch,
} from "react-native";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native"; 
import { StackNavigationProp } from "@react-navigation/stack";
import { db, auth, storage } from "../../../firebaseConfig";
import { collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList } from "../../../types"; 
import { useTheme } from '../../context/ThemeContext'; 
import createStyles from '../../context/appStyles'; 
import { SPACING, FONT_SIZES } from '../../context/appStyles'; 
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GroupSubscription,
  formatDate,
  paidGroupSettings,
  perLabel,
  priceLabel,
  setGroupAutoRenew,
  subscribeToGroup,
  subscriptionDocId,
} from "../../../services/groupSubscriptions";

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

  // Paid groups
  const [mySub, setMySub] = useState<GroupSubscription | null>(null);
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [subBusy, setSubBusy] = useState(false);

  const { colors } = useTheme(); 
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors).groupDetailsScreen;
  const globalStyles = createStyles(colors).global; 

  const currentUserId = auth.currentUser?.uid;

  const safeRootStyle = [
    styles.safeArea,
    Platform.OS !== "web" && {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    },
  ];

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
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    };

    fetchGroupDetails();
  }, [groupId, communityId, currentUserId, groupName, navigation]);

  const paid = paidGroupSettings(groupData);

  // My subscription (members) and the number of paying members (creator)
  useEffect(() => {
    if (!paid || !currentUserId) return;
    if (groupData?.createdBy === currentUserId) {
      getDocs(
        query(
          collection(db, "groupSubscriptions"),
          where("creatorUid", "==", currentUserId),
          where("communityId", "==", communityId),
          where("groupId", "==", groupId)
        )
      )
        .then((snap) => setSubscriberCount(snap.docs.filter((d) => ["active", "past_due"].includes(d.data().status)).length))
        .catch(() => setSubscriberCount(null));
      return;
    }
    return onSnapshot(
      doc(db, "groupSubscriptions", subscriptionDocId(communityId, groupId, currentUserId)),
      (snap) => setMySub(snap.exists() ? (snap.data() as GroupSubscription) : null),
      () => setMySub(null)
    );
  }, [!!paid, groupData?.createdBy, currentUserId, communityId, groupId]);

  const toggleAutoRenew = async (on: boolean) => {
    if (on && !mySub?.cardId) {
      Alert.alert("No saved card", "Pay with a card and keep 'Renew automatically' on to set up automatic renewal.");
      return;
    }
    setSubBusy(true);
    try {
      await setGroupAutoRenew({ communityId, groupId, autoRenew: on });
      if (!on) {
        Alert.alert("Auto-renew turned off", `You'll keep access until ${formatDate(mySub?.currentPeriodEnd)}.`);
      }
    } catch (e: any) {
      Alert.alert("Couldn't update", e?.message || "Please try again.");
    } finally {
      setSubBusy(false);
    }
  };

  const payNow = async () => {
    setSubBusy(true);
    try {
      const res = await subscribeToGroup({ communityId, groupId, autoRenew: true, payAhead: true });
      if (res.status === "paid") Alert.alert("Paid", "Thanks! Your subscription is up to date.");
      else if (res.status === "pending") Alert.alert("Payment processing", "We'll update your subscription once Paystack confirms the payment.");
      else if (res.status !== "abandoned") Alert.alert("Payment didn't go through", "Your card wasn't charged. Try again or use another card.");
    } catch (e: any) {
      Alert.alert("Couldn't pay", e?.message || "Please try again.");
    } finally {
      setSubBusy(false);
    }
  };

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
      console.error('Failed to pick image', error.message ?? error);
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
      <View
        style={[
          globalStyles.centeredContainer,
          Platform.OS !== "web" && {
            paddingTop: insets.top,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textPrimary, marginTop: SPACING.medium }}>Loading group details...</Text>
      </View>
    );
  }

  if (!groupData) {
    return (
      <View
        style={[
          globalStyles.centeredContainer,
          Platform.OS !== "web" && {
            paddingTop: insets.top,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        <Text style={globalStyles.errorText}>Group details could not be loaded.</Text> 
      </View>
    );
  }

  return (
    <View style={safeRootStyle}>
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

        {/* Subscription (paid groups) */}
        {paid && (
          <View style={styles.detailSection}>
            <Text style={styles.label}>Subscription</Text>
            <Text style={styles.valueText}>
              {priceLabel(paid)} · billed {paid.interval === "yearly" ? "yearly" : "monthly"}
            </Text>
            {isCreator ? (
              <Text style={{ color: colors.textSecondary, marginTop: SPACING.small }}>
                {subscriberCount == null
                  ? "Members pay to join. Payments go to your payout bank account."
                  : `${subscriberCount} paying member${subscriberCount === 1 ? "" : "s"}. Payments go to your payout bank account.`}
              </Text>
            ) : mySub ? (
              <View style={{ marginTop: SPACING.small }}>
                <Text style={{ color: mySub.status === "past_due" ? "#B26A00" : colors.textSecondary }}>
                  {mySub.status === "active" && mySub.autoRenew
                    ? `Renews on ${formatDate(mySub.currentPeriodEnd)} for ${priceLabel({ priceCents: mySub.priceCents, interval: mySub.interval })}`
                    : mySub.status === "active"
                    ? `Access until ${formatDate(mySub.currentPeriodEnd)}. It won't renew.`
                    : mySub.status === "past_due"
                    ? "We couldn't charge your card for this renewal. Pay now to keep your access."
                    : `Ended ${formatDate(mySub.currentPeriodEnd)}`}
                </Text>
                {(mySub.status === "active" || mySub.status === "past_due") && (
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: SPACING.medium }}>
                    <Text style={{ color: colors.textPrimary }}>Renew automatically every {perLabel(mySub.interval)}</Text>
                    {subBusy ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Switch value={!!mySub.autoRenew} onValueChange={toggleAutoRenew} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />
                    )}
                  </View>
                )}
                {(mySub.status === "past_due" || (mySub.status === "active" && !mySub.autoRenew)) && (
                  <TouchableOpacity
                    onPress={payNow}
                    disabled={subBusy}
                    style={{ backgroundColor: colors.primary, borderRadius: 8, paddingVertical: SPACING.medium, alignItems: "center", marginTop: SPACING.medium }}
                  >
                    <Text style={{ color: colors.buttonText, fontWeight: "bold" }}>
                      {mySub.status === "past_due" ? `Pay ${priceLabel(paid)} now` : `Pay for another ${perLabel(paid.interval)}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </View>
        )}

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
    </View>
  );
};

export default GroupDetailsScreen;