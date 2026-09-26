import type {
  Aircraft,
  Applicability,
  Directive,
  LedgerState,
  Task,
} from "./types";

export const todayStr = (now: Date = new Date()): string => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const nowIso = (): string => new Date().toISOString();

export const formatTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 构型匹配：型号与改装批次均在适用范围内才算适用 */
export function checkApplicability(directive: Directive, aircraft: Aircraft): Applicability {
  const modelOk = directive.applicableModels.includes(aircraft.model);
  const batchOk = directive.applicableModBatches.includes(aircraft.modBatch);
  if (modelOk && batchOk) return { ok: true };
  const reasons: string[] = [];
  if (!modelOk) {
    reasons.push(`型号 ${aircraft.model} 不在适用范围（${directive.applicableModels.join("、")}）`);
  }
  if (!batchOk) {
    reasons.push(`改装批次「${aircraft.modBatch}」不在适用构型（${directive.applicableModBatches.join("、")}）`);
  }
  return { ok: false, reason: reasons.join("；") };
}

/** 期限计算：日历到期或飞行小时到门槛，达到任一条件即应执行 */
export function dueReasonsFor(directive: Directive, aircraft: Aircraft, today: string): string[] {
  const reasons: string[] = [];
  if (today >= directive.calendarDue) {
    reasons.push(`日历到期 ${directive.calendarDue}`);
  }
  if (aircraft.flightHours >= directive.flightHourThreshold) {
    reasons.push(`飞行小时 ${aircraft.flightHours}h ≥ 门槛 ${directive.flightHourThreshold}h`);
  }
  return reasons;
}

export const taskKey = (directiveId: string, revision: number, sn: string): string =>
  `${directiveId}:R${revision}:${sn}`;

export interface ImportResult {
  state: LedgerState;
  /** 重复导入：同编号同版次已存在 */
  duplicate: boolean;
  /** 本次是否为换版导入 */
  superseded: boolean;
  created: number;
  /** 换版时已执行完毕、不再重算期限的飞机数 */
  carriedCompleted: number;
  message: string;
}

/**
 * 为一架飞机补齐某现行指令的待办：
 * 构型不匹配不生成；该指令任一版次已执行完毕的不重算；已存在同键任务不重复生成。
 */
function ensureTaskForAircraft(
  tasks: Task[],
  directive: Directive,
  aircraft: Aircraft,
  today: string,
): { created: boolean; carriedCompleted: boolean } {
  const applicability = checkApplicability(directive, aircraft);
  if (!applicability.ok) return { created: false, carriedCompleted: false };

  // 该指令（任一版次）已执行完毕 → 不再重算期限、不生成新待办
  const completedEarlier = tasks.some(
    (t) => t.directiveId === directive.id && t.aircraftSn === aircraft.sn && t.status === "completed",
  );
  if (completedEarlier) return { created: false, carriedCompleted: true };

  const id = taskKey(directive.id, directive.revision, aircraft.sn);
  if (tasks.some((t) => t.id === id)) return { created: false, carriedCompleted: false };

  tasks.push({
    id,
    directiveId: directive.id,
    directiveRevision: directive.revision,
    aircraftSn: aircraft.sn,
    status: "pending",
    dueReasons: dueReasonsFor(directive, aircraft, today),
    createdAt: nowIso(),
  });
  return { created: true, carriedCompleted: false };
}

/**
 * 导入指令（幂等）：
 * - 同编号同版次重复导入 → 已有机型不产生第二份待办；仅为新登记且适用的飞机补建待办；
 * - 同编号更高版次 → 旧版标记换版、旧记录保留可查，
 *   仅对尚未执行的飞机按新版重算期限并生成新待办。
 */
export function importDirective(state: LedgerState, directive: Directive): ImportResult {
  const sameRevision = state.directives.some(
    (d) => d.id === directive.id && d.revision === directive.revision,
  );
  const previous = state.directives
    .filter((d) => d.id === directive.id && d.revision < directive.revision)
    .sort((a, b) => b.revision - a.revision)[0];

  // 换版：旧版指令标记为已被替代，旧任务记录原样保留可查
  const directives = state.directives.map((d) =>
    d.id === directive.id && d.revision < directive.revision && d.status === "active"
      ? { ...d, status: "superseded" as const }
      : d,
  );
  if (!sameRevision) directives.push(directive);

  const today = todayStr();
  const tasks = [...state.tasks];
  let created = 0;
  let carriedCompleted = 0;

  for (const aircraft of state.aircraft) {
    const result = ensureTaskForAircraft(tasks, directive, aircraft, today);
    if (result.created) created += 1;
    if (result.carriedCompleted) carriedCompleted += 1;
  }

  let message: string;
  if (previous) {
    message = `指令 ${directive.id} 已换版至第 ${directive.revision} 版：旧版记录保留可查，为 ${created} 架未执行飞机重算期限，${carriedCompleted} 架已执行飞机不再重复计算`;
  } else if (sameRevision && created === 0) {
    message = `指令 ${directive.id} 第 ${directive.revision} 版已存在，重复导入未生成新待办`;
  } else if (sameRevision) {
    message = `指令 ${directive.id} 第 ${directive.revision} 版已存在，已为 ${created} 架新登记且构型适用的飞机补建待办`;
  } else {
    message = `指令 ${directive.id} 第 ${directive.revision} 版导入完成，生成 ${created} 条待办`;
  }

  return {
    state: { ...state, directives, tasks },
    duplicate: sameRevision && created === 0,
    superseded: Boolean(previous),
    created,
    carriedCompleted,
    message,
  };
}

