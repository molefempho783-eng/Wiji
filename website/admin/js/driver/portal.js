// Driver portal: verified Wiji drivers sign in to see Wiji Pulse and their earnings (#/pulse, #/earnings).
import { auth, db, signOut, collection, doc, getDoc, getDocs, query, where } from "../firebase.js";
import { h, icon, fill, toMs, fmtDate } from "../ui.js";
import { renderPulseFor } from "../biz/pulse.js";

const zar = (cents) => `R${(Number(cents || 0) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const D = { uid: null, name: "Driver" };

const NAV = [
  ["pulse", "Wiji Pulse", "pulse"],
  ["earnings", "Earnings", "car"],
];
const PAGES = {
  pulse: (main) => renderPulseFor(main, { uid: () => D.uid, name: () => D.name, roleLabel: "Verified Wiji driver" }),
  earnings: renderEarnings,
};

let active = false;
let main = null;
let links = {};
let cleanup = null;

export function startDriverPortal(root, user, driver) {
  active = true;
  D.uid = user.uid;
  D.name = [driver?.firstName, driver?.lastName].filter(Boolean).join(" ") || "Driver";
  document.title = "Wiji Driver";
  links = {};
  const nav = h("nav", { class: "nav", "aria-label": "Main" },
    NAV.map(([key, label, ic]) => {
      const a = h("a", { href: `#/${key}` }, icon(ic), h("span", { class: "label" }, label));
      links[key] = a;
      return a;
    }));
  main = h("main", { class: "main", id: "main" });
  root.replaceChildren(
    h("div", { class: "shell" },
      h("aside", { class: "side" },
        h("div", { class: "logo" }, h("img", { class: "logo-mark", src: "logo.png", alt: "Wiji", width: 34, height: 34 }), h("span", {}, "Wiji Driver")),
        nav,
        h("div", { class: "side-foot" },
          h("b", {}, D.name),
          h("div", {}, user.email),
          h("div", {}, h("a", { href: "#", onclick: (e) => (e.preventDefault(), signOut(auth)) }, "Sign out")))),
      main));
  if (!PAGES[location.hash.split("/")[1]]) location.hash = "#/pulse";
  route();
}

function route() {
  if (!active || !main) return;
  const page = location.hash.split("/")[1];
  const key = PAGES[page] ? page : "pulse";
  Object.entries(links).forEach(([k, a]) => a.classList.toggle("on", k === key));
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  main.replaceChildren();
  window.scrollTo(0, 0);
  try {
    cleanup = PAGES[key](main);
  } catch (e) {
    console.error(e);
    main.append(h("div", { class: "panel" }, "This page couldn't load: ", e.message));
  }
}
window.addEventListener("hashchange", route);

export function stopDriverPortal() {
  if (!active) return;
  active = false;
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  main = null;
  D.uid = null;
}

/** Fares and other payments this driver has received through Wiji. */
function renderEarnings(main) {
  const body = h("div", {}, h("div", { class: "boot", style: { minHeight: "40vh" } }, h("div", { class: "spinner" })));
  main.append(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Earnings"), h("span", { class: "muted small" }, "Payments you received through Wiji. Paystack pays them into your bank account, less fees."))),
    body);
  (async () => {
    try {
      const [snap, payee] = await Promise.all([
        getDocs(query(collection(db, "payments"), where("payeeUid", "==", D.uid), where("status", "==", "paid"))),
        getDoc(doc(db, "payees", D.uid)).catch(() => null),
      ]);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).map((p) => ({ ...p, ms: toMs(p.paidAt) || toMs(p.createdAt) || 0 })).sort((a, b) => b.ms - a.ms);
      const now = new Date();
      const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const sum = (xs) => xs.reduce((a, p) => a + (Number(p.amountCents) || 0), 0);
      const week = list.filter((p) => p.ms >= startOfWeek);
      const month = list.filter((p) => p.ms >= startOfMonth);
      const rides = list.filter((p) => p.rideId);
      const kpi = (label, value, sub) => h("div", { class: "panel kpi" }, h("div", { class: "label" }, label), h("div", { class: "value mono" }, value), sub ? h("div", { class: "sub" }, sub) : null);
      const pd = payee?.data?.();
      fill(body,
        h("div", { class: "grid kpis" },
          kpi("This week", zar(sum(week)), `${week.length} payment${week.length === 1 ? "" : "s"}`),
          kpi("This month", zar(sum(month)), `${month.length} payment${month.length === 1 ? "" : "s"}`),
          kpi("All time", zar(sum(list)), `${rides.length} paid trip${rides.length === 1 ? "" : "s"}`),
          kpi("Payout account", pd ? `••• ${pd.accountLast4 || ""}` : "Not set up", pd ? pd.bankName || "Bank" : "Add it in the Wiji app: Profile → Payouts")),
        h("div", { class: "panel", style: { marginTop: "14px" } },
          h("h3", {}, "Recent payments"),
          list.length
            ? h("div", { class: "table-wrap" }, h("table", {},
                h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", {}, "From"), h("th", {}, "For"), h("th", { style: { textAlign: "right" } }, "Amount"))),
                h("tbody", {}, list.slice(0, 100).map((p) =>
                  h("tr", {},
                    h("td", {}, fmtDate(p.ms)),
                    h("td", {}, p.payerName || "Wiji user"),
                    h("td", {}, p.rideId ? "Trip" : p.note || "Payment"),
                    h("td", { class: "mono", style: { textAlign: "right" } }, zar(p.amountCents)))))))
            : h("p", { class: "muted" }, "No payments yet. Fares paid in the Wiji app will show here.")));
    } catch (e) {
      console.error(e);
      fill(body, h("div", { class: "panel" }, h("h3", {}, "Couldn't load your earnings"), h("p", { class: "muted" }, e.message)));
    }
  })();
}
