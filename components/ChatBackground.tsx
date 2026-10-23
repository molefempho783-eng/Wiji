// components/ChatBackground.tsx
// WhatsApp-style doodle wallpaper behind chat messages, with South African doodles
// (protea, baobab, vuvuzela, braai, Table Mountain, minibus taxi, kota, mielie, rooibos,
// penguin, aloe, Ndebele-style diamond, rugby ball and more). The image is white line art
// on a transparent background, tinted per theme so it stays subtle in light and dark mode.
import React from "react";
import { ImageBackground, StyleSheet, View } from "react-native";
import { useTheme } from "../Screens/context/ThemeContext";

const ChatBackground = () => {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <ImageBackground
        source={require("../assets/chat-doodles.png")}
        resizeMode="repeat"
        style={StyleSheet.absoluteFill}
        imageStyle={{ tintColor: dark ? "#FFFFFF" : "#6C2BD9", opacity: dark ? 0.06 : 0.09 }}
      />
    </View>
  );
};

export default ChatBackground;
