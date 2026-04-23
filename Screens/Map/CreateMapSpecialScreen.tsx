import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  FlatList,
  Image,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RootStackParamList } from '../../types';
import { db, storage } from '../../firebaseConfig';
import { useTheme } from '../context/ThemeContext';

type Nav = StackNavigationProp<RootStackParamList, 'CreateMapSpecialScreen'>;
type Route = RouteProp<RootStackParamList, 'CreateMapSpecialScreen'>;

type PlaceSuggestion = { place_id: string; description: string };

/** Weekdays in UTC (0 = Sunday … 6 = Saturday), matching Cloud Scheduler checks */
const UTC_WEEKDAY_CHIPS: { day: number; label: string }[] = [
  { day: 0, label: 'Sun' },
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
];

const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyDR5JhBnTT53KmUwNQI6QcWG5RjY5sdYRM';

export default function CreateMapSpecialScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const auth = getAuth();

  const biasFromMap = route.params ?? {};

  const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationAddress, setLocationAddress] = useState('');
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [locationSuggestions, setLocationSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dealImageUri, setDealImageUri] = useState<string | null>(null);
  const [dealTimeUtc, setDealTimeUtc] = useState('12:00');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || !mounted) return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (mounted) setUserLocation(loc);
      } catch (e) {
        console.warn('CreateMapSpecialScreen: location', e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /** Prefer live GPS; fall back to map region passed from Map for autocomplete bias */
  const biasCoords = (): { lat: number; lng: number } | null => {
    if (userLocation) {
      return { lat: userLocation.coords.latitude, lng: userLocation.coords.longitude };
    }
    if (
      typeof biasFromMap?.latitude === 'number' &&
      typeof biasFromMap?.longitude === 'number' &&
      !Number.isNaN(biasFromMap.latitude) &&
      !Number.isNaN(biasFromMap.longitude)
    ) {
      return { lat: biasFromMap.latitude, lng: biasFromMap.longitude };
    }
    return null;
  };

  const getLocationAddress = async (latitude: number, longitude: number): Promise<string> => {
    try {
      const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (addresses && addresses.length > 0) {
        const addr = addresses[0];
        const parts = [addr.name, addr.street, addr.city, addr.region, addr.postalCode, addr.country].filter(Boolean);
        return parts.join(', ') || 'Current location';
      }
      return 'Current location';
    } catch {
      return 'Current location';
    }
  };

  const fetchSuggestions = useCallback(async (text: string): Promise<PlaceSuggestion[]> => {
    if (!GOOGLE_KEY || !text.trim()) return [];

    let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
      text
    )}&key=${GOOGLE_KEY}`;

    const bias = biasCoords();
    if (bias) {
      url += `&location=${bias.lat},${bias.lng}&radius=50000&strictbounds=true`;
    }

    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.error_message) return [];
      return (data?.predictions || []).map((p: { place_id: string; description: string }) => ({
        place_id: p.place_id,
        description: p.description,
      }));
    } catch {
      return [];
    }
  }, [userLocation, biasFromMap?.latitude, biasFromMap?.longitude]);

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
    setLocationAddress(text);
    setSelectedPlaceId(null);
    if (text.trim().length > 1) {
      const results = await fetchSuggestions(text);
      setLocationSuggestions(results);
      setShowLocationSuggestions(results.length > 0);
    } else {
      setLocationSuggestions([]);
      setShowLocationSuggestions(false);
    }
  };

  const handleSelectLocation = (suggestion: PlaceSuggestion) => {
    setLocationAddress(suggestion.description);
    setSelectedPlaceId(suggestion.place_id);
    setLocationSuggestions([]);
    setShowLocationSuggestions(false);
  };

  const toggleDay = (day: number) => {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  };

  const handlePickDealImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo access to add a deal image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setDealImageUri(result.assets[0].uri);
  };

  const uploadDealImage = async (uid: string): Promise<string | null> => {
    if (!dealImageUri) return null;
    const response = await fetch(dealImageUri);
    const blob = await response.blob();
    const ext = dealImageUri.split('.').pop()?.toLowerCase() || 'jpg';
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const path = `map_specials/${uid}_${Date.now()}.${ext}`;
    const storageRef = ref(storage, path);
    await new Promise<void>((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, blob, { contentType });
      task.on('state_changed', () => {}, reject, () => resolve());
    });
    return getDownloadURL(storageRef);
  };

  const handleSubmit = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert('Sign in required', 'Please sign in to post a deal.');
      return;
    }
    const t = title.trim();
    if (!t) {
      Alert.alert('Title required', 'Enter a short title for your deal or special.');
      return;
    }
    if (!locationAddress.trim()) {
      Alert.alert('Location required', 'Search and select a place, or use the locate button (same as creating an activity).');
      return;
    }
    if (weekdays.length === 0) {
      Alert.alert('Days required', 'Choose at least one day (UTC) when this deal runs.');
      return;
    }
    const timeOk = /^([01]\d|2[0-3]):([0-5]\d)$/.test(dealTimeUtc.trim());
    if (!timeOk) {
      Alert.alert('Time required', 'Enter a valid UTC time in HH:MM format.');
      return;
    }

    const bias = biasCoords();
    if (!selectedPlaceId && !bias) {
      Alert.alert('Location unavailable', 'Enable location or choose a place from search.');
      return;
    }

    setSubmitting(true);
    try {
      let pinLat: number | undefined;
      let pinLng: number | undefined;
      if (selectedPlaceId) {
        const placeCoords = await getPlaceLatLng(selectedPlaceId);
        if (placeCoords) {
          pinLat = placeCoords.lat;
          pinLng = placeCoords.lng;
        }
      }
      if (pinLat == null || pinLng == null) {
        if (bias) {
          pinLat = bias.lat;
          pinLng = bias.lng;
        }
      }
      if (pinLat == null || pinLng == null) {
        Alert.alert('Location error', 'Could not determine map coordinates. Try another place or enable GPS.');
        return;
      }

      let resolvedAddress = locationAddress.trim();
      if (!resolvedAddress && bias) {
        resolvedAddress = await getLocationAddress(bias.lat, bias.lng);
      }
      if (!resolvedAddress) {
        resolvedAddress = 'Pinned location';
      }

      const userSnap = await getDoc(doc(db, 'users', uid));
      let creatorName = 'Someone';
      if (userSnap.exists()) {
        const d = userSnap.data();
        creatorName = (d.username || d.displayName || 'Someone') as string;
      }
      const imageUrl = await uploadDealImage(uid);

      await addDoc(collection(db, 'mapSpecials'), {
        title: t,
        description: description.trim(),
        location: resolvedAddress,
        ...(imageUrl ? { imageUrl } : {}),
        dealTimeUtc: dealTimeUtc.trim(),
        latitude: pinLat,
        longitude: pinLng,
        createdBy: uid,
        creatorName,
        weekdays,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      Alert.alert('Posted', 'Nearby users will get a reminder on each selected day (UTC).', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      console.error('Create map special failed', e);
      Alert.alert('Error', e?.message || 'Could not save. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Add location deal</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Search for the business or address so the deal is pinned correctly. Deal days use UTC.
        </Text>

        <Text style={[styles.label, { color: colors.text }]}>Title</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="e.g. Half-price coffee before 10am"
          placeholderTextColor={colors.textSecondary}
          value={title}
          onChangeText={setTitle}
          maxLength={120}
        />

        <Text style={[styles.label, { color: colors.text }]}>Details (optional)</Text>
        <TextInput
          style={[
            styles.input,
            styles.multiline,
            { backgroundColor: colors.card, color: colors.text, borderColor: colors.border },
          ]}
          placeholder="What users should know"
          placeholderTextColor={colors.textSecondary}
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={2000}
        />

        <Text style={[styles.label, { color: colors.text }]}>Deal photo (optional)</Text>
        {dealImageUri ? (
          <Image source={{ uri: dealImageUri }} style={styles.dealImagePreview} />
        ) : null}
        <View style={styles.photoActionsRow}>
          <TouchableOpacity
            style={[styles.photoActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handlePickDealImage}
          >
            <Ionicons name="image-outline" size={18} color={colors.text} />
            <Text style={[styles.photoActionText, { color: colors.text }]}>
              {dealImageUri ? 'Change photo' : 'Add photo'}
            </Text>
          </TouchableOpacity>
          {dealImageUri ? (
            <TouchableOpacity
              style={[styles.photoActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setDealImageUri(null)}
            >
              <Ionicons name="trash-outline" size={18} color="#DC3545" />
              <Text style={[styles.photoActionText, { color: '#DC3545' }]}>Remove</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={[styles.label, { color: colors.text }]}>Location *</Text>
        <View style={{ marginBottom: 8, zIndex: 1000 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, zIndex: 1000 }}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border, marginBottom: 0 }]}
                value={locationAddress}
                onChangeText={handleLocationChange}
                placeholder="Search for an address..."
                placeholderTextColor={colors.textSecondary}
                editable={!locationLoading}
              />
              {showLocationSuggestions && locationSuggestions.length > 0 && (
                <View style={[styles.suggestionsContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <FlatList
                    data={locationSuggestions}
                    keyExtractor={(item) => item.place_id}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[styles.suggestionItem, { borderBottomColor: colors.border }]}
                        onPress={() => handleSelectLocation(item)}
                      >
                        <Ionicons name="location-outline" size={20} color={colors.textSecondary} style={{ marginRight: 8 }} />
                        <Text style={[styles.suggestionText, { color: colors.text }]} numberOfLines={2}>
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
              style={[styles.locateBtn, { backgroundColor: colors.primary }]}
              onPress={async () => {
                const bias = biasCoords();
                if (!bias) {
                  Alert.alert('Location not available', 'Please enable location permissions.');
                  return;
                }
                setLocationLoading(true);
                try {
                  const address = await getLocationAddress(bias.lat, bias.lng);
                  setLocationAddress(address);
                  setSelectedPlaceId(null);
                  setLocationSuggestions([]);
                  setShowLocationSuggestions(false);
                } finally {
                  setLocationLoading(false);
                }
              }}
              disabled={locationLoading || !biasCoords()}
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
          <Text style={[styles.subtle, { color: colors.textSecondary }]}>Getting your current location...</Text>
        )}

        <Text style={[styles.label, { color: colors.text }]}>Deal time (UTC) *</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          value={dealTimeUtc}
          onChangeText={setDealTimeUtc}
          placeholder="HH:MM"
          placeholderTextColor={colors.textSecondary}
          keyboardType="numeric"
          maxLength={5}
        />
        <Text style={[styles.subtle, { color: colors.textSecondary, marginTop: 6 }]}>
          Users are notified about 1 hour before this UTC time.
        </Text>

        <Text style={[styles.label, { color: colors.text }]}>Active on these days (UTC)</Text>
        <View style={styles.chipsRow}>
          {UTC_WEEKDAY_CHIPS.map(({ day, label }) => {
            const on = weekdays.includes(day);
            return (
              <TouchableOpacity
                key={day}
                onPress={() => toggleDay(day)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? colors.primary : colors.card,
                    borderColor: on ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: on ? '#FFF' : colors.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.submit, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitText}>Post deal</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  subtle: { fontSize: 12, fontStyle: 'italic', marginTop: -4, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  dealImagePreview: {
    width: '100%',
    height: 190,
    borderRadius: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  photoActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 2,
  },
  photoActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  photoActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  locateBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    minWidth: 50,
    borderRadius: 12,
    minHeight: 48,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 52,
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
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  submit: {
    marginTop: 28,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
});
