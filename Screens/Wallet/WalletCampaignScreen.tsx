import React, { useCallback, useEffect } from "react";
import { Linking, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import createStyles from "../context/appStyles";

const CAMPAIGN_URL = "https://www.backabuddy.co.za/campaign/help-us-launch-square";

const WalletCampaignScreen = () => {
  const { colors } = useTheme();
  const globalStyles = createStyles(colors).global;

  const openCampaign = useCallback(async () => {
    try {
      const canOpen = await Linking.canOpenURL(CAMPAIGN_URL);
      if (canOpen) {
        await Linking.openURL(CAMPAIGN_URL);
      }
    } catch (error) {
      console.warn("Failed to open campaign URL:", error);
    }
  }, []);

  useEffect(() => {
    openCampaign();
  }, [openCampaign]);

  return (
    <SafeAreaView style={globalStyles.safeArea} edges={["top", "left", "right"]}>
      <View style={[globalStyles.flex1, { justifyContent: "center", alignItems: "center", padding: 24 }]}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
          Wallet Campaign
        </Text>
        <Text
          style={{
            color: colors.secondaryText,
            textAlign: "center",
            marginTop: 12,
            marginBottom: 20,
            lineHeight: 20,
          }}
        >
          Tap below if the campaign page did not open automatically.
        </Text>
        <TouchableOpacity
          onPress={openCampaign}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 12,
            paddingVertical: 12,
            paddingHorizontal: 20,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Open Campaign</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default WalletCampaignScreen;
