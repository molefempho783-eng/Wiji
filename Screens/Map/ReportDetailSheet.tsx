// Bottom sheet for a municipal report on the map: details, "affects me too", "it's fixed" votes,
// share (e.g. to the ward councillor), and mark fixed / delete for the person who reported it.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Modal, ScrollView, Share, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { arrayRemove, arrayUnion, deleteField, doc, getDoc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { useTheme } from "../context/ThemeContext";
import { FIXED_VOTES_NEEDED, MunicipalReport, REPORT_STATUS, reportCategory, timeAgo } from "./reports";

type Props = {
  report: MunicipalReport | null;
  onClose: () => void;
  bottomSpace: number;
};

export default function ReportDetailSheet({ report, onClose, bottomSpace }: Props) {
  const { colors } = useTheme() as any;
  const [isMine, setIsMine] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const uid = auth.currentUser?.uid;
  const muted = colors.textSecondary || colors.secondaryText;
  const line = colors.borderColor || colors.border;

  // Only the reporter can read their owner record, so a successful read means "this is my report"
  useEffect(() => {
    setIsMine(false);
    if (!report || !uid) return;
    if (report.reporterUid === uid) return setIsMine(true);
    let live = true;
    getDoc(doc(db, "municipalReportOwners", report.id))
      .then((s) => live && setIsMine(s.exists() && s.data().uid === uid))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [report?.id, uid]);

  if (!report) return null;
  const c = reportCategory(report.category);
  const st = REPORT_STATUS[report.status] || REPORT_STATUS.open;
  const affected = report.affectedBy || [];
  const fixedVotes = report.fixedVotes || [];
  const iAmAffected = !!uid && affected.includes(uid);
  const iSaidFixed = !!uid && fixedVotes.includes(uid);
  const ref = doc(db, "municipalReports", report.id);

  const run = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e: any) {
      Alert.alert("Couldn't update the report", e?.message || "Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const toggleAffected = () =>
    uid && run("affected", () => updateDoc(ref, { affectedBy: iAmAffected ? arrayRemove(uid) : arrayUnion(uid), updatedAt: serverTimestamp() }));

  const toggleFixedVote = () => {
    if (!uid) return;
    const count = fixedVotes.length + (iSaidFixed ? -1 : 1);
    const closes = !iSaidFixed && count >= FIXED_VOTES_NEEDED && report.status !== "fixed";
    run("fixed", () =>
      updateDoc(ref, {
        fixedVotes: iSaidFixed ? arrayRemove(uid) : arrayUnion(uid),
        ...(closes ? { status: "fixed", fixedAt: serverTimestamp() } : {}),
        updatedAt: serverTimestamp(),
      })
    );
  };

  const setMyStatus = (fixed: boolean) =>
    run("status", () =>
      updateDoc(ref, fixed ? { status: "fixed", fixedAt: serverTimestamp(), updatedAt: serverTimestamp() } : { status: "open", fixedAt: deleteField(), updatedAt: serverTimestamp() })
    );

  const remove = () =>
    Alert.alert("Delete report", "Remove this report from the map? This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          run("delete", async () => {
            const b = writeBatch(db);
            b.delete(ref);
            b.delete(doc(db, "municipalReportOwners", report.id));
            await b.commit();
            onClose();
          }),
      },
    ]);

  const mapsLink = `https://maps.google.com/?q=${report.latitude},${report.longitude}`;
  const share = () =>
    Share.share({
      message: [
        `${c.label}: ${report.title}`,
        report.description,
        `Where: ${report.location}`,
        affected.length ? `${affected.length} ${affected.length === 1 ? "person says" : "people say"} it affects them too.` : null,
        `Reported ${timeAgo(report.createdAt)} on Wiji`,
        mapsLink,
      ].filter(Boolean).join("\n"),
    }).catch(() => undefined);

  const Action = ({ k, icon, label, on, onPress, color }: { k: string; icon: any; label: string; on?: boolean; onPress: () => void; color?: string }) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={!!busy}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={{
        flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
        height: 48, borderRadius: 14, borderWidth: 1.5,
        borderColor: on ? color || colors.primary : line, backgroundColor: on ? color || colors.primary : "transparent",
      }}
    >
      {busy === k ? <ActivityIndicator size="small" color={on ? "#fff" : colors.primary} /> : <Ionicons name={icon} size={18} color={on ? "#fff" : colors.text} />}
      <Text style={{ color: on ? "#fff" : colors.text, fontWeight: "800" }} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );

  const Row = ({ icon, children }: { icon: any; children: React.ReactNode }) => (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 8 }}>
      <Ionicons name={icon} size={16} color={muted} style={{ marginTop: 2 }} />
      <Text style={{ color: colors.text, flex: 1, lineHeight: 20 }}>{children}</Text>
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
        <TouchableOpacity style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: colors.card || colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "85%" }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: line, alignSelf: "center", marginTop: 10 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 12 }}>
            <View style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: c.color, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={c.icon} size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }} numberOfLines={2}>{report.title}</Text>
              <Text style={{ color: c.color, fontWeight: "800", fontSize: 12, marginTop: 2 }}>{c.label.toUpperCase()}</Text>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close" style={{ padding: 6 }}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomSpace + 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: `${st.color}22` }}>
              <Ionicons name={st.icon} size={14} color={st.color} />
              <Text style={{ color: st.color, fontWeight: "800", fontSize: 12 }}>{st.label}</Text>
            </View>

            {report.photoUrl ? (
              <Image source={{ uri: report.photoUrl }} style={{ width: "100%", height: 190, borderRadius: 14, marginTop: 12 }} resizeMode="cover" />
            ) : null}
            {report.description ? <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 12 }}>{report.description}</Text> : null}

            <Row icon="location-outline">
              {report.location}
              {report.distance != null ? <Text style={{ color: muted }}>{`  ·  ${report.distance} km away`}</Text> : null}
            </Row>
            <Row icon="time-outline">Reported {timeAgo(report.createdAt)}{report.status === "fixed" && report.fixedAt ? ` · fixed ${timeAgo(report.fixedAt)}` : ""}</Row>
            <Row icon={report.anonymous ? "eye-off-outline" : "person-outline"}>
              {report.anonymous ? "Reported anonymously" : `Reported by ${report.reporterName || "someone"}`}
              {isMine ? <Text style={{ color: colors.primary, fontWeight: "700" }}>  (you)</Text> : null}
            </Row>
            <Row icon="people-outline">
              {affected.length ? `${affected.length} ${affected.length === 1 ? "person says" : "people say"} it affects them too` : "Be the first to say it affects you too"}
            </Row>

            {report.staffNote ? (
              <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: `${REPORT_STATUS.in_progress.color}14`, borderWidth: 1, borderColor: `${REPORT_STATUS.in_progress.color}55` }}>
                <Text style={{ color: colors.text, fontWeight: "800", marginBottom: 4 }}>Update from Wiji</Text>
                <Text style={{ color: colors.text, lineHeight: 20 }}>{report.staffNote}</Text>
              </View>
            ) : null}

            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Action k="affected" icon={iAmAffected ? "checkmark" : "hand-left-outline"} label={iAmAffected ? "Affects me" : "Affects me too"} on={iAmAffected} onPress={toggleAffected} />
              {report.status !== "fixed" ? (
                <Action k="fixed" icon="checkmark-done" label={iSaidFixed ? "You said fixed" : "It's fixed"} on={iSaidFixed} onPress={toggleFixedVote} color={REPORT_STATUS.fixed.color} />
              ) : null}
            </View>
            {report.status !== "fixed" && fixedVotes.length > 0 ? (
              <Text style={{ color: muted, fontSize: 12, marginTop: 8, textAlign: "center" }}>
                {fixedVotes.length} of {FIXED_VOTES_NEEDED} people say it's fixed. It's marked fixed at {FIXED_VOTES_NEEDED}.
              </Text>
            ) : null}

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Action k="share" icon="share-social-outline" label="Share" onPress={share} />
              <Action k="directions" icon="navigate-outline" label="Directions" onPress={() => Linking.openURL(mapsLink).catch(() => undefined)} />
            </View>
            <Text style={{ color: muted, fontSize: 12, marginTop: 8, lineHeight: 17 }}>
              Share it with your ward councillor, community WhatsApp group or the municipality's call centre so it gets logged and fixed.
            </Text>

            {isMine ? (
              <View style={{ marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: line }}>
                <Text style={{ color: colors.text, fontWeight: "800", marginBottom: 10 }}>Your report</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {report.status === "fixed" ? (
                    <Action k="status" icon="refresh" label="Not fixed yet" onPress={() => setMyStatus(false)} />
                  ) : (
                    <Action k="status" icon="checkmark-circle-outline" label="Mark fixed" onPress={() => setMyStatus(true)} />
                  )}
                  <TouchableOpacity
                    onPress={remove}
                    disabled={!!busy}
                    style={{ flex: 1, height: 48, borderRadius: 14, backgroundColor: "#DC3545", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}
                  >
                    {busy === "delete" ? <ActivityIndicator color="#fff" /> : <Ionicons name="trash-outline" size={18} color="#fff" />}
                    <Text style={{ color: "#fff", fontWeight: "800" }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
