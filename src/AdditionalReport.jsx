import React, { useCallback, useEffect, useRef, useState } from "react";

const BTN_SECONDARY = {
  padding: "8px 14px",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  background: "#e2e8f0",
  color: "#475569",
};
const BTN_DANGER = {
  padding: "6px 10px",
  border: "none",
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  background: "#fee2e2",
  color: "#b91c1c",
  lineHeight: 1,
};

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Windows/Office/일부 앱 클립보드(CF_HTML)의 본문 구간만 추출 */
function extractClipboardFragment(html) {
  let s = String(html || "");
  const startM = s.match(/<!--StartFragment-->/i);
  const endM = s.match(/<!--EndFragment-->/i);
  if (startM && endM && endM.index > startM.index) {
    s = s.slice(startM.index + startM[0].length, endM.index);
  }
  return s.trim();
}

/** 붙여넣기 HTML: 스크립트·위험 속성만 제거, class·style·표 구조는 최대한 유지 */
function sanitizePastedHtml(raw) {
  const rawStr = extractClipboardFragment(String(raw || "").trim());
  if (!rawStr) return "";
  let doc;
  try {
    doc = new DOMParser().parseFromString(rawStr, "text/html");
  } catch {
    return "";
  }
  doc.querySelectorAll("script, iframe, object, embed, link[rel='import'], meta[http-equiv]").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    const drop = [];
    for (const attr of el.attributes) {
      const name = attr.name.toLowerCase();
      const val = attr.value || "";
      if (name.startsWith("on")) drop.push(attr.name);
      else if ((name === "href" || name === "src" || name === "xlink:href") && /^\s*javascript:/i.test(val)) drop.push(attr.name);
    }
    drop.forEach((n) => el.removeAttribute(n));
  });
  doc.querySelectorAll("[style]").forEach((el) => {
    const v = el.getAttribute("style");
    if (v != null && !String(v).trim()) el.removeAttribute("style");
  });
  /* 붙여넣은 이미지의 width/height 속성이 있으면 이후 % 크기 조절이 브라우저에서 무시되는 경우가 있음 */
  doc.querySelectorAll("img").forEach((img) => {
    img.removeAttribute("width");
    img.removeAttribute("height");
  });
  normalizePastedTableToHorizontalRules(doc);
  relaxPastedTablesToFitWidth(doc);
  return doc.body.innerHTML.trim();
}

/** 붙여넣은 표가 입력란보다 넓어지지 않도록 고정 width·nowrap 등 제거 */
function relaxPastedTablesToFitWidth(doc) {
  doc.querySelectorAll("table").forEach((t) => {
    t.removeAttribute("width");
  });
  doc.querySelectorAll("col, colgroup, tr, td, th").forEach((el) => {
    el.removeAttribute("width");
  });
  const stripSizing = (st) => {
    let s = String(st || "");
    s = s
      .replace(/\b(min-)?width\s*:\s*[^;]+;?/gi, "")
      .replace(/\bmax-width\s*:\s*[^;]+;?/gi, "")
      .replace(/\bwhite-space\s*:\s*nowrap\b;?/gi, "")
      .replace(/\bword-break\s*:\s*keep-all\b;?/gi, "");
    return s.trim().replace(/;\s*;/g, ";").replace(/^;+|;+$/g, "").trim();
  };
  doc.querySelectorAll("table, col, colgroup, td, th").forEach((el) => {
    if (!el.hasAttribute("style")) return;
    const next = stripSizing(el.getAttribute("style"));
    if (next) el.setAttribute("style", next);
    else el.removeAttribute("style");
  });
}

/** 저장된 본문을 불러올 때도 표가 입력란 너비에 맞도록 동일 처리 */
function normalizeStoredHtmlTables(html) {
  const h = String(html || "");
  if (!h || !/<table/i.test(h)) return h;
  try {
    const doc = new DOMParser().parseFromString(h, "text/html");
    relaxPastedTablesToFitWidth(doc);
    return doc.body.innerHTML.trim();
  } catch {
    return h;
  }
}

