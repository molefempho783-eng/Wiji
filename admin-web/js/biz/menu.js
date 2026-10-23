// Menu & prices: add, edit, price changes (one item or all at once), sold-out switch, photos.
import { db, storage, doc, collection, updateDoc, setDoc, deleteDoc, serverTimestamp, writeBatch, ref, uploadBytes, getDownloadURL } from "../firebase.js";
import { h, dialog, confirmBox, toast } from "../ui.js";
import { B, onBiz, zar, parseRand } from "./store.js";

const itemRef = (id) => doc(db, "businesses", B.uid, "menu", id);

export function renderMenu(main) {
  let search = "";
  const find = h("input", { class: "input", type: "search", placeholder: "Search menu", "aria-label": "Search menu", style: { maxWidth: "240px" },
    oninput: () => ((search = find.value.trim().toLowerCase()), draw()) });
  const add = h("button", { class: "btn primary", onclick: () => editItem(null) }, "Add item");
  const bulk = h("button", { class: "btn", onclick: () => changeAllPrices() }, "Change all prices");
  const body = h("div", {});
  main.append(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Menu & prices"), h("span", { class: "muted small" }, "Changes show in the app straight away. Prices are checked again at checkout.")),
      h("div", { class: "btn-row" }, find, bulk, add)),
    body);

  const draw = () => {
    const list = B.menu.filter((m) => !search || `${m.name} ${m.category || ""}`.toLowerCase().includes(search));
    if (!B.menu.length) return body.replaceChildren(h("div", { class: "panel empty" }, "No items yet. Add what you sell so customers can order it in the app."));
    body.replaceChildren(h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["", "Item", "Section", "Price (R)", "Available", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, list.length ? list.map(row) : h("tr", {}, h("td", { colspan: 6, class: "empty" }, "No match."))))));
  };

  const row = (m) => {
    const price = h("input", { class: "input mono price", inputmode: "decimal", value: ((m.priceCents || 0) / 100).toFixed(2), "aria-label": `Price of ${m.name}` });
    price.onchange = async () => {
      const c = parseRand(price.value);
      if (c === null) {
        toast("Price must be between R1 and R20 000.", "bad");
        price.value = (m.priceCents / 100).toFixed(2);
        return;
      }
      if (c === m.priceCents) return;
      try {
        await updateDoc(itemRef(m.id), { priceCents: c, updatedAt: serverTimestamp() });
        toast(`${m.name}: now ${zar(c)}`, "good");
      } catch (e) {
        toast(e.message, "bad");
      }
    };
    price.onkeydown = (e) => e.key === "Enter" && price.blur();
    const avail = h("input", { type: "checkbox", checked: m.available !== false, "aria-label": `${m.name} available` });
    avail.onchange = () => updateDoc(itemRef(m.id), { available: avail.checked, updatedAt: serverTimestamp() })
      .then(() => toast(avail.checked ? `${m.name} is available` : `${m.name} marked sold out`))
      .catch((e) => toast(e.message, "bad"));
    return h("tr", {},
      h("td", { style: { width: "56px" } }, m.photoUrl ? h("img", { class: "thumb-sm", src: m.photoUrl, alt: "" }) : h("div", { class: "thumb-sm" })),
      h("td", {}, h("b", {}, m.name), m.description ? h("div", { class: "small muted clamp" }, m.description) : null),
      h("td", {}, m.category || h("span", { class: "muted" }, "—")),
      h("td", {}, price),
      h("td", {}, h("label", { class: "switch-label" }, avail, avail.checked ? " On sale" : " Sold out")),
      h("td", {}, h("div", { class: "btn-row" },
        h("button", { class: "btn small", onclick: () => editItem(m) }, "Edit"),
        h("button", { class: "btn small danger", onclick: async () => {
          if (await confirmBox(`Delete ${m.name}?`, "Customers won't see it any more. Past orders keep it.", "Delete", "danger solid")) {
            deleteDoc(itemRef(m.id)).then(() => toast("Deleted")).catch((e) => toast(e.message, "bad"));
          }
        } }, "Delete"))));
  };

  // Don't redraw under someone typing a price; catch up when they leave the field
  let pending = false;
  const typing = () => document.activeElement?.matches?.("input.price") && body.contains(document.activeElement);
  body.addEventListener("focusout", () => setTimeout(() => pending && !typing() && ((pending = false), draw()), 0));
  draw();
  return onBiz((what) => {
    if (what !== "menu") return;
    if (typing()) pending = true;
    else draw();
  });
}

