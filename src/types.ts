// 适航指令执行期限台账 —— 领域模型

/** 在册飞机 */
export interface Aircraft {
  /** 序列号（机队内唯一） */
  sn: string;
  /** 型号 */
  model: string;
  /** 改装状态 / 改装批次 */
  modBatch: string;
  /** 当前飞行小时 */
  flightHours: number;
}

/** 适航指令（某一版次） */
export interface Directive {
  /** 指令编号，如 CAD-2026-A320-011 */
  id: string;
  /** 版次，从 1 开始 */
  revision: number;
  title: string;
  /** 适用构型：型号清单 */
  applicableModels: string[];
  /** 适用构型：改装批次清单 */
  applicableModBatches: string[];
  /** 日历到期日，YYYY-MM-DD */
  calendarDue: string;
  /** 飞行小时门槛 */
  flightHourThreshold: number;
  /** 发布时刻 ISO */
  issuedAt: string;
  /** active=现行版，superseded=已被换版 */
  status: "active" | "superseded";
}

/** 待办任务状态：待执行 → 待补（材料不齐）→ 已完成待复核 → 已复核归档 */
export type TaskStatus = "pending" | "awaiting_materials" | "completed";

export interface Task {
  /** 指令编号:版次:序列号，天然幂等键 */
  id: string;
  directiveId: string;
  directiveRevision: number;
  aircraftSn: string;
  status: TaskStatus;
  /** 触发待执行的条件（日历到期 / 飞行小时到门槛） */
  dueReasons: string[];
  /** 任务生成时刻 ISO */
  createdAt: string;
  /** 执行信息 */
  completedBy?: string;
  completedAt?: string;
  /** 独立复核信息（复核人不得与执行人相同） */
  reviewedBy?: string;
  reviewBasis?: string;
  reviewedAt?: string;
  /** 待补说明（材料不齐时填写） */
  materialNote?: string;
}

/** 整机队台账状态，整体存入本机留档 */
export interface LedgerState {
  aircraft: Aircraft[];
  directives: Directive[];
  tasks: Task[];
}

/** 构型匹配结果 */
export type Applicability = { ok: true } | { ok: false; reason: string };
