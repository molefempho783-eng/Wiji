// Screens/ChatRoomScreen.tsx
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  PanResponder,
  Animated,
} from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';

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
    MediaLibraryModule = require('expo-media-library');
    return MediaLibraryModule;
  } catch (e: any) {
    // Silently fail - module not available (needs rebuild)
    console.warn('expo-media-library not available. Rebuild app with: npx expo run:android or npx expo run:ios');
    MediaLibraryModule = null;
    return null;
  }
};

import {
  doc,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
  deleteDoc,
  increment,
  arrayUnion,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '../../firebaseConfig';
import { RootStackParamList } from '../../types';

import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Video, ResizeMode } from 'expo-av';
import ImageViewing from 'react-native-image-viewing';

import createStyles, { SPACING, FONT_SIZES } from '../context/appStyles';
import { useTheme } from '../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';

import { useSafeAreaInsets } from 'react-native-safe-area-context';


const requestFilePermission = async (): Promise<boolean> => {
  const MediaLibrary = getMediaLibrary();
  if (!MediaLibrary) {
    Alert.alert("Error", "Media library is not available. Please rebuild the app with: npx expo run:android or npx expo run:ios");
    return false;
  }
  const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync();

  if (status === "granted") {
    return true;
  }

  // If user has permanently denied permission
  if (!canAskAgain) {
    Alert.alert(
      "Permission Required",
      "File and media access is required to attach files. Please enable it in app settings.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Open Settings",
          onPress: async () => {
            if (Platform.OS === "ios") {
              await Linking.openURL("app-settings:");
            } else {
              await Linking.openSettings();
            }
          },
        },
      ]
    );
    return false;
  }

  // If denied but can ask again, prompt again
  Alert.alert(
    "Permission Required",
    "We need permission to access your files and media to attach documents."
  );
  return false;
};


type ChatRoomScreenRouteProp = RouteProp<RootStackParamList, 'ChatRoomScreen'>;
type ChatRoomScreenNavigationProp = any;

interface Message {
  id: string;
  text?: string;
  senderId: string;
  createdAt: any;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'file';
  fileName?: string;
  fileSize?: number;
  uploading?: boolean;
  uploadProgress?: number;
  uploadError?: string;
}

const AVATAR_PLACEHOLDER = require('../../assets/avatar-placeholder.png');

const EMOJI_API_URL =
  'https://emoji-api.com/emojis?access_key=f4afea21bfcc54275a9e03d3daf1bb0bb82c19f3';

const FALLBACK_EMOJIS = [
  '😀','😂','🤣','😊','😇','🥰','😍','🤩','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','😵','🤯','🤠','🥳','😎','🤓','🤔','🫣','🤫','🫢','🫡','🤥','🫠','😮‍💨','😤','😠','😡','🤬','😈','👿','💀','👻','👽','👾','🤖','💩','🤡','👹','👺','😺','😸','😹','😻','😼','😽','🙀','😿','😾','👋','🤚','🖐️','✋','🖖','👌','🤏','🤞','✌️','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','🤲','🤝',
];

