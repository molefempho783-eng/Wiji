// functions/src/staff.ts
// Who is on the Wiji team. The role lives in Firestore at safetyTeam/{uid}:
//   { role: "admin" | "safety", email: "..." }
// You can add or remove people by hand in the Firebase console (Firestore → safetyTeam),
// or from the Team page of the admin website. The app and website can't write this collection.
import { HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

export type StaffRole = "admin" | "safety";

export async function staffRole(uid: string | undefined | null): Promise<StaffRole | null> {
  if (!uid) return null;
  const role = (await getFirestore().collection("safetyTeam").doc(uid).get()).get("role");
  return role === "admin" || role === "safety" ? role : null;
}

/** Throws unless the caller is on the Wiji team. */
export async function requireStaff(req: CallableRequest<any>): Promise<{ uid: string; role: StaffRole }> {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  const role = await staffRole(uid);
  if (!role) throw new HttpsError("permission-denied", "Wiji team only.");
  return { uid, role };
}
