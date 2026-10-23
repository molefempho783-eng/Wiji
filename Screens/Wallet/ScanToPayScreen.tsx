// Scan a driver's or shop's Wiji pay code (QR) to pay them.
import React, { useRef, useState } from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../../types";
import { uidFromPayCode } from "../../services/payments";
import { BRAND } from "../context/brand";

const ScanToPayScreen = () => {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState("");
  const handled = useRef(false);

  const onScan = ({ data }: { data: string }) => {
    if (handled.current) return;
    const payeeUid = uidFromPayCode(String(data || ""));
    if (!payeeUid) {
      setMessage("That's not a Wiji pay code. Ask the driver or shop to open their pay code in the Wallet tab.");
      return;
    }
    handled.current = true;
    navigation.replace("PayScreen", { payeeUid });
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {permission?.granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScan} />
      ) : null}

      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 12 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Close" style={styles.round}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", marginLeft: 12 }}>Scan to pay</Text>
        </View>

        {permission?.granted ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <View style={styles.frame} />
            <Text style={styles.hint}>{message || "Point your camera at a Wiji pay code"}</Text>
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
            <Ionicons name="camera-outline" size={48} color="#fff" />
            <Text style={[styles.hint, { marginTop: 16 }]}>Wiji needs your camera to scan pay codes.</Text>
            <TouchableOpacity onPress={requestPermission} style={styles.allow}>
              <Text style={{ color: BRAND.ink, fontWeight: "800", fontSize: 16 }}>Allow camera</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  frame: { width: 250, height: 250, borderRadius: 28, borderWidth: 4, borderColor: BRAND.mint },
  hint: { color: "#fff", fontSize: 15, textAlign: "center", marginTop: 24, paddingHorizontal: 32, lineHeight: 21 },
  allow: { marginTop: 20, backgroundColor: BRAND.mint, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28 },
});

export default ScanToPayScreen;
