// ActivityChatScreen – matches ChatRoomScreen: layout, attach button, media upload, unread tracking
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
  StyleSheet,
  Modal,
  Pressable,
  Linking,
} from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, Message } from '../../types';
import { db, auth } from '../../firebaseConfig';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { Video, ResizeMode } from 'expo-av';
import ImageViewing from 'react-native-image-viewing';
import { useTheme } from '../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import createStyles, { FONT_SIZES, SPACING } from '../context/appStyles';

type ActivityChatScreenRouteProp = RouteProp<RootStackParamList, 'ActivityChatScreen'>;
type ActivityChatScreenNavigationProp = StackNavigationProp<RootStackParamList, 'ActivityChatScreen'>;

const AVATAR_PLACEHOLDER = require('../../assets/avatar-placeholder.png');
type PinnedMessage = { messageId: string; text: string; senderId?: string; pinnedBy?: string; pinnedAt?: any };
const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const cleanTrailingPunctuation = (value: string) => value.replace(/[),.!?;:]+$/g, '');
const normalizeUrl = (value: string) => {
  const cleaned = cleanTrailingPunctuation(value.trim());
  if (!cleaned) return '';
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
  return parts.length > 0 ? parts : [{ text, isLink: false }];
};

const getFileTypeFromExtension = (fileName: string): 'image' | 'video' | 'file' => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
  const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'];
  if (imageExtensions.includes(ext)) return 'image';
  if (videoExtensions.includes(ext)) return 'video';
  return 'file';
};

