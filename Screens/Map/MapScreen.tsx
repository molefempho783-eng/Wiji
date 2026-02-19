import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  Dimensions,
  Image,
  Switch,
  PanResponder,
} from 'react-native';
import MapView, {
  Marker,
  Region,
  PROVIDER_GOOGLE,
  Callout,
} from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { getAuth } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types';
import {
  collection,
  query,
  where,
  addDoc,
  onSnapshot,
  serverTimestamp,
  doc,
  setDoc,
  updateDoc,
  arrayUnion,
  getDoc,
  Timestamp,
  deleteDoc,
  orderBy,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebaseConfig';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode } from 'expo-av';
import { TabView, SceneMap, TabBar } from 'react-native-tab-view';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

/** Match App.tsx tab bar so FABs sit above it */
const TAB_BAR_CONTENT_HEIGHT = 65;
const FAB_BOTTOM_SPACING = 24;

const AVATAR_PLACEHOLDER = require('../../assets/avatar-placeholder.png');

/** Throttle: save user location to Firestore at most this often (ms) so nearby-activity notifications work */
const SAVE_LOCATION_THROTTLE_MS = 45 * 1000;

/** Height of the tab bar row (Map | My activities) so we can position the memories strip below it when rendered outside TabView */
const TAB_BAR_HEIGHT = 50;

/** Height of the memories strip (padding + minHeight) so My activities list can add top padding and avoid overlap */
const MEMORIES_STRIP_HEIGHT = 108;

/** Google Maps night mode style – use with customMapStyle when theme is dark (blue accents) */
const MAP_DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b8cae' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#93c5fd' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#93c5fd' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3d4f5e' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#bfdbfe' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#93c5fd' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5c7c9e' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
];

type NavigationProp = StackNavigationProp<RootStackParamList>;

interface ParticipantData {
  userId: string;
  username: string;
  profilePic?: string;
}

const DEFAULT_REGION: Region = {
  latitude: -26.2041, // Johannesburg default
  longitude: 28.0473,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};

type ActivityType = 'food-and-drinks' | 'night-life' | 'outdoor' | 'sightseeing' | 'entertainment' | 'shopping' | 'wellness' | 'social' | 'fitness' | 'other';

type PlaceSuggestion = { place_id: string; description: string };

interface Activity {
  id: string;
  title: string;
  description?: string; // Optional since we're no longer creating it
  activityType: ActivityType;
  latitude: number;
  longitude: number;
  location?: string; // Address/location name
  createdBy: string;
  createdByName: string;
  createdAt: any;
  participants: string[];
  maxParticipants?: number;
  startTime?: any; // Start date/time of the activity
  endTime?: any; // End date/time of the activity
  distance?: number; // Distance in km
  visibility?: 'everyone' | 'friends_only';
  allowedViewers?: string[]; // When friends_only: creator + friend UIDs
}

/** Memory tied to an activity (video), 24h expiry; visible to everyone within 50km */
interface ActivityMemory {
  id: string;
  activityId: string;
  activityTitle: string;
  videoUrl: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  createdAt: any;
  expiresAt: any;
  latitude: number;
  longitude: number;
}