const ChatRoomScreen = () => {
  const route = useRoute<ChatRoomScreenRouteProp>();
  const navigation = useNavigation<ChatRoomScreenNavigationProp>();
  const { chatId, recipientId } = route.params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [recipientUsername, setRecipientUsername] = useState('Loading...');
  const [recipientProfilePic, setRecipientProfilePic] = useState<string | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojis, setEmojis] = useState<string[]>([]);
  const [fetchingEmojis, setFetchingEmojis] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showMessageOptions, setShowMessageOptions] = useState(false);
  const [showAttachmentOptions, setShowAttachmentOptions] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [showFriendRequestHint, setShowFriendRequestHint] = useState(false);
  
  // Show hint automatically when user first sees the button (if not a friend)
  useEffect(() => {
    if (!isFriend && !loading) {
      const timer = setTimeout(() => {
        setShowFriendRequestHint(true);
      }, 1000); // Show after 1 second
      return () => clearTimeout(timer);
    }
  }, [isFriend, loading]);
  
  // Auto-dismiss hint after 4 seconds
  useEffect(() => {
    if (showFriendRequestHint) {
      const timer = setTimeout(() => {
        setShowFriendRequestHint(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [showFriendRequestHint]);

  // 🖼 Unified media viewer
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  const [mediaItems, setMediaItems] = useState<{ uri: string; type: "image" | "video" }[]>([]);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const videoRef = useRef<Video>(null);
  const swipeX = useRef(new Animated.Value(0)).current;
  const swipeOpacity = useRef(new Animated.Value(1)).current;

  const currentUser = auth.currentUser;
  const { colors } = useTheme();
  const styles = createStyles(colors).chatRoomScreen;
  const globalStyles = createStyles(colors).global;
  const storage = getStorage();

  // ---- keep input visible above keyboard (offset 0 so input sits just above keyboard)
  const insets = useSafeAreaInsets();
  const KAV_OFFSET = 0;
  const [inputBarHeight, setInputBarHeight] = useState(56);
  const extraPanelHeight = showEmojiPicker ? 240 : 0;

  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!loading) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages, loading]);

  // Load recipient info & messages; clear unread flag on open (optimized for fast loading)
  useEffect(() => {
    if (!currentUser) {
      console.warn('User not logged in for chat.');
      navigation.goBack();
      return;
    }

    // Fast initial load - load everything in parallel
    const loadInitialData = async () => {
      try {
        const chatDocRef = doc(db, 'chats', chatId);
        const messagesRef = collection(db, 'chats', chatId, 'messages');
        const messagesQuery = query(messagesRef, orderBy('createdAt', 'asc'));
        const userDocRef = doc(db, 'users', recipientId);

        // Load all data in parallel for faster initial load
        const [chatSnap, messagesSnap, userDoc] = await Promise.all([
          getDoc(chatDocRef),
          getDocs(messagesQuery).catch(() => null), // Don't fail if messages collection doesn't exist yet
          getDoc(userDocRef),
        ]);

        // Set recipient data immediately
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setRecipientUsername(userData.username || 'Unknown User');
          setRecipientProfilePic(
            typeof userData.profilePic === 'string' ? userData.profilePic : null
          );
        } else {
          setRecipientUsername('User Not Found');
          setRecipientProfilePic(null);
        }

        // Check if recipient is a friend
        let weHaveThemAsFriend = false;
        if (currentUser) {
          const currentUserRef = doc(db, 'users', currentUser.uid);
          const currentUserSnap = await getDoc(currentUserRef);
          if (currentUserSnap.exists()) {
            const friendsData = currentUserSnap.data().friends;
            // Handle both array (legacy) and map (new) formats
            if (Array.isArray(friendsData)) {
              weHaveThemAsFriend = friendsData.includes(recipientId);
              setIsFriend(weHaveThemAsFriend);
            } else if (friendsData && typeof friendsData === 'object') {
              weHaveThemAsFriend = friendsData[recipientId] === true;
              setIsFriend(weHaveThemAsFriend);
            } else {
              setIsFriend(false);
            }
          }
        }

        // Repair: if we already have them as friend (e.g. we accepted on another device) but their doc doesn't have us, add ourselves so their Friends list updates
        if (weHaveThemAsFriend && userDoc.exists()) {
          const theirData = userDoc.data();
          const f = theirData?.friends;
          let theirFriends: Record<string, boolean> = {};
          if (Array.isArray(f)) theirFriends = Object.fromEntries((f as string[]).map((id: string) => [id, true]));
          else if (f && typeof f === 'object' && f !== null)
            theirFriends = Object.fromEntries(
              Object.entries(f as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => [k, true])
            );
          if (theirFriends[currentUser!.uid] !== true) {
            const theirNew = { ...theirFriends, [currentUser!.uid]: true };
            updateDoc(userDocRef, { friends: theirNew }).catch(() => {});
          }
        }

        // Set messages immediately from initial load
        if (messagesSnap) {
          const initialMessages = messagesSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as any),
          })) as Message[];
          setMessages(initialMessages);
          setLoading(false);
        } else {
          setMessages([]);
          setLoading(false);
        }

        // Ensure chat exists (await so Chats tab listener can see it) and clear unread
        if (!chatSnap.exists()) {
          await setDoc(chatDocRef, {
            participants: [currentUser.uid, recipientId],
            createdAt: serverTimestamp(),
            unreadFor: { [currentUser.uid]: false, [recipientId]: false },
            unreadCount: { [currentUser.uid]: 0, [recipientId]: 0 },
          }, { merge: true });
          await updateDoc(doc(db, 'users', currentUser.uid), { chatIds: arrayUnion(chatId) });
          try {
            await updateDoc(doc(db, 'users', recipientId), { chatIds: arrayUnion(chatId) });
          } catch (_) {}
        } else {
          // Mark as read and clear unread count in background
          updateDoc(chatDocRef, {
            [`unreadFor.${currentUser.uid}`]: false,
            [`unreadCount.${currentUser.uid}`]: 0,
          }).catch(() => {
            // Ignore errors
          });
        }
      } catch (error: any) {
        console.error('Error loading initial data:', error);
        setLoading(false);
        // Still try to set recipient data from route params if available
        setRecipientUsername('Loading...');
      }
    };

    loadInitialData();

    // Set up real-time listener for friend status
    let friendStatusUnsub: (() => void) | null = null;
    if (currentUser) {
      const currentUserRef = doc(db, 'users', currentUser.uid);
      friendStatusUnsub = onSnapshot(currentUserRef, (snap) => {
        if (snap.exists()) {
          const friendsData = snap.data().friends;
          // Handle both array (legacy) and map (new) formats
          if (Array.isArray(friendsData)) {
            setIsFriend(friendsData.includes(recipientId));
          } else if (friendsData && typeof friendsData === 'object') {
            setIsFriend(friendsData[recipientId] === true);
          } else {
            setIsFriend(false);
          }
        }
      });
    }

    // Set up real-time listener for new messages (after initial load)
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const serverMessages = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Message[];
        setMessages(serverMessages);
        // Loading will already be false from initial load, but ensure it's set
        setLoading(false);
      },
      (error: any) => {
        console.error('Error fetching messages:', error);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
      if (friendStatusUnsub) {
        friendStatusUnsub();
      }
    };
  }, [chatId, currentUser, recipientId, navigation]);

  const fetchEmojis = useCallback(async () => {
    if (emojis.length > 0 || fetchingEmojis) return;
    setFetchingEmojis(true);
    try {
      const response = await fetch(EMOJI_API_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const fetched = data
        .filter((e: { unicodeName: string }) => !e.unicodeName.includes('skin tone'))
        .map((e: { character: string }) => e.character);
      setEmojis(fetched.slice(0, 200));
    } catch {
      setEmojis(FALLBACK_EMOJIS);
    } finally {
      setFetchingEmojis(false);
    }
  }, [emojis.length, fetchingEmojis]);

  useEffect(() => {
    if (showEmojiPicker && emojis.length === 0 && !fetchingEmojis) {
      fetchEmojis();
    }
  }, [showEmojiPicker, emojis.length, fetchingEmojis, fetchEmojis]);

  // 📤 Upload media with progress tracking (matches GroupChatScreen)
  const uploadMediaToFirebase = async (uri: string, fileType: "image" | "video" | "file", fileName: string, mimeType?: string) => {
    if (!currentUser) return;

  setIsUploadingMedia(true);

    let messageDocRef: any = null;
    let lastProgressUpdate = 0;
    
    try {
      // Create message in Firestore immediately with uploading status
      const chatDocRef = doc(db, 'chats', chatId);
      const messagesRef = collection(chatDocRef, 'messages');
      const messageData: any = {
        senderId: currentUser.uid,
        text: null,
        mediaUrl: null,
        mediaType: fileType,
        uploading: true,
        uploadProgress: 0,
        createdAt: serverTimestamp(),
      };
      
      if (fileType === "file") {
        messageData.fileName = fileName;
      }
      
      messageDocRef = await addDoc(messagesRef, messageData);
      
      // Scroll to bottom after a short delay
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 300);

      // Start upload
    const response = await fetch(uri);
    const blob = await response.blob();
      const path = `chat_media/${chatId}/${currentUser.uid}/${Date.now()}_${fileName}`;
    const storageRef = ref(storage, path);
      
      // Determine content type
      let contentType = mimeType || 'application/octet-stream';
      
      if (!mimeType) {
        if (fileType === 'image') {
          const ext = fileName.split('.').pop()?.toLowerCase();
          if (ext === 'png') contentType = 'image/png';
          else if (ext === 'gif') contentType = 'image/gif';
          else if (ext === 'webp') contentType = 'image/webp';
          else contentType = 'image/jpeg';
        } else if (fileType === 'video') {
          const ext = fileName.split('.').pop()?.toLowerCase();
          if (ext === 'mov') contentType = 'video/quicktime';
          else if (ext === 'webm') contentType = 'video/webm';
          else contentType = 'video/mp4';
        } else if (fileType === 'file') {
          const ext = fileName.split('.').pop()?.toLowerCase();
          if (ext === 'pdf') contentType = 'application/pdf';
        }
      }
      
      const uploadTask = uploadBytesResumable(storageRef, blob, {
        contentType: contentType,
      });

      // Track upload progress
      uploadTask.on(
        "state_changed",
        async (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          const progressRounded = Math.round(progress);
          
          // Update UI immediately
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageDocRef.id
                ? { ...msg, uploadProgress: progressRounded }
                : msg
            )
          );
          
          // Throttle Firestore updates
          const shouldUpdateFirestore = 
            progressRounded === 0 ||
            progressRounded === 100 ||
            progressRounded - lastProgressUpdate >= 10 ||
            (progressRounded >= 90 && lastProgressUpdate < 90);
          
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
          
          setMessages((prev) => prev.filter((msg) => msg.id !== messageDocRef.id));
          setIsUploadingMedia(false);
          console.error("Upload error:", error.message || "Failed to upload file.");
        },
        async () => {
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            
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

            // Update chat document (ensure doc exists like activity chats)
            let lastMessagePreviewText = '';
            if (fileType === 'image') lastMessagePreviewText = 'Image 📸';
            else if (fileType === 'video') lastMessagePreviewText = 'Video 🎥';
            else if (fileType === 'file') lastMessagePreviewText = `File 📄: ${fileName}`;

            const chatSnap = await getDoc(chatDocRef);
            if (!chatSnap.exists()) {
              await setDoc(
                chatDocRef,
                {
                  participants: [currentUser.uid, recipientId],
                  lastMessageText: lastMessagePreviewText,
                  lastMessageSenderId: currentUser.uid,
                  lastMessageTimestamp: serverTimestamp(),
                  unreadFor: { [recipientId]: true, [currentUser.uid]: false },
                  unreadCount: { [recipientId]: 1, [currentUser.uid]: 0 },
                  createdAt: serverTimestamp(),
                },
                { merge: true }
              );
            } else {
              await updateDoc(chatDocRef, {
                lastMessageText: lastMessagePreviewText,
                lastMessageSenderId: currentUser.uid,
                lastMessageTimestamp: serverTimestamp(),
                [`unreadFor.${recipientId}`]: true,
                [`unreadFor.${currentUser.uid}`]: false,
                [`unreadCount.${recipientId}`]: increment(1),
                [`unreadCount.${currentUser.uid}`]: 0,
              });
            }
          } catch (error: any) {
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


  // Create Firestore message; update lastMessage + unread flags (ensure chat doc exists like activity chats)
  const sendMessage = async (content: {
    text?: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'video' | 'file';
    fileName?: string;
    fileSize?: number;
  }) => {
    if (!currentUser) {
      Alert.alert('Error', 'You need to be logged in to send messages.');
      return;
    }
    if (!content.text && !content.mediaUrl) return;

    const chatDocRef = doc(db, 'chats', chatId);
    let lastMessagePreviewText = content.text || '';
    if (content.mediaType === 'image') lastMessagePreviewText = 'Image 📸';
    else if (content.mediaType === 'video') lastMessagePreviewText = 'Video 🎥';
    else if (content.mediaType === 'file') lastMessagePreviewText = `File 📄: ${content.fileName}`;

    try {
      const chatSnap = await getDoc(chatDocRef);
      const messageData: Record<string, any> = {
        senderId: currentUser.uid,
        createdAt: serverTimestamp(),
      };
      if (content.text !== undefined) messageData.text = content.text;
      if (content.mediaUrl !== undefined) messageData.mediaUrl = content.mediaUrl;
      if (content.mediaType !== undefined) messageData.mediaType = content.mediaType;
      if (content.fileName !== undefined) messageData.fileName = content.fileName;
      if (content.fileSize !== undefined) messageData.fileSize = content.fileSize;

      await addDoc(collection(chatDocRef, 'messages'), messageData);

      if (!chatSnap.exists()) {
        await setDoc(
          chatDocRef,
          {
            participants: [currentUser.uid, recipientId],
            lastMessageText: lastMessagePreviewText,
            lastMessageSenderId: currentUser.uid,
            lastMessageTimestamp: serverTimestamp(),
            unreadFor: { [recipientId]: true, [currentUser.uid]: false },
            unreadCount: { [recipientId]: 1, [currentUser.uid]: 0 },
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
        await updateDoc(doc(db, 'users', currentUser.uid), { chatIds: arrayUnion(chatId) });
        try {
          await updateDoc(doc(db, 'users', recipientId), { chatIds: arrayUnion(chatId) });
        } catch (_) {}
      } else {
        await updateDoc(chatDocRef, {
          lastMessageText: lastMessagePreviewText,
          lastMessageSenderId: currentUser.uid,
          lastMessageTimestamp: serverTimestamp(),
          [`unreadFor.${recipientId}`]: true,
          [`unreadFor.${currentUser.uid}`]: false,
          [`unreadCount.${recipientId}`]: increment(1),
          [`unreadCount.${currentUser.uid}`]: 0,
        });
      }

      setNewMessage('');
      setShowEmojiPicker(false);
    } catch (error: any) {
      console.error('Error sending message:', error);
      console.error('Could not send message:', error?.message || 'unknown error');
    }
  };

const handlePickMedia = async (mediaType: "image" | "video") => {
  setShowEmojiPicker(false);

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert("Permission Denied", "Please allow access to your media library.");
    return;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaType === "image" ? "images" : "videos",
      allowsEditing: mediaType === "image",
      quality: mediaType === "image" ? 0.8 : 1,
      allowsMultipleSelection: false,
  });

  if (result.canceled || !result.assets?.length) return;

  const asset = result.assets[0];
    const fileName = asset.fileName || asset.uri.split("/").pop() || `${mediaType}_${Date.now()}.${mediaType === "image" ? "jpg" : "mp4"}`;
    const mimeType = asset.mimeType || undefined;

    await uploadMediaToFirebase(asset.uri, mediaType, fileName, mimeType);
};


const handlePickFile = async () => {
    setShowEmojiPicker(false);
    
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



  const handleSendEmoji = (emoji: string) => {
    setNewMessage((prev) => prev + emoji);
  };

  const handleSendText = () => {
    if (newMessage.trim() === '') return;
    sendMessage({ text: newMessage.trim() });
  };

  /** Normalize friends field to map { [uid]: true } for safe writes */
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
  const handleAcceptFriend = async () => {
    if (!currentUser) return;
    try {
      const currentUserRef = doc(db, "users", currentUser.uid);
      const otherUserRef = doc(db, "users", recipientId);
      const [currentSnap, otherSnap] = await Promise.all([getDoc(currentUserRef), getDoc(otherUserRef)]);

      const myFriends = friendsToMap(currentSnap.exists() ? currentSnap.data() : null);
      const theirFriends = friendsToMap(otherSnap.exists() ? otherSnap.data() : null);
      const myNew = { ...myFriends, [recipientId]: true };
      const theirNew = { ...theirFriends, [currentUser.uid]: true };

      const batch = writeBatch(db);
      batch.update(currentUserRef, { friends: myNew });
      batch.update(otherUserRef, { friends: theirNew });
      await batch.commit();

      setIsFriend(true);
      Alert.alert("Success", "Friend request accepted!");
    } catch (error: any) {
      console.error("Error accepting friend:", error);
      console.error("Accept friend request failed:", error.message || error.code);
    }
  };

  /** 🚫 Ignore friend request (mute notifications from this user) */
  const handleIgnoreFriendRequest = async () => {
    if (!currentUser) return;
    try {
      const currentUserRef = doc(db, "users", currentUser.uid);
      const currentUserSnap = await getDoc(currentUserRef);
      const ignoredUsers: string[] = currentUserSnap.exists() 
        ? (currentUserSnap.data().ignoredUsers || []) 
        : [];
      
      if (!ignoredUsers.includes(recipientId)) {
        await updateDoc(currentUserRef, {
          ignoredUsers: [...ignoredUsers, recipientId],
        });
      }

      Alert.alert("Ignored", "You won't receive push notifications from this user, but you can still see their messages.");
    } catch (error: any) {
      console.error("Error ignoring friend request:", error);
      console.error("Could not ignore friend request:", error);
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
    if (!currentUser) return;
    
    try {
      const messageRef = doc(db, 'chats', chatId, 'messages', messageId);
      const messageSnap = await getDoc(messageRef);
      
      if (!messageSnap.exists()) {
        console.error("Message not found");
        setShowMessageOptions(false);
        setSelectedMessage(null);
        return;
      }
      
      const messageData = messageSnap.data();
      if (messageData.senderId !== currentUser.uid) {
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

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

    const mediaMessages = messages.filter(
      (msg) => msg.mediaUrl && (msg.mediaType === "image" || msg.mediaType === "video")
    );
    const clickedMessage = messages[messageIndex];
    const startIndex = mediaMessages.findIndex((msg) => msg.id === clickedMessage.id);

    setMediaItems(items);
    setCurrentMediaIndex(startIndex >= 0 ? startIndex : 0);
    setMediaViewerVisible(true);
  };

  const getCurrentMedia = () => {
    return mediaItems[currentMediaIndex];
  };

  const goToPreviousMedia = () => {
    if (currentMediaIndex > 0) {
      if (videoRef.current && getCurrentMedia()?.type === "video") {
        videoRef.current.pauseAsync();
      }
      setCurrentMediaIndex(currentMediaIndex - 1);
    }
  };

  const goToNextMedia = () => {
    if (currentMediaIndex < mediaItems.length - 1) {
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
          if (mediaItems.length <= 1) return false;
          return Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        },
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (mediaItems.length <= 1) return false;
          return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 15;
        },
        onPanResponderGrant: () => {
          swipeX.setValue(0);
          swipeOpacity.setValue(1);
        },
        onPanResponderMove: (_, gestureState) => {
          swipeX.setValue(gestureState.dx);
          const opacity = 1 - Math.abs(gestureState.dx) / 300;
          swipeOpacity.setValue(Math.max(0.3, opacity));
        },
        onPanResponderRelease: (_, gestureState) => {
          const swipeThreshold = 50;
          const swipeVelocity = gestureState.vx;

          if (Math.abs(gestureState.dx) > swipeThreshold || Math.abs(swipeVelocity) > 0.5) {
            if (gestureState.dx > 0 || swipeVelocity > 0) {
              goToPreviousMedia();
            } else {
              goToNextMedia();
            }
          }

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
      const timer = setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.playAsync().catch((error) => {
            console.error("Error playing video:", error);
          });
        }
      }, 200);
      return () => {
        clearTimeout(timer);
        if (videoRef.current) {
          videoRef.current.pauseAsync().catch(() => {});
        }
      };
    }
  }, [currentMediaIndex, mediaViewerVisible, mediaItems]);

  // Cleanup video when modal closes
  useEffect(() => {
    if (!mediaViewerVisible && videoRef.current) {
      videoRef.current.pauseAsync().catch(() => {});
    }
  }, [mediaViewerVisible]);

  const handleDownloadMedia = async () => {
    const media = mediaItems[currentMediaIndex];
    if (!media) return;
    const MediaLibrary = getMediaLibrary();
    if (!MediaLibrary) {
      Alert.alert("Error", "Media library is not available. Please rebuild the app with: npx expo run:android or npx expo run:ios");
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

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isCurrentUser = item.senderId === currentUser?.uid;
    const messageIndex = messages.findIndex((msg) => msg.id === item.id);
    
    // Check if this is a friend request message
    // Show buttons on any message from recipient that looks like a friend request when not a friend
    const friendRequestTexts = [
      "Hi! I'd like to add you as a friend.",
      "Hi! I'd like to add you as a friend",
      "I'd like to add you as a friend.",
      "I'd like to add you as a friend",
    ];
    
    const isFriendRequestMessage = item.text ? friendRequestTexts.some(text => 
      item.text!.trim().toLowerCase() === text.trim().toLowerCase()
    ) : false;
    
    // Show buttons if:
    // 1. Message is from recipient (not current user)
    // 2. They're not friends yet
    // 3. Message text matches friend request pattern
    // 4. This is the most recent friend request message from recipient (to avoid showing on old ones)
    const isFriendRequest = !isCurrentUser && 
      !isFriend && 
      isFriendRequestMessage &&
      // Only show on the most recent friend request message from recipient
      messages
        .filter(msg => 
          msg.senderId === recipientId && 
          msg.text && 
          friendRequestTexts.some(text => msg.text!.trim().toLowerCase() === text.trim().toLowerCase())
        )
        .sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime; // Most recent first
        })[0]?.id === item.id;

    return (
      <TouchableOpacity
        activeOpacity={1}
        onLongPress={() => handleMessageLongPress(item)}
        style={[
          styles.messageBubble,
          isCurrentUser ? styles.myMessageBubble : styles.otherMessageBubble,
        ]}
      >
        {/* Uploading State */}
        {item.uploading ? (
          <View style={{
            padding: SPACING.medium,
            backgroundColor: colors.primaryLight || colors.cardBackground,
            borderRadius: 8,
            minWidth: 200,
          }}>
            {item.mediaType === "file" ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.small }}>
                  <Ionicons name="document-outline" size={24} color={colors.primary} />
                  <Text
                    style={[
                      styles.myMessageText || styles.otherMessageText,
                      { marginLeft: SPACING.small, flex: 1 },
                    ]}
                    numberOfLines={1}
                  >
                    {item.fileName || "File"}
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
                    width: `${item.uploadProgress || 0}%`,
                    backgroundColor: colors.primary,
                  }} />
                </View>
                <Text style={[styles.timestampText, { marginTop: SPACING.xsmall, fontSize: FONT_SIZES.xsmall }]}>
                  Uploading {item.uploadProgress || 0}%
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
                <View style={{
                  height: 4,
                  backgroundColor: colors.border || '#E0E0E0',
                  borderRadius: 2,
                  overflow: 'hidden',
                  marginTop: SPACING.xsmall,
                }}>
                  <View style={{
                    height: '100%',
                    width: `${item.uploadProgress || 0}%`,
                    backgroundColor: colors.primary,
                  }} />
                </View>
                <Text style={[styles.timestampText, { marginTop: SPACING.xsmall, fontSize: FONT_SIZES.xsmall }]}>
                  Uploading {item.uploadProgress || 0}%
                </Text>
              </>
            )}
          </View>
        ) : item.mediaUrl && item.mediaType === "image" ? (
          <TouchableOpacity onPress={() => openUnifiedMediaViewer(messageIndex)}>
          <Image source={{ uri: item.mediaUrl }} style={styles.mediaMessageImage} />
          </TouchableOpacity>
        ) : item.mediaUrl && item.mediaType === "video" ? (
          <TouchableOpacity onPress={() => openUnifiedMediaViewer(messageIndex)} activeOpacity={0.9}>
            <View style={{ position: "relative" }}>
              <Video
                source={{ uri: item.mediaUrl }}
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
        ) : item.mediaUrl && item.mediaType === "file" ? (
          <TouchableOpacity
            onPress={() => Linking.openURL(item.mediaUrl!)}
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
                isCurrentUser ? styles.myMessageText : styles.otherMessageText,
                { marginLeft: SPACING.small, flex: 1 },
              ]}
              numberOfLines={1}
            >
              {item.fileName || "File"}
              </Text>
            <Ionicons name="download-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        ) : null}

        {item.text ? (
          <Text style={isCurrentUser ? styles.myMessageText : styles.otherMessageText}>
            {item.text}
          </Text>
        ) : null}

        {/* Accept and Ignore buttons for friend request messages */}
        {isFriendRequest && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignSelf: 'flex-start' }}>
            <TouchableOpacity
              onPress={handleAcceptFriend}
              style={{
                backgroundColor: colors.primary,
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: colors.buttonText || '#fff', fontWeight: '600', fontSize: 14 }}>
                Accept
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleIgnoreFriendRequest}
              style={{
                backgroundColor: colors.secondaryText || '#666',
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: colors.buttonText || '#fff', fontWeight: '600', fontSize: 14 }}>
                Ignore
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.timestampText}>
          {item.createdAt?.toDate
            ? item.createdAt.toDate().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            : ''}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textPrimary }}>Loading messages...</Text>
      </View>
    );
  }

  if (!currentUser) {
    return (
      <View style={globalStyles.centeredContainer}>
        <Text style={globalStyles.errorText}>You must be logged in to view this chat.</Text>
        <TouchableOpacity onPress={() => navigation.navigate('AuthScreen')}>
          <Text style={globalStyles.loginPromptText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={KAV_OFFSET}
    >
      <View style={styles.headerContainer}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={globalStyles.backButton || globalStyles.primaryButton}
        >
          <Ionicons name="arrow-back" size={FONT_SIZES.xxlarge} color={colors.textPrimary} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.navigate('UserProfileScreen', { userId: recipientId })}
          style={[styles.profileButton, { flex: 1 }]}
        >
          <Image
            source={recipientProfilePic ? { uri: recipientProfilePic } : AVATAR_PLACEHOLDER}
            style={styles.recipientProfilePic}
          />
          <Text style={styles.headerTitle}>{recipientUsername}</Text>
        </TouchableOpacity>

        {!isFriend && (
          <View style={{ marginLeft: 'auto', position: 'relative' }}>
            <TouchableOpacity
              onPress={() => {
                if (newMessage.trim()) {
                  handleSendText();
                } else {
                  // Send a default friend request message
                  sendMessage({ text: 'Hi! I\'d like to add you as a friend.' });
                }
                setShowFriendRequestHint(false);
              }}
              onLongPress={() => setShowFriendRequestHint(true)}
              style={{
                padding: 8,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Ionicons
                name="person-add-outline"
                size={FONT_SIZES.xxlarge}
                color={colors.primary}
              />
            </TouchableOpacity>
            
            {showFriendRequestHint && (
              <Pressable
                onPress={() => setShowFriendRequestHint(false)}
                style={{
                  position: 'absolute',
                  top: 45,
                  right: 0,
                  backgroundColor: colors.background || '#1a1a2e',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.borderColor || colors.primary,
                  zIndex: 1000,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.25,
                  shadowRadius: 3.84,
                  elevation: 5,
                  minWidth: 140,
                }}
              >
                <Text style={{ color: colors.text || '#fff', fontSize: 12, fontWeight: '500', textAlign: 'center' }}>
                  Send friend request
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => renderMessage({ item, index })}
        inverted={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.messagesList,
          { paddingBottom: inputBarHeight + extraPanelHeight + insets.bottom + 12 },
        ]}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Emoji Picker */}
      {showEmojiPicker && (
        <View style={styles.emojiPickerContainer}>
          {fetchingEmojis ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <FlatList
              data={emojis.length > 0 ? emojis : FALLBACK_EMOJIS}
              keyExtractor={(item) => item}
              numColumns={8}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.emojiItem} onPress={() => handleSendEmoji(item)}>
                  <Text style={styles.emojiText}>{item}</Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.emojiListContent}
            />
          )}
        </View>
      )}

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
              style={[styles.textInput, { maxHeight: 120, textAlignVertical: 'top' }]}
              value={newMessage}
              onChangeText={setNewMessage}
              placeholder="Type your message..."
              placeholderTextColor={colors.placeholderText}
              multiline
              {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
            />
            <TouchableOpacity
              style={styles.sendButton}
              onPress={handleSendText}
              disabled={newMessage.trim() === ''}
            >
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
      </View>

      {/* 🧩 Unified Image + Video Viewer */}
      {mediaViewerVisible && (
        <Modal
          visible={mediaViewerVisible}
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
            {/* Close button */}
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

            {/* Media content with swipe gesture */}
            <Animated.View
              style={{
                flex: 1,
                width: "100%",
                transform: [{ translateX: swipeX }],
                opacity: swipeOpacity,
              }}
              {...panResponder.panHandlers}
            >
              {getCurrentMedia()?.type === "video" ? (
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
              ) : (
                <>
                  <ImageViewing
                    images={mediaItems.filter((m) => m.type === "image").map((m) => ({ uri: m.uri }))}
                    imageIndex={
                      mediaItems
                        .slice(0, currentMediaIndex + 1)
                        .filter((m) => m.type === "image").length - 1
                    }
                    visible={mediaViewerVisible}
                    onRequestClose={() => setMediaViewerVisible(false)}
                    swipeToCloseEnabled={false}
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
                        const actualIndex = mediaItems.findIndex(
                          (m) => m.uri === imageItems[index].uri
                        );
                        setCurrentMediaIndex(actualIndex);
                      }
                    }}
                  />
                  {/* Navigation buttons for images */}
                  {mediaItems.length > 1 && (
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
                        style={{
                          padding: 10,
                          opacity: currentMediaIndex === 0 ? 0.3 : 1,
                        }}
                      >
                        <Ionicons
                          name="chevron-back"
                          size={30}
                          color={currentMediaIndex === 0 ? "#999" : "white"}
                        />
                      </TouchableOpacity>
                      <Text style={{ color: "white", fontSize: 16 }}>
                        {currentMediaIndex + 1} / {mediaItems.length}
                      </Text>
                      <TouchableOpacity
                        onPress={goToNextMedia}
                        disabled={currentMediaIndex === mediaItems.length - 1}
                        style={{
                          padding: 10,
                          opacity: currentMediaIndex === mediaItems.length - 1 ? 0.3 : 1,
                        }}
                      >
                        <Ionicons
                          name="chevron-forward"
                          size={30}
                          color={currentMediaIndex === mediaItems.length - 1 ? "#999" : "white"}
                        />
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </Animated.View>

            {/* Navigation and controls for videos */}
            {getCurrentMedia()?.type === "video" && (
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
                  style={{
                    padding: 10,
                    opacity: currentMediaIndex === 0 ? 0.3 : 1,
                  }}
                >
                  <Ionicons
                    name="chevron-back"
                    size={30}
                    color={currentMediaIndex === 0 ? "#999" : "white"}
                  />
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
                  <Ionicons
                    name="chevron-forward"
                    size={30}
                    color={currentMediaIndex === mediaItems.length - 1 ? "#999" : "white"}
                  />
                </TouchableOpacity>
              </View>
            )}
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
                {selectedMessage.senderId === currentUser?.uid && (
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
                handlePickFile();
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
    </KeyboardAvoidingView>
  );
};

export default ChatRoomScreen;