/**
 * 제미나이·클로드 등에서 복사한 표가 셀마다 사방 테두리인 경우,
 * 원본(가로 구분선 위주)에 가깝게 아래쪽 선만 남깁니다. padding·색·정렬은 유지.
 */
function normalizePastedTableToHorizontalRules(doc) {
  doc.querySelectorAll("table").forEach((table) => {
    const cells = [...table.querySelectorAll("td, th")];
    if (cells.length < 4) return;
    let boxed = 0;
    for (const c of cells) {
      const st = (c.getAttribute("style") || "").toLowerCase();
      if (!st) continue;
      const hasBoxBorder =
        /\bborder\s*:\s*(?!none\b)[^;]+/i.test(st) ||
        /\bborder-left\s*:/i.test(st) ||
        /\bborder-right\s*:/i.test(st);
      if (hasBoxBorder) boxed++;
    }
    if (boxed < Math.ceil(cells.length * 0.5)) return;
    for (const c of cells) {
      let st = c.getAttribute("style") || "";
      st = st
        .replace(/\bborder-(top|right|bottom|left|inline-start|inline-end|block-start|block-end)\s*:\s*[^;]+;?/gi, "")
        .replace(/\bborder\s*:\s*[^;]+;?/gi, "")
        .replace(/\boutline\s*:\s*[^;]+;?/gi, "");
      st = st.trim().replace(/;\s*;/g, ";").replace(/^;+|;+$/g, "").trim();
      const line = "border-bottom: 1px solid #ececec";
      c.setAttribute("style", st ? `${st}; ${line}` : line);
    }
    const firstRow = table.querySelector("tr");
    if (firstRow) {
      firstRow.querySelectorAll("th, td").forEach((c) => {
        let st = c.getAttribute("style") || "";
        st = st.replace(/\bborder-bottom\s*:\s*[^;]+;?/gi, "").trim().replace(/^;+|;+$/g, "").replace(/;\s*;/g, ";");
        const hdr = "border-bottom: 1px solid #d0d0d0";
        c.setAttribute("style", st ? `${st}; ${hdr}` : hdr);
      });
    }
  });
}

function insertHtmlAtSelection(container, htmlString, onHtmlChange) {
  if (!container || htmlString == null || String(htmlString).trim() === "") return;
  container.focus();
  const sel = window.getSelection();
  let range;
  if (sel?.rangeCount > 0 && container.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0);
    range.deleteContents();
  } else {
    range = document.createRange();
    range.selectNodeContents(container);
    range.collapse(false);
  }
  const temp = document.createElement("div");
  temp.innerHTML = htmlString;
  const frag = document.createDocumentFragment();
  const nodes = [];
  while (temp.firstChild) {
    nodes.push(temp.firstChild);
    frag.appendChild(temp.firstChild);
  }
  const last = nodes[nodes.length - 1];
  range.insertNode(frag);
  if (last && sel) {
    range.setStartAfter(last);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  onHtmlChange(container.innerHTML);
}

