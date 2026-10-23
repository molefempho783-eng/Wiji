import React, { useState } from "react";
import { 
  SafeAreaView, 
  Image, 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  Alert,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform 
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth, db } from "../firebaseConfig";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, setDoc } from "firebase/firestore";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../types";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { BRAND, BRAND_BG_GRADIENT, BRAND_BUTTON_GRADIENT } from "./context/brand";

type AuthScreenNavigationProp = StackNavigationProp<RootStackParamList, "AuthScreen">;

const AuthScreen = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isSignup, setIsSignup] = useState(true);
  const [error, setError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const navigation = useNavigation<AuthScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  

  const handleAuth = async () => {
    // ... (Your handleAuth logic is correct, no changes needed)
    try {
      if (isSignup) {
        if (!username.trim()) {
          setError("Username is required.");
          return;
        }
        if (!acceptedTerms || !acceptedPrivacy) {
          setError("You must accept the Terms and Privacy Policy to sign up.");
          return;
        }
        if (password.length < 6) {
          setError("Password must be at least 6 characters.");
          return;
        }

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await setDoc(doc(collection(db, "users"), user.uid), {
          username,
          email,
          uid: user.uid,
          createdAt: new Date(),
          termsAcceptedAt: new Date(),
          privacyAcceptedAt: new Date(),
          legalPolicyVersion: "2026-04-22",
        });

        Alert.alert("Success", "Account created successfully!");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        Alert.alert("Welcome!", "You have successfully logged in.");
      }

      setError("");
      navigation.navigate("Tabs", { screen: "CommunityScreen" });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const showResetSent = () =>
    Alert.alert(
      "Check your email",
      `If ${email.trim()} has a Wiji account, we've sent a link to reset your password. Open it, choose a new password, then sign in here.\n\nCan't find it? Check your spam folder.`,
      [{ text: "OK", onPress: () => { setShowForgotPassword(false); setIsSignup(false); setPassword(""); } }]
    );

  const handlePasswordReset = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError("Please enter a valid email address.");
      return;
    }

    setResetLoading(true);
    setError("");

    try {
      // Firebase emails a secure link; the user picks a new password on that page.
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      showResetSent();
    } catch (err: any) {
      const code = String(err?.code || "");
      if (code === "auth/user-not-found") {
        // Don't reveal whether an email has an account
        showResetSent();
      } else if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else if (code === "auth/network-request-failed") {
        setError("No internet connection. Check your connection and try again.");
      } else {
        setError("Couldn't send the reset email. Please try again.");
      }
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={[...BRAND_BG_GRADIENT]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.background}
    >
      {/* We use SafeAreaView here to avoid the status bar/notch */}
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
        >
          <ScrollView 
            contentContainerStyle={[styles.scrollContainer, { paddingTop: Math.max(insets.top + 40, 60) }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            
            {/* Logo */}
            <View style={{ alignItems: "center", marginBottom: 20 }}>
              <Image source={require("../assets/logo.png")} resizeMode="contain" style={{ width: 112, height: 112 }} accessibilityLabel="Wiji logo" />
              <Text style={styles.brandName}>wiji</Text>
              <Text style={styles.tagline}>
                {isSignup ? "Create your account to join communities, chat and find things to do near you." : "Welcome back."}
              </Text>
            </View>

            {/* Form Container */}
            <View style={styles.formContainer}>
              {isSignup && (
                <View style={{ width: "100%", marginBottom: 15 }}>
                  <TextInput
                    style={styles.input}
                    placeholder="Username"
                    placeholderTextColor="#A3A3A3"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                  />
                </View>
              )}

              <View style={{ width: "100%", marginBottom: 15 }}>
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor="#A3A3A3"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              {showForgotPassword ? (
                <Text style={{ color: BRAND.violetSoft, fontSize: 14, lineHeight: 20, marginBottom: 16, textAlign: "center" }}>
                  Enter the email you signed up with. We'll email you a link to choose a new password.
                </Text>
              ) : null}
              {!showForgotPassword && (
                <View style={{ width: "100%", marginBottom: 20 }}>
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#A3A3A3"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                  />
                </View>
              )}

              {error ? <Text style={{ color: "red", marginBottom: 10, textAlign: 'center' }}>{error}</Text> : null}

              {showForgotPassword ? (
                <>
                  <TouchableOpacity 
                    style={{ width: "100%", marginBottom: 20 }} 
                    onPress={handlePasswordReset}
                    disabled={resetLoading}
                  >
                    <LinearGradient 
                      colors={resetLoading ? ["#999", "#666"] : [...BRAND_BUTTON_GRADIENT]} 
                      style={{ borderRadius: 15, paddingVertical: 15, alignItems: "center" }}
                    >
                      <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "bold" }}>
                        {resetLoading ? "Sending..." : "Send reset link"}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => {
                    setShowForgotPassword(false);
                    setError("");
                  }}>
                    <Text style={{ color: BRAND.violetSoft, fontSize: 16, marginTop: 10 }}>
                      Back to Login
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {isSignup && (
                    <View style={styles.legalContainer}>
                      <View style={styles.legalRow}>
                        <TouchableOpacity onPress={() => setAcceptedTerms((prev) => !prev)}>
                          <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
                            {acceptedTerms ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                          </View>
                        </TouchableOpacity>
                        <Text style={styles.legalText}>I agree to the </Text>
                        <TouchableOpacity onPress={() => navigation.navigate("TermsAndConditionsScreen")}>
                          <Text style={styles.legalLink}>Terms and Conditions</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.legalRow}>
                        <TouchableOpacity onPress={() => setAcceptedPrivacy((prev) => !prev)}>
                          <View style={[styles.checkbox, acceptedPrivacy && styles.checkboxChecked]}>
                            {acceptedPrivacy ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                          </View>
                        </TouchableOpacity>
                        <Text style={styles.legalText}>I agree to the </Text>
                        <TouchableOpacity onPress={() => navigation.navigate("PrivacyPolicyScreen")}>
                          <Text style={styles.legalLink}>Privacy Policy</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  <TouchableOpacity style={{ width: "100%", marginBottom: 20 }} onPress={handleAuth}>
                    <LinearGradient colors={[...BRAND_BUTTON_GRADIENT]} style={{ borderRadius: 15, paddingVertical: 15, alignItems: "center" }}>
                      <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "bold" }}>{isSignup ? "Sign Up" : "Login"}</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  {!isSignup && (
                    <TouchableOpacity 
                      onPress={() => {
                        setShowForgotPassword(true);
                        setError("");
                      }}
                      style={{ marginBottom: 10 }}
                    >
                      <Text style={{ color: BRAND.violetSoft, fontSize: 14 }}>
                        Forgot Password?
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity onPress={() => setIsSignup(!isSignup)}>
                    <Text style={{ color: BRAND.violetSoft, fontSize: 16, marginTop: 10 }}>
                      {isSignup ? "Already have an account? Login" : "Don't have an account? Sign Up"}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  background: {
    flex: 1, 
  },
  container: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  formContainer: {
    alignItems: 'center',
    width: '100%',
  },
  input: {
    height: 52,
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: BRAND.ink,
  },
  brandName: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginTop: 12,
  },
  tagline: {
    color: BRAND.mutedOnInk,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 12,
  },
  legalContainer: {
    width: "100%",
    marginBottom: 16,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  legalRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: BRAND.violet,
    borderColor: BRAND.violet,
  },
  checkboxMark: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 11,
    lineHeight: 12,
  },
  legalText: {
    color: "#E5E7EB",
    fontSize: 13,
  },
  legalLink: {
    color: BRAND.mint,
    fontSize: 13,
    textDecorationLine: "underline",
  },
});

export default AuthScreen;