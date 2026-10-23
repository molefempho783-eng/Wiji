import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  PermissionsAndroid,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { useTheme } from "../context/ThemeContext";
import createStyles from "../context/appStyles";
import { useAuth } from "../../AuthContext";
import { db } from "../../firebaseConfig";
import {
  acceptCallSession,
  addAnswerCandidate,
  addOfferCandidate,
  type CallSession,
  declineCallSession,
  endCallSession,
  failCallSession,
  markMissedCallIfExpired,
  startCallSession,
  subscribeActiveCallForUser,
  writeAnswer,
  writeOffer,
} from "../../utils/callService";
import { WebRTCAudioSession } from "../../services/calls/webrtcAudio";
import CoachTour from "../../components/CoachTour";

type ChatDoc = {
  participants?: string[] | Record<string, boolean>;
};

type UserRow = {
  id: string;
  username?: string;
};

type PeerConversationRow = {
  chatId: string;
  otherId: string;
};

type CallUIState =
  | "idle"
  | "outgoingRinging"
  | "incomingRinging"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

const CallScreen = () => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const globalStyles = createStyles(colors).global;

  const [loading, setLoading] = useState(true);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [chatPeersByChatId, setChatPeersByChatId] = useState<
    Record<string, PeerConversationRow>
  >({});
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [callState, setCallState] = useState<CallUIState>("idle");
  const [callSeconds, setCallSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const rtcRef = useRef<WebRTCAudioSession | null>(null);
  const answerAppliedRef = useRef(false);
  const processedOfferCandidatesRef = useRef(new Set<string>());
  const processedAnswerCandidatesRef = useRef(new Set<string>());

  const ensureMicrophonePermission = useCallback(async () => {
    if (Platform.OS !== "android") return true;
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }, []);

  const ensureRtc = useCallback(
    async (role: "caller" | "callee", callId: string) => {
      if (rtcRef.current) return rtcRef.current;
      const rtc = new WebRTCAudioSession({
        onLocalIceCandidate: async (candidate) => {
          if (role === "caller") await addOfferCandidate(callId, candidate);
          else await addAnswerCandidate(callId, candidate);
        },
        onConnectionStateChange: (state) => {
          if (state === "connected") {
            setCallState("connected");
            return;
          }
          if (state === "connecting") {
            setCallState("connecting");
            return;
          }
          if (state === "failed" || state === "disconnected" || state === "closed") {
            setCallState("error");
            setErrorMessage("Call connection was interrupted.");
          }
        },
      });
      rtcRef.current = rtc;
      return rtc;
    },
    []
  );

  const cleanupRtc = useCallback(() => {
    rtcRef.current?.dispose();
    rtcRef.current = null;
    answerAppliedRef.current = false;
    processedOfferCandidatesRef.current.clear();
    processedAnswerCandidatesRef.current.clear();
    setMuted(false);
  }, []);

  /**
   * Same derivation as UsersScreen "Friends": `users` collection ∩ DM peers from `chatIds`.
   * Per-profile listeners alone can race or diverge; mirroring UsersScreen guarantees parity.
   */
  useEffect(() => {
    if (!user?.uid) {
      setAllUsers([]);
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: UserRow[] = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
          .filter((u) => u.id !== user.uid);
        list.sort((a, b) =>
          String(a.username || "").localeCompare(String(b.username || ""))
        );
        setAllUsers(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setChatPeersByChatId({});
      setActiveCall(null);
      return;
    }

    const uid = user.uid;
    const chatUnsubs: Record<string, () => void> = {};
    const userRef = doc(db, "users", uid);

    const unsubscribeUser = onSnapshot(userRef, (userSnap) => {
      let chatIds: string[] = userSnap.exists()
        ? ((userSnap.data().chatIds as string[] | undefined) ?? [])
        : [];
      if (!Array.isArray(chatIds)) chatIds = [];

      if (chatIds.length === 0) {
        getDocs(query(collection(db, "chats"), where("participants", "array-contains", uid)))
          .then((snap) => {
            if (snap.empty) return;
            const ids = snap.docs.map((d) => d.id);
            if (ids.length === 0) return;
            updateDoc(userRef, { chatIds: ids }).catch(() => {});
          })
          .catch(() => {});
      }

      const currentSet = new Set(chatIds);
      Object.keys(chatUnsubs).forEach((id) => {
        if (!currentSet.has(id)) {
          chatUnsubs[id]();
          delete chatUnsubs[id];
          setChatPeersByChatId((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
      });

      chatIds.forEach((chatId) => {
        if (chatUnsubs[chatId]) return;
        const chatRef = doc(db, "chats", chatId);
        chatUnsubs[chatId] = onSnapshot(chatRef, (chatSnap) => {
          if (!chatSnap.exists()) {
            setChatPeersByChatId((prev) => {
              const next = { ...prev };
              delete next[chatId];
              return next;
            });
            return;
          }
          const data = chatSnap.data() as ChatDoc;
          const participants = data?.participants;
          const otherId = Array.isArray(participants)
            ? participants.find((p: string) => p !== uid)
            : participants && typeof participants === "object"
              ? Object.keys(participants).find((k) => k !== uid)
              : undefined;
          if (!otherId) return;
          setChatPeersByChatId((prev) => ({
            ...prev,
            [chatId]: { chatId, otherId },
          }));
        });
      });
    });

    const unsubCalls = subscribeActiveCallForUser(uid, setActiveCall);

    return () => {
      unsubscribeUser();
      Object.values(chatUnsubs).forEach((u) => u());
      unsubCalls();
    };
  }, [user?.uid]);

  const friends = useMemo(() => {
    const ids = new Set(Object.values(chatPeersByChatId).map((row) => row.otherId));
    return allUsers
      .filter((u) => ids.has(u.id))
      .map((u) => ({
        id: u.id,
        username: String(u.username || "").trim() || "User",
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }, [allUsers, chatPeersByChatId]);

  useEffect(() => {
    if (!activeCall) {
      setCallState("idle");
      cleanupRtc();
      setCallSeconds(0);
      return;
    }

    markMissedCallIfExpired(activeCall.id).catch(() => {});

    if (activeCall.status === "ringing") {
      const incoming = activeCall.calleeId === user?.uid;
      setCallState(incoming ? "incomingRinging" : "outgoingRinging");
      return;
    }
    if (activeCall.status === "accepted") {
      setCallState((prev) => (prev === "connected" ? "connected" : "connecting"));
      return;
    }
    if (
      activeCall.status === "declined" ||
      activeCall.status === "ended" ||
      activeCall.status === "missed"
    ) {
      setCallState("ended");
      cleanupRtc();
      return;
    }
    if (activeCall.status === "failed") {
      setCallState("error");
      setErrorMessage("Call failed. Please try again.");
      cleanupRtc();
    }
  }, [activeCall, cleanupRtc, user?.uid]);

  useEffect(() => {
    if (callState !== "connected") {
      setCallSeconds(0);
      return;
    }
    const timer = setInterval(() => setCallSeconds((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [callState]);

  useEffect(() => {
    const run = async () => {
      if (!user?.uid || !activeCall) return;
      if (activeCall.status !== "ringing") return;
      if (activeCall.callerId !== user.uid) return;
      if (activeCall.offer?.sdp) return;
      try {
        const micOk = await ensureMicrophonePermission();
        if (!micOk) {
          setCallState("error");
          setErrorMessage("Microphone permission is required for calls.");
          await failCallSession(activeCall.id, "network_failure");
          return;
        }
        const rtc = await ensureRtc("caller", activeCall.id);
        const offer = await rtc.createOffer();
        await writeOffer(activeCall.id, offer);
      } catch (error: any) {
        console.warn("[CallScreen] start call media failed:", error?.code || "", error?.message || error);
        setCallState("error");
        setErrorMessage(
          error?.code === "permission-denied"
            ? "Couldn't connect the call (permission denied). Please update Wiji and try again."
            : /permission|NotAllowed/i.test(String(error?.message || error?.name || ""))
            ? "Wiji can't use your microphone. Allow it in your phone's settings."
            : `Could not start call media${error?.message ? `: ${error.message}` : "."}`
        );
      }
    };
    run();
  }, [activeCall, ensureMicrophonePermission, ensureRtc, user?.uid]);

  useEffect(() => {
    const run = async () => {
      if (!user?.uid || !activeCall) return;
      if (activeCall.status !== "accepted") return;
      const isCaller = activeCall.callerId === user.uid;

      try {
        if (!isCaller) {
          if (!activeCall.offer?.sdp) return;
          if (activeCall.answer?.sdp) return;
          const micOk = await ensureMicrophonePermission();
          if (!micOk) {
            setCallState("error");
            setErrorMessage("Microphone permission is required for calls.");
            await failCallSession(activeCall.id, "network_failure");
            return;
          }
          const rtc = await ensureRtc("callee", activeCall.id);
          const answer = await rtc.applyOfferAndCreateAnswer(activeCall.offer);
          await writeAnswer(activeCall.id, answer);
          return;
        }

        if (!activeCall.answer?.sdp || answerAppliedRef.current) return;
        const rtc = await ensureRtc("caller", activeCall.id);
        await rtc.applyAnswer(activeCall.answer);
        answerAppliedRef.current = true;
      } catch (error: any) {
        console.warn("[CallScreen] negotiate failed:", error?.code || "", error?.message || error);
        setCallState("error");
        setErrorMessage(`Could not connect the call${error?.message ? `: ${error.message}` : "."}`);
        await failCallSession(activeCall.id, "network_failure");
      }
    };
    run();
  }, [activeCall, ensureMicrophonePermission, ensureRtc, user?.uid]);

  useEffect(() => {
    const run = async () => {
      if (!user?.uid || !activeCall || activeCall.status !== "accepted") return;
      if (!rtcRef.current) return;
      const isCaller = activeCall.callerId === user.uid;
      const remoteCandidates = isCaller
        ? activeCall.answerCandidates || []
        : activeCall.offerCandidates || [];
      const seen = isCaller
        ? processedAnswerCandidatesRef.current
        : processedOfferCandidatesRef.current;

      for (const candidate of remoteCandidates) {
        const key = `${candidate.candidate}|${candidate.sdpMid}|${candidate.sdpMLineIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          await rtcRef.current.addRemoteCandidate(candidate);
        } catch {
          // Ignore malformed/duplicate candidates and continue.
        }
      }
    };
    run();
  }, [activeCall, user?.uid]);

  const activeOtherUser = useMemo(() => {
    if (!user?.uid || !activeCall) return null;
    const otherId = activeCall.participants.find((p) => p !== user.uid);
    if (!otherId) return null;
    return friends.find((f) => f.id === otherId) || { id: otherId, username: "User" };
  }, [activeCall, friends, user?.uid]);

  const startCall = useCallback(
    async (friendId: string) => {
      if (!user?.uid) return;
      setBusyAction(true);
      setErrorMessage(null);
      try {
        await startCallSession(user.uid, friendId);
      } catch (error: any) {
        setCallState("error");
        setErrorMessage(error?.message || "Unable to start call right now.");
      } finally {
        setBusyAction(false);
      }
    },
    [user?.uid]
  );

  const acceptCall = useCallback(async () => {
    if (!activeCall) return;
    setBusyAction(true);
    setErrorMessage(null);
    try {
      await acceptCallSession(activeCall.id);
    } catch {
      setCallState("error");
      setErrorMessage("Unable to accept this call.");
    } finally {
      setBusyAction(false);
    }
  }, [activeCall]);

  const declineCall = useCallback(async () => {
    if (!activeCall) return;
    setBusyAction(true);
    try {
      await declineCallSession(activeCall.id);
      cleanupRtc();
    } finally {
      setBusyAction(false);
    }
  }, [activeCall, cleanupRtc]);

  // Leaving this screen would drop the call: ask first
  const navigation = useNavigation<any>();
  const inCallRef = useRef(false);
  inCallRef.current = !!activeCall && ["ringing", "accepted"].includes(String(activeCall.status));
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (e: any) => {
        if (!inCallRef.current) return;
        e.preventDefault();
        Alert.alert("End the call?", "Leaving this screen ends your call.", [
          { text: "Stay", style: "cancel" },
          {
            text: "End call",
            style: "destructive",
            onPress: async () => {
              try {
                if (activeCallRef.current) await endCallSession(activeCallRef.current.id);
              } catch {}
              cleanupRtc();
              inCallRef.current = false;
              navigation.dispatch(e.data.action);
            },
          },
        ]);
      }),
    [navigation, cleanupRtc]
  );
  const activeCallRef = useRef<CallSession | null>(null);
  activeCallRef.current = activeCall;

  const endCall = useCallback(async () => {
    if (!activeCall) return;
    setBusyAction(true);
    try {
      await endCallSession(activeCall.id);
      cleanupRtc();
    } finally {
      setBusyAction(false);
    }
  }, [activeCall]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    rtcRef.current?.mute(next);
    setMuted(next);
  }, [muted]);

  const isIncoming =
    !!user?.uid && !!activeCall && activeCall.status === "ringing" && activeCall.calleeId === user.uid;
  const canStartCall = !activeCall && !busyAction;

  return (
    <SafeAreaView style={globalStyles.safeArea} edges={["top", "left", "right"]}>
      <View style={[globalStyles.flex1, { padding: 16 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back" style={{ paddingRight: 10, paddingVertical: 4 }}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: "700" }}>Calls</Text>
        </View>
        {callState === "connected" && (
          <Text style={{ color: colors.secondaryText, marginBottom: 10 }}>
            {String(Math.floor(callSeconds / 60)).padStart(2, "0")}:
            {String(callSeconds % 60).padStart(2, "0")}
          </Text>
        )}
        {errorMessage ? (
          <Text style={{ color: "#D32F2F", marginBottom: 10 }}>{errorMessage}</Text>
        ) : null}

        {activeCall && (
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.borderColor,
              borderRadius: 14,
              padding: 14,
              marginBottom: 14,
              backgroundColor: colors.cardBackground,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "700", marginBottom: 4 }}>
              {isIncoming ? "Incoming call" : activeCall.status === "accepted" ? "Call in progress" : "Calling..."}
            </Text>
            <Text style={{ color: colors.secondaryText, marginBottom: 10 }}>
              {activeOtherUser?.username || "User"}
            </Text>

            <View style={{ flexDirection: "row", gap: 10 }}>
              {isIncoming && (
                <TouchableOpacity
                  onPress={acceptCall}
                  disabled={busyAction}
                  style={{
                    backgroundColor: "#2E7D32",
                    borderRadius: 10,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    opacity: busyAction ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Accept</Text>
                </TouchableOpacity>
              )}
              {isIncoming && (
                <TouchableOpacity
                  onPress={declineCall}
                  disabled={busyAction}
                  style={{
                    backgroundColor: "#C62828",
                    borderRadius: 10,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    opacity: busyAction ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Decline</Text>
                </TouchableOpacity>
              )}
              {!isIncoming && (
                <TouchableOpacity
                  onPress={endCall}
                  disabled={busyAction}
                  style={{
                    backgroundColor: "#C62828",
                    borderRadius: 10,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    opacity: busyAction ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>End Call</Text>
                </TouchableOpacity>
              )}
              {activeCall.status === "accepted" && (
                <TouchableOpacity
                  onPress={toggleMute}
                  disabled={busyAction}
                  style={{
                    backgroundColor: muted ? "#616161" : colors.primary,
                    borderRadius: 10,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    opacity: busyAction ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>
                    {muted ? "Unmute" : "Mute"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700", marginBottom: 8 }}>
          Friends
        </Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <FlatList
            data={friends}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <Text style={{ color: colors.secondaryText }}>
                No friends yet. Start chats first to enable 1-to-1 calls.
              </Text>
            }
            renderItem={({ item }) => (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.borderColor,
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 10,
                  backgroundColor: colors.cardBackground,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "600" }}>{item.username}</Text>
                <TouchableOpacity
                  onPress={() => startCall(item.id)}
                  disabled={!canStartCall}
                  style={{
                    backgroundColor: canStartCall ? colors.primary : colors.borderColor,
                    borderRadius: 10,
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Call</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>
      <CoachTour
        id="calls"
        steps={[
          {
            icon: "call",
            title: "Calls",
            body: "Voice-call people you've already chatted with. Tap Call next to their name. Calls use data or Wi-Fi, not airtime.",
          },
        ]}
      />
    </SafeAreaView>
  );
};

export default CallScreen;