/* 인라인 style이 있으면 유지. 없는 셀은 제미나이 뷰에 가깝게: 가로선만·넉넉한 패딩·표는 영역 너비 활용 */
export const RICH_PROSE_CSS = `
  .ar-rich-prose {
    line-height: 1.65;
    color: #1a1a1a;
    font-size: clamp(15px, 0.95vw + 13px, 17px);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
      "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
    word-break: break-word;
    overflow-x: hidden;
    max-width: 100%;
  }
  .ar-rich-prose p:not([style]) { margin: 0 0 12px; min-height: 1em; }
  .ar-rich-prose p:not([style]):last-child { margin-bottom: 0; }
  .ar-rich-prose p:not([style]) strong,
  .ar-rich-prose strong:not([style]) { font-weight: 700; }
  .ar-rich-prose h1:not([style]), .ar-rich-prose h2:not([style]), .ar-rich-prose h3:not([style]), .ar-rich-prose h4:not([style]) {
    margin: 18px 0 10px;
    font-weight: 700;
    line-height: 1.35;
    color: inherit;
  }
  .ar-rich-prose h1:not([style]):first-child, .ar-rich-prose h2:not([style]):first-child, .ar-rich-prose h3:not([style]):first-child { margin-top: 0; }
  .ar-rich-prose h1:not([style]) { font-size: 1.35em; }
  .ar-rich-prose h2:not([style]) { font-size: 1.2em; }
  .ar-rich-prose h3:not([style]) { font-size: 1.08em; }
  .ar-rich-prose h4:not([style]) { font-size: 1.02em; }
  .ar-rich-prose table {
    border-collapse: collapse;
    width: 100% !important;
    max-width: 100% !important;
    margin: 12px 0 16px;
    font-size: 1em;
    table-layout: fixed !important;
    border: none;
    box-sizing: border-box;
  }
  .ar-rich-prose th,
  .ar-rich-prose td {
    word-break: break-word;
    overflow-wrap: break-word;
    white-space: normal !important;
    min-width: 0;
    box-sizing: border-box;
  }
  .ar-rich-prose th:not([style]),
  .ar-rich-prose td:not([style]) {
    border: none;
    border-bottom: 1px solid #ececec;
    padding: 14px 14px;
    vertical-align: middle;
    text-align: start;
  }
  .ar-rich-prose thead th:not([style]),
  .ar-rich-prose tbody tr:first-child th:not([style]),
  .ar-rich-prose tr:first-child > th:not([style]) {
    font-weight: 700;
    background: transparent;
    border-bottom: 1px solid #d8d8d8;
    padding-top: 4px;
    padding-bottom: 16px;
  }
  .ar-rich-prose ul:not([style]), .ar-rich-prose ol:not([style]) { margin: 8px 0; padding-left: 1.5em; }
  .ar-rich-prose li:not([style]) { margin: 4px 0; }
  .ar-rich-prose li:not([style]) > p:not([style]) { margin: 2px 0; }
  .ar-rich-prose blockquote:not([style]) {
    margin: 10px 0;
    padding: 8px 12px;
    border-left: 3px solid #d4d4d8;
    background: #fafafa;
    color: #3f3f46;
  }
  .ar-rich-prose pre:not([style]) {
    margin: 10px 0;
    padding: 10px 12px;
    background: #f4f4f5;
    border: 1px solid #e5e5e7;
    border-radius: 6px;
    font-size: 13px;
    font-family: ui-monospace, "Cascadia Code", "Malgun Gothic", monospace;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
  }
  .ar-rich-prose code:not([style]) {
    font-family: ui-monospace, "Cascadia Code", "Malgun Gothic", monospace;
    font-size: 0.9em;
    background: #f4f4f5;
    padding: 2px 5px;
    border-radius: 4px;
  }
  .ar-rich-prose pre:not([style]) code:not([style]) { padding: 0; background: none; font-size: inherit; }
  .ar-rich-prose hr:not([style]) { margin: 16px 0; border: none; border-top: 1px solid #e5e5e7; }
  .ar-rich-prose p.ar-img-line { margin: 10px 0; line-height: 0; }
  .ar-rich-prose p.ar-img-line + p.ar-img-line { margin-top: 8px; }
  .ar-rich-prose img { max-width: 100%; height: auto; vertical-align: middle; }
  .ar-rich-prose p.ar-img-line img { display: inline-block; }
  .ar-rich-prose a:not([style]) { color: #2563eb; text-decoration: underline; }
  .ar-rich-input.ar-rich-prose[data-placeholder]:empty:before {
    content: attr(data-placeholder);
    color: #94a3b8;
    pointer-events: none;
  }
`;

/** 저장·미리보기에 쓸 본문이 비었는지 (텍스트·이미지 포함) */
function isNonEmptyBody(html) {
  const h = String(html || "");
  if (/<img[\s>]/i.test(h)) return true;
  const text = h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&nbsp;/g, " ").trim();
  return text.length > 0;
}

function normalizeLoadedPrompt(p) {
  const id = p.id || uid();
  let html = p.html;
  if (html == null || html === "") {
    const legacy = p.text ?? "";
    html = legacy ? `<p>${escapeHtml(legacy)}</p>` : "";
  } else {
    html = normalizeStoredHtmlTables(html);
  }
  return { id, html };
}

