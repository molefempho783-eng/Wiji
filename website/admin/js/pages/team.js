// Team: who can use this site. Admins can add or remove people; the safety team can only view.
import { call, db, collection, onSnapshot, auth } from "../firebase.js";
import { h, chip, fmtDate, busy, confirmBox } from "../ui.js";

export function renderTeam(main, session) {
  const isAdmin = session.role === "admin";
  const list = h("div", {}, h("p", { class: "muted" }, "Loading…"));
  const email = h("input", { class: "input", type: "email", placeholder: "name@example.com", "aria-label": "Email of their Wiji account" });
  const role = h("select", { class: "input", "aria-label": "Role" },
    h("option", { value: "safety" }, "Safety team: alerts, drivers and businesses"),
    h("option", { value: "admin" }, "Admin: everything, plus managing the team"));
  const add = h("button", { class: "btn primary", type: "submit" }, "Give access");
  const form = h("form", { class: "panel", onsubmit: (e) => {
      e.preventDefault();
      busy(add, async () => {
        await call("grantSafetyRole", { email: email.value.trim(), role: role.value });
        email.value = "";
      }, "Access given. They can sign in now.");
    } },
    h("h2", {}, "Add someone"),
    h("p", { class: "muted small" }, "They need a Wiji account first (sign up in the app). Then they sign in here with the same email and password. You can also add people by hand in the Firebase console: Firestore → safetyTeam → document ID = their user ID, field role = \"admin\" or \"safety\"."),
    h("div", { class: "grid two", style: { alignItems: "end" } },
      h("label", { class: "field" }, h("span", {}, "Email of their Wiji account"), email),
      h("label", { class: "field" }, h("span", {}, "Role"), role)),
    add);

  main.append(h("div", { class: "page-head" }, h("h1", {}, "Team")), isAdmin ? form : h("div", { class: "banner" }, "Only admins can add or remove people."),
    h("div", { class: "section-title" }, h("h2", {}, "People with access")), list);

  return onSnapshot(collection(db, "safetyTeam"), (s) => {
    const rows = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.email).localeCompare(String(b.email)));
    list.replaceChildren(h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Email", "Role", "Since", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, rows.length ? rows.map((p) => {
        const remove = h("button", { class: "btn small danger" }, "Remove");
        remove.onclick = async () => {
          if (await confirmBox("Remove access?", `${p.email} won't be able to use this site or receive safety alerts.`, "Remove", "danger solid")) {
            busy(remove, () => call("grantSafetyRole", { email: p.email, role: "none" }), "Access removed");
          }
        };
        return h("tr", {},
          h("td", {}, p.email || p.id, p.id === auth.currentUser?.uid ? " (you)" : ""),
          h("td", {}, chip(p.role === "admin" ? "Admin" : "Safety team", p.role === "admin" ? "info" : "")),
          h("td", {}, fmtDate(p.updatedAt, false)),
          h("td", {}, isAdmin && p.id !== auth.currentUser?.uid ? remove : null));
      }) : h("tr", {}, h("td", { colspan: 4, class: "empty" }, "Nobody yet."))))));
  }, (e) => list.replaceChildren(h("p", { class: "error" }, e.message)));
}
