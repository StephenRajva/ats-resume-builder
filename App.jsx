import React, { useState } from "react";

// ───────────────────────────────────────────────────────────────────────────
// ATS Resume Builder + Matcher
// • Paste resume (LaTeX / plain text) OR upload a PDF
// • Scores ATS-friendliness vs a job description; shows missing keywords
// • Tailors the resume to the JD:
//     - LaTeX in  → tailored LaTeX out (+ download .tex; recompile in Overleaf)
//     - PDF/text in → clean ATS layout → one-click Download PDF (real text)
// ───────────────────────────────────────────────────────────────────────────

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Spline+Sans:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap');
@keyframes fadeUp { from { opacity:0; transform:translateY(10px);} to {opacity:1; transform:translateY(0);} }
@keyframes spin { to { transform: rotate(360deg);} }
@media print {
  body * { visibility: hidden !important; }
  #resume-print, #resume-print * { visibility: visible !important; }
  #resume-print { position: absolute !important; left:0; top:0; width:100%; box-shadow:none !important; border:none !important; }
  @page { margin: 14mm; size: letter; }
}
`;

const ink = "#1c1b17";
const paper = "#f3efe6";
const cardc = "#fbf9f4";
const line = "#ddd6c6";
const teal = "#1f6f5c";
const amber = "#c1820f";
const clay = "#b1492f";
const muted = "#6f6a5d";

const scoreColor = (s) => (s >= 75 ? teal : s >= 50 ? amber : clay);
const sevColor = (s) => (s === "high" ? clay : s === "medium" ? amber : muted);

// Pick a free-tier model. Verify current names at https://ai.google.dev/gemini-api/docs/models
// Alternatives: "gemini-2.5-flash-lite" (faster, 1000 req/day) — change here only.
const GEMINI_MODEL = "gemini-2.5-flash";

// content: a string, OR an array of blocks:
//   { type:"text", text } | { type:"document", source:{ media_type, data } }
// We translate that into Gemini's request shape and parse its response.
async function callModel(content, maxTokens) {
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
  const parts = blocks.map((b) =>
    b.type === "document" && b.source
      ? { inline_data: { mime_type: b.source.media_type || "application/pdf", data: b.source.data } }
      : { text: b.text || "" }
  );
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
    }),
  });
  let data;
  try { data = await res.json(); } catch { throw new Error("Request failed (" + res.status + ")"); }
  if (!res.ok || data.error) {
    const e = data && data.error;
    throw new Error((e && (e.message || e)) || "Request failed (" + res.status + ")");
  }
  const cand = (data.candidates || [])[0];
  if (!cand) throw new Error("Empty response — you may be rate-limited or the content was blocked.");
  return (((cand.content || {}).parts) || []).map((p) => p.text || "").join("\n").trim();
}

function extractJSON(text) {
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const f = t.indexOf("{"), l = t.lastIndexOf("}");
  if (f !== -1 && l !== -1) t = t.slice(f, l + 1);
  return JSON.parse(t);
}

const isLatex = (s) =>
  /\\documentclass|\\begin\{|\\section\{|\\resumeItem|\\textbf\{/.test(s);

// Load jsPDF once from the allowed CDN, for real-text PDF download.
function loadJsPDF() {
  return new Promise((resolve, reject) => {
    if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = () => (window.jspdf && window.jspdf.jsPDF ? resolve(window.jspdf) : reject(new Error("PDF library loaded incorrectly.")));
    s.onerror = () => reject(new Error("Couldn't load the PDF library."));
    document.body.appendChild(s);
  });
}

// Generate + download a clean, selectable-text, ATS-friendly PDF.
async function downloadResumePDF(data) {
  const { jsPDF } = await loadJsPDF();
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 50;
  const CW = PW - M * 2;
  let y = M;
  const ensure = (h) => { if (y + h > PH - M) { doc.addPage(); y = M; } };

  doc.setFont("times", "bold"); doc.setFontSize(20); ensure(24);
  doc.text(String(data.name || ""), PW / 2, y, { align: "center" }); y += 22;

  if (data.headline) {
    doc.setFont("times", "normal"); doc.setFontSize(10.5); ensure(14);
    doc.text(String(data.headline), PW / 2, y, { align: "center" }); y += 14;
  }
  if (data.contact && data.contact.length) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.splitTextToSize(data.contact.join("   •   "), CW).forEach((ln) => {
      ensure(12); doc.text(ln, PW / 2, y, { align: "center" }); y += 12;
    });
  }
  y += 8;

  (data.sections || []).forEach((sec) => {
    ensure(30);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(String(sec.heading || "").toUpperCase(), M, y); y += 4;
    doc.setLineWidth(1); doc.line(M, y, PW - M, y); y += 13;

    (sec.entries || []).forEach((en) => {
      if (en.title || en.date) {
        ensure(14); doc.setFont("times", "bold"); doc.setFontSize(11.5);
        if (en.title) doc.text(String(en.title), M, y);
        if (en.date) { doc.setFont("times", "normal"); doc.setFontSize(10); doc.text(String(en.date), PW - M, y, { align: "right" }); }
        y += 13;
      }
      if (en.subtitle || en.location) {
        ensure(13); doc.setFont("times", "italic"); doc.setFontSize(10.5);
        if (en.subtitle) doc.text(String(en.subtitle), M, y);
        if (en.location) doc.text(String(en.location), PW - M, y, { align: "right" });
        y += 13;
      }
      (en.bullets || []).forEach((b) => {
        doc.setFont("times", "normal"); doc.setFontSize(10.5);
        doc.splitTextToSize(String(b), CW - 16).forEach((ln, idx) => {
          ensure(13);
          if (idx === 0) doc.text("•", M + 4, y);
          doc.text(ln, M + 16, y); y += 13;
        });
      });
      y += 4;
    });
    y += 6;
  });

  doc.save(String(data.name || "resume").replace(/[^\w]+/g, "_") + "_tailored.pdf");
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [mode, setMode] = useState("paste");
  const [resume, setResume] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [struct, setStruct] = useState(null);
  const [jd, setJd] = useState("");

  const [extracting, setExtracting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [result, setResult] = useState(null);
  const [tailoredLatex, setTailoredLatex] = useState("");
  const [tailoredStruct, setTailoredStruct] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);

  const fmt = mode === "pdf" ? "PDF" : resume ? (isLatex(resume) ? "LaTeX" : "Plain text") : null;

  const resetOutputs = () => { setResult(null); setTailoredLatex(""); setTailoredStruct(null); };

  function processFile(file) {
    if (!file) return;
    const okType = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    if (!okType) { setError("That doesn't look like a PDF. Please choose a .pdf file."); return; }
    setError(""); resetOutputs(); setPdfName(file.name); setStruct(null);
    const reader = new FileReader();
    reader.onerror = () => { setExtracting(false); setError("Couldn't read that file — try a different PDF."); };
    reader.onload = async () => {
      const b64 = String(reader.result || "").split(",")[1];
      if (!b64) { setError("That file came through empty. Try re-saving the PDF and uploading again."); return; }
      setExtracting(true);
      try {
        const text = await callModel(
          [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: `Extract this resume into structured JSON. Return ONLY JSON (no fences):
{"name":"","headline":"","contact":["email","phone","links","location"],"sections":[{"heading":"","entries":[{"title":"","subtitle":"","date":"","location":"","bullets":[]}]}],"rawText":"<full plain text of the resume>"}
Preserve ALL content faithfully. For skills/summary blocks with no entries, use one entry with empty title and the lines in bullets.` },
          ],
          4000
        );
        setStruct(extractJSON(text));
      } catch (err) {
        setError("Couldn't read the PDF. " + err.message); setPdfName("");
      } finally { setExtracting(false); }
    };
    reader.readAsDataURL(file);
  }

  function onFile(e) { processFile((e.target.files || [])[0]); e.target.value = ""; }
  function onDrop(e) { e.preventDefault(); setDragging(false); processFile(((e.dataTransfer || {}).files || [])[0]); }

  const resumeTextForAnalysis = () =>
    mode === "pdf" ? (struct ? struct.rawText || JSON.stringify(struct) : "") : resume;

  async function analyze() {
    setError(""); resetOutputs();
    const rt = resumeTextForAnalysis();
    if (!rt || rt.trim().length < 40) { setError(mode === "pdf" ? "Upload a PDF and let it finish reading first." : "Paste your full resume first."); return; }
    if (jd.trim().length < 20) { setError("Please paste the job description."); return; }
    setAnalyzing(true);
    try {
      const text = await callModel(
        `You are an expert ATS analyzer and senior technical recruiter. Compare the RESUME against the JOB DESCRIPTION.
