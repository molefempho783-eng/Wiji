// Google map that follows the app's light/dark mode. Use it instead of <MapView> everywhere.
import React, { forwardRef } from "react";
import MapView, { MapViewProps } from "react-native-maps";
import { useTheme } from "../Screens/context/ThemeContext";

/** Night style with Wiji's colours (dark navy roads, soft blue labels) */
export const MAP_DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1d1a2e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1d1a2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a86a6" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#c4b5fd" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#a79fd0" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1f3330" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6b9a76" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#34304a" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1a1729" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#a6a2bd" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#463f63" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1a1729" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#ddd6fe" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2b2840" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#c4b5fd" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#121a2e" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#5c7c9e" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#121a2e" }] },
];
// An empty style (not undefined) so switching back from dark actually resets the map on Android
const LIGHT_STYLE: any[] = [];

const ThemedMapView = forwardRef<MapView, MapViewProps>((props, ref) => {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return <MapView ref={ref} customMapStyle={dark ? MAP_DARK_STYLE : LIGHT_STYLE} userInterfaceStyle={dark ? "dark" : "light"} {...props} />;
});
ThemedMapView.displayName = "ThemedMapView";
export default ThemedMapView;
