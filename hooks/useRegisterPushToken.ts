// hooks/useRegisterPushToken.ts
import messaging from '@react-native-firebase/messaging';
import firebase, { getApps } from '@react-native-firebase/app';
import { Platform, Alert, PermissionsAndroid } from 'react-native';
import { doc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth, firebaseConfig } from '../firebaseConfig';

/** Prompts the user if needed, returns FCM token or null */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    // Ensure React Native Firebase native app exists. Only init from JS on Android (web config is valid there).
    // On iOS the native SDK requires GOOGLE_APP_ID from GoogleService-Info.plist — do not pass web appId.
    let apps = getApps();
    if (apps.length === 0) {
      if (Platform.OS === 'android') {
        await firebase.initializeApp(firebaseConfig);
      } else {
        // iOS: no native app usually means GoogleService-Info.plist is missing. Skip push to avoid crash.
        console.warn('⚠️ Firebase native app not found on iOS. Add GoogleService-Info.plist to the iOS project for push notifications.');
        return null;
      }
    }
    // 1) Request permissions
    if (Platform.OS === 'android') {
      // Android 13+ requires runtime permission
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        console.warn('❌ Notification permission not granted on Android');
        Alert.alert(
          'Notifications disabled',
          'Please enable notifications in Settings to receive message alerts.'
        );
        return null;
      }
    } else {
      // iOS - request permission via FCM
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (!enabled) {
        console.warn('❌ Notification permission not granted on iOS');
        Alert.alert(
          'Notifications disabled',
          'Please enable notifications in Settings to receive message alerts.'
        );
        return null;
      }
    }

    // 2) Get FCM token (using new modular API to avoid deprecation warning)
    console.log('📱 Getting FCM token...');
    // Use the messaging instance directly (non-deprecated way)
    // React Native Firebase auto-initializes, but we catch errors just in case
    let messagingInstance;
    try {
      messagingInstance = messaging();
    } catch (error: any) {
      console.error('❌ Failed to get messaging instance:', error.message);
      return null;
    }
    
    const token = await messagingInstance.getToken();
    
    if (token) {
      console.log('✅ FCM token obtained:', token.substring(0, 20) + '...');
    } else {
      console.warn('❌ Failed to get FCM token');
    }
    
    return token;
  } catch (e: any) {
    console.error('❌ registerForPushNotificationsAsync error:', e);
    console.error('Error details:', e.message, e.stack);
    return null;
  }
}

export async function savePushTokenToUser(token: string) {
  const uid = auth.currentUser?.uid;
  if (!uid || !token) {
    console.warn('❌ Cannot save push token: missing uid or token', { uid: !!uid, token: !!token });
    return;
  }
  
  try {
    const ref = doc(db, 'users', uid);
    console.log('💾 Saving FCM token to user:', uid);
    
    // Use fcmTokens field (can keep expoPushTokens for backward compatibility during migration)
    await setDoc(ref, { fcmTokens: [token], expoPushTokens: [] }, { merge: true });
    // de-dupe-friendly
    await updateDoc(ref, { fcmTokens: arrayUnion(token) });
    
    console.log('✅ FCM token saved successfully');
  } catch (error: any) {
    console.error('❌ Error saving FCM token:', error);
    console.error('Error details:', error.message, error.code);
  }
}
