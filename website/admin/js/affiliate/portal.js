// Promoter (affiliate) portal: apply, then see your code, link, referrals and commissions (#/promote, #/commissions).
// Promoters who are also drivers get the same pages inside the driver portal (see driver/portal.js).
import { auth, db, signOut, call, collection, doc, getDoc, getDocs, onSnapshot, query, where } from "../firebase.js";
import { h, icon, fill, toMs, fmtDate, chip, toast, busy } from "../ui.js";

// Keep in step with functions/.env (AFFILIATE_RATE_PERCENT, AFFILIATE_HOLD_DAYS, AFFILIATE_*_WINDOW_DAYS)
export const PROGRAM = { rate: 20, holdDays: 30, payerDays: 90, payeeDays: 180, minPayoutRand: 200, claimDays: 7 };

const zar = (cents) => `R${(Number(cents || 0) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const linkFor = (code) => `${location.origin}/r/${code}/`;

/** The promoter document for this user, or null. */
export async function getAffiliate(uid) {
  try {
    const s = await getDoc(doc(db, "affiliates", uid));
    return s.exists() ? s.data() : null;
  } catch {
    return null;
  }
}

/** Where a commission stands, in plain words. */
export function entryState(e, now = Date.now()) {
  if (e.status === "paid") return ["Paid", "good"];
  if (e.status === "reversed") return ["Cancelled", "bad"];
  if (e.status === "flagged") return ["Being checked", "warn"];
  if (e.status === "held") return ["On hold", "warn"];
  if (e.status === "processing") return ["Being sent", "info"];
  return (toMs(e.availableAt) || Infinity) <= now ? ["Ready to pay", "info"] : ["Waiting", ""];
}

export function summarise(entries, now = Date.now()) {
  const t = { waiting: 0, ready: 0, paid: 0, checking: 0, paying: 0 };
  for (const e of entries) {
    const c = Number(e.commissionCents) || 0;
    if (e.status === "paid") t.paid += c;
    else if (e.status === "pending") (toMs(e.availableAt) || Infinity) <= now ? (t.ready += c) : (t.waiting += c);
    else if (e.status === "flagged" || e.status === "held") t.checking += c;
    else if (e.status === "processing") t.paying += c;
  }
  return t;
}

const SIDE = { payer: "Their payment", payee: "Paid to them" };
const KIND = { ride: "Trip", order: "Shop order", group: "Paid group", payment: "Payment" };
const kpi = (label, value, sub) => h("div", { class: "panel kpi" }, h("div", { class: "label" }, label), h("div", { class: "value mono" }, value), sub ? h("div", { class: "sub" }, sub) : null);

/* ---------- dashboard ---------- */
export function renderPromote(main, uid) {
  const body = h("div", {}, h("div", { class: "boot", style: { minHeight: "40vh" } }, h("div", { class: "spinner" })));
  main.append(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Promote Wiji"), h("span", { class: "muted small" }, "Share your code. You earn when the people you bring in use Wiji."))),
    body);
  (async () => {
    try {
      const [aff, led, refs, payee] = await Promise.all([
        getAffiliate(uid),
        getDocs(query(collection(db, "affiliateLedger"), where("affiliateUid", "==", uid))),
        getDocs(query(collection(db, "referrals"), where("affiliateUid", "==", uid))),
        getDoc(doc(db, "payees", uid)).catch(() => null),
      ]);
      if (!aff) return fill(body, h("div", { class: "panel" }, h("p", {}, "You're not a Wiji promoter yet.")));
      const entries = led.docs.map((d) => d.data());
      const people = refs.docs.map((d) => d.data()).sort((a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0));
      const paying = new Set(entries.filter((e) => e.status !== "reversed").map((e) => e.referredUid));
      const t = summarise(entries);
      const link = linkFor(aff.code);
      const copy = (text, msg) => navigator.clipboard.writeText(text).then(() => toast(msg, "good")).catch(() => toast(text));
      const pd = payee?.data?.();
      const frozen = aff.status === "frozen";
      fill(body,
        frozen ? h("div", { class: "banner warn" }, h("b", {}, "Your promoter account is paused. "), aff.decision?.reason || "The Wiji team is checking something.", " New earnings are kept on hold until it's sorted.") : null,
        h("div", { class: "panel" },
          h("h3", {}, "Your code"),
          h("div", { class: "row", style: { display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" } },
            h("span", { class: "mono", style: { fontSize: "26px", fontWeight: "800", letterSpacing: ".06em" } }, aff.code),
            h("button", { class: "btn small", onclick: () => copy(aff.code, "Code copied") }, "Copy code")),
          h("p", { class: "muted small", style: { marginTop: "12px" } }, "Your link (people see your name and your code, then download Wiji):"),
          h("div", { style: { display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" } },
            h("span", { class: "mono small", style: { userSelect: "all", background: "var(--panel-2)", padding: "6px 10px", borderRadius: "8px", wordBreak: "break-all" } }, link),
            h("button", { class: "btn small primary", onclick: () => copy(link, "Link copied") }, "Copy link"),
            navigator.share ? h("button", { class: "btn small", onclick: () => navigator.share({ title: "Join me on Wiji", text: `Sign up to Wiji with my code ${aff.code}`, url: link }).catch(() => undefined) }, "Share") : null),
          h("p", { class: "small muted", style: { marginTop: "12px" } }, "When you post about Wiji, add #ad or #sponsored so your followers know you earn from it.")),
        h("div", { class: "grid kpis", style: { marginTop: "14px" } },
          kpi("Link visits", String(aff.stats?.clicks || 0)),
          kpi("Sign-ups", String(people.length), `${paying.size} of them earned you money`),
          kpi("Ready to pay", zar(t.ready), `${zar(t.waiting)} still in the ${PROGRAM.holdDays}-day hold`),
          kpi("Paid to you", zar(t.paid), [t.paying ? `${zar(t.paying)} being sent` : "", t.checking ? `${zar(t.checking)} being checked` : ""].filter(Boolean).join(" · ") || null)),
        h("div", { class: "panel", style: { marginTop: "14px" } },
          h("h3", {}, "Payout account"),
          pd ? h("p", {}, `${pd.bankName || "Bank"} ••• ${pd.accountLast4 || ""}`, h("span", { class: "muted" }, ` (${pd.accountHolder || pd.businessName || ""})`))
             : h("p", { class: "muted" }, "Not set up yet. In the Wiji app go to Profile → Payouts and add the bank account you want to be paid into."),
          h("p", { class: "small muted" }, `The Wiji team pays promoters by EFT, usually once a month, when at least R${PROGRAM.minPayoutRand} is ready.`)),
        h("div", { class: "panel", style: { marginTop: "14px" } },
          h("h3", {}, "People you brought in"),
          people.length
            ? h("div", { class: "table-wrap" }, h("table", {},
                h("thead", {}, h("tr", {}, h("th", {}, "Joined"), h("th", {}, "Username"), h("th", {}, "Earning you money?"))),
                h("tbody", {}, people.slice(0, 200).map((p) => h("tr", {},
                  h("td", {}, fmtDate(p.createdAt, false)),
                  h("td", {}, p.referredName || "Wiji user"),
                  h("td", {}, paying.has(p.referredUid) ? chip("Yes", "good") : chip("Not yet")))))))
            : h("p", { class: "muted" }, "Nobody yet. Share your link and ask people to type your code when they sign up.")),
        howItWorks());
    } catch (e) {
      console.error(e);
      fill(body, h("div", { class: "panel" }, h("h3", {}, "Couldn't load your promoter page"), h("p", { class: "muted" }, e.message)));
    }
  })();
}

function howItWorks() {
  return h("div", { class: "panel", style: { marginTop: "14px" } },
    h("h3", {}, "How you earn"),
    h("ul", { class: "muted" },
      h("li", {}, `Wiji keeps a small fee on payments in the app. You get ${PROGRAM.rate}% of what Wiji keeps after Paystack's fee.`),
      h("li", {}, `People you bring in: you earn on their payments for ${PROGRAM.payerDays} days after their first one.`),
      h("li", {}, `Drivers, businesses and paid-group creators you bring in: you earn on the payments they receive for ${PROGRAM.payeeDays} days after their first one.`),
      h("li", {}, `A commission can be paid ${PROGRAM.holdDays} days after the payment it came from, in case of a refund.`),
      h("li", {}, "You don't earn for sign-ups alone, for your own payments, or for payments between you and the people you referred.")));
}