function getImgWidthPercent(img) {
  if (!img) return 85;
  const sw = img.style?.width;
  const m = String(sw || "").match(/(\d+(?:\.\d+)?)%/);
  if (m) return Math.min(100, Math.max(10, Math.round(parseFloat(m[1]))));
  const aw = img.getAttribute("width");
  if (aw != null && String(aw).trim() !== "") {
    const root = img.closest?.(".ar-rich-input, .ar-rich-body, .ar-rich-prose");
    const rw = root?.clientWidth || img.parentElement?.clientWidth || 400;
    const px = parseFloat(String(aw).replace(/px/i, ""));
    if (!Number.isNaN(px) && rw > 0) return Math.min(100, Math.max(10, Math.round((px / rw) * 100)));
  }
  return 85;
}

/** 이미지 줄: 정렬은 부모 p(text-align), 크기는 img width % */
function insertImageAtSelection(container, dataUrl, onHtmlChange) {
  if (!container) return;
  container.focus();
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "";
  img.style.width = "85%";
  img.style.maxWidth = "100%";
  img.style.height = "auto";
  img.style.display = "inline-block";
  img.style.verticalAlign = "middle";
  const wrap = document.createElement("p");
  wrap.className = "ar-img-line";
  wrap.style.textAlign = "center";
  wrap.style.margin = "10px 0";
  wrap.style.lineHeight = "0";
  wrap.appendChild(img);
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && container.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(wrap);
    range.setStartAfter(wrap);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    container.appendChild(wrap);
  }
  onHtmlChange(container.innerHTML);
}