// Haversine formula to calculate distance between two coordinates in km
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function MapScreen() {
  const { colors, theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();
  const fabBottom = TAB_BAR_CONTENT_HEIGHT + insets.bottom + FAB_BOTTOM_SPACING;
  const mapRef = useRef<MapView>(null);
  const auth = getAuth();
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const followUserRef = useRef(true); // Use ref to access latest followUser value in callbacks
  const isProgrammaticUpdateRef = useRef(false); // Track if we're programmatically updating region
  const lastSavedLocationTimeRef = useRef<number>(0);

  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [showCreateActivity, setShowCreateActivity] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [showActivitiesList, setShowActivitiesList] = useState(false);
  const [followUser, setFollowUser] = useState(true); // Track if map should auto-follow user
  const [showParticipantsList, setShowParticipantsList] = useState(false);
  const [participantsData, setParticipantsData] = useState<ParticipantData[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [memories, setMemories] = useState<ActivityMemory[]>([]);
  const [memoryViewerVisible, setMemoryViewerVisible] = useState(false);
  const [memoryViewerActivityId, setMemoryViewerActivityId] = useState<string | null>(null);
  const [memoryViewerIndex, setMemoryViewerIndex] = useState(0);
  const [uploadingMemory, setUploadingMemory] = useState(false);
  const [tabIndex, setTabIndex] = useState(0);
  const [tabRoutes] = useState([
    { key: 'map', title: 'Map' },
    { key: 'my-activities', title: 'My activities' },
  ]);
  const [highlightedMemoryLocation, setHighlightedMemoryLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [unreadByActivityId, setUnreadByActivityId] = useState<Record<string, number>>({});

  const myActivities = useMemo(() => {
    const list = activities.filter(
      (a) => auth.currentUser && a.participants.includes(auth.currentUser.uid)
    );
    const toMs = (a: Activity) => {
      const t = a.createdAt || a.startTime;
      if (!t) return 0;
      return t.toMillis ? t.toMillis() : (t.seconds != null ? t.seconds * 1000 : 0);
    };
    list.sort((a, b) => toMs(b) - toMs(a));
    return list;
  }, [activities, auth.currentUser?.uid]);

  const isActivityExpired = (a: Activity): boolean => {
    if (!a.endTime) return false;
    const endTime = a.endTime.toDate ? a.endTime.toDate() : new Date(a.endTime.seconds * 1000);
    return endTime < new Date();
  };

  /** Activities to show on the map (exclude expired so we don't clutter the map) */
  const activitiesForMap = activities.filter((a) => !isActivityExpired(a));

  // Form states for activity
  const [activityTitle, setActivityTitle] = useState('');
  const [activityDescription, setActivityDescription] = useState('');
  const [activityType, setActivityType] = useState<ActivityType>('social');
  const [activityDate, setActivityDate] = useState<Date>(new Date());
  const [activityTime, setActivityTime] = useState<Date>(new Date());
  const [activityDateInput, setActivityDateInput] = useState<string>('');
  const [activityTimeInput, setActivityTimeInput] = useState<string>('');
  const [activityEndDate, setActivityEndDate] = useState<Date>(new Date());
  const [activityEndTime, setActivityEndTime] = useState<Date>(new Date());
  const [activityEndDateInput, setActivityEndDateInput] = useState<string>('');
  const [activityEndTimeInput, setActivityEndTimeInput] = useState<string>('');
  const [activityLocation, setActivityLocation] = useState<string>('');
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<PlaceSuggestion[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [activityFriendsOnly, setActivityFriendsOnly] = useState(false);

  const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyDR5JhBnTT53KmUwNQI6QcWG5RjY5sdYRM';

  // Save current user location to Firestore so Cloud Function can notify nearby users of new activities
  const saveUserLocationToFirestore = (lat: number, lng: number) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const now = Date.now();
    if (now - lastSavedLocationTimeRef.current < SAVE_LOCATION_THROTTLE_MS) return;
    lastSavedLocationTimeRef.current = now;
    const userRef = doc(db, 'users', uid);
    updateDoc(userRef, {
      latitude: lat,
      longitude: lng,
      lastLocationUpdated: serverTimestamp(),
    }).catch((err) => console.warn('Failed to save user location for notifications:', err));
  };

  // Request location permission and start tracking
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (mounted) setLoading(false);
          Alert.alert(
            'Location Permission',
            'Please enable location permissions to see your location on the map.'
          );
          return;
        }

        // Get initial location with balanced accuracy (faster)
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!mounted) return;

        setUserLocation(location);
        saveUserLocationToFirestore(location.coords.latitude, location.coords.longitude);

        const newRegion: Region = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        setRegion(newRegion);
        setFollowUser(false); // Only recenter on open and when user taps recenter
        followUserRef.current = false;
        setLoading(false); // Show map only after we have location so it opens with correct region (no flicker)

        // Start watching location for continuous updates (user dot + Firestore only; do not recenter map)
        setTimeout(async () => {
          try {
            locationSubscriptionRef.current = await Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.Balanced,
                timeInterval: 10000,
                distanceInterval: 50,
              },
              (newLocation) => {
                if (mounted) {
                  setUserLocation(newLocation);
                  saveUserLocationToFirestore(newLocation.coords.latitude, newLocation.coords.longitude);
                }
              }
            );
          } catch (e) {
            console.error('Error setting up location watch:', e);
          }
        }, 2000);
      } catch (error) {
        console.error('Error getting location:', error);
        if (mounted) {
          setLoading(false);
          Alert.alert('Error', 'Failed to get your location. Please try again.');
        }
      }
    })();

    // Cleanup location subscription
    return () => {
      mounted = false;
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
      }
    };
  }, []);

  // Fetch nearby activities within 50km radius
  useEffect(() => {
    if (!userLocation) return;

    const centerLat = userLocation.coords.latitude;
    const centerLng = userLocation.coords.longitude;
    // 50km radius ≈ 0.45 degrees (roughly)
    const radiusDegrees = 0.45;

    // Query activities within radius
    const activitiesRef = collection(db, 'activities');
    const q = query(
      activitiesRef,
      where('latitude', '>=', centerLat - radiusDegrees),
      where('latitude', '<=', centerLat + radiusDegrees)
    );

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
      const activitiesList: Activity[] = [];
      const userIds = new Set<string>();
      
      // First pass: collect activities and user IDs
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const lng = data.longitude;
        
        // Calculate precise distance using haversine formula
        const distance = calculateDistance(
          centerLat,
          centerLng,
          data.latitude,
          lng
        );
        
        // Only include activities within 50km; include expired only if current user joined (so group chat stays in My activities)
        if (distance <= 50) {
          const activityData = {
            id: docSnap.id,
            ...data,
            createdByName: 'Loading...', // Placeholder
            distance: Math.round(distance * 10) / 10, // Round to 1 decimal place
          } as Activity;

          const participants = (data.participants as string[]) || [];
          const isParticipant = !!auth.currentUser && participants.includes(auth.currentUser.uid);
          if (activityData.endTime) {
            const endTime = activityData.endTime.toDate ? activityData.endTime.toDate() : new Date(activityData.endTime.seconds * 1000);
            if (endTime < new Date() && !isParticipant) continue; // Skip expired only if user didn't join
          }

          activitiesList.push(activityData);
          userIds.add(data.createdBy);
        }
      }

      // Sort by distance (closest first)
      activitiesList.sort((a, b) => (a.distance || 0) - (b.distance || 0));
      setActivities(activitiesList);
    
      // Fetch user names in parallel (non-blocking)
      const userNamesMap = new Map<string, string>();
      const userPromises = Array.from(userIds).map(async (userId) => {
        try {
          const userDoc = await getDoc(doc(db, 'users', userId));
          if (userDoc.exists()) {
            const userName = userDoc.data().username || userDoc.data().displayName || 'Unknown';
            userNamesMap.set(userId, userName);
          } else {
            userNamesMap.set(userId, 'Unknown');
          }
        } catch (e) {
          console.error('Error fetching creator name:', e);
          userNamesMap.set(userId, 'Unknown');
        }
      });

      // Wait for all user names to load, then update activities
      Promise.all(userPromises).then(() => {
        const updatedActivities = activitiesList.map(activity => ({
          ...activity,
          createdByName: userNamesMap.get(activity.createdBy) || 'Unknown',
        }));
        setActivities(updatedActivities);
      });
    },
      (err) => {
        console.error('Activities snapshot error:', err);
      }
    );

    return () => unsubscribe();
  }, [userLocation]);

  // Fetch activity memories (unexpired) within 50km of user - visible to everyone in radius
  useEffect(() => {
    if (!userLocation) return;
    const now = Timestamp.now();
    const centerLat = userLocation.coords.latitude;
    const centerLng = userLocation.coords.longitude;
    const q = query(
      collection(db, 'activityMemories'),
      where('expiresAt', '>', now),
      orderBy('expiresAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
      const list: ActivityMemory[] = [];
      snapshot.docs.forEach((d) => {
        const data = d.data();
        const distance = calculateDistance(centerLat, centerLng, data.latitude, data.longitude);
        if (distance <= 50) {
          list.push({
            id: d.id,
            activityId: data.activityId,
            activityTitle: data.activityTitle || '',
            videoUrl: data.videoUrl,
            userId: data.userId,
            userName: data.userName || 'Unknown',
            userPhoto: data.userPhoto,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
            latitude: data.latitude,
            longitude: data.longitude,
          });
        }
      });
      setMemories(list);
    },
      (err) => console.error('Activity memories snapshot error:', err)
    );
    return () => unsub();
  }, [userLocation]);

  // Subscribe to activityChats docs for unread counts (My activities list badge)
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const activityIds = myActivities.map((a) => a.id);
    if (activityIds.length === 0) {
      setUnreadByActivityId({});
      return;
    }
    const unsubs: (() => void)[] = [];
    activityIds.forEach((activityId) => {
      const unsub = onSnapshot(
        doc(db, 'activityChats', activityId),
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();
          const count = (data?.unreadCount && typeof data.unreadCount[uid] === 'number') ? data.unreadCount[uid] : 0;
          setUnreadByActivityId((prev) => (prev[activityId] === count ? prev : { ...prev, [activityId]: count }));
        },
        (err) => console.error('ActivityChat unread snapshot error:', err)
      );
      unsubs.push(unsub);
    });
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [myActivities.map((a) => a.id).sort().join(',')]);

  // Periodic check to remove expired activities from local state (keep expired if user joined so My activities tab keeps group chat)
  useEffect(() => {
    const interval = setInterval(() => {
      setActivities(prevActivities => {
        const now = new Date();
        return prevActivities.filter(activity => {
          if (!activity.endTime) return true; // Keep activities without endTime
          const endTime = activity.endTime.toDate ? activity.endTime.toDate() : new Date(activity.endTime.seconds * 1000);
          if (endTime >= now) return true; // Keep if not expired
          const isParticipant = !!auth.currentUser && activity.participants.includes(auth.currentUser.uid);
          return isParticipant; // Keep expired only if current user joined
        });
      });
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  // One-time recenter on open is done in onMapReady only (avoids double animation / flicker)

  // When user taps "View on map" from memory viewer: switch to Map tab, then animate to that location and show highlight
  useEffect(() => {
    if (tabIndex !== 0 || !highlightedMemoryLocation || !mapRef.current) return;
    const region = {
      ...highlightedMemoryLocation,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
    const t = setTimeout(() => {
      if (mapRef.current) {
        isProgrammaticUpdateRef.current = true;
        mapRef.current.animateToRegion(region, 800);
      }
    }, 300);
    const clear = setTimeout(() => setHighlightedMemoryLocation(null), 6000);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
  }, [tabIndex, highlightedMemoryLocation]);

  const centerOnUser = async () => {
    try {
      // Get fresh location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      
      setUserLocation(location);
      
      const newRegion: Region = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
      
      // Re-enable follow and animate to region
      setFollowUser(true);
      followUserRef.current = true;
      setRegion(newRegion);
      
      if (mapRef.current) {
        isProgrammaticUpdateRef.current = true;
        mapRef.current.animateToRegion(newRegion, 1000);
      }
    } catch (error) {
      console.error('Error centering on user:', error);
      // Fallback to existing location if available
      if (userLocation) {
        const newRegion: Region = {
          latitude: userLocation.coords.latitude,
          longitude: userLocation.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        setFollowUser(true);
        followUserRef.current = true;
        setRegion(newRegion);
        
        if (mapRef.current) {
          isProgrammaticUpdateRef.current = true;
          mapRef.current.animateToRegion(newRegion, 1000);
      }
      } else {
        Alert.alert('Error', 'Unable to get your location. Please check location permissions.');
      }
    }
  };

  // Get location address from coordinates
  const getLocationAddress = async (latitude: number, longitude: number): Promise<string> => {
    try {
      const addresses = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });
      if (addresses && addresses.length > 0) {
        const addr = addresses[0];
        const parts = [
          addr.name,
          addr.street,
          addr.city,
          addr.region,
          addr.postalCode,
          addr.country,
        ].filter(Boolean);
        return parts.join(', ') || 'Current location';
      }
      return 'Current location';
          } catch (error) {
      console.error('Error getting address:', error);
      return 'Current location';
    }
  };

  // Google Places Autocomplete functions
  async function fetchSuggestions(text: string): Promise<PlaceSuggestion[]> {
    if (!GOOGLE_KEY || !text.trim()) {
      console.log('No API key or empty text');
      return [];
    }

    // Build URL with location bias if user location is available
    let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
      text
    )}&key=${GOOGLE_KEY}`;

    // Add location bias to prioritize results within 50km of user
    if (userLocation) {
      const lat = userLocation.coords.latitude;
      const lng = userLocation.coords.longitude;
      const radius = 50000; // 50km in meters
      url += `&location=${lat},${lng}&radius=${radius}&strictbounds=true`;
    }

    try {
      console.log('Fetching suggestions for:', text);
      if (userLocation) {
        console.log('With location bias:', userLocation.coords.latitude, userLocation.coords.longitude);
      }
      const res = await fetch(url);
      const data = await res.json();
      console.log('API response:', data);
      if (data.error_message) {
        console.error('Google Places API error:', data.error_message);
        return [];
      }
      const suggestions = (data?.predictions || []).map((p: any) => ({
        place_id: p.place_id,
        description: p.description,
      }));
      console.log('Parsed suggestions:', suggestions.length);
      return suggestions;
    } catch (error) {
      console.error('Error fetching suggestions:', error);
      return [];
    }
  }

  async function getPlaceLatLng(place_id: string): Promise<{ lat: number; lng: number } | null> {
    if (!GOOGLE_KEY) return null;
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&key=${GOOGLE_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      const loc = data?.result?.geometry?.location;
      if (!loc) return null;
      return { lat: loc.lat, lng: loc.lng };
    } catch {
              return null;
            }
  }

  const handleLocationChange = async (text: string) => {
    setActivityLocation(text);
    setSelectedPlaceId(null);
    if (text.trim().length > 1) {
      try {
        const results = await fetchSuggestions(text);
        console.log('Fetched suggestions:', results.length);
        setLocationSuggestions(results);
        setShowLocationSuggestions(results.length > 0);
          } catch (error) {
        console.error('Error fetching suggestions:', error);
        setLocationSuggestions([]);
        setShowLocationSuggestions(false);
      }
    } else {
      setLocationSuggestions([]);
      setShowLocationSuggestions(false);
    }
  };

  const handleSelectLocation = async (suggestion: PlaceSuggestion) => {
    setActivityLocation(suggestion.description);
    setSelectedPlaceId(suggestion.place_id);
    setLocationSuggestions([]);
    setShowLocationSuggestions(false);
  };

  const handleCreateActivity = async () => {
    if (!auth.currentUser || !userLocation) {
      Alert.alert('Error', 'You must be logged in and have location access.');
      return;
    }

    if (!activityTitle.trim()) {
      Alert.alert('Error', 'Please enter a title for your activity.');
      return;
          }

          try {
      // Get user name
      let userName = 'Unknown';
      try {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          userName = userDoc.data().username || userDoc.data().displayName || auth.currentUser.displayName || 'Unknown';
        }
      } catch (e) {
        userName = auth.currentUser.displayName || 'Unknown';
        }

      // Combine start date and time
      const combinedStartDateTime = new Date(activityDate);
      combinedStartDateTime.setHours(activityTime.getHours());
      combinedStartDateTime.setMinutes(activityTime.getMinutes());

      // Combine end date and time
      const combinedEndDateTime = new Date(activityEndDate);
      combinedEndDateTime.setHours(activityEndTime.getHours());
      combinedEndDateTime.setMinutes(activityEndTime.getMinutes());

      // Validate that end time is after start time
      if (combinedEndDateTime <= combinedStartDateTime) {
        Alert.alert('Error', 'End date and time must be after start date and time.');
        return;
      }

      // Get location address and coordinates
      let activityLat = userLocation.coords.latitude;
      let activityLng = userLocation.coords.longitude;
      let locationAddress = activityLocation;

      // If a place was selected, use its coordinates
      if (selectedPlaceId) {
        const placeCoords = await getPlaceLatLng(selectedPlaceId);
        if (placeCoords) {
          activityLat = placeCoords.lat;
          activityLng = placeCoords.lng;
        }
      }

      // If no location was entered, use current location address
      if (!locationAddress) {
        locationAddress = await getLocationAddress(
          userLocation.coords.latitude,
          userLocation.coords.longitude
        );
      }

      let allowedViewers: string[] | undefined;
      const visibility = activityFriendsOnly ? 'friends_only' : 'everyone';
      if (activityFriendsOnly) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        const friendsData = userDoc.exists() ? userDoc.data()?.friends : null;
        const friendIds: string[] = [];
        if (Array.isArray(friendsData)) {
          friendIds.push(...friendsData);
        } else if (friendsData && typeof friendsData === 'object') {
          friendIds.push(...Object.keys(friendsData).filter((uid) => friendsData[uid] === true));
        }
        allowedViewers = [auth.currentUser.uid, ...friendIds];
      }

      const activityRef = await addDoc(collection(db, 'activities'), {
        title: activityTitle.trim(),
        activityType: activityType,
        latitude: activityLat,
        longitude: activityLng,
        location: locationAddress,
        createdBy: auth.currentUser.uid,
        createdByName: userName,
        createdAt: serverTimestamp(),
        participants: [auth.currentUser.uid],
        startTime: Timestamp.fromDate(combinedStartDateTime),
        endTime: Timestamp.fromDate(combinedEndDateTime),
        visibility,
        ...(allowedViewers && { allowedViewers }),
      });
      await setDoc(doc(db, 'activityChats', activityRef.id), {
        activityId: activityRef.id,
        activityTitle: activityTitle.trim(),
        createdAt: serverTimestamp(),
      });

      Alert.alert('Success', 'Activity created!');
      setShowCreateActivity(false);
      setActivityTitle('');
      const now = new Date();
      setActivityDate(now);
      setActivityTime(now);
      setActivityDateInput('');
      setActivityTimeInput('');
      // Set end date/time to 2 hours after start by default
      const endDateTime = new Date(now);
      endDateTime.setHours(endDateTime.getHours() + 2);
      setActivityEndDate(endDateTime);
      setActivityEndTime(endDateTime);
      setActivityEndDateInput('');
      setActivityEndTimeInput('');
      setActivityLocation('');
      setSelectedPlaceId(null);
      setLocationSuggestions([]);
      setShowLocationSuggestions(false);
      setActivityFriendsOnly(false);
    } catch (error: any) {
      console.error('Error creating activity:', error);
    }
  };

  const handleJoinActivity = async (activity: Activity) => {
    if (!auth.currentUser) {
      Alert.alert('Error', 'You must be logged in to join an activity.');
      return;
    }

    if (activity.participants.includes(auth.currentUser.uid)) {
      Alert.alert('Info', 'You are already part of this activity.');
      return;
    }

    try {
      await updateDoc(doc(db, 'activities', activity.id), {
        participants: arrayUnion(auth.currentUser.uid),
      });
      const chatRef = doc(db, 'activityChats', activity.id);
      const chatSnap = await getDoc(chatRef);
      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          activityId: activity.id,
          activityTitle: activity.title,
          createdAt: serverTimestamp(),
        });
      }
      Alert.alert('Success', 'You joined the activity!');
      setSelectedActivity(null);
    } catch (error: any) {
      console.error('Error joining activity:', error);
    }
  };

  const handleDeleteActivity = async (activity: Activity) => {
    if (!auth.currentUser || activity.createdBy !== auth.currentUser.uid) {
      Alert.alert('Error', 'Only the creator can delete this activity.');
      return;
    }
    Alert.alert(
      'Delete activity',
      'Are you sure you want to delete this activity? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'activities', activity.id));
              setActivities((prev) => prev.filter((a) => a.id !== activity.id));
              setSelectedActivity(null);
              Alert.alert('Done', 'Activity deleted.');
            } catch (error: any) {
              console.error('Error deleting activity:', error);
            }
          },
        },
      ]
    );
  };

  /** Open add-memory flow from map FAB: pick activity if multiple, then add memory. */
  const handleAddMemoryFromMap = () => {
    if (myActivities.length === 0) return;
    if (myActivities.length === 1) {
      handleAddMemory(myActivities[0]);
      return;
    }
    Alert.alert(
      'Add memory to',
      'Choose an activity',
      [
        ...myActivities.slice(0, 5).map((a) => ({
          text: a.title.length > 30 ? a.title.slice(0, 27) + '…' : a.title,
          onPress: () => handleAddMemory(a),
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleAddMemory = async (activity: Activity) => {
    if (!auth.currentUser) {
      Alert.alert('Error', 'You must be logged in to add a memory.');
      return;
    }
    if (!activity.participants.includes(auth.currentUser.uid)) {
      Alert.alert('Error', 'You must be part of this activity to add a memory.');
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your media library to add a memory.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const uri = asset.uri;
    setUploadingMemory(true);
    try {
      const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
      const userName = userDoc.exists() ? (userDoc.data()?.username || userDoc.data()?.displayName || 'Unknown') : 'Unknown';
      const userPhoto = userDoc.exists() ? userDoc.data()?.profilePic : undefined;
      const response = await fetch(uri);
      const blob = await response.blob();
      const ext = uri.split('.').pop()?.toLowerCase() || 'mp4';
      const contentType = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
      const path = `activity_memories/${activity.id}/${auth.currentUser.uid}_${Date.now()}.${ext}`;
      const storageRef = ref(storage, path);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, blob, { contentType });
        task.on('state_changed', () => {}, reject, () => resolve());
      });
      const videoUrl = await getDownloadURL(storageRef);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await addDoc(collection(db, 'activityMemories'), {
        activityId: activity.id,
        activityTitle: activity.title,
        videoUrl,
        userId: auth.currentUser!.uid,
        userName,
        userPhoto: userPhoto || null,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt),
        latitude: activity.latitude,
        longitude: activity.longitude,
      });
      Alert.alert('Success', 'Memory added! Visible to everyone within 50km for 24 hours.');
    } catch (error: any) {
      console.error('Error adding memory:', error);
    } finally {
      setUploadingMemory(false);
    }
  };

  const getMemoriesForActivity = (activityId: string) =>
    memories.filter((m) => m.activityId === activityId).sort((a, b) => {
      const at = a.createdAt?.toDate?.() ?? new Date(a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
      const bt = b.createdAt?.toDate?.() ?? new Date(b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
      return at.getTime() - bt.getTime();
    });

  const openMemoryViewer = (activityId: string) => {
    setMemoryViewerActivityId(activityId);
    setMemoryViewerIndex(0);
    setMemoryViewerVisible(true);
  };

  const fetchParticipantsData = async (participantIds: string[]) => {
    setLoadingParticipants(true);
    try {
      const participants: ParticipantData[] = [];
      await Promise.all(
        participantIds.map(async (userId) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', userId));
            if (userDoc.exists()) {
              const userData = userDoc.data();
              participants.push({
                userId,
                username: userData.username || userData.displayName || 'Unknown',
                profilePic: userData.profilePic,
              });
            } else {
              participants.push({
                userId,
                username: 'Unknown',
              });
            }
          } catch (error) {
            console.error(`Error fetching user ${userId}:`, error);
            participants.push({
              userId,
              username: 'Unknown',
            });
          }
        })
      );
      setParticipantsData(participants);
    } catch (error) {
      console.error('Failed to load participants:', error);
    } finally {
      setLoadingParticipants(false);
      }
    };

  const handleShowParticipants = async (activity: Activity) => {
    if (activity.participants.length === 0) {
      Alert.alert('Info', 'No participants yet.');
      return;
    }
    await fetchParticipantsData(activity.participants);
    setShowParticipantsList(true);
  };

  const handleParticipantPress = (userId: string) => {
    setShowParticipantsList(false);
    navigation.navigate('UserProfileScreen', { userId });
  };

  const handleActivityPress = (activity: Activity) => {
    setSelectedActivity(activity);
    setShowActivitiesList(false); // Close the bottom sheet
    setFollowUser(false); // Disable follow when viewing activity
    followUserRef.current = false;
    
    const activityRegion: Region = {
      latitude: activity.latitude,
      longitude: activity.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    
    setRegion(activityRegion);
    
    if (mapRef.current) {
      isProgrammaticUpdateRef.current = true;
      mapRef.current.animateToRegion(activityRegion, 1000);
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'food-and-drinks': return 'restaurant';
      case 'night-life': return 'wine';
      case 'outdoor': return 'leaf';
      case 'sightseeing': return 'camera';
      case 'entertainment': return 'musical-notes';
      case 'shopping': return 'bag';
      case 'wellness': return 'heart';
      case 'social': return 'people';
      case 'fitness': return 'barbell';
      case 'other': return 'ellipse';
      default: return 'location';
    }
  };

  /** Outline variants for use in strips/cards where filled icons may not render (e.g. TabView) */
  const getActivityIconOutline = (type: string): keyof typeof Ionicons.glyphMap => {
    const outlineMap: Record<string, keyof typeof Ionicons.glyphMap> = {
      'food-and-drinks': 'restaurant-outline',
      'night-life': 'wine-outline',
      'outdoor': 'leaf-outline',
      'sightseeing': 'camera-outline',
      'entertainment': 'musical-notes-outline',
      'shopping': 'bag-outline',
      'wellness': 'heart-outline',
      'social': 'people-outline',
      'fitness': 'barbell-outline',
      'other': 'ellipse-outline',
    };
    return outlineMap[type] ?? 'location-outline';
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'food-and-drinks': return '#FF6B6B';
      case 'night-life': return '#9B59B6';
      case 'outdoor': return '#27AE60';
      case 'sightseeing': return '#3498DB';
      case 'entertainment': return '#E74C3C';
      case 'shopping': return '#F39C12';
      case 'wellness': return '#1ABC9C';
      case 'social': return '#E91E63';
      case 'fitness': return '#2ECC71';
      case 'other': return '#95A5A6';
      default: return '#95A5A6';
    }
  };

  const getActivityTypeLabel = (type: ActivityType): string => {
    switch (type) {
      case 'food-and-drinks': return 'Food and Drinks';
      case 'night-life': return 'Night life';
      case 'outdoor': return 'Outdoor';
      case 'sightseeing': return 'Sightseeing';
      case 'entertainment': return 'Entertainment';
      case 'shopping': return 'Shopping';
      case 'wellness': return 'Wellness';
      case 'social': return 'Social';
      case 'fitness': return 'Fitness';
      case 'other': return 'Other';
      default: return 'Other';
    }
  };

  const testAPIKey = async () => {
    const API_KEY = 'AIzaSyDR5JhBnTT53KmUwNQI6QcWG5RjY5sdYRM';
    try {
      // Test with Static Maps API (simpler than full Maps SDK)
      const testUrl = `https://maps.googleapis.com/maps/api/staticmap?center=Brooklyn+Bridge,New+York,NY&zoom=13&size=600x300&maptype=roadmap&key=${API_KEY}`;
      
      const response = await fetch(testUrl);
      const contentType = response.headers.get('content-type');
      
      if (contentType && contentType.includes('image')) {
        Alert.alert(
          '✅ Static Maps API Works',
          'Static Maps API is enabled, but you need Maps SDK for Android for the map to work.\n\nEnable this API:\nhttps://console.cloud.google.com/apis/library/maps-android-backend.googleapis.com?project=communitychat-f3fb0\n\nThen restart the app.'
        );
      } else {
        const text = await response.text();
        if (text.includes('REQUEST_DENIED') || text.includes('permission') || text.includes('not activated')) {
          Alert.alert(
            '❌ API Not Enabled',
            'You need to enable Maps SDK for Android (NOT JavaScript API).\n\nDirect link:\nhttps://console.cloud.google.com/apis/library/maps-android-backend.googleapis.com?project=communitychat-f3fb0\n\nClick ENABLE, wait 30 seconds, then restart app.'
          );
        } else if (text.includes('OVER_QUERY_LIMIT')) {
          Alert.alert(
            '⚠️ Quota Exceeded',
            'API quota has been exceeded.\n\nCheck your usage in Google Cloud Console and ensure billing is enabled.'
          );
        } else {
          Alert.alert(
            '❌ API Key Error',
            `Error: ${text.substring(0, 200)}\n\nEnable Maps SDK for Android:\nhttps://console.cloud.google.com/apis/library/maps-android-backend.googleapis.com?project=communitychat-f3fb0`
          );
        }
      }
    } catch (error: any) {
      Alert.alert(
        '❌ Network Error',
        `Failed to test API key: ${error.message}\n\nCheck your internet connection.`
      );
    }
  };

  /** Map content (MapView + markers) - shared so we can render it in Map tab (interactive) or as background (My activities) */
  const renderMapContent = (isInteractive: boolean) => (
    <MapView
      ref={isInteractive ? mapRef : undefined}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFillObject}
      initialRegion={region}
      customMapStyle={theme === 'dark' ? MAP_DARK_STYLE : undefined}
      onRegionChangeComplete={(newRegion) => {
        if (!isProgrammaticUpdateRef.current) {
          setFollowUser(false);
          followUserRef.current = false;
        }
        isProgrammaticUpdateRef.current = false;
      }}
      onPanDrag={() => {
        setFollowUser(false);
        followUserRef.current = false;
      }}
      onPress={() => {
        setFollowUser(false);
        followUserRef.current = false;
      }}
      showsUserLocation={true}
      showsMyLocationButton={false}
      showsCompass
      followsUserLocation={false}
      scrollEnabled={isInteractive}
      zoomEnabled={isInteractive}
      pitchEnabled={isInteractive}
      rotateEnabled={isInteractive}
      onMapReady={() => {
        if (isInteractive) {
          console.log('✅ Map is ready - API key is working!');
          // Map already opens with correct region (set before loading=false); recenter only via button
        }
      }}
    >
      {activitiesForMap.map((activity) => (
        <Marker
          key={activity.id}
          coordinate={{
            latitude: activity.latitude,
            longitude: activity.longitude,
          }}
          onPress={() => setSelectedActivity(activity)}
        >
          <View style={[localStyles.markerContainer, { backgroundColor: getActivityColor(activity.activityType) }]}>
            <Ionicons name={getActivityIcon(activity.activityType) as any} size={24} color="#FFFFFF" />
          </View>
          <Callout onPress={() => setSelectedActivity(activity)}>
            <View style={localStyles.calloutContainer}>
              <Text style={[localStyles.calloutTitle, { color: colors.text }]}>{activity.title}</Text>
              <Text style={[localStyles.calloutText, { color: colors.textSecondary }]}>
                {getActivityTypeLabel(activity.activityType)} • {activity.participants.length} {activity.participants.length === 1 ? 'person' : 'people'}
              </Text>
              {activity.distance !== undefined && (
                <Text style={[localStyles.calloutText, { color: colors.textSecondary }]}>
                  {activity.distance} km away
                </Text>
              )}
              <Text style={[localStyles.calloutText, { color: colors.textSecondary }]}>
                by {activity.createdByName}
              </Text>
            </View>
          </Callout>
        </Marker>
      ))}
      {/* Highlight marker when user taps "View on map" from a memory */}
      {highlightedMemoryLocation && (
        <Marker
          coordinate={highlightedMemoryLocation}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={[localStyles.memoryHighlightMarker]} />
        </Marker>
      )}
    </MapView>
  );

  /** Map as non-interactive background (only when My activities tab is active so list shows over it) */
  const renderMapBackground = () => (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {renderMapContent(false)}
    </View>
  );

  const DRAG_THRESHOLD = 40;
  const goToMyActivitiesPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 10,
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx < -DRAG_THRESHOLD || (Math.abs(gestureState.dx) < 15 && Math.abs(gestureState.dy) < 15)) {
            setTabIndex(1);
          }
        },
      }),
    []
  );

  /** Map tab: map is inside the scene so it receives touches (pan, pinch, zoom); FABs on top. Only render map when this tab is active to avoid duplicate MapViews. */
  const MapRoute = () => {
    if (tabIndex !== 0) {
      return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;
    }
    return (
      <View style={{ flex: 1 }}>
        <View style={StyleSheet.absoluteFillObject}>
          {renderMapContent(true)}
        </View>
        {myActivities.length > 0 && (
          <View style={[localStyles.cameraFabContainer, { bottom: fabBottom }]} pointerEvents="box-none">
            <TouchableOpacity
              style={[localStyles.actionButton, { backgroundColor: colors.primary }]}
              onPress={handleAddMemoryFromMap}
            >
              <Ionicons name="camera" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}
        <View style={[localStyles.actionButtons, { bottom: fabBottom }]} pointerEvents="box-none">
          <TouchableOpacity
            style={[localStyles.actionButton, { backgroundColor: colors.primary }]}
            onPress={() => setShowCreateActivity(true)}
          >
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[localStyles.actionButton, { backgroundColor: colors.primary, marginTop: 10 }]}
            onPress={centerOnUser}
          >
            <Ionicons name="locate" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[localStyles.actionButton, { backgroundColor: colors.primary, marginTop: 10 }]}
            onPress={() => setShowActivitiesList(true)}
          >
            <Ionicons name="list" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const activityIdsWithMemoriesCount = Array.from(new Set(memories.map((m) => m.activityId))).length;
  const myActivitiesTopPadding = activityIdsWithMemoriesCount > 0 ? MEMORIES_STRIP_HEIGHT : 0;

  const MyActivitiesRoute = () => (
    <View style={{ flex: 1, backgroundColor: 'transparent', paddingTop: myActivitiesTopPadding }}>
      {myActivities.length === 0 ? (
        <View style={[localStyles.emptyContainer, { backgroundColor: 'transparent' }]}>
          <Ionicons name="calendar-outline" size={64} color={colors.textSecondary} />
          <Text style={[localStyles.emptyText, { color: colors.text }]}>
            You haven't joined any activities yet
          </Text>
          <Text style={[localStyles.emptySubtext, { color: colors.textSecondary }]}>
            Join an activity from the map to see its group chat here
          </Text>
        </View>
      ) : (
        <FlatList
          data={myActivities}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 12, paddingBottom: 100 }}
          style={{ backgroundColor: 'transparent' }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[localStyles.activityCard, { backgroundColor: colors.card }]}
              onPress={() =>
                navigation.navigate('ActivityChatScreen', {
                  activityId: item.id,
                  activityTitle: item.title,
                })
              }
              activeOpacity={0.7}
            >
              {(unreadByActivityId[item.id] ?? 0) > 0 && (
                <View style={localStyles.unreadBadge}>
                  <Text style={localStyles.unreadBadgeText}>
                    {unreadByActivityId[item.id]! > 99 ? '99+' : unreadByActivityId[item.id]}
                  </Text>
                </View>
              )}
              <View style={[localStyles.activityIconContainer, { backgroundColor: getActivityColor(item.activityType) }]}>
                <Ionicons name={getActivityIcon(item.activityType) as any} size={24} color="#FFFFFF" />
              </View>
              <View style={localStyles.activityCardContent}>
                <Text style={[localStyles.activityCardTitle, { color: colors.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[localStyles.activityCardText, { color: colors.textSecondary }]}>
                  {getActivityTypeLabel(item.activityType)} • {item.participants.length} participants
                </Text>
                {item.location && (
                  <Text style={[localStyles.activityCardText, { color: colors.textSecondary }]} numberOfLines={1}>
                    {item.location}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );

  const renderScene = SceneMap({
    map: MapRoute,
    'my-activities': MyActivitiesRoute,
  });

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      {/* Map as background only when My activities tab is active (so list shows over it) */}
      {tabIndex === 1 && renderMapBackground()}

      {/* Right-side button: tap or drag left to open My activities (screen right edge, only on Map tab) */}
      {tabIndex === 0 && (
        <View
          style={[localStyles.myActivitiesTabHandle, { backgroundColor: colors.primary }]}
          {...goToMyActivitiesPanResponder.panHandlers}
        >
          <View style={localStyles.myActivitiesTabHandleInner}>
            <Ionicons name="chevron-forward" size={28} color="#FFFFFF" />
          </View>
        </View>
      )}

      {/* Tabs (Map | My activities) with memories strip below the tab bar, not part of it */}
      <TabView
        navigationState={{ index: tabIndex, routes: tabRoutes }}
        renderScene={renderScene}
        onIndexChange={setTabIndex}
        swipeEnabled
        initialLayout={{ width: Dimensions.get('window').width }}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        renderTabBar={(props) => {
          const activityIdsWithMemories = Array.from(new Set(memories.map((m) => m.activityId)));
          return (
            <View style={{ backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.borderColor }}>
              <TabBar
                {...props}
                style={{ backgroundColor: 'transparent', elevation: 0 }}
                indicatorStyle={{ height: 3, backgroundColor: colors.primary }}
                activeColor={colors.primary}
                inactiveColor={colors.secondaryText}
              />
              {activityIdsWithMemories.length > 0 && (
                <View
                  style={[
                    localStyles.memoriesStripBelowTabs,
                    { backgroundColor: 'transparent', borderBottomColor: colors.borderColor },
                  ]}
                  pointerEvents="box-none"
                >
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={localStyles.memoriesStripContent} style={{ backgroundColor: 'transparent' }}>
                    {activityIdsWithMemories.map((activityId) => {
                      const activity = activities.find((a) => a.id === activityId);
                      const count = memories.filter((m) => m.activityId === activityId).length;
                      return (
                        <TouchableOpacity
                          key={activityId}
                          style={localStyles.memoryRing}
                          onPress={() => openMemoryViewer(activityId)}
                          activeOpacity={0.8}
                        >
                          <View style={[localStyles.memoryRingInner, { borderColor: colors.primary, backgroundColor: getActivityColor(activity?.activityType || 'other') }]}>
                            <Ionicons name={getActivityIconOutline(activity?.activityType || 'other')} size={28} color="#FFFFFF" />
                          </View>
                          {count > 1 && (
                            <View style={localStyles.memoryCountBadge}>
                              <Text style={localStyles.memoryCountText}>{count}</Text>
                            </View>
                          )}
                          <Text style={[localStyles.memoryRingLabel, { color: colors.text, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }]} numberOfLines={1}>
                            {activity?.title || memories.find((m) => m.activityId === activityId)?.activityTitle || 'Activity'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </View>
          );
        }}
      />

      {/* Loading overlay */}
      {loading && tabIndex === 0 && (
        <View style={localStyles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[localStyles.loadingText, { color: colors.text }]}>
            Loading map...
          </Text>
              </View>
            )}

      {/* Activity detail modal */}
      <Modal
        visible={selectedActivity !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedActivity(null)}
      >
        <View style={localStyles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setSelectedActivity(null)}
          />
          <View
            style={[localStyles.bottomSheetContent, { backgroundColor: colors.card }]}
            onStartShouldSetResponder={() => true}
          >
            {/* Handle bar */}
            <View style={localStyles.handleBar} />
            
            {selectedActivity && (
              <>
                {/* Header */}
                <View style={[localStyles.listHeader, { backgroundColor: colors.card }]}>
                  <Text style={[localStyles.modalTitle, { color: colors.text, marginBottom: 0 }]}>
                    {selectedActivity.title}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedActivity(null)}
                    style={localStyles.closeIconButton}
                  >
                    <Ionicons name="close" size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {/* Content */}
                <ScrollView
                  contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={[localStyles.modalText, { color: colors.textSecondary }]}>
                    Type: {getActivityTypeLabel(selectedActivity.activityType)}
                  </Text>
                  {selectedActivity.startTime && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                      <Text style={[localStyles.modalText, { color: colors.textSecondary, marginLeft: 8 }]}>
                        Start: {selectedActivity.startTime.toDate ? selectedActivity.startTime.toDate().toLocaleString() : new Date(selectedActivity.startTime.seconds * 1000).toLocaleString()}
                      </Text>
                    </View>
                  )}
                  {selectedActivity.endTime && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                      <Text style={[localStyles.modalText, { color: colors.textSecondary, marginLeft: 8 }]}>
                        End: {selectedActivity.endTime.toDate ? selectedActivity.endTime.toDate().toLocaleString() : new Date(selectedActivity.endTime.seconds * 1000).toLocaleString()}
                </Text>
                    </View>
                  )}
                  {selectedActivity.location && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                      <Text style={[localStyles.modalText, { color: colors.textSecondary, marginLeft: 8, flex: 1 }]}>
                        Location: {selectedActivity.location}
                </Text>
                    </View>
                  )}
                  {selectedActivity.distance !== undefined && (
                    <Text style={[localStyles.modalText, { color: colors.textSecondary }]}>
                      Distance: {selectedActivity.distance} km away
                  </Text>
                )}
                  <Text style={[localStyles.modalText, { color: colors.textSecondary }]}>
                    Created by: {selectedActivity.createdByName}
                </Text>
                  <TouchableOpacity
                    onPress={() => handleShowParticipants(selectedActivity)}
                    style={{ marginBottom: 8 }}
                  >
                    <Text style={[localStyles.modalText, { color: colors.primary }]}>
                      Participants: {selectedActivity.participants.length} (tap to view)
                    </Text>
                  </TouchableOpacity>
                </ScrollView>

                {/* Creator: Delete activity; Others: Join activity; Participants: Add memory - Fixed at bottom */}
                {auth.currentUser && (
                  <View style={[localStyles.modalButtonRow, { borderTopWidth: 1, borderTopColor: '#E0E0E0' }]}>
                    <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                      {selectedActivity.createdBy === auth.currentUser.uid && (
                        <TouchableOpacity
                          style={[localStyles.joinButton, { backgroundColor: '#DC3545', marginTop: 0, flex: 1, minWidth: 120 }]}
                          onPress={() => handleDeleteActivity(selectedActivity)}
                        >
                          <Text style={localStyles.joinButtonText}>Delete activity</Text>
                        </TouchableOpacity>
                      )}
                      {!selectedActivity.participants.includes(auth.currentUser.uid) ? (
                        <TouchableOpacity
                          style={[localStyles.joinButton, { backgroundColor: colors.primary, marginTop: 0, flex: 1, minWidth: 120 }]}
                          onPress={() => handleJoinActivity(selectedActivity)}
                        >
                          <Text style={localStyles.joinButtonText}>Join Activity</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={[localStyles.joinButton, { backgroundColor: colors.primary, marginTop: 0, flex: 1, minWidth: 120 }]}
                          onPress={() => handleAddMemory(selectedActivity)}
                          disabled={uploadingMemory}
                        >
                          {uploadingMemory ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Text style={localStyles.joinButtonText}>Add memory</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Participants list modal */}
      <Modal
        visible={showParticipantsList}
        transparent
        animationType="slide"
        onRequestClose={() => setShowParticipantsList(false)}
      >
        <View style={localStyles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowParticipantsList(false)}
          />
          <View
            style={[localStyles.bottomSheetContent, { backgroundColor: colors.card }]}
            onStartShouldSetResponder={() => true}
          >
            {/* Handle bar */}
            <View style={localStyles.handleBar} />
            
            {/* Header */}
            <View style={[localStyles.listHeader, { backgroundColor: colors.card }]}>
              <Text style={[localStyles.listHeaderText, { color: colors.text }]}>
                Participants ({participantsData.length})
            </Text>
              <TouchableOpacity
                onPress={() => setShowParticipantsList(false)}
                style={localStyles.closeIconButton}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
          </View>

            {/* Participants list */}
            {loadingParticipants ? (
              <View style={localStyles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[localStyles.loadingText, { color: colors.text }]}>
                  Loading participants...
                </Text>
              </View>
            ) : participantsData.length === 0 ? (
              <View style={localStyles.emptyContainer}>
                <Ionicons name="people-outline" size={64} color={colors.textSecondary} />
                <Text style={[localStyles.emptyText, { color: colors.textSecondary }]}>
                  No participants found
                </Text>
              </View>
            ) : (
              <FlatList
                data={participantsData}
                keyExtractor={(item) => item.userId}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[localStyles.participantCard, { backgroundColor: colors.card }]}
                    onPress={() => handleParticipantPress(item.userId)}
                  >
                    {item.profilePic ? (
                      <Image
                        source={{ uri: item.profilePic }}
                        style={localStyles.participantAvatar}
                      />
                    ) : (
                      <View style={[localStyles.participantAvatar, localStyles.participantAvatarFallback]}>
                        <Text style={localStyles.participantAvatarFallbackText}>
                          {item.username?.charAt(0).toUpperCase() || '?'}
          </Text>
        </View>
      )}
                    <Text style={[localStyles.participantName, { color: colors.text }]}>
                      {item.username}
                    </Text>
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
                contentContainerStyle={{ paddingBottom: 100 }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Memory viewer - full screen, tap to next/prev */}
      <Modal
        visible={memoryViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMemoryViewerVisible(false)}
      >
        <View style={localStyles.memoryViewerOverlay}>
          {memoryViewerActivityId && (() => {
            const list = getMemoriesForActivity(memoryViewerActivityId);
            const current = list[memoryViewerIndex];
            const activity = activities.find((a) => a.id === memoryViewerActivityId);
            if (list.length === 0 || !current) {
              return (
                <View style={localStyles.memoryViewerContent}>
                  <TouchableOpacity style={localStyles.memoryCloseBtn} onPress={() => setMemoryViewerVisible(false)}>
                    <Ionicons name="close" size={32} color="#FFF" />
                  </TouchableOpacity>
                  <Text style={{ color: '#FFF', fontSize: 16 }}>No memories</Text>
                </View>
              );
            }
            return (
              <View style={localStyles.memoryViewerContent} pointerEvents="box-none">
                <TouchableOpacity
                  style={[localStyles.memoryViewerTouchZone, { left: 0 }]}
                  onPress={() => setMemoryViewerIndex((i) => (i > 0 ? i - 1 : list.length - 1))}
                />
                <TouchableOpacity
                  style={[localStyles.memoryViewerTouchZone, { right: 0 }]}
                  onPress={() => setMemoryViewerIndex((i) => (i < list.length - 1 ? i + 1 : 0))}
                />
                <Video
                  key={current.id}
                  source={{ uri: current.videoUrl }}
                  style={localStyles.memoryVideo}
                  useNativeControls={false}
                  shouldPlay
                  isLooping={false}
                  resizeMode={ResizeMode.CONTAIN}
                  onPlaybackStatusUpdate={(status) => {
                    if (status.isLoaded && 'didJustFinishNotPlayIterating' in status && status.didJustFinishNotPlayIterating && !status.isPlaying) {
                      setMemoryViewerIndex((i) => (i < list.length - 1 ? i + 1 : 0));
                    }
                  }}
                />
                <View style={localStyles.memoryViewerHeader}>
                  <TouchableOpacity style={localStyles.memoryCloseBtn} onPress={() => setMemoryViewerVisible(false)}>
                    <Ionicons name="close" size={28} color="#FFF" />
                  </TouchableOpacity>
                  <Text style={localStyles.memoryViewerTitle} numberOfLines={1}>{activity?.title || current.activityTitle}</Text>
                </View>
                {/* Activity details + who added + location (emphasized, tappable) */}
                <View style={localStyles.memoryViewerDetails}>
                  {activity && (
                    <>
                      <Text style={localStyles.memoryViewerDetailLabel}>Activity</Text>
                      <Text style={localStyles.memoryViewerDetailValue}>{activity.title}</Text>
                      <Text style={localStyles.memoryViewerDetailLabel}>Type</Text>
                      <Text style={localStyles.memoryViewerDetailValue}>{getActivityTypeLabel(activity.activityType)}</Text>
                      {activity.location ? (
                        <>
                          <Text style={localStyles.memoryViewerDetailLabel}>Location</Text>
                          <Text style={localStyles.memoryViewerDetailValue}>{activity.location}</Text>
                        </>
                      ) : null}
                    </>
                  )}
                  <Text style={localStyles.memoryViewerDetailLabel}>Added by</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setMemoryViewerVisible(false);
                      navigation.navigate('UserProfileScreen', { userId: current.userId });
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={localStyles.memoryViewerDetailLink}>{current.userName}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={localStyles.memoryViewerMapLink}
                    onPress={() => {
                      setHighlightedMemoryLocation({ latitude: current.latitude, longitude: current.longitude });
                      setTabIndex(0);
                      setMemoryViewerVisible(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="location" size={18} color="#FFF" />
                    <Text style={localStyles.memoryViewerMapLinkText}>View on map</Text>
                  </TouchableOpacity>
                </View>
                <View style={localStyles.memoryViewerCaption}>
                  <Text style={localStyles.memoryViewerCaptionSub}>{memoryViewerIndex + 1} / {list.length}</Text>
                </View>
              </View>
            );
          })()}
        </View>
      </Modal>

      {/* Activities list bottom sheet */}
      <Modal
        visible={showActivitiesList}
        transparent
        animationType="slide"
        onRequestClose={() => setShowActivitiesList(false)}
      >
        <View style={localStyles.modalOverlay}>
        <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowActivitiesList(false)}
          />
          <View
            style={[localStyles.bottomSheetContent, { backgroundColor: colors.card }]}
            onStartShouldSetResponder={() => true}
          >
            {/* Handle bar */}
            <View style={localStyles.handleBar} />
            
            {/* Header */}
            <View style={[localStyles.listHeader, { backgroundColor: colors.card }]}>
              <Text style={[localStyles.listHeaderText, { color: colors.text }]}>
                {activitiesForMap.length} {activitiesForMap.length === 1 ? 'Activity' : 'Activities'} within 50km
            </Text>
              <TouchableOpacity
                onPress={() => setShowActivitiesList(false)}
                style={localStyles.closeIconButton}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
          </View>

            {/* Activities list */}
            {loading ? (
              <View style={localStyles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[localStyles.loadingText, { color: colors.text }]}>
                  Loading activities...
                </Text>
        </View>
            ) : activitiesForMap.length === 0 ? (
              <View style={localStyles.emptyContainer}>
                <Ionicons name="location-outline" size={64} color={colors.textSecondary} />
                <Text style={[localStyles.emptyText, { color: colors.textSecondary }]}>
                  No activities found within 50km
                </Text>
                <Text style={[localStyles.emptySubtext, { color: colors.textSecondary }]}>
                  Create one to get started!
                </Text>
              </View>
            ) : (
              <FlatList
                data={activitiesForMap}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[localStyles.activityCard, { backgroundColor: colors.card }]}
                    onPress={() => handleActivityPress(item)}
                  >
                    <View style={[localStyles.activityIconContainer, { backgroundColor: getActivityColor(item.activityType) }]}>
                      <Ionicons name={getActivityIcon(item.activityType) as any} size={24} color="#FFFFFF" />
                    </View>
                    <View style={localStyles.activityCardContent}>
                      <Text style={[localStyles.activityCardTitle, { color: colors.text }]}>{item.title}</Text>
                      <Text style={[localStyles.activityCardText, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.description || 'No description'}
                      </Text>
                      {item.startTime && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                          <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                          <Text style={[localStyles.activityCardMetaText, { color: colors.textSecondary, marginLeft: 4 }]}>
                            {item.startTime.toDate ? item.startTime.toDate().toLocaleString() : new Date(item.startTime.seconds * 1000).toLocaleString()}
                            {item.endTime && ` - ${item.endTime.toDate ? item.endTime.toDate().toLocaleString() : new Date(item.endTime.seconds * 1000).toLocaleString()}`}
          </Text>
        </View>
      )}
                      {item.location && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
                          <Text style={[localStyles.activityCardMetaText, { color: colors.textSecondary, marginLeft: 4, flex: 1 }]} numberOfLines={1}>
                            {item.location}
                          </Text>
                        </View>
                      )}
                      <View style={localStyles.activityCardMeta}>
                        <Text style={[localStyles.activityCardMetaText, { color: colors.textSecondary }]}>
                          {getActivityTypeLabel(item.activityType)}
                        </Text>
                        <Text style={[localStyles.activityCardMetaText, { color: colors.textSecondary }]}>
                          • {item.participants.length} {item.participants.length === 1 ? 'person' : 'people'}
                        </Text>
                      </View>
                      <View style={localStyles.activityCardFooter}>
                        <Text style={[localStyles.activityCardDistance, { color: colors.primary }]}>
                          {item.distance} km away
                        </Text>
                        <Text style={[localStyles.activityCardCreator, { color: colors.textSecondary }]}>
                          by {item.createdByName}
                        </Text>
                      </View>
                    </View>
                    {auth.currentUser && !item.participants.includes(auth.currentUser.uid) && (
        <TouchableOpacity
                        style={[localStyles.joinButtonSmall, { backgroundColor: colors.primary }]}
                        onPress={() => {
                          handleJoinActivity(item);
                        }}
                      >
                        <Ionicons name="person-add" size={20} color="#FFFFFF" />
        </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                )}
                contentContainerStyle={{ paddingBottom: 100 }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Create activity modal */}
      <Modal
        visible={showCreateActivity}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateActivity(false)}
        onShow={() => {
          // Reset form when modal opens
          const now = new Date();
          setActivityDate(now);
          setActivityTime(now);
          setActivityDateInput(now.toISOString().split('T')[0]);
          setActivityTimeInput(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
          // Set end date/time to 2 hours after start by default
          const endDateTime = new Date(now);
          endDateTime.setHours(endDateTime.getHours() + 2);
          setActivityEndDate(endDateTime);
          setActivityEndTime(endDateTime);
          setActivityEndDateInput(endDateTime.toISOString().split('T')[0]);
          setActivityEndTimeInput(`${endDateTime.getHours().toString().padStart(2, '0')}:${endDateTime.getMinutes().toString().padStart(2, '0')}`);
          setActivityLocation('');
          setSelectedPlaceId(null);
          setLocationSuggestions([]);
          setShowLocationSuggestions(false);
        }}
      >
        <View style={localStyles.modalOverlay}>
        <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowCreateActivity(false)}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1, justifyContent: 'flex-end' }}
          >
            <View
              style={[localStyles.bottomSheetContent, { backgroundColor: colors.card }]}
              onStartShouldSetResponder={() => true}
            >
              {/* Handle bar */}
              <View style={localStyles.handleBar} />
              
              {/* Header */}
              <View style={[localStyles.listHeader, { backgroundColor: colors.card }]}>
                <Text style={[localStyles.modalTitle, { color: colors.text }]}>Create Activity</Text>
                <TouchableOpacity
                  onPress={() => setShowCreateActivity(false)}
                  style={localStyles.closeIconButton}
                >
                  <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
              </View>

              <ScrollView
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                <Text style={[localStyles.label, { color: colors.text }]}>I want to *</Text>
                <TextInput
                  style={[localStyles.input, { backgroundColor: colors.background, color: colors.text }]}
                  value={activityTitle}
                  onChangeText={setActivityTitle}
                  placeholder="go for Dinner, a jog, a movie, a hike, a drink, etc."
                  placeholderTextColor={colors.textSecondary}
                />

                <Text style={[localStyles.label, { color: colors.text }]}>Date & Time *</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[localStyles.input, { backgroundColor: colors.background, color: colors.text, paddingRight: 40 }]}
                      value={activityDateInput || activityDate.toISOString().split('T')[0]}
                      onChangeText={(text) => {
                        // Update input value immediately for editing
                        setActivityDateInput(text);
                        // Try to parse and update date if valid
                        if (text.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          const newDate = new Date(text);
                          if (!isNaN(newDate.getTime())) {
                            setActivityDate(newDate);
                          }
                        }
                      }}
                      onBlur={() => {
                        // Validate on blur - if invalid, reset to current date
                        if (!activityDateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          setActivityDateInput(activityDate.toISOString().split('T')[0]);
                        }
                      }}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numeric"
                    />
                    <View style={{ position: 'absolute', right: 12, top: 12, pointerEvents: 'none' }}>
                      <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[localStyles.input, { backgroundColor: colors.background, color: colors.text, paddingRight: 40 }]}
                      value={activityTimeInput || `${activityTime.getHours().toString().padStart(2, '0')}:${activityTime.getMinutes().toString().padStart(2, '0')}`}
                      onChangeText={(text) => {
                        // Update input value immediately for editing
                        setActivityTimeInput(text);
                        // Try to parse and update time if valid
                        if (text.match(/^\d{2}:\d{2}$/)) {
                          const [hours, minutes] = text.split(':').map(Number);
                          if (!isNaN(hours) && !isNaN(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                            const newTime = new Date(activityTime);
                            newTime.setHours(hours, minutes);
                            setActivityTime(newTime);
                          }
                        }
                      }}
                      onBlur={() => {
                        // Validate on blur - if invalid, reset to current time
                        if (!activityTimeInput.match(/^\d{2}:\d{2}$/)) {
                          setActivityTimeInput(`${activityTime.getHours().toString().padStart(2, '0')}:${activityTime.getMinutes().toString().padStart(2, '0')}`);
                        }
                      }}
                      placeholder="HH:MM"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numeric"
                    />
                    <View style={{ position: 'absolute', right: 12, top: 12, pointerEvents: 'none' }}>
                      <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
                    </View>
                  </View>
                </View>
                <Text style={[localStyles.label, { color: colors.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: -4, marginBottom: 8 }]}>
                  Format: Date (YYYY-MM-DD) and Time (HH:MM, 24-hour)
            </Text>

                <Text style={[localStyles.label, { color: colors.text }]}>End Date & Time *</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[localStyles.input, { backgroundColor: colors.background, color: colors.text, paddingRight: 40 }]}
                      value={activityEndDateInput || activityEndDate.toISOString().split('T')[0]}
                      onChangeText={(text) => {
                        setActivityEndDateInput(text);
                        if (text.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          const newDate = new Date(text);
                          if (!isNaN(newDate.getTime())) {
                            setActivityEndDate(newDate);
                          }
                        }
                      }}
                      onBlur={() => {
                        if (!activityEndDateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          setActivityEndDateInput(activityEndDate.toISOString().split('T')[0]);
                        }
                      }}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numeric"
                    />
                    <View style={{ position: 'absolute', right: 12, top: 12, pointerEvents: 'none' }}>
                      <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
          </View>
        </View>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[localStyles.input, { backgroundColor: colors.background, color: colors.text, paddingRight: 40 }]}
                      value={activityEndTimeInput || `${activityEndTime.getHours().toString().padStart(2, '0')}:${activityEndTime.getMinutes().toString().padStart(2, '0')}`}
                      onChangeText={(text) => {
                        setActivityEndTimeInput(text);
                        if (text.match(/^\d{2}:\d{2}$/)) {
                          const [hours, minutes] = text.split(':').map(Number);
                          if (!isNaN(hours) && !isNaN(minutes) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                            const newTime = new Date(activityEndTime);
                            newTime.setHours(hours, minutes);
                            setActivityEndTime(newTime);
                          }
                        }
                      }}
                      onBlur={() => {
                        if (!activityEndTimeInput.match(/^\d{2}:\d{2}$/)) {
                          setActivityEndTimeInput(`${activityEndTime.getHours().toString().padStart(2, '0')}:${activityEndTime.getMinutes().toString().padStart(2, '0')}`);
                        }
                      }}
                      placeholder="HH:MM"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numeric"
                    />
                    <View style={{ position: 'absolute', right: 12, top: 12, pointerEvents: 'none' }}>
                      <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
                    </View>
                  </View>
                </View>
                <Text style={[localStyles.label, { color: colors.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: -4, marginBottom: 8 }]}>
                  Format: Date (YYYY-MM-DD) and Time (HH:MM, 24-hour)
                </Text>

                <Text style={[localStyles.label, { color: colors.text }]}>Location *</Text>
                <View style={{ marginBottom: 8, zIndex: 1000 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, zIndex: 1000 }}>
                      <TextInput
                        style={[localStyles.input, { backgroundColor: colors.background, color: colors.text, marginBottom: 0 }]}
                        value={activityLocation}
                        onChangeText={handleLocationChange}
                        placeholder="Search for an address..."
                        placeholderTextColor={colors.textSecondary}
                        editable={!locationLoading}
                      />
                      {showLocationSuggestions && locationSuggestions.length > 0 && (
                        <View style={[localStyles.suggestionsContainer, { backgroundColor: colors.card, borderColor: colors.background }]}>
                          <FlatList
                            data={locationSuggestions}
                            keyExtractor={(item) => item.place_id}
                            renderItem={({ item }) => (
        <TouchableOpacity
                                style={[localStyles.suggestionItem, { borderBottomColor: colors.background }]}
                                onPress={() => handleSelectLocation(item)}
                              >
                                <Ionicons name="location-outline" size={20} color={colors.textSecondary} style={{ marginRight: 8 }} />
                                <Text style={[localStyles.suggestionText, { color: colors.text }]} numberOfLines={2}>
                                  {item.description}
                                </Text>
                              </TouchableOpacity>
                            )}
                            nestedScrollEnabled
                            keyboardShouldPersistTaps="handled"
                            style={{ maxHeight: 200 }}
                          />
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      style={[localStyles.input, { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, minWidth: 50 }]}
                      onPress={async () => {
                        if (!userLocation) {
                          Alert.alert('Error', 'Location not available. Please enable location permissions.');
                          return;
                        }
                        setLocationLoading(true);
                        try {
                          const address = await getLocationAddress(
                            userLocation.coords.latitude,
                            userLocation.coords.longitude
                          );
                          setActivityLocation(address);
                          setSelectedPlaceId(null);
                          setLocationSuggestions([]);
                          setShowLocationSuggestions(false);
                        } catch (error) {
                          Alert.alert('Error', 'Failed to get location address. Please enter it manually.');
                        } finally {
                          setLocationLoading(false);
                        }
                      }}
                      disabled={locationLoading || !userLocation}
        >
                      {locationLoading ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
          <Ionicons name="locate" size={24} color="#FFFFFF" />
                      )}
        </TouchableOpacity>
                  </View>
                </View>
                {locationLoading && (
                  <Text style={[localStyles.label, { color: colors.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: -4, marginBottom: 8 }]}>
                    Getting your current location...
                  </Text>
                )}

                <Text style={[localStyles.label, { color: colors.text }]}>Activity Type</Text>
                <View style={localStyles.activityTypeContainer}>
                  {(['food-and-drinks', 'night-life', 'outdoor', 'sightseeing', 'entertainment', 'shopping', 'wellness', 'social', 'fitness', 'other'] as ActivityType[]).map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        localStyles.activityTypeButton,
                        activityType === type && { backgroundColor: colors.primary },
                      ]}
                      onPress={() => setActivityType(type)}
                    >
                      <Text
                        style={[
                          localStyles.activityTypeText,
                          { color: activityType === type ? '#FFFFFF' : colors.text },
                        ]}
                      >
                        {getActivityTypeLabel(type)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 16, paddingHorizontal: 4 }}>
                  <Text style={{ fontSize: 16, color: colors.text, flex: 1 }}>
                    Only my friends can see this activity
                  </Text>
                  <Switch
                    value={activityFriendsOnly}
                    onValueChange={setActivityFriendsOnly}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                <TouchableOpacity
                  style={[localStyles.createButton, { backgroundColor: colors.primary }]}
                  onPress={handleCreateActivity}
                >
                  <Text style={localStyles.createButtonText}>Create Activity</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[localStyles.closeButton, { backgroundColor: colors.background }]}
                  onPress={() => setShowCreateActivity(false)}
                >
                  <Text style={[localStyles.closeButtonText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const localStyles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  listHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  listHeaderText: {
    fontSize: 16,
    fontWeight: '600',
  },
  activityCard: {
    flexDirection: 'row',
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    position: 'relative',
  },
  unreadBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#DC3545',
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    zIndex: 1,
  },
  unreadBadgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  activityIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityCardContent: {
    flex: 1,
  },
  activityCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  activityCardText: {
    fontSize: 14,
    marginBottom: 8,
  },
  activityCardMeta: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  activityCardMetaText: {
    fontSize: 12,
    marginRight: 4,
  },
  activityCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activityCardDistance: {
    fontSize: 14,
    fontWeight: '600',
  },
  activityCardCreator: {
    fontSize: 12,
  },
  joinButtonSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  fabButton: {
    position: 'absolute',
    bottom: 90,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  actionButtons: {
    position: 'absolute',
    bottom: 90,
    right: 20,
  },
  cameraFabContainer: {
    position: 'absolute',
    left: 20,
  },
  actionButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  myActivitiesTabHandle: {
    position: 'absolute',
    right: 0,
    top: '50%',
    marginTop: -32,
    width: 44,
    height: 64,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 8,
    zIndex: 20,
  },
  myActivitiesTabHandleInner: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  calloutContainer: {
    width: 200,
    padding: 8,
  },
  calloutTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  calloutText: {
    fontSize: 12,
    marginBottom: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '90%',
    flexDirection: 'column',
  },
  modalScrollContent: {
    flexGrow: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalText: {
    fontSize: 14,
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 8,
  },
  activityTypeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  activityTypeButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  activityTypeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  createButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  joinButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  joinButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonRow: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 12,
  },
  mapHeader: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    gap: 8,
  },
  mapHeaderTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  mapHeaderTabText: {
    fontSize: 15,
    fontWeight: '600',
  },
  memoriesStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  memoriesStripBelowTabs: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    minHeight: 88,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
  },
  memoriesStripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 12,
  },
  memoryRing: {
    alignItems: 'center',
    width: 72,
  },
  memoryRingInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
  },
  memoryCountBadge: {
    position: 'absolute',
    top: -4,
    right: 8,
    backgroundColor: '#DC3545',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memoryCountText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  memoryRingLabel: {
    fontSize: 11,
    marginTop: 4,
    maxWidth: 72,
    textAlign: 'center',
  },
  memoryViewerOverlay: {
    flex: 1,
    backgroundColor: '#000',
  },
  memoryViewerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memoryViewerTouchZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '35%',
    zIndex: 5,
  },
  memoryVideo: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    position: 'absolute',
  },
  memoryViewerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 10,
  },
  memoryCloseBtn: {
    padding: 8,
    marginRight: 8,
  },
  memoryViewerTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  memoryViewerDetails: {
    position: 'absolute',
    bottom: 88,
    left: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 14,
  },
  memoryViewerDetailLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 2,
  },
  memoryViewerDetailValue: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '500',
  },
  memoryViewerDetailLink: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  memoryViewerMapLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    gap: 6,
  },
  memoryViewerMapLinkText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  memoryViewerCaption: {
    position: 'absolute',
    bottom: 48,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  memoryViewerCaptionText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  memoryViewerCaptionSub: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    marginTop: 4,
  },
  memoryHighlightMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFF',
    borderWidth: 4,
    borderColor: '#FF6B6B',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  closeButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  bottomSheetContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: '#CCCCCC',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  closeIconButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    padding: 4,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 56, // Height of input + margin
    left: 0,
    right: 0,
    maxHeight: 200,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
    zIndex: 1001,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
  },
  suggestionText: {
    flex: 1,
    fontSize: 14,
  },
  participantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  participantAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  participantAvatarFallback: {
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  participantAvatarFallbackText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#666',
  },
  participantName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
});
