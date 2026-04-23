import React from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

const LAST_UPDATED = "April 22, 2026";

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Privacy Policy</Text>
        <Text style={styles.meta}>Last updated: {LAST_UPDATED}</Text>

        <Section
          title="1. Scope"
          body="This Privacy Policy explains how we collect, use, store, and share information when you use this app."
        />
        <Section
          title="2. Information We Collect"
          body="We may collect account details (such as username and email), profile data, messages and content you post, usage logs, device/app data, and transaction-related data needed for functionality, fraud prevention, and security."
        />
        <Section
          title="3. Location Data"
          body="With your permission, we collect approximate or precise location data to show nearby activity, place map pins, and send location-based notifications such as specials within your area."
        />
        <Section
          title="4. Push Notifications"
          body="We use push tokens and related identifiers to send notifications. You can disable notifications in your device settings at any time."
        />
        <Section
          title="5. Wallets and Payment Data"
          body="When you use wallet, transfer, order, or payment features, we may process data such as wallet addresses, transaction IDs, order metadata, payment status, and related logs. We use this data to provide service functionality, security, fraud detection, accounting support, and dispute handling."
        />
        <Section
          title="6. How We Use Information"
          body="We use data to provide core app features, personalize experience, improve service quality, protect users, enforce policies, investigate abuse, and comply with legal requirements."
        />
        <Section
          title="7. Sharing of Information"
          body="We may share data with service providers that help us operate the app (such as backend and messaging infrastructure), when required by law, or to protect rights, safety, and security."
        />
        <Section
          title="8. Data Retention"
          body="We retain data as long as needed for legitimate business, legal, and security purposes. Some data may persist in backups for a limited period."
        />
        <Section
          title="9. Security"
          body="We use reasonable technical and organizational safeguards, but no method of transmission or storage is completely secure."
        />
        <Section
          title="10. Your Choices"
          body="You can update profile data, adjust permissions (including location and notifications), and request account deletion through available in-app or support channels."
        />
        <Section
          title="11. Children's Privacy"
          body="The app is not intended for children under the age required by local law. We do not knowingly collect personal information from children in violation of applicable law."
        />
        <Section
          title="12. International Processing"
          body="Your data may be processed in countries other than your own where our service providers operate, subject to applicable legal safeguards."
        />
        <Section
          title="13. Changes to This Policy"
          body="We may update this Privacy Policy from time to time. Continued use of the app after updates indicates acceptance of the revised policy."
        />
        <Section
          title="14. Contact"
          body="If you have privacy questions or requests, contact the app support team through official channels."
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  content: {
    padding: 20,
    paddingBottom: 36,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111111",
    marginBottom: 6,
  },
  meta: {
    fontSize: 13,
    color: "#666666",
    marginBottom: 18,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111111",
    marginBottom: 6,
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 20,
    color: "#333333",
  },
});
