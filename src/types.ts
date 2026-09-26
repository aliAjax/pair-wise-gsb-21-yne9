export interface Aircraft {
  msn: string; // 序列号
  model: string; // 型号
  modBatch: string; // 改装状态（批次）
  flightHours: number; // 当前飞行小时
}

export interface Directive {
  key: string; // `${number}@R${revision}`
  number: string; // 指令编号
  revision: number; // 版次
  title: string;
  applicableModel: string; // 适用机型
  applicableBatches: string[]; // 适用构型（改装批次）
  calendarDue: string; // 日历到期日 YYYY-MM-DD
  hourThreshold: number; // 飞行小时门槛
  issuedAt: string;
  superseded: boolean; // 已被新版取代
}

export type RecordStatus =
  | "monitoring" // 适用但未到期，监控中
  | "due" // 达到任一条件，待执行
  | "awaiting-review" // 已报完成，待复核
  | "pending-supplement" // 材料不齐，待补
  | "closed"; // 复核通过，已闭环

export interface AuditEvent {
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface ExecutionRecord {
  id: string; // `${directiveKey}::${msn}`
  directiveKey: string;
  msn: string;
  status: RecordStatus;
  dueByCalendar: boolean; // 日历到期触发
  dueByHours: boolean; // 小时门槛触发
  completedBy?: string; // 执行人员
  completedAt?: string; // 完成时刻
  workBasis?: string; // 执行依据（工单/EO号）
  reviewedBy?: string; // 复核放行人员（须未参加本次工作）
  reviewedAt?: string; // 复核时刻
  reviewBasis?: string; // 复核依据
  supplementNote?: string; // 待补说明
  history: AuditEvent[]; // 操作轨迹
}

export interface LedgerState {
  aircraft: Aircraft[];
  directives: Directive[];
  records: ExecutionRecord[];
  importLog: AuditEvent[];
}