/* ---------- commissions ---------- */
export function renderCommissions(main, uid) {
  const body = h("div", {}, h("div", { class: "boot", style: { minHeight: "40vh" } }, h("div", { class: "spinner" })));
  main.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Commissions"), h("span", { class: "muted small" }, "Every amount you've earned, and where it stands."))), body);
  (async () => {
    try {
      const [led, pays] = await Promise.all([
        getDocs(query(collection(db, "affiliateLedger"), where("affiliateUid", "==", uid))),
        getDocs(query(collection(db, "affiliatePayouts"), where("affiliateUid", "==", uid))),
      ]);
      const rows = led.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0));
      const payouts = pays.docs.map((d) => d.data()).filter((p) => !p.status || p.status === "paid").sort((a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0));
      fill(body,
        h("div", { class: "panel" },
          rows.length
            ? h("div", { class: "table-wrap" }, h("table", {},
                h("thead", {}, h("tr", {}, ["Date", "From", "For", "Payment", "You earn", "Status"].map((x, i) => h("th", { style: i >= 3 && i <= 4 ? { textAlign: "right" } : null }, x)))),
                h("tbody", {}, rows.slice(0, 300).map((e) => {
                  const [label, tone] = entryState(e);
                  return h("tr", {},
                    h("td", {}, fmtDate(e.createdAt)),
                    h("td", {}, e.referredName || "Wiji user"),
                    h("td", {}, `${KIND[e.kind] || "Payment"} · ${SIDE[e.side] || ""}`),
                    h("td", { class: "mono", style: { textAlign: "right" } }, zar(e.amountCents)),
                    h("td", { class: "mono", style: { textAlign: "right" } }, zar(e.commissionCents)),
                    h("td", {}, chip(label, tone), label === "Waiting" ? h("div", { class: "small muted" }, `ready ${fmtDate(e.availableAt, false)}`) : null));
                }))))
            : h("p", { class: "muted" }, "No commissions yet. They show here as soon as someone you referred pays or gets paid in Wiji.")),
        h("div", { class: "panel", style: { marginTop: "14px" } },
          h("h3", {}, "Payouts"),
          payouts.length
            ? h("div", { class: "table-wrap" }, h("table", {},
                h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", {}, "Note"), h("th", { style: { textAlign: "right" } }, "Amount"))),
                h("tbody", {}, payouts.map((p) => h("tr", {}, h("td", {}, fmtDate(p.createdAt, false)), h("td", {}, p.note || (p.method === "auto" ? "Bank transfer" : "EFT")), h("td", { class: "mono", style: { textAlign: "right" } }, zar(p.amountCents)))))))
            : h("p", { class: "muted" }, "No payouts yet.")));
    } catch (e) {
      console.error(e);
      fill(body, h("div", { class: "panel" }, h("h3", {}, "Couldn't load your commissions"), h("p", { class: "muted" }, e.message)));
    }
  })();
}

