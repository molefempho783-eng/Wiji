// Wiji Admin: sign-in gate, layout and routing (#/overview, #/alerts, #/drivers[/uid], #/businesses[/uid], #/team).
import { auth, db, doc, getDoc, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, call } from "./firebase.js";
import { h, icon, toast, busy } from "./ui.js";
import { startStore, stopStore, subscribe, counts } from "./store.js";
import { renderOverview } from "./pages/overview.js";
import { renderAlerts } from "./pages/alerts.js";
import { renderDrivers, renderDriver } from "./pages/drivers.js";
import { renderBusinesses, renderBusiness } from "./pages/businesses.js";
import { renderTeam } from "./pages/team.js";
import { startPortal, stopPortal } from "./biz/portal.js";

const root = document.getElementById("root");
export const session = { user: null, role: null, biz: null };

// Admin who also owns a business: remember which side they last used (this browser only)
const MODE_KEY = "wiji-mode";
const getMode = () => {
  try { return localStorage.getItem(MODE_KEY); } catch { return null; }
};
export function switchMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  location.hash = "#/overview";
  location.reload();
}

const logo = (text = "Wiji Admin") => h("div", { class: "logo" }, h("img", { class: "logo-mark", src: "logo.png", alt: "Wiji", width: 34, height: 34 }), h("span", {}, text));

/* ---------- sign in ---------- */
function signInView(message) {
  const email = h("input", { class: "input", type: "email", autocomplete: "username", required: true, "aria-label": "Email" });
  const pass = h("input", { class: "input", type: "password", autocomplete: "current-password", required: true, "aria-label": "Password" });
  const err = h("div", { class: "error", role: "alert" }, message || "");
  const btn = h("button", { class: "btn primary", type: "submit", style: { width: "100%" } }, "Sign in");
  const form = h("form", { onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      btn.disabled = true;
      try {
        await signInWithEmailAndPassword(auth, email.value.trim(), pass.value);
      } catch (e2) {
        err.textContent = /invalid|wrong|not-found|credential/i.test(e2.code || "") ? "Wrong email or password." : e2.message;
      } finally {
        btn.disabled = false;
      }
    } },
    h("label", { class: "field" }, h("span", {}, "Email"), email),
    h("label", { class: "field" }, h("span", {}, "Password"), pass),
    btn,
    err,
    h("p", { class: "small muted", style: { marginTop: "14px" } },
      h("a", { href: "#", onclick: async (e) => {
        e.preventDefault();
        if (!email.value.trim()) return (err.textContent = "Type your email first, then tap “Forgot password”.");
        await sendPasswordResetEmail(auth, email.value.trim()).catch(() => undefined);
        toast("If that email has a Wiji account, a reset link is on its way.");
      } }, "Forgot password?")));
  root.replaceChildren(
    h("div", { class: "signin" },
      h("div", { class: "signin-card" }, logo("Wiji"),
        h("p", { class: "muted", style: { margin: "10px 0 18px" } }, "For verified businesses and the Wiji team. Sign in with the email and password of your Wiji app account."),
        form)));
  email.focus();
}

