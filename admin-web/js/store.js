// Live queues for the Alerts page and nav badges. Started once after a staff member signs in.
// New emergencies, reports and applications raise a desktop notification, a sound and a toast.
import { db, collection, query, where, onSnapshot } from "./firebase.js";
import { toast, toMs } from "./ui.js";

export const state = {
  sos: [],          // safetyAlerts: open / acknowledged
  incidents: [],    // incidentReports: open / investigating
  driverApps: [],   // driver_applications: submitted / in_review
  businesses: [],   // business_verifications: submitted / in_review
  driversOff: [],   // drivers: paused / suspended
  bankChanges: [],  // payees whose bank account changed in the last 30 days
  ready: false,
};
const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => {
  updateTitle();
  listeners.forEach((fn) => fn(state));
};

export const counts = () => ({
  alerts: state.sos.filter((a) => a.status === "open").length + state.incidents.filter((i) => i.status === "open").length,
  sosOpen: state.sos.filter((a) => a.status === "open").length,
  drivers: state.driverApps.length,
  businesses: state.businesses.length,
});

function updateTitle() {
  const c = counts();
  const n = c.alerts + c.drivers + c.businesses;
  document.title = `${n ? `(${n}) ` : ""}Wiji Admin`;
}

/* ---------- desktop notifications + sound ---------- */
export const notificationsOn = () => "Notification" in window && Notification.permission === "granted";
export async function enableNotifications() {
  if (!("Notification" in window)) return toast("This browser doesn't support desktop alerts.", "bad");
  const p = await Notification.requestPermission();
  toast(p === "granted" ? "Desktop alerts are on." : "Desktop alerts are blocked in your browser settings.", p === "granted" ? "good" : "bad");
  emit();
}
let audio;
function beep(urgent) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const tones = urgent ? [880, 660, 880, 660] : [660];
    tones.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(audio.destination);
      const t = audio.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t);
      o.stop(t + 0.21);
    });
  } catch {}
}
export function announce(title, body, hash, urgent = false) {
  toast(`${title}: ${body}`, urgent ? "bad" : "");
  beep(urgent);
  if (notificationsOn()) {
    const n = new Notification(title, { body, tag: hash, requireInteraction: urgent });
    n.onclick = () => {
      window.focus();
      location.hash = hash;
      n.close();
    };
  }
}

/* ---------- live queries (no composite indexes needed: one filter each, sorted here) ---------- */
const byNewest = (field) => (a, b) => (toMs(b[field]) || 0) - (toMs(a[field]) || 0);

function live(key, q, sortField, onNew) {
  let first = true;
  return onSnapshot(
    q,
    (snap) => {
      if (!first && onNew) snap.docChanges().forEach((c) => c.type === "added" && onNew({ id: c.doc.id, ...c.doc.data() }));
      first = false;
      state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest(sortField));
      state.ready = true;
      emit();
    },
    (err) => {
      console.warn(key, err);
      toast(`Couldn't load ${key}: ${err.code || err.message}`, "bad");
    }
  );
}

let stops = [];
export function startStore() {
  stopStore();
  const since = new Date(Date.now() - 30 * 864e5);
  stops = [
    live("sos", query(collection(db, "safetyAlerts"), where("status", "in", ["open", "acknowledged"])), "createdAt", (a) =>
      announce("EMERGENCY", `A ${a.role || "user"} pressed the emergency button.`, "#/alerts", true)),
    live("incidents", query(collection(db, "incidentReports"), where("status", "in", ["open", "investigating"])), "createdAt", (r) =>
      announce(r.severity <= 2 ? "Serious trip report" : "New trip report", "Open Alerts to review it.", "#/alerts", r.severity <= 2)),
    live("driverApps", query(collection(db, "driver_applications"), where("status", "in", ["submitted", "in_review"])), "submittedAt", (a) =>
      a.reverify
        ? announce("Driver documents to re-check", `${a.personal?.fullName || "A driver"} sent updated documents.`, `#/drivers/${a.id}`)
        : announce("New driver application", a.personal?.fullName || "A driver applied.", `#/drivers/${a.id}`)),
    live("businesses", query(collection(db, "business_verifications"), where("status", "in", ["submitted", "in_review"])), "submittedAt", (b) =>
      announce("New business to verify", b.details?.tradingName || "A business submitted details.", `#/businesses/${b.id}`)),
    live("driversOff", query(collection(db, "drivers"), where("status", "in", ["paused", "suspended"])), "suspendedAt", (d) =>
      d.pausedForExpiry
        ? announce("Driver paused: document expired", `${d.firstName || "A driver"}: ${d.pausedReason || "a document expired"}`, `#/drivers/${d.id}`, false)
        : null),
    live("bankChanges", query(collection(db, "payees"), where("bankChangedAt", ">=", since)), "bankChangedAt"),
  ];
}
export function stopStore() {
  stops.forEach((s) => s());
  stops = [];
}
