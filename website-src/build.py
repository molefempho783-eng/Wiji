"""Builds the Wiji public website pages and the in-app legal screens from content.py.

Run from the repo root:  python website-src/build.py .
Writes: website/index.html is NOT touched (hand-written home page);
        website/terms/index.html, website/privacy/index.html, website/delete-account/index.html
        Screens/Legal/TermsAndConditionsScreen.tsx, Screens/Legal/PrivacyPolicyScreen.tsx
"""
import html, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import content as C

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
WEB = os.path.join(ROOT, "website")

def linkify(text):
    t = html.escape(text, quote=False)
    t = re.sub(r"([\w.+-]+@[\w-]+\.[\w.]+)", r'<a href="mailto:\1">\1</a>', t)
    t = t.replace(html.escape(C.SITE) + "/delete-account", '<a href="/delete-account/">' + C.SITE.replace("https://", "") + '/delete-account</a>')
    t = t.replace(html.escape(C.SITE), '<a href="/">' + C.SITE.replace("https://", "") + "</a>")
    t = t.replace("inforegulator.org.za", '<a href="https://inforegulator.org.za" rel="noopener">inforegulator.org.za</a>')
    return t

def blocks_html(blocks):
    out, ul = [], []
    def flush():
        if ul:
            out.append("<ul>" + "".join(f"<li>{linkify(b)}</li>" for b in ul) + "</ul>")
            ul.clear()
    for b in blocks:
        if b.startswith("- "):
            ul.append(b[2:])
        else:
            flush(); out.append(f"<p>{linkify(b)}</p>")
    flush()
    return "\n".join(out)

def slug(t):
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"^\d+\.\s*", "", t.lower())).strip("-")

HEADER = """<header class="top"><div class="wrap row">
  <a class="brand" href="/"><img src="/logo.png" alt="" width="32" height="32"><span>Wiji</span></a>
  <nav><a href="/#features">Features</a><a href="/#drive">Drive &amp; sell</a><a href="/terms/">Terms</a><a href="/privacy/">Privacy</a></nav>
</div></header>"""

def footer():
    return f"""<footer class="foot"><div class="wrap">
  <div class="foot-row">
    <div><a class="brand" href="/"><img src="/logo.png" alt="" width="28" height="28"><span>Wiji</span></a>
      <p class="muted">Rides, payments and your neighbourhood, in one app.<br>Run by {C.OPERATOR}, Pretoria.</p></div>
    <div class="foot-links">
      <a href="/terms/">Terms and Conditions</a><a href="/privacy/">Privacy Policy</a>
      <a href="/delete-account/">Delete your account</a><a href="/admin/">Business &amp; team portal</a>
      <a href="mailto:{C.EMAIL}">Contact us</a></div>
  </div>
  <p class="muted small">© 2026 {C.OPERATOR}. In an emergency, call SAPS on 10111 or 112 from a mobile.</p>
</div></footer>"""

def page(title, desc, body, path):
    return f"""<!doctype html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="{C.SITE}{path}">
<link rel="icon" href="/favicon.png">
<meta name="theme-color" content="#6C2BD9">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
</head>
<body>
{HEADER}
{body}
{footer()}
</body>
</html>
"""

def legal_page(title, intro, sections, path, desc, highlight=()):
    strip = lambda t: html.escape(re.sub(r"^\d+\.\s*", "", t))
    toc = "".join('<li><a href="#' + slug(t) + '">' + strip(t) + "</a></li>" for t, _ in sections)
    secs = "".join(
        f'<section id="{slug(t)}" class="{"flag" if t in highlight else ""}"><h2>{html.escape(t)}</h2>'
        + ('<p class="flag-label">Important: please read</p>' if t in highlight else "")
        + blocks_html(b) + "</section>" for t, b in sections)
    body = f"""<main class="legal wrap">
  <div class="legal-head">
    <p class="eyebrow">Wiji legal</p>
    <h1>{html.escape(title)}</h1>
    <p class="muted">Effective {C.EFFECTIVE} · {C.OPERATOR}</p>
    {"<p class='lede'>" + linkify(intro) + "</p>" if intro else ""}
  </div>
  <div class="legal-grid">
    <aside class="toc"><p class="toc-title">On this page</p><ol>{toc}</ol></aside>
    <article>{secs}</article>
  </div>
</main>"""
    return page(f"{title} · Wiji", desc, body, path)

def write(rel, text):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("wrote", rel)

write("website/terms/index.html", legal_page("Terms and Conditions", C.TERMS_INTRO, C.TERMS, "/terms/",
      "The terms for using Wiji: rides, payments, shops, communities and safety.", C.HIGHLIGHT))
