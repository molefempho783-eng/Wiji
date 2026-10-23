// Deals: post, edit, pause and delete map deals. Times are entered in South African time (UTC+2)
// and stored in UTC, which is what the reminder job uses.
import { db, storage, doc, collection, addDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, ref, uploadBytes, getDownloadURL } from "../firebase.js";
import { h, chip, dialog, confirmBox, toast } from "../ui.js";
import { B, onBiz, zar, parseRand } from "./store.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OFFSET = 120; // minutes: South Africa is UTC+2 all year
const pad = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const mins = (t) => {
  const [hh, mm] = String(t || "12:00").split(":").map(Number);
  return hh * 60 + mm;
};
function toUtc(localTime, localDays) {
  let m = mins(localTime) - OFFSET;
  let shift = 0;
  if (m < 0) (m += 1440), (shift = -1);
  return { time: pad(m), days: localDays.map((d) => (d + shift + 7) % 7).sort() };
}
function toLocal(utcTime, utcDays = []) {
  let m = mins(utcTime) + OFFSET;
  let shift = 0;
  if (m >= 1440) (m -= 1440), (shift = 1);
  return { time: pad(m), days: utcDays.map((d) => (d + shift) % 7).sort() };
}

export function renderDeals(main) {
  const add = h("button", { class: "btn primary", onclick: () => editDeal(null) }, "Post a deal");
  const body = h("div", {});
  main.append(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Deals"), h("span", { class: "muted small" }, "Deals show on the Wiji map at your shop. People nearby get a reminder on the days you choose.")),
      add),
    body);
  const draw = () => {
    if (!B.deals.length) return body.replaceChildren(h("div", { class: "panel empty" }, "No deals yet. Deals with a price can be added to the basket and bought in the app."));
    body.replaceChildren(h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["", "Deal", "Price", "When", "Showing", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, B.deals.map((d) => {
        const local = toLocal(d.dealTimeUtc, d.weekdays);
        const on = h("input", { type: "checkbox", checked: d.active !== false, "aria-label": `${d.title} showing` });
        on.onchange = () => updateDoc(doc(db, "mapSpecials", d.id), { active: on.checked, updatedAt: serverTimestamp() })
          .then(() => toast(on.checked ? "Deal is showing on the map" : "Deal paused"))
          .catch((e) => toast(e.message, "bad"));
        return h("tr", {},
          h("td", { style: { width: "56px" } }, d.imageUrl ? h("img", { class: "thumb-sm", src: d.imageUrl, alt: "" }) : h("div", { class: "thumb-sm" })),
          h("td", {}, h("b", {}, d.title), d.description ? h("div", { class: "small muted clamp" }, d.description) : null),
          h("td", { class: "mono" }, d.priceCents ? zar(d.priceCents) : chip("No price")),
          h("td", { class: "small" }, local.days.length === 7 ? "Every day" : local.days.map((x) => DAYS[x]).join(", "), ` · ${local.time}`),
          h("td", {}, h("label", { class: "switch-label" }, on, on.checked ? " Showing" : " Paused")),
          h("td", {}, h("div", { class: "btn-row" },
            h("button", { class: "btn small", onclick: () => editDeal(d) }, "Edit"),
            h("button", { class: "btn small danger", onclick: async () => {
              if (await confirmBox(`Delete “${d.title}”?`, "It disappears from the map. Past orders keep it.", "Delete", "danger solid")) {
                deleteDoc(doc(db, "mapSpecials", d.id)).then(() => toast("Deleted")).catch((e) => toast(e.message, "bad"));
              }
            } }, "Delete"))));
      })))));
  };
  draw();
  return onBiz((what) => what === "deals" && draw());
}