async function editItem(m) {
  const name = h("input", { class: "input", maxlength: 80, value: m?.name || "", "aria-label": "Name" });
  const price = h("input", { class: "input mono", inputmode: "decimal", value: m ? (m.priceCents / 100).toFixed(2) : "", placeholder: "e.g. 65.00", "aria-label": "Price" });
  const sections = [...new Set(B.menu.map((x) => x.category).filter(Boolean))];
  const category = h("input", { class: "input", maxlength: 40, value: m?.category || "", placeholder: "e.g. Mains, Drinks", list: "menu-sections", "aria-label": "Section" });
  const list = h("datalist", { id: "menu-sections" }, sections.map((s) => h("option", { value: s })));
  const desc = h("textarea", { class: "input", maxlength: 300, placeholder: "Optional" }, m?.description || "");
  const file = h("input", { type: "file", accept: "image/*", class: "input" });
  const preview = h("img", { class: "thumb-lg", src: m?.photoUrl || "", alt: "", style: { display: m?.photoUrl ? "block" : "none" } });
  file.onchange = () => {
    const f = file.files[0];
    if (!f) return;
    preview.src = URL.createObjectURL(f);
    preview.style.display = "block";
  };
  const res = await dialog({
    title: m ? `Edit ${m.name}` : "Add item",
    body: h("div", {},
      h("label", { class: "field" }, h("span", {}, "Name"), name),
      h("div", { class: "grid two", style: { gap: "10px" } },
        h("label", { class: "field" }, h("span", {}, "Price (R)"), price),
        h("label", { class: "field" }, h("span", {}, "Section"), category, list)),
      h("label", { class: "field" }, h("span", {}, "Description"), desc),
      h("label", { class: "field" }, h("span", {}, "Photo"), preview, file)),
    actions: [
      { label: "Cancel", value: null },
      {
        label: m ? "Save" : "Add item",
        kind: "primary",
        validate: () => {
          if (!name.value.trim()) return "Give the item a name.";
          if (parseRand(price.value) === null) return "Price must be between R1 and R20 000.";
          const f = file.files[0];
          if (f && f.size > 9 * 1024 * 1024) return "That photo is too big (max 9 MB).";
          return null;
        },
        value: () => true,
      },
    ],
  });
  if (!res) return;
  const id = m?.id || doc(collection(db, "businesses", B.uid, "menu")).id;
  try {
    let photoUrl = m?.photoUrl || null;
    const f = file.files[0];
    if (f) {
      toast("Uploading photo…");
      const r = ref(storage, `business_public/${B.uid}/menu/${id}.jpg`);
      await uploadBytes(r, f, { contentType: f.type || "image/jpeg" });
      photoUrl = await getDownloadURL(r);
    }
    await setDoc(itemRef(id), {
      name: name.value.trim().slice(0, 80),
      priceCents: parseRand(price.value),
      category: category.value.trim().slice(0, 40),
      description: desc.value.trim().slice(0, 300),
      available: m ? m.available !== false : true,
      photoUrl,
      updatedAt: serverTimestamp(),
    });
    toast(m ? "Saved" : "Added to your menu", "good");
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function changeAllPrices() {
  if (!B.menu.length) return toast("Add some items first.");
  const pct = h("input", { class: "input mono", inputmode: "decimal", placeholder: "e.g. 10 or -5", "aria-label": "Percent" });
  const round = h("input", { type: "checkbox", checked: true });
  const sections = ["", ...new Set(B.menu.map((x) => x.category).filter(Boolean))];
  const which = h("select", { class: "input", "aria-label": "Which items" }, sections.map((s) => h("option", { value: s }, s ? `Only ${s}` : "All items")));
  const res = await dialog({
    title: "Change all prices",
    body: h("div", {},
      h("p", { class: "muted" }, "Raise or lower prices by a percentage. Use a minus for a discount."),
      h("label", { class: "field" }, h("span", {}, "Percent change"), pct),
      h("label", { class: "field" }, h("span", {}, "Items"), which),
      h("label", { class: "switch-label" }, round, " Round to the nearest rand")),
    actions: [
      { label: "Cancel", value: null },
      {
        label: "Preview",
        kind: "primary",
        validate: () => {
          const p = Number(pct.value.replace(",", "."));
          return !Number.isFinite(p) || p === 0 || p < -90 || p > 300 ? "Enter a percentage between -90 and 300." : null;
        },
        value: () => ({ p: Number(pct.value.replace(",", ".")), round: round.checked, section: which.value }),
      },
    ],
  });
  if (!res) return;
  const items = B.menu.filter((m) => !res.section || m.category === res.section);
  const changes = items.map((m) => {
    let c = m.priceCents * (1 + res.p / 100);
    c = res.round ? Math.max(100, Math.round(c / 100) * 100) : Math.round(c);
    return { m, c: Math.min(2000000, Math.max(100, c)) };
  }).filter((x) => x.c !== x.m.priceCents);
  if (!changes.length) return toast("No prices would change.");
  const ok = await dialog({
    title: `Update ${changes.length} price${changes.length === 1 ? "" : "s"}?`,
    body: h("div", { class: "table-wrap", style: { maxHeight: "45vh", overflow: "auto" } }, h("table", {},
      h("tbody", {}, changes.map(({ m, c }) => h("tr", {}, h("td", {}, m.name), h("td", { class: "mono muted" }, zar(m.priceCents)), h("td", { class: "mono" }, "→ ", zar(c))))))),
    actions: [{ label: "Cancel", value: false }, { label: "Update prices", kind: "primary", value: true }],
  });
  if (!ok) return;
  try {
    for (let i = 0; i < changes.length; i += 400) {
      const batch = writeBatch(db);
      changes.slice(i, i + 400).forEach(({ m, c }) => batch.update(itemRef(m.id), { priceCents: c, updatedAt: serverTimestamp() }));
      await batch.commit();
    }
    toast(`Updated ${changes.length} price${changes.length === 1 ? "" : "s"}`, "good");
  } catch (e) {
    toast(e.message, "bad");
  }
}
