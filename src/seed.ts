import type { AuditEvent, ExecutionRecord, LedgerState } from "./types";

function ev(at: string, actor: string, action: string, detail: string): AuditEvent {
  return { at, actor, action, detail };
}

function rec(partial: Partial<ExecutionRecord> & Pick<ExecutionRecord, "id" | "directiveKey" | "msn" | "status">): ExecutionRecord {
  return {
    dueByCalendar: false,
    dueByHours: false,
    history: [],
    ...partial,
  };
}

/**
 * 示例台账：覆盖日历到期、小时门槛、构型排除、换版重算、待复核、待补等场景。
 * 首次打开或点击“重置示例”时载入；此后所有改动自动存入本机 localStorage。
 */
export function seedState(): LedgerState {
  return {
    aircraft: [
      { msn: "10234", model: "A320", modBatch: "M1", flightHours: 12800 },
      { msn: "10235", model: "A320", modBatch: "M2", flightHours: 9600 },
      { msn: "10240", model: "A320", modBatch: "M1", flightHours: 11200 },
      { msn: "20881", model: "B737", modBatch: "B1", flightHours: 15300 },
      { msn: "20882", model: "B737", modBatch: "B2", flightHours: 8100 },
      { msn: "30117", model: "ARJ21", modBatch: "C1", flightHours: 4200 },
    ],
    directives: [
      {
        key: "AD-2025-032@R0",
        number: "AD-2025-032",
        revision: 0,
        title: "升降舵作动器连杆检查",
        applicableModel: "A320",
        applicableBatches: ["M1"],
        calendarDue: "2026-03-31",
        hourThreshold: 12000,
        issuedAt: "2025-11-20 10:00",
        superseded: true,
      },
      {
        key: "AD-2025-032@R1",
        number: "AD-2025-032",
        revision: 1,
        title: "升降舵作动器连杆检查（修订检查间隔）",
        applicableModel: "A320",
        applicableBatches: ["M1"],
        calendarDue: "2026-10-15",
        hourThreshold: 12500,
        issuedAt: "2026-06-01 09:30",
        superseded: false,
      },
      {
        key: "AD-2026-011@R1",
        number: "AD-2026-011",
        revision: 1,
        title: "主起落架收放机构润滑与检查",
        applicableModel: "A320",
        applicableBatches: ["M1"],
        calendarDue: "2026-09-20",
        hourThreshold: 13000,
        issuedAt: "2026-08-15 14:00",
        superseded: false,
      },
      {
        key: "AD-2026-014@R0",
        number: "AD-2026-014",
        revision: 0,
        title: "电瓶汇流条接线检查",
        applicableModel: "B737",
        applicableBatches: ["B1", "B2"],
        calendarDue: "2026-12-31",
        hourThreshold: 15000,
        issuedAt: "2026-09-01 11:00",
        superseded: false,
      },
      {
        key: "AD-2026-009@R0",
        number: "AD-2026-009",
        revision: 0,
        title: "副翼配平片紧固件检查",
        applicableModel: "ARJ21",
        applicableBatches: ["C1"],
        calendarDue: "2026-09-10",
        hourThreshold: 5000,
        issuedAt: "2026-08-20 16:00",
        superseded: false,
      },
    ],
    records: [
      // 旧版 R0：10234 已闭环 —— 换版后不重算，留档可查
      rec({
        id: "AD-2025-032@R0::10234",
        directiveKey: "AD-2025-032@R0",
        msn: "10234",
        status: "closed",
        dueByCalendar: true,
        dueByHours: true,
        completedBy: "王海涛",
        completedAt: "2026-03-10 15:20",
        workBasis: "EO-26-0188",
        reviewedBy: "李雪梅",
        reviewedAt: "2026-03-12 09:40",
        reviewBasis: "工单 WO-260310 及附件照片",
        history: [
          ev("2025-11-20 10:00", "系统", "生成台账记录", "新指令导入；评估结果：日历到期、飞行小时到门槛"),
          ev("2026-03-10 15:20", "王海涛", "报完成", "依据 EO-26-0188 完成，待复核"),
          ev("2026-03-12 09:40", "李雪梅", "复核通过", "依据 工单 WO-260310 及附件照片"),
        ],
      }),
      // 旧版 R0：10240 尚未执行即遇换版 —— 记录封存，期限由 R1 重算
      rec({
        id: "AD-2025-032@R0::10240",
        directiveKey: "AD-2025-032@R0",
        msn: "10240",
        status: "due",
        dueByCalendar: true,
        dueByHours: false,
        history: [
          ev("2025-11-20 10:00", "系统", "生成台账记录", "新指令导入；评估结果：日历到期"),
          ev("2026-06-01 09:30", "系统", "指令换版", "AD-2025-032 已升为 R1，本记录封存留档，期限按新版重算"),
        ],
      }),
      // 新版 R1：仅对尚未执行的 10240 重算期限（10234 已闭环不重算）
      rec({
        id: "AD-2025-032@R1::10240",
        directiveKey: "AD-2025-032@R1",
        msn: "10240",
        status: "monitoring",
        dueByCalendar: false,
        dueByHours: false,
        history: [
          ev("2026-06-01 09:30", "系统", "生成台账记录", "换版重算（旧版 R0 尚未执行）；评估结果：未到期，转入监控"),
        ],
      }),
      // 日历已到期（2026-09-20），小时未到门槛 —— 待执行
      rec({
        id: "AD-2026-011@R1::10234",
        directiveKey: "AD-2026-011@R1",
        msn: "10234",
        status: "due",
        dueByCalendar: true,
        dueByHours: false,
        history: [
          ev("2026-08-15 14:00", "系统", "生成台账记录", "新指令导入；评估结果：日历到期"),
        ],
      }),
      // 已报完成，等待未参加工作的放行人员复核
      rec({
        id: "AD-2026-011@R1::10240",
        directiveKey: "AD-2026-011@R1",
        msn: "10240",
        status: "awaiting-review",
        dueByCalendar: true,
        dueByHours: false,
        completedBy: "王海涛",
        completedAt: "2026-09-25 17:10",
        workBasis: "EO-26-0204",
        history: [
          ev("2026-08-15 14:00", "系统", "生成台账记录", "新指令导入；评估结果：日历到期"),
          ev("2026-09-25 17:10", "王海涛", "报完成", "依据 EO-26-0204 完成，待复核"),
        ],
      }),
      // 飞行小时到门槛（15300 ≥ 15000）—— 待执行
      rec({
        id: "AD-2026-014@R0::20881",
        directiveKey: "AD-2026-014@R0",
        msn: "20881",
        status: "due",
        dueByCalendar: false,
        dueByHours: true,
        history: [
          ev("2026-09-01 11:00", "系统", "生成台账记录", "新指令导入；评估结果：飞行小时到门槛"),
        ],
      }),
      rec({
        id: "AD-2026-014@R0::20882",
        directiveKey: "AD-2026-014@R0",
        msn: "20882",
        status: "monitoring",
        dueByCalendar: false,
        dueByHours: false,
        history: [
          ev("2026-09-01 11:00", "系统", "生成台账记录", "新指令导入；评估结果：未到期，转入监控"),
        ],
      }),
      // 报完成时缺执行依据 —— 留在待补区
      rec({
        id: "AD-2026-009@R0::30117",
        directiveKey: "AD-2026-009@R0",
        msn: "30117",
        status: "pending-supplement",
        dueByCalendar: true,
        dueByHours: false,
        completedBy: "陈立群",
        completedAt: "2026-09-24 10:05",
        supplementNote: "报完成材料不齐：缺少执行依据",
        history: [
          ev("2026-08-20 16:00", "系统", "生成台账记录", "新指令导入；评估结果：日历到期"),
          ev("2026-09-24 10:05", "陈立群", "报完成", "材料不齐：缺少执行依据，转入待补区"),
        ],
      }),
    ],
    importLog: [
      ev("2025-11-20 10:00", "工程部门", "导入指令", "AD-2025-032@R0 导入完成：适用 2 架"),
      ev("2026-06-01 09:30", "工程部门", "指令换版", "AD-2025-032 升为 R1：旧版记录封存可查，1 架已执行不重算，1 架尚未执行已按新版重算期限"),
      ev("2026-08-15 14:00", "工程部门", "导入指令", "AD-2026-011@R1 导入完成：适用 2 架"),
      ev("2026-08-20 16:00", "工程部门", "导入指令", "AD-2026-009@R0 导入完成：适用 1 架"),
      ev("2026-09-01 11:00", "工程部门", "导入指令", "AD-2026-014@R0 导入完成：适用 2 架"),
      ev("2026-09-03 08:45", "工程部门", "重复导入", "AD-2026-014@R0 重复导入已忽略，未生成第二份待办"),
    ],
  };
}