/* ---------- apply / application status ---------- */
const logo = (text) => h("div", { class: "logo" }, h("img", { class: "logo-mark", src: "logo.png", alt: "Wiji", width: 34, height: 34 }), h("span", {}, text));

/** Application form, or the status of an application that isn't approved. `back` returns to the previous screen. */
export function renderApply(root, user, aff, back) {
  const card = h("div", { class: "signin-card", style: { maxWidth: "560px" } }, logo("Wiji Promoters"));
  root.replaceChildren(h("div", { class: "signin" }, card));
  const footer = h("div", { class: "btn-row" },
    back ? h("button", { class: "btn", onclick: back }, "Back") : null,
    h("button", { class: "btn", onclick: () => signOut(auth) }, "Sign out"));

  if (aff?.status === "pending") {
    card.append(
      h("h2", { style: { marginTop: "16px" } }, "Application received"),
      h("p", { class: "muted" }, `Thanks, ${aff.name}. The Wiji team is looking at your application for the code `, h("b", { class: "mono" }, aff.code), ". We'll notify you in the Wiji app, then you can sign in here to get your link."),
      h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: () => location.reload() }, "Check again")),
      footer);
    return;
  }

  const val = (k) => (aff && aff.status === "declined" ? aff[k] || "" : "");
  const name = h("input", { class: "input", maxlength: 60, value: val("name"), "aria-label": "Your name or the name you post as" });
  const code = h("input", { class: "input mono", maxlength: 15, value: val("code"), placeholder: "THABO10", "aria-label": "Your code", oninput: () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "")) });
  const channels = h("input", { class: "input", maxlength: 300, value: val("channels"), placeholder: "@thabo on TikTok and Instagram, Hatfield campus", "aria-label": "Where you'll promote Wiji" });
  const audience = h("textarea", { class: "input", maxlength: 600, "aria-label": "Tell us about your audience" }, val("audience"));
  const agree = h("input", { type: "checkbox", "aria-label": "I accept the promoter terms" });
  const err = h("div", { class: "error", role: "alert" });
  const btn = h("button", { class: "btn primary", type: "submit", style: { width: "100%" } }, "Send application");
  const form = h("form", { onsubmit: (e) => {
      e.preventDefault();
      err.textContent = "";
      busy(btn, async () => {
        try {
          await call("affiliateApply", { name: name.value, code: code.value, channels: channels.value, audience: audience.value, acceptTerms: agree.checked });
          renderApply(root, user, { status: "pending", name: name.value.trim(), code: code.value }, back);
        } catch (e2) {
          err.textContent = e2.message;
        }
      });
    } },
    h("label", { class: "field" }, h("span", {}, "Your name (or the name you post as)"), name),
    h("label", { class: "field" }, h("span", {}, "The code you want (4 to 15 letters or numbers)"), code),
    h("label", { class: "field" }, h("span", {}, "Where you'll promote Wiji"), channels),
    h("label", { class: "field" }, h("span", {}, "Your audience (optional): who follows you, roughly how many"), audience),
    h("div", { class: "panel", style: { margin: "6px 0 12px", padding: "12px 14px" } },
      h("b", {}, "Promoter terms"),
      h("ul", { class: "small muted", style: { margin: "6px 0 0", paddingLeft: "18px" } },
        h("li", {}, `You earn ${PROGRAM.rate}% of the fee Wiji keeps (after Paystack's fee) on payments by the people you bring in, for ${PROGRAM.payerDays} days, and on payments to drivers, businesses and group creators you bring in, for ${PROGRAM.payeeDays} days.`),
        h("li", {}, `Nothing is paid for sign-ups alone. A commission can be paid ${PROGRAM.holdDays} days after the payment it came from, in case of a refund. Wiji pays by bank transfer, usually monthly, once at least R${PROGRAM.minPayoutRand} is ready.`),
        h("li", {}, `People must type your code when they sign up, or within ${PROGRAM.claimDays} days of creating their account.`),
        h("li", {}, "Say you're paid to promote Wiji: add #ad or #sponsored to your posts."),
        h("li", {}, "No fake accounts, using your own code, spam or misleading claims about Wiji. If we find any, we cancel those earnings and may close your promoter account."),
        h("li", {}, "Wiji can change these terms or the commission rate; we'll tell you before it affects you.")),
      h("p", { class: "small", style: { margin: "10px 0 0" } },
        h("a", { href: "/promoters/", target: "_blank", rel: "noopener" }, "How the programme works"), " · ",
        h("a", { href: "/promoters/terms/", target: "_blank", rel: "noopener" }, "Full promoter terms"), " · ",
        h("a", { href: "/terms/", target: "_blank", rel: "noopener" }, "Terms and Conditions"), " · ",
        h("a", { href: "/privacy/", target: "_blank", rel: "noopener" }, "Privacy Policy"))),
    h("label", { style: { display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "12px" } }, agree, h("span", { class: "small" }, "I accept the promoter terms, the Wiji Terms and Conditions and the Privacy Policy.")),
    btn, err);

  card.append(
    h("h2", { style: { marginTop: "16px" } }, aff?.status === "declined" ? "Apply again" : "Become a Wiji promoter"),
    aff?.status === "declined"
      ? h("div", { class: "banner warn" }, h("b", {}, "Your last application wasn't approved. "), aff.decision?.reason || "")
      : h("p", { class: "muted" }, `Get your own code and link. When people you bring in use Wiji, you earn a share of Wiji's fee. Signed in as ${user.email}.`),
    form,
    footer);
  name.focus();
}

