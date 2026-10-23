// Business portal: layout and routing for verified businesses (#/overview, #/orders, #/menu, #/deals, #/customers, #/settings).
import { auth, signOut } from "../firebase.js";
import { switchMode } from "../app.js";
import { h, icon } from "../ui.js";
import { notificationsOn, enableNotifications } from "../store.js";
import { B, onBiz, startBiz, stopBiz } from "./store.js";
import { renderBizOverview } from "./overview.js";
import { renderOrders } from "./orders.js";
import { renderMenu } from "./menu.js";
import { renderDeals } from "./deals.js";
import { renderCustomers } from "./customers.js";
import { renderSettings } from "./settings.js";

const NAV = [
  ["overview", "Overview", "overview"],
  ["orders", "Orders", "receipt"],
  ["menu", "Menu & prices", "menu"],
  ["deals", "Deals", "tag"],
  ["customers", "Customers", "team"],
  ["settings", "Shop settings", "settings"],
];
const PAGES = {
  overview: renderBizOverview,
  orders: renderOrders,
  menu: renderMenu,
  deals: renderDeals,
  customers: renderCustomers,
  settings: renderSettings,
};

let active = false;
let main = null;
let links = {};
let cleanup = null;
let unBadge = null;

export function startPortal(root, user, { staff = false } = {}) {
  active = true;
  startBiz(user.uid);
  links = {};
  const nav = h("nav", { class: "nav", "aria-label": "Main" },
    [...NAV, ...(staff ? [["admin", "Wiji Admin", "alert"]] : [])].map(([key, label, ic]) => {
      if (key === "admin") return h("a", { href: "#", onclick: (e) => (e.preventDefault(), switchMode("admin")) }, icon(ic), h("span", { class: "label" }, label));
      const count = h("span", { class: "count hidden hot" });
      const a = h("a", { href: `#/${key}` }, icon(ic), h("span", { class: "label" }, label), count);
      links[key] = { a, count };
      return a;
    }));
  const shopName = h("b", {}, "My business");
  const alertsBtn = h("a", { href: "#", onclick: (e) => (e.preventDefault(), enableNotifications().then(paintAlerts)) });
  const paintAlerts = () => (alertsBtn.textContent = notificationsOn() ? "Desktop alerts on" : "Turn on desktop alerts for new orders");
  paintAlerts();
  main = h("main", { class: "main", id: "main" });
  root.replaceChildren(
    h("div", { class: "shell" },
      h("aside", { class: "side" },
        h("div", { class: "logo" }, h("img", { class: "logo-mark", src: "logo.png", alt: "Wiji", width: 34, height: 34 }), h("span", {}, "Wiji Business")),
        nav,
        h("div", { class: "side-foot" },
          shopName,
          h("div", {}, user.email),
          h("div", {}, alertsBtn),
          staff ? h("div", {}, h("a", { href: "#", onclick: (e) => (e.preventDefault(), switchMode("admin")) }, "Switch to Wiji Admin")) : null,
          h("div", {}, h("a", { href: "#", onclick: (e) => (e.preventDefault(), signOut(auth)) }, "Sign out")))),
      main));

  unBadge = onBiz(() => {
    shopName.textContent = B.info?.name || "My business";
    const n = B.orders.filter((o) => o.status === "paid").length;
    links.orders.count.textContent = String(n);
    links.orders.count.classList.toggle("hidden", !n);
  });
  if (!PAGES[location.hash.split("/")[1]]) location.hash = "#/overview";
  route();
}

function route() {
  if (!active || !main) return;
  const [, page = "overview", id] = location.hash.split("/");
  const key = PAGES[page] ? page : "overview";
  Object.entries(links).forEach(([k, l]) => l.a.classList.toggle("on", k === key));
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  main.replaceChildren();
  window.scrollTo(0, 0);
  try {
    cleanup = PAGES[key](main, id ? decodeURIComponent(id) : undefined);
  } catch (e) {
    console.error(e);
    main.append(h("div", { class: "panel" }, "This page couldn't load: ", e.message));
  }
}
window.addEventListener("hashchange", route);

export function stopPortal() {
  if (!active) return;
  active = false;
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  if (unBadge) unBadge();
  unBadge = null;
  stopBiz();
  main = null;
}
