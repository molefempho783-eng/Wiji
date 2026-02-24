// hooks/useRegisterPushToken.ts
import messaging from '@react-native-firebase/messaging';
import firebase, { getApps } from '@react-native-firebase/app';
import { Platform, Alert, PermissionsAndroid, Linking } from 'react-native';
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
          'Please enable notifications in Settings to receive message alerts and so the app can work correctly.',
          [
            { text: 'Open settings', onPress: () => Linking.openSettings() },
            { text: 'OK' },
          ]
        );
        return null;
      }
    }

    // 2) Get FCM token; on Android emulator retry once after delay (Play Services can start late)
    console.log('📱 Getting FCM token...');
    let messagingInstance;
    try {
      messagingInstance = messaging();
    } catch (error: any) {
      console.error('❌ Failed to get messaging instance:', error.message);
      return null;
    }

    const getTokenWithRetry = async (attempt = 1): Promise<string | null> => {
      try {
        const t = await messagingInstance.getToken();
        return t || null;
      } catch (err: any) {
        const msg = err?.message || String(err);
        const looksLikeEmulator = Platform.OS === 'android' && (msg.includes('MISSING_INSTANCEID') || msg.includes('SERVICE_NOT_AVAILABLE') || msg.includes('PHONE_REGISTRATION'));
        if (looksLikeEmulator && attempt === 1) {
          console.warn('⚠️ FCM token failed (emulator?). Retrying in 3s...');
          await new Promise((r) => setTimeout(r, 3000));
          return getTokenWithRetry(2);
        }
        throw err;
      }
    };

    const token = await getTokenWithRetry();
    if (token) {
      console.log('✅ FCM token obtained:', token.substring(0, 20) + '...');
    } else {
      console.warn('❌ Failed to get FCM token. On emulator: use an AVD with Google Play and try a cold boot.');
    }
    return token;
  } catch (e: any) {
    console.error('❌ registerForPushNotificationsAsync error:', e);
    console.error('Error details:', e.message, e.stack);
    if (Platform.OS === 'android') {
      console.warn('On Android emulator: use an AVD with "Google Play" (not just Google APIs), sign in with a Google account, and cold boot if needed. See NOTIFICATIONS_ANDROID.md.');
    }
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
