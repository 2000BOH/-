import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import AdditionalReport, { RICH_PROSE_CSS } from "./AdditionalReport.jsx";

const STORAGE_KEY = "jangbak-v8";
/** 추가 보고 탭에서 PT 진입 시 보고서 탭으로 전환 후 이 슬라이드부터 열기 */
const PT_SESSION_OPEN_ADDITIONAL = "jangbak-pt-open-additional-slide";

const FIELDS = [
  { k: "inspire", l: "인스파이어" }, { k: "sharp", l: "샤프" }, { k: "etcCorp", l: "기타법인" },
  { k: "personal", l: "개인" }, { k: "hotel", l: "호텔" }, { k: "dormAsset", l: "기숙사(자산)" },
  { k: "dormGroup", l: "기숙사(계열)" }, { k: "empty", l: "공실" }, { k: "moveIn", l: "입실예정" },
  { k: "repair", l: "일반보수" }, { k: "badRepair", l: "악성보수" }
];
const FKEYS = FIELDS.map(f => f.k);
/** 객실현황·보고서 표에서만 사용 (기숙사(계열) 열 비표시, 데이터 키 dormGroup은 합계·저장에 유지) */
const ROOM_TABLE_FIELDS = FIELDS.filter(f => f.k !== "dormGroup");
const RTH = (base = {}) => ({ padding: "10px 6px", textAlign: "center", fontWeight: 700, fontSize: 13, border: "1px solid #cbd5e1", verticalAlign: "middle", background: "#fffbeb", ...base });
const RTS = (base = {}) => ({ padding: "8px 4px", textAlign: "center", fontWeight: 700, fontSize: 12, border: "1px solid #cbd5e1", verticalAlign: "middle", ...base });
const RTD = (base = {}) => ({ padding: "10px 8px", fontSize: 14, border: "1px solid #e5e7eb", fontVariantNumeric: "tabular-nums", lineHeight: 1.35, ...base });

/** 객실현황 상세 붙여넣기: 분류 문자열 → 저장 키 (긴 별칭 우선 매칭) */
const ROOM_CATEGORY_ALIASES = [
  ["인스파이어", "inspire"], ["기타법인", "etcCorp"], ["입실예정", "moveIn"], ["기숙사(자산)", "dormAsset"],
  ["보수중", "repair"], ["일반보수", "repair"], ["악성보수", "badRepair"], ["기숙사(계열)", "dormGroup"],
  ["인스", "inspire"], ["샤프", "sharp"], ["기타", "etcCorp"], ["개인", "personal"], ["장박", "personal"],
  ["호텔", "hotel"], ["기숙사", "dormAsset"], ["공실", "empty"], ["입실", "moveIn"], ["보수", "repair"],
  ["악성", "badRepair"], ["계열", "dormGroup"]
];
function roomCategoryLabelToKey(raw) {
  const n = String(raw || "").replace(/\s/g, "");
  if (!n) return null;
  const sorted = [...ROOM_CATEGORY_ALIASES].sort((a, b) => b[0].length - a[0].length);
  for (const [alias, key] of sorted) {
    if (n === alias || n.startsWith(alias)) return key;
  }
  return null;
}
function parseChaToken(tok) {
  const t = String(tok || "").trim();
  if (/^[1-4]차$/.test(t)) return t;
  if (/^[1-4]$/.test(t)) return t + "차";
  return null;
}
function emptyRoomCounts() {
  const r = {};
  FKEYS.forEach(k => { r[k] = 0; });
  return r;
}

const ROOM_CHA_ORDER = ["1차", "2차", "3차", "4차"];
function isStayTypeForbidden(stayType) {
  const n = String(stayType || "").replace(/\s/g, "");
  return n === "사용금지" || n === "사용불가";
}
/** 숙박형태·임차인 → 집계 키 (장박_법인: 임차인에 '샤프' → sharp, 나머지 → etcCorp / 장박_개인 → personal / 그 외 기존 분류 별칭) */
function stayTypeToRoomFieldKey(stayType, tenant) {
  const raw = String(stayType || "").trim();
  const n = raw.replace(/\s/g, "");
  const ten = String(tenant || "");
  if (n === "장박_법인" || raw.includes("장박_법인")) return ten.includes("샤프") ? "sharp" : "etcCorp";
  if (n === "장박_개인" || raw.includes("장박_개인")) return "personal";
  return roomCategoryLabelToKey(n) || roomCategoryLabelToKey(raw.replace(/\s/g, ""));
}
function countRoomListByChaExcludingForbidden(roomList) {
  if (!Array.isArray(roomList) || roomList.length === 0) return null;
  const m = { "1차": 0, "2차": 0, "3차": 0, "4차": 0 };
  roomList.forEach(row => {
    const cha = parseChaToken(row.cha);
    if (!cha || !m.hasOwnProperty(cha)) return;
    if (isStayTypeForbidden(row.stayType)) return;
    m[cha] += 1;
  });
  return m;
}
function countRoomListGrandTotal(roomList) {
  if (!Array.isArray(roomList) || roomList.length === 0) return null;
  let n = 0;
  roomList.forEach(row => {
    if (!parseChaToken(row.cha)) return;
    if (isStayTypeForbidden(row.stayType)) return;
    n += 1;
  });
  return n;
}
function countDaewonListTotal(roomList) {
  if (!Array.isArray(roomList) || roomList.length === 0) return null;
  let n = 0;
  roomList.forEach(row => {
    if (String(row.contractor || "").trim() !== "대원") return;
    if (isStayTypeForbidden(row.stayType)) return;
    n += 1;
  });
  return n;
}
/** 사용금지·사용불가 행 제외, 위탁 객실목록 보증금·월 임대료(원) 합계 */
function sumRoomListDepositRent(roomList) {
  if (!Array.isArray(roomList)) return { deposit: 0, rent: 0 };
  let deposit = 0;
  let rent = 0;
  roomList.forEach(row => {
    if (isStayTypeForbidden(row.stayType)) return;
    deposit += Math.round(Number(row.deposit) || 0);
    rent += Math.round(Number(row.rent) || 0);
  });
  return { deposit, rent };
}
/** roomList → 차수별 rooms, 대원소유분 daewon (사용금지 행 제외 집계, 분류만 셀 증가) */
function aggregateRoomsFromRoomList(roomList) {
  const rooms = {};
  ROOM_CHA_ORDER.forEach(cha => { rooms[cha] = emptyRoomCounts(); });
  const daewon = emptyRoomCounts();
  let forbidden = 0;
  let badCha = 0;
  if (!Array.isArray(roomList)) return { rooms, daewon, forbidden, badCha };
  roomList.forEach(row => {
    const cha = parseChaToken(row.cha);
    if (!cha || !rooms[cha]) {
      badCha += 1;
      return;
    }
    if (isStayTypeForbidden(row.stayType)) {
      forbidden += 1;
      return;
    }
    let fk = stayTypeToRoomFieldKey(row.stayType, row.tenant);
    if (!fk) {
      console.warn("분류미매칭 → 기타(etcCorp) 집계:", row);
      fk = "etcCorp";
    }
    rooms[cha][fk] = (rooms[cha][fk] || 0) + 1;
    if (String(row.contractor || "").trim() === "대원") daewon[fk] = (daewon[fk] || 0) + 1;
  });
  return { rooms, daewon, forbidden, badCha };
}