Return ONLY valid JSON (no fences):
{"atsScore":<int 0-100: ATS-pass + match to THIS jd>,"scoreReason":"<one sentence>","matchedKeywords":[<JD terms present>],"missingKeywords":[<important JD terms absent>],"formatIssues":[{"issue":"<parsing risk>","severity":"high|medium|low"}],"sectionFeedback":[{"section":"","feedback":"","priority":"high|medium|low"}],"topActions":[<3-5 short imperative fixes>]}
Be honest and specific; only flag missing keywords that truly matter for this role.

RESUME:
"""${rt}"""

JOB DESCRIPTION:
"""${jd}"""`,
        1500
      );
      setResult(extractJSON(text));
    } catch (e) { setError("Couldn't analyze. " + e.message); }
    finally { setAnalyzing(false); }
  }

  async function tailor() {
    setError(""); setTailoredLatex(""); setTailoredStruct(null); setTailoring(true);
    const rt = resumeTextForAnalysis();
    try {
      if (fmt === "LaTeX") {
        const text = await callModel(
          `You are an expert resume writer. Rewrite the RESUME optimized for the JOB DESCRIPTION and ATS.
RULES: Preserve the EXACT LaTeX format/structure — same documentclass, packages, custom commands; only change textual content. Do NOT invent experience, skills, dates or metrics. Weave in JD keywords only where truthful. Strong action verbs. Same length/page count.
Return ONLY the complete rewritten LaTeX. No commentary, no code fences.