export default function ActivityChatScreen() {
  const route = useRoute<ActivityChatScreenRouteProp>();
  const navigation = useNavigation<ActivityChatScreenNavigationProp>();
  const { activityId, activityTitle } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const KAV_OFFSET = 0; // so input sits just above keyboard

  const styles = createStyles(colors).chatRoomScreen;
  const globalStyles = createStyles(colors).global;
  const storage = getStorage();

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [canAccess, setCanAccess] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, { profilePic?: string; username: string }>>({});
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [showAttachmentOptions, setShowAttachmentOptions] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showMessageOptions, setShowMessageOptions] = useState(false);
  const [pinnedMessage, setPinnedMessage] = useState<PinnedMessage | null>(null);
  const [inputBarHeight, setInputBarHeight] = useState(56);
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  const [mediaItems, setMediaItems] = useState<{ uri: string; type: 'image' | 'video' }[]>([]);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [openingFile, setOpeningFile] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const videoViewerRef = useRef<Video>(null);
  const currentUserId = auth.currentUser?.uid;
  const MAX_AVATAR_CLUSTER = 5;

  const chatRef = doc(db, 'activityChats', activityId);
  const messagesRef = collection(db, 'activityChats', activityId, 'messages');

  const fetchUserProfiles = useCallback(async (userIds: string[]) => {
    const uniq = Array.from(new Set(userIds.filter(Boolean)));
    const map: Record<string, { profilePic?: string; username: string }> = {};
    await Promise.all(
      uniq.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            const d = snap.data();
            map[uid] = { username: d.username || d.displayName || 'User', profilePic: d.profilePic };
          } else {
            map[uid] = { username: 'User' };
          }
        } catch {
          map[uid] = { username: 'User' };
        }
      })
    );
    setUserProfiles((prev) => ({ ...prev, ...map }));
  }, []);

  // Load activity, check access, set participants, clear unread for current user
  useEffect(() => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const activitySnap = await getDoc(doc(db, 'activities', activityId));
        if (!activitySnap.exists()) {
          Alert.alert('Error', 'Activity not found.');
          navigation.goBack();
          return;
        }
        const participantIds: string[] = activitySnap.data()?.participants || [];
        if (!participantIds.includes(currentUserId)) {
          Alert.alert('Access denied', 'You are not a participant of this activity.');
          navigation.goBack();
          return;
        }
        setParticipants(participantIds);
        setCanAccess(true);

        // Ensure activityChats doc exists (e.g. activity created before we added setDoc, or joined via old path)
        const chatSnap = await getDoc(chatRef);
        const activityData = activitySnap.data();
        const title = activityData?.title ?? activityTitle;
        if (!chatSnap.exists()) {
          await setDoc(chatRef, {
            activityId,
            activityTitle: title,
            participants: participantIds,
            createdAt: serverTimestamp(),
            unreadCount: { [currentUserId]: 0 },
          });
        } else {
          await updateDoc(chatRef, {
            participants: participantIds,
            [`unreadCount.${currentUserId}`]: 0,
          }).catch(() => {});
        }
      } catch (e) {
        console.error('Could not load activity', e);
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [activityId, currentUserId, navigation]);

  // Messages listener
  useEffect(() => {
    if (!canAccess) return;
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Message[];
      setMessages(list);
      const senders = Array.from(new Set(list.map((m) => m.senderId).filter(Boolean)));
      if (senders.length) fetchUserProfiles(senders);
    });
    return () => unsub();
  }, [canAccess, activityId, fetchUserProfiles]);

  useEffect(() => {
    if (!canAccess) return;
    const unsub = onSnapshot(chatRef, (snap) => {
      if (snap.exists()) {
        setPinnedMessage((snap.data()?.pinnedMessage as PinnedMessage) || null);
      }
    });
    return () => unsub();
  }, [canAccess, activityId]);

  useEffect(() => {
    if (participants.length > 0) fetchUserProfiles(participants);
  }, [participants, fetchUserProfiles]);

  useEffect(() => {
    if (!loading) flatListRef.current?.scrollToEnd({ animated: true });
  }, [messages, loading]);

  const formatTime = (timestamp: any) => {
    if (!timestamp) return '';
    try {
      const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const updateChatMeta = useCallback(
    async (lastMessageText: string) => {
      const others = participants.filter((p) => p !== currentUserId);
      const updates: Record<string, any> = {
        lastMessageText,
        lastMessageSenderId: currentUserId,
        lastMessageTimestamp: serverTimestamp(),
        participants,
        [`unreadCount.${currentUserId}`]: 0,
      };
      others.forEach((uid) => {
        updates[`unreadCount.${uid}`] = increment(1);
      });
      try {
        await updateDoc(chatRef, updates);
      } catch (e: any) {
        if (e?.message?.includes('No document to update')) {
          const initialUnread: Record<string, number> = {};
          if (currentUserId) initialUnread[currentUserId] = 0;
          others.forEach((uid) => { initialUnread[uid] = (initialUnread[uid] ?? 0) + 1; });
          await setDoc(chatRef, {
            activityId,
            activityTitle,
            participants,
            lastMessageText,
            lastMessageSenderId: currentUserId,
            lastMessageTimestamp: serverTimestamp(),
            unreadCount: initialUnread,
            createdAt: serverTimestamp(),
          }, { merge: true });
        } else {
          throw e;
        }
      }
    },
    [participants, currentUserId, activityId, activityTitle]
  );

  const uploadMediaToFirebase = useCallback(
    async (uri: string, fileType: 'image' | 'video' | 'file', fileName: string, mimeType?: string) => {
      if (!currentUserId) return;
      setIsUploadingMedia(true);
      let messageDocRef: any = null;
      try {
        const messageData: Record<string, any> = {
          senderId: currentUserId,
          text: null,
          mediaUrl: null,
          mediaType: fileType,
          uploading: true,
          uploadProgress: 0,
          timestamp: serverTimestamp(),
        };
        if (fileType === 'file') messageData.fileName = fileName;
        messageDocRef = await addDoc(messagesRef, messageData);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 300);

        const response = await fetch(uri);
        const blob = await response.blob();
        const path = `activity_chat_media/${activityId}/${currentUserId}/${Date.now()}_${fileName}`;
        const storageRef = ref(storage, path);

        let contentType = mimeType || 'application/octet-stream';
        if (!mimeType && fileType === 'image') contentType = 'image/jpeg';
        else if (!mimeType && fileType === 'video') contentType = 'video/mp4';

        const uploadTask = uploadBytesResumable(storageRef, blob, { contentType });

        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setMessages((prev) =>
              prev.map((msg) => (msg.id === messageDocRef.id ? { ...msg, uploadProgress: progress } : msg))
            );
          },
          async (error) => {
            await updateDoc(messageDocRef, { uploading: false, uploadError: error.message }).catch(() => {});
            setMessages((prev) => prev.filter((m) => m.id !== messageDocRef.id));
            setIsUploadingMedia(false);
            console.error('Upload error', error.message ?? error);
          },
          async () => {
            try {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              await updateDoc(messageDocRef, {
                mediaUrl: downloadURL,
                uploading: false,
                uploadProgress: 100,
              });
              let preview = 'Image 📸';
              if (fileType === 'video') preview = 'Video 🎥';
              else if (fileType === 'file') preview = `File 📄: ${fileName}`;
              await updateChatMeta(preview);
            } catch (e: any) {
              await updateDoc(messageDocRef, { uploading: false, uploadError: e.message }).catch(() => {});
              setMessages((prev) => prev.filter((m) => m.id !== messageDocRef.id));
              console.error('Upload error (get URL)', e.message ?? e);
            }
            setIsUploadingMedia(false);
          }
        );
      } catch (e: any) {
        setIsUploadingMedia(false);
        console.error('Upload error (start)', e.message ?? e);
      }
    },
    [activityId, currentUserId, updateChatMeta]
  );

  const sendMessage = useCallback(
    async (content: { text?: string; mediaUrl?: string; mediaType?: 'image' | 'video' | 'file'; fileName?: string }) => {
      if (!currentUserId) return;
      if (!content.text && !content.mediaUrl) return;
      try {
        const messageData: Record<string, any> = {
          senderId: currentUserId,
          timestamp: serverTimestamp(),
        };
        if (content.text !== undefined) messageData.text = content.text;
        if (content.mediaUrl !== undefined) messageData.mediaUrl = content.mediaUrl;
        if (content.mediaType !== undefined) messageData.mediaType = content.mediaType;
        if (content.fileName !== undefined) messageData.fileName = content.fileName;

        await addDoc(messagesRef, messageData);
        const preview = content.text || 'Image 📸';
        await updateChatMeta(preview);
        setNewMessage('');
      } catch (e: any) {
        console.error('Failed to send', e.message ?? e);
      }
    },
    [currentUserId, updateChatMeta]
  );

  const handleAttachmentPress = () => setShowAttachmentOptions(true);

  const handlePickMedia = async (mediaType: 'image' | 'video') => {
    setShowAttachmentOptions(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Denied', 'Please allow access to your media library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaType === 'image' ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: mediaType === 'image',
      quality: mediaType === 'image' ? 0.8 : 1,
      allowsMultipleSelection: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const fileName = asset.fileName || asset.uri.split('/').pop() || `${mediaType}_${Date.now()}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
    await uploadMediaToFirebase(asset.uri, mediaType, fileName, asset.mimeType || undefined);
  };

  const handlePickFile = async () => {
    setShowAttachmentOptions(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      const fileName = file.name || file.uri.split('/').pop() || 'file';
      const fileType = getFileTypeFromExtension(fileName);
      await uploadMediaToFirebase(file.uri, fileType, fileName);
    } catch (e: any) {
      console.error('Failed to pick file', e.message ?? e);
    }
  };

  const handleSendText = () => {
    if (newMessage.trim() === '') return;
    sendMessage({ text: newMessage.trim() });
  };

  const openMessageLink = async (rawUrl: string) => {
    const url = normalizeUrl(rawUrl);
    if (!url) return;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert('Invalid link', 'This link cannot be opened.');
        return;
      }
      await Linking.openURL(url);
    } catch (error) {
      console.error('Failed to open link:', error);
      Alert.alert('Error', 'Could not open this link.');
    }
  };

  const copyMessage = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert('Copied', 'Message copied to clipboard');
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!currentUserId) return;
    try {
      const messageRef = doc(db, 'activityChats', activityId, 'messages', messageId);
      const messageSnap = await getDoc(messageRef);
      if (!messageSnap.exists()) return;
      if (messageSnap.data().senderId !== currentUserId) {
        Alert.alert('Permission denied', 'You can only delete your own messages.');
        return;
      }
      await deleteDoc(messageRef);
    } catch (error) {
      console.error('Failed to delete message:', error);
      Alert.alert('Error', 'Could not delete this message.');
    } finally {
      setShowMessageOptions(false);
      setSelectedMessage(null);
    }
  };

  const getPinPreview = (msg: Message) => {
    if (msg.text && msg.text.trim()) return msg.text.trim().slice(0, 160);
    if (msg.mediaType === 'image') return 'Image';
    if (msg.mediaType === 'video') return 'Video';
    if (msg.mediaType === 'file') return msg.fileName ? `File: ${msg.fileName}` : 'File';
    return 'Pinned message';
  };

  const togglePinSelectedMessage = async () => {
    if (!selectedMessage || !currentUserId) return;
    try {
      if (pinnedMessage?.messageId === selectedMessage.id) {
        await updateDoc(chatRef, { pinnedMessage: null });
      } else {
        await updateDoc(chatRef, {
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
      console.error('Failed to pin message:', error);
      Alert.alert('Error', 'Could not update pinned message.');
    } finally {
      setShowMessageOptions(false);
      setSelectedMessage(null);
    }
  };

  const openUnifiedMediaViewer = (messageIndex: number) => {
    const items = messages
      .filter((msg) => msg.mediaUrl && (msg.mediaType === 'image' || msg.mediaType === 'video'))
      .map((msg) => ({ uri: msg.mediaUrl!, type: msg.mediaType as 'image' | 'video' }));
    const mediaMessages = messages.filter(
      (msg) => msg.mediaUrl && (msg.mediaType === 'image' || msg.mediaType === 'video')
    );
    const clickedMessage = messages[messageIndex];
    const startIndex = mediaMessages.findIndex((msg) => msg.id === clickedMessage.id);
    setMediaItems(items);
    setCurrentMediaIndex(startIndex >= 0 ? startIndex : 0);
    setMediaViewerVisible(true);
  };

  const handleOpenFile = async (url: string, fileName: string | undefined) => {
    try {
      setOpeningFile(true);
      const name = fileName || url.split('/').pop() || `file_${Date.now()}`;
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const localUri = `${FileSystem.cacheDirectory}${safeName}`;
      await FileSystem.downloadAsync(url, localUri);
      const canOpen = await Linking.canOpenURL(localUri);
      if (canOpen) {
        await Linking.openURL(localUri);
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      try {
        await Linking.openURL(url);
      } catch {
        console.error('Could not open file', e?.message ?? e);
      }
    } finally {
      setOpeningFile(false);
    }
  };

  const getCurrentMedia = () => mediaItems[currentMediaIndex];
  const goToPrevMedia = () => {
    if (currentMediaIndex > 0) {
      videoViewerRef.current?.pauseAsync?.();
      setCurrentMediaIndex((i) => i - 1);
    }
  };
  const goToNextMedia = () => {
    if (currentMediaIndex < mediaItems.length - 1) {
      videoViewerRef.current?.pauseAsync?.();
      setCurrentMediaIndex((i) => i + 1);
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isCurrentUser = item.senderId === currentUserId;
    const profile = userProfiles[item.senderId] || { username: 'User' };

    return (
      <TouchableOpacity
        activeOpacity={1}
        onLongPress={() => {
          setSelectedMessage(item);
          setShowMessageOptions(true);
        }}
        style={[
          styles.messageBubble,
          isCurrentUser ? styles.myMessageBubble : styles.otherMessageBubble,
        ]}
      >
        {item.uploading ? (
          <View style={{ padding: SPACING.medium, backgroundColor: colors.primaryLight || colors.cardBackground, borderRadius: 8, minWidth: 200 }}>
            {(item.mediaType === 'file' && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.small }}>
                  <Ionicons name="document-outline" size={24} color={colors.primary} />
                  <Text style={[styles.otherMessageText, { marginLeft: SPACING.small, flex: 1 }]} numberOfLines={1}>
                    {item.fileName || 'File'}
                  </Text>
                </View>
                <View style={{ height: 4, backgroundColor: colors.border || '#E0E0E0', borderRadius: 2, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${item.uploadProgress || 0}%`, backgroundColor: colors.primary }} />
                </View>
                <Text style={[styles.timestampText, { marginTop: 4, fontSize: FONT_SIZES.xsmall }]}>
                  Uploading {item.uploadProgress || 0}%
                </Text>
              </>
            )) || (
              <>
                <View style={{ width: 200, height: 150, backgroundColor: colors.border || '#E0E0E0', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginBottom: SPACING.small }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
                <Text style={[styles.timestampText, { marginTop: 4, fontSize: FONT_SIZES.xsmall }]}>
                  Uploading media...
                </Text>
              </>
            )}
          </View>
        ) : item.mediaUrl && item.mediaType === 'image' ? (
          <TouchableOpacity onPress={() => openUnifiedMediaViewer(index)} activeOpacity={0.9}>
            <Image source={{ uri: item.mediaUrl }} style={styles.mediaMessageImage} resizeMode="cover" />
          </TouchableOpacity>
        ) : item.mediaUrl && item.mediaType === 'video' ? (
          <TouchableOpacity onPress={() => openUnifiedMediaViewer(index)} activeOpacity={0.9}>
            <View style={{ position: 'relative' }}>
              <Video
                source={{ uri: item.mediaUrl }}
                style={styles.mediaMessageImage}
                resizeMode={ResizeMode.COVER}
                shouldPlay={false}
                isMuted
                useNativeControls={false}
              />
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="play-circle" size={50} color="#fff" />
              </View>
            </View>
          </TouchableOpacity>
        ) : item.mediaUrl && item.mediaType === 'file' ? (
          <TouchableOpacity
            onPress={() => handleOpenFile(item.mediaUrl!, item.fileName)}
            disabled={openingFile}
            style={{ flexDirection: 'row', alignItems: 'center', padding: SPACING.small, backgroundColor: colors.primaryLight || colors.cardBackground, borderRadius: 8 }}
          >
            {openingFile ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: SPACING.small }} />
            ) : (
              <Ionicons name="document-outline" size={24} color={colors.primary} />
            )}
            <Text style={[isCurrentUser ? styles.myMessageText : styles.otherMessageText, { marginLeft: SPACING.small, flex: 1 }]} numberOfLines={1}>
              {item.fileName || 'File'}
            </Text>
            <Ionicons name="download-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        ) : null}

        {item.text ? (
          <Text style={isCurrentUser ? styles.myMessageText : styles.otherMessageText}>
            {splitMessageByUrls(item.text).map((part, idx) =>
              part.isLink ? (
                <Text
                  key={`link_${item.id}_${idx}`}
                  style={{
                    textDecorationLine: 'underline',
                    color: isCurrentUser ? '#D7EEFF' : colors.primary,
                  }}
                  onPress={() => openMessageLink(part.text)}
                >
                  {part.text}
                </Text>
              ) : (
                <Text key={`txt_${item.id}_${idx}`}>{part.text}</Text>
              )
            )}
          </Text>
        ) : null}

        {!item.uploading && (
          <Text style={styles.timestampText}>
            {formatTime(item.timestamp)}
            {!isCurrentUser && profile.username ? ` · ${profile.username}` : ''}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={globalStyles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.text }}>Loading...</Text>
      </View>
    );
  }
  if (!canAccess) return null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={KAV_OFFSET}
    >
      <View style={[localStyles.header, { backgroundColor: colors.background, borderBottomColor: colors.borderColor, paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={localStyles.headerBack}>
          <Ionicons name="arrow-back" size={FONT_SIZES.xxlarge} color={colors.text} />
        </TouchableOpacity>
        <Text style={[localStyles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {activityTitle}
        </Text>
        {participants.length > 0 && (
          <TouchableOpacity
            style={localStyles.avatarCluster}
            onPress={() => navigation.navigate('ActivityDetailScreen', { activityId })}
            activeOpacity={0.8}
          >
            {participants.slice(0, MAX_AVATAR_CLUSTER).map((uid, index) => {
              const profile = userProfiles[uid] || { username: 'User' };
              const initials = (profile.username || '?').split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase() || '?';
              return (
                <View key={uid} style={[localStyles.avatarClusterItem, { marginLeft: index === 0 ? 0 : -10, borderColor: colors.background }]}>
                  {profile.profilePic ? (
                    <Image source={{ uri: profile.profilePic }} style={localStyles.avatarClusterPic} />
                  ) : (
                    <View style={[localStyles.avatarClusterPic, localStyles.avatarClusterFallback]}>
                      <Text style={localStyles.avatarClusterFallbackText}>{initials}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </TouchableOpacity>
        )}
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
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Ionicons name="pin" size={14} color={colors.primary} style={{ marginRight: 8 }} />
          <Text style={{ color: colors.textSecondary, flex: 1 }} numberOfLines={1}>
            {pinnedMessage.text}
          </Text>
        </View>
      ) : null}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.messagesList, { paddingBottom: inputBarHeight + insets.bottom + 12 }]}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <View
        style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 25) }]}
        onLayout={(e) => setInputBarHeight(e.nativeEvent.layout.height)}
      >
        <TouchableOpacity onPress={handleAttachmentPress} style={styles.attachmentButton} disabled={isUploadingMedia}>
          <Ionicons name="attach-outline" size={FONT_SIZES.xxlarge} color={colors.primary} />
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
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
          onPress={() => {
            setShowMessageOptions(false);
            setSelectedMessage(null);
          }}
        >
          <Pressable
            style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom + 20, paddingTop: 20 }}
            onPress={(e) => e.stopPropagation()}
          >
            {selectedMessage && (
              <>
                {selectedMessage.text && selectedMessage.text.trim().length > 0 && (
                  <TouchableOpacity
                    style={{ paddingVertical: 16, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.border }}
                    onPress={async () => {
                      await copyMessage(selectedMessage.text || '');
                      setShowMessageOptions(false);
                      setSelectedMessage(null);
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 16 }}>Copy</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={{ paddingVertical: 16, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.border }}
                  onPress={togglePinSelectedMessage}
                >
                  <Text style={{ color: colors.text, fontSize: 16 }}>
                    {pinnedMessage?.messageId === selectedMessage.id ? 'Unpin' : 'Pin'}
                  </Text>
                </TouchableOpacity>
                {selectedMessage.senderId === currentUserId && (
                  <TouchableOpacity
                    style={{ paddingVertical: 16, paddingHorizontal: 20 }}
                    onPress={() => deleteMessage(selectedMessage.id)}
                  >
                    <Text style={{ color: '#FF3B30', fontSize: 16, fontWeight: '600' }}>Delete</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            <TouchableOpacity
              style={{ paddingVertical: 16, paddingHorizontal: 20, marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}
              onPress={() => {
                setShowMessageOptions(false);
                setSelectedMessage(null);
              }}
            >
              <Text style={{ color: colors.text, fontSize: 16, textAlign: 'center' }}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showAttachmentOptions} transparent animationType="fade" onRequestClose={() => setShowAttachmentOptions(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setShowAttachmentOptions(false)}>
          <Pressable
            style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom + 20, paddingTop: 20 }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', paddingHorizontal: 20, paddingBottom: 16 }}>Choose Attachment</Text>
            <TouchableOpacity style={[localStyles.modalOption, { borderBottomColor: colors.borderColor }]} onPress={() => { setShowAttachmentOptions(false); handlePickMedia('image'); }}>
              <Text style={{ color: colors.text, fontSize: 16 }}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[localStyles.modalOption, { borderBottomColor: colors.borderColor }]} onPress={() => { setShowAttachmentOptions(false); handlePickMedia('video'); }}>
              <Text style={{ color: colors.text, fontSize: 16 }}>Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[localStyles.modalOption, { borderBottomColor: colors.borderColor }]} onPress={() => { setShowAttachmentOptions(false); handlePickFile(); }}>
              <Text style={{ color: colors.text, fontSize: 16 }}>Document</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[localStyles.modalOption, { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.borderColor, borderBottomWidth: 0 }]} onPress={() => setShowAttachmentOptions(false)}>
              <Text style={{ color: colors.text, fontSize: 16, textAlign: 'center' }}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {mediaViewerVisible && mediaItems.length > 0 && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMediaViewerVisible(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }}>
            <TouchableOpacity
              onPress={() => setMediaViewerVisible(false)}
              style={{ position: 'absolute', top: insets.top + 10, right: 20, zIndex: 10, padding: 10 }}
            >
              <Ionicons name="close" size={30} color="white" />
            </TouchableOpacity>
            {getCurrentMedia()?.type === 'video' ? (
              <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 60 }}>
                <Video
                  ref={videoViewerRef}
                  source={{ uri: getCurrentMedia()?.uri ?? '' }}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay
                  style={{ width: '100%', height: '100%', minHeight: 200 }}
                  onError={() => Alert.alert('Error', 'Failed to load video')}
                />
                {mediaItems.length > 1 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 }}>
                    <TouchableOpacity onPress={goToPrevMedia} disabled={currentMediaIndex === 0} style={{ opacity: currentMediaIndex === 0 ? 0.4 : 1 }}>
                      <Ionicons name="chevron-back" size={32} color="white" />
                    </TouchableOpacity>
                    <Text style={{ color: 'white', fontSize: 16 }}>{currentMediaIndex + 1} / {mediaItems.length}</Text>
                    <TouchableOpacity onPress={goToNextMedia} disabled={currentMediaIndex === mediaItems.length - 1} style={{ opacity: currentMediaIndex === mediaItems.length - 1 ? 0.4 : 1 }}>
                      <Ionicons name="chevron-forward" size={32} color="white" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <ImageViewing
                images={mediaItems.filter((m) => m.type === 'image').map((m) => ({ uri: m.uri }))}
                imageIndex={
                  mediaItems.slice(0, currentMediaIndex + 1).filter((m) => m.type === 'image').length - 1
                }
                visible={mediaViewerVisible}
                onRequestClose={() => setMediaViewerVisible(false)}
                swipeToCloseEnabled
                onImageIndexChange={(idx) => {
                  const imageItems = mediaItems.filter((m) => m.type === 'image');
                  const item = imageItems[idx];
                  if (item) {
                    const actual = mediaItems.findIndex((m) => m.uri === item.uri);
                    if (actual >= 0) setCurrentMediaIndex(actual);
                  }
                }}
              />
            )}
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const localStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerBack: { padding: 4, marginRight: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', marginRight: 8 },
  avatarCluster: { flexDirection: 'row', alignItems: 'center' },
  avatarClusterItem: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, overflow: 'hidden' },
  avatarClusterPic: { width: '100%', height: '100%', borderRadius: 14 },
  avatarClusterFallback: { backgroundColor: '#94a3b8', justifyContent: 'center', alignItems: 'center' },
  avatarClusterFallbackText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  modalOption: { paddingVertical: 16, paddingHorizontal: 20, borderBottomWidth: 1 },
});
