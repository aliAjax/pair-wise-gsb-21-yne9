import type { Aircraft, AuditEvent, Directive, ExecutionRecord, LedgerState, RecordStatus } from "./types";
import { seedState } from "./seed";

export const STORAGE_KEY = "hxwl07-ad-ledger-v1";

/** 放行人员名册：复核人须从此名册选择，且不得为本次工作的执行人员 */
export const ROSTER = ["王海涛", "李雪梅", "陈立群", "赵鹏飞"];

export const STATUS_LABEL: Record<RecordStatus, string> = {
  monitoring: "监控中",
  due: "待执行",
  "awaiting-review": "待复核",
  "pending-supplement": "待补",
  closed: "已完成",
};

export function directiveKey(number: string, revision: number): string {
  return `${number.trim()}@R${revision}`;
}

export function recordId(dKey: string, msn: string): string {
  return `${dKey}::${msn}`;
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function nowStr(): string {
  const d = new Date();
  return `${todayStr(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function nowInputValue(): string {
  const d = new Date();
  return `${todayStr(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export interface Evaluation {
  applicable: boolean;
  reason: string; // 不适用时的排除原因
  dueByCalendar: boolean;
  dueByHours: boolean;
}

/** 适用性评估：机型 + 改装批次均匹配才适用；达到任一期限条件即应执行 */
export function evaluate(directive: Directive, aircraft: Aircraft, today = todayStr()): Evaluation {
  if (aircraft.model !== directive.applicableModel) {
    return {
      applicable: false,
      reason: `机型不适用：本机 ${aircraft.model}，指令适用 ${directive.applicableModel}`,
      dueByCalendar: false,
      dueByHours: false,
    };
  }
  if (!directive.applicableBatches.includes(aircraft.modBatch)) {
    return {
      applicable: false,
      reason: `构型不匹配：本机改装批次 ${aircraft.modBatch}，指令适用批次 ${directive.applicableBatches.join("、")}`,
      dueByCalendar: false,
      dueByHours: false,
    };
  }
  return {
    applicable: true,
    reason: "",
    dueByCalendar: today >= directive.calendarDue,
    dueByHours: aircraft.flightHours >= directive.hourThreshold,
  };
}

function event(actor: string, action: string, detail: string): AuditEvent {
  return { at: nowStr(), actor, action, detail };
}

function triggerText(ev: Evaluation): string {
  const t: string[] = [];
  if (ev.dueByCalendar) t.push("日历到期");
  if (ev.dueByHours) t.push("飞行小时到门槛");
  return t.length ? t.join("、") : "未到期，转入监控";
}

function newRecord(directive: Directive, ac: Aircraft, ev: Evaluation, note: string): ExecutionRecord {
  const status: RecordStatus = ev.dueByCalendar || ev.dueByHours ? "due" : "monitoring";
  return {
    id: recordId(directive.key, ac.msn),
    directiveKey: directive.key,
    msn: ac.msn,
    status,
    dueByCalendar: ev.dueByCalendar,
    dueByHours: ev.dueByHours,
    history: [event("系统", "生成台账记录", `${note}；评估结果：${triggerText(ev)}`)],
  };
}

export interface DirectiveInput {
  number: string;
  revision: number;
  title: string;
  applicableModel: string;
  applicableBatches: string[];
  calendarDue: string;
  hourThreshold: number;
}

export interface ImportResult {
  state: LedgerState;
  created: boolean;
  revised: boolean;
  message: string;
}

/**
 * 导入指令（幂等）：
 * - 同编号同版次重复导入 → 忽略，不生成第二份待办；
 * - 同编号更高版次 → 换版：旧记录封存留档，仅对尚未执行的飞机按新版重算期限。
 */
export function importDirective(prev: LedgerState, input: DirectiveInput, actor = "工程部门"): ImportResult {
  const number = input.number.trim();
  const key = directiveKey(number, input.revision);
  if (prev.directives.some((d) => d.key === key)) {
    return {
      state: prev,
      created: false,
      revised: false,
      message: `${number} R${input.revision} 已在台账中：重复导入已忽略，未生成第二份待办。`,
    };
  }
  const directive: Directive = {
    key,
    number,
    revision: input.revision,
    title: input.title.trim(),
    applicableModel: input.applicableModel.trim(),
    applicableBatches: input.applicableBatches.map((b) => b.trim()).filter(Boolean),
    calendarDue: input.calendarDue,
    hourThreshold: input.hourThreshold,
    issuedAt: nowStr(),
    superseded: false,
  };

  const prior = prev.directives.filter((d) => d.number === number && d.revision < input.revision);
  const priorKeys = new Set(prior.map((d) => d.key));
  const revised = prior.length > 0;

  let directives = [...prev.directives, directive];
  let records = [...prev.records];
  const logs: AuditEvent[] = [];

  if (revised) {
    directives = directives.map((d) => (priorKeys.has(d.key) ? { ...d, superseded: true } : d));
    // 旧版已闭环的飞机不重算；其余尚未执行的飞机按新版重算期限
    const closedMsns = new Set(
      prev.records.filter((r) => priorKeys.has(r.directiveKey) && r.status === "closed").map((r) => r.msn)
    );
    // 旧版未闭环记录封存，留档可查
    records = records.map((r) =>
      priorKeys.has(r.directiveKey) && r.status !== "closed"
        ? {
            ...r,
            history: [
              ...r.history,
              event("系统", "指令换版", `${number} 已升为 R${input.revision}，本记录封存留档，期限按新版重算`),
            ],
          }
        : r
    );
    let recalculated = 0;
    for (const ac of prev.aircraft) {
      if (closedMsns.has(ac.msn)) continue;
      const ev = evaluate(directive, ac);
      if (!ev.applicable) continue;
      records.push(newRecord(directive, ac, ev, `换版重算（旧版 R${Math.max(...prior.map((p) => p.revision))} 尚未执行）`));
      recalculated += 1;
    }
    logs.push(
      event(
        actor,
        "指令换版",
        `${number} 升为 R${input.revision}：旧版记录封存可查，${closedMsns.size} 架已执行不重算，${recalculated} 架尚未执行已按新版重算期限`
      )
    );
  } else {
    let created = 0;
    for (const ac of prev.aircraft) {
      const ev = evaluate(directive, ac);
      if (!ev.applicable) continue;
      records.push(newRecord(directive, ac, ev, "新指令导入"));
      created += 1;
    }
    logs.push(
      event(
        actor,
        "导入指令",
        `${key} 导入完成：适用 ${created} 架，其余 ${prev.aircraft.length - created} 架构型不匹配已排除（可在“排除与档案”查看原因）`
      )
    );
  }

  return {
    state: { ...prev, directives, records, importLog: [...prev.importLog, ...logs] },
    created: true,
    revised,
    message: revised
      ? `已按换版处理：${key}。仅对尚未执行的飞机重算期限，旧记录留档可查。`
      : `已导入 ${key}，适用飞机已生成台账记录。`,
  };
}

export interface ActionResult {
  state: LedgerState;
  ok: boolean;
  message: string;
}

function withRecord(prev: LedgerState, id: string, fn: (r: ExecutionRecord) => ExecutionRecord): LedgerState {
  return { ...prev, records: prev.records.map((r) => (r.id === id ? fn(r) : r)) };
}

export interface CompletionInput {
  completedBy: string;
  workBasis: string;
  completedAt: string;
}

/** 报完成：执行人员或依据缺失时按材料不齐留在待补区 */
export function reportCompletion(prev: LedgerState, id: string, data: CompletionInput): ActionResult {
  const rec = prev.records.find((r) => r.id === id);
  if (!rec) return { state: prev, ok: false, message: "记录不存在。" };
  const by = data.completedBy.trim();
  const basis = data.workBasis.trim();
  const at = data.completedAt ? data.completedAt.replace("T", " ") : nowStr();
  const missing: string[] = [];
  if (!by) missing.push("执行人员");
  if (!basis) missing.push("执行依据");
  if (missing.length > 0) {
    return {
      ok: true,
      message: `材料不齐（缺少${missing.join("、")}），已留在待补区。`,
      state: withRecord(prev, id, (r) => ({
        ...r,
        status: "pending-supplement",
        completedBy: by || r.completedBy,
        workBasis: basis || r.workBasis,
        completedAt: at,
        supplementNote: `报完成材料不齐：缺少${missing.join("、")}`,
        history: [...r.history, event(by || "未登记", "报完成", `材料不齐：缺少${missing.join("、")}，转入待补区`)],
      })),
    };
  }
  return {
    ok: true,
    message: "已登记完成，待未参加本次工作的放行人员复核。",
    state: withRecord(prev, id, (r) => ({
      ...r,
      status: "awaiting-review",
      completedBy: by,
      workBasis: basis,
      completedAt: at,
      supplementNote: undefined,
      history: [...r.history, event(by, "报完成", `依据 ${basis} 完成，完成时刻 ${at}，待复核`)],
    })),
  };
}

export interface ReviewInput {
  reviewedBy: string;
  reviewBasis: string;
  pass: boolean;
  note?: string;
}

/** 复核：复核放行人员不得为本次工作的执行人员；材料不齐退回待补区 */
export function reviewRecord(prev: LedgerState, id: string, data: ReviewInput): ActionResult {
  const rec = prev.records.find((r) => r.id === id);
  if (!rec) return { state: prev, ok: false, message: "记录不存在。" };
  const reviewer = data.reviewedBy.trim();
  if (!reviewer) return { state: prev, ok: false, message: "请选择复核放行人员。" };
  if (rec.completedBy && reviewer === rec.completedBy) {
    return {
      state: prev,
      ok: false,
      message: `复核无效：${reviewer} 参加了本次工作，须由未参加的放行人员复核。`,
    };
  }
  const at = nowStr();
  if (!data.pass) {
    const note = data.note?.trim() || "复核认定材料不齐";
    return {
      ok: true,
      message: "已退回待补区，补齐材料后重新提交复核。",
      state: withRecord(prev, id, (r) => ({
        ...r,
        status: "pending-supplement",
        supplementNote: note,
        history: [...r.history, event(reviewer, "复核退回", note)],
      })),
    };
  }
  const basis = data.reviewBasis.trim();
  if (!basis) {
    return {
      ok: true,
      message: "复核依据未填写，按材料不齐留在待补区。",
      state: withRecord(prev, id, (r) => ({
        ...r,
        status: "pending-supplement",
        reviewedBy: reviewer,
        supplementNote: "复核材料不齐：缺少复核依据",
        history: [...r.history, event(reviewer, "复核", "复核依据缺失，转入待补区")],
      })),
    };
  }
  return {
    ok: true,
    message: `复核通过，${rec.msn} 该指令已闭环。`,
    state: withRecord(prev, id, (r) => ({
      ...r,
      status: "closed",
      reviewedBy: reviewer,
      reviewedAt: at,
      reviewBasis: basis,
      supplementNote: undefined,
      history: [...r.history, event(reviewer, "复核通过", `依据 ${basis}，复核时刻 ${at}`)],
    })),
  };
}

export interface SupplementInput {
  completedBy: string;
  workBasis: string;
  note: string;
}

/** 待补区补齐材料：齐全后重新进入待复核，仍不齐则继续留在待补区 */
export function supplementRecord(prev: LedgerState, id: string, data: SupplementInput): ActionResult {
  const rec = prev.records.find((r) => r.id === id);
  if (!rec) return { state: prev, ok: false, message: "记录不存在。" };
  const by = data.completedBy.trim() || rec.completedBy || "";
  const basis = data.workBasis.trim() || rec.workBasis || "";
  const missing: string[] = [];
  if (!by) missing.push("执行人员");
  if (!basis) missing.push("执行依据");
  if (missing.length > 0) {
    return {
      ok: false,
      message: `仍缺少${missing.join("、")}，继续留在待补区。`,
      state: withRecord(prev, id, (r) => ({
        ...r,
        completedBy: by || undefined,
        workBasis: basis || undefined,
        supplementNote: `待补：仍缺少${missing.join("、")}`,
        history: [...r.history, event("经办人", "补充材料", `仍缺少${missing.join("、")}`)],
      })),
    };
  }
  return {
    ok: true,
    message: "材料已补齐，重新进入待复核。",
    state: withRecord(prev, id, (r) => ({
      ...r,
      status: "awaiting-review",
      completedBy: by,
      workBasis: basis,
      supplementNote: undefined,
      history: [...r.history, event("经办人", "补充材料", `${data.note.trim() || "材料补齐"}，重新提交复核`)],
    })),
  };
}

/** 更新飞行小时，并重算该机未闭环记录的期限 */
export function updateFlightHours(prev: LedgerState, msn: string, hours: number): ActionResult {
  const ac = prev.aircraft.find((a) => a.msn === msn);
  if (!ac) return { state: prev, ok: false, message: "飞机不存在。" };
  const updated = { ...ac, flightHours: hours };
  const dirByKey = new Map(prev.directives.map((d) => [d.key, d]));
  let flipped = 0;
  const records = prev.records.map((r) => {
    if (r.msn !== msn || (r.status !== "monitoring" && r.status !== "due")) return r;
    const d = dirByKey.get(r.directiveKey);
    if (!d || d.superseded) return r;
    const ev = evaluate(d, updated);
    const status: RecordStatus = ev.dueByCalendar || ev.dueByHours ? "due" : "monitoring";
    if (status === r.status && ev.dueByCalendar === r.dueByCalendar && ev.dueByHours === r.dueByHours) return r;
    flipped += 1;
    return {
      ...r,
      dueByCalendar: ev.dueByCalendar,
      dueByHours: ev.dueByHours,
      status,
      history: [...r.history, event("系统", "期限重算", `飞行小时更新为 ${hours}：${triggerText(ev)}`)],
    };
  });
  return {
    state: { ...prev, aircraft: prev.aircraft.map((a) => (a.msn === msn ? updated : a)), records },
    ok: true,
    message: `已更新 ${msn} 飞行小时为 ${hours}，${flipped} 条未闭环记录期限状态变化。`,
  };
}

/** 登记新飞机，自动对在版指令做适用性评估 */
export function addAircraft(prev: LedgerState, ac: Aircraft): ActionResult {
  if (prev.aircraft.some((a) => a.msn === ac.msn)) {
    return { state: prev, ok: false, message: `序列号 ${ac.msn} 已登记。` };
  }
  const records = [...prev.records];
  let n = 0;
  for (const d of prev.directives.filter((d) => !d.superseded)) {
    const ev = evaluate(d, ac);
    if (!ev.applicable) continue;
    records.push(newRecord(d, ac, ev, "新飞机登记"));
    n += 1;
  }
  return {
    state: { ...prev, aircraft: [...prev.aircraft, ac], records },
    ok: true,
    message: `已登记 ${ac.msn}（${ac.model} / 批次 ${ac.modBatch}），自动生成 ${n} 条适用指令台账。`,
  };
}

/** 日期滚动或数据恢复后，重算所有在版指令未闭环记录的期限状态 */
export function refreshAll(prev: LedgerState): LedgerState {
  const dirByKey = new Map(prev.directives.map((d) => [d.key, d]));
  const acByMsn = new Map(prev.aircraft.map((a) => [a.msn, a]));
  const records = prev.records.map((r) => {
    if (r.status !== "monitoring" && r.status !== "due") return r;
    const d = dirByKey.get(r.directiveKey);
    const ac = acByMsn.get(r.msn);
    if (!d || !ac || d.superseded) return r;
    const ev = evaluate(d, ac);
    const status: RecordStatus = ev.dueByCalendar || ev.dueByHours ? "due" : "monitoring";
    if (status === r.status && ev.dueByCalendar === r.dueByCalendar && ev.dueByHours === r.dueByHours) return r;
    return { ...r, dueByCalendar: ev.dueByCalendar, dueByHours: ev.dueByHours, status };
  });
  return { ...prev, records };
}

export interface Exclusion {
  directiveKey: string;
  msn: string;
  reason: string;
}

/** 构型不匹配排除清单（仅统计在版指令），供“为什么被排除”查询 */
export function deriveExclusions(state: LedgerState): Exclusion[] {
  const out: Exclusion[] = [];
  for (const d of state.directives.filter((d) => !d.superseded)) {
    for (const ac of state.aircraft) {
      const ev = evaluate(d, ac);
      if (!ev.applicable) out.push({ directiveKey: d.key, msn: ac.msn, reason: ev.reason });
    }
  }
  return out;
}

export function activeDirectiveKeys(state: LedgerState): Set<string> {
  return new Set(state.directives.filter((d) => !d.superseded).map((d) => d.key));
}

// ---------- 本机留档 ----------

export function loadState(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LedgerState;
      if (parsed && Array.isArray(parsed.aircraft) && Array.isArray(parsed.directives) && Array.isArray(parsed.records)) {
        return refreshAll({ ...parsed, importLog: parsed.importLog ?? [] });
      }
    }
  } catch {
    // 留档损坏时回落到示例数据
  }
  return refreshAll(seedState());
}

export function saveState(state: LedgerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时仅保留页面内状态
  }
}

export function exportArchive(state: LedgerState): string {
  return JSON.stringify({ app: "hxwl-07-ad-ledger", version: 1, exportedAt: nowStr(), state }, null, 2);
}

export function parseArchive(text: string): LedgerState {
  const parsed = JSON.parse(text);
  const state = parsed && parsed.state ? parsed.state : parsed;
  if (!state || !Array.isArray(state.aircraft) || !Array.isArray(state.directives) || !Array.isArray(state.records)) {
    throw new Error("留档文件格式不正确");
  }
  return refreshAll({ importLog: [], ...state } as LedgerState);
}

export function freshSeed(): LedgerState {
  return refreshAll(seedState());
}