/* ---------- promoter-only portal ---------- */
const NAV = [
  ["promote", "Promote", "tag"],
  ["commissions", "Commissions", "receipt"],
];
let active = false;
let main = null;
let links = {};
let uidNow = null;
let unsub = null;

export function startAffiliatePortal(root, user, aff) {
  active = true;
  uidNow = user.uid;
  document.title = "Wiji Promoter";
  links = {};
  const nav = h("nav", { class: "nav", "aria-label": "Main" },
    NAV.map(([key, label, ic]) => (links[key] = h("a", { href: `#/${key}` }, icon(ic), h("span", { class: "label" }, label)))));
  main = h("main", { class: "main", id: "main" });
  root.replaceChildren(
    h("div", { class: "shell" },
      h("aside", { class: "side" }, logo("Wiji Promoter"), nav,
        h("div", { class: "side-foot" },
          h("b", {}, aff.name || "Promoter"),
          h("div", {}, user.email),
          h("div", {}, h("a", { href: "#", onclick: (e) => (e.preventDefault(), signOut(auth)) }, "Sign out")))),
      main));
  // A status change by the team (approve/freeze) shows up without a refresh
  unsub = onSnapshot(doc(db, "affiliates", user.uid), (s) => {
    const st = s.data()?.status;
    if (active && st && st !== aff.status) location.reload();
  }, () => undefined);
  if (!NAV.some(([k]) => k === location.hash.split("/")[1])) location.hash = "#/promote";
  route();
}

function route() {
  if (!active || !main) return;
  const page = location.hash.split("/")[1] === "commissions" ? "commissions" : "promote";
  Object.entries(links).forEach(([k, a]) => a.classList.toggle("on", k === page));
  main.replaceChildren();
  window.scrollTo(0, 0);
  (page === "commissions" ? renderCommissions : renderPromote)(main, uidNow);
}
window.addEventListener("hashchange", route);

export function stopAffiliatePortal() {
  if (!active) return;
  active = false;
  if (unsub) unsub();
  unsub = null;
  main = null;
  uidNow = null;
}
