// Drive with Wiji: drivers apply in five steps, then follow their verification checks.
// The application is a draft until submitted; only the safety team can approve it.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import AddressInput from "../../components/AddressInput";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../context/ThemeContext";
import createStyles from "../context/appStyles";
import { RootStackParamList } from "../../types";
import {
  CHECK_LABELS,
  CHECK_ORDER,
  DocMeta,
  PERSONAL_DOCS,
  VEHICLE_DOCS,
  AppProblem,
  applicationProblems,
  daysUntil,
  expiryProblem,
  formatDate,
  idProblem,
  nameProblem,
  phoneProblem,
  plateProblem,
  saveApplication,
  yearProblem,
  submitApplication,
  reopenApplication,
  cancelDocumentUpdate,
  expiryList,
  uploadDriverDoc,
} from "../../services/drivers";

type Nav = StackNavigationProp<RootStackParamList>;
type App = any;

export const PENDING_DOC_KEY = "@wiji_pending_driver_doc";
const STEPS = ["About you", "Documents", "Your car", "Safety induction", "Submit"];

const QUIZ = [
  {
    q: "At pickup, the passenger tells you a 4-digit trip PIN. What do you do?",
    options: ["Start the trip without it if you're in a hurry", "Enter it in the app to start the trip", "Ask them to read it out to someone else"],
    answer: 1,
  },
  {
    q: "A passenger asks for your personal phone number to book you directly next time.",
    options: ["Give it to them, it's good for business", "Keep all contact inside the Wiji app", "Give them a friend's number instead"],
    answer: 1,
  },
  {
    q: "Which of these leads to immediate suspension while it is investigated?",
    options: ["Arriving 5 minutes late", "Sexual comments, touching or threats towards a passenger", "Playing the radio"],
    answer: 1,
  },
  {
    q: "Who can use the emergency button?",
    options: ["Only passengers", "Only drivers", "Both passengers and drivers"],
    answer: 2,
  },
  {
    q: "If a passenger reports you, what happens?",
    options: [
      "You're removed without being told why",
      "You're told what is alleged and can respond before a decision is made",
      "Nothing, reports are ignored",
    ],
    answer: 1,
  },
];

