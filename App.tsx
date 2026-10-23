// App.tsx
import React, { useEffect, useRef, useState } from "react";
import "react-native-gesture-handler";
import { Platform, View, ActivityIndicator, StyleSheet, Linking } from "react-native";
import CoachTour, { TourStep } from "./components/CoachTour";
import { NavigationContainer, NavigationContainerRef } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import messaging from '@react-native-firebase/messaging';
import { getApps } from '@react-native-firebase/app';
import * as Notifications from 'expo-notifications';
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "./firebaseConfig";

import { AuthProvider, useAuth } from "./AuthContext";
import { ThemeProvider, useTheme } from "./Screens/context/ThemeContext";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

import OnboardingScreen from "./Screens/OnboardingScreen";
import AuthScreen from "./Screens/AuthScreen";
import TermsAndConditionsScreen from "./Screens/Legal/TermsAndConditionsScreen";
import PrivacyPolicyScreen from "./Screens/Legal/PrivacyPolicyScreen";
import CommunityScreen from "./Screens/Community/CommunityScreen";
import CommunityDetailScreen from "./Screens/Community/CommunityDetailScreen";
import CreateCommunityScreen from "./Screens/Community/CreateCommunityScreen";
import GroupChatScreen from "./Screens/Community/Group/GroupChatScreen";
import ProfileScreen from "./Screens/Users/ProfileScreen";
import UserProfileScreen from "./Screens/Users/userProfileScreen";
import EditCommunityScreen from "./Screens/Community/EditCommunityScreen";
import ChatRoomScreen from "./Screens/Users/ChatRoomScreen";
import GroupDetailsScreen from "./Screens/Community/Group/GroupDetailsScreen";
import UserScreen from "./Screens/Users/UsersScreen";
import CreateGroupChatScreen from "./Screens/Community/Group/CreateGroupChatScreen";

import MapScreen from "./Screens/Map/MapScreen";
import ActivityChatScreen from "./Screens/Map/ActivityChatScreen";
import ActivityDetailScreen from "./Screens/Map/ActivityDetailScreen";
import CreateMapSpecialScreen from "./Screens/Map/CreateMapSpecialScreen";
import NearbyDealsScreen from "./Screens/Map/NearbyDealsScreen";
import WalletCampaignScreen from "./Screens/Wallet/WalletCampaignScreen";
import PayScreen from "./Screens/Wallet/PayScreen";
import ScanToPayScreen from "./Screens/Wallet/ScanToPayScreen";
import PayoutSetupScreen from "./Screens/Wallet/PayoutSetupScreen";
import DriverApplicationScreen from "./Screens/Rides/DriverApplicationScreen";
import SafetyReviewListScreen from "./Screens/Rides/SafetyReviewListScreen";
import SafetyReviewDetailScreen from "./Screens/Rides/SafetyReviewDetailScreen";
import RideRequestScreen from "./Screens/Rides/RideRequestScreen";
import RideTripScreen from "./Screens/Rides/RideTripScreen";
import DriverHomeScreen from "./Screens/Rides/DriverHomeScreen";
import TrustedContactsScreen from "./Screens/Rides/TrustedContactsScreen";
import BusinessVerificationScreen from "./Screens/Wallet/BusinessVerificationScreen";
import BusinessDashboardScreen from "./Screens/Shop/BusinessDashboardScreen";
import BusinessShopScreen from "./Screens/Shop/BusinessShopScreen";
import OrderScreen from "./Screens/Shop/OrderScreen";
import IncidentReportScreen from "./Screens/Rides/IncidentReportScreen";
import CallScreen from "./Screens/Calls/CallScreen";
import { subscribeActiveCallForUser } from "./utils/callService";
import { registerForPushNotificationsAsync, savePushTokenToUser } from './hooks/useRegisterPushToken';
import { primeKlipyKeyFromFirebase } from './services/klipy';
import { LogBox } from 'react-native';

// Keep errors in terminal only; do not show LogBox/error overlay in the app
LogBox.ignoreAllLogs(true);

// Optional: ignore specific message patterns (still only in terminal when ignoreAllLogs is true)
LogBox.ignoreLogs([
  'VirtualizedLists should never be nested',
  '@firebase/firestore',
  'FirebaseError',
  'permission-denied',
  'Uncaught Error in snapshot listener',
  'Missing or insufficient permissions',
]);

// Set up notification handler for expo-notifications (for foreground notifications)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: Platform.OS === 'ios',
    shouldShowList: Platform.OS === 'ios',
  }),
});

