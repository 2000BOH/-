import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/** .env 값 정리: 따옴표·BOM·Bearer·불필요 공백 제거 */
function sanitizeApiKey(raw) {
  if (raw == null) return "";
  let s = String(raw);
  s = s.replace(/^\uFEFF/, "");
  s = s.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^Bearer\s+/i, "").trim();
  s = s.replace(/\s+/g, "");
  return s;
}

/** Flash·경량 모델 우선 (동일 키에서 ListModels 결과 정렬) */
function rankGeminiModelId(id) {
  const x = String(id).toLowerCase();
  if (x.includes("embedding") || x.includes("embed")) return 200;
  if (x.includes("imagen") || x.includes("tts") || x.includes("aqa")) return 200;
  if (x.includes("gemini-2.5") && x.includes("flash")) return 0;
  if (x.includes("gemini-2.0") && x.includes("flash")) return 1;
  if (x.includes("gemini-2.0")) return 2;
  if (x.includes("gemini-1.5") && x.includes("flash") && !x.includes("8b")) return 3;
  if (x.includes("gemini-1.5") && x.includes("flash")) return 4;
  if (x.includes("flash")) return 5;
  if (x.includes("gemini-1.5") && x.includes("pro")) return 12;
  if (x.includes("pro")) return 14;
  return 8;
}

let __geminiListCache = { key: "", ids: /** @type {string[] | null} */ (null), at: 0 };
const GEMINI_LIST_TTL_MS = 5 * 60 * 1000;

/**
 * 이 API 키로 호출 가능한 모델만 Google ListModels 로 가져옴 (generateContent 지원)
 * @returns {Promise<string[] | null>} 실패 시 null → 호출부에서 고정 폴백 사용
 */
async function fetchGeminiGenerateContentModelIds(apiKey) {
  const now = Date.now();
  if (__geminiListCache.key === apiKey && __geminiListCache.ids && now - __geminiListCache.at < GEMINI_LIST_TTL_MS) {
    return __geminiListCache.ids;
  }

  const collected = [];
  let pageToken = "";
  try {
    for (let p = 0; p < 10; p++) {
      const q = new URLSearchParams({ key: apiKey, pageSize: "100" });
      if (pageToken) q.set("pageToken", pageToken);
      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?${q}`;
      const lr = await fetch(listUrl);
      if (!lr.ok) {
        __geminiListCache = { key: apiKey, ids: null, at: now };
        return null;
      }
      const data = await lr.json();
      for (const m of data.models || []) {
        const methods = m.supportedGenerationMethods || m.supported_generation_methods || [];
        if (!methods.includes("generateContent")) continue;
        const rawName = m.name || "";
        const id = rawName.replace(/^models\//, "").trim();
        if (id && !collected.includes(id)) collected.push(id);
      }
      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
    }
  } catch {
    __geminiListCache = { key: apiKey, ids: null, at: now };
    return null;
  }

  collected.sort((a, b) => rankGeminiModelId(a) - rankGeminiModelId(b) || a.localeCompare(b));
  __geminiListCache = { key: apiKey, ids: collected, at: now };
  if (collected.length) {
    const preview = collected.slice(0, 6).join(", ");
    const more = collected.length > 6 ? ` …총 ${collected.length}개` : "";
    console.log(`[vite] Gemini: 이 키로 사용 가능한 generateContent 모델 → ${preview}${more}`);
  }
  return collected;
}

function buildModelTryOrder(preferredModel, listedIds) {
  const pref = String(preferredModel || "").replace(/^models\//, "").trim();
  const out = [];
  const add = (id) => {
    if (!id) return;
    if (!out.includes(id)) out.push(id);
  };
  if (pref) add(pref);
  if (listedIds != null && listedIds.length > 0) {
    for (const id of listedIds) add(id);
  }
  const listEmpty = listedIds == null || listedIds.length === 0;
  if (listEmpty || out.length === 0) {
    for (const id of ["gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-1.5-flash-002", "gemini-1.5-flash-001", "gemini-1.5-flash-8b"]) {
      add(id);
    }
  }
  return out;
}

/**
 * v1 은 모델별로 404·스키마 차이가 많아 v1beta 만 사용 (ListModels 도 v1beta)
 * @returns {Promise<{ ok: true, text: string, model: string, apiVer: string } | { ok: false, status: number, text: string, model?: string, apiVer?: string }>}
 */
async function callGeminiGenerateContent(key, preferredModel, geminiBody) {
  const listed = await fetchGeminiGenerateContentModelIds(key);
  const models = buildModelTryOrder(preferredModel, listed);
  const apiVer = "v1beta";
  /** @type {{ status: number, text: string, model?: string, apiVer?: string } | null} */
  let lastFail = null;

  for (const m of models) {
    const url = `https://generativelanguage.googleapis.com/${apiVer}/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(geminiBody),
    });
    const text = await r.text();
    if (r.ok) {
      console.log(`[vite] Gemini generateContent 성공: ${m} (${apiVer})`);
      return { ok: true, text, model: m, apiVer };
    }
    lastFail = { status: r.status, text, model: m, apiVer };
    if (r.status === 401 || r.status === 403) {
      return { ok: false, ...lastFail };
    }
  }
  return { ok: false, ...(lastFail || { status: 502, text: "{}" }) };
}

