// Municipal reports: problems people reported on the Wiji map (load shedding, potholes, leaks…).
// The team can mark them as being fixed, fixed, reopen them, add a public update, or remove fake ones.
import { db, collection, doc, onSnapshot, updateDoc, writeBatch, serverTimestamp, deleteField } from "../firebase.js";
import { h, icon, chip, ago, fmtDate, num, askText, confirmBox, busy, lightbox, toMs } from "../ui.js";

export const REPORT_CATEGORIES = {
  power: "Power / load shedding",
  pothole: "Pothole",
  water: "Water",
  sewage: "Sewage",
  streetlight: "Streetlight",
  "traffic-light": "Traffic light",
  dumping: "Illegal dumping",
  infrastructure: "Broken infrastructure",
  other: "Something else",
};
const STATUS = { open: ["Reported", "warn"], in_progress: ["Being fixed", "info"], fixed: ["Fixed", "good"] };
const TABS = [["open", "Reported"], ["in_progress", "Being fixed"], ["fixed", "Fixed"], ["all", "All"]];

function reportCard(r) {
  const ref = doc(db, "municipalReports", r.id);
  const setStatus = (status, label, kind = "") => {
    const b = h("button", { class: `btn small ${kind}` }, label);
    b.onclick = async () => {
      const note = await askText({
        title: label,
        message: "Optional update people see on the report in the app, e.g. “City of Tshwane reference 1234567, crew booked for Friday”.",
        label: "Public update",
        confirm: label,
        optional: true,
      });
      if (note === null || note === undefined) return;
      busy(b, () => updateDoc(ref, {
        status,
        fixedAt: status === "fixed" ? serverTimestamp() : deleteField(),
        ...(note ? { staffNote: note.slice(0, 500) } : {}),
        updatedAt: serverTimestamp(),
      }), "Report updated");
    };
    return b;
  };
  const remove = h("button", { class: "btn small danger" }, "Remove");
  remove.onclick = async () => {
    if (!(await confirmBox("Remove this report?", "Use this for fake, abusive or duplicate reports. It disappears from the map for everyone.", "Remove", "danger solid"))) return;
    busy(remove, async () => {
      const b = writeBatch(db);
      b.delete(ref);
      b.delete(doc(db, "municipalReportOwners", r.id));
      await b.commit();
    }, "Report removed");
  };
  const [label, tone] = STATUS[r.status] || STATUS.open;
  const maps = `https://maps.google.com/?q=${r.latitude},${r.longitude}`;
  return h("div", { class: `panel alert ${r.status === "fixed" ? "sev-info" : (r.affectedBy?.length || 0) >= 5 ? "sev-high" : "sev-med"}` },
    h("div", { class: "alert-head" },
      h("div", {}, h("h3", {}, r.title || "Report"),
        h("div", { class: "small muted" }, `${REPORT_CATEGORIES[r.category] || r.category} · ${ago(r.createdAt)} · ${fmtDate(r.createdAt)}`)),
      chip(label, tone)),
    r.photoUrl ? h("img", { src: r.photoUrl, alt: "Photo of the problem", style: { maxWidth: "260px", width: "100%", borderRadius: "10px", cursor: "zoom-in", marginTop: "8px" }, onclick: () => lightbox(r.photoUrl) }) : null,
    h("dl", { class: "kv" },
      h("dt", {}, "Where"), h("dd", {}, h("a", { href: maps, target: "_blank", rel: "noopener" }, icon("map"), " ", r.location || "Open in Google Maps")),
      r.description ? [h("dt", {}, "Details"), h("dd", { style: { whiteSpace: "pre-wrap" } }, r.description)] : null,
      h("dt", {}, "Reported by"), h("dd", {}, r.anonymous ? "Anonymous" : r.reporterName || "—"),
      h("dt", {}, "Affects"), h("dd", {}, `${num(r.affectedBy?.length || 0)} other ${(r.affectedBy?.length || 0) === 1 ? "person" : "people"}`),
      r.status !== "fixed" && r.fixedVotes?.length ? [h("dt", {}, "Says fixed"), h("dd", {}, `${r.fixedVotes.length} of 3 people`)] : null,
      r.staffNote ? [h("dt", {}, "Public update"), h("dd", {}, r.staffNote)] : null),
    h("div", { class: "btn-row" },
      r.status !== "in_progress" ? setStatus("in_progress", "Being fixed") : null,
      r.status !== "fixed" ? setStatus("fixed", "Mark fixed", "good") : setStatus("open", "Reopen"),
      remove));
}

export function renderReports(main) {
  let tab = "open";
  let rows = null;
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const body = h("div", {}, h("div", { class: "boot", style: { minHeight: "30vh" } }, h("div", { class: "spinner" })));
  main.append(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Municipal reports"),
        h("div", { class: "muted small" }, "Problems people reported on the map. Most-affected first. Anonymous reports never show who sent them."))),
    tabs, body);

  const draw = () => {
    const count = (k) => (rows || []).filter((r) => k === "all" || (r.status || "open") === k).length;
    tabs.replaceChildren(...TABS.map(([k, label]) =>
      h("button", { class: `tab ${tab === k ? "on" : ""}`, role: "tab", "aria-selected": String(tab === k), onclick: () => ((tab = k), draw()) }, `${label} (${count(k)})`)));
    if (!rows) return;
    const list = rows
      .filter((r) => tab === "all" || (r.status || "open") === tab)
      .sort((a, b) => (b.affectedBy?.length || 0) - (a.affectedBy?.length || 0) || (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0));
    body.replaceChildren(list.length ? h("div", { class: "stack" }, list.map(reportCard)) : h("div", { class: "panel empty" }, "Nothing here."));
  };
  draw();
  return onSnapshot(collection(db, "municipalReports"), (s) => {
    rows = s.docs.map((d) => ({ id: d.id, status: "open", ...d.data() }));
    draw();
  }, (e) => body.replaceChildren(h("p", { class: "error" }, e.message)));
}