async function editDeal(d) {
  if (!B.info?.active) return toast("Your shop must be verified and active to post deals.", "bad");
  const local = d ? toLocal(d.dealTimeUtc, d.weekdays) : { time: "12:00", days: [1, 2, 3, 4, 5] };
  const title = h("input", { class: "input", maxlength: 80, value: d?.title || "", placeholder: "e.g. 2 burgers for R99", "aria-label": "Title" });
  const desc = h("textarea", { class: "input", maxlength: 300, placeholder: "What's included, any conditions" }, d?.description || "");
  const price = h("input", { class: "input mono", inputmode: "decimal", value: d?.priceCents ? (d.priceCents / 100).toFixed(2) : "", placeholder: "Leave empty if not sold in the app", "aria-label": "Price" });
  const time = h("input", { class: "input", type: "time", value: local.time, "aria-label": "Reminder time" });
  const boxes = DAYS.map((label, i) => {
    const cb = h("input", { type: "checkbox", checked: local.days.includes(i), value: String(i) });
    return { cb, el: h("label", { class: "day" }, cb, label) };
  });
  const file = h("input", { type: "file", accept: "image/*", class: "input" });
  const res = await dialog({
    title: d ? "Edit deal" : "Post a deal",
    body: h("div", {},
      h("label", { class: "field" }, h("span", {}, "Title"), title),
      h("label", { class: "field" }, h("span", {}, "Description"), desc),
      h("div", { class: "grid two", style: { gap: "10px" } },
        h("label", { class: "field" }, h("span", {}, "Price (R), optional"), price),
        h("label", { class: "field" }, h("span", {}, "Remind people at"), time)),
      h("div", { class: "field" }, h("span", { style: { fontWeight: 700, fontSize: "14px" } }, "On these days"), h("div", { class: "days" }, boxes.map((b) => b.el))),
      h("label", { class: "field" }, h("span", {}, d?.imageUrl ? "Replace picture" : "Picture (optional)"), file),
      h("p", { class: "small muted" }, `Shown at your shop: ${B.info.address || "your shop's location"}.`)),
    actions: [
      { label: "Cancel", value: null },
      {
        label: d ? "Save" : "Post deal",
        kind: "primary",
        validate: () => {
          if (title.value.trim().length < 3) return "Give the deal a title.";
          if (price.value.trim() && parseRand(price.value) === null) return "Price must be between R1 and R20 000, or empty.";
          if (!/^\d{2}:\d{2}$/.test(time.value)) return "Choose a time.";
          if (!boxes.some((b) => b.cb.checked)) return "Choose at least one day.";
          if (file.files[0] && file.files[0].size > 9 * 1024 * 1024) return "That picture is too big (max 9 MB).";
          return null;
        },
        value: () => true,
      },
    ],
  });
  if (!res) return;
  const utc = toUtc(time.value, boxes.filter((b) => b.cb.checked).map((b) => Number(b.cb.value)));
  const cents = price.value.trim() ? parseRand(price.value) : null;
  try {
    let imageUrl = d?.imageUrl || null;
    const f = file.files[0];
    if (f) {
      toast("Uploading picture…");
      const r = ref(storage, `map_specials/${B.uid}_${Date.now()}.jpg`);
      await uploadBytes(r, f, { contentType: f.type || "image/jpeg" });
      imageUrl = await getDownloadURL(r);
    }
    const common = {
      title: title.value.trim().slice(0, 80),
      description: desc.value.trim().slice(0, 300),
      dealTimeUtc: utc.time,
      weekdays: utc.days,
      ...(imageUrl ? { imageUrl } : {}),
      updatedAt: serverTimestamp(),
    };
    if (d) {
      await updateDoc(doc(db, "mapSpecials", d.id), { ...common, priceCents: cents === null ? deleteField() : cents });
      toast("Deal saved", "good");
    } else {
      const lat = B.info.latitude ?? B.info.location?.lat;
      const lng = B.info.longitude ?? B.info.location?.lng;
      await addDoc(collection(db, "mapSpecials"), {
        ...common,
        ...(cents !== null ? { priceCents: cents } : {}),
        location: B.info.address || B.info.name,
        latitude: lat,
        longitude: lng,
        createdBy: B.uid,
        creatorName: B.info.name,
        businessId: B.uid,
        businessName: B.info.name,
        active: true,
        createdAt: serverTimestamp(),
      });
      toast("Deal posted on the map", "good");
    }
  } catch (e) {
    toast(e.message, "bad");
  }
}
