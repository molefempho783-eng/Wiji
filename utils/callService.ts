import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebaseConfig";

export type CallStatus =
  | "ringing"
  | "accepted"
  | "declined"
  | "ended"
  | "missed"
  | "failed";

export type CallEndReason =
  | "caller_cancelled"
  | "callee_declined"
  | "remote_ended"
  | "timeout_no_answer"
  | "network_failure"
  | "local_cleanup"
  | "unknown";

export type RTCSessionDescriptionLike = {
  type: "offer" | "answer";
  sdp: string;
};

export type RTCIceCandidateLike = {
  candidate: string;
  sdpMLineIndex: number | null;
  sdpMid: string | null;
};

export type CallSession = {
  id: string;
  participants: string[];
  callerId: string;
  calleeId: string;
  status: CallStatus;
  offer?: RTCSessionDescriptionLike | null;
  answer?: RTCSessionDescriptionLike | null;
  offerCandidates?: RTCIceCandidateLike[];
  answerCandidates?: RTCIceCandidateLike[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  endedAt?: Timestamp;
  endReason?: CallEndReason;
  ttlExpiresAt?: Timestamp;
};

const CALL_RING_TIMEOUT_MS = 30_000;

export function buildCallId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

export function getCallDocRef(callId: string) {
  return doc(db, "callSessions", callId);
}

export function subscribeCallSession(
  callId: string,
  callback: (session: CallSession | null) => void
): () => void {
  const ref = getCallDocRef(callId);
  let unsubSnapshot: (() => void) | undefined;
  let serial = 0;

  const attach = async () => {
    const mine = ++serial;
    unsubSnapshot?.();
    unsubSnapshot = undefined;

    if (!auth.currentUser) {
      callback(null);
      return;
    }
    try {
      await auth.currentUser.getIdToken();
    } catch {
      callback(null);
      return;
    }
    if (mine !== serial || !auth.currentUser) return;

    unsubSnapshot = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          callback(null);
          return;
        }
        callback({ id: snap.id, ...(snap.data() as Omit<CallSession, "id">) });
      },
      (err) => {
        console.warn("[callService] subscribeCallSession:", (err as { code?: string }).code ?? err);
        callback(null);
      }
    );
  };

  const unsubAuth = onAuthStateChanged(auth, () => void attach());
  return () => {
    serial += 1;
    unsubAuth();
    unsubSnapshot?.();
  };
}

export function subscribeActiveCallForUser(
  uid: string,
  callback: (session: CallSession | null) => void
): () => void {
  const q = query(
    collection(db, "callSessions"),
    where("participants", "array-contains", uid)
  );

  let unsubSnapshot: (() => void) | undefined;
  let serial = 0;

  const attach = async () => {
    const mine = ++serial;
    unsubSnapshot?.();
    unsubSnapshot = undefined;

    const u = auth.currentUser;
    if (!u || u.uid !== uid) {
      callback(null);
      return;
    }
    try {
      await u.getIdToken();
    } catch {
      callback(null);
      return;
    }
    if (mine !== serial || auth.currentUser?.uid !== uid) return;

    unsubSnapshot = onSnapshot(
      q,
      (snap) => {
        const active = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CallSession, "id">) }))
          .filter((c) => c.status === "ringing" || c.status === "accepted")
          .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))[0];
        callback(active || null);
      },
      (err) => {
        console.warn(
          "[callService] subscribeActiveCallForUser:",
          (err as { code?: string }).code ?? err,
          "| listener uid:",
          uid,
          "| auth.currentUser?.uid:",
          auth.currentUser?.uid
        );
        callback(null);
      }
    );
  };

  const unsubAuth = onAuthStateChanged(auth, () => void attach());
  return () => {
    serial += 1;
    unsubAuth();
    unsubSnapshot?.();
  };
}

export async function startCallSession(callerId: string, calleeId: string): Promise<string> {
  // A new record for every call. (Re-using one record per pair broke the security rules: the first
  // call had to read a record that didn't exist yet, and later calls had to turn an ended call
  // back into a ringing one. It also meant the incoming-call notification only fired once.)
  const nowMs = Date.now();
  // "Already in a call?" check. If it can't run (e.g. offline), place the call anyway.
  let busy = false;
  try {
    const mine = await getDocs(query(collection(db, "callSessions"), where("participants", "array-contains", callerId)));
    busy = mine.docs.some((d) => {
      const c = d.data() as Omit<CallSession, "id">;
      if (c.status === "accepted") return true;
      return c.status === "ringing" && (c.ttlExpiresAt?.toMillis?.() || 0) > nowMs;
    });
  } catch (e: any) {
    console.warn("[callService] busy check failed:", e?.code || e);
  }
  if (busy) throw new Error("You're already in a call. End it first.");

  const callId = `${buildCallId(callerId, calleeId)}_${nowMs.toString(36)}`;
  if (!calleeId || calleeId === callerId) throw new Error("Choose someone to call.");
  await setDoc(getCallDocRef(callId), {
    participants: [callerId, calleeId],
    callerId,
    calleeId,
    status: "ringing",
    offer: null,
    answer: null,
    offerCandidates: [],
    answerCandidates: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ttlExpiresAt: Timestamp.fromMillis(nowMs + CALL_RING_TIMEOUT_MS),
  });
  return callId;
}

export async function acceptCallSession(callId: string) {
  await updateDoc(getCallDocRef(callId), {
    status: "accepted",
    updatedAt: serverTimestamp(),
  });
}

export async function declineCallSession(callId: string) {
  await updateDoc(getCallDocRef(callId), {
    status: "declined",
    endReason: "callee_declined" as CallEndReason,
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function endCallSession(callId: string, reason: CallEndReason = "remote_ended") {
  await updateDoc(getCallDocRef(callId), {
    status: "ended",
    endReason: reason,
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function failCallSession(callId: string, reason: CallEndReason = "network_failure") {
  await updateDoc(getCallDocRef(callId), {
    status: "failed",
    endReason: reason,
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function writeOffer(callId: string, offer: RTCSessionDescriptionLike) {
  await updateDoc(getCallDocRef(callId), {
    offer,
    updatedAt: serverTimestamp(),
  });
}

export async function writeAnswer(callId: string, answer: RTCSessionDescriptionLike) {
  await updateDoc(getCallDocRef(callId), {
    answer,
    updatedAt: serverTimestamp(),
  });
}

export async function addOfferCandidate(callId: string, candidate: RTCIceCandidateLike) {
  await updateDoc(getCallDocRef(callId), {
    offerCandidates: arrayUnion(candidate),
    updatedAt: serverTimestamp(),
  });
}

export async function addAnswerCandidate(callId: string, candidate: RTCIceCandidateLike) {
  await updateDoc(getCallDocRef(callId), {
    answerCandidates: arrayUnion(candidate),
    updatedAt: serverTimestamp(),
  });
}

export async function markMissedCallIfExpired(callId: string) {
  const ref = getCallDocRef(callId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as Omit<CallSession, "id">;
  if (data.status !== "ringing") return;
  const expiresMs = data.ttlExpiresAt?.toMillis?.() || 0;
  if (expiresMs > 0 && Date.now() >= expiresMs) {
    await updateDoc(ref, {
      status: "missed",
      endReason: "timeout_no_answer" as CallEndReason,
      endedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}