/** 붙여넣기 셀: 선행·후행 공백, NBSP, 제로폭 문자 정리 */
function trimPasteCell(val) {
  return String(val ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .trim();
}

/** 객실목록 엑셀 금액 셀: 콤마·공백·원 제거 후 원 단위 정수 */
function parseRoomListMoneyCell(val) {
  const s = String(val ?? "").trim().replace(/,/g, "").replace(/\s/g, "").replace(/원/g, "");
  if (!s) return 0;
  const n = Number(String(s).replace(/^\+/, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function isLikelyMoneyColumn(val) {
  const s = String(val ?? "").trim();
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  const cleaned = s.replace(/,/g, "").replace(/\s/g, "").replace(/원/g, "").replace(/^\+/, "");
  return /^-?\d+(\.\d+)?$/.test(cleaned);
}

/**
 * RFC 4180 스타일 CSV 한 줄: 콤마 구분, 큰따옴표로 감싼 필드, 필드 내 " 는 "" 이스케이프.
 * 콤마만 있고 따옴표 없는 내보내기는 구조 정보가 없어 복구 불가 → 탭 구분 붙여넣기 권장.
 */
function splitCsvLineRFC4180(line) {
  const s = String(line ?? "");
  const out = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < s.length && s[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      out.push(trimPasteCell(cur));
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  out.push(trimPasteCell(cur));
  return out;
}

/** 붙여넣기 전체 → 줄 배열 (CRLF / LF / CR-only). 행 전체 trim 안 함 — 선행 탭(빈 1열)·셀 내 공백 유지 후 셀 단위 trim */
function splitPasteLines(text) {
  return String(text ?? "")
    .replace(/\u2028/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter(l => /\S/.test(l));
}

/** 객실 목록(엑셀): 반드시 탭만 컬럼 구분. 콤마는 셀 내용. `a\t\tb` → 연속 탭은 빈 셀("") */
function splitTabSeparatedRow(line) {
  const s = String(line ?? "").replace(/\r/g, "");
  if (!/\S/.test(s)) return null;
  if (!s.includes("\t")) return null;
  return s.split("\t").map(trimPasteCell);
}

/** 기타 붙여넣기(계약 6열 등): 탭 우선, 탭 없을 때만 CSV */
function splitPasteDelimitedRow(line) {
  const s = String(line ?? "").replace(/\r/g, "");
  if (!/\S/.test(s)) return null;
  if (s.includes("\t")) return s.split("\t").map(trimPasteCell);
  if (s.includes(",")) return splitCsvLineRFC4180(s);
  return null;
}

function parseRoomListLine(line) {
  const partsRaw = splitTabSeparatedRow(line);
  if (!partsRaw) return null;
  const colCountRaw = partsRaw.length;
  if (colCountRaw < 6) return null;
  const cha = parseChaToken(partsRaw[0]);
  if (!cha) return null;
  const p3 = trimPasteCell(partsRaw[3]);
  const padNine = () => {
    const x = partsRaw.length > 9 ? partsRaw.slice(0, 9) : partsRaw.slice();
    while (x.length < 9) x.push("");
    return x;
  };
  /** 표준(날짜형): 11열 차·호·계약자·운영시작·운영종료·운영방식·숙박형태·임차인·보증금·임대료·임대종료. 9·8열 예전 형식 호환 */
  const legacyDates = /^\d{4}-\d{2}-\d{2}/.test(p3);
  if (legacyDates) {
    const use11 = colCountRaw >= 11 || (colCountRaw === 10 && isLikelyMoneyColumn(partsRaw[8]) && (isLikelyMoneyColumn(partsRaw[9]) || !String(partsRaw[9] ?? "").trim()));
    if (use11) {
      let p11 = partsRaw.length > 11 ? partsRaw.slice(0, 11) : partsRaw.slice();
      while (p11.length < 11) p11.push("");
      if (partsRaw.length > 11) {
        try { console.warn(`[객실 붙여넣기] 열 ${partsRaw.length}개 → 11개로 자름`, String(line).slice(0, 120)); } catch (_) {}
      }
      return {
        cha,
        roomNo: trimPasteCell(p11[1]),
        contractor: trimPasteCell(p11[2]),
        opStart: p3,
        opEnd: trimPasteCell(p11[4]),
        opMode: String(p11[5] || "").trim(),
        stayType: String(p11[6] || "").trim(),
        tenant: String(p11[7] || "").trim(),
        deposit: parseRoomListMoneyCell(p11[8]),
        rent: parseRoomListMoneyCell(p11[9]),
        leaseEnd: String(p11[10] || "").trim()
      };
    }
    const parts = padNine();
    if (colCountRaw > 9) {
      try { console.warn(`[객실 붙여넣기] 열 ${colCountRaw}개 → 9개로 자름(구 형식)`, String(line).slice(0, 120)); } catch (_) {}
    }
    const old8 = !!stayTypeToRoomFieldKey(parts[5], parts[6]);
    let opMode;
    let stayType;
    let tenant;
    let leaseEnd;
    if (old8) {
      opMode = "";
      stayType = String(parts[5] || "").trim();
      tenant = String(parts[6] || "").trim();
      leaseEnd = String(parts[7] || "").trim();
    } else {
      opMode = String(parts[5] || "").trim();
      stayType = String(parts[6] || "").trim();
      tenant = String(parts[7] || "").trim();
      leaseEnd = String(parts[8] || "").trim();
    }
    return {
      cha,
      roomNo: trimPasteCell(parts[1]),
      contractor: trimPasteCell(parts[2]),
      opStart: p3,
      opEnd: trimPasteCell(parts[4]),
      opMode,
      stayType,
      tenant,
      leaseEnd,
      deposit: 0,
      rent: 0
    };
  }
  const parts = padNine();
  /** 동호 안내형(날짜 없음): 예전 7열(3=숙박) / 신규 9열(3=운영방식 4=숙박 …) */
  const docKeyP3 = stayTypeToRoomFieldKey(p3, parts[4]);
  if (docKeyP3) {
    const dong = String(parts[1] || "").trim();
    const ho = String(parts[2] || "").trim();
    const roomNo = [dong, ho].filter(Boolean).join("-") || dong || ho || "";
    return {
      cha,
      roomNo,
      contractor: String(parts[5] || "").trim(),
      opStart: "",
      opEnd: "",
      opMode: "",
      stayType: String(p3 || "").trim(),
      tenant: String(parts[4] || "").trim(),
      note: String(parts[6] || "").trim(),
      leaseEnd: String(parts[7] || "").trim(),
      deposit: 0,
      rent: 0
    };
  }
  const docKeyP4 = stayTypeToRoomFieldKey(parts[4], parts[5]);
  if (docKeyP4) {
    const dong = String(parts[1] || "").trim();
    const ho = String(parts[2] || "").trim();
    const roomNo = [dong, ho].filter(Boolean).join("-") || dong || ho || "";
    return {
      cha,
      roomNo,
      contractor: String(parts[6] || "").trim(),
      opStart: "",
      opEnd: "",
      opMode: String(p3 || "").trim(),
      stayType: String(parts[4] || "").trim(),
      tenant: String(parts[5] || "").trim(),
      note: String(parts[7] || "").trim(),
      leaseEnd: String(parts[8] || "").trim(),
      deposit: 0,
      rent: 0
    };
  }
  if (stayTypeToRoomFieldKey(parts[5], parts[6])) {
    return {
      cha,
      roomNo: trimPasteCell(parts[1]),
      contractor: trimPasteCell(parts[2]),
      opStart: p3,
      opEnd: trimPasteCell(parts[4]),
      opMode: "",
      stayType: String(parts[5] || "").trim(),
      tenant: String(parts[6] || "").trim(),
      leaseEnd: String(parts[7] || "").trim(),
      deposit: 0,
      rent: 0
    };
  }
  if (stayTypeToRoomFieldKey(parts[6], parts[7])) {
    return {
      cha,
      roomNo: trimPasteCell(parts[1]),
      contractor: trimPasteCell(parts[2]),
      opStart: p3,
      opEnd: trimPasteCell(parts[4]),
      opMode: String(parts[5] || "").trim(),
      stayType: String(parts[6] || "").trim(),
      tenant: String(parts[7] || "").trim(),
      leaseEnd: String(parts[8] || "").trim(),
      deposit: 0,
      rent: 0
    };
  }
  const dong = String(parts[1] || "").trim();
  const ho = String(parts[2] || "").trim();
  return {
    cha,
    roomNo: [dong, ho].filter(Boolean).join("-") || dong || ho || "",
    contractor: String(parts[6] || "").trim(),
    opStart: "",
    opEnd: "",
    opMode: String(p3 || "").trim(),
    stayType: String(parts[4] || "").trim(),
    tenant: String(parts[5] || "").trim(),
    note: String(parts[7] || "").trim(),
    leaseEnd: String(parts[8] || "").trim(),
    deposit: 0,
    rent: 0
  };
}

const ROOM_EDIT_CHAS = ["1차", "2차", "3차", "4차"];
/** 객실현황 합계 행 수정: 열별 목표 합계를 1~4차에 정수 분배 (표에 없는 키·dormGroup은 차수별 기존값 유지) */
function distributeColumnTotalsToRooms(rooms, targetsByKey) {
  const next = {};
  ROOM_EDIT_CHAS.forEach(cha => {
    next[cha] = { ...emptyRoomCounts(), ...(rooms[cha] || {}) };
  });
  ROOM_TABLE_FIELDS.forEach(({ k }) => {
    const target = Math.max(0, parseInt(targetsByKey[k], 10) || 0);
    let current = ROOM_EDIT_CHAS.reduce((s, c) => s + (next[c][k] || 0), 0);
    let diff = target - current;
    let iter = 0;
    while (diff !== 0 && iter < 80000) {
      if (diff > 0) {
        const cha = ROOM_EDIT_CHAS[iter % 4];
        next[cha][k] = (next[cha][k] || 0) + 1;
        diff--;
      } else {
        let dec = false;
        for (let j = 0; j < 4; j++) {
          const cha = ROOM_EDIT_CHAS[(iter + j) % 4];
          if ((next[cha][k] || 0) > 0) {
            next[cha][k]--;
            diff++;
            dec = true;
            break;
          }
        }
        if (!dec) break;
      }
      iter++;
    }
  });
  return next;
}

function sumRoom(r) { let s = 0; FKEYS.forEach(k => { s += (r[k] || 0); }); return s; }
function longStay(r) { return (r.inspire || 0) + (r.sharp || 0) + (r.etcCorp || 0) + (r.personal || 0); }
function fK(n) { if (!n) return "0"; if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + "억"; if (Math.abs(n) >= 1e7) return Math.round(n / 1e4).toLocaleString() + "만"; return n.toLocaleString(); }
function fN(n) { return (n || 0).toLocaleString(); }
function getWeekStr(ds) { if (!ds) return ""; const d = new Date(ds), j = new Date(d.getFullYear(), 0, 1), days = Math.floor((d - j) / 864e5), w = Math.ceil((days + j.getDay() + 1) / 7); return d.getFullYear() + "-W" + String(w).padStart(2, "0"); }
/** 기준일 주차의 추가 보고 입력란 중 본문이 있는 항목 */
function additionalReportBlocksForData(data) {
  const wk = getWeekStr(data?.reportDate);
  if (!wk) return [];
  const prompts = data?.additionalReports?.[wk]?.prompts || [];
  return prompts.filter((p) => {
    const html = String(p.html ?? "");
    if (/<img[\s>]/i.test(html)) return true;
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&nbsp;/g, " ").trim().length > 0;
  });
}
function getWeekRange(w) { if (!w) return ""; const [y, wn] = w.split("-W"); const j = new Date(parseInt(y), 0, 1), s = new Date(j); s.setDate(j.getDate() + (parseInt(wn) - 1) * 7 - j.getDay() + 1); const e = new Date(s); e.setDate(s.getDate() + 6); return (s.getMonth() + 1) + "/" + s.getDate() + "~" + (e.getMonth() + 1) + "/" + e.getDate(); }
function weekStrSortKey(w) { if (!w) return 0; const [y, wn] = w.split("-W"); return (parseInt(y, 10) || 0) * 100 + (parseInt(wn, 10) || 0); }
/** 예: 2026-W10 → "3월 둘째주 (3/2~3/8)" — 해당 주 목요일 기준 월·월내 주차 */
function formatKoMonthWeekLabel(w) {
  if (!w) return "";
  const range = getWeekRange(w);
  const [ys, ws] = w.split("-W");
  const y = parseInt(ys, 10);
  const wn = parseInt(ws, 10);
  const jan1 = new Date(y, 0, 1);
  const s = new Date(jan1);
  s.setDate(jan1.getDate() + (wn - 1) * 7 - jan1.getDay() + 1);
  const thu = new Date(s);
  thu.setDate(s.getDate() + 3);
  const mo = thu.getMonth() + 1;
  const ordN = Math.floor((thu.getDate() - 1) / 7) + 1;
  const ordK = ["첫", "둘", "셋", "넷", "다섯"][ordN - 1] || String(ordN);
  return `${mo}월 ${ordK}째주 (${range})`;
}
function diffVal(a, b) { const d = a - b; if (d > 0) return { t: "▲" + fN(d), c: "#c00" }; if (d < 0) return { t: "▼" + fN(Math.abs(d)), c: "#00c" }; return { t: "-", c: "#888" }; }
const PT_TIP_BOX = {
  padding: "6px 8px",
  borderRadius: 6,
  background: "linear-gradient(180deg, rgba(235, 245, 255, 0.97) 0%, rgba(241, 245, 249, 0.98) 100%)",
  border: "1px solid rgba(59, 130, 246, 0.38)",
  boxShadow: "0 6px 18px rgba(15, 23, 42, 0.14)",
  minWidth: 116,
  color: "#0f172a",
  textAlign: "left",
};

/** PT 커스텀 툴팁: 전주 대비 (증감색 = 전주대비 행과 동일) */
function PtTipWeekBubble({ cur, prevVal }) {
  const d = diffVal(cur, prevVal);
  return (
    <div style={{ ...PT_TIP_BOX, fontSize: 12, lineHeight: 1.38 }}>
      <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.78, color: "#475569" }}>전주 <span style={{ color: "#1e293b" }}>{fN(prevVal)}</span></div>
      <div style={{ fontSize: 13, fontWeight: 800, marginTop: 3 }}>현재 {fN(cur)}</div>
      <div style={{ fontSize: 12, fontWeight: 800, marginTop: 4, color: d.c }}>대비 {d.t}</div>
    </div>
  );
}

/** PT: 전월 대비 (월별 수익 표) */
function PtTipMonthBubble({ cur, prevVal, kind, hasPrev }) {
  const a = Number(cur) || 0;
  const b = Number(prevVal) || 0;
  const d = diffVal(a, b);
  const fmt = (v) => (kind === "rooms" ? String(v || 0) : (v ? fN(v) : "-"));
  return (
    <div style={{ ...PT_TIP_BOX, fontSize: 12, lineHeight: 1.38 }}>
      {hasPrev ? (
        <>
          <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.78, color: "#475569" }}>전월 <span style={{ color: "#1e293b" }}>{fmt(b)}</span></div>
          <div style={{ fontSize: 13, fontWeight: 800, marginTop: 3 }}>현재 {fmt(a)}</div>
          <div style={{ fontSize: 12, fontWeight: 800, marginTop: 4, color: d.c }}>대비 {d.t}</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 800 }}>현재 {fmt(a)}</div>
          <div style={{ fontSize: 10, marginTop: 3, opacity: 0.7, color: "#64748b" }}>전월 열 없음 (맨 왼쪽 월)</div>
        </>
      )}
    </div>
  );
}

