import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
  Linking,
  RefreshControl,
  Modal,
  Pressable,
  PanResponder,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RouteProp, useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList, Message, Community } from "../../../types";
import { db, auth } from "../../../firebaseConfig";
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
  arrayUnion,
  deleteDoc,
  increment,
} from "firebase/firestore";

import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Clipboard from "expo-clipboard";

// Lazy load MediaLibrary only when needed - prevents crash if native module not available
let MediaLibraryModule: any = null;
let MediaLibraryChecked = false;

const getMediaLibrary = () => {
  // Only try to load once
  if (MediaLibraryChecked) {
    return MediaLibraryModule;
  }
  MediaLibraryChecked = true;
  
  try {
    // Use require instead of import to avoid module resolution at compile time
    MediaLibraryModule = require("expo-media-library");
    return MediaLibraryModule;
  } catch (e: any) {
    // Silently fail - module not available (needs rebuild)
    console.warn("expo-media-library not available. Rebuild app with: npx expo run:android or npx expo run:ios");
    MediaLibraryModule = null;
    return null;
  }
};
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { Video, ResizeMode } from "expo-av";
import ImageViewing from "react-native-image-viewing";

import { useTheme } from "../../context/ThemeContext";
import createStyles, { SPACING, FONT_SIZES } from "../../context/appStyles";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

const AVATAR_PLACEHOLDER = require("../../../assets/avatar-placeholder.png");

const FALLBACK_EMOJIS = ["😀", "😂", "😍", "🔥", "🥳", "💀", "👍", "💯", "👀", "💸"];
type PinnedMessage = { messageId: string; text: string; senderId?: string; pinnedBy?: string; pinnedAt?: any };
const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const cleanTrailingPunctuation = (value: string) => value.replace(/[),.!?;:]+$/g, '');
const normalizeUrl = (value: string) => {
  const cleaned = cleanTrailingPunctuation(value.trim());
  if (!cleaned) return "";
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
};
const splitMessageByUrls = (text: string) => {
  const parts: Array<{ text: string; isLink: boolean }> = [];
  let lastIndex = 0;
  const matches = Array.from(text.matchAll(URL_REGEX));
  for (const match of matches) {
    const found = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) parts.push({ text: text.slice(lastIndex, start), isLink: false });
    parts.push({ text: found, isLink: true });
    lastIndex = start + found.length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), isLink: false });
  return parts.length ? parts : [{ text, isLink: false }];
};

type GroupChatScreenRouteProp = RouteProp<RootStackParamList, "GroupChatScreen">;
type GroupChatScreenNavigationProp = StackNavigationProp<RootStackParamList, "GroupChatScreen">;