/**
 * Google AI Studio / Gemini API 키 (.env 의 GEMINI_API_KEY 등)
 * POST /api/gemini/generate → generativelanguage.googleapis.com
 */
function geminiProxyPlugin() {
  let apiKey = "";

  return {
    name: "gemini-api-proxy",
    configResolved(config) {
      const dir = config.envDir || process.cwd();
      const mode = config.mode;
      const gemini = loadEnv(mode, dir, "GEMINI_");
      const google = loadEnv(mode, dir, "GOOGLE_");
      const vite = loadEnv(mode, dir, "VITE_");
      const rawKey =
        gemini.GEMINI_API_KEY ||
        google.GOOGLE_API_KEY ||
        google.GEMINI_API_KEY ||
        vite.VITE_GEMINI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.VITE_GEMINI_API_KEY ||
        "";
      apiKey = sanitizeApiKey(rawKey);

      if (!apiKey && (mode === "development" || process.env.CI)) {
        console.warn(
          "[vite] GEMINI_API_KEY가 없습니다. .env에 GEMINI_API_KEY=... (Google AI Studio 키) 를 넣고 dev 서버를 재시작하세요."
        );
      }
    },
    configureServer(server) {
      attachGeminiMiddleware(server.middlewares, () => apiKey);
    },
    configurePreviewServer(server) {
      attachGeminiMiddleware(server.middlewares, () => apiKey);
    },
  };
}

/** @param {import('connect').Server} middlewares */
function attachGeminiMiddleware(middlewares, getApiKey) {
  middlewares.use((req, res, next) => {
    const path = (req.url || "").split("?")[0];
    if (path !== "/api/gemini/generate") return next();
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }

    const key = sanitizeApiKey(getApiKey());
    if (!key) {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: {
            message:
              "GEMINI_API_KEY가 없습니다. .env에 GEMINI_API_KEY를 넣고 npm run dev / vite preview를 다시 실행하세요.",
          },
        })
      );
      return;
    }

    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        let incoming;
        try {
          incoming = JSON.parse(raw);
        } catch {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: { message: "Invalid JSON body" } }));
          return;
        }

        const model = String(incoming.model || "gemini-2.0-flash").replace(/^models\//, "");
        const systemInstruction = String(incoming.systemInstruction || "");
        const userText = String(incoming.userText || "");
        if (!userText.trim()) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: { message: "userText required" } }));
          return;
        }

        // v1 등 일부 엔드포인트는 루트의 systemInstruction 필드를 거부함 → 사용자 메시지에 합쳐 전송
        const sys = systemInstruction.trim();
        const mergedText = sys ? `${sys}\n\n---\n\n${userText}` : userText;
        const geminiBody = {
          contents: [{ role: "user", parts: [{ text: mergedText }] }],
          generationConfig: {
            temperature: 0.35,
            maxOutputTokens: 8192,
          },
        };

        const gr = await callGeminiGenerateContent(key, model, geminiBody);
        if (!gr.ok) {
          res.statusCode = gr.status;
          res.setHeader("content-type", "application/json");
          res.end(gr.text);
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(gr.text);
        } catch {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: { message: gr.text.slice(0, 500) } }));
          return;
        }

        const cand0 = parsed.candidates?.[0];
        const parts = cand0?.content?.parts || [];
        const outputText = parts.map((p) => p.text || "").join("");
        const finish = cand0?.finishReason;
        if (!outputText.trim()) {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: {
                message: `Gemini 응답 본문이 없습니다${finish ? ` (finishReason: ${finish})` : ""}. VITE_GEMINI_MODEL을 바꾸거나 잠시 후 다시 시도하세요.`,
              },
            })
          );
          return;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ outputText }));
      } catch (e) {
        res.statusCode = 502;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: String(e?.message || e) } }));
      }
    });
  });
}

export default defineConfig({
  plugins: [react(), geminiProxyPlugin()],
});
