// Web-compatible stub for react-native-maps
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Stub components for react-native-maps on web
export const MapView = ({ children, style, ...props }: any) => (
  <View style={[styles.mapContainer, style]}>
    <View style={styles.placeholder}>
      <Text style={styles.placeholderText}>🗺️ Map View</Text>
      <Text style={styles.placeholderSubtext}>Map functionality available on mobile</Text>
    </View>
    {children}
  </View>
);

export const Marker = ({ coordinate, title, children, ...props }: any) => (
  <View style={styles.marker}>
    {children}
  </View>
);

export const Callout = ({ children, ...props }: any) => (
  <View style={styles.callout}>
    {children}
  </View>
);

export const PROVIDER_GOOGLE = 'google';

const styles = StyleSheet.create({
  mapContainer: {
    flex: 1,
    backgroundColor: '#e8e8e8',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  placeholderText: {
    fontSize: 24,
    marginBottom: 8,
  },
  placeholderSubtext: {
    fontSize: 14,
    color: '#666',
  },
  marker: {
    // Marker styling
  },
  callout: {
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 5,
    maxWidth: 200,
  },
});

export default MapView;