const GroupChatScreen = () => {
  const route = useRoute<GroupChatScreenRouteProp>();
  const navigation = useNavigation<GroupChatScreenNavigationProp>();
  const { groupId, groupName, communityId } = route.params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isGroupMember, setIsGroupMember] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [userProfiles, setUserProfiles] = useState<Record<string, { profilePic?: string; username: string }>>({});
  const [hasPassword, setHasPassword] = useState(false);
  const [isPasswordAuthenticated, setIsPasswordAuthenticated] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [groupProfilePic, setGroupProfilePic] = useState<string | null>(null);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [isCreator, setIsCreator] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showMessageOptions, setShowMessageOptions] = useState(false);
  const [showAttachmentOptions, setShowAttachmentOptions] = useState(false);
  const [pinnedMessage, setPinnedMessage] = useState<PinnedMessage | null>(null);
  const [joiningGroup, setJoiningGroup] = useState(false);
  /** User is in joinedCommunities or is the community creator — required before joining a group. */
  const [isCommunityMember, setIsCommunityMember] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const { colors } = useTheme();
  const styles = createStyles(colors).groupChatScreen;
  const globalStyles = createStyles(colors).global;
  const storage = getStorage();
  const currentUserId = auth.currentUser?.uid;
  const insets = useSafeAreaInsets();
  const [inputBarHeight, setInputBarHeight] = useState(56);

  // 🖼 Unified media viewer
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  const [mediaItems, setMediaItems] = useState<{ uri: string; type: "image" | "video" }[]>([]);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const videoRef = useRef<Video>(null);
  const swipeX = useRef(new Animated.Value(0)).current;
  const swipeOpacity = useRef(new Animated.Value(1)).current;

  // 🔐 Check password authentication status
  const checkPasswordAuth = useCallback(async () => {
    if (!currentUserId) return false;
    
    const storageKey = `group_password_auth_${groupId}_${currentUserId}`;
    try {
      const lastAuthTime = await AsyncStorage.getItem(storageKey);
      if (!lastAuthTime) return false;
      
      const authTime = parseInt(lastAuthTime, 10);
      const now = Date.now();
      const threeHours = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
      
      return (now - authTime) < threeHours;
    } catch (error) {
      console.error("Error checking password auth:", error);
      return false;
    }
  }, [groupId, currentUserId]);

  // 🔐 Store password authentication
  const storePasswordAuth = useCallback(async () => {
    if (!currentUserId) return;
    
    const storageKey = `group_password_auth_${groupId}_${currentUserId}`;
    try {
      await AsyncStorage.setItem(storageKey, Date.now().toString());
      setIsPasswordAuthenticated(true);
      setShowPasswordPrompt(false);
      setPasswordInput("");
    } catch (error) {
      console.error("Error storing password auth:", error);
    }
  }, [groupId, currentUserId]);

  // 🔐 Verify password
  const verifyPassword = useCallback(async () => {
    if (!currentUserId) return;
    
    try {
      const groupDocRef = doc(db, "communities", communityId, "groupChats", groupId);
      const groupSnap = await getDoc(groupDocRef);
      
      if (groupSnap.exists()) {
        const data = groupSnap.data();
        const correctPassword = data.password;
        
        if (passwordInput === correctPassword) {
          await storePasswordAuth();
        } else {
          Alert.alert("Incorrect Password", "The password you entered is incorrect. Please try again.");
          setPasswordInput("");
        }
      }
    } catch (error: any) {
      console.error("Failed to verify password:", error.message);
    }
  }, [passwordInput, communityId, groupId, currentUserId, storePasswordAuth]);

  // 🔄 Fetch group membership (optimized for fast initial load)
  useEffect(() => {
    if (!currentUserId) {
      setIsLoading(false);
      return;
    }

    const groupDocRef = doc(db, "communities", communityId, "groupChats", groupId);

    // Fast initial load with getDoc
    const loadInitialData = async () => {
      try {
        const [docSnap, userSnap, communitySnap] = await Promise.all([
          getDoc(groupDocRef),
          getDoc(doc(db, "users", currentUserId)),
          getDoc(doc(db, "communities", communityId)),
        ]);

        const joinedCommunities: string[] = userSnap.exists()
          ? userSnap.data()?.joinedCommunities || []
          : [];
        const inCommunity =
          joinedCommunities.includes(communityId) ||
          (communitySnap.exists() &&
            communitySnap.data()?.createdBy === currentUserId);
        setIsCommunityMember(!!inCommunity);

        if (docSnap.exists()) {
          const data = docSnap.data();
          const memberIds: string[] = data.members || [];
          const isMember = memberIds.includes(currentUserId);

          setMembers(memberIds);
          setIsGroupMember(isMember);
          setHasPassword(data.hasPassword || false);
          setIsCreator(data.createdBy === currentUserId);
          setGroupProfilePic(data.profilePic || null);
          if (isMember && currentUserId) {
            updateDoc(groupDocRef, { [`unreadCount.${currentUserId}`]: 0 }).catch(() => {});
          }
          // Check password authentication in parallel
          if (data.hasPassword) {
            const isAuthenticated = await checkPasswordAuth();
            setIsPasswordAuthenticated(isAuthenticated);
            if (!isAuthenticated) {
              setShowPasswordPrompt(true);
            }
          } else {
            // No password - allow access immediately
            setIsPasswordAuthenticated(true);
            setShowPasswordPrompt(false);
          }
        } else {
          console.error("Group not found.");
        }
      } catch (error) {
        console.error("Error loading group data:", error);
        setIsCommunityMember(false);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadInitialData();
    
    // Then set up real-time listener for updates
    const unsubscribe = onSnapshot(
      groupDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const memberIds: string[] = data.members || [];
          setMembers(memberIds);
          setIsGroupMember(memberIds.includes(currentUserId));
          setHasPassword(data.hasPassword || false);
          setIsCreator(data.createdBy === currentUserId);
          setGroupProfilePic(data.profilePic || null);
          setPinnedMessage((data.pinnedMessage as PinnedMessage) || null);
        }
      },
      (err) => console.error('Group doc snapshot error:', err)
    );
    return () => unsubscribe();
  }, [communityId, groupId, currentUserId, checkPasswordAuth]);

  const navigateToCommunityDetail = useCallback(() => {
    const stub: Community = {
      id: communityId,
      name: "",
      createdBy: "",
      createdAt: null as any,
    };
    navigation.navigate("CommunityDetailScreen", { community: stub });
  }, [communityId, navigation]);

  // After joining the community elsewhere, refresh membership when this screen is focused again
  useFocusEffect(
    useCallback(() => {
      if (!currentUserId) return;
      let active = true;
      (async () => {
        try {
          const [userSnap, communitySnap] = await Promise.all([
            getDoc(doc(db, "users", currentUserId)),
            getDoc(doc(db, "communities", communityId)),
          ]);
          if (!active) return;
          const joinedCommunities: string[] = userSnap.exists()
            ? userSnap.data()?.joinedCommunities || []
            : [];
          const inCommunity =
            joinedCommunities.includes(communityId) ||
            (communitySnap.exists() &&
              communitySnap.data()?.createdBy === currentUserId);
          setIsCommunityMember(!!inCommunity);
        } catch (e) {
          console.error("Community membership refresh error:", e);
        }
      })();
      return () => {
        active = false;
      };
    }, [currentUserId, communityId])
  );

  // Join this group (community members only; then they can see messages and get notifications)
  const handleJoinGroup = useCallback(async () => {
    if (!currentUserId) return;
    setJoiningGroup(true);
    try {
      const [userSnap, communitySnap] = await Promise.all([
        getDoc(doc(db, "users", currentUserId)),
        getDoc(doc(db, "communities", communityId)),
      ]);
      const joinedCommunities: string[] = userSnap.exists()
        ? userSnap.data()?.joinedCommunities || []
        : [];
      const isCommunityCreator =
        communitySnap.exists() &&
        communitySnap.data()?.createdBy === currentUserId;
      if (!joinedCommunities.includes(communityId) && !isCommunityCreator) {
        Alert.alert(
          "Join community first",
          "You need to be a member of this community before you can join the group.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Go to community", onPress: navigateToCommunityDetail },
          ]
        );
        setJoiningGroup(false);
        return;
      }
      const groupDocRef = doc(db, "communities", communityId, "groupChats", groupId);
      await updateDoc(groupDocRef, { members: arrayUnion(currentUserId) });
      setIsGroupMember(true);
      // onSnapshot will update members; no need to navigate
    } catch (err: any) {
      console.error("Join group error:", err);
      Alert.alert(
        "Could not join",
        err?.message || "Failed to join the group. Try again later."
      );
    } finally {
      setJoiningGroup(false);
    }
  }, [communityId, groupId, currentUserId, navigateToCommunityDetail]);

  // 🔄 Fetch user profiles (optimized to fetch in parallel)
  const fetchUserProfiles = useCallback(async (userIds: string[]) => {
    // Filter out users we already have
    const userIdsToFetch = userIds.filter(id => id && !userProfiles[id]);
    if (userIdsToFetch.length === 0) return;
    
    try {
      // Fetch all profiles in parallel
      const profilePromises = userIdsToFetch.map(async (userId) => {
        try {
          const userDoc = await getDoc(doc(db, "users", userId));
          if (userDoc.exists()) {
            const data = userDoc.data();
            return {
              userId,
              profile: {
                profilePic: data.profilePic || undefined,
                username: data.username || data.displayName || "User",
              },
            };
          }
        } catch (error) {
          console.error(`Error fetching profile for ${userId}:`, error);
        }
        return null;
      });
      
      const results = await Promise.all(profilePromises);
      
      // Update state once with all profiles
      setUserProfiles((prev) => {
        const updated = { ...prev };
        results.forEach((result) => {
          if (result) {
            updated[result.userId] = result.profile;
          }
        });
        return updated;
      });
    } catch (error) {
      console.error("Error fetching user profiles:", error);
    }
  }, [userProfiles]);

  // 🔄 Load messages function (reusable for refresh)
  const loadMessages = useCallback(async () => {
    if (!isGroupMember || !isPasswordAuthenticated) return;
    
    const messagesRef = collection(db, "communities", communityId, "groupChats", groupId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));
    
    try {
      const snapshot = await getDocs(q);
      const loaded = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Message[];
      setMessages(loaded);
      
      // Fetch user profiles in parallel
      const uniqueSenders = Array.from(new Set(loaded.map((msg) => msg.senderId).filter(Boolean)));
      if (uniqueSenders.length > 0) {
        fetchUserProfiles(uniqueSenders);
      }
      setRefreshing(false);
    } catch (error) {
      console.error("Error loading messages:", error);
      setRefreshing(false);
    }
  }, [isGroupMember, isPasswordAuthenticated, communityId, groupId, fetchUserProfiles]);

  // 🔄 Fetch messages (optimized for fast loading)
  useEffect(() => {
    if (!isGroupMember || !isPasswordAuthenticated) return;
    
    const messagesRef = collection(db, "communities", communityId, "groupChats", groupId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));
    
    // Fast initial load with getDocs
    loadMessages();
    
    // Then set up real-time listener for new messages
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Message[];
        setMessages(loaded);
        const uniqueSenders = Array.from(new Set(loaded.map((msg) => msg.senderId).filter(Boolean)));
        if (uniqueSenders.length > 0) {
          fetchUserProfiles(uniqueSenders);
        }
      },
      (err) => console.error('Group messages snapshot error:', err)
    );
    return () => unsubscribe();
  }, [isGroupMember, isPasswordAuthenticated, communityId, groupId, fetchUserProfiles, loadMessages]);

  // Pull to refresh handler
  const onRefresh = useCallback(() => {
    if (!isGroupMember || !isPasswordAuthenticated) return;
    setRefreshing(true);
    loadMessages();
  }, [isGroupMember, isPasswordAuthenticated, loadMessages]);

  // 📩 Send message (update group doc for preview + unread like activity chats)
  const sendMessage = async (content: { text?: string; mediaUrl?: string; mediaType?: string; fileName?: string }) => {
    if (!currentUserId) return;
    if (!content.text && !content.mediaUrl) return;

    const groupRef = doc(db, "communities", communityId, "groupChats", groupId);
    const messagesRef = collection(groupRef, "messages");
    let lastMessageText = content.text || "";
    if (content.mediaType === "image") lastMessageText = "Image 📸";
    else if (content.mediaType === "video") lastMessageText = "Video 🎥";
    else if (content.mediaType === "file") lastMessageText = `File 📄: ${content.fileName || "file"}`;

    try {
      await addDoc(messagesRef, {
        senderId: currentUserId,
        text: content.text || null,
        mediaUrl: content.mediaUrl || null,
        mediaType: content.mediaType || null,
        fileName: content.fileName || null,
        timestamp: serverTimestamp(),
      });
      const groupSnap = await getDoc(groupRef);
      const memberIds: string[] = groupSnap.exists() ? (groupSnap.data()?.members || []) : members;
      const updates: Record<string, unknown> = {
        lastMessageText,
        lastMessageSenderId: currentUserId,
        lastMessageTimestamp: serverTimestamp(),
        [`unreadCount.${currentUserId}`]: 0,
      };
      memberIds.filter((uid) => uid !== currentUserId).forEach((uid) => {
        updates[`unreadCount.${uid}`] = increment(1);
      });
      await updateDoc(groupRef, updates);
      setNewMessage("");
    } catch (error: any) {
      console.error("Error:", error.message);
    }
  };

  // 📤 Upload media with progress tracking (persists even when leaving screen)
  const uploadMediaToFirebase = async (uri: string, fileType: "image" | "video" | "file", fileName: string, mimeType?: string) => {
    if (!currentUserId) return;
    
    setIsUploadingMedia(true);
    
    let messageDocRef: any = null;
    let lastProgressUpdate = 0; // Track last progress value sent to Firestore
    
    try {
      // Create message in Firestore immediately with uploading status
      const groupRef = doc(db, "communities", communityId, "groupChats", groupId);
      const messagesRef = collection(groupRef, "messages");
      const messageData: any = {
        senderId: currentUserId,
        text: null,
        mediaUrl: null,
        mediaType: fileType,
        uploading: true,
        uploadProgress: 0,
        timestamp: serverTimestamp(),
      };
      
      // Only include fileName if it's a file type
      if (fileType === "file") {
        messageData.fileName = fileName;
      }
      
      messageDocRef = await addDoc(messagesRef, messageData);
      
      // Don't add optimistic message - let the real-time listener handle it to avoid duplicates
      // Scroll to bottom after a short delay to let the message appear
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 300);

      // Start upload
      const response = await fetch(uri);
      const blob = await response.blob();
      const path = `group_chat_media/${communityId}/${groupId}/${currentUserId}/${Date.now()}_${fileName}`;
      const storageRef = ref(storage, path);
      
      // Determine content type - use provided mimeType, or detect from file extension
      let contentType = mimeType || 'application/octet-stream'; // Default fallback
      
      if (!mimeType) {
        // Fallback: detect from file extension if mimeType not provided
        if (fileType === 'image') {
          const ext = fileName.split('.').pop()?.toLowerCase();
          if (ext === 'png') contentType = 'image/png';
          else if (ext === 'gif') contentType = 'image/gif';
          else if (ext === 'webp') contentType = 'image/webp';
          else contentType = 'image/jpeg'; // Default to jpeg
        } else if (fileType === 'video') {
          const ext = fileName.split('.').pop()?.toLowerCase();
          if (ext === 'mov') contentType = 'video/quicktime';
          else if (ext === 'webm') contentType = 'video/webm';
          else contentType = 'video/mp4'; // Default to mp4
        } else if (fileType === 'file') {
          const ext = fileName.split('.').pop()?.toLowerCase();
          if (ext === 'pdf') contentType = 'application/pdf';
          // Otherwise keep as octet-stream
        }
      }
      
      // Upload with metadata including content type
      const uploadTask = uploadBytesResumable(storageRef, blob, {
        contentType: contentType,
      });

      // Track upload progress and update Firestore (throttled to reduce permission checks)
      uploadTask.on(
        "state_changed",
        async (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          const progressRounded = Math.round(progress);
          
          // Update UI immediately for smooth progress bar
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageDocRef.id
                ? { ...msg, uploadProgress: progressRounded }
                : msg
            )
          );
          
          // Throttle Firestore updates: only update every 10% or at key milestones
          // This reduces permission checks and improves performance
          const shouldUpdateFirestore = 
            progressRounded === 0 || // Initial state
            progressRounded === 100 || // Complete
            progressRounded - lastProgressUpdate >= 10 || // Every 10%
            (progressRounded >= 90 && lastProgressUpdate < 90); // Near completion
          
          if (shouldUpdateFirestore && messageDocRef) {
            lastProgressUpdate = progressRounded;
            try {
              await updateDoc(messageDocRef, {
                uploadProgress: progressRounded,
              });
            } catch (error: any) {
              // Silently fail - UI will still show progress
              // Permission errors are expected if Firestore rules don't allow progress updates
              if (error?.code !== 'permission-denied') {
                // Only log non-permission errors
                console.warn("Error updating upload progress:", error);
              }
            }
          }
        },
        async (error) => {
          // Upload error - mark as failed in Firestore
          if (messageDocRef) {
            try {
              await updateDoc(messageDocRef, {
                uploading: false,
                uploadError: error.message || "Upload failed",
              });
            } catch (updateError: any) {
              // Silently fail - permission errors are expected if Firestore rules don't allow updates
              if (updateError?.code !== 'permission-denied') {
              console.error("Error updating failed status:", updateError);
              }
            }
          }
          
          // Remove from UI
          setMessages((prev) => prev.filter((msg) => msg.id !== messageDocRef.id));
          setIsUploadingMedia(false);
          console.error("Upload error:", error.message || "Failed to upload file.");
        },
        async () => {
          // Upload complete
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            
            // Update Firestore message with download URL and remove uploading status
            if (messageDocRef) {
              await updateDoc(messageDocRef, {
                mediaUrl: downloadURL,
                uploading: false,
                uploadProgress: 100,
                uploadError: null,
              });
            }
            
            // Update UI
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === messageDocRef.id
                  ? { ...msg, mediaUrl: downloadURL, uploading: false, uploadProgress: 100 }
                  : msg
              )
            );
            let lastMessagePreviewText = "";
            if (fileType === "image") lastMessagePreviewText = "Image 📸";
            else if (fileType === "video") lastMessagePreviewText = "Video 🎥";
            else if (fileType === "file") lastMessagePreviewText = `File 📄: ${fileName}`;
            const groupRef = doc(db, "communities", communityId, "groupChats", groupId);
            const groupSnap = await getDoc(groupRef);
            const memberIds: string[] = groupSnap.exists() ? (groupSnap.data()?.members || []) : [];
            const updates: Record<string, unknown> = {
              lastMessageText: lastMessagePreviewText,
              lastMessageSenderId: currentUserId,
              lastMessageTimestamp: serverTimestamp(),
              [`unreadCount.${currentUserId}`]: 0,
            };
            memberIds.filter((uid) => uid !== currentUserId).forEach((uid) => {
              updates[`unreadCount.${uid}`] = increment(1);
            });
            await updateDoc(groupRef, updates);
          } catch (error: any) {
            // Mark as failed in Firestore
            if (messageDocRef) {
              try {
                await updateDoc(messageDocRef, {
                  uploading: false,
                  uploadError: error.message || "Failed to get download URL",
                });
              } catch (updateError: any) {
                // Silently fail - permission errors are expected if Firestore rules don't allow updates
                if (updateError?.code !== 'permission-denied') {
                console.error("Error updating failed status:", updateError);
                }
              }
            }
            
            setMessages((prev) => prev.filter((msg) => msg.id !== messageDocRef.id));
            console.error("Upload error:", error.message || "Failed to get download URL.");
          } finally {
            setIsUploadingMedia(false);
          }
        }
      );
    } catch (error: any) {
      // Remove message from Firestore if creation failed
      if (messageDocRef) {
        try {
          await deleteDoc(messageDocRef);
        } catch (deleteError) {
          console.error("Error deleting failed message:", deleteError);
        }
      }
      
      setIsUploadingMedia(false);
      console.error("Upload error:", error.message || "Failed to start upload.");
    }
  };

  // 📄 Get file type from extension
  const getFileTypeFromExtension = (fileName: string): "image" | "video" | "file" => {
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
    const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'];
    
    if (imageExtensions.includes(extension)) {
      return 'image';
    } else if (videoExtensions.includes(extension)) {
      return 'video';
    }
    return 'file';
  };

  // 📷 Handle image/video picker
  const handlePickMedia = async (mediaType: "image" | "video") => {
    try {
      // Request permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Required", "Please grant camera roll access to upload media.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaType === "image" ? "images" : "videos",
        allowsEditing: mediaType === "image",
        quality: mediaType === "image" ? 0.8 : 1,
        allowsMultipleSelection: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const uri = asset.uri;
      const fileName = asset.fileName || uri.split("/").pop() || `${mediaType}_${Date.now()}.${mediaType === "image" ? "jpg" : "mp4"}`;
      const mimeType = asset.mimeType || undefined; // Get MIME type from ImagePicker if available
      
      await uploadMediaToFirebase(uri, mediaType, fileName, mimeType);
    } catch (error: any) {
      console.error("Error picking media:", error);
      console.error("Failed to pick media:", error.message);
    }
  };

  // 📎 Handle document picker
  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const file = result.assets[0];
      const fileName = file.name || file.uri.split("/").pop() || "file";
      const fileType = getFileTypeFromExtension(fileName);
      
      await uploadMediaToFirebase(file.uri, fileType, fileName);
    } catch (error: any) {
      console.error("Error picking document:", error);
      console.error("Failed to pick file:", error.message);
    }
  };

  // 📎 Handle attachment button - show options
  const handleAttachmentPress = () => {
    setShowAttachmentOptions(true);
  };

  // 🧠 Unified media viewer handlers
  const openUnifiedMediaViewer = (messageIndex: number) => {
    const items = messages
      .filter(
        (msg) => msg.mediaUrl && (msg.mediaType === "image" || msg.mediaType === "video")
      )
      .map((msg) => ({
        uri: msg.mediaUrl!,
        type: msg.mediaType as "image" | "video",
      }));

    // Find the index of the clicked message in the filtered media items array
    const mediaMessages = messages.filter(
      (msg) => msg.mediaUrl && (msg.mediaType === "image" || msg.mediaType === "video")
    );
    const clickedMessage = messages[messageIndex];
    const startIndex = mediaMessages.findIndex((msg) => msg.id === clickedMessage.id);

    setMediaItems(items);
    setCurrentMediaIndex(startIndex >= 0 ? startIndex : 0);
    setMediaViewerVisible(true);
  };

  // Get current media item
  const getCurrentMedia = () => {
    return mediaItems[currentMediaIndex];
  };

  // Navigate to previous media
  const goToPreviousMedia = () => {
    if (currentMediaIndex > 0) {
      // Pause current video if playing
      if (videoRef.current && getCurrentMedia()?.type === "video") {
        videoRef.current.pauseAsync();
      }
      setCurrentMediaIndex(currentMediaIndex - 1);
    }
  };

  // Navigate to next media
  const goToNextMedia = () => {
    if (currentMediaIndex < mediaItems.length - 1) {
      // Pause current video if playing
      if (videoRef.current && getCurrentMedia()?.type === "video") {
        videoRef.current.pauseAsync();
      }
      setCurrentMediaIndex(currentMediaIndex + 1);
    }
  };

  // Swipe gesture handler
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (evt, gestureState) => {
          // Don't capture if it's a vertical swipe (for closing modal) or if there's only one item
          if (mediaItems.length <= 1) return false;
          // Only capture if it's clearly a horizontal gesture
          return Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        },
        onMoveShouldSetPanResponder: (_, gestureState) => {
          // Only respond to horizontal swipes with sufficient movement
          if (mediaItems.length <= 1) return false;
          return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 15;
        },
        onPanResponderGrant: () => {
          swipeX.setValue(0);
          swipeOpacity.setValue(1);
        },
        onPanResponderMove: (_, gestureState) => {
          swipeX.setValue(gestureState.dx);
          // Reduce opacity as user swipes
          const opacity = 1 - Math.abs(gestureState.dx) / 300;
          swipeOpacity.setValue(Math.max(0.3, opacity));
        },
        onPanResponderRelease: (_, gestureState) => {
          const swipeThreshold = 50;
          const swipeVelocity = gestureState.vx;

          // Determine if swipe is significant enough
          if (Math.abs(gestureState.dx) > swipeThreshold || Math.abs(swipeVelocity) > 0.5) {
            if (gestureState.dx > 0 || swipeVelocity > 0) {
              // Swipe right - go to previous
              goToPreviousMedia();
            } else {
              // Swipe left - go to next
              goToNextMedia();
            }
          }

          // Reset animation
          Animated.parallel([
            Animated.spring(swipeX, {
              toValue: 0,
              useNativeDriver: true,
              tension: 50,
              friction: 7,
            }),
            Animated.spring(swipeOpacity, {
              toValue: 1,
              useNativeDriver: true,
              tension: 50,
              friction: 7,
            }),
          ]).start();
        },
      }),
    [mediaItems.length, goToPreviousMedia, goToNextMedia]
  );

  // Reset swipe animation when media index changes
  useEffect(() => {
    if (mediaViewerVisible) {
      swipeX.setValue(0);
      swipeOpacity.setValue(1);
    }
  }, [currentMediaIndex, mediaViewerVisible]);

  // Handle video playback when index changes
  useEffect(() => {
    const currentMedia = mediaItems[currentMediaIndex];
    if (mediaViewerVisible && currentMedia?.type === "video") {
      // Small delay to ensure video component is mounted
      const timer = setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.playAsync().catch((error) => {
            console.error("Error playing video:", error);
          });
        }
      }, 200);
      return () => {
        clearTimeout(timer);
        // Pause video when component unmounts or changes
        if (videoRef.current) {
          videoRef.current.pauseAsync().catch(() => {
            // Ignore errors when pausing
          });
        }
      };
    }
  }, [currentMediaIndex, mediaViewerVisible, mediaItems]);

  // Cleanup video when modal closes
  useEffect(() => {
    if (!mediaViewerVisible && videoRef.current) {
      videoRef.current.pauseAsync().catch(() => {
        // Ignore errors when pausing
      });
    }
  }, [mediaViewerVisible]);

  const handleDownloadMedia = async () => {
    const media = mediaItems[currentMediaIndex];
    if (!media) return;
    const MediaLibrary = getMediaLibrary();
    if (!MediaLibrary) {
      console.error("Media library is not available. Rebuild with: npx expo run:android or npx expo run:ios");
      return;
    }
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Required", "Grant storage access to save media.");
        return;
      }
      setDownloading(true);
      const fileName = `${Date.now()}.${media.type === "video" ? "mp4" : "jpg"}`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;
      const downloadRes = await FileSystem.downloadAsync(media.uri, fileUri);
      const asset = await MediaLibrary.createAssetAsync(downloadRes.uri);
      await MediaLibrary.createAlbumAsync("Dsquare Media", asset, false);
      Alert.alert("Downloaded", "Saved to your gallery 🎉");
    } catch (error: any) {
      console.error("Download failed:", error.message);
    } finally {
      setDownloading(false);
    }
  };


  const handleSendText = () => {
    if (!newMessage.trim()) return;
    sendMessage({ text: newMessage.trim() });
  };

  const getPinPreview = (msg: Message) => {
    if (msg.text && msg.text.trim()) return msg.text.trim().slice(0, 160);
    if (msg.mediaType === "image") return "Image";
    if (msg.mediaType === "video") return "Video";
    if (msg.mediaType === "file") return msg.fileName ? `File: ${msg.fileName}` : "File";
    return "Pinned message";
  };

  const togglePinSelectedMessage = async () => {
    if (!selectedMessage || !currentUserId) return;
    const groupRef = doc(db, "communities", communityId, "groupChats", groupId);
    try {
      if (pinnedMessage?.messageId === selectedMessage.id) {
        await updateDoc(groupRef, { pinnedMessage: null });
      } else {
        await updateDoc(groupRef, {
          pinnedMessage: {
            messageId: selectedMessage.id,
            text: getPinPreview(selectedMessage),
            senderId: selectedMessage.senderId,
            pinnedBy: currentUserId,
            pinnedAt: serverTimestamp(),
          },
        });
      }
    } catch (error) {
      console.error("Failed to toggle pin:", error);
      Alert.alert("Error", "Could not update pinned message.");
    } finally {
      setShowMessageOptions(false);
      setSelectedMessage(null);
    }
  };

  const openMessageLink = async (rawUrl: string) => {
    const url = normalizeUrl(rawUrl);
    if (!url) return;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert("Invalid link", "This link cannot be opened.");
        return;
      }
      await Linking.openURL(url);
    } catch (error) {
      console.error("Failed to open link:", error);
      Alert.alert("Error", "Could not open this link.");
    }
  };

  // 📋 Copy message to clipboard
  const copyMessage = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert("Copied", "Message copied to clipboard");
    } catch (error) {
      console.error("Failed to copy message");
    }
  };

  // 🗑️ Delete message (only sender can delete)
  const deleteMessage = async (messageId: string) => {
    if (!currentUserId) return;
    
    try {
      // First verify the message belongs to the current user
      const messageRef = doc(db, "communities", communityId, "groupChats", groupId, "messages", messageId);
      const messageSnap = await getDoc(messageRef);
      
      if (!messageSnap.exists()) {
        console.error("Message not found");
        setShowMessageOptions(false);
        setSelectedMessage(null);
        return;
      }
      
      const messageData = messageSnap.data();
      if (messageData.senderId !== currentUserId) {
        Alert.alert("Permission Denied", "You can only delete your own messages");
        setShowMessageOptions(false);
        setSelectedMessage(null);
        return;
      }
      
      // Try to delete - if permission denied, show helpful message
      try {
      await deleteDoc(messageRef);
      setShowMessageOptions(false);
      setSelectedMessage(null);
      } catch (deleteError: any) {
        // If it's a permission error, it's likely a Firestore rules issue
        if (deleteError?.code === 'permission-denied' || deleteError?.message?.includes('permission')) {
          Alert.alert(
            "Cannot Delete", 
            "Message deletion is not enabled. Please contact support if you need this feature."
          );
        } else {
          throw deleteError; // Re-throw if it's a different error
        }
      }
    } catch (error: any) {
      console.error("Delete error:", error);
      if (error?.code === 'permission-denied' || error?.message?.includes('permission')) {
        Alert.alert(
          "Cannot Delete", 
          "Message deletion is not enabled. Please contact support if you need this feature."
        );
      } else {
        console.error("Failed to delete message:", error.message);
      }
      setShowMessageOptions(false);
      setSelectedMessage(null);
    }
  };

  // 📱 Handle long press on message
  const handleMessageLongPress = (msg: Message) => {
    setSelectedMessage(msg);
    setShowMessageOptions(true);
  };

  // 📋 Handle copy from modal
  const handleCopy = async () => {
    if (selectedMessage?.text) {
      await copyMessage(selectedMessage.text);
      setShowMessageOptions(false);
      setSelectedMessage(null);
    }
  };

  // 🗑️ Handle delete from modal
  const handleDelete = () => {
    if (!selectedMessage) return;
    
    Alert.alert(
      "Delete Message",
      "Are you sure you want to delete this message?",
      [
        { text: "Cancel", style: "cancel", onPress: () => {
          setShowMessageOptions(false);
          setSelectedMessage(null);
        }},
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteMessage(selectedMessage.id),
        },
      ]
    );
  };

  // 🕐 Format timestamp
  const formatTimestamp = (timestamp: Date | Timestamp | any) => {
    if (!timestamp) return "";
    
    let date: Date;
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (timestamp?.toDate) {
      date = timestamp.toDate();
    } else if (timestamp?.seconds) {
      date = new Date(timestamp.seconds * 1000);
    } else {
      return "";
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    
    // Format as date if older than a week
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // 💬 Message Renderer
  const renderMessage = (msg: Message, index: number) => {
    const isMyMessage = msg.senderId === currentUserId;
    const userProfile = userProfiles[msg.senderId] || { username: "User" };
    const senderName = msg.sender || userProfile.username;
    const profilePic = msg.senderProfilePic || userProfile.profilePic;
    
    // Get initials for avatar fallback
    const initials = senderName
      ?.split(" ")
      .map((n: string) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "??";

    // Check if previous message is from same sender (to hide avatar if consecutive)
    const prevMessage = index > 0 ? messages[index - 1] : null;
    const showAvatar = !isMyMessage && (!prevMessage || prevMessage.senderId !== msg.senderId);

    return (
      <View
        key={msg.id}
        style={[
          styles.messageBubbleWrapper,
          isMyMessage ? styles.myMessageBubbleWrapper : styles.otherMessageBubbleWrapper,
        ]}
      >
        {/* Profile Picture - only show for others' messages and when not consecutive */}
        {!isMyMessage && (
          <View style={styles.avatarContainer}>
            {showAvatar ? (
              profilePic ? (
                <Image source={{ uri: profilePic }} style={styles.messageAvatar} />
              ) : (
                <View style={[styles.messageAvatar, styles.messageAvatarFallback]}>
                  <Text style={styles.messageAvatarFallbackText}>{initials}</Text>
                </View>
              )
            ) : (
              <View style={{ width: 30 }} />
            )}
          </View>
        )}

        {/* Message Content */}
        <TouchableOpacity
          activeOpacity={1}
          onLongPress={() => handleMessageLongPress(msg)}
          style={[
            styles.messageContainer,
            isMyMessage ? styles.myMessageContainer : styles.otherMessageContainer,
          ]}
        >
          {/* Sender name for others' messages */}
          {!isMyMessage && showAvatar && (
            <Text style={styles.senderName}>{senderName}</Text>
          )}

          {/* Uploading State */}
          {msg.uploading ? (
            <View style={{
              padding: SPACING.medium,
              backgroundColor: colors.primaryLight || colors.cardBackground,
              borderRadius: 8,
              minWidth: 200,
            }}>
              {msg.mediaType === "file" ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.small }}>
                    <Ionicons name="document-outline" size={24} color={colors.primary} />
                    <Text
                      style={[
                        styles.messageText,
                        isMyMessage ? styles.myMessageText : styles.otherMessageText,
                        { marginLeft: SPACING.small, flex: 1 },
                      ]}
                      numberOfLines={1}
                    >
                      {msg.fileName || "File"}
                    </Text>
                  </View>
                  <View style={{
                    height: 4,
                    backgroundColor: colors.border || '#E0E0E0',
                    borderRadius: 2,
                    overflow: 'hidden',
                    marginTop: SPACING.xsmall,
                  }}>
                    <View style={{
                      height: '100%',
                      width: `${msg.uploadProgress || 0}%`,
                      backgroundColor: colors.primary,
                    }} />
                  </View>
                  <Text
                    style={[
                      styles.timestamp,
                      isMyMessage ? styles.myMessageTimestamp : styles.otherMessageTimestamp,
                      { marginTop: SPACING.xsmall, fontSize: FONT_SIZES.xsmall },
                    ]}
                  >
                    Uploading {msg.uploadProgress || 0}%
                  </Text>
                </>
              ) : (
                <>
                  <View style={{
                    width: 200,
                    height: 150,
                    backgroundColor: colors.border || '#E0E0E0',
                    borderRadius: 8,
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginBottom: SPACING.small,
                  }}>
                    <ActivityIndicator size="large" color={colors.primary} />
                  </View>
                  <Text
                    style={[
                      styles.timestamp,
                      isMyMessage ? styles.myMessageTimestamp : styles.otherMessageTimestamp,
                      { marginTop: SPACING.xsmall, fontSize: FONT_SIZES.xsmall },
                    ]}
                  >
                    Uploading media...
                  </Text>
                </>
              )}
            </View>
          ) : msg.mediaUrl && msg.mediaType === "image" ? (
            <TouchableOpacity onPress={() => openUnifiedMediaViewer(index)}>
              <Image source={{ uri: msg.mediaUrl }} style={styles.mediaMessageImage} />
            </TouchableOpacity>
          ) : msg.mediaUrl && msg.mediaType === "video" ? (
            <TouchableOpacity onPress={() => openUnifiedMediaViewer(index)} activeOpacity={0.9}>
              <View style={{ position: "relative" }}>
                <Video
                  source={{ uri: msg.mediaUrl }}
                  style={styles.mediaMessageImage}
                  resizeMode={ResizeMode.COVER}
                  shouldPlay={false}
                  isMuted={true}
                  useNativeControls={false}
                  isLooping={false}
                />
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: "rgba(0, 0, 0, 0.2)",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                <Ionicons
                    name="play-circle"
                  size={50}
                  color="#fff"
                  style={{
                    opacity: 0.9,
                      textShadowColor: "rgba(0, 0, 0, 0.5)",
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: 3,
                  }}
                />
                </View>
              </View>
            </TouchableOpacity>
          ) : msg.mediaUrl && msg.mediaType === "file" ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(msg.mediaUrl!)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: SPACING.small,
                backgroundColor: colors.primaryLight || colors.cardBackground,
                borderRadius: 8,
                marginBottom: SPACING.xsmall,
              }}
            >
              <Ionicons name="document-outline" size={24} color={colors.primary} />
              <Text
                style={[
                  styles.messageText,
                  isMyMessage ? styles.myMessageText : styles.otherMessageText,
                  { marginLeft: SPACING.small, flex: 1 },
                ]}
                numberOfLines={1}
              >
                {msg.fileName || "File"}
              </Text>
              <Ionicons name="download-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          ) : null}

          {/* Text */}
          {msg.text && (
            <Text
              style={[
                styles.messageText,
                isMyMessage ? styles.myMessageText : styles.otherMessageText,
              ]}
            >
              {splitMessageByUrls(msg.text).map((part, idx) =>
                part.isLink ? (
                  <Text
                    key={`link_${msg.id}_${idx}`}
                    style={{
                      textDecorationLine: "underline",
                      color: isMyMessage ? "#D7EEFF" : colors.primary,
                    }}
                    onPress={() => openMessageLink(part.text)}
                  >
                    {part.text}
                  </Text>
                ) : (
                  <Text key={`txt_${msg.id}_${idx}`}>{part.text}</Text>
                )
              )}
            </Text>
          )}

          {/* Timestamp */}
          <Text
            style={[
              styles.timestamp,
              isMyMessage ? styles.myMessageTimestamp : styles.otherMessageTimestamp,
            ]}
          >
            {formatTimestamp(msg.timestamp)}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (isLoading)
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textPrimary }}>Loading group...</Text>
      </View>
    );

  // Not a member: show "Join this group" so they opt in before seeing messages or getting notifications
  if (!isGroupMember) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={FONT_SIZES.xxlarge} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{groupName}</Text>
          <View style={{ width: 40 }} />
        </View>
        {pinnedMessage ? (
          <View
            style={{
              marginHorizontal: 12,
              marginTop: 6,
              marginBottom: 6,
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: colors.cardBackground,
              borderWidth: 1,
              borderColor: colors.border,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <Ionicons name="pin" size={14} color={colors.primary} style={{ marginRight: 8 }} />
            <Text style={{ color: colors.textSecondary, flex: 1 }} numberOfLines={1}>
              {pinnedMessage.text}
            </Text>
          </View>
        ) : null}
        <View style={[globalStyles.centeredContainer, { flex: 1, padding: SPACING.xlarge }]}>
          <View style={{
            backgroundColor: colors.cardBackground,
            padding: SPACING.xlarge,
            borderRadius: 12,
            width: "100%",
            maxWidth: 400,
            alignItems: "center",
          }}>
            <Ionicons name="chatbubbles-outline" size={56} color={colors.primary} style={{ marginBottom: SPACING.medium }} />
            <Text style={{
              fontSize: FONT_SIZES.xlarge,
              fontWeight: "bold",
              color: colors.textPrimary,
              marginBottom: SPACING.small,
              textAlign: "center",
            }}>
              {isCommunityMember ? "Join this group?" : "Join the community first"}
            </Text>
            <Text style={{
              fontSize: FONT_SIZES.medium,
              color: colors.textSecondary,
              marginBottom: SPACING.xlarge,
              textAlign: "center",
              lineHeight: 22,
            }}>
              {isCommunityMember
                ? "You’ll see messages and get notifications from this group. Join only if you want to participate."
                : "You need to join this community before you can join this group chat. Open the community page, tap Join Community, then come back here."}
            </Text>
            {isCommunityMember ? (
            <TouchableOpacity
              style={{
                backgroundColor: colors.primary,
                paddingVertical: SPACING.medium,
                paddingHorizontal: SPACING.xlarge,
                borderRadius: 8,
                alignSelf: "stretch",
                alignItems: "center",
              }}
              onPress={handleJoinGroup}
              disabled={joiningGroup}
            >
              {joiningGroup ? (
                <ActivityIndicator size="small" color={colors.buttonText} />
              ) : (
                <Text style={{ color: colors.buttonText, fontSize: FONT_SIZES.medium, fontWeight: "bold" }}>
                  Join group
                </Text>
              )}
            </TouchableOpacity>
            ) : (
            <TouchableOpacity
              style={{
                backgroundColor: colors.primary,
                paddingVertical: SPACING.medium,
                paddingHorizontal: SPACING.xlarge,
                borderRadius: 8,
                alignSelf: "stretch",
                alignItems: "center",
              }}
              onPress={navigateToCommunityDetail}
            >
              <Text style={{ color: colors.buttonText, fontSize: FONT_SIZES.medium, fontWeight: "bold" }}>
                Go to community
              </Text>
            </TouchableOpacity>
            )}
            <TouchableOpacity
              style={{ marginTop: SPACING.medium }}
              onPress={() => navigation.goBack()}
              disabled={joiningGroup}
            >
              <Text style={{ color: colors.textSecondary, fontSize: FONT_SIZES.medium }}>
                Not now
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Show password prompt if needed
  if (showPasswordPrompt && !isPasswordAuthenticated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={FONT_SIZES.xxlarge} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{groupName}</Text>
        </View>
        <View style={globalStyles.centeredContainer}>
          <View style={{
            backgroundColor: colors.cardBackground,
            padding: SPACING.xlarge,
            borderRadius: 12,
            width: '90%',
            maxWidth: 400,
          }}>
            <Text style={{
              fontSize: FONT_SIZES.xlarge,
              fontWeight: 'bold',
              color: colors.textPrimary,
              marginBottom: SPACING.medium,
              textAlign: 'center',
            }}>
              Password Required
            </Text>
            <Text style={{
              fontSize: FONT_SIZES.medium,
              color: colors.textSecondary,
              marginBottom: SPACING.large,
              textAlign: 'center',
            }}>
              This group is password protected. Please enter the password to continue.
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
                padding: SPACING.medium,
                fontSize: FONT_SIZES.medium,
                color: colors.textPrimary,
                backgroundColor: colors.background,
                marginBottom: SPACING.medium,
              }}
              placeholder="Enter password"
              placeholderTextColor={colors.textSecondary}
              value={passwordInput}
              onChangeText={setPasswordInput}
              secureTextEntry
              autoFocus
              onSubmitEditing={verifyPassword}
            />
            <TouchableOpacity
              style={{
                backgroundColor: colors.primary,
                padding: SPACING.medium,
                borderRadius: 8,
                alignItems: 'center',
              }}
              onPress={verifyPassword}
            >
              <Text style={{
                color: colors.buttonText,
                fontSize: FONT_SIZES.medium,
                fontWeight: 'bold',
              }}>
                Enter
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                marginTop: SPACING.medium,
                alignItems: 'center',
              }}
              onPress={() => navigation.goBack()}
            >
              <Text style={{
                color: colors.primary,
                fontSize: FONT_SIZES.medium,
              }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Block access if password required but not authenticated
  if (hasPassword && !isPasswordAuthenticated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={globalStyles.centeredContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.textPrimary, marginTop: SPACING.medium }}>
            Verifying access...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Header is inside KeyboardAvoidingView; use 0 so input sits just above keyboard
  const KAV_OFFSET = 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={KAV_OFFSET}
      >
        <View style={styles.headerContainer}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={FONT_SIZES.xxlarge} color={colors.textPrimary} />
          </TouchableOpacity>
          {groupProfilePic ? (
            <Image source={{ uri: groupProfilePic }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
              <Text style={styles.headerAvatarFallbackText} numberOfLines={1}>
                {groupName?.substring(0, 2).toUpperCase() || "??"}
              </Text>
            </View>
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>{groupName}</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {/* Group Info Button */}
            <TouchableOpacity
              onPress={() =>
                navigation.navigate("GroupDetailsScreen", {
                  groupId,
                  groupName,
                  communityId,
                })
              }
            >
              <Ionicons
                name="information-circle-outline"
                size={FONT_SIZES.xxlarge}
                color={colors.textPrimary}
              />
            </TouchableOpacity>
          </View>
        </View>
        {pinnedMessage ? (
          <View
            style={{
              marginHorizontal: 12,
              marginTop: 6,
              marginBottom: 6,
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: colors.cardBackground,
              borderWidth: 1,
              borderColor: colors.border,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <Ionicons name="pin" size={14} color={colors.primary} style={{ marginRight: 8 }} />
            <Text style={{ color: colors.textSecondary, flex: 1 }} numberOfLines={1}>
              {pinnedMessage.text}
            </Text>
          </View>
        ) : null}

        <ScrollView 
          ref={scrollViewRef} 
          style={styles.messageScrollView}
          contentContainerStyle={[
            styles.messageList,
            { paddingBottom: inputBarHeight + insets.bottom + 12 },
          ]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {messages.map((msg, i) => renderMessage(msg, i))}
        </ScrollView>


        <View
          style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 25) }]}
          onLayout={(e) => setInputBarHeight(e.nativeEvent.layout.height)}
        >
          <TouchableOpacity
            onPress={handleAttachmentPress}
            style={styles.attachmentButton}
          >
            <Ionicons
              name="attach-outline"
              size={FONT_SIZES.xxlarge}
              color={colors.primary}
            />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={newMessage}
            onChangeText={setNewMessage}
            placeholder="Type a message..."
            placeholderTextColor={colors.textSecondary}
            multiline
            {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
          />
          <TouchableOpacity style={styles.sendButton} onPress={handleSendText}>
            <Ionicons name="send" size={FONT_SIZES.xlarge} color={colors.buttonText} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

{/* 🧩 Image viewer: render outside Modal so it can take full screen (no dark layer on top) */}
      {mediaViewerVisible && getCurrentMedia()?.type === "image" && (
        <ImageViewing
          images={mediaItems.filter((m) => m.type === "image").map((m) => ({ uri: m.uri }))}
          imageIndex={
            mediaItems
              .slice(0, currentMediaIndex + 1)
              .filter((m) => m.type === "image").length - 1
          }
          visible={true}
          onRequestClose={() => setMediaViewerVisible(false)}
          swipeToCloseEnabled
          doubleTapToZoomEnabled
          animationType="fade"
          backgroundColor="rgba(0, 0, 0, 0.95)"
          FooterComponent={() => (
            <View
              style={{
                backgroundColor: "rgba(0,0,0,0.6)",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingVertical: 10,
                paddingHorizontal: 20,
              }}
            >
              <Text style={{ color: "white" }}>
                {currentMediaIndex + 1} / {mediaItems.length}
              </Text>
              <TouchableOpacity
                onPress={handleDownloadMedia}
                disabled={downloading}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: downloading ? "#666" : "#007AFF",
                }}
              >
                {downloading ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <>
                    <Ionicons name="download-outline" size={20} color="white" />
                    <Text style={{ color: "white", marginLeft: 5 }}>Download</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
          onImageIndexChange={(index: number) => {
            const imageItems = mediaItems.filter((m) => m.type === "image");
            if (imageItems[index]) {
              const actualIndex = mediaItems.findIndex((m) => m.uri === imageItems[index].uri);
              setCurrentMediaIndex(actualIndex);
            }
          }}
        />
      )}

      {/* 🧩 Video viewer: use Modal so we can show native controls + nav */}
      {mediaViewerVisible && getCurrentMedia()?.type === "video" && (
        <Modal
          visible={true}
          transparent
          animationType="fade"
          onRequestClose={() => setMediaViewerVisible(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0, 0, 0, 0.95)",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <TouchableOpacity
              onPress={() => setMediaViewerVisible(false)}
              style={{
                position: "absolute",
                top: insets.top + 10,
                right: 20,
                zIndex: 10,
                padding: 10,
              }}
            >
              <Ionicons name="close" size={30} color="white" />
            </TouchableOpacity>

            <Animated.View
              style={{
                flex: 1,
                width: "100%",
                transform: [{ translateX: swipeX }],
                opacity: swipeOpacity,
              }}
              {...panResponder.panHandlers}
            >
              <View style={{ flex: 1, width: "100%", justifyContent: "center" }}>
                <Video
                  key={getCurrentMedia()?.uri}
                  ref={videoRef}
                  source={{ uri: getCurrentMedia()?.uri || "" }}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay
                  style={{ width: "100%", height: "100%" }}
                  onError={(error) => {
                    console.error("Video error:", error);
                    console.error("Failed to load video");
                  }}
                />
              </View>
            </Animated.View>

            <View
              style={{
                position: "absolute",
                bottom: insets.bottom + 20,
                left: 0,
                right: 0,
                backgroundColor: "rgba(0,0,0,0.6)",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingVertical: 15,
                paddingHorizontal: 20,
              }}
            >
              <TouchableOpacity
                onPress={goToPreviousMedia}
                disabled={currentMediaIndex === 0}
                style={{ padding: 10, opacity: currentMediaIndex === 0 ? 0.3 : 1 }}
              >
                <Ionicons name="chevron-back" size={30} color="white" />
              </TouchableOpacity>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: "white", fontSize: 16, marginRight: 20 }}>
                  {currentMediaIndex + 1} / {mediaItems.length}
                </Text>
                <TouchableOpacity
                  onPress={handleDownloadMedia}
                  disabled={downloading}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: downloading ? "#666" : "#007AFF",
                  }}
                >
                  {downloading ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <>
                      <Ionicons name="download-outline" size={20} color="white" />
                      <Text style={{ color: "white", marginLeft: 5 }}>Download</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={goToNextMedia}
                disabled={currentMediaIndex === mediaItems.length - 1}
                style={{
                  padding: 10,
                  opacity: currentMediaIndex === mediaItems.length - 1 ? 0.3 : 1,
                }}
              >
                <Ionicons name="chevron-forward" size={30} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* 📱 Message Options Modal */}
      <Modal
        visible={showMessageOptions}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowMessageOptions(false);
          setSelectedMessage(null);
        }}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            justifyContent: "flex-end",
          }}
          onPress={() => {
            setShowMessageOptions(false);
            setSelectedMessage(null);
          }}
        >
          <Pressable
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingBottom: insets.bottom + 20,
              paddingTop: 20,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            {selectedMessage && (
              <>
                {selectedMessage.text && selectedMessage.text.trim().length > 0 && (
                  <TouchableOpacity
                    style={{
                      paddingVertical: 16,
                      paddingHorizontal: 20,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                    onPress={handleCopy}
                  >
                    <Text style={{ color: colors.text, fontSize: 16 }}>Copy</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={{
                    paddingVertical: 16,
                    paddingHorizontal: 20,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                  onPress={togglePinSelectedMessage}
                >
                  <Text style={{ color: colors.text, fontSize: 16 }}>
                    {pinnedMessage?.messageId === selectedMessage.id ? "Unpin" : "Pin"}
                  </Text>
                </TouchableOpacity>
                {selectedMessage.senderId === currentUserId && (
                  <TouchableOpacity
                    style={{
                      paddingVertical: 16,
                      paddingHorizontal: 20,
                    }}
                    onPress={handleDelete}
                  >
                    <Text style={{ color: "#FF3B30", fontSize: 16, fontWeight: "600" }}>
                      Delete
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            <TouchableOpacity
              style={{
                paddingVertical: 16,
                paddingHorizontal: 20,
                marginTop: 10,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
              onPress={() => {
                setShowMessageOptions(false);
                setSelectedMessage(null);
              }}
            >
              <Text style={{ color: colors.text, fontSize: 16, textAlign: "center" }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 📎 Attachment Options Modal */}
      <Modal
        visible={showAttachmentOptions}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowAttachmentOptions(false);
        }}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            justifyContent: "flex-end",
          }}
          onPress={() => {
            setShowAttachmentOptions(false);
          }}
        >
          <Pressable
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingBottom: insets.bottom + 20,
              paddingTop: 20,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 18,
                fontWeight: "600",
                paddingHorizontal: 20,
                paddingBottom: 16,
              }}
            >
              Choose Attachment
            </Text>
            <TouchableOpacity
              style={{
                paddingVertical: 16,
                paddingHorizontal: 20,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
              onPress={() => {
                setShowAttachmentOptions(false);
                handlePickMedia("image");
              }}
            >
              <Text style={{ color: colors.text, fontSize: 16 }}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                paddingVertical: 16,
                paddingHorizontal: 20,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
              onPress={() => {
                setShowAttachmentOptions(false);
                handlePickMedia("video");
              }}
            >
              <Text style={{ color: colors.text, fontSize: 16 }}>Video</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                paddingVertical: 16,
                paddingHorizontal: 20,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
              onPress={() => {
                setShowAttachmentOptions(false);
                handlePickDocument();
              }}
            >
              <Text style={{ color: colors.text, fontSize: 16 }}>Document</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                paddingVertical: 16,
                paddingHorizontal: 20,
                marginTop: 10,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
              onPress={() => {
                setShowAttachmentOptions(false);
              }}
            >
              <Text style={{ color: colors.text, fontSize: 16, textAlign: "center" }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

    </SafeAreaView>
  );
};

export default GroupChatScreen;