/* ---------- signed in but not staff and no verified business ---------- */
const BIZ_STATUS = {
  draft: "You've started setting up your business but haven't sent it for verification yet. Finish it in the Wiji app: Profile → Business.",
  submitted: "Your business is waiting for Wiji to verify it. We'll notify you in the app, then you can sign in here.",
  in_review: "Wiji is checking your business now. We'll notify you in the app, then you can sign in here.",
  declined: "Your business verification was declined. Check the reason in the Wiji app: Profile → Business.",
  suspended: "Your business is suspended, so the business portal is closed. Check the reason in the Wiji app.",
  verified: "Your business is verified. Your shop is being set up: try again in a minute.",
};
async function noAccessView(user, biz) {
  let status = biz ? (biz.active ? null : "suspended") : null;
  if (!status) {
    try {
      const v = await getDoc(doc(db, "business_verifications", user.uid));
      if (v.exists()) status = v.data().status || "draft";
    } catch {}
  }
  if (status) {
    root.replaceChildren(
      h("div", { class: "signin" },
        h("div", { class: "signin-card" }, logo("Wiji Business"),
          h("h2", { style: { marginTop: "16px" } }, status === "suspended" ? "Business portal closed" : "Not verified yet"),
          h("p", { class: "muted" }, BIZ_STATUS[status] || BIZ_STATUS.draft),
          h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: () => location.reload() }, "Check again"), h("button", { class: "btn", onclick: () => signOut(auth) }, "Sign out")))));
    return;
  }
  return staffNoAccessView(user);
}
function staffNoAccessView(user) {
  const btn = h("button", { class: "btn primary" }, "I'm the owner: make me admin");
  btn.onclick = () =>
    busy(btn, async () => {
      await call("grantSafetyRole", { email: user.email, role: "admin" });
      location.reload();
    });
  root.replaceChildren(
    h("div", { class: "signin" },
      h("div", { class: "signin-card" }, logo(),
        h("h2", { style: { marginTop: "16px" } }, "You don't have access yet"),
        h("p", { class: "muted" }, `${user.email} doesn't have a verified business or a Wiji team role.`),
        h("p", { class: "muted" }, "Run a business? In the Wiji app, go to Profile, choose Business and get verified. Then sign in here to manage orders, your menu and customers."),
        h("p", { class: "small muted", style: { marginTop: "14px" } }, h("b", {}, "Wiji team: "), "ask an admin to add you on the Team page."),
        h("p", { class: "small muted" }, "Owner: in the Firebase console, open Firestore → safetyTeam, add a document with this ID and a field role = \"admin\":"),
        h("p", { class: "small mono", style: { userSelect: "all", background: "var(--panel-2)", padding: "6px 8px", borderRadius: "8px" } }, user.uid),
        h("p", { class: "small muted" }, "Or, if your email is in SAFETY_ADMIN_EMAILS (functions/.env):"),
        h("div", { class: "btn-row" }, btn, h("button", { class: "btn", onclick: () => signOut(auth) }, "Sign out")))));
}

/* ---------- admin who also owns a business ---------- */
function chooseView(user) {
  const option = (mode, icn, title, sub) =>
    h("button", { class: "panel choice", onclick: () => switchMode(mode) },
      icon(icn, "icon big"), h("div", {}, h("h3", {}, title), h("p", { class: "muted small" }, sub)));
  root.replaceChildren(
    h("div", { class: "signin" },
      h("div", { class: "signin-card", style: { maxWidth: "520px" } }, logo("Wiji"),
        h("h2", { style: { marginTop: "16px" } }, "Where do you want to go?"),
        h("p", { class: "muted" }, `${user.email} is on the Wiji team and owns ${session.biz?.name || "a business"}. You can switch any time from the menu.`),
        h("div", { class: "grid", style: { marginTop: "12px" } },
          option("business", "store", session.biz?.name || "My business", "Orders, menu and prices, deals, customers and sales"),
          option("admin", "overview", "Wiji Admin", "Analytics, alerts, drivers, businesses and team")),
        h("p", { class: "small", style: { marginTop: "14px" } }, h("a", { href: "#", onclick: (e) => (e.preventDefault(), signOut(auth)) }, "Sign out")))));
}

async function renderMyBusiness(main) {
  if (session.biz?.active) {
    main.append(h("div", { class: "panel" }, h("h1", {}, session.biz.name), h("p", { class: "muted" }, "Manage orders, your menu, deals and customers."),
      h("button", { class: "btn primary", onclick: () => switchMode("business") }, "Open my business")));
    return;
  }
  let status = session.biz ? "suspended" : null;
  if (!status) {
    try {
      const v = await getDoc(doc(db, "business_verifications", session.user.uid));
      if (v.exists()) status = v.data().status || "draft";
    } catch {}
  }
  main.append(h("div", { class: "panel" },
    h("h1", {}, "My business"),
    h("p", { class: "muted" }, status ? BIZ_STATUS[status] || BIZ_STATUS.draft
      : "Your account doesn't have a verified business yet. In the Wiji app, go to Profile, choose Business and send your details for verification. Then approve it on the Businesses page, and your business portal opens here."),
    status && ["submitted", "in_review"].includes(status)
      ? h("a", { class: "btn primary", href: `#/businesses/${session.user.uid}` }, "Review my business application")
      : null));
}

