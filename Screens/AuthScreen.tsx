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
import { auth, db, app } from "../firebaseConfig";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { collection, doc, setDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { RootStackParamList } from "../types";
import { LinearGradient } from "expo-linear-gradient";

type AuthScreenNavigationProp = StackNavigationProp<RootStackParamList, "AuthScreen">;

const AuthScreen = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isSignup, setIsSignup] = useState(true);
  const [error, setError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const navigation = useNavigation<AuthScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  
  const functions = getFunctions(app, 'us-central1');

  const handleAuth = async () => {
    // ... (Your handleAuth logic is correct, no changes needed)
    try {
      if (isSignup) {
        if (!username.trim()) {
          setError("Username is required.");
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

  const handlePasswordReset = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError("Please enter a valid email address.");
      return;
    }

    setResetLoading(true);
    setError("");

    try {
      const resetPasswordFn = httpsCallable(functions, 'resetPassword');
      const result = await resetPasswordFn({ email: email.trim().toLowerCase() });
      const data = result.data as { success: boolean; message: string; password: string; emailSent?: boolean };

      // Always show the password - it's now always returned in the response
      if (data.password) {
        Alert.alert(
          data.emailSent ? "Password Reset - Check Email" : "Password Reset",
          `${data.message || 'Your new password has been generated.'}\n\nYour new password is:\n\n${data.password}\n\n⚠️ Please save this password and log in immediately!`,
          [
            {
              text: "Use This Password",
              onPress: () => {
                setPassword(data.password);
                setShowForgotPassword(false);
                // Switch to login mode
                setIsSignup(false);
              }
            },
            {
              text: "OK",
              onPress: () => {
                setPassword(data.password);
                setShowForgotPassword(false);
              }
            }
          ]
        );
      } else {
        // Fallback (shouldn't happen)
        Alert.alert(
          "Password Reset",
          data.message || "Password reset completed. Please check your email.",
          [
            {
              text: "OK",
              onPress: () => {
                setShowForgotPassword(false);
              }
            }
          ]
        );
      }
    } catch (err: any) {
      const errorMessage = err?.message || err?.code || "Failed to reset password. Please try again.";
      setError(errorMessage);
      Alert.alert("Error", errorMessage);
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={["#000000", "#1a1a2e", "#16213e", "#0f3460", "#533483"]}
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
              <Image source={require("../assets/logo.png")} resizeMode="contain" style={{ width: 200, height: 200 }} />
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
                      colors={resetLoading ? ["#999", "#666"] : ["#9C3FE4", "#C65647"]} 
                      style={{ borderRadius: 15, paddingVertical: 15, alignItems: "center" }}
                    >
                      <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "bold" }}>
                        {resetLoading ? "Sending..." : "Send New Password"}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => {
                    setShowForgotPassword(false);
                    setError("");
                  }}>
                    <Text style={{ color: "#007bff", fontSize: 16, marginTop: 10 }}>
                      Back to Login
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity style={{ width: "100%", marginBottom: 20 }} onPress={handleAuth}>
                    <LinearGradient colors={["#9C3FE4", "#C65647"]} style={{ borderRadius: 15, paddingVertical: 15, alignItems: "center" }}>
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
                      <Text style={{ color: "#007bff", fontSize: 14 }}>
                        Forgot Password?
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity onPress={() => setIsSignup(!isSignup)}>
                    <Text style={{ color: "#007bff", fontSize: 16, marginTop: 10 }}>
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
    height: 50,
    width: "100%",
    backgroundColor: "#EFEFEF",
    borderRadius: 8,
    paddingHorizontal: 10,
    color: '#000', 
  }
});

export default AuthScreen;