/** 형광펜: 한 획 단위로 부드러운 곡선 + 옅은 색 (세그먼트마다 stroke 시 뭉침 방지) */
function strokeHighlighterSmoothPath(ctx, points, opts = {}) {
  const lineWidth = opts.lineWidth ?? 40;
  const color = opts.color ?? "rgba(59, 130, 246, 0.18)";
  const dotFill = opts.dotFill ?? "rgba(59, 130, 246, 0.21)";
  if (!points || points.length === 0) return;
  if (points.length === 1) {
    const q = points[0];
    ctx.save();
    ctx.beginPath();
    ctx.arc(q.x, q.y, lineWidth * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = dotFill;
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.miterLimit = 2;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  let i = 1;
  for (; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
  }
  ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.restore();
}

function addCalendarMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
/** 주(W)의 월~일 구간 [시작, 끝] */
function weekStrToDateRange(w) {
  if (!w) return [null, null];
  const [ys, ws] = w.split("-W");
  const yi = parseInt(ys, 10);
  const wi = parseInt(ws, 10);
  const jan1 = new Date(yi, 0, 1);
  const s = new Date(jan1);
  s.setDate(jan1.getDate() + (wi - 1) * 7 - jan1.getDay() + 1);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return [s, e];
}
function weekOverlapsMonthWindow(w, windowStart, windowEnd) {
  const [s, e] = weekStrToDateRange(w);
  if (!s || !e) return false;
  return s <= windowEnd && e >= windowStart;
}

const initData = {
  rooms: { "1차": { inspire: 241, sharp: 5, etcCorp: 3, personal: 9, hotel: 26, dormAsset: 0, dormGroup: 0, empty: 2, moveIn: 1, repair: 5, badRepair: 1 }, "2차": { inspire: 229, sharp: 0, etcCorp: 4, personal: 18, hotel: 0, dormAsset: 0, dormGroup: 0, empty: 1, moveIn: 1, repair: 2, badRepair: 1 }, "3차": { inspire: 337, sharp: 12, etcCorp: 8, personal: 14, hotel: 131, dormAsset: 0, dormGroup: 0, empty: 2, moveIn: 1, repair: 4, badRepair: 2 }, "4차": { inspire: 379, sharp: 6, etcCorp: 19, personal: 18, hotel: 33, dormAsset: 18, dormGroup: 3, empty: 0, moveIn: 4, repair: 4, badRepair: 2 } },
  prevRooms: { "1차": { inspire: 244, sharp: 5, etcCorp: 3, personal: 9, hotel: 26, dormAsset: 0, dormGroup: 0, empty: 2, moveIn: 2, repair: 6, badRepair: 1 }, "2차": { inspire: 229, sharp: 0, etcCorp: 4, personal: 18, hotel: 0, dormAsset: 0, dormGroup: 0, empty: 3, moveIn: 0, repair: 3, badRepair: 1 }, "3차": { inspire: 327, sharp: 12, etcCorp: 8, personal: 14, hotel: 131, dormAsset: 0, dormGroup: 0, empty: 2, moveIn: 1, repair: 5, badRepair: 2 }, "4차": { inspire: 378, sharp: 6, etcCorp: 19, personal: 18, hotel: 33, dormAsset: 18, dormGroup: 6, empty: 1, moveIn: 6, repair: 5, badRepair: 2 } },
  daewon: { inspire: 386, sharp: 10, etcCorp: 13, personal: 30, hotel: 64, dormAsset: 18, dormGroup: 2, empty: 1, moveIn: 1, repair: 4, badRepair: 0 },
  contracts: [
    { id: 1, month: "2월", company: "인스파이어 (기존)", deposit: 582000000, rent: 601435000, rooms: 1163, moveDate: "2026-02-01", status: "확정", visible: true, type: "기존", week: "2026-W05" },
    { id: 2, month: "2월", company: "신규 입주 22건", deposit: 15000000, rent: 10800000, rooms: 22, moveDate: "2026-02-15", status: "확정", visible: true, type: "입주", week: "2026-W07" },
    { id: 3, month: "2월", company: "퇴실 3건", deposit: 3000000, rent: 1500000, rooms: 3, moveDate: "2026-02-28", status: "확정", visible: true, type: "퇴실", week: "2026-W09" },
    { id: 4, month: "3월", company: "인스파이어 (기존)", deposit: 587000000, rent: 625855000, rooms: 1194, moveDate: "2026-03-01", status: "확정", visible: true, type: "기존", week: "2026-W10" },
    { id: 5, month: "3월", company: "신규 입주 46건", deposit: 28000000, rent: 24420000, rooms: 46, moveDate: "2026-03-15", status: "확정", visible: true, type: "입주", week: "2026-W11" },
    { id: 6, month: "3월", company: "인스파이어 7객실", deposit: 5000000, rent: 3500000, rooms: 7, moveDate: "2026-03-29", status: "확정", visible: true, type: "입주", week: "2026-W13" },
    { id: 7, month: "3월", company: "개인장박 3객실", deposit: 2000000, rent: 1200000, rooms: 3, moveDate: "2026-03-27", status: "확정", visible: true, type: "입주", week: "2026-W13" },
    { id: 8, month: "4월", company: "울트라 라운지", deposit: 5000000, rent: 2200000, rooms: 2, moveDate: "2026-04-05", status: "확정", visible: true, type: "입주", week: "2026-W15" },
    { id: 9, month: "4월", company: "샤프테크닉스", deposit: 17000000, rent: 8100000, rooms: 6, moveDate: "2026-04-10", status: "확정", visible: true, type: "입주", week: "2026-W15" },
    { id: 10, month: "4월", company: "대성베리힐CC", deposit: 8000000, rent: 4070000, rooms: 4, moveDate: "2026-04-15", status: "예정", visible: true, type: "입주", week: "2026-W16" },
  ],
  inspire: [ { id: 1, type: "입실", rooms: 7, date: "2026-03-29", note: "3월 말", status: "확정" }, { id: 2, type: "입실예정", rooms: 15, date: "2026-04-10", note: "4월 중", status: "예정" }, { id: 3, type: "퇴실", rooms: 0, date: "", note: "해당 없음", status: "확정" } ],
  notes: "악성보수객실 임대료 30만원 안내 실시", reportDate: "2026-03-24",
  reportSnapshots: {},
  roomList: null,
  additionalReports: {}
};

const Badge = ({ children, color = "blue" }) => {
  const cs = { blue: "#2563eb", green: "#16a34a", red: "#dc2626", amber: "#d97706", gray: "#6b7280" };
  const bgs = { blue: "#eff6ff", green: "#f0fdf4", red: "#fef2f2", amber: "#fffbeb", gray: "#f9fafb" };
  return <span style={{ background: bgs[color], color: cs[color], padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>;
};
const Card = ({ children, style, onClick }) => <div onClick={onClick} style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: 20, ...style }}>{children}</div>;

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(null);
  const [snapshotWeekKey, setSnapshotWeekKey] = useState(null);
  useEffect(() => { (async () => { try { const r = await window.storage.get(STORAGE_KEY); if (r && r.value) {
    setData({ ...initData, ...JSON.parse(r.value) });
  } else throw 0; } catch (e) { try { await window.storage.set(STORAGE_KEY, JSON.stringify(initData)); } catch (e2) {} setData(initData); } })(); }, []);
  const save = useCallback(async d => {
    setData(d);
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(d)); } catch (e) {}
  }, []);
  /** 추가 보고 등: 루트 data만 얕게 갱신 (저장본 스냅샷을 통째로 다시 쓰지 않음) */
  const savePartial = useCallback((patch) => {
    setData((prev) => {
      const next = { ...prev, ...patch };
      try { void window.storage.set(STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }, []);
  const saveWeeklyReportSnapshot = useCallback(() => {
    const wk = getWeekStr(data.reportDate);
    if (!wk) {
      window.alert("보고서 기준일(reportDate)을 YYYY-MM-DD 형식으로 설정한 뒤 저장하세요.");
      return;
    }
    const snapRoomList = data.roomList == null ? null : JSON.parse(JSON.stringify(data.roomList));
    const snapshot = {
      rooms: JSON.parse(JSON.stringify(data.rooms)),
      prevRooms: JSON.parse(JSON.stringify(data.prevRooms)),
      daewon: { ...data.daewon },
      contracts: JSON.parse(JSON.stringify(data.contracts)),
      inspire: JSON.parse(JSON.stringify(data.inspire || [])),
      notes: data.notes,
      reportDate: data.reportDate,
      roomList: snapRoomList,
      additionalReports: JSON.parse(JSON.stringify(data.additionalReports || {}))
    };
    const reportSnapshots = { ...(data.reportSnapshots || {}), [wk]: { savedAt: new Date().toISOString(), snapshot } };
    save({ ...data, reportSnapshots });
    window.alert(`${formatKoMonthWeekLabel(wk)} 주차 대표로 저장했습니다. (대시보드·객실·계약·보고서에 동일하게 반영되는 스냅샷)`);
  }, [data, save]);
  const effectiveData = useMemo(() => {
    if (!data) return null;
    if (!snapshotWeekKey) return data;
    const e = data.reportSnapshots?.[snapshotWeekKey];
    if (!e?.snapshot) return data;
    return {
      ...data,
      ...e.snapshot,
      reportSnapshots: data.reportSnapshots,
      /* 추가 보고: 선택한 저장 주차 스냅샷에 들어 있던 내용만 표시 (현재 편집본과 섞지 않음) */
      additionalReports: { ...(e.snapshot.additionalReports || {}) },
    };
  }, [data, snapshotWeekKey]);
  if (!data || !effectiveData) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>로딩 중...</div>;

  const tabs = [{ key: "dashboard", label: "대시보드", icon: "📊" }, { key: "rooms", label: "객실현황", icon: "🏨" }, { key: "contracts", label: "계약관리", icon: "📝" }, { key: "report", label: "보고서", icon: "📄" }, { key: "additional", label: "추가 보고", icon: "📑" }];
  const snapReading = !!snapshotWeekKey;
  const additionalWeekKey = getWeekStr(effectiveData.reportDate);
  const additionalWeekLabel = additionalWeekKey ? formatKoMonthWeekLabel(additionalWeekKey) : "";

  return (
    <div className="app-print-root" style={{ fontFamily: "'Pretendard Variable','Apple SD Gothic Neo','Malgun Gothic',sans-serif", background: "#f1f5f9", minHeight: "100vh", color: "#0f172a" }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .app-print-root { background: #fff !important; min-height: 0 !important; }
          .app-print-root .app-main-shell {
            padding: 0 !important;
            margin: 0 !important;
            max-width: none !important;
            background: #fff !important;
          }
          /* 보고서 시트만 인쇄 (헤더·탭·인쇄 버튼 등 나머지는 숨김) */
          body * { visibility: hidden !important; }
          .report-sheet, .report-sheet * { visibility: visible !important; }
          .report-sheet {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 12px 16px !important;
            box-sizing: border-box !important;
          }
        }
      `}</style>
      <div className="no-print app-sticky-shell" style={{ position: "sticky", top: 0, zIndex: 100, background: "#f1f5f9" }}>
        <header style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", color: "#fff", padding: "12px 24px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,min(92vw,520px)) minmax(0,1fr)", alignItems: "center", gap: "10px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}><div style={{ width: 52, height: 52, borderRadius: 10, flexShrink: 0, overflow: "hidden", boxShadow: "0 0 0 1px rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}><img src={`${import.meta.env.BASE_URL}header-mark.png`} alt="" style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block" }} /></div><div style={{ minWidth: 0 }}><div style={{ fontSize: 16, fontWeight: 800 }}>장기 숙박 유치 현황</div><div style={{ fontSize: 11, opacity: .55 }}>위탁운영 객실 관리 시스템</div></div></div>
            <div style={{ textAlign: "center", justifySelf: "center", width: "100%", maxWidth: 520 }}>
              <div style={{ display: "inline-block", padding: "8px 14px", borderRadius: 10, border: "1px solid rgba(251,191,36,0.35)", background: "linear-gradient(180deg, rgba(30,41,59,0.9) 0%, rgba(15,23,42,0.65) 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize: "clamp(15px, 2vw, 22px)", fontWeight: 500, letterSpacing: "0.02em", lineHeight: 1.35, color: "#fef9c3", textShadow: "0 1px 3px rgba(0,0,0,.35)", fontFamily: "'Segoe Script','Brush Script MT','Apple Chancery','Nanum Pen Script','Malgun Pen Script',cursive" }}>숙박유치는 선택이 아니라 생존이다.</span>
              </div>
            </div>
            <div style={{ fontSize: 12, opacity: .85, textAlign: "right", justifySelf: "end", whiteSpace: "nowrap" }}>기준일 : {effectiveData.reportDate}</div>
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.15)", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button type="button" onClick={() => setSnapshotWeekKey(null)} style={{ background: "#f8fafc", color: "#0f172a", border: "1px solid #cbd5e1", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 800 }}>현재 데이터</button>
            <label style={{ color: "#e2e8f0", fontSize: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              저장 주차 선택
              <select value={snapshotWeekKey || ""} onChange={e => setSnapshotWeekKey(e.target.value || null)} style={{ padding: "6px 10px", borderRadius: 6, fontSize: 12, minWidth: 240, maxWidth: "100%", border: "1px solid #475569", background: "#1e293b", color: "#fff" }}>
                <option value="">— 선택 —</option>
                {Object.keys(data.reportSnapshots || {}).sort((a, b) => weekStrSortKey(b) - weekStrSortKey(a)).map(w => (
                  <option key={w} value={w}>{formatKoMonthWeekLabel(w)} · {new Date(data.reportSnapshots[w].savedAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</option>
                ))}
              </select>
            </label>
            {!snapReading ? <button type="button" onClick={saveWeeklyReportSnapshot} style={{ background: "#16a34a", color: "#fff", border: "none", padding: "7px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>💾 저장</button> : null}
          </div>
        </header>
        <nav style={{ padding: "10px 24px 0", display: "flex", flexWrap: "wrap", gap: 6, rowGap: 4, background: "#f1f5f9" }}>
          {tabs.map(t => <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{ padding: "9px 18px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: tab === t.key ? "#fff" : "transparent", color: tab === t.key ? "#0f172a" : "#64748b", borderBottom: tab === t.key ? "2px solid #3b82f6" : "2px solid transparent", whiteSpace: "nowrap" }}><span style={{ marginRight: 5 }}>{t.icon}</span>{t.label}</button>)}
        </nav>
      </div>
      <main className="app-main-shell" style={{ padding: "16px 24px 40px", maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          {tab === "dashboard" && <Dashboard data={effectiveData} snapshotMode={snapReading} />}
          {tab === "rooms" && <RoomStatus data={effectiveData} onSave={save} readOnly={snapReading} />}
          {tab === "contracts" && <ContractMgr data={effectiveData} onSave={save} readOnly={snapReading} />}
          {tab === "report" && <ReportView data={effectiveData} />}
          {tab === "additional" && (
            <AdditionalReport
              data={effectiveData}
              onSave={savePartial}
              readOnly={snapReading}
              weekKey={additionalWeekKey}
              weekLabel={additionalWeekLabel}
              onGoToReport={() => setTab("report")}
              onOpenPtAdditional={() => {
                try { sessionStorage.setItem(PT_SESSION_OPEN_ADDITIONAL, "1"); } catch (_) { /* noop */ }
                setTab("report");
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Dashboard({ data, snapshotMode }) {
  const { rooms, contracts, roomList } = data;
  const rT = useMemo(() => {
    const t = { total: 0, ins: 0, corp: 0, personal: 0, hotel: 0, dorm: 0, avail: 0, bad: 0 };
    Object.values(rooms).forEach(r => { t.ins += r.inspire || 0; t.corp += (r.sharp || 0) + (r.etcCorp || 0); t.personal += r.personal || 0; t.hotel += r.hotel || 0; t.dorm += (r.dormAsset || 0) + (r.dormGroup || 0); t.avail += (r.empty || 0) + (r.moveIn || 0) + (r.repair || 0); t.bad += r.badRepair || 0; });
    const sumParts = t.ins + t.corp + t.personal + t.hotel + t.dorm + t.avail + t.bad;
    const lg = countRoomListGrandTotal(roomList);
    t.total = lg != null ? lg : sumParts;
    return t;
  }, [rooms, roomList]);
  const ms = useMemo(() => { const r = {}; contracts.filter(c => c.visible).forEach(c => { if (!r[c.month]) r[c.month] = { dep: 0, rent: 0, rooms: 0, miR: 0 }; const m = r[c.month]; if (c.type !== "퇴실") { m.dep += c.deposit; m.rent += c.rent; m.rooms += c.rooms; } if (c.type === "입주") m.miR += c.rooms; }); return r; }, [contracts]);
  const listMoney = useMemo(() => sumRoomListDepositRent(roomList), [roomList]);
  const baseDate = data.reportDate || new Date().toISOString().slice(0, 10);
  const anchor = new Date(baseDate);
  const mCur = addCalendarMonths(anchor, 0);
  const mNxt = addCalendarMonths(anchor, 1);
  const mCurKey = `${mCur.getMonth() + 1}월`;
  const mNextKey = `${mNxt.getMonth() + 1}월`;
  const cw = getWeekStr(baseDate);
  const prevWeekAnchor = new Date(anchor);
  prevWeekAnchor.setDate(prevWeekAnchor.getDate() - 7);
  const pw = getWeekStr(prevWeekAnchor.getFullYear() + "-" + String(prevWeekAnchor.getMonth() + 1).padStart(2, "0") + "-" + String(prevWeekAnchor.getDate()).padStart(2, "0"));
  const tw = contracts.filter(c => c.visible && c.week === cw && c.status === "확정");
  const pwContracts = contracts.filter(c => c.visible && c.week === pw && c.status === "확정");
  const mCurData = ms[mCurKey] || { dep: 0, rent: 0, miR: 0 };
  const mNextData = ms[mNextKey] || { dep: 0, rent: 0, miR: 0 };
  const curRentWithList = mCurData.rent + listMoney.rent;
  const curDepWithList = mCurData.dep + listMoney.deposit;
  const exc = rT.total - rT.ins;
  const occ = rT.total > 0 ? ((rT.ins + rT.corp + rT.personal + rT.hotel + rT.dorm) / rT.total * 100).toFixed(1) : "0";
  const weekRent = tw.reduce((s, c) => s + (c.rent || 0), 0);
  const prevWeekRent = pwContracts.reduce((s, c) => s + (c.rent || 0), 0);
  const rentDiff = weekRent - prevWeekRent;
  const longStayTotal = rT.ins + rT.corp + rT.personal + rT.hotel + rT.dorm;
  const weekBadgeLabel = formatKoMonthWeekLabel(cw);

  const lineCard = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", minHeight: 40 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
      {snapshotMode ? <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#92400e" }}>저장된 주차 스냅샷을 보고 있습니다. 숫자·계약은 당시 저장 기준이며, 수정하려면 상단의 「현재 데이터」 버튼을 누르세요.</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {[{ l: `이번 달 임대료(${mCurKey})`, v: fK(curRentWithList), s: "보증금 " + fK(curDepWithList) + (listMoney.rent > 0 || listMoney.deposit > 0 ? " · 위탁목록 합 반영" : ""), bg: "linear-gradient(135deg,#3b82f6,#1d4ed8)", ic: "💰" }, { l: `다음 달 예상(${mNextKey})`, v: fK(mNextData.rent), s: "신규 " + mNextData.miR + "실", bg: "linear-gradient(135deg,#22c55e,#15803d)", ic: "📈" }, { l: "전체 입실률", v: occ + "%", s: fN(rT.total - rT.avail - rT.bad) + "/" + fN(rT.total), bg: "linear-gradient(135deg,#8b5cf6,#6d28d9)", ic: "🏠" }, { l: "이번 주 확정", v: tw.reduce((s, c) => s + c.rooms, 0) + "실", s: tw.length + "건", bg: "linear-gradient(135deg,#f59e0b,#d97706)", ic: "🔑" }].map((k, i) => (
          <div key={i} style={{ background: k.bg, borderRadius: 14, padding: "14px 18px", color: "#fff", position: "relative", overflow: "hidden" }}><div style={{ position: "absolute", top: -14, right: -14, fontSize: 56, opacity: .1 }}>{k.ic}</div><div style={{ fontSize: 11, opacity: .8 }}>{k.l}</div><div style={{ fontSize: 24, fontWeight: 800, margin: "2px 0" }}>{k.v}</div><div style={{ fontSize: 10, opacity: .6 }}>{k.s}</div></div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "stretch" }}>
        <Card style={{ padding: 14, minHeight: 0 }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>📅 이번 주 현황</h3>
          {weekBadgeLabel ? <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{weekBadgeLabel}</div> : null}
          {tw.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "center", padding: 10 }}>이번 주 확정 건 없음</div> :
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {tw.map(c => (
                <div key={c.id} style={{ ...lineCard, background: c.type === "퇴실" ? "#fef2f2" : "#f0fdf4", borderRadius: 8, padding: "8px 12px", border: "1px solid #e2e8f0" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700 }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.company}</span><Badge color={c.type === "입주" ? "green" : "red"}>{c.type}</Badge></span>
                  <span style={{ fontSize: 12, color: "#475569", whiteSpace: "nowrap" }}>📅{c.moveDate} · 🏠{c.rooms}실 · 💰{fN(c.rent)}</span>
                </div>
              ))}
            </div>}
        </Card>
        <Card style={{ padding: 14, minHeight: 0 }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>⭐ 인스파이어 현황</h3>
          <div style={{ background: "linear-gradient(135deg,#eff6ff,#f0fdf4)", borderRadius: 8, padding: 12, marginBottom: 10 }}><div style={{ fontSize: 11, color: "#64748b" }}>현재 객실</div><div style={{ fontSize: 26, fontWeight: 800, color: "#1d4ed8" }}>{fN(rT.ins)}실</div><div style={{ fontSize: 10, color: "#64748b" }}>전체의 {rT.total > 0 ? (rT.ins / rT.total * 100).toFixed(1) : 0}%</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(data.inspire || []).map(it => (
              <div key={it.id} style={{ ...lineCard, background: it.type === "퇴실" ? "#fef2f2" : it.type === "입실" ? "#f0fdf4" : "#fffbeb", borderRadius: 8, padding: "8px 12px", border: "1px solid #e2e8f0" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, fontWeight: 600 }}><Badge color={it.type === "입실" ? "green" : it.type === "퇴실" ? "red" : "amber"}>{it.type}</Badge>{it.rooms}실<span style={{ fontWeight: 500, color: "#64748b", fontSize: 12 }}>{it.note}{it.date ? " · " + it.date : ""}</span></span>
                <Badge color={it.status === "확정" ? "green" : "amber"}>{it.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: 12, alignItems: "stretch" }}>
        <Card style={{ padding: 14, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>🏨 객실 분포 (인스파이어 제외)</h3>
          <div style={{ flex: 1, minHeight: 0 }}>
            {[{ l: "샤프+기타법인", v: rT.corp, c: "#3b82f6" }, { l: "장박 개인", v: rT.personal, c: "#8b5cf6" }, { l: "호텔", v: rT.hotel, c: "#f59e0b" }, { l: "기숙사", v: rT.dorm, c: "#6366f1" }, { l: "공실(판매가능)", v: rT.avail, c: "#22c55e" }, { l: "공실(판매불가)", v: rT.bad, c: "#ef4444" }].map(it => (
              <div key={it.l} style={{ marginBottom: 5 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2, gap: 6 }}><span style={{ minWidth: 0 }}>{it.l}</span><b style={{ whiteSpace: "nowrap" }}>{fN(it.v)}실 ({exc > 0 ? (it.v / exc * 100).toFixed(1) : 0}%)</b></div><div style={{ height: 6, background: "#f1f5f9", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: (exc > 0 ? it.v / exc * 100 : 0) + "%", background: it.c, borderRadius: 3 }} /></div></div>
            ))}
          </div>
          <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 6, display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginTop: "auto" }}><span>합계</span><span>{fN(exc)}실</span></div>
        </Card>

        <div style={{ background: "linear-gradient(180deg,#1e293b 0%,#0f172a 100%)", borderRadius: 16, padding: "18px 20px", border: "1px solid #334155", boxShadow: "0 12px 40px rgba(15,23,42,.25)", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: "#94a3b8", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}><span>📋</span> 핵심 요약</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, flex: 1, alignContent: "start" }}>
            <div style={{ background: "#272f3f", borderRadius: 12, padding: "14px 16px", border: "1px solid #3d4a5f" }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>이번 주 임대료 수익</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc", lineHeight: 1.2 }}>{fK(weekRent)}</div>
              <div style={{ fontSize: 11, color: rentDiff >= 0 ? "#f87171" : "#60a5fa", marginTop: 6 }}>전주 대비 {rentDiff > 0 ? "▲ " + fK(rentDiff) : rentDiff < 0 ? "▼ " + fK(Math.abs(rentDiff)) : "—"}</div>
            </div>
            <div style={{ background: "#272f3f", borderRadius: 12, padding: "14px 16px", border: "1px solid #3d4a5f" }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>다음 달 예상 수익 ({mNextKey})</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#4ade80", lineHeight: 1.2 }}>{fK(mNextData.rent)}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>신규 입주 {fN(mNextData.miR)}객실 포함</div>
            </div>
            <div style={{ background: "#272f3f", borderRadius: 12, padding: "14px 16px", border: "1px solid #3d4a5f" }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>전체 장기숙박 객실</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#60a5fa", lineHeight: 1.2 }}>{fN(longStayTotal)}실</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>전체 {fN(rT.total)}실 중 {rT.total > 0 ? ((longStayTotal / rT.total) * 100).toFixed(1) : 0}%</div>
            </div>
            <div style={{ background: "#272f3f", borderRadius: 12, padding: "14px 16px", border: "1px solid #3d4a5f" }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>위탁 객실목록 합계</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fde68a", lineHeight: 1.2 }}>임대료 {fK(listMoney.rent)}</div>
              <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 6 }}>보증금 {fK(listMoney.deposit)} (사용금지 행 제외)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyOverlay() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(248,250,252,0.88)", borderRadius: 12, pointerEvents: "auto", display: "flex", justifyContent: "center", paddingTop: 40, alignItems: "flex-start", boxSizing: "border-box" }}>
      <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#92400e", maxWidth: 440, textAlign: "center", lineHeight: 1.45 }}>저장본(과거 주차)입니다. 수정하려면 상단의 「현재 데이터」 버튼을 누르세요.</div>
    </div>
  );
}

const ROOM_SUM_ROW_ED = "__합계__";
const ROOM_DAEWON_ROW_ED = "__대원소유분__";

function RoomStatus({ data, onSave, readOnly }) {
  const { rooms, daewon: dwRaw, roomList } = data;
  const dw = dwRaw || initData.daewon;
  const [ed, setEd] = useState(null); const [ev, setEv] = useState({}); const [sp, setSp] = useState(false); const [pt, setPt] = useState(""); const [pm, setPm] = useState("");
  const [lastParseFailLines, setLastParseFailLines] = useState(0);
  const tot = {}; FKEYS.forEach(k => { tot[k] = Object.values(rooms).reduce((s, r) => s + (r[k] || 0), 0); });
  const chaListTotals = countRoomListByChaExcludingForbidden(roomList);
  const footListGrand = countRoomListGrandTotal(roomList);
  const daewonListTotal = countDaewonListTotal(roomList);
  const handlePaste = () => {
    try {
    setLastParseFailLines(0);
    const rawLines = splitPasteLines(pt);
    if (rawLines.length === 0) {
      setPm("붙여넣을 내용이 없습니다. 텍스트 영역에 데이터를 붙여넣은 뒤 적용하세요.");
      return;
    }
    const nr = { ...rooms };
    const ch = ["1차", "2차", "3차", "4차"];
    const paste10 = ["inspire", "sharp", "etcCorp", "personal", "hotel", "dormAsset", "empty", "moveIn", "repair", "badRepair"];

    const listRows = [];
    for (const l of rawLines) {
      try {
        const pr = parseRoomListLine(l);
        if (pr) listRows.push({ ...pr, id: "rl-" + Date.now() + "-" + listRows.length + "-" + Math.random().toString(36).slice(2, 8) });
      } catch (err) {
        console.warn("[객실 붙여넣기] 행 스킵(예외):", err?.message || err, String(l).slice(0, 100));
      }
    }
    if (listRows.length > 0) {
      const parseFail = rawLines.length - listRows.length;
      setLastParseFailLines(parseFail);
      const { rooms: aggRooms, daewon: aggDw, forbidden, badCha } = aggregateRoomsFromRoomList(listRows);
      const grand = countRoomListGrandTotal(listRows);
      const cellTotal = Object.values(aggRooms).reduce((s, r) => s + sumRoom(r), 0);
      onSave({ ...data, roomList: listRows, rooms: aggRooms, daewon: aggDw });
      setPm(`11열(탭) ${rawLines.length}줄 → 저장 ${listRows.length}행${parseFail ? ` · 파싱제외 ${parseFail}줄` : ""} · 합계열 ${grand} · 표칸합 ${cellTotal}${forbidden ? ` · 사용금지 ${forbidden}` : ""}${badCha ? ` · 차수오류 ${badCha}` : ""}`);
      setPt("");
      setTimeout(() => { setPm(""); setSp(false); }, 4500);
      return;
    }

    const parseDetailParts = (l) => {
      const row = splitPasteDelimitedRow(l);
      if (row && row.length >= 3) return row;
      const s = String(l ?? "").replace(/\r$/, "");
      const sp = s.split(/\s+/).map(trimPasteCell).filter(Boolean);
      return sp.length >= 3 ? sp : null;
    };
    const detailLines = rawLines.filter(l => {
      const p = parseDetailParts(l);
      if (!p) return false;
      return parseChaToken(p[0]) && roomCategoryLabelToKey(p[2]);
    });

    if (detailLines.length > 0) {
      const byCha = {};
      let skipped = 0;
      for (const l of rawLines) {
        const p = parseDetailParts(l);
        if (!p || p.length < 3) { skipped++; continue; }
        const cha = parseChaToken(p[0]);
        const fk = roomCategoryLabelToKey(p[2]);
        if (!cha || !fk) { skipped++; continue; }
        if (!byCha[cha]) byCha[cha] = emptyRoomCounts();
        byCha[cha][fk] = (byCha[cha][fk] || 0) + 1;
      }
      const keys = Object.keys(byCha);
      if (keys.length === 0) {
        setPm("형식 오류 (차수·분류 확인)");
        return;
      }
      keys.forEach(cha => {
        const prev = rooms[cha] || {};
        const c = { ...emptyRoomCounts(), ...byCha[cha] };
        if ((byCha[cha].dormGroup || 0) === 0) c.dormGroup = prev.dormGroup || 0;
        nr[cha] = c;
      });
      onSave({ ...data, rooms: nr, roomList: null });
      const applied = rawLines.length - skipped;
      setPm(`${applied}행 반영 (${keys.join(", ")})` + (skipped ? ` · 무시 ${skipped}행` : ""));
      setPt("");
      setTimeout(() => { setPm(""); setSp(false); }, 1800);
      return;
    }

    let ap = 0;
    rawLines.forEach((l, i) => {
      if (i >= 4) return;
      const vs = l.split(/\t|,/).map(v => parseInt(v.trim())).filter(v => !isNaN(v));
      let r = null;
      if (vs.length >= 11) {
        r = {};
        FIELDS.forEach((f, fi) => { r[f.k] = vs[fi] || 0; });
      } else if (vs.length >= 10) {
        r = { dormGroup: 0 };
        paste10.forEach((k, idx) => { r[k] = vs[idx] || 0; });
      }
      if (r) { nr[ch[i]] = r; ap++; }
    });
    if (ap > 0) { onSave({ ...data, rooms: nr, roomList: null }); setPm(ap + "개 적용 완료"); setPt(""); setTimeout(() => { setPm(""); setSp(false); }, 1500); } else setPm("형식 오류 — 11열(탭) 객실 목록·간편 3열·상단 4줄 숫자 형식을 확인하세요.");
    } catch (e) {
      console.error("[붙여넣기]", e);
      setPm("처리 중 오류가 났습니다. 콘솔을 확인하거나 탭 구분 붙여넣기를 사용해 보세요.");
    }
  };

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
      {readOnly ? <ReadOnlyOverlay /> : null}
      <div style={{ pointerEvents: readOnly ? "none" : "auto", userSelect: readOnly ? "none" : undefined }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 3 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>○ 위탁운영 객실현황</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={() => setSp(!sp)} style={{ padding: "7px 18px", background: sp ? "#e2e8f0" : "linear-gradient(135deg,#8b5cf6,#6d28d9)", color: sp ? "#475569" : "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{sp ? "닫기" : "📋 붙여넣기"}</button>
        </div>
      </div>
      <Card style={{ padding: 0, overflowX: "auto", flex: 1 }}>
        <table style={{ width: "100%", minWidth: 920, tableLayout: "fixed", borderCollapse: "collapse", background: "#fff" }}>
          <colgroup>
            <col style={{ width: "4.5%" }} /><col style={{ width: "5.5%" }} />
            <col style={{ width: "6.2%" }} /><col style={{ width: "6.2%" }} /><col style={{ width: "6.2%" }} /><col style={{ width: "6.2%" }} />
            <col style={{ width: "4.6%" }} /><col style={{ width: "6.6%" }} />
            <col style={{ width: "5.5%" }} /><col style={{ width: "5.5%" }} /><col style={{ width: "5.5%" }} />
            <col style={{ width: "4.5%" }} /><col style={{ width: "7.5%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={RTH()} rowSpan={2}>차수</th>
              <th style={RTH()} rowSpan={2}>합계</th>
              <th style={RTH({ background: "#dbeafe", color: "#1e3a5f" })} colSpan={4}>장기숙박</th>
              <th style={RTH()} rowSpan={2}>호텔</th>
              <th style={RTH({ whiteSpace: "normal", lineHeight: 1.25 })} rowSpan={2}>
                <span style={{ borderBottom: "1px solid #334155", display: "inline-block", paddingBottom: 2 }}>기숙사</span>
                <br />
                <span style={{ fontSize: "0.9em", fontWeight: 700 }}>(자산)</span>
              </th>
              <th style={RTH({ background: "#d1fae5", color: "#14532d" })} colSpan={3}>공실(가능)</th>
              <th style={RTH({ background: "#fee2e2", color: "#7f1d1d" })} rowSpan={2}>불가</th>
              <th style={RTH()} rowSpan={2}>액션</th>
            </tr>
            <tr>
              <th style={RTS({ background: "#eff6ff" })}>인스</th><th style={RTS({ background: "#eff6ff" })}>샤프</th><th style={RTS({ background: "#eff6ff" })}>기타</th><th style={RTS({ background: "#eff6ff" })}>개인</th>
              <th style={RTS({ background: "#ecfdf5" })}>공실</th><th style={RTS({ background: "#ecfdf5" })}>입실</th><th style={RTS({ background: "#ecfdf5" })}>보수</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: "#f1f5f9" }}>
              <td style={{ ...RTD({ textAlign: "center", fontWeight: 800 }) }}>합계</td>
              <td style={{ ...RTD({ textAlign: "right", fontWeight: 800, color: "#dc2626" }) }}>
                {ed === ROOM_SUM_ROW_ED ? <span style={{ fontSize: 12, color: "#64748b" }}>{fN(ROOM_TABLE_FIELDS.reduce((s, f) => s + (parseInt(ev[f.k], 10) || 0), 0))} (열합)</span> : fN(footListGrand != null ? footListGrand : Object.values(rooms).reduce((s, r) => s + sumRoom(r), 0))}
              </td>
              {ed === ROOM_SUM_ROW_ED ? <>
                {ROOM_TABLE_FIELDS.map(f => <td key={f.k} style={RTD()}><input type="number" min={0} value={ev[f.k] ?? 0} onChange={e => setEv({ ...ev, [f.k]: parseInt(e.target.value, 10) || 0 })} style={{ width: "100%", maxWidth: f.k === "dormAsset" ? 84 : 56, boxSizing: "border-box", padding: "4px 6px", border: "2px solid #3b82f6", borderRadius: 6, fontSize: 14, textAlign: "right" }} /></td>)}
                <td style={RTD()}><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}><button type="button" disabled={readOnly} onClick={() => { const nr = distributeColumnTotalsToRooms(rooms, ev); onSave({ ...data, rooms: nr, roomList: null }); setEd(null); }} style={BTN}>저장</button><button type="button" onClick={() => setEd(null)} style={{ ...BTN, background: "#e2e8f0", color: "#475569" }}>취소</button></div></td>
              </> : <>
                {ROOM_TABLE_FIELDS.map(f => <td key={f.k} style={{ ...RTD({ textAlign: "right", fontWeight: 700 }) }}>{fN(tot[f.k])}</td>)}
                <td style={RTD({ textAlign: "center" })}><button type="button" disabled={readOnly} onClick={() => { setEd(ROOM_SUM_ROW_ED); const o = {}; ROOM_TABLE_FIELDS.forEach(x => { o[x.k] = tot[x.k] || 0; }); setEv(o); }} style={{ ...BTN, background: "#eff6ff", color: "#2563eb" }}>수정</button></td>
              </>}
            </tr>
            {Object.entries(rooms).map(([cha, r], ri) => {
              const isE = ed === cha;
              const sumShown = chaListTotals ? chaListTotals[cha] ?? 0 : sumRoom(r);
              return (<tr key={cha} style={{ background: isE ? "#eff6ff" : ri % 2 === 1 ? "#fafafa" : "#fff" }}>
                <td style={{ ...RTD({ textAlign: "center", fontWeight: 800 }) }}>{cha}</td>
                <td style={{ ...RTD({ textAlign: "right", fontWeight: 700, background: "#f8fafc" }) }}>{fN(sumShown)}</td>
                {isE ? <>{ROOM_TABLE_FIELDS.map(f => <td key={f.k} style={RTD()}><input type="number" value={ev[f.k] ?? 0} onChange={e => setEv({ ...ev, [f.k]: parseInt(e.target.value, 10) || 0 })} style={{ width: "100%", maxWidth: f.k === "dormAsset" ? 84 : 56, boxSizing: "border-box", padding: "4px 6px", border: "2px solid #3b82f6", borderRadius: 6, fontSize: 14, textAlign: "right" }} /></td>)}<td style={RTD()}><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}><button type="button" onClick={() => { onSave({ ...data, rooms: { ...rooms, [ed]: { ...ev, dormGroup: rooms[ed]?.dormGroup || 0 } }, roomList: null }); setEd(null); }} style={BTN}>저장</button><button type="button" onClick={() => setEd(null)} style={{ ...BTN, background: "#e2e8f0", color: "#475569" }}>취소</button></div></td></> :
                  <>{ROOM_TABLE_FIELDS.map(f => <td key={f.k} style={{ ...RTD({ textAlign: "right", color: f.k === "badRepair" && r[f.k] > 0 ? "#dc2626" : "#0f172a" }) }}>{fN(r[f.k])}</td>)}<td style={RTD({ textAlign: "center" })}><button type="button" disabled={readOnly} onClick={() => { setEd(cha); setEv({ ...r }); }} style={{ ...BTN, background: "#eff6ff", color: "#2563eb" }}>수정</button></td></>}
              </tr>);
            })}
            <tr style={{ background: ed === ROOM_DAEWON_ROW_ED ? "#eff6ff" : "#fafafa" }}>
              <td style={{ ...RTD({ textAlign: "center", fontWeight: 800 }) }}>대원소유분</td>
              <td style={{ ...RTD({ textAlign: "right", fontWeight: 700, background: "#f8fafc" }) }}>
                {ed === ROOM_DAEWON_ROW_ED ? (
                  <span style={{ fontSize: 12, color: "#64748b" }}>{fN(ROOM_TABLE_FIELDS.reduce((s, f) => s + (parseInt(ev[f.k], 10) || 0), 0))} (열합)</span>
                ) : (
                  fN(daewonListTotal != null ? daewonListTotal : sumRoom(dw))
                )}
              </td>
              {ed === ROOM_DAEWON_ROW_ED ? (
                <>
                  {ROOM_TABLE_FIELDS.map((f) => (
                    <td key={f.k} style={RTD()}>
                      <input
                        type="number"
                        min={0}
                        value={ev[f.k] ?? 0}
                        onChange={(e) => setEv({ ...ev, [f.k]: parseInt(e.target.value, 10) || 0 })}
                        style={{
                          width: "100%",
                          maxWidth: f.k === "dormAsset" ? 84 : 56,
                          boxSizing: "border-box",
                          padding: "4px 6px",
                          border: "2px solid #3b82f6",
                          borderRadius: 6,
                          fontSize: 14,
                          textAlign: "right",
                        }}
                      />
                    </td>
                  ))}
                  <td style={RTD()}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => {
                          const nextDw = { ...dw };
                          ROOM_TABLE_FIELDS.forEach((f) => {
                            nextDw[f.k] = parseInt(ev[f.k], 10) || 0;
                          });
                          onSave({ ...data, daewon: nextDw });
                          setEd(null);
                        }}
                        style={BTN}
                      >
                        저장
                      </button>
                      <button type="button" onClick={() => setEd(null)} style={{ ...BTN, background: "#e2e8f0", color: "#475569" }}>
                        취소
                      </button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  {ROOM_TABLE_FIELDS.map((f) => (
                    <td key={f.k} style={{ ...RTD({ textAlign: "right", color: f.k === "badRepair" && dw[f.k] > 0 ? "#dc2626" : "#0f172a" }) }}>{fN(dw[f.k])}</td>
                  ))}
                  <td style={RTD({ textAlign: "center" })}>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => {
                        setEd(ROOM_DAEWON_ROW_ED);
                        const o = {};
                        ROOM_TABLE_FIELDS.forEach((x) => {
                          o[x.k] = dw[x.k] || 0;
                        });
                        setEv(o);
                      }}
                      style={{ ...BTN, background: "#eff6ff", color: "#2563eb" }}
                    >
                      수정
                    </button>
                  </td>
                </>
              )}
            </tr>
          </tbody>
        </table>
      </Card>
      {sp && (
        <Card style={{ background: "#faf5ff", border: "2px solid #8b5cf6", padding: 12 }}>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>11열(탭): 차수·호·계약자명·운영시작·운영종료·운영방식·숙박형태·임차인·<b>보증금</b>·<b>임대료</b>·임대종료. 금액은 콤마·원 단위 가능. 예전 9열 붙여넣기도 지원. 필터 후 사용금지 행은 숨긴 뒤 붙여넣기.</p>
          <textarea value={pt} onChange={e => setPt(e.target.value)} placeholder={"1차\t1201\t홍길동\t2026-01-01\t2026-12-31\t위탁\t장박_법인\t샤프\t5000000\t350000\t2026-06-30"} style={{ width: "100%", minHeight: 72, padding: 8, border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
          {pm && <div style={{ marginTop: 4, fontSize: 12, color: pm.includes("반영") || pm.includes("적용") || pm.includes("저장") ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{pm}</div>}
          {lastParseFailLines > 0 ? <div style={{ marginTop: 4, fontSize: 11, color: "#b45309" }}>파싱에서 제외된 줄: {lastParseFailLines}줄 (형식·빈 줄 확인)</div> : null}
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <button type="button" disabled={readOnly} onClick={handlePaste} style={{ padding: "6px 20px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: readOnly ? "not-allowed" : "pointer", fontSize: 12 }}>적용</button>
            <button type="button" onClick={() => { setPt(""); setSp(false); setPm(""); setLastParseFailLines(0); }} style={{ padding: "6px 20px", background: "#e2e8f0", color: "#475569", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>취소</button>
          </div>
        </Card>
      )}
      </div>
    </div>
  );
}

function ContractMgr({ data, onSave, readOnly }) {
  const [fw, setFw] = useState("전체"); const [eid, setEid] = useState(null); const [ef, setEf] = useState({});
  const [form, setForm] = useState({ type: "입주", moveDate: "", company: "", deposit: "", rent: "", rooms: "" });
  const [sp, setSp] = useState(false); const [pt, setPt] = useState(""); const [pm, setPm] = useState("");

  const quickWeeks = useMemo(() => {
    const t = new Date();
    const winStart = new Date(t.getFullYear(), t.getMonth(), 1);
    const winEnd = new Date(t.getFullYear(), t.getMonth() + 2, 0, 23, 59, 59, 999);
    const set = new Set();
    data.contracts.forEach(c => { if (c.week && weekOverlapsMonthWindow(c.week, winStart, winEnd)) set.add(c.week); });
    for (let d = new Date(winStart); d <= winEnd; d.setDate(d.getDate() + 1)) {
      const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      const w = getWeekStr(iso);
      if (w && weekOverlapsMonthWindow(w, winStart, winEnd)) set.add(w);
    }
    return [...set].sort((a, b) => weekStrSortKey(a) - weekStrSortKey(b));
  }, [data.contracts]);
  const filtered = fw === "전체" ? data.contracts : data.contracts.filter(c => c.week === fw);
  const calendarWeekKey = getWeekStr(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`);
  const weekLabelColor = (w) => (!w ? "#94a3b8" : w === calendarWeekKey ? "#0f172a" : "#94a3b8");
  const weekTdColor = (w) => (!w ? "#94a3b8" : w === calendarWeekKey ? "#475569" : "#94a3b8");

  const quickAdd = () => { if (!form.company || !form.rooms) return; const d = form.moveDate ? new Date(form.moveDate) : null; const month = d && !isNaN(d.getTime()) ? (d.getMonth() + 1) + "월" : "3월"; const week = form.moveDate ? getWeekStr(form.moveDate) : ""; onSave({ ...data, contracts: [...data.contracts, { id: Date.now(), month, type: form.type, moveDate: form.moveDate, company: form.company, deposit: parseInt(form.deposit) || 0, rent: parseInt(form.rent) || 0, rooms: parseInt(form.rooms) || 0, status: "확정", visible: true, week }] }); setForm({ type: "입주", moveDate: "", company: "", deposit: "", rent: "", rooms: "" }); };

  const handlePaste = () => {
    try {
      const lines = splitPasteLines(pt);
      if (lines.length === 0) {
        setPm("붙여넣을 내용이 없습니다.");
        return;
      }
      const ni = [];
      lines.forEach(l => {
        const v = splitPasteDelimitedRow(l);
        if (!v || v.length < 6) return;
        const d = v[1] ? new Date(v[1]) : null;
        const month = d && !isNaN(d.getTime()) ? (d.getMonth() + 1) + "월" : "3월";
        ni.push({ id: Date.now() + Math.random(), month, type: v[0] || "입주", moveDate: v[1] || "", company: v[2] || "", deposit: parseInt(v[3]) || 0, rent: parseInt(v[4]) || 0, rooms: parseInt(v[5]) || 0, status: "확정", visible: true, week: v[1] ? getWeekStr(v[1]) : "" });
      });
      if (ni.length > 0) {
        onSave({ ...data, contracts: [...data.contracts, ...ni] });
        setPm(ni.length + "건 완료");
        setPt("");
        setTimeout(() => { setPm(""); setSp(false); }, 1500);
      } else setPm("형식: 구분(탭)입주일(탭)업체(탭)보증금(탭)임대료(탭)객실수 — 콤마 포함 시 CSV 따옴표 필드 또는 탭 구분");
    } catch (e) {
      console.error("[계약 붙여넣기]", e);
      setPm("처리 중 오류가 났습니다.");
    }
  };

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
      {readOnly ? <ReadOnlyOverlay /> : null}
      <div style={{ pointerEvents: readOnly ? "none" : "auto", userSelect: readOnly ? "none" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800 }}>○ 계약관리 (주간 뷰)</h2>
        <button type="button" onClick={() => setSp(!sp)} style={{ padding: "7px 18px", background: sp ? "#e2e8f0" : "linear-gradient(135deg,#8b5cf6,#6d28d9)", color: sp ? "#475569" : "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{sp ? "닫기" : "📋 붙여넣기"}</button>
      </div>
      <Card style={{ background: "#eff6ff", border: "2px solid #3b82f6", padding: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
          {[["구분", <select key="t" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} style={{ ...INP, width: 72 }}><option>입주</option><option>퇴실</option><option>예정</option><option>기존</option></select>], ["입주일", <input key="d" type="date" value={form.moveDate} onChange={e => setForm({ ...form, moveDate: e.target.value })} style={{ ...INP, width: 130 }} />], ["업체/개인", <input key="c" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} style={{ ...INP, width: 130 }} placeholder="업체명" />], ["보증금", <input key="dp" type="number" value={form.deposit} onChange={e => setForm({ ...form, deposit: e.target.value })} style={{ ...INP, width: 110 }} placeholder="0" />], ["임대료", <input key="r" type="number" value={form.rent} onChange={e => setForm({ ...form, rent: e.target.value })} style={{ ...INP, width: 110 }} placeholder="0" />], ["객실수", <input key="rm" type="number" value={form.rooms} onChange={e => setForm({ ...form, rooms: e.target.value })} style={{ ...INP, width: 64 }} placeholder="0" />]].map(([l, el]) => <label key={l} style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>{l}</span>{el}</label>)}
          <button onClick={quickAdd} style={{ padding: "8px 20px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", height: 38, fontSize: 14 }}>데이터 입력</button>
        </div>
      </Card>
      {sp && <Card style={{ background: "#faf5ff", border: "2px solid #8b5cf6", padding: 12 }}>
        <p style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>구분(탭)입주일(탭)업체명(탭)보증금(탭)임대료(탭)객실수</p>
        <textarea value={pt} onChange={e => setPt(e.target.value)} placeholder={"입주\t2026-03-29\t인스파이어\t5000000\t3500000\t7"} style={{ width: "100%", height: 60, padding: 8, border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
        {pm && <div style={{ marginTop: 4, fontSize: 12, color: pm.includes("완료") ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{pm}</div>}
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}><button type="button" onClick={handlePaste} style={{ padding: "6px 20px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>적용</button><button type="button" onClick={() => { setPt(""); setSp(false); setPm(""); }} style={{ padding: "6px 20px", background: "#e2e8f0", color: "#475569", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>취소</button></div>
      </Card>}
      <div style={{ position: "relative", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={() => setFw("전체")} style={{ ...CHIP, background: fw === "전체" ? "#3b82f6" : "#fff", color: fw === "전체" ? "#fff" : "#0f172a" }}>전체</button>
        {quickWeeks.map(w => {
          const sel = fw === w;
          const cur = w === calendarWeekKey;
          return (
            <button type="button" key={w} onClick={() => setFw(fw === w ? "전체" : w)} style={{ ...CHIP, background: sel ? "#3b82f6" : "#fff", color: sel ? "#fff" : weekLabelColor(w), borderColor: sel ? "#3b82f6" : cur ? "#cbd5e1" : "#e5e7eb", fontWeight: cur ? 700 : 600 }}>{formatKoMonthWeekLabel(w)}</button>
          );
        })}
        <label style={{ ...CHIP, background: "#f1f5f9", border: "1px dashed #94a3b8", color: "#334155", position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", minHeight: 36, boxSizing: "border-box" }}>
          <input
            type="date"
            aria-label="날짜로 주 선택"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", margin: 0, border: "none", fontSize: 16 }}
            onChange={e => {
              const v = e.target.value;
              if (v) {
                setFw(getWeekStr(v));
                e.target.value = "";
              }
            }}
          />
          <span style={{ pointerEvents: "none", userSelect: "none" }}>📅 날짜로 주 선택</span>
        </label>
      </div>
      <Card style={{ padding: 0, overflowX: "auto", flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#fffbeb" }}>{["주차", "월", "구분", "업체/개인", "보증금", "임대료", "객실수", "입주일", "상태", "표시", "액션"].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
          <tbody>{filtered.map(c => {
            if (eid === c.id) return (<tr key={c.id} style={{ background: "#eff6ff", borderBottom: "1px solid #e2e8f0" }}><td style={{ ...TD, fontSize: 12, color: weekTdColor(ef.week || c.week) }}>{formatKoMonthWeekLabel(ef.week || c.week)}</td><td style={TD}>{ef.month}</td><td style={TD}><select value={ef.type} onChange={e => setEf({ ...ef, type: e.target.value })} style={{ ...INP, width: 56 }}><option>입주</option><option>퇴실</option><option>예정</option><option>기존</option></select></td><td style={TD}><input value={ef.company} onChange={e => setEf({ ...ef, company: e.target.value })} style={{ ...INP, width: 110 }} /></td><td style={TD}><input type="number" value={ef.deposit} onChange={e => setEf({ ...ef, deposit: parseInt(e.target.value) || 0 })} style={{ ...INP, width: 90 }} /></td><td style={TD}><input type="number" value={ef.rent} onChange={e => setEf({ ...ef, rent: parseInt(e.target.value) || 0 })} style={{ ...INP, width: 90 }} /></td><td style={TD}><input type="number" value={ef.rooms} onChange={e => setEf({ ...ef, rooms: parseInt(e.target.value) || 0 })} style={{ ...INP, width: 44 }} /></td><td style={TD}><input type="date" value={ef.moveDate} onChange={e => setEf({ ...ef, moveDate: e.target.value })} style={{ ...INP, width: 120 }} /></td><td style={TD}><select value={ef.status} onChange={e => setEf({ ...ef, status: e.target.value })} style={{ ...INP, width: 56 }}><option>확정</option><option>예정</option></select></td><td></td><td style={TD}><div style={{ display: "flex", gap: 2 }}><button onClick={() => { const wk = ef.moveDate ? getWeekStr(ef.moveDate) : ef.week; onSave({ ...data, contracts: data.contracts.map(x => x.id === eid ? { ...ef, week: wk || ef.week } : x) }); setEid(null); }} style={BTN}>저장</button><button onClick={() => setEid(null)} style={{ ...BTN, background: "#e2e8f0", color: "#475569" }}>취소</button></div></td></tr>);
            return (<tr key={c.id} style={{ borderBottom: "1px solid #e2e8f0", opacity: c.visible ? 1 : .4, background: c.type === "퇴실" ? "#fef2f2" : "" }}><td style={{ ...TD, fontSize: 12, color: weekTdColor(c.week) }}>{formatKoMonthWeekLabel(c.week)}</td><td style={{ ...TD, fontWeight: 600 }}>{c.month}</td><td style={TD}><Badge color={c.type === "입주" ? "green" : c.type === "퇴실" ? "red" : c.type === "예정" ? "amber" : "blue"}>{c.type}</Badge></td><td style={{ ...TD, fontWeight: 500 }}>{c.company}</td><td style={{ ...TD, textAlign: "right" }}>{fK(c.deposit)}</td><td style={{ ...TD, textAlign: "right" }}>{fK(c.rent)}</td><td style={{ ...TD, textAlign: "center", fontWeight: 700, color: "#2563eb" }}>{c.rooms}</td><td style={{ ...TD, fontSize: 10 }}>{c.moveDate}</td><td style={TD}><Badge color={c.status === "확정" ? "green" : "amber"}>{c.status}</Badge></td><td style={TD}><button onClick={() => onSave({ ...data, contracts: data.contracts.map(x => x.id === c.id ? { ...x, visible: !x.visible } : x) })} style={{ ...BTN, background: c.visible ? "#dcfce7" : "#fee2e2", color: c.visible ? "#16a34a" : "#dc2626", fontSize: 9 }}>{c.visible ? "표시" : "숨김"}</button></td><td style={TD}><div style={{ display: "flex", gap: 2 }}><button onClick={() => { setEid(c.id); setEf({ ...c }); }} style={{ ...BTN, background: "#eff6ff", color: "#2563eb" }}>수정</button><button onClick={() => onSave({ ...data, contracts: data.contracts.filter(x => x.id !== c.id) })} style={{ ...BTN, background: "#fef2f2", color: "#dc2626" }}>삭제</button></div></td></tr>);
          })}</tbody>
        </table>
      </Card>
      </div>
    </div>
  );
}

function ReportView({ data }) {
  const sheetRef = useRef(null);
  const ptShellRef = useRef(null);
  const ptWrapRef = useRef(null);
  const ptWrapAdditionalRef = useRef(null);
  const hlBaseRef = useRef(null);
  const hlOverlayRef = useRef(null);
  const hlBaseAdditionalRef = useRef(null);
  const hlOverlayAdditionalRef = useRef(null);
  const hlDrawing = useRef(false);
  const hlPointsRef = useRef([]);
  const hlActivePairRef = useRef({ base: null, overlay: null });
  const [ptMode, setPtMode] = useState(false);
  const [ptSlideIndex, setPtSlideIndex] = useState(0);
  const [ptHover, setPtHover] = useState(null);
  /** PT: 왼쪽/오른쪽 끝에 있을 때만 컨트롤 표시 */
  const [ptEdgeZone, setPtEdgeZone] = useState(null);
  const PT_EDGE_PX = 72;
  const { rooms, contracts, daewon, prevRooms, notes, reportDate, roomList } = data;
  const dw = daewon || initData.daewon;
  const prev = prevRooms || initData.prevRooms;
  const tot = {}; FKEYS.forEach(k => { tot[k] = Object.values(rooms).reduce((s, r) => s + (r[k] || 0), 0); });
  const pTot = {}; FKEYS.forEach(k => { pTot[k] = Object.values(prev).reduce((s, r) => s + (r[k] || 0), 0); });
  const listGrand = countRoomListGrandTotal(roomList);
  const chaListTotals = countRoomListByChaExcludingForbidden(roomList);
  const daewonListTotal = countDaewonListTotal(roomList);
  const listMoney = useMemo(() => sumRoomListDepositRent(roomList), [roomList]);
  const reportMonthKey = useMemo(() => {
    const ds = reportDate;
    if (!ds) return "";
    const d = new Date(ds);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}월`;
  }, [reportDate]);
  const totalS = listGrand != null ? listGrand : Object.values(rooms).reduce((s, r) => s + sumRoom(r), 0);
  const pTotalS = Object.values(prev).reduce((s, r) => s + sumRoom(r), 0);

  const ms = {}; contracts.filter(c => c.visible).forEach(c => { if (!ms[c.month]) ms[c.month] = { dep: 0, rent: 0, rooms: 0, miD: 0, miR: 0, miRm: 0, exD: 0, exR: 0, exRm: 0, outD: 0, outR: 0, outRm: 0 }; const m = ms[c.month]; if (c.type === "기존") { m.dep += c.deposit; m.rent += c.rent; m.rooms += c.rooms; } else if (c.type === "입주") { m.miD += c.deposit; m.miR += c.rent; m.miRm += c.rooms; } else if (c.type === "예정") { m.exD += c.deposit; m.exR += c.rent; m.exRm += c.rooms; } else if (c.type === "퇴실") { m.outD += c.deposit; m.outR += c.rent; m.outRm += c.rooms; } });

  function gRev(month, key) { const m = ms[month] || { dep: 0, rent: 0, rooms: 0, miD: 0, miR: 0, miRm: 0, exD: 0, exR: 0, exRm: 0, outD: 0, outR: 0, outRm: 0 }; if (key === "total") return { d: m.dep + m.miD + m.exD, r: m.rent + m.miR + m.exR, rm: m.rooms + m.miRm + m.exRm }; if (key === "ins") return { d: m.dep, r: m.rent, rm: m.rooms }; if (key === "mi") return { d: m.miD, r: m.miR, rm: m.miRm }; if (key === "ex") return { d: m.exD, r: m.exR, rm: m.exRm }; if (key === "out") return { d: m.outD, r: m.outR, rm: m.outRm }; return { d: 0, r: 0, rm: 0 }; }

  function gRevWithList(month, key) {
    const base = gRev(month, key);
    if (key !== "total" || month !== reportMonthKey) return base;
    return { d: base.d + listMoney.deposit, r: base.r + listMoney.rent, rm: base.rm };
  }

  const moveIns = contracts.filter(c => c.visible && (c.type === "입주" || c.type === "예정"));
  const mG = {}; moveIns.forEach(c => { if (!mG[c.month]) mG[c.month] = []; mG[c.month].push(c); });
  const months = ["2월", "3월", "4월"];
  const revRows = [{ label: "합 계", key: "total", bold: true }, { label: "인스파이어", key: "ins" }, { label: "신규입주", key: "mi" }, { label: "예 정", key: "ex" }, { label: "퇴 실", key: "out" }];

  const hc = { padding: "9px 10px", border: "1px solid #888", textAlign: "center", fontSize: 12, fontWeight: 700, background: "#fffff0", whiteSpace: "nowrap", lineHeight: "1.35" };
  const rc = (bg, bold, color) => ({ padding: "8px 10px", border: "1px solid #aaa", textAlign: "right", fontSize: "12px", background: bg || "#fff", fontWeight: bold ? 700 : 400, color: color || "#000", whiteSpace: "nowrap", lineHeight: "1.4" });
  const rcc = (bg, bold) => ({ ...rc(bg, bold), textAlign: "center" });
  const drc = (color) => ({ padding: "6px 8px", border: "1px solid #ccc", textAlign: "right", fontSize: 10, background: "#fafafa", fontWeight: 600, lineHeight: "1.35", whiteSpace: "nowrap", color: color || "#888" });

  useEffect(() => { if (!ptMode) setPtHover(null); }, [ptMode]);
  useEffect(() => { if (!ptMode) setPtSlideIndex(0); }, [ptMode]);

  useEffect(() => {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(PT_SESSION_OPEN_ADDITIONAL) === "1") {
        sessionStorage.removeItem(PT_SESSION_OPEN_ADDITIONAL);
        setPtMode(true);
        setPtSlideIndex(1);
      }
    } catch (_) { /* noop */ }
  }, []);

  const ptAdditionalBlocks = useMemo(() => additionalReportBlocksForData(data), [data]);

  const clearPtHover = () => setPtHover(null);
  const ptWeekCellProps = (styleObj, cur, prevVal, enabled = true) => {
    if (!ptMode || !enabled) return { style: styleObj };
    return {
      style: { ...styleObj, cursor: "help" },
      onMouseEnter: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPtHover({ x: r.left + r.width / 2, y: r.top, node: <PtTipWeekBubble cur={cur} prevVal={prevVal} /> });
      },
      onMouseLeave: clearPtHover,
    };
  };
  const ptMonthCellProps = (styleObj, cur, prevVal, kind, hasPrev) => {
    if (!ptMode) return { style: styleObj };
    return {
      style: { ...styleObj, cursor: "help" },
      onMouseEnter: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPtHover({
          x: r.left + r.width / 2,
          y: r.top,
          node: <PtTipMonthBubble cur={cur} prevVal={prevVal} kind={kind} hasPrev={hasPrev} />,
        });
      },
      onMouseLeave: clearPtHover,
    };
  };

  const syncHlPair = useCallback((wrap, base, overlay) => {
    if (!wrap || !base || !overlay) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    [base, overlay].forEach((canvas) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }, []);

  const syncHlCanvas = useCallback(() => {
    syncHlPair(ptWrapRef.current, hlBaseRef.current, hlOverlayRef.current);
    syncHlPair(ptWrapAdditionalRef.current, hlBaseAdditionalRef.current, hlOverlayAdditionalRef.current);
  }, [syncHlPair]);

  const clearHlLayerBitmap = (canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const dpr = canvas.width / Math.max(canvas.clientWidth, 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const clearHighlighter = useCallback(() => {
    [hlBaseRef, hlOverlayRef, hlBaseAdditionalRef, hlOverlayAdditionalRef].forEach((r) => {
      const c = r.current;
      if (c) clearHlLayerBitmap(c);
    });
    hlPointsRef.current = [];
  }, []);

  const clearHighlighterOnTargetSlide = useCallback((target) => {
    if (!target) return;
    const w0 = ptWrapRef.current;
    const w1 = ptWrapAdditionalRef.current;
    if (w1?.contains(target)) {
      if (hlBaseAdditionalRef.current) clearHlLayerBitmap(hlBaseAdditionalRef.current);
      if (hlOverlayAdditionalRef.current) clearHlLayerBitmap(hlOverlayAdditionalRef.current);
      hlPointsRef.current = [];
      return;
    }
    if (w0?.contains(target)) {
      if (hlBaseRef.current) clearHlLayerBitmap(hlBaseRef.current);
      if (hlOverlayRef.current) clearHlLayerBitmap(hlOverlayRef.current);
      hlPointsRef.current = [];
    }
  }, []);

  useEffect(() => {
    if (!ptMode) return;
    const shell = ptShellRef.current;
    if (!shell) return;

    const drawSurfaceContains = (target) => {
      if (!target || (typeof target.closest === "function" && target.closest(".pt-pt-nav"))) return false;
      const w0 = ptWrapRef.current;
      const w1 = ptWrapAdditionalRef.current;
      return !!(w0?.contains(target) || w1?.contains(target));
    };

    const pickActivePair = (target) => {
      const w1 = ptWrapAdditionalRef.current;
      if (w1?.contains(target)) {
        return { base: hlBaseAdditionalRef.current, overlay: hlOverlayAdditionalRef.current };
      }
      return { base: hlBaseRef.current, overlay: hlOverlayRef.current };
    };

    const canvasPointForBase = (e, base) => {
      if (!base) return null;
      const rect = base.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const hlOpts = { lineWidth: 40, color: "rgba(59, 130, 246, 0.19)", dotFill: "rgba(59, 130, 246, 0.23)" };

    const redrawOverlayStroke = () => {
      const overlay = hlActivePairRef.current?.overlay;
      if (!overlay) return;
      clearHlLayerBitmap(overlay);
      const ctx = overlay.getContext("2d");
      if (!ctx) return;
      const dpr = overlay.width / Math.max(overlay.clientWidth, 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      strokeHighlighterSmoothPath(ctx, hlPointsRef.current, hlOpts);
    };

    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button === 2) {
        if (drawSurfaceContains(e.target)) {
          e.preventDefault();
          clearHighlighterOnTargetSlide(e.target);
        }
        return;
      }
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!drawSurfaceContains(e.target)) return;
      const pair = pickActivePair(e.target);
      if (!pair.base || !pair.overlay) return;
      e.preventDefault();
      const p = canvasPointForBase(e, pair.base);
      if (!p) return;
      hlActivePairRef.current = pair;
      hlDrawing.current = true;
      hlPointsRef.current = [p];
      redrawOverlayStroke();
      try { shell.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    const onMove = (e) => {
      if (!hlDrawing.current) return;
      if (e.pointerType === "mouse" && (e.buttons & 1) === 0) {
        hlDrawing.current = false;
        return;
      }
      const p = canvasPointForBase(e, hlActivePairRef.current?.base);
      if (!p) return;
      const pts = hlPointsRef.current;
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.65) return;
      pts.push(p);
      redrawOverlayStroke();
    };

    const onUp = (e) => {
      if (hlDrawing.current && hlPointsRef.current.length > 0) {
        const base = hlActivePairRef.current?.base;
        const overlay = hlActivePairRef.current?.overlay;
        if (base) {
          const bctx = base.getContext("2d");
          if (bctx) {
            const dpr = base.width / Math.max(base.clientWidth, 1);
            bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            strokeHighlighterSmoothPath(bctx, hlPointsRef.current, hlOpts);
          }
        }
        if (overlay) clearHlLayerBitmap(overlay);
        hlPointsRef.current = [];
      }
      hlDrawing.current = false;
      hlActivePairRef.current = { base: null, overlay: null };
      try { shell.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    const onContextMenu = (e) => {
      if (!drawSurfaceContains(e.target)) return;
      e.preventDefault();
      clearHighlighterOnTargetSlide(e.target);
    };

    shell.addEventListener("pointerdown", onDown, true);
    shell.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      shell.removeEventListener("pointerdown", onDown, true);
      shell.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [ptMode, clearHighlighterOnTargetSlide]);

  useEffect(() => {
    if (!ptMode) return;
    syncHlCanvas();
    const w0 = ptWrapRef.current;
    const w1 = ptWrapAdditionalRef.current;
    const ro = new ResizeObserver(() => syncHlCanvas());
    if (w0) ro.observe(w0);
    if (w1) ro.observe(w1);
    return () => ro.disconnect();
  }, [ptMode, ptSlideIndex, syncHlCanvas]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const mmToPx = (mm) => (mm * 96) / 25.4;
    const printableSizePx = () => ({
      w: mmToPx(297 - 12 - 12),
      h: mmToPx(210 - 6 - 6),
    });
    const clearFit = () => {
      el.style.removeProperty("zoom");
      el.style.removeProperty("transform");
      el.style.removeProperty("transform-origin");
      el.style.removeProperty("width");
    };
    const applyFit = () => {
      clearFit();
      void el.offsetHeight;
      const { w: pageW, h: pageH } = printableSizePx();
      if (pageH <= 0 || pageW <= 0) return;
      const ch = el.scrollHeight;
      const cw = el.scrollWidth;
      let s = 1;
      if (ch > pageH) s = Math.min(s, pageH / ch);
      if (cw > pageW) s = Math.min(s, pageW / cw);
      s = Math.min(1, s * 0.99);
      if (s >= 0.997) {
        clearFit();
        return;
      }
      s = Math.max(0.42, s);
      const ua = navigator.userAgent;
      const useZoom = (/Chrome|Edg|OPR|SamsungBrowser/i.test(ua) || /Safari/i.test(ua)) && !/Firefox/i.test(ua);
      if (useZoom) {
        el.style.zoom = String(s);
        return;
      }
      el.style.transformOrigin = "top left";
      el.style.transform = `scale(${s})`;
      el.style.width = `${(100 / s).toFixed(3)}%`;
    };
    const scheduleFit = () => {
      requestAnimationFrame(() => requestAnimationFrame(applyFit));
    };
    const onAfter = () => {
      clearFit();
    };
    const mq = window.matchMedia("print");
    const onMq = () => {
      if (mq.matches) scheduleFit();
      else clearFit();
    };
    window.addEventListener("beforeprint", scheduleFit);
    window.addEventListener("afterprint", onAfter);
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("beforeprint", scheduleFit);
      window.removeEventListener("afterprint", onAfter);
      mq.removeEventListener("change", onMq);
      clearFit();
    };
  }, []);

  const exitPt = useCallback(() => {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
    setPtSlideIndex(0);
    setPtMode(false);
  }, []);

  useEffect(() => {
    if (!ptMode) return;
    const onKey = (e) => {
      if (e.key === "Escape") exitPt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ptMode, exitPt]);

  useEffect(() => {
    if (!ptMode) return;
    const onFs = () => {
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fs) setPtMode(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, [ptMode]);

  useEffect(() => {
    if (!ptMode) setPtEdgeZone(null);
  }, [ptMode]);

  useLayoutEffect(() => {
    if (!ptMode) return;
    const el = ptShellRef.current;
    if (!el) return;
    if (document.fullscreenElement === el || document.webkitFullscreenElement === el) return;
    const p = el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }, [ptMode]);

  const onPtShellPointer = useCallback((e) => {
    const shell = ptShellRef.current;
    if (!shell) return;
    const r = shell.getBoundingClientRect();
    const x = e.clientX - r.left;
    const w = r.width;
    if (x < PT_EDGE_PX) setPtEdgeZone("left");
    else if (x > w - PT_EDGE_PX) setPtEdgeZone("right");
    else setPtEdgeZone(null);
  }, []);

  const ptCtrlFade = (show) => ({
    opacity: show ? 0.88 : 0,
    pointerEvents: show ? "auto" : "none",
    transition: "opacity 0.22s ease",
  });

  const reportInner = (
    <>
        <h1 style={{ textAlign: "center", fontSize: 20, fontWeight: 800, marginTop: 0, marginBottom: 10, letterSpacing: 2 }}>장기 숙박 유치 현황</h1>

        <div className="report-head-row" style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><b style={{ fontSize: 13 }}>○ 위탁운영 객실현황</b><span style={{ fontSize: 10, color: "#666" }}>기준 : {reportDate}</span></div>
        <table className="report-table-main" style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", marginBottom: 2 }}>
          <colgroup>
            <col style={{ width: "5.2%" }} />
            <col style={{ width: "5.8%" }} />
            <col style={{ width: "5.5%" }} />
            <col style={{ width: "7.2%" }} />
            <col style={{ width: "7.2%" }} />
            <col style={{ width: "7.2%" }} />
            <col style={{ width: "7.2%" }} />
            <col style={{ width: "5.8%" }} />
            <col style={{ width: "6.6%" }} />
            <col style={{ width: "6.5%" }} />
            <col style={{ width: "6.8%" }} />
            <col style={{ width: "6.8%" }} />
            <col style={{ width: "6.7%" }} />
          </colgroup>
          <thead>
            <tr><th style={hc} rowSpan={2}>차수</th><th style={hc} rowSpan={2}>합계</th><th style={{ ...hc, background: "#e8f0fe" }} colSpan={5}>장기숙박</th><th style={hc} rowSpan={2}>호텔</th><th style={{ ...hc, whiteSpace: "normal", lineHeight: 1.25 }} rowSpan={2}><span style={{ borderBottom: "1px solid #333", display: "inline-block", paddingBottom: 1 }}>기숙사</span><br /><span style={{ fontSize: "0.95em" }}>(자산)</span></th><th style={{ ...hc, background: "#e6f4ea" }} colSpan={3}>공실(판매가능)</th><th style={{ ...hc, background: "#fce8e6" }} rowSpan={2}>판매불가</th></tr>
            <tr><th style={{ ...hc, background: "#e8f0fe" }}>계</th><th style={{ ...hc, background: "#e8f0fe" }}>인스</th><th style={{ ...hc, background: "#e8f0fe" }}>샤프</th><th style={{ ...hc, background: "#e8f0fe" }}>기타</th><th style={{ ...hc, background: "#e8f0fe" }}>개인</th><th style={{ ...hc, background: "#e6f4ea" }}>공실</th><th style={{ ...hc, background: "#e6f4ea" }}>입실</th><th style={{ ...hc, background: "#e6f4ea" }}>보수</th></tr>
          </thead>
          <tbody>
            <tr style={{ background: "#f0f0f0" }}><td style={rcc("#eee", true)}>합계</td><td {...ptWeekCellProps(rc("#eee", true, "#c00"), totalS, pTotalS)}>{fN(totalS)}</td><td {...ptWeekCellProps(rc("#e8e8e8", true, "#c00"), longStay(tot), longStay(pTot))}>{fN(tot.inspire + tot.sharp + tot.etcCorp + tot.personal)}</td>{["inspire", "sharp", "etcCorp", "personal"].map(k => <td key={k} {...ptWeekCellProps(rc("#eee", true), tot[k], pTot[k])}>{fN(tot[k])}</td>)}<td {...ptWeekCellProps(rc("#eee", true), tot.hotel, pTot.hotel)}>{fN(tot.hotel)}</td><td {...ptWeekCellProps(rc("#eee", true), tot.dormAsset, pTot.dormAsset)}>{fN(tot.dormAsset)}</td><td {...ptWeekCellProps(rc("#eee", true), tot.empty, pTot.empty)}>{fN(tot.empty)}</td><td {...ptWeekCellProps(rc("#eee", true), tot.moveIn, pTot.moveIn)}>{fN(tot.moveIn)}</td><td {...ptWeekCellProps(rc("#eee", true), tot.repair, pTot.repair)}>{fN(tot.repair)}</td><td {...ptWeekCellProps(rc("#eee", true, "#c00"), tot.badRepair, pTot.badRepair)}>{fN(tot.badRepair)}</td></tr>
            {Object.entries(rooms).map(([cha, r]) => {
              const rowSum = chaListTotals ? (chaListTotals[cha] ?? 0) : sumRoom(r);
              const pr = prev[cha] || emptyRoomCounts();
              const prevRowSum = sumRoom(pr);
              return (<tr key={cha}><td style={rcc(null, true)}>{cha}</td><td {...ptWeekCellProps(rc(null, true), rowSum, prevRowSum)}>{fN(rowSum)}</td><td {...ptWeekCellProps(rc("#f5f5f5", true), longStay(r), longStay(pr))}>{fN(longStay(r))}</td><td {...ptWeekCellProps(rc(), r.inspire, pr.inspire)}>{fN(r.inspire)}</td><td {...ptWeekCellProps(rc(), r.sharp, pr.sharp)}>{fN(r.sharp)}</td><td {...ptWeekCellProps(rc(), r.etcCorp, pr.etcCorp)}>{fN(r.etcCorp)}</td><td {...ptWeekCellProps(rc(), r.personal, pr.personal)}>{fN(r.personal)}</td><td {...ptWeekCellProps(rc(null, false, "#888"), r.hotel, pr.hotel)}>{fN(r.hotel)}</td><td {...ptWeekCellProps(rc(null, false, "#888"), r.dormAsset, pr.dormAsset)}>{fN(r.dormAsset)}</td><td {...ptWeekCellProps(rc(), r.empty, pr.empty)}>{fN(r.empty)}</td><td {...ptWeekCellProps(rc(), r.moveIn, pr.moveIn)}>{fN(r.moveIn)}</td><td {...ptWeekCellProps(rc(), r.repair, pr.repair)}>{fN(r.repair)}</td><td {...ptWeekCellProps(rc(null, false, "#c00"), r.badRepair, pr.badRepair)}>{fN(r.badRepair)}</td></tr>);
            })}
            <tr style={{ background: "#fafafa" }}><td style={rcc("#f5f5f5", true)}>전주대비</td><td {...ptWeekCellProps(drc(diffVal(totalS, pTotalS).c), totalS, pTotalS)}>{diffVal(totalS, pTotalS).t}</td><td {...ptWeekCellProps(drc(diffVal(longStay(tot), longStay(pTot)).c), longStay(tot), longStay(pTot))}>{diffVal(longStay(tot), longStay(pTot)).t}</td>{ROOM_TABLE_FIELDS.map(f => <td key={f.k} {...ptWeekCellProps(drc(diffVal(tot[f.k], pTot[f.k]).c), tot[f.k], pTot[f.k])}>{diffVal(tot[f.k], pTot[f.k]).t}</td>)}</tr>
            <tr><td style={rcc(null, false)}>대원소유분</td><td {...ptWeekCellProps(rc(null, true), daewonListTotal != null ? daewonListTotal : sumRoom(dw), 0, false)}>{fN(daewonListTotal != null ? daewonListTotal : sumRoom(dw))}</td><td {...ptWeekCellProps(rc("#f5f5f5", true), longStay(dw), 0, false)}>{fN(longStay(dw))}</td><td {...ptWeekCellProps(rc(), dw.inspire, 0, false)}>{fN(dw.inspire)}</td><td {...ptWeekCellProps(rc(), dw.sharp, 0, false)}>{fN(dw.sharp)}</td><td {...ptWeekCellProps(rc(), dw.etcCorp, 0, false)}>{fN(dw.etcCorp)}</td><td {...ptWeekCellProps(rc(), dw.personal, 0, false)}>{fN(dw.personal)}</td><td {...ptWeekCellProps(rc(null, false, "#888"), dw.hotel, 0, false)}>{fN(dw.hotel)}</td><td {...ptWeekCellProps(rc(null, false, "#888"), dw.dormAsset, 0, false)}>{fN(dw.dormAsset)}</td><td {...ptWeekCellProps(rc(), dw.empty, 0, false)}>{fN(dw.empty)}</td><td {...ptWeekCellProps(rc(), dw.moveIn, 0, false)}>{fN(dw.moveIn)}</td><td {...ptWeekCellProps(rc(), dw.repair, 0, false)}>{fN(dw.repair)}</td><td {...ptWeekCellProps(rc(null, false, "#c00"), dw.badRepair, 0, false)}>{fN(dw.badRepair)}</td></tr>
          </tbody>
        </table>
        {notes && <p style={{ fontSize: 10, color: "#555", margin: "6px 0 10px" }}>※ 비고 : {notes}</p>}

        <div className="report-head-row" style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><b style={{ fontSize: 13 }}>○ 장기 숙박 월별 계약 현황 및 예상 임대 수익</b><span style={{ fontSize: 10, color: "#666" }}>단위:원</span></div>
        {(listMoney.deposit > 0 || listMoney.rent > 0) && reportMonthKey && months.includes(reportMonthKey) ? (
          <p style={{ fontSize: 10, color: "#555", margin: "0 0 6px" }}>※ 기준일 월({reportMonthKey}) 「합 계」행 보증금·임대료에 위탁 객실목록 합계(보증금 {fN(listMoney.deposit)}, 임대료 {fN(listMoney.rent)})를 더해 표시합니다.</p>
        ) : (listMoney.deposit > 0 || listMoney.rent > 0) && reportMonthKey && !months.includes(reportMonthKey) ? (
          <p style={{ fontSize: 10, color: "#555", margin: "0 0 6px" }}>※ 위탁 객실목록 합계: 보증금 {fN(listMoney.deposit)}, 월 임대료 {fN(listMoney.rent)} (표 월이 {reportMonthKey}와 다르면 합계 행에 자동 합산되지 않습니다)</p>
        ) : null}
        <table className="report-table-rev" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 2 }}>
          <thead>
            <tr><th style={hc}>구분</th>{months.map((m, i) => <th key={m} style={hc} colSpan={3}>{m}{i === 2 ? " (예정)" : ""}</th>)}</tr>
            <tr><th style={hc}></th>{months.map(m => <React.Fragment key={m}><th style={hc}>보증금</th><th style={hc}>임대료</th><th style={hc}>객실수</th></React.Fragment>)}</tr>
          </thead>
          <tbody>
            {revRows.map(row => (
              <tr key={row.key} style={{ background: row.bold ? "#f0f0f0" : "" }}>
                <td style={rcc(row.bold ? "#eee" : null, row.bold)}>{row.label}</td>
                {months.map((month, mi) => {
                  const d = gRevWithList(month, row.key);
                  const pd = mi > 0 ? gRevWithList(months[mi - 1], row.key) : null;
                  const hasPrev = mi > 0;
                  const sR = rc(row.bold ? "#eee" : null, row.bold);
                  const sC = rcc(row.bold ? "#eee" : null, row.bold);
                  return (
                    <React.Fragment key={month}>
                      <td {...ptMonthCellProps(sR, d.d, pd?.d ?? 0, "money", hasPrev)}>{d.d ? fN(d.d) : "-"}</td>
                      <td {...ptMonthCellProps(sR, d.r, pd?.r ?? 0, "money", hasPrev)}>{d.r ? fN(d.r) : "-"}</td>
                      <td {...ptMonthCellProps(sC, d.rm, pd?.rm ?? 0, "rooms", hasPrev)}>{d.rm || "-"}</td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <b style={{ fontSize: 13, display: "block", margin: "10px 0 6px" }}>○ 입주예정 객실</b>
        <table className="report-movein" style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", marginBottom: 16 }}>
          <colgroup>
            <col style={{ width: "5%" }} />
            <col style={{ width: "31.67%" }} />
            <col style={{ width: "31.67%" }} />
            <col style={{ width: "31.66%" }} />
          </colgroup>
          <thead><tr><th style={hc}>구분</th><th style={hc}>입주 (확정)</th><th style={hc}>예정 (구두약속)</th><th style={hc}>비고</th></tr></thead>
          <tbody>{Object.entries(mG).map(([m, items]) => (
            <tr key={m}>
              <td style={{ ...rcc(null, true), wordBreak: "break-word", whiteSpace: "normal", verticalAlign: "top" }}>{m}</td>
              <td style={{ ...rc(), wordBreak: "break-word", whiteSpace: "normal", verticalAlign: "top" }}>{items.filter(c => c.status === "확정").map(c => c.company + "(" + c.rooms + "실)").join(", ") || "-"}</td>
              <td style={{ ...rc(), wordBreak: "break-word", whiteSpace: "normal", verticalAlign: "top" }}>{items.filter(c => c.status === "예정").map(c => c.company + "(" + c.rooms + "실)").join(", ") || "-"}</td>
              <td style={{ ...rc(), wordBreak: "break-word", whiteSpace: "normal", verticalAlign: "top" }}>-</td>
            </tr>
          ))}</tbody>
        </table>
    </>
  );

  const sheetBaseStyle = { background: "#fff", padding: "20px 24px", fontFamily: "'맑은 고딕',sans-serif", lineHeight: "1.4", color: "#000", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" };
  const sheetPtStyle = { ...sheetBaseStyle, padding: "26px 34px", fontSize: 15, width: "min(1180px, 92vw)", boxSizing: "border-box", boxShadow: "0 8px 48px rgba(0,0,0,.35)", zoom: 1.2 };

  return (
    <div>
      <style>{`
        @media screen {
          .rp { max-width: min(1100px, 100%); margin: 20px auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box; }
          .report-page-row.rp { display: flex; flex-direction: row; align-items: flex-start; gap: 14px; }
        }
        @media print {
          .no-print { display: none !important; }
          @page {
            size: A4 landscape;
            margin: 6mm 12mm;
          }
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .report-sheet, .report-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .report-sheet {
            max-width: none !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-sizing: border-box !important;
            background: #fff !important;
            zoom: 1 !important;
          }
          .report-sheet h1 {
            font-size: 14pt !important;
            margin: 0 0 4pt !important;
            letter-spacing: 1px !important;
            line-height: 1.2 !important;
          }
          .report-sheet .report-head-row {
            margin-bottom: 3pt !important;
          }
          .report-sheet > b {
            font-size: 10pt !important;
            margin: 5pt 0 3pt !important;
            display: block !important;
          }
          .report-sheet table {
            width: 100% !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
            font-size: 8pt !important;
            margin-bottom: 4pt !important;
          }
          .report-sheet table.report-movein {
            margin-bottom: 2pt !important;
          }
          .report-sheet th,
          .report-sheet td {
            padding: 5px 5px !important;
            vertical-align: middle !important;
            line-height: 1.38 !important;
          }
          .report-sheet th {
            white-space: normal !important;
            word-break: keep-all !important;
            overflow-wrap: break-word !important;
          }
          .report-sheet td {
            white-space: nowrap !important;
          }
          .report-sheet .report-movein th,
          .report-sheet .report-movein td {
            white-space: normal !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            vertical-align: top !important;
            font-size: 8pt !important;
            line-height: 1.38 !important;
            padding: 5px 5px !important;
          }
          .report-sheet p {
            font-size: 8pt !important;
            margin: 3pt 0 4pt !important;
          }
        }
        .report-tv-pt h1 { font-size: clamp(22px, 2.75vw, 32px) !important; margin-bottom: 14px !important; }
        .report-tv-pt .report-head-row b { font-size: clamp(15px, 1.75vw, 20px) !important; }
        .report-tv-pt .report-head-row span { font-size: clamp(12px, 1.35vw, 16px) !important; }
        .report-tv-pt th, .report-tv-pt td { font-size: clamp(12px, 1.25vw, 15px) !important; padding: 8px 9px !important; }
        .report-tv-pt table.report-table-main th,
        .report-tv-pt table.report-table-main td,
        .report-tv-pt table.report-table-rev th,
        .report-tv-pt table.report-table-rev td {
          white-space: normal !important;
          overflow-wrap: anywhere;
          word-break: keep-all;
          vertical-align: middle !important;
        }
        .report-tv-pt p { font-size: clamp(12px, 1.2vw, 15px) !important; }
        .report-tv-pt b { font-size: clamp(14px, 1.55vw, 18px) !important; }
      `}</style>
      {!ptMode ? (
        <div className="rp report-page-row">
          <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, width: 118, position: "sticky", top: 12, alignSelf: "flex-start" }}>
            <button
              type="button"
              onClick={() => setPtMode(true)}
              style={{ background: "#0f172a", color: "#fff", border: "none", padding: "9px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 800, width: "100%", boxSizing: "border-box" }}
            >
              📺 PT
            </button>
            <button type="button" onClick={() => window.print()} style={{ background: "#3b82f6", color: "#fff", border: "none", padding: "9px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, width: "100%", boxSizing: "border-box" }}>🖨️ 인쇄</button>
          </div>
          <div ref={sheetRef} className="report-sheet" style={{ ...sheetBaseStyle, flex: 1, minWidth: 0 }}>{reportInner}</div>
        </div>
      ) : (
        <div
          ref={ptShellRef}
          onMouseMove={onPtShellPointer}
          onMouseLeave={() => setPtEdgeZone(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "linear-gradient(180deg,#0f172a 0%,#020617 100%)",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <div style={{ position: "absolute", inset: 0, zIndex: 0, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center" }}>
            <div
              className="pt-slide-track"
              style={{
                display: "flex",
                flexDirection: "row",
                width: "200%",
                height: "100%",
                minHeight: 0,
                transform: ptSlideIndex === 0 ? "translateX(0)" : "translateX(-50%)",
                transition: "transform 0.38s cubic-bezier(0.25, 0.82, 0.2, 1)",
                willChange: "transform",
              }}
            >
              <div className="pt-slide-page" style={{ width: "50%", height: "100%", flexShrink: 0, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", boxSizing: "border-box", padding: "0 12px" }}>
                <div ref={ptWrapRef} style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
                  <div ref={sheetRef} className="rp report-sheet report-tv-pt" style={sheetPtStyle}>{reportInner}</div>
                  <canvas
                    className="no-print"
                    ref={hlBaseRef}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      pointerEvents: "none",
                      touchAction: "none",
                      zIndex: 2,
                    }}
                  />
                  <canvas
                    className="no-print"
                    ref={hlOverlayRef}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      pointerEvents: "none",
                      touchAction: "none",
                      zIndex: 3,
                    }}
                  />
                </div>
              </div>
              <div className="pt-slide-page" style={{ width: "50%", height: "100%", flexShrink: 0, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", boxSizing: "border-box", padding: "0 12px" }}>
                <div ref={ptWrapAdditionalRef} style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
                  <div className="rp report-tv-pt" style={{ ...sheetPtStyle, boxShadow: "0 8px 48px rgba(0,0,0,.35)" }}>
                    <style>{RICH_PROSE_CSS}</style>
                    <h2 style={{ textAlign: "center", fontSize: 22, fontWeight: 800, marginTop: 0, marginBottom: 8, letterSpacing: 1, color: "#0f172a" }}>추가 보고</h2>
                    <p style={{ textAlign: "center", fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>
                      {formatKoMonthWeekLabel(getWeekStr(data.reportDate)) || getWeekStr(data.reportDate) || "기준일 주차"}
                    </p>
                    {ptAdditionalBlocks.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 15, color: "#64748b", textAlign: "center", padding: "32px 12px" }}>이 주차에 저장된 추가 보고 내용이 없습니다.</p>
                    ) : (
                      ptAdditionalBlocks.map((p, i) => (
                        <div
                          key={p.id || `pt-ar-${i}`}
                          style={{
                            background: "#fafafa",
                            borderRadius: 12,
                            border: "1px solid #e2e8f0",
                            padding: "14px 16px",
                            marginBottom: 12,
                          }}
                        >
                          <div className="ar-rich-body ar-rich-prose" dangerouslySetInnerHTML={{ __html: p.html || "" }} />
                        </div>
                      ))
                    )}
                  </div>
                  <canvas
                    className="no-print"
                    ref={hlBaseAdditionalRef}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      pointerEvents: "none",
                      touchAction: "none",
                      zIndex: 2,
                    }}
                  />
                  <canvas
                    className="no-print"
                    ref={hlOverlayAdditionalRef}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      pointerEvents: "none",
                      touchAction: "none",
                      zIndex: 3,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div
            className="no-print"
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 60,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              width: "min(76px, 12vw)",
              ...ptCtrlFade(ptEdgeZone === "left"),
            }}
          >
            {ptSlideIndex === 1 ? (
              <button
                type="button"
                className="pt-pt-nav"
                aria-label="이전: 보고서"
                onClick={() => setPtSlideIndex(0)}
                style={{
                  borderRadius: 14,
                  border: "2px solid rgba(148,163,184,0.45)",
                  background: "rgba(15,23,42,0.88)",
                  color: "#f8fafc",
                  fontSize: 28,
                  fontWeight: 200,
                  cursor: "pointer",
                  minHeight: 120,
                  width: "100%",
                  padding: 0,
                  boxShadow: "0 4px 20px rgba(0,0,0,.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                }}
              >
                {"<"}
              </button>
            ) : null}
            <button type="button" className="pt-pt-nav" onClick={exitPt} style={{ background: "#334155", color: "#fff", border: "none", padding: "18px 4px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 800, width: "100%", boxSizing: "border-box", minHeight: 88, lineHeight: 1.25, whiteSpace: "normal", wordBreak: "keep-all" }}>
              닫기 (Esc)
            </button>
            <button type="button" className="pt-pt-nav" onClick={clearHighlighter} style={{ background: "#38bdf8", color: "#0f172a", border: "none", padding: "18px 4px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 800, width: "100%", boxSizing: "border-box", minHeight: 88, lineHeight: 1.25, whiteSpace: "normal", wordBreak: "keep-all" }}>
              형광 지우기
            </button>
          </div>
          {ptSlideIndex === 0 ? (
            <div
              className="no-print"
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 60,
                ...ptCtrlFade(ptEdgeZone === "right"),
              }}
            >
              <button
                type="button"
                className="pt-pt-nav"
                aria-label="다음: 추가 보고"
                onClick={() => setPtSlideIndex(1)}
                style={{
                  width: 52,
                  minHeight: 140,
                  borderRadius: 14,
                  border: "2px solid rgba(148,163,184,0.45)",
                  background: "rgba(15,23,42,0.88)",
                  color: "#f8fafc",
                  fontSize: 30,
                  fontWeight: 200,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                  padding: 0,
                  boxShadow: "0 4px 24px rgba(0,0,0,.35)",
                }}
              >
                {">"}
              </button>
            </div>
          ) : null}
          {ptHover ? (
            <div
              className="no-print"
              style={{
                position: "fixed",
                left: ptHover.x,
                top: ptHover.y - 4,
                transform: "translate(-50%, -100%)",
                zIndex: 100050,
                pointerEvents: "none",
              }}
            >
              {ptHover.node}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const TH = { padding: "7px 9px", textAlign: "center", fontWeight: 700, fontSize: 12, borderBottom: "2px solid #d1d5db", whiteSpace: "nowrap" };
const THS = { ...TH, fontSize: 11, borderBottom: "1px solid #d1d5db", padding: "5px 6px" };
const TD = { padding: "7px 9px", whiteSpace: "nowrap" };
const BTN = { padding: "4px 10px", border: "none", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#3b82f6", color: "#fff" };
const INP = { padding: "6px 9px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, outline: "none", boxSizing: "border-box" };
const CHIP = { padding: "6px 13px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
