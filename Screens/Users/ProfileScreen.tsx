import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  Switch,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

import { getAuth } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, storage } from "../../firebaseConfig";
import { getDownloadURL, ref, uploadBytes, deleteObject } from "firebase/storage";
import { useTheme } from '../context/ThemeContext';
import createStyles, { SPACING, FONT_SIZES } from '../context/appStyles'; 
import { useNavigation } from "@react-navigation/native"; 
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../types"; 
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from "@react-native-async-storage/async-storage";

const DEFAULT_AVATAR = require("../../assets/avatar-placeholder.png");
const THEME_HINT_SEEN_KEY = "@Square_has_seen_theme_hint";

// Define navigation prop type specifically for ProfileScreen
type ProfileScreenNavigationProp = StackNavigationProp<RootStackParamList, "ProfileScreen">;

const ProfileScreen = () => {
  const auth = getAuth();
  const user = auth.currentUser;
  const { colors, theme, toggleTheme, isThemeLoading } = useTheme();
  const navigation = useNavigation<ProfileScreenNavigationProp>();


  const styles = createStyles(colors).profileScreen;
  const globalStyles = createStyles(colors).global;

  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [profilePhotos, setProfilePhotos] = useState<string[]>([]);
  const [socialLink, setSocialLink] = useState("");
  const [aboutMe, setAboutMe] = useState("");
  const [loading, setLoading] = useState(false); 
  const [username, setUsername] = useState<string>("");

  const [isProfileDataLoading, setIsProfileDataLoading] = useState(true);
  const [showThemeHint, setShowThemeHint] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(THEME_HINT_SEEN_KEY);
        if (mounted) setShowThemeHint(seen !== "true");
      } catch {
        if (mounted) setShowThemeHint(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const MAX_GALLERY_PHOTOS = 6;
  const profileSteps = [
    { key: "profilePhoto", label: "Profile photo", done: !!profilePic },
    { key: "photos", label: "6 photos", done: profilePhotos.length >= 6, count: profilePhotos.length, max: 6 },
    { key: "about", label: "About", done: !!(aboutMe && aboutMe.trim().length > 0) },
  ];
  const completedCount = (profilePic ? 1 : 0) + Math.min(profilePhotos.length, 6) + (aboutMe?.trim() ? 1 : 0);
  const totalSteps = 8;
  const profileProgress = totalSteps > 0 ? completedCount / totalSteps : 0; 

  useEffect(() => {
    if (user) {
      fetchUserProfile();
    } else {
      setIsProfileDataLoading(false);
       navigation.navigate("AuthScreen");
    }
  }, [user, navigation]); 

  useEffect(() => {
  let mounted = true;
  (async () => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const fromDb = snap.exists() ? (snap.data() as any)?.username : undefined;
      const fallback = user.displayName || user.email?.split("@")[0] || "User";
      if (mounted) setUsername(fromDb || fallback);
    } catch {
      const fallback = user?.displayName || user?.email?.split("@")[0] || "User";
      if (mounted) setUsername(fallback);
    }
  })();
  return () => { mounted = false; };
}, [user]);

  const fetchUserProfile = async () => {
    if (!user) return; 
    setIsProfileDataLoading(true);
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setSocialLink(data.socialLink || "");
        setAboutMe(data.aboutMe || "");
        setProfilePic(data.profilePic || null);
        setProfilePhotos(Array.isArray(data.profilePhotos) ? data.profilePhotos : []);
      }
    } catch (error: any) {
      console.error("Error fetching profile:", error);
    } finally {
      setIsProfileDataLoading(false);
    }
  };

  const handleImagePick = async () => {
    // Check loading/isPickingImage to prevent multiple clicks
    if (loading) return; 
    
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please grant media library permissions to choose a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      uploadProfilePicture(result.assets[0].uri);
    }
  };

  const uploadProfilePicture = async (imageUri: string) => {
    if (!user) {
      Alert.alert("Error", "You must be logged in to upload a profile picture.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(imageUri);
      const blob = await response.blob();
      const storageRef = ref(storage, `profilePictures/${user.uid}`);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      setProfilePic(downloadURL);

      await setDoc(
        doc(db, "users", user.uid),
        { profilePic: downloadURL },
        { merge: true }
      );
      Alert.alert("Success", "Profile picture updated!");
    } catch (error: any) {
      console.error("Error uploading profile picture:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) {
      Alert.alert("Error", "You must be logged in to save your profile.");
      return;
    }
    setLoading(true);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        { socialLink: socialLink.trim(), aboutMe: aboutMe.trim(), profilePhotos }, 
        { merge: true }
      );
      Alert.alert("Success", "Profile updated!");
    } catch (error: any) {
      console.error("Error updating profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePickGalleryPhoto = async (index: number) => {
    if (loading) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Please grant media library access to add photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0] && user) {
      setLoading(true);
      try {
        const response = await fetch(result.assets[0].uri);
        const blob = await response.blob();
        const storageRef = ref(storage, `profilePictures/${user.uid}/gallery_${index}`);
        await uploadBytes(storageRef, blob);
        const url = await getDownloadURL(storageRef);
        const next = [...profilePhotos];
        while (next.length < index + 1) next.push("");
        next[index] = url;
        const trimmed = next.filter(Boolean);
        setProfilePhotos(trimmed);
        await setDoc(doc(db, "users", user.uid), { profilePhotos: trimmed }, { merge: true });
      } catch (e: any) {
        console.error("Upload failed (add photo)", e?.message ?? e);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRemoveGalleryPhoto = async (index: number) => {
    if (loading || index >= profilePhotos.length) return;
    const next = profilePhotos.filter((_, i) => i !== index);
    setProfilePhotos(next);
    try {
      await setDoc(doc(db, "users", user!.uid), { profilePhotos: next }, { merge: true });
    } catch (e: any) {
      setProfilePhotos(profilePhotos);
      console.error("Error removing photo", e?.message ?? e);
    }
  };

  // Conditional render for loading states (theme, profile data)
  if (isThemeLoading || isProfileDataLoading) {
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={globalStyles.loadingOverlayText}>
          {isThemeLoading ? "Loading theme..." : "Loading profile data..."}
        </Text>
      </View>
    );
  }
  // Conditional render if user is not logged in after initial loading
  if (!user) {
    return (
      <View style={globalStyles.centeredContainer}>
        <Text style={globalStyles.errorText}>You must be logged in to view your profile.</Text>
        {/* Added a button to navigate to AuthScreen for convenience */}
        <TouchableOpacity onPress={() => navigation.navigate("AuthScreen")} style={globalStyles.primaryButton}>
            <Text style={globalStyles.primaryButtonText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }


  return (
    <SafeAreaView style={globalStyles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollViewContent}>
        {loading && ( 
          <View style={globalStyles.loadingOverlay}> 
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={globalStyles.loadingOverlayText}>Saving...</Text> 
          </View>
        )}

        <View style={styles.headerContainer}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={globalStyles.backButton || globalStyles.primaryButton}
          >
            <Ionicons name="arrow-back" size={FONT_SIZES.xxlarge} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { flex: 1 }]}>Edit Profile</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={async () => {
                if (theme === 'dark') {
                  if (showThemeHint) {
                    try { await AsyncStorage.setItem(THEME_HINT_SEEN_KEY, "true"); } catch {}
                    setShowThemeHint(false);
                  }
                  toggleTheme();
                }
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="sunny"
                size={22}
                color={theme === 'light' ? colors.primary : (colors.textSecondary || colors.secondaryText)}
              />
            </TouchableOpacity>
            <Switch
              value={theme === 'dark'}
              onValueChange={async (value) => {
                if (showThemeHint) {
                  try { await AsyncStorage.setItem(THEME_HINT_SEEN_KEY, "true"); } catch {}
                  setShowThemeHint(false);
                }
                toggleTheme();
              }}
              trackColor={{ false: colors.borderColor, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
            <TouchableOpacity
              onPress={async () => {
                if (theme === 'light') {
                  if (showThemeHint) {
                    try { await AsyncStorage.setItem(THEME_HINT_SEEN_KEY, "true"); } catch {}
                    setShowThemeHint(false);
                  }
                  toggleTheme();
                }
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="moon"
                size={22}
                color={theme === 'dark' ? colors.primary : (colors.textSecondary || colors.secondaryText)}
              />
            </TouchableOpacity>
          </View>
        </View>

        {showThemeHint === true && (
          <View
            style={{
              position: 'absolute',
              top: 56,
              right: 12,
              left: 16,
              alignItems: 'flex-end',
              zIndex: 10,
            }}
            pointerEvents="box-none"
          >
            {/* Pointer (triangle) pointing up at the theme toggle */}
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
                marginRight: 20,
              }}
            />
            <View
              style={{
                backgroundColor: colors.primary + '22',
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 16,
                borderTopRightRadius: 4,
                maxWidth: 280,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.15,
                shadowRadius: 6,
                elevation: 4,
              }}
            >
              <Text style={{ fontSize: 13, color: colors.text }}>
                Tap sun or moon to switch light or dark mode
              </Text>
            </View>
          </View>
        )}

        {/* Tinder-style profile completion progress */}
        <View style={[styles.progressCard, { backgroundColor: colors.cardBackground || colors.background, borderColor: colors.borderColor }]}>
          <View style={styles.progressHeader}>
            <Text style={[styles.progressTitle, { color: colors.text }]}>Profile strength</Text>
            <Text style={[styles.progressCount, { color: colors.primary }]}>{completedCount}/{totalSteps}</Text>
          </View>
          <View style={[styles.progressBarBg, { backgroundColor: colors.borderColor || "#e0e0e0" }]}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${Math.round(profileProgress * 100)}%`, backgroundColor: colors.primary },
              ]}
            />
          </View>
          <View style={styles.progressSteps}>
            {profileSteps.map((step) => (
              <View key={step.key} style={styles.progressStepRow}>
                <View style={[styles.progressStepDot, { backgroundColor: step.done ? colors.primary : (colors.borderColor || "#e0e0e0") }]}>
                  {step.done ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                </View>
                <Text style={[styles.progressStepLabel, { color: colors.text }]}>
                  {step.label}
                  {"count" in step && step.max != null ? ` (${step.count}/${step.max})` : ""}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity
          onPress={handleImagePick}
          style={styles.profilePicContainer}
          disabled={loading}
        >
          <Image
            source={profilePic ? { uri: profilePic } : DEFAULT_AVATAR}
            style={[styles.profilePic, { borderColor: colors.primary }]}
          />
          <Text style={styles.changePicText}>Change Profile Picture</Text>
        </TouchableOpacity>

        {/* Up to 6 photos (Tinder-style) */}
        <View style={styles.gallerySection}>
          <Text style={[styles.label, { color: colors.text }]}>Photos (up to 6)</Text>
          <View style={styles.galleryGrid}>
            {[0, 1, 2, 3, 4, 5].map((index) => {
              const photoUrl = profilePhotos[index];
              return (
                <TouchableOpacity
                  key={index}
                  onPress={() => handlePickGalleryPhoto(index)}
                  onLongPress={() => photoUrl && handleRemoveGalleryPhoto(index)}
                  style={[styles.gallerySlot, { backgroundColor: colors.cardBackground || colors.borderColor, borderColor: colors.borderColor }]}
                  disabled={loading}
                >
                  {photoUrl ? (
                    <>
                      <Image source={{ uri: photoUrl }} style={styles.galleryImage} resizeMode="cover" />
                      <TouchableOpacity
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => handleRemoveGalleryPhoto(index)}
                        style={[styles.galleryRemove, { backgroundColor: "rgba(0,0,0,0.6)" }]}
                      >
                        <Ionicons name="close" size={16} color="#fff" />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Ionicons name="add" size={32} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

<View style={styles.inputSection}>
  <Text style={styles.label}>Username</Text>
  <Text style={[styles.textInput, { paddingVertical: 12 }]}>
    {username || "User"}
  </Text>
</View>
        <View style={styles.inputSection}>
          <Text style={styles.label}>Social Link (optional)</Text>
          <TextInput
            style={styles.textInput} // Removed StyleProp cast
            placeholder="https://your-social-profile"
            placeholderTextColor={colors.placeholderText as string}
            value={socialLink}
            onChangeText={setSocialLink}
            keyboardType="url"
            autoCapitalize="none"
            editable={!loading}
          />
        </View>

        <View style={styles.inputSection}>
          <Text style={styles.label}>About Me</Text>
          <TextInput
            style={[styles.textInput, styles.aboutMeInput]} // Removed StyleProp cast
            placeholder="Write something about yourself..."
            placeholderTextColor={colors.placeholderText as string}
            value={aboutMe}
            onChangeText={setAboutMe}
            multiline
            numberOfLines={4}
            editable={!loading}
          />
        </View>

        <TouchableOpacity onPress={handleSave} style={styles.saveButton} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.activeFilterText} /> : <Text style={styles.saveButtonText}>Save Profile</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ProfileScreen;