function RichInput({ html, readOnly, onChange, placeholder, inputKey }) {
  const ph = placeholder?.trim() ? placeholder.trim() : undefined;
  const ref = useRef(null);
  const skipRef = useRef(false);
  const [pickedImg, setPickedImg] = useState(null);
  const [imgBarRect, setImgBarRect] = useState(null);

  // inputKey가 바뀔 때만 DOM 동기화(주차·저장본 로드 등). html만 바뀌는 타이핑은 contentEditable에 맡겨 커서가 튀지 않게 함.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    skipRef.current = true;
    el.innerHTML = html || "";
    skipRef.current = false;
    setPickedImg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- html은 키 변경 시점의 스냅샷만 반영
  }, [inputKey]);

  const emit = useCallback(() => {
    if (skipRef.current) return;
    onChange(ref.current?.innerHTML ?? "");
  }, [onChange]);

  const applyImgWidth = useCallback(
    (pct) => {
      if (!pickedImg || !ref.current) return;
      const img = pickedImg;
      /* HTML width/height 속성이 있으면 CSS width보다 우선해 % 조절이 무시되는 경우가 많음 */
      img.removeAttribute("width");
      img.removeAttribute("height");
      img.style.removeProperty("width");
      img.style.removeProperty("max-width");
      img.style.setProperty("width", `${pct}%`, "important");
      img.style.setProperty("max-width", "100%", "important");
      img.style.setProperty("height", "auto", "important");
      img.style.setProperty("display", "inline-block", "important");
      img.style.setProperty("vertical-align", "middle", "important");
      onChange(ref.current.innerHTML);
    },
    [pickedImg, onChange]
  );

  const applyImgAlign = useCallback(
    (align) => {
      if (!pickedImg || !ref.current) return;
      let p = pickedImg.closest("p.ar-img-line");
      if (!p || !ref.current.contains(p)) {
        p = document.createElement("p");
        p.className = "ar-img-line";
        p.style.margin = "10px 0";
        p.style.lineHeight = "0";
        pickedImg.parentNode.insertBefore(p, pickedImg);
        p.appendChild(pickedImg);
      }
      p.style.textAlign = align;
      onChange(ref.current.innerHTML);
    },
    [pickedImg, onChange]
  );

  const execParaAlign = useCallback(
    (cmd) => {
      if (!ref.current || readOnly) return;
      ref.current.focus();
      try {
        document.execCommand(cmd, false);
      } catch {
        /* noop */
      }
      emit();
    },
    [readOnly, emit]
  );

  useEffect(() => {
    if (!pickedImg) {
      setImgBarRect(null);
      return;
    }
    const upd = () => {
      if (!pickedImg.isConnected) {
        setPickedImg(null);
        return;
      }
      const r = pickedImg.getBoundingClientRect();
      setImgBarRect({ top: r.bottom + 6, left: r.left, w: Math.min(280, Math.max(200, r.width)) });
    };
    upd();
    window.addEventListener("scroll", upd, true);
    window.addEventListener("resize", upd);
    return () => {
      window.removeEventListener("scroll", upd, true);
      window.removeEventListener("resize", upd);
    };
  }, [pickedImg]);

  useEffect(() => {
    if (readOnly) return;
    const onDocDown = (e) => {
      if (e.target.closest?.(".ar-img-toolbar")) return;
      const root = ref.current;
      if (!root) return;
      if (e.target.tagName === "IMG" && root.contains(e.target)) {
        setPickedImg(e.target);
        return;
      }
      setPickedImg(null);
    };
    document.addEventListener("mousedown", onDocDown, true);
    return () => document.removeEventListener("mousedown", onDocDown, true);
  }, [readOnly]);

  const onPaste = useCallback(
    (e) => {
      if (readOnly) return;
      const cd = e.clipboardData;
      if (!cd) return;

      if (cd.items) {
        for (let i = 0; i < cd.items.length; i++) {
          const it = cd.items[i];
          if (it.kind === "file" && it.type.startsWith("image/")) {
            e.preventDefault();
            const file = it.getAsFile();
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => insertImageAtSelection(ref.current, reader.result, onChange);
            reader.readAsDataURL(file);
            return;
          }
        }
      }

      const htmlRaw = cd.getData("text/html");
      if (htmlRaw && htmlRaw.trim()) {
        const cleaned = sanitizePastedHtml(htmlRaw);
        const textOnly = cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&nbsp;/g, " ").trim();
        if (cleaned && (textOnly.length > 0 || /<img[\s>]/i.test(cleaned))) {
          e.preventDefault();
          insertHtmlAtSelection(ref.current, cleaned, onChange);
          return;
        }
      }

      const plain = cd.getData("text/plain");
      if (plain != null && String(plain).trim() !== "") {
        e.preventDefault();
        const parts = String(plain).split(/\n{2,}/);
        const inner = parts.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`).join("");
        insertHtmlAtSelection(ref.current, inner, onChange);
      }
    },
    [readOnly, onChange]
  );

  const fileInputRef = useRef(null);
  const onPickImage = useCallback(
    (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f || !f.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => insertImageAtSelection(ref.current, reader.result, onChange);
      reader.readAsDataURL(f);
    },
    [onChange]
  );

  const widthPct = pickedImg ? getImgWidthPercent(pickedImg) : 85;

  return (
    <>
      {!readOnly ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
            marginBottom: 8,
            fontSize: 11,
            color: "#475569",
          }}
        >
          <span style={{ fontWeight: 700, marginRight: 4 }}>본문 정렬</span>
          <button type="button" onClick={() => execParaAlign("justifyLeft")} style={{ ...BTN_SECONDARY, padding: "5px 10px", fontSize: 11 }} title="왼쪽">
            왼쪽
          </button>
          <button type="button" onClick={() => execParaAlign("justifyCenter")} style={{ ...BTN_SECONDARY, padding: "5px 10px", fontSize: 11 }} title="가운데">
            가운데
          </button>
          <button type="button" onClick={() => execParaAlign("justifyRight")} style={{ ...BTN_SECONDARY, padding: "5px 10px", fontSize: 11 }} title="오른쪽">
            오른쪽
          </button>
          <span style={{ opacity: 0.65, fontSize: 10, marginLeft: 4 }}>빈 줄·스페이스 후 가운데 정렬 가능</span>
        </div>
      ) : null}
      <div style={{ position: "relative" }}>
        <div
          ref={ref}
          className="ar-rich-input ar-rich-prose"
          contentEditable={!readOnly}
          suppressContentEditableWarning
          data-placeholder={ph}
          onInput={emit}
          onBlur={emit}
          onPaste={onPaste}
          style={{
            width: "100%",
            maxWidth: "100%",
            minHeight: 200,
            padding: 12,
            border: "1px solid #d1d5db",
            borderRadius: 8,
            boxSizing: "border-box",
            outline: "none",
            background: readOnly ? "#f8fafc" : "#fff",
            overflowX: "hidden",
          }}
        />
        {!readOnly && pickedImg && imgBarRect ? (
          <div
            className="ar-img-toolbar no-print"
            onMouseDown={(e) => {
              if (e.target.closest("input, button, textarea, select")) return;
              e.preventDefault();
            }}
            style={{
              position: "fixed",
              left: Math.min(window.innerWidth - 292, Math.max(8, imgBarRect.left)),
              top: Math.min(window.innerHeight - 120, imgBarRect.top),
              zIndex: 9999,
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "10px 12px",
              boxShadow: "0 8px 28px rgba(0,0,0,.18)",
              width: 280,
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>이미지 크기 · 위치</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, whiteSpace: "nowrap", color: "#64748b" }}>너비 {widthPct}%</span>
              <input
                type="range"
                min={15}
                max={100}
                value={widthPct}
                onInput={(e) => applyImgWidth(Number(e.target.value))}
                onChange={(e) => applyImgWidth(Number(e.target.value))}
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button type="button" onClick={() => applyImgAlign("left")} style={{ ...BTN_SECONDARY, padding: "5px 10px", fontSize: 11 }}>
                ◀ 왼쪽
              </button>
              <button type="button" onClick={() => applyImgAlign("center")} style={{ ...BTN_SECONDARY, padding: "5px 10px", fontSize: 11 }}>
                중앙
              </button>
              <button type="button" onClick={() => applyImgAlign("right")} style={{ ...BTN_SECONDARY, padding: "5px 10px", fontSize: 11 }}>
                오른쪽 ▶
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {!readOnly ? (
        <div style={{ marginTop: 6 }}>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickImage} />
          <button type="button" onClick={() => fileInputRef.current?.click()} style={{ ...BTN_SECONDARY, padding: "6px 12px", fontSize: 11 }}>
            이미지 첨부
          </button>
        </div>
      ) : null}
    </>
  );
}

export default function AdditionalReport({ data, onSave, readOnly, weekKey, weekLabel, onGoToReport, onOpenPtAdditional }) {
  const [items, setItems] = useState(() => [{ id: uid(), html: "" }]);
  const [toast, setToast] = useState(null);
  const [contentOnlyView, setContentOnlyView] = useState(false);

  const savedWeekSig = JSON.stringify(data.additionalReports?.[weekKey] ?? null);
  useEffect(() => {
    const saved = data.additionalReports?.[weekKey];
    if (saved?.prompts?.length) {
      const mapped = saved.prompts.map(normalizeLoadedPrompt);
      setItems(mapped);
      setContentOnlyView(mapped.some((p) => isNonEmptyBody(p.html)));
    } else {
      setItems([{ id: uid(), html: "" }]);
      setContentOnlyView(false);
    }
  }, [weekKey, savedWeekSig]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const addBlock = useCallback(() => {
    setItems((prev) => [...prev, { id: uid(), html: "" }]);
  }, []);

  const removeBlock = useCallback((id) => {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.id !== id)));
  }, []);

  const updateHtml = useCallback((id, html) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, html } : p)));
  }, []);

  const saveWeek = useCallback(() => {
    if (!weekKey) {
      window.alert("보고서 기준일(reportDate)을 설정해 주세요. 주차 키를 만들 수 없습니다.");
      return;
    }
    const prompts = items.map(({ id, html }) => ({ id, html }));
    const additionalReports = {
      ...(data.additionalReports || {}),
      [weekKey]: { updatedAt: new Date().toISOString(), prompts },
    };
    onSave({ additionalReports });
    const hasBody = prompts.some((p) => isNonEmptyBody(p.html));
    if (hasBody) setContentOnlyView(true);
    setToast("저장되었습니다.");
  }, [data, items, onSave, weekKey]);

  const displayContentOnly = readOnly || contentOnlyView;
  const reportBlocks = items.filter((i) => isNonEmptyBody(i.html));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <style>{RICH_PROSE_CSS}</style>
      {toast ? (
        <div
          className="no-print"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 200,
            background: "#0f172a",
            color: "#fff",
            padding: "12px 22px",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 700,
            boxShadow: "0 10px 40px rgba(0,0,0,.2)",
            maxWidth: "min(90vw, 400px)",
            textAlign: "center",
          }}
        >
          {toast}
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px", color: "#0f172a" }}>추가 보고</h2>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
            {weekLabel ? (
              <>
                저장·불러오기 주차: <b style={{ color: "#0369a1" }}>{weekLabel}</b> ({weekKey})
              </>
            ) : (
              "기준일을 설정하면 주차 키로 저장됩니다."
            )}
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", flexShrink: 0 }}>
          {onOpenPtAdditional ? (
            <button
              type="button"
              className="no-print"
              onClick={onOpenPtAdditional}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "none",
                background: "#0f172a",
                color: "#fff",
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              📺 PT
            </button>
          ) : null}
          {onGoToReport ? (
            <button
              type="button"
              className="no-print"
              onClick={onGoToReport}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                background: "#f1f5f9",
                color: "#0f172a",
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              ‹ 보고서
            </button>
          ) : null}
        </div>
      </div>

      {displayContentOnly ? (
        <>
          {!readOnly ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <button type="button" onClick={() => setContentOnlyView(false)} style={{ ...BTN_SECONDARY, padding: "8px 18px" }}>
                편집
              </button>
            </div>
          ) : null}
          {reportBlocks.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
              저장된 보고 내용이 없습니다. {!readOnly ? "편집에서 입력 후 저장하세요." : null}
            </div>
          ) : (
            reportBlocks.map((item) => (
              <div
                key={item.id}
                style={{
                  background: "#fff",
                  borderRadius: 14,
                  border: "1px solid #e2e8f0",
                  padding: "clamp(12px, 3vw, 18px)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "#0f172a",
                  wordBreak: "break-word",
                }}
              >
                <div className="ar-rich-body ar-rich-prose" dangerouslySetInnerHTML={{ __html: item.html || "" }} />
              </div>
            ))
          )}
          {!readOnly ? (
            <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16, marginTop: 8 }}>
              <button
                type="button"
                onClick={saveWeek}
                style={{
                  padding: "12px 28px",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: "pointer",
                  background: "linear-gradient(135deg,#16a34a,#15803d)",
                  color: "#fff",
                }}
              >
                저장
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {items.map((item, index) => (
            <div
              key={item.id}
              style={{
                background: "#fff",
                borderRadius: 14,
                border: "1px solid #e2e8f0",
                padding: "clamp(12px, 3vw, 18px)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>입력란 {index + 1}</span>
                <button
                  type="button"
                  disabled={readOnly || items.length <= 1}
                  onClick={() => removeBlock(item.id)}
                  title="삭제"
                  style={{ ...BTN_DANGER, opacity: readOnly || items.length <= 1 ? 0.45 : 1, cursor: readOnly || items.length <= 1 ? "not-allowed" : "pointer" }}
                >
                  ✕
                </button>
              </div>
              <RichInput
                inputKey={`${weekKey}:${savedWeekSig}:${item.id}`}
                html={item.html}
                readOnly={readOnly}
                onChange={(h) => updateHtml(item.id, h)}
              />
            </div>
          ))}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button type="button" disabled={readOnly} onClick={addBlock} style={{ ...BTN_SECONDARY, opacity: readOnly ? 0.5 : 1, cursor: readOnly ? "not-allowed" : "pointer" }}>
              ＋ 입력란 추가
            </button>
          </div>

          <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16, marginTop: 8 }}>
            <button
              type="button"
              disabled={readOnly}
              onClick={saveWeek}
              style={{
                padding: "12px 28px",
                border: "none",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 800,
                cursor: readOnly ? "not-allowed" : "pointer",
                background: readOnly ? "#cbd5e1" : "linear-gradient(135deg,#16a34a,#15803d)",
                color: "#fff",
                opacity: readOnly ? 0.7 : 1,
              }}
            >
              저장
            </button>
          </div>
        </>
      )}
    </div>
  );
}
