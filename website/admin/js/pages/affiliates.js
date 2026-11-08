// Promoters (affiliates): approve applications, see who brings in paying people, check flagged commissions,
// and record payouts. Only admins can record payouts; the safety team can review and freeze.
import { call, db, collection, getDocs, getDoc, doc, onSnapshot } from "../firebase.js";
import { h, chip, fmtDate, busy, toast, askText, confirmBox, dialog, fill, toMs } from "../ui.js";
import { summarise } from "../affiliate/portal.js";

const zar = (cents) => `R${(Number(cents || 0) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS = { pending: ["Waiting for review", "warn"], approved: ["Active", "good"], declined: ["Declined", "bad"], frozen: ["Frozen", "bad"] };

export function renderAffiliates(main, session) {
  const isAdmin = session.role === "admin";
  const apps = h("div", {});
  const flagged = h("div", {});
  const list = h("div", {}, h("p", { class: "muted" }, "Loading…"));
  let ledger = [];
  let affs = [];

  main.append(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Promoters"), h("span", { class: "muted small" }, "Influencers and promoters earn a share of Wiji's fee on payments by the people they bring in. Nothing is paid for sign-ups alone.")),
      h("div", { class: "btn-row", style: { margin: 0 } },
        isAdmin ? h("button", { class: "btn", onclick: (ev) => runPayouts(true, ev.currentTarget) }, "Preview payouts") : null,
        isAdmin ? h("button", { class: "btn primary", onclick: (ev) => runPayouts(false, ev.currentTarget) }, "Pay everyone now") : null,
        h("button", { class: "btn", onclick: () => loadLedger() }, "Refresh earnings"))),
    apps, flagged,
    h("div", { class: "section-title" }, h("h2", {}, "All promoters")), list);

  async function loadLedger() {
    try {
      ledger = (await getDocs(collection(db, "affiliateLedger"))).docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      toast(`Couldn't load commissions: ${e.message}`, "bad");
    }
    paint();
  }

  function review(a, decision, title, message, needReason) {
    return async (ev) => {
      const btn = ev.currentTarget;
      let reason = "";
      if (needReason) {
        reason = await askText({ title, message, label: "Reason (the promoter sees this)", min: 5, confirm: title, kind: decision === "approve" ? "primary" : "danger solid" });
        if (reason === null) return;
      } else if (!(await confirmBox(title, message, title))) return;
      busy(btn, () => call("affiliateReview", { uid: a.uid, decision, reason }), "Saved");
    };
  }

  function actions(a) {
    const st = a.status;
    return h("div", { class: "btn-row", style: { margin: 0 } },
      st === "pending" ? h("button", { class: "btn small good", onclick: review(a, "approve", "Approve", `Approve ${a.name} with the code ${a.code}? Their link goes live and they're notified.`) }, "Approve") : null,
      st === "pending" ? h("button", { class: "btn small danger", onclick: review(a, "decline", "Decline", "Tell them why, so they can apply again.", true) }, "Decline") : null,
      st === "approved" ? h("button", { class: "btn small danger", onclick: review(a, "freeze", "Freeze", "Their earnings go on hold and they can't be paid until you unfreeze them.", true) }, "Freeze") : null,
      st === "frozen" ? h("button", { class: "btn small", onclick: review(a, "unfreeze", "Unfreeze", "Their held earnings count again.") }, "Unfreeze") : null,
      st === "approved" ? h("button", { class: "btn small", onclick: review(a, a.trusted ? "untrust" : "trust", a.trusted ? "Remove trusted" : "Mark trusted",
        a.trusted ? `Put the daily sign-up limit back on ${a.code}?` : `Remove the daily sign-up limit from ${a.code}? Do this for promoters you know, with big audiences.`) }, a.trusted ? "Untrust" : "Trust") : null,
      a.payoutHold && isAdmin ? h("button", { class: "btn small", onclick: (ev) => busy(ev.currentTarget, () => call("affiliateClearPayoutHold", { uid: a.uid }), "Hold cleared") }, "Clear hold") : null,
      st === "approved" && isAdmin ? h("button", { class: "btn small primary", onclick: (ev) => payout(a, ev.currentTarget) }, "Record payout") : null);
  }

  async function payout(a, btn) {
    const t = summarise(ledger.filter((e) => e.affiliateUid === a.uid));
    if (t.ready <= 0) return toast("Nothing is ready to pay yet (commissions wait 30 days).", "bad");
    const payee = await getDoc(doc(db, "payees", a.uid)).then((s) => s.data()).catch(() => null);
    const note = h("input", { class: "input", placeholder: "e.g. EFT ref WIJI-NOV", maxlength: 200, "aria-label": "Note" });
    const ok = await dialog({
      title: `Pay ${a.name} ${zar(t.ready)}`,
      body: h("div", {},
        h("p", {}, "First pay them by EFT from Wiji's bank account. Then record it here: it marks these commissions as paid and notifies them."),
        payee
          ? h("p", { class: "muted small" }, `Their payout account: ${payee.bankName || "Bank"} ••• ${payee.accountLast4 || ""}, ${payee.accountHolder || ""}. Full account details are on the Paystack dashboard → Subaccounts (${payee.subaccountCode || "no code"}).`)
          : h("p", { class: "banner warn" }, "They haven't added a payout account in the app (Profile → Payouts). Ask them for one before you pay."),
        h("label", { class: "field" }, h("span", {}, "Payment reference or note"), note)),
      actions: [{ label: "Cancel", value: false }, { label: "I've paid them: record it", kind: "primary", value: true }],
    });
    if (!ok) return;
    busy(btn, async () => {
      const r = await call("affiliateRecordPayout", { uid: a.uid, note: note.value });
      toast(`Recorded ${zar(r.amountCents)} (${r.entries} commissions).`, "good");
      await loadLedger();
    });
  }

  const OUTCOME = { would_pay: "Would pay", paid: "Paid", sent: "Sent, waiting for the bank", skipped: "Skipped", failed: "Failed", unconfirmed: "Checking with Paystack", needs_otp: "Needs OTP", error: "Error" };

  function showRun(r) {
    const total = r.results.filter((x) => x.outcome === "would_pay" || ["paid", "sent", "unconfirmed", "needs_otp"].includes(x.outcome)).reduce((n, x) => n + x.amountCents, 0);
    return dialog({
      title: r.live ? "Payout run" : "Payout preview (no money moved)",
      body: h("div", {},
        h("p", {}, r.results.length
          ? `${r.results.length} promoter(s) have commissions ready. ${r.live ? "Sent" : "Would send"}: ${zar(total)}.`
          : "Nobody has commissions ready to pay right now."),
        r.results.length ? h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, ["Promoter", "Amount", "Result", "Why"].map((x) => h("th", {}, x)))),
          h("tbody", {}, r.results.map((x) => h("tr", {},
            h("td", {}, x.name, " ", h("span", { class: "mono muted small" }, x.code)),
            h("td", { class: "mono" }, zar(x.amountCents)),
            h("td", {}, OUTCOME[x.outcome] || x.outcome),
            h("td", { class: "small" }, x.note || "")))))) : null,
        r.live ? null : h("p", { class: "muted small" }, "This was a preview. Nothing was sent.")),
      actions: [{ label: "Close", kind: "primary", value: true }],
    });
  }

  async function runPayouts(dryRun, btn) {
    if (!dryRun && !(await confirmBox("Pay everyone now", "This sends real money from Wiji's Paystack balance to every promoter who is ready and over the minimum. Run a preview first if you haven't.", "Pay now"))) return;
    busy(btn, async () => {
      const r = await call("affiliateRunPayouts", { dryRun });
      await showRun(r);
      await loadLedger();
    });
  }

  function paint() {
    const now = Date.now();
    const pending = affs.filter((a) => a.status === "pending");
    fill(apps, pending.length
      ? h("div", {}, h("div", { class: "section-title" }, h("h2", {}, `Applications (${pending.length})`)),
          h("div", { class: "grid two" }, pending.map((a) => h("div", { class: "panel" },
            h("h3", {}, a.name, " ", h("span", { class: "mono muted" }, a.code)),
            h("p", { class: "small muted" }, a.email || a.uid, " · applied ", fmtDate(a.appliedAt)),
            h("p", {}, h("b", {}, "Promotes on: "), a.channels || "—"),
            a.audience ? h("p", { class: "muted" }, a.audience) : null,
            actions(a)))))
      : null);

    const flags = ledger.filter((e) => e.status === "flagged");
    const nameOf = Object.fromEntries(affs.map((a) => [a.uid, `${a.name} (${a.code})`]));
    fill(flagged, flags.length
      ? h("div", {}, h("div", { class: "section-title" }, h("h2", {}, `Commissions to check (${flags.length})`)),
          h("div", { class: "table-wrap" }, h("table", {},
            h("thead", {}, h("tr", {}, ["Date", "Promoter", "Referred", "Why", "Commission", ""].map((x) => h("th", {}, x)))),
            h("tbody", {}, flags.map((e) => {
              const decide = (decision) => (ev) => busy(ev.currentTarget, async () => { await call("affiliateResolveEntry", { id: e.id, decision }); await loadLedger(); }, decision === "approve" ? "Counted" : "Cancelled");
              return h("tr", {},
                h("td", {}, fmtDate(e.createdAt)),
                h("td", {}, nameOf[e.affiliateUid] || e.affiliateUid),
                h("td", {}, e.referredName || "—"),
                h("td", { class: "small" }, (e.flags || []).join("; ")),
                h("td", { class: "mono" }, zar(e.commissionCents)),
                h("td", {}, h("div", { class: "btn-row", style: { margin: 0 } },
                  h("button", { class: "btn small", onclick: decide("approve") }, "It's fine"),
                  h("button", { class: "btn small danger", onclick: decide("reject") }, "Cancel it"))));
            })))))
      : null);

    const rows = affs.filter((a) => a.status !== "pending").map((a) => {
      const mine = ledger.filter((e) => e.affiliateUid === a.uid);
      const paying = new Set(mine.filter((e) => e.status !== "reversed").map((e) => e.referredUid)).size;
      const refunded = mine.filter((e) => e.refundedAfterPayout).length;
      return { a, t: summarise(mine, now), paying, refunded };
    }).sort((x, y) => (y.t.ready + y.t.paid + y.t.waiting) - (x.t.ready + x.t.paid + x.t.waiting));
    fill(list, h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Promoter", "Status", "Visits", "Sign-ups", "Paying", "Waiting", "Ready", "Paid", ""].map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.length ? rows.map(({ a, t, paying, refunded }) => h("tr", {},
        h("td", {}, h("b", {}, a.name), " ", h("span", { class: "mono muted small" }, a.code), a.trusted ? " " : null, a.trusted ? chip("Trusted", "info") : null,
          a.payoutHold ? " " : null, a.payoutHold ? chip("Payout on hold", "bad") : null,
          a.payoutHold ? h("div", { class: "small muted" }, a.payoutHold.reason || "A payout did not complete") : null,
          refunded ? h("div", { class: "small", style: { color: "var(--bad, #c0392b)" } }, `${refunded} paid commission(s) later refunded`) : null),
        h("td", {}, chip(...(STATUS[a.status] || [a.status, ""]))),
        h("td", { class: "mono" }, String(a.stats?.clicks || 0)),
        h("td", { class: "mono" }, String(a.stats?.signups || 0)),
        h("td", { class: "mono" }, String(paying)),
        h("td", { class: "mono" }, zar(t.waiting)),
        h("td", { class: "mono" }, zar(t.ready)),
        h("td", { class: "mono" }, zar(t.paid)),
        h("td", {}, actions(a)))) : h("tr", {}, h("td", { colspan: 9, class: "empty" }, "No promoters yet. People apply at the portal sign-in page."))))));
  }

  loadLedger();
  return onSnapshot(collection(db, "affiliates"), (s) => {
    affs = s.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => (toMs(b.appliedAt) || 0) - (toMs(a.appliedAt) || 0));
    paint();
  }, (e) => fill(list, h("p", { class: "error" }, e.message)));
}