// Create Android notification channel (must exist before showing any notification; FCM uses channelId 'default')
const ensureAndroidNotificationChannel = async () => {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  } catch (e) {
    console.warn('Could not create notification channel:', e);
  }
};
ensureAndroidNotificationChannel();

// Optional: strongly-typed route names if you keep a RootStackParamList
// type RootStackParamList = { ... }

const RootStack = createStackNavigator();

// Visible names under each tab icon (icons alone were confusing for new users)
const TAB_LABELS: Record<string, string> = {
  CommunityScreen: "Communities",
  UserScreen: "Chats",
  MapScreen: "Map",
  WalletScreen: "Wallet",
};
const Tab = createBottomTabNavigator();

// Global nav ref so we can navigate from push tap handlers
export const navigationRef = React.createRef<NavigationContainerRef<any>>();

const TabsNavigator = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [totalUnreadDMs, setTotalUnreadDMs] = useState(0);
  const tabBarRef = useRef<View>(null);

  // Measures one of the tab buttons so the first-time tour can spotlight it
  const TAB_COUNT = 4;
  const tabRect = (i: number) => () =>
    new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
      const node: any = tabBarRef.current;
      if (!node?.measureInWindow) return resolve(null);
      node.measureInWindow((x: number, y: number, w: number, h: number) =>
        resolve(w > 0 ? { x: x + (i * w) / TAB_COUNT, y, width: w / TAB_COUNT, height: Math.min(h, 65) } : null)
      );
    });

  const tabsTour: TourStep[] = [
    {
      icon: "sparkles",
      title: "Quick tour",
      body: "Here's what each tab at the bottom of the screen does. It takes 20 seconds, and you can skip it any time.",
    },
    { icon: "people", getRect: tabRect(0), title: "Communities", body: "Join communities for your campus, area or hobby, and chat in their group chats." },
    { icon: "chatbubbles", getRect: tabRect(1), title: "Chats", body: "Your private messages. A number here means you have unread messages. Find new people under Explore, and tap the call button for free voice calls." },
    { icon: "map", getRect: tabRect(2), title: "Map", body: "See activities and deals near you, post something you want to do, or tap the car button to get a safe ride." },
    { icon: "wallet", getRect: tabRect(3), title: "Wallet", body: "Scan a pay code to pay drivers and shops by card. Drivers and verified businesses get paid into their bank and can track their earnings here." },
  ];

  const shownCallRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.uid) return;
    return subscribeActiveCallForUser(user.uid, (session) => {
      if (!session || session.status !== "ringing" || session.calleeId !== user.uid) return;
      if (shownCallRef.current === session.id) return;
      shownCallRef.current = session.id;
      if (navigationRef.current?.getCurrentRoute()?.name !== "CallScreen") navigationRef.current?.navigate("CallScreen" as never);
    });
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setTotalUnreadDMs(0);
      return;
    }
    const q = query(
      collection(db, "chats"),
      where("participants", "array-contains", user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        let total = 0;
        if (snap?.docs) {
          for (const d of snap.docs) {
            const data = d.data();
            const count = data?.unreadCount?.[user.uid];
            if (typeof count === "number" && count > 0) total += count;
            else if (data?.unreadFor?.[user.uid] === true) total += 1;
          }
        }
        setTotalUnreadDMs(total);
      },
      () => setTotalUnreadDMs(0)
    );
    return () => unsub();
  }, [user?.uid]);

  return (
    <>
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarLabel: TAB_LABELS[route.name] ?? route.name,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600", marginBottom: 6 },
        tabBarBadgeStyle: { backgroundColor: "#3EF0D0", color: "#15102B", fontWeight: "700" },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarHideOnKeyboard: true,
        // Invisible layer filling the tab bar, used only to measure it for the tour
        tabBarBackground: () => <View ref={tabBarRef} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="none" />,
        tabBarStyle: {
          backgroundColor: colors.cardBackground,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 65 + insets.bottom,
          paddingBottom: insets.bottom,
          elevation: 10,
          shadowColor: "#000",
          shadowOpacity: 0.1,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -2 },
        },
        tabBarIcon: ({ color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "ellipse-outline";
          if (route.name === "CommunityScreen") iconName = "people-outline";
          else if (route.name === "UserScreen") iconName = "person-outline";
          else if (route.name === "MapScreen") iconName = "map-outline";
          else if (route.name === "WalletScreen") iconName = "wallet-outline";
          else if (route.name === "CallScreen") iconName = "call-outline";
          return <Ionicons name={iconName} size={size + 2} color={color} />;
        },
      })}
    >
      <Tab.Screen name="CommunityScreen" component={CommunityScreen} />
      <Tab.Screen
        name="UserScreen"
        component={UserScreen}
        options={{
          tabBarBadge: totalUnreadDMs > 0 ? (totalUnreadDMs > 99 ? "99+" : totalUnreadDMs) : undefined,
        }}
      />
      <Tab.Screen name="MapScreen" component={MapScreen} />
      <Tab.Screen name="WalletScreen" component={WalletCampaignScreen} />
    </Tab.Navigator>
    <CoachTour id="tabs" steps={tabsTour} delay={900} />
    </>
  );
};

