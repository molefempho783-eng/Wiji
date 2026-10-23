// services/drivers.ts — app side of driver registration and verification (see functions/src/drivers.ts)
import { getFunctions, httpsCallable } from "firebase/functions";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { app, auth, db, storage } from "../firebaseConfig";

const functions = getFunctions(app, "us-central1");

async function call<T = any>(name: string, data: any = {}): Promise<T> {
  if (!auth.currentUser) throw new Error("Please sign in first.");
  try {
    return (await httpsCallable(functions, name)(data)).data as T;
  } catch (e: any) {
    throw new Error(e?.message?.replace(/^.*?:\s*/, "") || "Something went wrong. Please try again.");
  }
}

export type DocKey =
  | "idDocument" | "selfie" | "licence" | "prdp" | "proofOfAddress"
  | "licenceDisc" | "roadworthy" | "insurance" | "operatingLicence"
  | "carFront" | "carBack" | "carLeft" | "carRight";

export type DocMeta = { key: DocKey; label: string; help: string; expiry?: "required" | "optional"; selfie?: boolean };

export const PERSONAL_DOCS: DocMeta[] = [
  { key: "idDocument", label: "ID document", help: "Your green ID book, smart ID card (both sides) or passport" },
  { key: "selfie", label: "Live selfie", help: "Taken now with your front camera; we match it to your ID photo", selfie: true },
  { key: "licence", label: "Driver's licence", help: "Your licence card, front side", expiry: "required" },
  { key: "prdp", label: "Professional Driving Permit (PrDP)", help: "Required to carry paying passengers", expiry: "required" },
  { key: "proofOfAddress", label: "Proof of address", help: "Utility bill or bank statement from the last 3 months" },
];

export const VEHICLE_DOCS: DocMeta[] = [
  { key: "licenceDisc", label: "Licence disc", help: "The disc on your windscreen, clearly readable", expiry: "required" },
  { key: "roadworthy", label: "Roadworthy certificate", help: "Valid roadworthy certificate for this car", expiry: "required" },
  { key: "insurance", label: "Insurance", help: "Policy schedule showing cover for paying passengers", expiry: "required" },
  { key: "operatingLicence", label: "Operating licence", help: "E-hailing operating licence, or proof that you've applied", expiry: "optional" },
  { key: "carFront", label: "Car: front", help: "Number plate clearly visible" },
  { key: "carBack", label: "Car: back", help: "Number plate clearly visible" },
  { key: "carLeft", label: "Car: left side", help: "The whole side of the car" },
  { key: "carRight", label: "Car: right side", help: "The whole side of the car" },
];

export const CHECK_LABELS: Record<string, string> = {
  identity: "Identity",
  licence: "Driver's licence",
  prdp: "PrDP",
  criminalRecord: "Criminal record",
  vehicle: "Vehicle and roadworthiness",
  insurance: "Insurance",
  operatingLicence: "Operating licence",
};
export const CHECK_ORDER = Object.keys(CHECK_LABELS);

/** South African ID number: 13 digits with a valid Luhn check digit (same rule as the server). */
export function isValidSaId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id.charAt(12 - i));
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/* ---------- checking the application (the server runs the same rules on submit) ---------- */

/** Turn whatever was typed into YYYY-MM-DD as the person types (digits only, dashes added). */
export function formatDateInput(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

function parseDate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

const startOfToday = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
};

/** Problem with an expiry date, or null if it's fine. */
export function expiryProblem(v: string | undefined, required: boolean): string | null {
  if (!v) return required ? "Add the expiry date" : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Use the format YYYY-MM-DD, e.g. 2027-03-31";
  const dt = parseDate(v);
  if (!dt) return "That date doesn't exist. Check the day and month";
  if (dt <= startOfToday()) return "This has expired. Upload a valid document";
  if (dt.getFullYear() > new Date().getFullYear() + 10) return "Check the year. That's more than 10 years away";
  return null;
}

/** Days until a valid expiry date (for "renew soon" warnings). */
export function daysUntil(v: string | undefined) {
  const dt = v ? parseDate(v) : null;
  return dt ? Math.round((dt.getTime() - startOfToday().getTime()) / 864e5) : null;
}

export const formatDate = (v: string) => {
  const dt = parseDate(v);
  return dt ? dt.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }) : v;
};

export const nameProblem = (v?: string) =>
  !v?.trim() ? "Add your full name" : v.trim().split(/\s+/).length < 2 ? "Add your first name and surname, as on your ID" : null;
export const idProblem = (v: string | undefined, idType: string) =>
  !v ? "Add your ID number" : idType === "passport"
    ? (/^[A-Z0-9]{6,12}$/i.test(v) ? null : "A passport number has 6 to 12 letters and numbers")
    : isValidSaId(v) ? null : "That isn't a valid 13-digit SA ID number";
export const phoneProblem = (v?: string) =>
  !v ? "Add your mobile number" : /^(\+27|0)\d{9}$/.test(v.replace(/[\s-]/g, "")) ? null : "Use a South African mobile number, e.g. 082 123 4567";
export const yearProblem = (v?: string) => {
  if (!v) return "Add the year";
  const y = Number(v);
  const now = new Date().getFullYear();
  return /^\d{4}$/.test(v) && y >= 1990 && y <= now + 1 ? null : `Enter a year between 1990 and ${now + 1}`;
};
export const plateProblem = (v?: string) =>
  !v ? "Add the number plate" : /^[A-Z0-9]{2,10}$/i.test(v.replace(/[\s-]/g, "")) ? null : "Check the number plate (letters and numbers only)";

