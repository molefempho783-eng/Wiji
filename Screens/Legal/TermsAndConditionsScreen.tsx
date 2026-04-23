import React from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

const LAST_UPDATED = "April 22, 2026";

export default function TermsAndConditionsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Terms and Conditions</Text>
        <Text style={styles.meta}>Last updated: {LAST_UPDATED}</Text>

        <Section
          title="1. Acceptance of Terms"
          body="By creating an account or using this app, you agree to these Terms and our Privacy Policy. If you do not agree, do not use the app."
        />
        <Section
          title="2. Eligibility and Account Responsibility"
          body="You must provide accurate account information and keep your login credentials secure. You are responsible for activity that occurs under your account."
        />
        <Section
          title="3. Community Conduct"
          body="You agree not to post unlawful, abusive, fraudulent, threatening, discriminatory, or misleading content. You may not use the app to harass, spam, or impersonate others."
        />
        <Section
          title="4. Deals, Specials, and Location Posts"
          body="Users and businesses may post locations, specials, or offers. You are solely responsible for the accuracy and legality of what you post. We do not guarantee availability, quality, pricing, or outcomes related to posted offers."
        />
        <Section
          title="5. User Content"
          body="You keep ownership of your content, but you grant us a non-exclusive, worldwide license to host, display, and process your content to operate and improve the service."
        />
        <Section
          title="6. Safety and Third-Party Interactions"
          body="Use your judgment when meeting others or visiting posted locations. We are not responsible for disputes, injuries, losses, or damages arising from interactions between users or businesses."
        />
        <Section
          title="7. Wallets, Payments, and Financial Features"
          body="Any wallet, transfer, payment, order, or crypto-related feature is provided for convenience only. You are solely responsible for verifying recipient addresses, payment details, pricing, transaction amounts, and network selection before confirming any action."
        />
        <Section
          title="8. Non-Custodial and No Financial Advice"
          body="We are not a bank, broker, exchange, money transmitter, investment adviser, fiduciary, or custodian unless explicitly required by law in your jurisdiction. Nothing in the app is legal, tax, accounting, or financial advice."
        />
        <Section
          title="9. Security, Hacks, and Losses"
          body="You are responsible for protecting your device, credentials, wallet keys, passcodes, and recovery information. To the maximum extent permitted by law, we are not liable for unauthorized access, hacking, phishing, malware, user error, stolen credentials, blockchain/network failures, third-party payment failures, or irreversible transfers."
        />
        <Section
          title="10. Third-Party Services and Networks"
          body="The app may rely on third-party infrastructure, payment processors, cloud providers, map services, and blockchain networks. We do not control their uptime, fees, confirmation times, reversals, or security, and are not responsible for their acts, omissions, outages, or losses."
        />
        <Section
          title="11. Notifications"
          body="You may receive push notifications related to nearby activities, specials, payments, and app updates. Delivery is not guaranteed. You can manage notification permissions in device settings."
        />
        <Section
          title="12. Indemnification"
          body="You agree to defend, indemnify, and hold harmless the app owner, affiliates, and service providers from claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising from your content, transactions, misuse, violations of these Terms, or violation of law or third-party rights."
        />
        <Section
          title="13. Disclaimer of Warranties"
          body={'The app is provided on an "as is" and "as available" basis, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, title, non-infringement, availability, or error-free operation, to the fullest extent permitted by law.'}
        />
        <Section
          title="14. Limitation of Liability"
          body="To the fullest extent permitted by law, we are not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of funds, digital assets, profits, data, goodwill, business interruption, or procurement of substitute services, even if advised of the possibility of such damages."
        />
        <Section
          title="15. Termination, Changes, and Contact"
          body="We may suspend or terminate accounts that violate these Terms or create legal/security risk. We may update these Terms at any time, and continued use means acceptance of the revised version. For questions, contact support through official channels."
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