RESUME:
"""${resume}"""

JOB DESCRIPTION:
"""${jd}"""`,
          8000
        );
        setTailoredLatex(text.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim());
      } else {
        const text = await callModel(
          `You are an expert resume writer. Rewrite the resume optimized for the JOB DESCRIPTION and ATS.
Return ONLY JSON in this schema (no fences):
{"name":"","headline":"","contact":[],"sections":[{"heading":"","entries":[{"title":"","subtitle":"","date":"","location":"","bullets":[]}]}]}
RULES: Do NOT invent experience, skills, employers, dates, degrees or metrics — only rephrase, reprioritize and surface real content. Weave in JD keywords only where truthful. Strong action verbs, quantify only where already implied. Keep similar length.

RESUME:
"""${rt}"""

JOB DESCRIPTION:
"""${jd}"""`,
          4000
        );
        setTailoredStruct(extractJSON(text));
      }
    } catch (e) { setError("Couldn't generate the tailored resume. " + e.message); }
    finally { setTailoring(false); }
  }

  async function handleDownloadPDF() {
    setError(""); setDownloading(true);
    try { await downloadResumePDF(tailoredStruct); }
    catch (e) { setError("Couldn't build the PDF (" + e.message + "). Use “Print / Save as PDF” as a fallback."); }
    finally { setDownloading(false); }
  }

  const copy = (txt) => navigator.clipboard.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });

  // styles
  const wrap = { fontFamily: "'Spline Sans',sans-serif", background: paper, color: ink, minHeight: "100vh", padding: "32px 22px 64px", lineHeight: 1.55 };
  const inner = { maxWidth: 980, margin: "0 auto" };
  const ta = { width: "100%", minHeight: 210, resize: "vertical", background: cardc, border: "1px solid " + line, borderRadius: 10, padding: "14px 15px", fontFamily: "'Space Mono',monospace", fontSize: 12.5, color: ink, lineHeight: 1.5, boxSizing: "border-box", outline: "none" };
  const label = { fontFamily: "'Space Mono',monospace", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: muted, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" };
  const btn = (bg, dis) => ({ background: dis ? "#cfc8b8" : bg, color: bg === "transparent" ? ink : "#fbf9f4", border: bg === "transparent" ? "1px solid " + ink : "none", borderRadius: 999, padding: "13px 26px", fontFamily: "'Spline Sans',sans-serif", fontWeight: 600, fontSize: 14.5, cursor: dis ? "default" : "pointer" });
  const chip = (c, bg) => ({ display: "inline-block", fontFamily: "'Space Mono',monospace", fontSize: 12, padding: "5px 11px", margin: "0 6px 6px 0", borderRadius: 7, background: bg, color: c, border: "1px solid " + c + "44" });
  const block = { background: cardc, border: "1px solid " + line, borderRadius: 12, padding: "20px 22px", marginTop: 18, animation: "fadeUp .4s ease both" };
  const h3 = { fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: 19, margin: "0 0 12px" };
  const tab = (active) => ({ flex: 1, padding: "10px 0", textAlign: "center", cursor: "pointer", fontFamily: "'Space Mono',monospace", fontSize: 12, letterSpacing: 1, textTransform: "uppercase", background: active ? ink : "transparent", color: active ? cardc : muted, borderRadius: 8 });

  const sc = result ? Math.max(0, Math.min(100, result.atsScore)) : 0;
  const R = 52, CIRC = 2 * Math.PI * R;

  return (
    <div style={wrap}>
      <style>{FONTS}</style>
      <div style={inner}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, letterSpacing: 3, color: teal, textTransform: "uppercase", marginBottom: 6 }}>ATS Toolkit</div>
          <h1 style={{ fontFamily: "'Fraunces',serif", fontWeight: 900, fontSize: 40, lineHeight: 1.05, margin: 0, letterSpacing: -0.5 }}>Resume Builder &amp; Matcher</h1>
          <p style={{ color: muted, maxWidth: 580, marginTop: 10, fontSize: 15 }}>Upload a PDF or paste your resume, score it against a job description, fix the gaps, and download a tailored, ATS-clean copy.</p>
        </div>

        <div style={{ display: "flex", gap: 6, background: cardc, border: "1px solid " + line, borderRadius: 10, padding: 5, marginBottom: 14, maxWidth: 360 }}>
          <div style={tab(mode === "paste")} onClick={() => { setMode("paste"); resetOutputs(); setError(""); }}>Paste text / LaTeX</div>
          <div style={tab(mode === "pdf")} onClick={() => { setMode("pdf"); resetOutputs(); setError(""); }}>Upload PDF</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: 18 }}>
          <div>
            <div style={label}><span>Your résumé</span>{fmt && <span style={{ color: teal }}>{fmt}</span>}</div>
            {mode === "paste" ? (
              <textarea style={ta} value={resume} onChange={(e) => { setResume(e.target.value); resetOutputs(); }} placeholder="Paste your full resume — LaTeX (Jake's Resume / Overleaf) or plain text…" />
            ) : (
              <label
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                style={{ ...ta, minHeight: 210, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", cursor: "pointer", gap: 8, border: dragging ? "2px dashed " + teal : "1px solid " + line, background: dragging ? teal + "10" : cardc }}
              >
                <input type="file" accept=".pdf,application/pdf" onChange={onFile} style={{ display: "none" }} />
                <div style={{ fontSize: 30 }}>⇪</div>
                {extracting ? <div style={{ color: muted }}>Reading your PDF…</div> : pdfName ? (
                  <><div style={{ color: teal, fontWeight: 700 }}>{pdfName}</div><div style={{ color: muted, fontSize: 11 }}>{struct ? "Parsed ✓ — click to replace" : "click to replace"}</div></>
                ) : (
                  <><div style={{ fontWeight: 700 }}>Click to upload a PDF resume</div><div style={{ color: muted, fontSize: 11 }}>…or drag &amp; drop it here · text is extracted automatically</div></>
                )}
              </label>
            )}
          </div>
          <div>
            <div style={label}><span>Job description</span></div>
            <textarea style={ta} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job posting you're targeting…" />
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
          <button style={btn(ink, analyzing || extracting)} disabled={analyzing || extracting} onClick={analyze}>{analyzing ? "Analyzing…" : "Analyze ATS match"}</button>
          {result && <button style={btn(teal, tailoring)} disabled={tailoring} onClick={tailor}>{tailoring ? "Rewriting…" : "Tailor my résumé →"}</button>}
        </div>

        {error && <div style={{ marginTop: 16, color: clay, fontFamily: "'Space Mono',monospace", fontSize: 13 }}>{error}</div>}

        {(analyzing || tailoring) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, color: muted, fontSize: 14 }}>
            <span style={{ width: 16, height: 16, border: "2px solid " + line, borderTopColor: teal, borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />
            {analyzing ? "Comparing your resume against the job description…" : "Rewriting your resume…"}
          </div>
        )}

        {result && (
          <>
            <div style={{ ...block, display: "flex", gap: 26, alignItems: "center", flexWrap: "wrap" }}>
              <svg width="124" height="124" viewBox="0 0 124 124">
                <circle cx="62" cy="62" r={R} fill="none" stroke={line} strokeWidth="11" />
                <circle cx="62" cy="62" r={R} fill="none" stroke={scoreColor(sc)} strokeWidth="11" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC - (CIRC * sc) / 100} transform="rotate(-90 62 62)" />
                <text x="62" y="58" textAnchor="middle" style={{ fontFamily: "'Fraunces',serif", fontWeight: 900, fontSize: 30, fill: ink }}>{sc}</text>
                <text x="62" y="78" textAnchor="middle" style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, fill: muted, letterSpacing: 1 }}>/ 100</text>
              </svg>
              <div style={{ flex: 1, minWidth: 220 }}>
                <h3 style={{ ...h3, margin: "0 0 6px" }}>ATS match score</h3>
                <p style={{ color: muted, margin: 0, fontSize: 14.5 }}>{result.scoreReason}</p>
              </div>
            </div>

            {result.topActions && result.topActions.length > 0 && (
              <div style={block}><h3 style={h3}>Highest-impact fixes</h3>
                <ol style={{ margin: 0, paddingLeft: 20 }}>{result.topActions.map((a, i) => <li key={i} style={{ marginBottom: 8, fontSize: 14.5 }}>{a}</li>)}</ol>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px,1fr))", gap: 18 }}>
              <div style={block}><h3 style={{ ...h3, color: clay }}>Missing keywords <span style={{ color: muted, fontSize: 13, fontFamily: "'Space Mono',monospace" }}>({(result.missingKeywords || []).length})</span></h3>
                <div>{(result.missingKeywords || []).length === 0 ? <span style={{ color: muted }}>Nothing critical missing 🎉</span> : result.missingKeywords.map((k, i) => <span key={i} style={chip(clay, clay + "12")}>{k}</span>)}</div>
              </div>
              <div style={block}><h3 style={{ ...h3, color: teal }}>Matched keywords <span style={{ color: muted, fontSize: 13, fontFamily: "'Space Mono',monospace" }}>({(result.matchedKeywords || []).length})</span></h3>
                <div>{(result.matchedKeywords || []).map((k, i) => <span key={i} style={chip(teal, teal + "12")}>{k}</span>)}</div>
              </div>
            </div>

            {result.formatIssues && result.formatIssues.length > 0 && (
              <div style={block}><h3 style={h3}>Formatting / parsing risks</h3>
                {result.formatIssues.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 9, fontSize: 14.5 }}>
                    <span style={{ ...chip(sevColor(f.severity), sevColor(f.severity) + "14"), margin: 0, flexShrink: 0, fontSize: 10.5, textTransform: "uppercase" }}>{f.severity}</span>
                    <span>{f.issue}</span>
                  </div>
                ))}
              </div>
            )}

            {result.sectionFeedback && result.sectionFeedback.length > 0 && (
              <div style={block}><h3 style={h3}>Section-by-section notes</h3>
                {result.sectionFeedback.map((s, i) => (
                  <div key={i} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: i < result.sectionFeedback.length - 1 ? "1px solid " + line : "none" }}>
                    <div style={{ display: "flex", gap: 9, alignItems: "center", marginBottom: 3 }}>
                      <strong style={{ fontSize: 14.5 }}>{s.section}</strong>
                      <span style={{ ...chip(sevColor(s.priority), sevColor(s.priority) + "14"), margin: 0, fontSize: 9.5, padding: "2px 8px", textTransform: "uppercase" }}>{s.priority}</span>
                    </div>
                    <div style={{ color: muted, fontSize: 14 }}>{s.feedback}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tailoredLatex && (
          <div style={block}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
              <h3 style={{ ...h3, margin: 0 }}>Tailored résumé <span style={{ color: muted, fontSize: 13, fontFamily: "'Space Mono',monospace" }}>(LaTeX)</span></h3>
              <div style={{ display: "flex", gap: 10 }}>
                <button style={btn("transparent", false)} onClick={() => copy(tailoredLatex)}>{copied ? "Copied ✓" : "Copy"}</button>
                <button style={btn(teal, false)} onClick={() => downloadTextFile("resume_tailored.tex", tailoredLatex)}>Download .tex ↧</button>
              </div>
            </div>
            <p style={{ color: muted, fontSize: 13, marginTop: 0 }}>Open the .tex in Overleaf and recompile for a pixel-identical PDF. Review every line — keep only what's true to your real experience.</p>
            <pre style={{ background: paper, border: "1px solid " + line, borderRadius: 10, padding: 16, overflow: "auto", fontFamily: "'Space Mono',monospace", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 460, margin: 0 }}>{tailoredLatex}</pre>
          </div>
        )}

        {tailoredStruct && (
          <div style={block}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <h3 style={{ ...h3, margin: 0 }}>Tailored résumé <span style={{ color: muted, fontSize: 13, fontFamily: "'Space Mono',monospace" }}>(ATS-clean)</span></h3>
              <div style={{ display: "flex", gap: 10 }}>
                <button style={btn(teal, downloading)} disabled={downloading} onClick={handleDownloadPDF}>{downloading ? "Building…" : "Download PDF ↧"}</button>
                <button style={btn("transparent", false)} onClick={() => window.print()}>Print / Save as PDF</button>
              </div>
            </div>
            <p style={{ color: muted, fontSize: 13, marginTop: 0 }}>“Download PDF” saves a real-text, ATS-readable file to your downloads folder. Real selectable text, standard headings — parses cleanly in any ATS.</p>
            <ResumePreview data={tailoredStruct} />
          </div>
        )}

        <p style={{ marginTop: 30, color: muted, fontSize: 12, fontFamily: "'Space Mono',monospace", textAlign: "center" }}>Always review AI edits before sending — never let it add anything you haven't actually done.</p>
      </div>
    </div>
  );
}

function ResumePreview({ data }) {
  const rs = { background: "#ffffff", color: "#111", border: "1px solid " + line, borderRadius: 8, padding: "40px 46px", fontFamily: "Georgia, 'Times New Roman', serif", lineHeight: 1.4, boxShadow: "0 8px 30px rgba(0,0,0,.06)" };
  return (
    <div id="resume-print" style={rs}>
      <div style={{ textAlign: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 0.5 }}>{data.name}</div>
        {data.headline && <div style={{ fontSize: 13, color: "#444", marginTop: 2 }}>{data.headline}</div>}
        {data.contact && data.contact.length > 0 && (
          <div style={{ fontSize: 12, color: "#333", marginTop: 6, fontFamily: "Arial, sans-serif" }}>{data.contact.join("  •  ")}</div>
        )}
      </div>
      {(data.sections || []).map((sec, i) => (
        <div key={i} style={{ marginTop: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, borderBottom: "1.5px solid #111", paddingBottom: 3, marginBottom: 8, fontFamily: "Arial, sans-serif" }}>{sec.heading}</div>
          {(sec.entries || []).map((en, j) => (
            <div key={j} style={{ marginBottom: 10 }}>
              {(en.title || en.date) && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{en.title}</span>
                  <span style={{ fontSize: 12, color: "#444", whiteSpace: "nowrap" }}>{en.date}</span>
                </div>
              )}
              {(en.subtitle || en.location) && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontStyle: "italic", fontSize: 12.5, color: "#333" }}>
                  <span>{en.subtitle}</span><span style={{ whiteSpace: "nowrap" }}>{en.location}</span>
                </div>
              )}
              {en.bullets && en.bullets.length > 0 && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>{en.bullets.map((b, k) => <li key={k} style={{ fontSize: 12.5, marginBottom: 2 }}>{b}</li>)}</ul>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