write("website/privacy/index.html", legal_page("Privacy Policy", C.PRIVACY_INTRO, C.PRIVACY, "/privacy/",
      "How Wiji collects, uses and protects your personal information under POPIA."))
write("website/delete-account/index.html", legal_page("Delete your Wiji account", "You can ask us to delete your Wiji account and personal information at any time. Here's how, and what happens to your data.", C.DELETE, "/delete-account/",
      "How to delete your Wiji account and what data is removed or kept."))

# ---------- in-app screens ----------
TSX = """// GENERATED by build/build.py from build/content.py. Edit content.py, then re-run the build.
import React from "react";
import { Linking, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const EFFECTIVE = __EFFECTIVE__;
const URL = __URL__;
const INTRO = __INTRO__;
const SECTIONS: { title: string; important?: boolean; blocks: string[] }[] = __SECTIONS__;

export default function __NAME__() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>__TITLE__</Text>
        <Text style={styles.meta}>Effective {EFFECTIVE}</Text>
        <TouchableOpacity onPress={() => Linking.openURL(URL)} accessibilityRole="link">
          <Text style={styles.link}>Read this online</Text>
        </TouchableOpacity>
        <Text style={styles.intro}>{INTRO}</Text>
        {SECTIONS.map((s) => (
          <View key={s.title} style={[styles.section, s.important && styles.important]}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            {s.important ? <Text style={styles.importantLabel}>Important: please read</Text> : null}
            {s.blocks.map((b, i) =>
              b.startsWith("- ") ? (
                <View key={i} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>{"\\u2022"}</Text>
                  <Text style={[styles.body, { flex: 1 }]}>{b.slice(2)}</Text>
                </View>
              ) : (
                <Text key={i} style={[styles.body, styles.para]}>{b}</Text>
              )
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: "700", color: "#15102B", marginBottom: 6 },
  meta: { fontSize: 13, color: "#5F5A75", marginBottom: 6 },
  link: { fontSize: 14, color: "#6C2BD9", fontWeight: "600", marginBottom: 14 },
  intro: { fontSize: 14, lineHeight: 21, color: "#333333", marginBottom: 18 },
  section: { marginBottom: 18 },
  important: { backgroundColor: "#F1EDFA", borderLeftWidth: 3, borderLeftColor: "#6C2BD9", padding: 12, borderRadius: 8 },
  importantLabel: { fontSize: 12, fontWeight: "700", color: "#6C2BD9", marginBottom: 6, textTransform: "uppercase" },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#15102B", marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 21, color: "#333333" },
  para: { marginBottom: 6 },
  bulletRow: { flexDirection: "row", marginBottom: 4, paddingRight: 4 },
  bulletDot: { width: 16, fontSize: 14, lineHeight: 21, color: "#6C2BD9" },
});
"""

def tsx(name, title, url, intro, sections, highlight=()):
    data = [{"title": t, **({"important": True} if t in highlight else {}), "blocks": b} for t, b in sections]
    return (TSX.replace("__NAME__", name).replace("__TITLE__", title)
            .replace("__EFFECTIVE__", json.dumps(C.EFFECTIVE)).replace("__URL__", json.dumps(url))
            .replace("__INTRO__", json.dumps(intro, ensure_ascii=False))
            .replace("__SECTIONS__", json.dumps(data, indent=2, ensure_ascii=False)))

write("Screens/Legal/TermsAndConditionsScreen.tsx", tsx("TermsAndConditionsScreen", "Terms and Conditions", C.SITE + "/terms/", C.TERMS_INTRO, C.TERMS, C.HIGHLIGHT))
write("Screens/Legal/PrivacyPolicyScreen.tsx", tsx("PrivacyPolicyScreen", "Privacy Policy", C.SITE + "/privacy/", C.PRIVACY_INTRO, C.PRIVACY))

# ---------- home + 404 ----------
HERE = os.path.dirname(os.path.abspath(__file__))
home = open(os.path.join(HERE, "home_body.html"), encoding="utf-8").read().replace("__EMAIL__", C.EMAIL)
write("website/index.html", page("Wiji · Rides, payments and your neighbourhood",
      "Wiji: safe rides with verified drivers, card payments, local shops and deals, and communities, in one South African app.", home, "/"))
write("website/404.html", page("Page not found · Wiji", "This page doesn't exist.",
      '<main class="wrap notfound"><h1>Page not found</h1><p class="muted">That page doesn\'t exist or has moved.</p><p><a class="btn solid" href="/">Go to the Wiji home page</a></p></main>', "/404.html"))
write("website/site.css", open(os.path.join(HERE, "site", "site.css"), encoding="utf-8").read())
