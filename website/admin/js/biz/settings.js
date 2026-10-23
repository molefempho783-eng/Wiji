// Shop settings: open/closed, collection and delivery, delivery fee, description. Name and address need re-verification.
import { auth, db, doc, updateDoc, serverTimestamp, signOut } from "../firebase.js";
import { notificationsOn, enableNotifications } from "../store.js";
import { h, chip, toast } from "../ui.js";
import { B, onBiz, zar, parseRand } from "./store.js";

const save = (patch, msg) =>
  updateDoc(doc(db, "businesses", B.uid), { ...patch, updatedAt: serverTimestamp() })
    .then(() => msg && toast(msg, "good"))
    .catch((e) => toast(e.message, "bad"));

export function renderSettings(main) {
  const body = h("div", {});
  main.append(h("div", { class: "page-head" }, h("h1", {}, "Shop settings")), body);
  const draw = () => {
    const b = B.info;
    if (!b) return body.replaceChildren(h("p", { class: "muted" }, "Loading…"));
    const toggle = (label, sub, checked, onChange) => {
      const cb = h("input", { type: "checkbox", checked, "aria-label": label });
      cb.onchange = () => onChange(cb.checked, cb);
      return h("label", { class: "check toggle-row" }, h("div", { class: "name" }, label, h("div", { class: "small muted", style: { fontWeight: 400 } }, sub)), cb);
    };
    const fee = h("input", { class: "input mono", inputmode: "decimal", style: { maxWidth: "140px" }, value: ((b.deliveryFeeCents || 0) / 100).toFixed(2), "aria-label": "Delivery fee" });
    fee.onchange = () => {
      const v = fee.value.trim() === "" ? 0 : parseRand(fee.value, { min: 0, max: 500 });
      if (v === null) {
        toast("Delivery fee must be between R0 and R500.", "bad");
        fee.value = ((b.deliveryFeeCents || 0) / 100).toFixed(2);
        return;
      }
      save({ deliveryFeeCents: v }, `Delivery fee: ${v ? zar(v) : "free"}`);
    };
    const desc = h("textarea", { class: "input", maxlength: 300, placeholder: "Tell customers what you sell, your hours, anything they should know" }, b.description || "");
    desc.onchange = () => save({ description: desc.value.trim().slice(0, 300) }, "Description saved");

    body.replaceChildren(
      h("div", { class: "grid two" },
        h("div", { class: "panel" },
          h("h2", {}, "Taking orders"),
          toggle(b.isOpen !== false ? "Open" : "Closed", "Customers can only order while you're open", b.isOpen !== false,
            (v) => save({ isOpen: v }, v ? "Shop is open" : "Shop is closed")),
          toggle("Collection", "Customers pick up their order at your shop", b.collectEnabled !== false, (v, cb) => {
            if (!v && !b.deliveryEnabled) {
              cb.checked = true;
              return toast("Turn on delivery first, so customers can still order.", "bad");
            }
            save({ collectEnabled: v }, v ? "Collection is on" : "Collection is off");
          }),
          toggle("Delivery", "You deliver orders yourself", !!b.deliveryEnabled, (v, cb) => {
            if (!v && b.collectEnabled === false) {
              cb.checked = true;
              return toast("Turn on collection first, so customers can still order.", "bad");
            }
            save({ deliveryEnabled: v }, v ? "Delivery is on" : "Delivery is off");
          }),
          b.deliveryEnabled ? h("label", { class: "field", style: { marginTop: "12px" } }, h("span", {}, "Delivery fee (R), added to each delivery order"), fee) : null),
        h("div", { class: "panel" },
          h("h2", {}, "About your shop"),
          h("label", { class: "field" }, h("span", {}, "Description"), desc),
          h("dl", { class: "kv" },
            h("dt", {}, "Name"), h("dd", {}, b.name || "—", " ", chip("Verified", "good")),
            h("dt", {}, "Sells"), h("dd", {}, b.category || "—"),
            h("dt", {}, "Address"), h("dd", {}, b.address || "—", " ",
              b.latitude ? h("a", { href: `https://www.google.com/maps/search/?api=1&query=${b.latitude},${b.longitude}`, target: "_blank", rel: "noopener", class: "small" }, "Map") : null),
            h("dt", {}, "Payouts"), h("dd", {}, B.payee ? `${B.payee.bankName || "Bank"} ••• ${B.payee.accountLast4 || ""}` : chip("Not set up", "warn"))),
          h("p", { class: "small muted" }, "To change your name, address or map location, contact Wiji support so we can verify it again. Change your bank account in the Wiji app under Wallet → Set up payouts.")),
        h("div", { class: "panel" },
          h("h2", {}, "Account"),
          h("p", { class: "muted" }, auth.currentUser?.email || ""),
          h("div", { class: "btn-row" },
            notificationsOn() ? h("span", { class: "small muted" }, "Desktop alerts for new orders are on.")
              : h("button", { class: "btn", onclick: () => enableNotifications().then(draw) }, "Turn on desktop alerts"),
            h("button", { class: "btn danger", onclick: () => signOut(auth) }, "Sign out")))));
  };
  draw();
  return onBiz((what) => ["info", "payee"].includes(what) && draw());
}