/**
 * 登记新飞机：为全部现行有效指令按当前构型补齐待办；
 * 对某指令已有完成记录的，不再生成。
 */
export function registerAircraft(state: LedgerState, aircraft: Aircraft): LedgerState {
  if (state.aircraft.some((a) => a.sn === aircraft.sn)) return state;
  const today = todayStr();
  const tasks = [...state.tasks];
  for (const directive of state.directives.filter((d) => d.status === "active")) {
    ensureTaskForAircraft(tasks, directive, aircraft, today);
  }
  return { ...state, aircraft: [...state.aircraft, aircraft], tasks };
}

/** 更新飞行小时：只刷新尚未执行任务的期限条件，已执行/待补记录不动 */
export function updateFlightHours(state: LedgerState, sn: string, hours: number): LedgerState {
  const aircraft = state.aircraft.map((a) => (a.sn === sn ? { ...a, flightHours: hours } : a));
  const target = aircraft.find((a) => a.sn === sn);
  if (!target) return state;
  const today = todayStr();
  const tasks = state.tasks.map((t) => {
    if (t.aircraftSn !== sn || t.status !== "pending") return t;
    const directive = state.directives.find(
      (d) => d.id === t.directiveId && d.revision === t.directiveRevision,
    );
    if (!directive || directive.status !== "active") return t;
    return { ...t, dueReasons: dueReasonsFor(directive, target, today) };
  });
  return { ...state, aircraft, tasks };
}

/** 登记执行完成 */
export function completeTask(state: LedgerState, taskId: string, operator: string): LedgerState {
  const tasks = state.tasks.map((t) =>
    t.id === taskId && t.status === "pending"
      ? { ...t, status: "completed" as const, completedBy: operator, completedAt: nowIso() }
      : t,
  );
  return { ...state, tasks };
}

/** 材料不齐，移入待补区 */
export function deferTask(state: LedgerState, taskId: string, note: string): LedgerState {
  const tasks = state.tasks.map((t) =>
    t.id === taskId && t.status === "pending"
      ? { ...t, status: "awaiting_materials" as const, materialNote: note }
      : t,
  );
  return { ...state, tasks };
}

/** 材料补齐，回到待执行 */
export function resumeTask(state: LedgerState, taskId: string): LedgerState {
  const tasks = state.tasks.map((t) =>
    t.id === taskId && t.status === "awaiting_materials"
      ? { ...t, status: "pending" as const, materialNote: undefined }
      : t,
  );
  return { ...state, tasks };
}

export interface ReviewCheck {
  ok: boolean;
  message: string;
}

/** 复核前校验：必须由未参加本次工作的放行人员复核 */
export function canReview(task: Task, reviewer: string, basis: string): ReviewCheck {
  if (task.status !== "completed") return { ok: false, message: "仅已完成的工作可以复核" };
  if (task.reviewedAt) return { ok: false, message: "该记录已复核归档" };
  if (!reviewer.trim()) return { ok: false, message: "请填写复核放行人员" };
  if (!basis.trim()) return { ok: false, message: "请填写复核依据" };
  if (task.completedBy && task.completedBy.trim() === reviewer.trim()) {
    return { ok: false, message: "复核人不得与本次工作执行人相同，须由未参加工作的放行人员复核" };
  }
  return { ok: true, message: "" };
}

/** 复核归档：记录复核依据与完成时刻 */
export function reviewTask(state: LedgerState, taskId: string, reviewer: string, basis: string): LedgerState {
  const tasks = state.tasks.map((t) =>
    t.id === taskId
      ? { ...t, reviewedBy: reviewer.trim(), reviewBasis: basis.trim(), reviewedAt: nowIso() }
      : t,
  );
  return { ...state, tasks };
}
