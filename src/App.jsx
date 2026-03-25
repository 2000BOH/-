import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";

const STORAGE_KEY = "jangbak-v8";

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

function sumRoom(r) { let s = 0; FKEYS.forEach(k => { s += (r[k] || 0); }); return s; }
function longStay(r) { return (r.inspire || 0) + (r.sharp || 0) + (r.etcCorp || 0) + (r.personal || 0); }
function fK(n) { if (!n) return "0"; if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + "억"; if (Math.abs(n) >= 1e7) return Math.round(n / 1e4).toLocaleString() + "만"; return n.toLocaleString(); }
function fN(n) { return (n || 0).toLocaleString(); }
function getWeekStr(ds) { if (!ds) return ""; const d = new Date(ds), j = new Date(d.getFullYear(), 0, 1), days = Math.floor((d - j) / 864e5), w = Math.ceil((days + j.getDay() + 1) / 7); return d.getFullYear() + "-W" + String(w).padStart(2, "0"); }
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
  notes: "악성보수객실 임대료 30만원 안내 실시", reportDate: "2026-03-24"
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
  useEffect(() => { (async () => { try { const r = await window.storage.get(STORAGE_KEY); if (r && r.value) setData({ ...initData, ...JSON.parse(r.value) }); else throw 0; } catch (e) { try { await window.storage.set(STORAGE_KEY, JSON.stringify(initData)); } catch (e2) {} setData(initData); } })(); }, []);
  const save = useCallback(async d => { setData(d); try { await window.storage.set(STORAGE_KEY, JSON.stringify(d)); } catch (e) {} }, []);
  if (!data) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>로딩 중...</div>;
  if (tab === "report") return <ReportView data={data} goBack={() => setTab("dashboard")} />;

  const tabs = [{ key: "dashboard", label: "대시보드", icon: "📊" }, { key: "rooms", label: "객실현황", icon: "🏨" }, { key: "contracts", label: "계약관리", icon: "📝" }, { key: "report", label: "보고서", icon: "📄" }];
  return (
    <div style={{ fontFamily: "'Pretendard Variable','Apple SD Gothic Neo','Malgun Gothic',sans-serif", background: "#f1f5f9", minHeight: "100vh", color: "#0f172a" }}>
      <header style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", color: "#fff", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🏢</div><div><div style={{ fontSize: 16, fontWeight: 800 }}>장기 숙박 유치 현황</div><div style={{ fontSize: 11, opacity: .55 }}>위탁운영 객실 관리 시스템</div></div></div>
        <div style={{ fontSize: 12, opacity: .6 }}>기준 '{data.reportDate}</div>
      </header>
      <nav style={{ padding: "10px 24px 0", display: "flex", gap: 3, background: "#f1f5f9", overflowX: "auto", position: "sticky", top: 64, zIndex: 99 }}>
        {tabs.map(t => <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "9px 18px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: tab === t.key ? "#fff" : "transparent", color: tab === t.key ? "#0f172a" : "#64748b", borderBottom: tab === t.key ? "2px solid #3b82f6" : "2px solid transparent", whiteSpace: "nowrap" }}><span style={{ marginRight: 5 }}>{t.icon}</span>{t.label}</button>)}
      </nav>
      <main style={{ padding: "16px 24px 40px", maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          {tab === "dashboard" && <Dashboard data={data} />}
          {tab === "rooms" && <RoomStatus data={data} onSave={save} />}
          {tab === "contracts" && <ContractMgr data={data} onSave={save} />}
        </div>
      </main>
    </div>
  );
}

function Dashboard({ data }) {
  const { rooms, contracts } = data;
  const rT = useMemo(() => { const t = { total: 0, ins: 0, corp: 0, personal: 0, hotel: 0, dorm: 0, avail: 0, bad: 0 }; Object.values(rooms).forEach(r => { t.ins += r.inspire || 0; t.corp += (r.sharp || 0) + (r.etcCorp || 0); t.personal += r.personal || 0; t.hotel += r.hotel || 0; t.dorm += (r.dormAsset || 0) + (r.dormGroup || 0); t.avail += (r.empty || 0) + (r.moveIn || 0) + (r.repair || 0); t.bad += r.badRepair || 0; }); t.total = t.ins + t.corp + t.personal + t.hotel + t.dorm + t.avail + t.bad; return t; }, [rooms]);
  const ms = useMemo(() => { const r = {}; contracts.filter(c => c.visible).forEach(c => { if (!r[c.month]) r[c.month] = { dep: 0, rent: 0, rooms: 0, miR: 0 }; const m = r[c.month]; if (c.type !== "퇴실") { m.dep += c.deposit; m.rent += c.rent; m.rooms += c.rooms; } if (c.type === "입주") m.miR += c.rooms; }); return r; }, [contracts]);
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {[{ l: `이번 달 임대료(${mCurKey})`, v: fK(mCurData.rent), s: "보증금 " + fK(mCurData.dep), bg: "linear-gradient(135deg,#3b82f6,#1d4ed8)", ic: "💰" }, { l: `다음 달 예상(${mNextKey})`, v: fK(mNextData.rent), s: "신규 " + mNextData.miR + "실", bg: "linear-gradient(135deg,#22c55e,#15803d)", ic: "📈" }, { l: "전체 입실률", v: occ + "%", s: fN(rT.total - rT.avail - rT.bad) + "/" + fN(rT.total), bg: "linear-gradient(135deg,#8b5cf6,#6d28d9)", ic: "🏠" }, { l: "이번 주 확정", v: tw.reduce((s, c) => s + c.rooms, 0) + "실", s: tw.length + "건", bg: "linear-gradient(135deg,#f59e0b,#d97706)", ic: "🔑" }].map((k, i) => (
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, flex: 1, alignContent: "start" }}>
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
          </div>
        </div>
      </div>
    </div>
  );
}

function RoomStatus({ data, onSave }) {
  const { rooms } = data;
  const [ed, setEd] = useState(null); const [ev, setEv] = useState({}); const [sp, setSp] = useState(false); const [pt, setPt] = useState(""); const [pm, setPm] = useState("");
  const tot = {}; FKEYS.forEach(k => { tot[k] = Object.values(rooms).reduce((s, r) => s + (r[k] || 0), 0); });
  const handlePaste = () => {
    const lines = pt.trim().split("\n");
    const nr = { ...rooms };
    const ch = ["1차", "2차", "3차", "4차"];
    const paste10 = ["inspire", "sharp", "etcCorp", "personal", "hotel", "dormAsset", "empty", "moveIn", "repair", "badRepair"];
    let ap = 0;
    lines.forEach((l, i) => {
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
    if (ap > 0) { onSave({ ...data, rooms: nr }); setPm(ap + "개 적용 완료"); setPt(""); setTimeout(() => { setPm(""); setSp(false); }, 1500); } else setPm("형식 오류");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 17, fontWeight: 800 }}>○ 위탁운영 객실현황</h2>
        <button onClick={() => setSp(!sp)} style={{ padding: "7px 18px", background: sp ? "#e2e8f0" : "linear-gradient(135deg,#8b5cf6,#6d28d9)", color: sp ? "#475569" : "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{sp ? "닫기" : "📋 붙여넣기"}</button>
      </div>
      {sp && <Card style={{ background: "#faf5ff", border: "2px solid #8b5cf6", padding: 14 }}>
        <p style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>1차~4차 데이터 (인스,샤프,기타,개인,호텔,기숙사(자산),공실,입실,보수,악성) — 10칸, 또는 예전 형식 11칸(계열 포함)도 가능</p>
        <textarea value={pt} onChange={e => setPt(e.target.value)} placeholder="241&#9;5&#9;3&#9;9&#9;26&#9;0&#9;2&#9;1&#9;5&#9;1" style={{ width: "100%", height: 70, padding: 8, border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
        {pm && <div style={{ marginTop: 4, fontSize: 12, color: pm.includes("완료") ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{pm}</div>}
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}><button onClick={handlePaste} style={{ padding: "6px 20px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>적용</button><button onClick={() => { setPt(""); setSp(false); setPm(""); }} style={{ padding: "6px 20px", background: "#e2e8f0", color: "#475569", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>취소</button></div>
      </Card>}
      <Card style={{ padding: 0, overflowX: "auto", flex: 1 }}>
        <table style={{ width: "100%", minWidth: 920, tableLayout: "fixed", borderCollapse: "collapse", background: "#fff" }}>
          <colgroup>
            <col style={{ width: "4.5%" }} /><col style={{ width: "5.5%" }} />
            <col style={{ width: "6.2%" }} /><col style={{ width: "6.2%" }} /><col style={{ width: "6.2%" }} /><col style={{ width: "6.2%" }} />
            <col style={{ width: "5%" }} /><col style={{ width: "5%" }} />
            <col style={{ width: "5.5%" }} /><col style={{ width: "5.5%" }} /><col style={{ width: "5.5%" }} />
            <col style={{ width: "4.5%" }} /><col style={{ width: "7.5%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={RTH()} rowSpan={2}>차수</th>
              <th style={RTH()} rowSpan={2}>합계</th>
              <th style={RTH({ background: "#dbeafe", color: "#1e3a5f" })} colSpan={4}>장기숙박</th>
              <th style={RTH()} rowSpan={2}>호텔</th>
              <th style={RTH()} rowSpan={2}>기숙사(자산)</th>
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
            {Object.entries(rooms).map(([cha, r], ri) => {
              const isE = ed === cha;
              return (<tr key={cha} style={{ background: isE ? "#eff6ff" : ri % 2 === 1 ? "#fafafa" : "#fff" }}>
                <td style={{ ...RTD({ textAlign: "center", fontWeight: 800 }) }}>{cha}</td>
                <td style={{ ...RTD({ textAlign: "right", fontWeight: 700, background: "#f8fafc" }) }}>{fN(sumRoom(r))}</td>
                {isE ? <>{ROOM_TABLE_FIELDS.map(f => <td key={f.k} style={RTD()}><input type="number" value={ev[f.k] ?? 0} onChange={e => setEv({ ...ev, [f.k]: parseInt(e.target.value, 10) || 0 })} style={{ width: "100%", maxWidth: 56, boxSizing: "border-box", padding: "4px 6px", border: "2px solid #3b82f6", borderRadius: 6, fontSize: 14, textAlign: "right" }} /></td>)}<td style={RTD()}><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}><button type="button" onClick={() => { onSave({ ...data, rooms: { ...rooms, [ed]: { ...ev, dormGroup: rooms[ed]?.dormGroup || 0 } } }); setEd(null); }} style={BTN}>저장</button><button type="button" onClick={() => setEd(null)} style={{ ...BTN, background: "#e2e8f0", color: "#475569" }}>취소</button></div></td></> :
                  <>{ROOM_TABLE_FIELDS.map(f => <td key={f.k} style={{ ...RTD({ textAlign: "right", color: f.k === "badRepair" && r[f.k] > 0 ? "#dc2626" : "#0f172a" }) }}>{fN(r[f.k])}</td>)}<td style={RTD({ textAlign: "center" })}><button type="button" onClick={() => { setEd(cha); setEv({ ...r }); }} style={{ ...BTN, background: "#eff6ff", color: "#2563eb" }}>수정</button></td></>}
              </tr>);
            })}
            <tr style={{ background: "#f1f5f9" }}>
              <td style={{ ...RTD({ textAlign: "center", fontWeight: 800 }) }}>합계</td>
              <td style={{ ...RTD({ textAlign: "right", fontWeight: 800, color: "#dc2626" }) }}>{fN(Object.values(rooms).reduce((s, r) => s + sumRoom(r), 0))}</td>
              {ROOM_TABLE_FIELDS.map(f => <td key={f.k} style={{ ...RTD({ textAlign: "right", fontWeight: 700 }) }}>{fN(tot[f.k])}</td>)}
              <td style={RTD()} />
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ContractMgr({ data, onSave }) {
  const [fw, setFw] = useState("전체"); const [eid, setEid] = useState(null); const [ef, setEf] = useState({});
  const [form, setForm] = useState({ type: "입주", moveDate: "", company: "", deposit: "", rent: "", rooms: "" });
  const [sp, setSp] = useState(false); const [pt, setPt] = useState(""); const [pm, setPm] = useState("");
  const weekPickRef = useRef(null);

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

  const quickAdd = () => { if (!form.company || !form.rooms) return; const d = form.moveDate ? new Date(form.moveDate) : null; const month = d && !isNaN(d.getTime()) ? (d.getMonth() + 1) + "월" : "3월"; const week = form.moveDate ? getWeekStr(form.moveDate) : ""; onSave({ ...data, contracts: [...data.contracts, { id: Date.now(), month, type: form.type, moveDate: form.moveDate, company: form.company, deposit: parseInt(form.deposit) || 0, rent: parseInt(form.rent) || 0, rooms: parseInt(form.rooms) || 0, status: "확정", visible: true, week }] }); setForm({ type: "입주", moveDate: "", company: "", deposit: "", rent: "", rooms: "" }); };

  const handlePaste = () => { const lines = pt.trim().split("\n"); const ni = []; lines.forEach(l => { const v = l.split(/\t/).map(x => x.trim()); if (v.length >= 6) { const d = v[1] ? new Date(v[1]) : null; const month = d && !isNaN(d.getTime()) ? (d.getMonth() + 1) + "월" : "3월"; ni.push({ id: Date.now() + Math.random(), month, type: v[0] || "입주", moveDate: v[1] || "", company: v[2] || "", deposit: parseInt(v[3]) || 0, rent: parseInt(v[4]) || 0, rooms: parseInt(v[5]) || 0, status: "확정", visible: true, week: v[1] ? getWeekStr(v[1]) : "" }); } }); if (ni.length > 0) { onSave({ ...data, contracts: [...data.contracts, ...ni] }); setPm(ni.length + "건 완료"); setPt(""); setTimeout(() => { setPm(""); setSp(false); }, 1500); } else setPm("형식: 구분(탭)입주일(탭)업체(탭)보증금(탭)임대료(탭)객실수"); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800 }}>○ 계약관리 (주간 뷰)</h2>
        <button onClick={() => setSp(!sp)} style={{ padding: "7px 18px", background: sp ? "#e2e8f0" : "linear-gradient(135deg,#8b5cf6,#6d28d9)", color: sp ? "#475569" : "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{sp ? "닫기" : "📋 붙여넣기"}</button>
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
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}><button onClick={handlePaste} style={{ padding: "6px 20px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>적용</button><button onClick={() => { setPt(""); setSp(false); setPm(""); }} style={{ padding: "6px 20px", background: "#e2e8f0", color: "#475569", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>취소</button></div>
      </Card>}
      <div style={{ position: "relative", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={() => setFw("전체")} style={{ ...CHIP, background: fw === "전체" ? "#3b82f6" : "#fff", color: fw === "전체" ? "#fff" : "#0f172a" }}>전체</button>
        {quickWeeks.map(w => <button type="button" key={w} onClick={() => setFw(fw === w ? "전체" : w)} style={{ ...CHIP, background: fw === w ? "#3b82f6" : "#fff", color: fw === w ? "#fff" : "#0f172a" }}>{formatKoMonthWeekLabel(w)}</button>)}
        <input ref={weekPickRef} type="date" tabIndex={-1} style={{ position: "absolute", left: "-9999px", opacity: 0, width: 1, height: 1 }} onChange={e => { const v = e.target.value; if (v) { setFw(getWeekStr(v)); e.target.value = ""; } }} />
        <button type="button" onClick={() => { const el = weekPickRef.current; if (!el) return; if (typeof el.showPicker === "function") { try { el.showPicker(); } catch { el.click(); } } else el.click(); }} style={{ ...CHIP, background: "#f1f5f9", border: "1px dashed #94a3b8", color: "#334155" }}>📅 날짜로 주 선택</button>
      </div>
      <Card style={{ padding: 0, overflowX: "auto", flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#fffbeb" }}>{["주차", "월", "구분", "업체/개인", "보증금", "임대료", "객실수", "입주일", "상태", "표시", "액션"].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
          <tbody>{filtered.map(c => {
            if (eid === c.id) return (<tr key={c.id} style={{ background: "#eff6ff", borderBottom: "1px solid #e2e8f0" }}><td style={TD}>{formatKoMonthWeekLabel(c.week)}</td><td style={TD}>{ef.month}</td><td style={TD}><select value={ef.type} onChange={e => setEf({ ...ef, type: e.target.value })} style={{ ...INP, width: 56 }}><option>입주</option><option>퇴실</option><option>예정</option><option>기존</option></select></td><td style={TD}><input value={ef.company} onChange={e => setEf({ ...ef, company: e.target.value })} style={{ ...INP, width: 110 }} /></td><td style={TD}><input type="number" value={ef.deposit} onChange={e => setEf({ ...ef, deposit: parseInt(e.target.value) || 0 })} style={{ ...INP, width: 90 }} /></td><td style={TD}><input type="number" value={ef.rent} onChange={e => setEf({ ...ef, rent: parseInt(e.target.value) || 0 })} style={{ ...INP, width: 90 }} /></td><td style={TD}><input type="number" value={ef.rooms} onChange={e => setEf({ ...ef, rooms: parseInt(e.target.value) || 0 })} style={{ ...INP, width: 44 }} /></td><td style={TD}><input type="date" value={ef.moveDate} onChange={e => setEf({ ...ef, moveDate: e.target.value })} style={{ ...INP, width: 120 }} /></td><td style={TD}><select value={ef.status} onChange={e => setEf({ ...ef, status: e.target.value })} style={{ ...INP, width: 56 }}><option>확정</option><option>예정</option></select></td><td></td><td style={TD}><div style={{ display: "flex", gap: 2 }}><button onClick={() => { onSave({ ...data, contracts: data.contracts.map(x => x.id === eid ? { ...ef } : x) }); setEid(null); }} style={BTN}>저장</button><button onClick={() => setEid(null)} style={{ ...BTN, background: "#e2e8f0", color: "#475569" }}>취소</button></div></td></tr>);
            return (<tr key={c.id} style={{ borderBottom: "1px solid #e2e8f0", opacity: c.visible ? 1 : .4, background: c.type === "퇴실" ? "#fef2f2" : "" }}><td style={{ ...TD, fontSize: 12, color: "#64748b" }}>{formatKoMonthWeekLabel(c.week)}</td><td style={{ ...TD, fontWeight: 600 }}>{c.month}</td><td style={TD}><Badge color={c.type === "입주" ? "green" : c.type === "퇴실" ? "red" : c.type === "예정" ? "amber" : "blue"}>{c.type}</Badge></td><td style={{ ...TD, fontWeight: 500 }}>{c.company}</td><td style={{ ...TD, textAlign: "right" }}>{fK(c.deposit)}</td><td style={{ ...TD, textAlign: "right" }}>{fK(c.rent)}</td><td style={{ ...TD, textAlign: "center", fontWeight: 700, color: "#2563eb" }}>{c.rooms}</td><td style={{ ...TD, fontSize: 10 }}>{c.moveDate}</td><td style={TD}><Badge color={c.status === "확정" ? "green" : "amber"}>{c.status}</Badge></td><td style={TD}><button onClick={() => onSave({ ...data, contracts: data.contracts.map(x => x.id === c.id ? { ...x, visible: !x.visible } : x) })} style={{ ...BTN, background: c.visible ? "#dcfce7" : "#fee2e2", color: c.visible ? "#16a34a" : "#dc2626", fontSize: 9 }}>{c.visible ? "표시" : "숨김"}</button></td><td style={TD}><div style={{ display: "flex", gap: 2 }}><button onClick={() => { setEid(c.id); setEf({ ...c }); }} style={{ ...BTN, background: "#eff6ff", color: "#2563eb" }}>수정</button><button onClick={() => onSave({ ...data, contracts: data.contracts.filter(x => x.id !== c.id) })} style={{ ...BTN, background: "#fef2f2", color: "#dc2626" }}>삭제</button></div></td></tr>);
          })}</tbody>
        </table>
      </Card>
    </div>
  );
}

function ReportView({ data, goBack }) {
  const sheetRef = useRef(null);
  const { rooms, contracts, daewon, prevRooms, notes, reportDate } = data;
  const dw = daewon || initData.daewon;
  const prev = prevRooms || initData.prevRooms;
  const tot = {}; FKEYS.forEach(k => { tot[k] = Object.values(rooms).reduce((s, r) => s + (r[k] || 0), 0); });
  const pTot = {}; FKEYS.forEach(k => { pTot[k] = Object.values(prev).reduce((s, r) => s + (r[k] || 0), 0); });
  const totalS = Object.values(rooms).reduce((s, r) => s + sumRoom(r), 0);
  const pTotalS = Object.values(prev).reduce((s, r) => s + sumRoom(r), 0);

  const ms = {}; contracts.filter(c => c.visible).forEach(c => { if (!ms[c.month]) ms[c.month] = { dep: 0, rent: 0, rooms: 0, miD: 0, miR: 0, miRm: 0, exD: 0, exR: 0, exRm: 0, outD: 0, outR: 0, outRm: 0 }; const m = ms[c.month]; if (c.type === "기존") { m.dep += c.deposit; m.rent += c.rent; m.rooms += c.rooms; } else if (c.type === "입주") { m.miD += c.deposit; m.miR += c.rent; m.miRm += c.rooms; } else if (c.type === "예정") { m.exD += c.deposit; m.exR += c.rent; m.exRm += c.rooms; } else if (c.type === "퇴실") { m.outD += c.deposit; m.outR += c.rent; m.outRm += c.rooms; } });

  function gRev(month, key) { const m = ms[month] || { dep: 0, rent: 0, rooms: 0, miD: 0, miR: 0, miRm: 0, exD: 0, exR: 0, exRm: 0, outD: 0, outR: 0, outRm: 0 }; if (key === "total") return { d: m.dep + m.miD + m.exD, r: m.rent + m.miR + m.exR, rm: m.rooms + m.miRm + m.exRm }; if (key === "ins") return { d: m.dep, r: m.rent, rm: m.rooms }; if (key === "mi") return { d: m.miD, r: m.miR, rm: m.miRm }; if (key === "ex") return { d: m.exD, r: m.exR, rm: m.exRm }; if (key === "out") return { d: m.outD, r: m.outR, rm: m.outRm }; return { d: 0, r: 0, rm: 0 }; }

  const moveIns = contracts.filter(c => c.visible && (c.type === "입주" || c.type === "예정"));
  const mG = {}; moveIns.forEach(c => { if (!mG[c.month]) mG[c.month] = []; mG[c.month].push(c); });
  const months = ["2월", "3월", "4월"];
  const revRows = [{ label: "합 계", key: "total", bold: true }, { label: "인스파이어", key: "ins" }, { label: "신규입주", key: "mi" }, { label: "예 정", key: "ex" }, { label: "퇴 실", key: "out" }];

  const hc = { padding: "9px 10px", border: "1px solid #888", textAlign: "center", fontSize: 12, fontWeight: 700, background: "#fffff0", whiteSpace: "nowrap", lineHeight: "1.35" };
  const rc = (bg, bold, color) => ({ padding: "8px 10px", border: "1px solid #aaa", textAlign: "right", fontSize: "12px", background: bg || "#fff", fontWeight: bold ? 700 : 400, color: color || "#000", whiteSpace: "nowrap", lineHeight: "1.4" });
  const rcc = (bg, bold) => ({ ...rc(bg, bold), textAlign: "center" });
  const drc = (color) => ({ padding: "6px 8px", border: "1px solid #ccc", textAlign: "right", fontSize: 10, background: "#fafafa", fontWeight: 600, lineHeight: "1.35", whiteSpace: "nowrap", color: color || "#888" });

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

  return (
    <div>
      <style>{`
        @media screen {
          .rp { max-width: min(1100px, 100%); margin: 20px auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box; }
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
          .report-sheet p:not(.report-foot) {
            font-size: 8pt !important;
            margin: 3pt 0 4pt !important;
          }
          .report-sheet .report-foot {
            font-size: 7.5pt !important;
            padding-top: 4pt !important;
            margin-top: 2pt !important;
          }
        }
      `}</style>
      <div className="no-print" style={{ background: "#1e293b", padding: "10px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
        <button onClick={goBack} style={{ background: "none", border: "1px solid #475569", color: "#fff", padding: "6px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← 돌아가기</button>
        <button onClick={() => window.print()} style={{ background: "#3b82f6", color: "#fff", border: "none", padding: "8px 24px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>🖨️ 인쇄</button>
      </div>
      <div ref={sheetRef} className="rp report-sheet" style={{ background: "#fff", padding: "20px 24px", fontFamily: "'맑은 고딕',sans-serif", lineHeight: "1.4", color: "#000", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
        <h1 style={{ textAlign: "center", fontSize: 20, fontWeight: 800, marginTop: 0, marginBottom: 10, letterSpacing: 2 }}>장기 숙박 유치 현황</h1>

        <div className="report-head-row" style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><b style={{ fontSize: 13 }}>○ 위탁운영 객실현황</b><span style={{ fontSize: 10, color: "#666" }}>기준 : {reportDate}</span></div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 2 }}>
          <thead>
            <tr><th style={hc} rowSpan={2}>차수</th><th style={hc} rowSpan={2}>합계</th><th style={{ ...hc, background: "#e8f0fe" }} colSpan={5}>장기숙박</th><th style={hc} rowSpan={2}>호텔</th><th style={hc} rowSpan={2}>기숙사(자산)</th><th style={{ ...hc, background: "#e6f4ea" }} colSpan={3}>공실(판매가능)</th><th style={{ ...hc, background: "#fce8e6" }} rowSpan={2}>판매불가</th></tr>
            <tr><th style={{ ...hc, background: "#e8f0fe" }}>계</th><th style={{ ...hc, background: "#e8f0fe" }}>인스</th><th style={{ ...hc, background: "#e8f0fe" }}>샤프</th><th style={{ ...hc, background: "#e8f0fe" }}>기타</th><th style={{ ...hc, background: "#e8f0fe" }}>개인</th><th style={{ ...hc, background: "#e6f4ea" }}>공실</th><th style={{ ...hc, background: "#e6f4ea" }}>입실</th><th style={{ ...hc, background: "#e6f4ea" }}>보수</th></tr>
          </thead>
          <tbody>
            <tr style={{ background: "#f0f0f0" }}><td style={rcc("#eee", true)}>합계</td><td style={rc("#eee", true, "#c00")}>{fN(totalS)}</td><td style={rc("#e8e8e8", true, "#c00")}>{fN(tot.inspire + tot.sharp + tot.etcCorp + tot.personal)}</td>{["inspire", "sharp", "etcCorp", "personal"].map(k => <td key={k} style={rc("#eee", true)}>{fN(tot[k])}</td>)}<td style={rc("#eee", true)}>{fN(tot.hotel)}</td><td style={rc("#eee", true)}>{fN(tot.dormAsset)}</td><td style={rc("#eee", true)}>{fN(tot.empty)}</td><td style={rc("#eee", true)}>{fN(tot.moveIn)}</td><td style={rc("#eee", true)}>{fN(tot.repair)}</td><td style={rc("#eee", true, "#c00")}>{fN(tot.badRepair)}</td></tr>
            {Object.entries(rooms).map(([cha, r]) => <tr key={cha}><td style={rcc(null, true)}>{cha}</td><td style={rc(null, true)}>{fN(sumRoom(r))}</td><td style={rc("#f5f5f5", true)}>{fN(longStay(r))}</td><td style={rc()}>{fN(r.inspire)}</td><td style={rc()}>{fN(r.sharp)}</td><td style={rc()}>{fN(r.etcCorp)}</td><td style={rc()}>{fN(r.personal)}</td><td style={rc(null, false, "#888")}>{fN(r.hotel)}</td><td style={rc(null, false, "#888")}>{fN(r.dormAsset)}</td><td style={rc()}>{fN(r.empty)}</td><td style={rc()}>{fN(r.moveIn)}</td><td style={rc()}>{fN(r.repair)}</td><td style={rc(null, false, "#c00")}>{fN(r.badRepair)}</td></tr>)}
            <tr style={{ background: "#fafafa" }}><td style={rcc("#f5f5f5", true)}>전주대비</td><td style={drc(diffVal(totalS, pTotalS).c)}>{diffVal(totalS, pTotalS).t}</td><td style={drc(diffVal(longStay(tot), longStay(pTot)).c)}>{diffVal(longStay(tot), longStay(pTot)).t}</td>{ROOM_TABLE_FIELDS.map(f => <td key={f.k} style={drc(diffVal(tot[f.k], pTot[f.k]).c)}>{diffVal(tot[f.k], pTot[f.k]).t}</td>)}</tr>
            <tr><td style={rcc(null, false)}>대원소유분</td><td style={rc(null, true)}>{fN(sumRoom(dw))}</td><td style={rc("#f5f5f5", true)}>{fN(longStay(dw))}</td><td style={rc()}>{fN(dw.inspire)}</td><td style={rc()}>{fN(dw.sharp)}</td><td style={rc()}>{fN(dw.etcCorp)}</td><td style={rc()}>{fN(dw.personal)}</td><td style={rc(null, false, "#888")}>{fN(dw.hotel)}</td><td style={rc(null, false, "#888")}>{fN(dw.dormAsset)}</td><td style={rc()}>{fN(dw.empty)}</td><td style={rc()}>{fN(dw.moveIn)}</td><td style={rc()}>{fN(dw.repair)}</td><td style={rc(null, false, "#c00")}>{fN(dw.badRepair)}</td></tr>
          </tbody>
        </table>
        {notes && <p style={{ fontSize: 10, color: "#555", margin: "6px 0 10px" }}>※ 비고 : {notes}</p>}

        <div className="report-head-row" style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><b style={{ fontSize: 13 }}>○ 장기 숙박 월별 계약 현황 및 예상 임대 수익</b><span style={{ fontSize: 10, color: "#666" }}>단위:원</span></div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 2 }}>
          <thead>
            <tr><th style={hc}>구분</th>{months.map((m, i) => <th key={m} style={hc} colSpan={3}>{m}{i === 2 ? " (예정)" : ""}</th>)}</tr>
            <tr><th style={hc}></th>{months.map(m => <React.Fragment key={m}><th style={hc}>보증금</th><th style={hc}>임대료</th><th style={hc}>객실수</th></React.Fragment>)}</tr>
          </thead>
          <tbody>
            {revRows.map(row => (
              <tr key={row.key} style={{ background: row.bold ? "#f0f0f0" : "" }}>
                <td style={rcc(row.bold ? "#eee" : null, row.bold)}>{row.label}</td>
                {months.map(month => { const d = gRev(month, row.key); return (<React.Fragment key={month}><td style={rc(row.bold ? "#eee" : null, row.bold)}>{d.d ? fN(d.d) : "-"}</td><td style={rc(row.bold ? "#eee" : null, row.bold)}>{d.r ? fN(d.r) : "-"}</td><td style={rcc(row.bold ? "#eee" : null, row.bold)}>{d.rm || "-"}</td></React.Fragment>); })}
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
        <p className="report-foot" style={{ fontSize: 9, color: "#aaa", textAlign: "center", borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8, marginBottom: 0 }}>※ 자동 생성 보고서 | {reportDate}</p>
      </div>
    </div>
  );
}

const TH = { padding: "7px 9px", textAlign: "center", fontWeight: 700, fontSize: 12, borderBottom: "2px solid #d1d5db", whiteSpace: "nowrap" };
const THS = { ...TH, fontSize: 11, borderBottom: "1px solid #d1d5db", padding: "5px 6px" };
const TD = { padding: "7px 9px", whiteSpace: "nowrap" };
const BTN = { padding: "4px 10px", border: "none", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#3b82f6", color: "#fff" };
const INP = { padding: "6px 9px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, outline: "none", boxSizing: "border-box" };
const CHIP = { padding: "6px 13px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
