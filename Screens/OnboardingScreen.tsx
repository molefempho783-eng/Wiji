import React, { useState, useRef } from "react";
import {
  SafeAreaView,
  Image,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Platform,
} from "react-native";
import PagerView from "react-native-pager-view";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../types";
import { useTheme } from "./context/ThemeContext";
import AsyncStorage from "@react-native-async-storage/async-storage";

type OnboardingScreenNavigationProp = StackNavigationProp<RootStackParamList, "OnboardingScreen">;

const { width, height } = Dimensions.get("window");

interface OnboardingSlide {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}

const onboardingData: OnboardingSlide[] = [
  {
    id: "1",
    icon: "people",
    title: "Communities",
    description: "Join communities that matter to you. Create groups, chat with members, and stay connected with your community.",
  },
  {
    id: "2",
    icon: "person-add",
    title: "Explore & Make Friends",
    description: "Explore to find people nearby, send friend requests, and start conversations. Make new friends and grow your network.",
  },
  {
    id: "3",
    icon: "chatbubbles",
    title: "Groups & chats",
    description: "Create groups inside communities, chat with members, and keep conversations organized.",
  },
  {
    id: "4",
    icon: "sparkles",
    title: "Ready to Get Started?",
    description: "Join others already using the app.",
  },
];

const OnboardingScreen = () => {
  const [currentPage, setCurrentPage] = useState(0);
  const pagerRef = useRef<PagerView>(null);
  const navigation = useNavigation<OnboardingScreenNavigationProp>();
  const { colors } = useTheme();

  const handleSkip = async () => {
    try {
      await AsyncStorage.setItem("@hasSeenOnboarding", "true");
      navigation.replace("AuthScreen");
    } catch (error) {
      console.error("Error saving onboarding status:", error);
      navigation.replace("AuthScreen");
    }
  };

  const handleNext = async () => {
    if (currentPage < onboardingData.length - 1) {
      pagerRef.current?.setPage(currentPage + 1);
    } else {
      // Last page - Get Started
      try {
        await AsyncStorage.setItem("@hasSeenOnboarding", "true");
        navigation.replace("AuthScreen");
      } catch (error) {
        console.error("Error saving onboarding status:", error);
        navigation.replace("AuthScreen");
      }
    }
  };

  const handlePageSelected = (e: any) => {
    setCurrentPage(e.nativeEvent.position);
  };

  const isLastPage = currentPage === onboardingData.length - 1;

  return (
    <LinearGradient
      colors={["#000000", "#1a1a2e", "#16213e", "#0f3460", "#533483"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.wrapper}
    >
      <SafeAreaView style={styles.container}>
        {/* Skip Button */}
        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={[styles.skipButtonText, { color: '#ffffff' }]}>Skip</Text>
        </TouchableOpacity>

        {/* Pager View for Swipeable Pages */}
        <PagerView
          ref={pagerRef}
          style={styles.pagerView}
          initialPage={0}
          onPageSelected={handlePageSelected}
        >
          {onboardingData.map((slide, index) => (
            <View key={slide.id} style={styles.page}>
              <View style={styles.contentContainer}>
                {/* Icon/Illustration */}
                <View style={styles.iconContainer}>
                  {slide.id === "5" ? (
                    // Show logo on last slide
                    <Image
                      source={require("../assets/logo.png")}
                      resizeMode="contain"
                      style={styles.logo}
                    />
                  ) : (
                    <View style={[styles.iconWrapper, { backgroundColor: `${colors.primary}20` }]}>
                      <Ionicons
                        name={slide.icon}
                        size={100}
                        color={colors.primary}
                      />
                    </View>
                  )}
                </View>

                {/* Title */}
                <Text style={[styles.title, { color: '#ffffff' }]}>{slide.title}</Text>

                {/* Description */}
                <Text style={[styles.description, { color: '#B0B0B0' }]}>
                  {slide.description}
                </Text>
              </View>
            </View>
          ))}
        </PagerView>

        {/* Page Indicators */}
        <View style={styles.indicatorsContainer}>
          {onboardingData.map((_, index) => (
            <View
              key={index}
              style={[
                styles.indicator,
                {
                  backgroundColor:
                    index === currentPage
                      ? colors.primary
                      : `${colors.textSecondary}40`,
                  width: index === currentPage ? 24 : 8,
                },
              ]}
            />
          ))}
        </View>

        {/* Next/Get Started Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={handleNext}>
            <LinearGradient
              colors={["#9C3FE4", "#C65647"]}
              style={styles.gradientButton}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={styles.buttonText}>
                {isLastPage ? "Get Started" : "Next"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  skipButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 50 : 30,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  skipButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
  pagerView: {
    flex: 1,
  },
  page: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  contentContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    paddingTop: 100,
  },
  iconContainer: {
    marginBottom: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapper: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 140,
    height: 140,
  },
  title: {
    fontSize: 30,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 20,
    paddingHorizontal: 20,
    color: '#ffffff',
  },
  description: {
    fontSize: 17,
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  indicatorsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 40,
    height: 10,
  },
  indicator: {
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  buttonContainer: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 40 : 30,
  },
  button: {
    width: "100%",
  },
  gradientButton: {
    borderRadius: 15,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "bold",
  },
});

export default OnboardingScreen;