const MainNavigator = () => {
  const { user, initializing } = useAuth();
  const [hasSeenOnboarding, setHasSeenOnboarding] = React.useState<boolean | null>(null);

  // Prime KLIPY API key from Firebase Remote Config (parameter: klipy_api_key) so GIF picker works without env in repo
  useEffect(() => {
    primeKlipyKeyFromFirebase();
  }, []);

  // If Android closed the app while a driver was picking a document, take them straight back to it
  useEffect(() => {
    if (!user) return;
    let tries = 0;
    let timer: any;
    AsyncStorage.getItem("@wiji_pending_driver_doc")
      .then((v) => {
        const p = v ? JSON.parse(v) : null;
        if (!p || Date.now() - p.at > 30 * 60 * 1000) return;
        const go = () => {
          if (navigationRef.current?.isReady()) navigationRef.current.navigate("DriverApplicationScreen");
          else if (tries++ < 20) timer = setTimeout(go, 250);
        };
        go();
      })
      .catch(() => undefined);
    return () => clearTimeout(timer);
  }, [user?.uid]);

  // Check if user has seen onboarding
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      try {
        const value = await AsyncStorage.getItem("@hasSeenOnboarding");
        setHasSeenOnboarding(value === "true");
      } catch (error) {
        console.error("Error checking onboarding status:", error);
        setHasSeenOnboarding(false);
      }
    };
    checkOnboardingStatus();
  }, []);

  // ----- [ADDED] Handle FCM notifications -----
  useEffect(() => {
    let mounted = true;
    let unsubscribeForeground: (() => void) | null = null;
    let unsubscribeTokenRefresh: (() => void) | null = null;
    let notificationResponseSubscription: any = null;
    
    // React Native Firebase auto-initializes from google-services.json
    // We'll set up listeners and handle any initialization errors gracefully
    const setupMessaging = () => {
      try {
        console.log('🔔 Setting up Firebase messaging listeners...');
        const messagingInstance = messaging();
        
    // Handle notification when app is in foreground
        unsubscribeForeground = messagingInstance.onMessage(async remoteMessage => {
      console.log('📬 FCM message received in foreground:', remoteMessage);
      
      const data = remoteMessage.data || {};
      const notification = remoteMessage.notification;

      // FCM doesn't automatically display notifications when app is in foreground
      // We need to show them manually using expo-notifications
      if (notification) {
        try {
          console.log('📬 Displaying foreground notification:', notification.title, notification.body);
          await ensureAndroidNotificationChannel();
          await Notifications.scheduleNotificationAsync({
            content: {
              title: notification.title || 'Notification',
              body: notification.body || '',
              data: data,
              sound: true,
              ...(Platform.OS === 'android' && { channelId: 'default' }),
            },
            trigger: null, // Show immediately
          });
          console.log('✅ Foreground notification scheduled successfully');
        } catch (error: any) {
          console.error('❌ Failed to display foreground notification:', error);
          console.error('Error details:', error.message, error.stack);
        }
      }
    });

    // Handle notification taps from expo-notifications (foreground notifications)
        notificationResponseSubscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const data = response.notification.request.content.data;
      console.log('📬 Foreground notification tapped:', data);
      handleNotificationNavigation(data);
    });

    // Handle notification tap when app is in background or quit state
        messagingInstance.onNotificationOpenedApp(remoteMessage => {
      console.log('📬 Notification opened app from background:', remoteMessage);
      const data = remoteMessage.data || {};
      handleNotificationNavigation(data);
    });

    // Check if app was opened from a quit state via notification
        messagingInstance
      .getInitialNotification()
      .then(remoteMessage => {
        if (remoteMessage) {
          console.log('📬 Notification opened app from quit state:', remoteMessage);
          const data = remoteMessage.data || {};
          // Use a small timeout to ensure the navigator is ready
          setTimeout(() => {
            handleNotificationNavigation(data);
          }, 1000);
        }
          })
          .catch(err => {
            console.warn('⚠️ Could not get initial notification:', err.message);
      });

    // Handle token refresh
        unsubscribeTokenRefresh = messagingInstance.onTokenRefresh(token => {
      console.log('🔄 FCM token refreshed:', token.substring(0, 20) + '...');
      savePushTokenToUser(token);
    });
      } catch (messagingError: any) {
        console.warn('⚠️ Could not set up messaging listeners:', messagingError.message);
        console.warn('This may be normal if Firebase is still initializing or google-services.json is missing');
      }
    };
    
    // Call setup with a small delay to ensure React Native Firebase is ready
    const timer = setTimeout(() => {
      setupMessaging();
    }, 500);

    return () => {
      clearTimeout(timer);
      mounted = false;
      if (unsubscribeForeground) unsubscribeForeground();
      if (unsubscribeTokenRefresh) unsubscribeTokenRefresh();
      if (notificationResponseSubscription) notificationResponseSubscription.remove();
    };
  }, []);

  // Helper function to handle navigation from notification data
  const handleNotificationNavigation = (data: any) => {
    if (data?.type === 'dm' && data.chatId && data.recipientId) {
      if (navigationRef.current) {
        navigationRef.current.navigate('ChatRoomScreen', {
          chatId: data.chatId as string,
          recipientId: data.recipientId as string,
        });
      }
    } else if (data?.type === 'group' && data.communityId && data.chatId) {
      if (navigationRef.current) {
        navigationRef.current.navigate('GroupChatScreen', {
          groupId: data.chatId as string,
          groupName: (data.groupName as string) || 'Group',
          communityId: data.communityId as string,
        });
      }
    } else if (data?.type === 'ride' && data.rideId) {
      navigationRef.current?.navigate('RideTripScreen', { rideId: data.rideId as string });
    } else if (data?.type === 'trip_share' && data.url) {
      // A friend shared their live trip (or pressed the emergency button)
      Linking.openURL(String(data.url)).catch(() => undefined);
    } else if (data?.type === 'order' && data.orderId) {
      navigationRef.current?.navigate('OrderScreen', { orderId: data.orderId as string });
    } else if (data?.type === 'shop_order') {
      navigationRef.current?.navigate('BusinessDashboardScreen');
    } else if (data?.type === 'business') {
      navigationRef.current?.navigate('BusinessVerificationScreen');
    } else if (data?.type === 'ride_offer' || data?.type === 'ride_paid' || data?.type === 'rating') {
      navigationRef.current?.navigate('DriverHomeScreen');
    } else if (data?.type === 'driver') {
      // Driver application news, document reminders and expiry pauses
      navigationRef.current?.navigate('DriverApplicationScreen' as never);
    } else if (data?.type === 'staff_driver') {
      // Wiji team: a driver's documents to check, or an expiry
      if (data.uid) (navigationRef.current as any)?.navigate('SafetyReviewDetailScreen', { uid: String(data.uid) });
      else navigationRef.current?.navigate('SafetyReviewListScreen' as never);
    } else if (data?.type === 'payment') {
      navigationRef.current?.navigate('Tabs', { screen: 'WalletScreen' } as never);
    } else if (data?.type === 'call') {
      if (navigationRef.current) {
        navigationRef.current.navigate('CallScreen' as never);
      }
    }
  };
  // ----- [END ADDED SECTION] -----

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user) {
        console.log('⏸️ No user logged in, skipping push token registration');
        return;
      }
      console.log('🔔 Starting push notification registration for user:', user.uid);
      const token = await registerForPushNotificationsAsync();
      if (mounted && token) {
        console.log('💾 Saving token to Firestore...');
        await savePushTokenToUser(token);
      } else if (mounted) {
        console.warn('⚠️ No push token obtained, skipping save');
      }
    })();
    return () => { mounted = false; };
  }, [user]);


  // Anyone who is (or was) signed in has been through onboarding: never show them the slides again
  useEffect(() => {
    if (!user) return;
    setHasSeenOnboarding(true);
    AsyncStorage.setItem("@hasSeenOnboarding", "true").catch(() => undefined);
  }, [user?.uid]);

  // Wait until we know (1) whether onboarding was seen and (2) whether a saved login exists,
  // otherwise signed-in users briefly get the signed-out screens (the onboarding slides)
  if (hasSeenOnboarding === null || initializing) {
    return (
      <ThemeProvider>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#15102B' }}>
          <ActivityIndicator size="large" color="#3EF0D0" />
        </View>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider>
      <NavigationContainer ref={navigationRef}>
        <RootStack.Navigator 
          screenOptions={{ headerShown: false }}
          // Signed-in users always start in the app; the walkthrough is only for new visitors
          // (signed-in users can still replay it from Edit Profile)
          initialRouteName={user ? "Tabs" : hasSeenOnboarding ? "AuthScreen" : "OnboardingScreen"}
        >
          {user ? (
            <>
              <RootStack.Screen name="Tabs" component={TabsNavigator} />

              {/* Screens without the bottom tab bar */}
              <RootStack.Screen name="GroupChatScreen" component={GroupChatScreen} />
              <RootStack.Screen name="ActivityChatScreen" component={ActivityChatScreen} />
              <RootStack.Screen name="ActivityDetailScreen" component={ActivityDetailScreen} />
              <RootStack.Screen name="CreateMapSpecialScreen" component={CreateMapSpecialScreen} />
              <RootStack.Screen name="NearbyDealsScreen" component={NearbyDealsScreen} />
              <RootStack.Screen name="CallScreen" component={CallScreen} />
              <RootStack.Screen name="ChatRoomScreen" component={ChatRoomScreen} />
              <RootStack.Screen name="CommunityDetailScreen" component={CommunityDetailScreen} />
              <RootStack.Screen name="EditCommunityScreen" component={EditCommunityScreen} />
              <RootStack.Screen name="UserProfileScreen" component={UserProfileScreen} />
              <RootStack.Screen name="GroupDetailsScreen" component={GroupDetailsScreen} />
              <RootStack.Screen name="CreateCommunityScreen" component={CreateCommunityScreen} />
              <RootStack.Screen name="CreateGroupChatScreen" component={CreateGroupChatScreen} />
              <RootStack.Screen name="ProfileScreen" component={ProfileScreen} />
              <RootStack.Screen name="TermsAndConditionsScreen" component={TermsAndConditionsScreen} />
              <RootStack.Screen name="PrivacyPolicyScreen" component={PrivacyPolicyScreen} />
              <RootStack.Screen name="PayScreen" component={PayScreen} />
              <RootStack.Screen name="ScanToPayScreen" component={ScanToPayScreen} />
              <RootStack.Screen name="PayoutSetupScreen" component={PayoutSetupScreen} />
              <RootStack.Screen name="DriverApplicationScreen" component={DriverApplicationScreen} />
              <RootStack.Screen name="SafetyReviewListScreen" component={SafetyReviewListScreen} />
              <RootStack.Screen name="SafetyReviewDetailScreen" component={SafetyReviewDetailScreen} />
              <RootStack.Screen name="RideRequestScreen" component={RideRequestScreen} />
              <RootStack.Screen name="RideTripScreen" component={RideTripScreen} />
              <RootStack.Screen name="DriverHomeScreen" component={DriverHomeScreen} />
              <RootStack.Screen name="TrustedContactsScreen" component={TrustedContactsScreen} />
              <RootStack.Screen name="BusinessVerificationScreen" component={BusinessVerificationScreen} />
              <RootStack.Screen name="BusinessDashboardScreen" component={BusinessDashboardScreen} />
              <RootStack.Screen name="BusinessShopScreen" component={BusinessShopScreen} />
              <RootStack.Screen name="OrderScreen" component={OrderScreen} />
              <RootStack.Screen name="IncidentReportScreen" component={IncidentReportScreen} />
              {/* Signed-in users replay the walkthrough from their profile. It has its own name on purpose:
                  if it shared "OnboardingScreen" with the signed-out stack, React Navigation would keep the
                  slides on screen after someone signs in (routes whose names exist in both stacks survive). */}
              <RootStack.Screen name="WalkthroughScreen" component={OnboardingScreen} initialParams={{ replay: true }} />
            </>
          ) : (
            <>
              {/* Always register both screens for unauthenticated users */}
              <RootStack.Screen name="OnboardingScreen" component={OnboardingScreen} />
              <RootStack.Screen name="AuthScreen" component={AuthScreen} />
              <RootStack.Screen name="TermsAndConditionsScreen" component={TermsAndConditionsScreen} />
              <RootStack.Screen name="PrivacyPolicyScreen" component={PrivacyPolicyScreen} />
            </>
          )}
        </RootStack.Navigator>
      </NavigationContainer>
      </SafeAreaProvider>
    </ThemeProvider>
  );
};

const App = () => (
  <AuthProvider>
    <MainNavigator />
  </AuthProvider>
);

export default App;