const DriverApplicationScreen = () => {
  const { colors } = useTheme();
  const globalStyles = createStyles(colors).global;
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const [app, setApp] = useState<App | null | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(
      doc(db, "driver_applications", user.uid),
      (s) => setApp(s.exists() ? s.data() : null),
      () => setApp(null)
    );
  }, [user?.uid]);

  const s = useMemo(() => makeStyles(colors), [colors]);

  // Android can close Wiji while the camera, gallery or file picker is open (common on phones and
  // emulators low on memory). When the app comes back, reopen the right step and recover the photo.
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      let pending: { key: DocMeta["key"]; from: string; at: number } | null = null;
      try {
        pending = JSON.parse((await AsyncStorage.getItem(PENDING_DOC_KEY)) || "null");
      } catch {}
      if (!pending || Date.now() - pending.at > 30 * 60 * 1000) return;
      await AsyncStorage.removeItem(PENDING_DOC_KEY).catch(() => undefined);
      setStep(PERSONAL_DOCS.some((m) => m.key === pending!.key) ? 1 : 2);
      const label = [...PERSONAL_DOCS, ...VEHICLE_DOCS].find((m) => m.key === pending!.key)?.label || "your document";
      if (pending.from !== "file") {
        const r = await ImagePicker.getPendingResultAsync().catch(() => null);
        if (r && "assets" in r && !r.canceled && r.assets?.[0]?.uri) {
          setBusy(pending.key);
          try {
            await uploadDriverDoc(pending.key, r.assets[0].uri, r.assets[0].mimeType || "image/jpeg");
          } catch (e: any) {
            Alert.alert("Upload failed", e.message || "Please try again.");
          } finally {
            setBusy(null);
          }
          return;
        }
      }
      Alert.alert(
        "Please choose it again",
        `Your phone closed Wiji while you were choosing ${label}, so it wasn't uploaded. Try again. If it keeps happening, take a photo of the document instead.`
      );
    })();
  }, [user?.uid]);

  const startUpdate = () =>
    Alert.alert(
      "Update my documents",
      "Upload a renewed licence, PrDP, disc, insurance or anything else that changed. You can keep driving while the safety team checks it, unless something has already expired.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Update documents",
          onPress: async () => {
            setBusy("reopen");
            try {
              await reopenApplication();
              setStep(1);
            } catch (e: any) {
              Alert.alert("Couldn't open your documents", e.message);
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );

  const cancelUpdate = () =>
    Alert.alert("Cancel this update?", "Your documents go back to the ones that were approved. Anything you uploaded now is discarded.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Cancel update",
        style: "destructive",
        onPress: async () => {
          setBusy("cancelUpdate");
          try {
            await cancelDocumentUpdate();
          } catch (e: any) {
            Alert.alert("Couldn't cancel", e.message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  // Expiry status for each document with a date (expired, expiring within 30 days, or valid)
  const expiryCard = (documents: any) => {
    const items = expiryList(documents);
    if (!items.length) return null;
    return (
      <View style={[s.card, { marginTop: 16 }]}>
        <Text style={s.cardTitle}>My documents</Text>
        {items.map((it) => {
          const tone = it.days <= 0 ? colors.error : it.days <= 30 ? colors.warning : colors.accent;
          const text = it.days <= 0 ? "Expired" : it.days <= 30 ? `Expires in ${it.days} day${it.days === 1 ? "" : "s"}` : `Valid to ${formatDate(it.date)}`;
          return (
            <View key={it.key} style={s.checkRow}>
              <Ionicons name={it.days <= 0 ? "alert-circle" : it.days <= 30 ? "time-outline" : "checkmark-circle"} size={20} color={tone} />
              <Text style={[s.body, { flex: 1, marginTop: 0 }]}>{it.label}</Text>
              <Text style={[s.small, { color: tone, fontWeight: "700" }]}>{text}</Text>
            </View>
          );
        })}
      </View>
    );
  };

  const header = (title: string) => (
    <View style={s.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={{ padding: 6 }}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>{title}</Text>
    </View>
  );

  if (app === undefined) {
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        {header("Drive with Wiji")}
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  /* ---------- Not started ---------- */
  if (app === null) {
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        {header("Drive with Wiji")}
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Ionicons name="car-sport" size={48} color={colors.primary} />
          <Text style={s.h1}>Drive and earn with Wiji</Text>
          <Text style={s.body}>
            Every Wiji driver is verified before their first trip, so passengers know exactly who's picking them up. Here's what you'll need:
          </Text>
          {[
            "Your SA ID or passport, and a selfie taken in the app",
            "Driver's licence and Professional Driving Permit (PrDP)",
            "Proof of address from the last 3 months",
            "Your car's licence disc, roadworthy certificate, passenger insurance and operating licence (or proof you've applied)",
            "Four photos of your car",
            "About 10 minutes for a short safety induction",
          ].map((t) => (
            <View key={t} style={s.bulletRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
              <Text style={[s.body, { flex: 1, marginTop: 0 }]}>{t}</Text>
            </View>
          ))}
          <Text style={[s.small, { marginTop: 16 }]}>
            With your consent, we check your identity, licence, criminal record and vehicle. Your documents are only seen by you and the Wiji safety team.
          </Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => saveApplication({}).catch((e) => Alert.alert("Couldn't start", e.message))}>
            <Text style={s.primaryBtnText}>Start my application</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ---------- Submitted / in review / approved / declined ---------- */
  if (app.status !== "draft") {
    const approved = app.status === "approved";
    const declined = app.status === "declined";
    return (
      <SafeAreaView style={globalStyles.safeArea}>
        {header("Your driver application")}
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Ionicons
            name={approved ? "shield-checkmark" : declined ? "close-circle" : "hourglass"}
            size={48}
            color={approved ? colors.accent : declined ? colors.error : colors.primary}
          />
          <Text style={s.h1}>
            {approved ? "You're a verified Wiji driver" : declined ? "Your application wasn't approved" : app.reverify ? "We're checking your updated documents" : "We're checking your application"}
          </Text>
          <Text style={s.body}>
            {approved
              ? "Your verified profile is live. Set up payouts in the Wallet so you can get paid for trips."
              : declined
              ? app.decision?.reason || "The safety team couldn't approve your application."
              : app.reverify
              ? "Only the checks for documents you changed need to be redone. You can keep driving meanwhile, unless a document has already expired. We'll notify you when it's done."
              : "The safety team is working through your checks. We'll send you a notification when there's news. This usually takes a few working days."}
          </Text>
          {declined ? (
            <Text style={[s.small, { marginTop: 10 }]}>
              If you think a record used in this decision is wrong, contact the Wiji safety team to ask for a review.
            </Text>
          ) : null}

          {!declined ? (
            <View style={[s.card, { marginTop: 20 }]}>
              <Text style={s.cardTitle}>Verification checks</Text>
              {CHECK_ORDER.map((c) => {
                const r = app.checks?.[c]?.result || "pending";
                return (
                  <View key={c} style={s.checkRow}>
                    <Ionicons
                      name={r === "passed" ? "checkmark-circle" : r === "failed" ? "alert-circle" : "time-outline"}
                      size={20}
                      color={r === "passed" ? colors.accent : r === "failed" ? colors.error : colors.secondaryText}
                    />
                    <Text style={[s.body, { flex: 1, marginTop: 0 }]}>{CHECK_LABELS[c]}</Text>
                    <Text style={s.small}>{r === "passed" ? (app.checks?.[c]?.carriedOver && !approved ? "Passed before" : "Passed") : r === "failed" ? "Needs attention" : "In progress"}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {approved || app.reverify ? expiryCard(app.documents) : null}

          {approved ? (
            <>
              <TouchableOpacity
                style={[s.primaryBtn, { flexDirection: "row", gap: 8, justifyContent: "center" }]}
                onPress={startUpdate}
                disabled={!!busy}
                accessibilityLabel="Update or resubmit my documents"
              >
                {busy === "reopen" ? <ActivityIndicator color="#fff" /> : <Ionicons name="cloud-upload-outline" size={20} color="#fff" />}
                <Text style={s.primaryBtnText}>Update my documents</Text>
              </TouchableOpacity>
              <Text style={[s.small, { marginTop: 6 }]}>Renewed a licence, disc or insurance? Send the new one here before the old one expires.</Text>
              <TouchableOpacity style={[s.primaryBtn, { backgroundColor: colors.cardHighlight, marginTop: 10 }]} onPress={() => navigation.navigate("DriverHomeScreen")}>
                <Text style={[s.primaryBtnText, { color: colors.primary }]}>Open driver mode</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.primaryBtn, { backgroundColor: colors.cardHighlight, marginTop: 10 }]} onPress={() => navigation.navigate("PayoutSetupScreen")}>
                <Text style={[s.primaryBtnText, { color: colors.primary }]}>Set up payouts</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ---------- Draft: the five steps ---------- */
  const docs = app.documents || {};
  const personal = app.personal || {};
  const vehicle = app.vehicle || {};

  const pickDoc = async (meta: DocMeta, from: "camera" | "gallery" | "file") => {
    try {
      let uri: string | undefined;
      let mime = "image/jpeg";
      if (from === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return Alert.alert("Camera needed", "Allow camera access to take this photo.");
      }
      // Remember what we're picking in case Android closes the app while the picker is open
      await AsyncStorage.setItem(PENDING_DOC_KEY, JSON.stringify({ key: meta.key, from, at: Date.now() })).catch(() => undefined);
      if (from === "camera") {
        const res = await ImagePicker.launchCameraAsync({
          quality: 0.6,
          cameraType: meta.selfie ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
        });
        if (res.canceled) return;
        uri = res.assets[0].uri;
      } else if (from === "gallery") {
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
        if (res.canceled) return;
        uri = res.assets[0].uri;
        mime = res.assets[0].mimeType || "image/jpeg";
      } else {
        const res = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], copyToCacheDirectory: true });
        if (res.canceled) return;
        const a = res.assets[0];
        if (a.size && a.size > 10 * 1024 * 1024) return Alert.alert("File too big", "Choose a file smaller than 10 MB, or take a photo instead.");
        uri = a.uri;
        mime = a.mimeType || ((a.name || uri).toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      }
      setBusy(meta.key);
      await uploadDriverDoc(meta.key, uri, mime);
    } catch (e: any) {
      Alert.alert("Upload failed", e.message || "Please try again.");
    } finally {
      AsyncStorage.removeItem(PENDING_DOC_KEY).catch(() => undefined);
      setBusy(null);
    }
  };

  const chooseUpload = (meta: DocMeta) =>
    Alert.alert(`Upload ${meta.label.toLowerCase()}`, "Where is the document?", [
      { text: "Photo in my gallery", onPress: () => pickDoc(meta, "gallery") },
      { text: "PDF or other file", onPress: () => pickDoc(meta, "file") },
      { text: "Cancel", style: "cancel" },
    ]);

  const docRow = (meta: DocMeta) => {
    const d = docs[meta.key];
    const done = !!d?.path;
    return (
      <View key={meta.key} style={[s.card, { marginBottom: 12 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={22} color={done ? colors.accent : colors.secondaryText} />
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{meta.label}</Text>
            <Text style={s.small}>{meta.help}</Text>
          </View>
          {busy === meta.key ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <TouchableOpacity style={s.smallBtn} onPress={() => pickDoc(meta, "camera")} disabled={!!busy}>
            <Ionicons name="camera-outline" size={18} color={colors.primary} />
            <Text style={s.smallBtnText}>{done ? "Retake" : meta.selfie ? "Take selfie" : "Take photo"}</Text>
          </TouchableOpacity>
          {!meta.selfie ? (
            <TouchableOpacity style={s.smallBtn} onPress={() => chooseUpload(meta)} disabled={!!busy}>
              <Ionicons name="document-attach-outline" size={18} color={colors.primary} />
              <Text style={s.smallBtnText}>Upload file</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {meta.expiry ? (
          <ExpiryField
            saved={d?.expiry || ""}
            required={meta.expiry === "required"}
            colors={colors}
            s={s}
            onSave={(v) => saveApplication({ documents: { [meta.key]: { expiry: v } } }).catch(() => undefined)}
          />
        ) : null}
      </View>
    );
  };

  // A text field that saves as you type (and when you leave the step), and shows what's wrong with a saved value
  const field = (
    label: string,
    value: string | undefined,
    onSave: (v: string) => void,
    opts: Partial<React.ComponentProps<typeof TextInput>> = {},
    problem?: (v?: string) => string | null
  ) => <SavedField label={label} value={value} onSave={onSave} opts={opts} problem={problem} colors={colors} s={s} />;

  const savePersonal = (k: string) => (v: string) => saveApplication({ personal: { [k]: v } }).catch(() => undefined);
  const saveVehicle = (k: string) => (v: string) => saveApplication({ vehicle: { [k]: v } }).catch(() => undefined);

  const problems = applicationProblems(app);
  const stepDone = [0, 1, 2, 3, 4].map((i) => !problems.some((p) => p.step === i));

  const body = () => {
    if (step === 0) {
      const idType = personal.idType || "sa_id";
      return (
        <View>
          {field("Full name (as on your ID)", personal.fullName, savePersonal("fullName"), { placeholder: "e.g. Thabo Mokoena", autoCapitalize: "words" }, nameProblem)}
          <Text style={s.label}>ID type</Text>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
            {[
              { k: "sa_id", t: "SA ID" },
              { k: "passport", t: "Passport" },
            ].map((o) => (
              <TouchableOpacity
                key={o.k}
                onPress={() => saveApplication({ personal: { idType: o.k } })}
                style={[s.chip, idType === o.k && s.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: idType === o.k }}
              >
                <Text style={[s.chipText, idType === o.k && { color: colors.primary }]}>{o.t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {field(
            idType === "passport" ? "Passport number" : "SA ID number",
            personal.idNumber,
            (v) => savePersonal("idNumber")(idType === "passport" ? v.toUpperCase() : v.replace(/\s/g, "")),
            { keyboardType: idType === "passport" ? "default" : "number-pad", maxLength: idType === "passport" ? 12 : 13, autoCapitalize: "characters" },
            (v) => idProblem(v, idType)
          )}
          {field("Mobile number", personal.phone, savePersonal("phone"), { placeholder: "e.g. 082 123 4567", keyboardType: "phone-pad" }, phoneProblem)}
          <AddressInput
            label="Area you'll drive in"
            kind="area"
            value={personal.homeArea && Number.isFinite(personal.homeAreaLocation?.lat) ? { address: personal.homeArea, lat: personal.homeAreaLocation.lat, lng: personal.homeAreaLocation.lng } : null}
            initialQuery={Number.isFinite(personal.homeAreaLocation?.lat) ? undefined : personal.homeArea}
            onChange={(v) => saveApplication({ personal: { homeArea: v.address, homeAreaLocation: { lat: v.lat, lng: v.lng } } }).catch(() => undefined)}
            help="Choose your suburb or town from the suggestions, e.g. Hatfield, Pretoria."
          />
          <Text style={s.small}>Passengers will only see your first name and photo. Your ID number is never shown to anyone outside the safety team.</Text>
        </View>
      );
    }
    if (step === 1) return <View>{PERSONAL_DOCS.map(docRow)}</View>;
    if (step === 2) {
      return (
        <View>
          {field("Make", vehicle.make, saveVehicle("make"), { placeholder: "e.g. Toyota" })}
          {field("Model", vehicle.model, saveVehicle("model"), { placeholder: "e.g. Corolla Quest" })}
          {field("Year", vehicle.year, saveVehicle("year"), { placeholder: "e.g. 2019", keyboardType: "number-pad", maxLength: 4 }, yearProblem)}
          {field("Colour", vehicle.colour, saveVehicle("colour"), { placeholder: "e.g. White" })}
          {field("Number plate", vehicle.plate, (v) => saveVehicle("plate")(v.toUpperCase()), { placeholder: "e.g. CA 123-456", autoCapitalize: "characters" }, plateProblem)}
          <Text style={[s.cardTitle, { marginTop: 8, marginBottom: 10 }]}>Car documents and photos</Text>
          {VEHICLE_DOCS.map(docRow)}
        </View>
      );
    }
    if (step === 3) return <Induction passed={!!app.induction?.passed} colors={colors} s={s} />;
    return (
      <Consents
        app={app}
        stepDone={stepDone}
        problems={problems}
        onGoToStep={setStep}
        colors={colors}
        s={s}
        onSubmit={async () => {
          setBusy("submit");
          try {
            await submitApplication();
          } catch (e: any) {
            Alert.alert("Not quite ready", e.message);
          } finally {
            setBusy(null);
          }
        }}
        submitting={busy === "submit"}
      />
    );
  };

  return (
    <SafeAreaView style={globalStyles.safeArea}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {header("Drive with Wiji")}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}>
          {STEPS.map((t, i) => (
            <TouchableOpacity key={t} onPress={() => setStep(i)} style={[s.stepChip, step === i && s.chipOn]}>
              <Ionicons
                name={stepDone[i] ? "checkmark-circle" : "ellipse-outline"}
                size={16}
                color={stepDone[i] ? colors.accent : step === i ? colors.primary : colors.secondaryText}
              />
              <Text style={[s.chipText, step === i && { color: colors.primary }]}>{`${i + 1}. ${t}`}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {app.reverify ? (
            <View style={[s.card, { borderColor: colors.primary, marginBottom: 16 }]}>
              <Text style={s.cardTitle}>Updating your documents</Text>
              <Text style={s.body}>
                Replace what's changed (step 2 for licence and PrDP, step 3 for car papers), update the expiry dates, then submit on the last step. You stay verified while the safety team checks it.
              </Text>
              <TouchableOpacity onPress={cancelUpdate} disabled={!!busy} style={{ marginTop: 10, alignSelf: "flex-start" }}>
                {busy === "cancelUpdate" ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: colors.error, fontWeight: "700" }}>Cancel update</Text>}
              </TouchableOpacity>
            </View>
          ) : null}
          {app.decision?.outcome === "changes_requested" ? (
            <View style={[s.card, { borderColor: colors.warning, marginBottom: 16 }]}>
              <Text style={s.cardTitle}>The safety team asked for changes</Text>
              <Text style={s.body}>{app.decision.reason}</Text>
            </View>
          ) : null}
          <Text style={s.h2}>{STEPS[step]}</Text>
          {body()}
          {step < STEPS.length - 1 ? (
            <TouchableOpacity style={s.primaryBtn} onPress={() => setStep(step + 1)}>
              <Text style={s.primaryBtnText}>Next</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

/* ---------- Step 4: safety induction ---------- */
/* ---------- Text field that never loses what was typed ---------- */
// Saves 600 ms after typing stops, when the field loses focus, and when the step closes
// (tapping Next doesn't blur the field, so blur alone isn't enough).
const SavedField = ({
  label,
  value,
  onSave,
  opts,
  problem,
  colors,
  s,
}: {
  label: string;
  value?: string;
  onSave: (v: string) => void;
  opts: Partial<React.ComponentProps<typeof TextInput>>;
  problem?: (v?: string) => string | null;
  colors: any;
  s: any;
}) => {
  const typed = useRef(value || "");
  const lastSaved = useRef((value || "").trim());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const v = typed.current.trim();
    if (v !== lastSaved.current) {
      lastSaved.current = v;
      saveRef.current(v);
    }
  };
  useEffect(() => () => flush(), []); // save when the step changes or the screen closes

  const err = value && problem ? problem(value) : null;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        defaultValue={value || ""}
        placeholderTextColor={colors.placeholderText}
        style={[s.input, err ? { borderColor: colors.error } : null]}
        onChangeText={(t) => {
          typed.current = t;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 600);
        }}
        onBlur={flush}
        onSubmitEditing={flush}
        {...opts}
      />
      {err ? <Text style={{ color: colors.error, fontSize: 13, marginTop: 4 }}>{err}</Text> : null}
    </View>
  );
};

/* ---------- Expiry date: picked from a calendar (only future dates, up to 10 years ahead) ---------- */
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromYMD = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

const ExpiryField = ({
  saved,
  required,
  colors,
  s,
  onSave,
}: {
  saved: string;
  required: boolean;
  colors: any;
  s: any;
  onSave: (v: string) => void;
}) => {
  const [iosOpen, setIosOpen] = useState(false);
  const [iosValue, setIosValue] = useState<Date | null>(null);

  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const latest = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
  const savedDate = fromYMD(saved);
  // Start the calendar on the saved date if it's still valid, otherwise a year from today
  const start = savedDate && savedDate >= tomorrow && savedDate <= latest ? savedDate : new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

  const err = saved ? expiryProblem(saved, required) : null;
  const days = saved && !err ? daysUntil(saved) : null;

  const open = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: start,
        mode: "date",
        minimumDate: tomorrow,
        maximumDate: latest,
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === "set" && d) onSave(toYMD(d));
        },
      });
    } else {
      setIosValue(start);
      setIosOpen(true);
    }
  };

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={s.label}>Expiry date{required ? "" : " (if it has one)"}</Text>
      <TouchableOpacity
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={saved ? `Expiry date ${formatDate(saved)}. Tap to change` : "Choose the expiry date"}
        style={[s.input, { flexDirection: "row", alignItems: "center", gap: 10 }, err ? { borderColor: colors.error } : null]}
      >
        <Ionicons name="calendar-outline" size={20} color={colors.primary} />
        <Text style={{ flex: 1, fontSize: 15, color: saved ? colors.text : colors.placeholderText }}>
          {saved ? formatDate(saved) : "Choose date"}
        </Text>
        {saved && !required ? (
          <TouchableOpacity onPress={() => onSave("")} hitSlop={10} accessibilityLabel="Clear the expiry date">
            <Ionicons name="close-circle" size={20} color={colors.secondaryText} />
          </TouchableOpacity>
        ) : (
          <Ionicons name="chevron-down" size={18} color={colors.secondaryText} />
        )}
      </TouchableOpacity>
      {err ? (
        <Text style={{ color: colors.error, fontSize: 13, marginTop: 4 }}>{err}</Text>
      ) : days !== null ? (
        <Text style={{ color: days <= 30 ? colors.warning : colors.accent, fontSize: 13, marginTop: 4 }}>
          {days <= 30 ? `Expires in ${days} day${days === 1 ? "" : "s"}. Renew it soon or your account will be paused` : `Valid for ${days >= 365 ? `${Math.floor(days / 365)} year${days >= 730 ? "s" : ""}` : `${Math.round(days / 30)} months`}`}
        </Text>
      ) : null}
      {Platform.OS === "ios" && iosOpen && iosValue ? (
        <View style={{ marginTop: 8, backgroundColor: colors.cardBackground, borderRadius: 14, borderWidth: 1, borderColor: colors.borderColor, padding: 8 }}>
          <DateTimePicker
            value={iosValue}
            mode="date"
            display="inline"
            minimumDate={tomorrow}
            maximumDate={latest}
            onChange={(_e: DateTimePickerEvent, d?: Date) => d && setIosValue(d)}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 20, padding: 8 }}>
            <TouchableOpacity onPress={() => setIosOpen(false)}>
              <Text style={{ color: colors.secondaryText, fontWeight: "700", fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                onSave(toYMD(iosValue));
                setIosOpen(false);
              }}
            >
              <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 15 }}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const Induction = ({ passed, colors, s }: { passed: boolean; colors: any; s: any }) => {
  const [answers, setAnswers] = useState<(number | null)[]>(QUIZ.map(() => null));
  const [checked, setChecked] = useState(false);
  if (passed) {
    return (
      <View style={s.card}>
        <Ionicons name="ribbon" size={28} color={colors.accent} />
        <Text style={[s.cardTitle, { marginTop: 8 }]}>Induction complete</Text>
        <Text style={s.body}>Thanks for committing to keep every Wiji trip safe.</Text>
      </View>
    );
  }
  const allRight = answers.every((a, i) => a === QUIZ[i].answer);
  return (
    <View>
      <View style={[s.card, { marginBottom: 16 }]}>
        <Text style={s.cardTitle}>The Wiji driver code</Text>
        {[
          "Treat every passenger with respect. Harassment, sexual comments or touching, threats and violence are never tolerated.",
          "Only start a trip with the passenger's trip PIN, and follow the route unless the passenger asks otherwise.",
          "Keep all contact in the app. Never ask for or share personal numbers or social media.",
          "Never drive after drinking or taking drugs, and never let someone else drive your account.",
          "Use the emergency button if you or a passenger is in danger.",
          "If you're reported, you'll be told what's alleged and given a fair chance to respond. Serious reports mean your account is paused while we investigate.",
        ].map((t) => (
          <View key={t} style={[s.bulletRow, { marginTop: 8 }]}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
            <Text style={[s.body, { flex: 1, marginTop: 0 }]}>{t}</Text>
          </View>
        ))}
      </View>
      {QUIZ.map((q, qi) => (
        <View key={q.q} style={{ marginBottom: 16 }}>
          <Text style={[s.cardTitle, { marginBottom: 8 }]}>{`${qi + 1}. ${q.q}`}</Text>
          {q.options.map((o, oi) => {
            const on = answers[qi] === oi;
            const wrong = checked && on && oi !== q.answer;
            return (
              <TouchableOpacity
                key={o}
                onPress={() => setAnswers(answers.map((a, i) => (i === qi ? oi : a)))}
                style={[s.option, on && s.chipOn, wrong && { borderColor: colors.error }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.primary : colors.secondaryText} />
                <Text style={[s.body, { flex: 1, marginTop: 0 }]}>{o}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
      {checked && !allRight ? <Text style={{ color: colors.error, marginBottom: 8 }}>Some answers aren't right yet. Have another look at the driver code.</Text> : null}
      <TouchableOpacity
        style={s.primaryBtn}
        onPress={() => {
          setChecked(true);
          if (allRight) {
            saveApplication({ induction: { passed: true, score: QUIZ.length, completedAt: new Date().toISOString() } }).catch((e) =>
              Alert.alert("Couldn't save", e.message)
            );
          }
        }}
      >
        <Text style={s.primaryBtnText}>Check my answers</Text>
      </TouchableOpacity>
    </View>
  );
};

/* ---------- Step 5: consents and submit ---------- */
const Consents = ({
  app,
  stepDone,
  problems,
  onGoToStep,
  colors,
  s,
  onSubmit,
  submitting,
}: {
  app: any;
  stepDone: boolean[];
  problems: AppProblem[];
  onGoToStep: (step: number) => void;
  colors: any;
  s: any;
  onSubmit: () => void;
  submitting: boolean;
}) => {
  const c = app.consents || {};
  const items = [
    { k: "backgroundCheck", t: "I consent to Wiji checking my identity, licences, criminal record and vehicle, now and once a year." },
    { k: "dataUse", t: "I understand how Wiji uses my information: my documents are seen only by me and the safety team, and passengers see my first name, photo and car." },
    { k: "codeOfConduct", t: "I agree to follow the Wiji driver code, and understand that serious reports pause my account while they're investigated." },
  ];
  const ready = stepDone.slice(0, 4).every(Boolean) && items.every((i) => c[i.k]);
  return (
    <View>
      {items.map((i) => (
        <TouchableOpacity
          key={i.k}
          style={[s.option, { alignItems: "flex-start" }]}
          onPress={() => saveApplication({ consents: { [i.k]: !c[i.k], at: new Date().toISOString() } })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !!c[i.k] }}
        >
          <Ionicons name={c[i.k] ? "checkbox" : "square-outline"} size={22} color={c[i.k] ? colors.primary : colors.secondaryText} />
          <Text style={[s.body, { flex: 1, marginTop: 0 }]}>{i.t}</Text>
        </TouchableOpacity>
      ))}
      {problems.filter((p) => p.step < 4).length ? (
        <View style={[s.card, { marginTop: 12, borderColor: colors.warning }]}>
          <Text style={s.cardTitle}>Still to fix before you submit</Text>
          {problems
            .filter((p) => p.step < 4)
            .map((p, i) => (
              <TouchableOpacity
                key={`${p.step}-${i}`}
                onPress={() => onGoToStep(p.step)}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}
                accessibilityRole="button"
              >
                <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                <Text style={[s.body, { flex: 1, marginTop: 0 }]}>
                  <Text style={{ fontWeight: "700" }}>{STEPS[p.step]}: </Text>
                  {p.text}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.secondaryText} />
              </TouchableOpacity>
            ))}
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
          <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
          <Text style={[s.body, { marginTop: 0, flex: 1 }]}>Everything is filled in and all dates are valid.</Text>
        </View>
      )}
      <TouchableOpacity style={[s.primaryBtn, !ready && { backgroundColor: colors.borderColor }]} disabled={!ready || submitting} onPress={onSubmit}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Submit for verification</Text>}
      </TouchableOpacity>
    </View>
  );
};

const makeStyles = (colors: any) => ({
  header: { flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: 12, paddingVertical: 8 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: "700" as const, marginLeft: 8 },
  h1: { color: colors.text, fontSize: 24, fontWeight: "800" as const, marginTop: 12 },
  h2: { color: colors.text, fontSize: 20, fontWeight: "800" as const, marginBottom: 14 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 8 },
  small: { color: colors.secondaryText, fontSize: 13, lineHeight: 19 },
  label: { color: colors.text, fontSize: 14, fontWeight: "700" as const, marginBottom: 6 },
  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.inputBorder,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
    color: colors.text,
    fontSize: 16,
  },
  card: { backgroundColor: colors.cardBackground, borderRadius: 16, borderWidth: 1, borderColor: colors.borderColor, padding: 14 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700" as const },
  bulletRow: { flexDirection: "row" as const, gap: 10, alignItems: "flex-start" as const, marginTop: 10 },
  checkRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingVertical: 10 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, borderWidth: 2, borderColor: colors.borderColor },
  stepChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.borderColor,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.cardHighlight },
  chipText: { color: colors.text, fontWeight: "600" as const, fontSize: 14 },
  option: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.borderColor,
    marginBottom: 8,
  },
  smallBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.cardHighlight,
  },
  smallBtnText: { color: colors.primary, fontWeight: "700" as const, fontSize: 14 },
  primaryBtn: {
    marginTop: 20,
    height: 54,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: colors.primary,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" as const },
});

export default DriverApplicationScreen;