export type AppProblem = { step: number; text: string };

/** Everything still missing or wrong, grouped by step (0 About you, 1 Documents, 2 Your car, 3 Induction, 4 Submit). */
export function applicationProblems(app: any): AppProblem[] {
  const out: AppProblem[] = [];
  const add = (step: number, text: string | null) => text && out.push({ step, text });
  const p = app?.personal || {};
  const v = app?.vehicle || {};
  const docs = app?.documents || {};
  add(0, nameProblem(p.fullName));
  add(0, idProblem(p.idNumber, p.idType || "sa_id"));
  add(0, phoneProblem(p.phone));
  add(0, p.homeArea?.trim() && Number.isFinite(p.homeAreaLocation?.lat) ? null : "Choose the area you'll drive in from the suggestions");
  const docCheck = (step: number, m: DocMeta) => {
    if (!docs[m.key]?.path) return add(step, `${m.label}: upload it`);
    if (m.expiry) {
      const e = expiryProblem(docs[m.key]?.expiry, m.expiry === "required");
      if (e) add(step, `${m.label} expiry: ${e.charAt(0).toLowerCase()}${e.slice(1)}`);
    }
  };
  PERSONAL_DOCS.forEach((m) => docCheck(1, m));
  add(2, v.make?.trim() ? null : "Car make: add it");
  add(2, v.model?.trim() ? null : "Car model: add it");
  const yp = yearProblem(v.year);
  add(2, yp ? `Car year: ${yp.charAt(0).toLowerCase()}${yp.slice(1)}` : null);
  add(2, v.colour?.trim() ? null : "Car colour: add it");
  const pp = plateProblem(v.plate);
  add(2, pp ? `Number plate: ${pp.charAt(0).toLowerCase()}${pp.slice(1)}` : null);
  VEHICLE_DOCS.forEach((m) => docCheck(2, m));
  add(3, app?.induction?.passed ? null : "Complete the safety induction");
  const c = app?.consents || {};
  add(4, c.backgroundCheck && c.dataUse && c.codeOfConduct ? null : "Tick all three agreements");
  return out;
}

/** Save part of the driver's draft application (merge). */
export async function saveApplication(patch: Record<string, any>) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Please sign in first.");
  await setDoc(doc(db, "driver_applications", uid), { ...patch, status: "draft", updatedAt: serverTimestamp() }, { merge: true });
}

/** Upload a document photo or PDF and record it on the application. */
export async function uploadDriverDoc(key: DocKey, uri: string, mimeType = "image/jpeg") {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Please sign in first.");
  const ext = mimeType === "application/pdf" ? "pdf" : "jpg";
  const path = `driver_docs/${uid}/${key}_${Date.now()}.${ext}`;
  const blob = await (await fetch(uri)).blob();
  await uploadBytes(ref(storage, path), blob, { contentType: mimeType });
  await saveApplication({ documents: { [key]: { path, contentType: mimeType, uploadedAt: serverTimestamp() } } });
  return path;
}

export const submitApplication = () => call("submitDriverApplication");
/** Approved driver: reopen the application to upload renewed documents (keeps driving meanwhile). */
export const reopenApplication = () => call("reopenDriverApplication");
/** Stop updating and go back to the documents that were approved. */
export const cancelDocumentUpdate = () => call("cancelDriverUpdate");

/** Expiring documents on an application, soonest first, with days left (negative = expired). */
export function expiryList(documents: Record<string, any> | undefined) {
  return [...PERSONAL_DOCS, ...VEHICLE_DOCS]
    .filter((m) => m.expiry && documents?.[m.key]?.expiry)
    .map((m) => ({ key: m.key, label: m.label, date: String(documents![m.key].expiry), days: daysUntil(documents![m.key].expiry) ?? 0 }))
    .sort((a, b) => a.days - b.days);
}

export const reviewApplication = (input: {
  uid: string;
  action: "setCheck" | "approve" | "decline" | "requestChanges";
  check?: string;
  result?: "passed" | "failed" | "pending";
  note?: string;
  reason?: string;
}) => call("reviewDriverApplication", input);

export const grantSafetyRole = (email: string, role: "safety" | "admin" | "none") => call("grantSafetyRole", { email, role });

/** True if the signed-in user is on the safety team (custom claim). */
/** Wiji team role from Firestore (safetyTeam/{uid}), or null. */
export async function getStaffRole(): Promise<"admin" | "safety" | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const role = (await getDoc(doc(db, "safetyTeam", uid))).data()?.role;
    return role === "admin" || role === "safety" ? role : null;
  } catch {
    return null;
  }
}

export async function isSafetyStaff(_forceRefresh = false): Promise<boolean> {
  return (await getStaffRole()) !== null;
}

/** Emails listed here see the Safety team entry so they can activate admin access the first time.
 *  The server (SAFETY_ADMIN_EMAILS in functions/.env) is what actually allows it. */
export function isBootstrapAdmin(): boolean {
  const email = (auth.currentUser?.email || "").toLowerCase();
  const list = String(process.env.EXPO_PUBLIC_SAFETY_ADMIN_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return !!email && list.includes(email);
}

export async function isAdmin(): Promise<boolean> {
  return (await getStaffRole()) === "admin";
}