/* ---------- layout ---------- */
const NAV = [
  ["overview", "Overview", "overview"],
  ["alerts", "Alerts", "alert"],
  ["drivers", "Drivers", "car"],
  ["businesses", "Businesses", "store"],
  ["team", "Team", "team"],
];
let main;
let navLinks = {};

function shell(hasShop = false) {
  navLinks = {};
  const nav = h("nav", { class: "nav", "aria-label": "Main" },
    [...NAV, ["mybusiness", "My business", "store"]].map(([key, label, ic]) => {
      const count = h("span", { class: "count hidden" });
      const a = h("a", { href: `#/${key}` }, icon(ic), h("span", { class: "label" }, label), count);
      navLinks[key] = { a, count };
      return a;
    }));
  main = h("main", { class: "main", id: "main" });
  root.replaceChildren(
    h("div", { class: "shell" },
      h("aside", { class: "side" }, logo(), nav,
        h("div", { class: "side-foot" },
          h("div", {}, session.user.email),
          h("div", {}, `Role: ${session.role}`),
          hasShop ? h("div", {}, h("a", { href: "#", onclick: (e) => (e.preventDefault(), switchMode("business")) }, "Switch to my business")) : null,
          h("div", {}, h("a", { href: "#", onclick: (e) => (e.preventDefault(), signOut(auth)) }, "Sign out")))),
      main));
  updateBadges();
}

function updateBadges() {
  const c = counts();
  const set = (key, n, hot) => {
    const l = navLinks[key];
    if (!l) return;
    l.count.textContent = String(n);
    l.count.classList.toggle("hidden", !n);
    l.count.classList.toggle("hot", !!hot);
  };
  set("alerts", c.alerts, c.sosOpen > 0);
  set("drivers", c.drivers);
  set("businesses", c.businesses);
}
subscribe(updateBadges);

/* ---------- routing ---------- */
let cleanup = null;
function route() {
  if (!session.role || !main) return;
  const [, page = "overview", id] = location.hash.split("/");
  Object.entries(navLinks).forEach(([k, l]) => l.a.classList.toggle("on", k === page));
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  main.replaceChildren();
  window.scrollTo(0, 0);
  const pages = {
    overview: () => renderOverview(main),
    alerts: () => renderAlerts(main),
    drivers: () => (id ? renderDriver(main, decodeURIComponent(id)) : renderDrivers(main)),
    businesses: () => (id ? renderBusiness(main, decodeURIComponent(id)) : renderBusinesses(main)),
    team: () => renderTeam(main, session),
    mybusiness: () => renderMyBusiness(main),
  };
  try {
    cleanup = (pages[page] || pages.overview)();
  } catch (e) {
    console.error(e);
    main.append(h("div", { class: "panel" }, "This page couldn't load: ", e.message));
  }
}
window.addEventListener("hashchange", route);

/* ---------- auth ---------- */
onAuthStateChanged(auth, async (user) => {
  stopStore();
  stopPortal();
  session.user = user;
  session.role = null;
  if (!user) return signInView();
  try {
    // Role lives in Firestore: safetyTeam/{uid} with role "admin" or "safety"
    const snap = await getDoc(doc(db, "safetyTeam", user.uid));
    const role = snap.exists() ? snap.data().role : null;
    const staff = role === "admin" || role === "safety";
    // Verified business: businesses/{uid} is written by Cloud Functions on approval
    let biz = null;
    try {
      const b = await getDoc(doc(db, "businesses", user.uid));
      biz = b.exists() ? b.data() : null;
    } catch {}
    const hasShop = biz?.active === true;
    session.biz = biz;
    if (hasShop && !staff) return startPortal(root, user, { staff: false });
    if (hasShop && staff) {
      const mode = getMode();
      if (mode === "business") return startPortal(root, user, { staff: true });
      if (mode !== "admin") return chooseView(user);
    }
    if (!staff) return noAccessView(user, biz);
    document.title = "Wiji Admin";
    session.role = role;
    shell(hasShop);
    startStore();
    if (!location.hash) location.hash = "#/overview";
    route();
  } catch (e) {
    signInView(e.message);
  }
});
