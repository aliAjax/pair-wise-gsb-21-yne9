import type { LedgerState } from "./types";

/**
 * 初始演示数据：同型号不同改装批次的飞机混编，
 * 用于验证构型匹配、期限计算、待补与独立复核流程。
 */
export const seedState: LedgerState = {
  aircraft: [
    { sn: "B-1001", model: "A320neo", modBatch: "已执行SB-32-118改装", flightHours: 12180 },
    { sn: "B-1002", model: "A320neo", modBatch: "出厂标准构型", flightHours: 8300 },
    { sn: "B-3003", model: "B737-800", modBatch: "已执行SB-27-204改装", flightHours: 15320 },
    { sn: "B-3004", model: "B737-800", modBatch: "出厂标准构型", flightHours: 6100 },
    { sn: "B-3007", model: "B737-800", modBatch: "已执行SB-27-204改装", flightHours: 11200 },
    { sn: "B-5005", model: "ARJ21-700", modBatch: "出厂标准构型", flightHours: 2400 },
  ],
  directives: [
    {
      id: "CAD-2026-A320-011",
      revision: 1,
      title: "主起落架收放作动筒检查",
      applicableModels: ["A320neo"],
      applicableModBatches: ["已执行SB-32-118改装"],
      calendarDue: "2026-09-20",
      flightHourThreshold: 12000,
      issuedAt: "2026-09-01T02:00:00.000Z",
      status: "active",
    },
    {
      id: "CAD-2026-B737-004",
      revision: 1,
      title: "副翼配平作动器功能测试",
      applicableModels: ["B737-800"],
      applicableModBatches: ["已执行SB-27-204改装"],
      calendarDue: "2026-12-31",
      flightHourThreshold: 15000,
      issuedAt: "2026-09-01T02:00:00.000Z",
      status: "active",
    },
    {
      id: "CAD-2026-ARJ21-002",
      revision: 1,
      title: "电瓶容量复核",
      applicableModels: ["ARJ21-700"],
      applicableModBatches: ["出厂标准构型"],
      calendarDue: "2026-09-10",
      flightHourThreshold: 3000,
      issuedAt: "2026-09-01T02:00:00.000Z",
      status: "active",
    },
  ],
  tasks: [
    {
      id: "CAD-2026-A320-011:R1:B-1001",
      directiveId: "CAD-2026-A320-011",
      directiveRevision: 1,
      aircraftSn: "B-1001",
      status: "pending",
      dueReasons: ["日历到期 2026-09-20", "飞行小时 12180h ≥ 门槛 12000h"],
      createdAt: "2026-09-01T02:00:00.000Z",
    },
    {
      id: "CAD-2026-B737-004:R1:B-3003",
      directiveId: "CAD-2026-B737-004",
      directiveRevision: 1,
      aircraftSn: "B-3003",
      status: "completed",
      dueReasons: ["飞行小时 15320h ≥ 门槛 15000h"],
      createdAt: "2026-09-01T02:00:00.000Z",
      completedBy: "王磊",
      completedAt: "2026-09-24T01:30:00.000Z",
    },
    {
      id: "CAD-2026-B737-004:R1:B-3007",
      directiveId: "CAD-2026-B737-004",
      directiveRevision: 1,
      aircraftSn: "B-3007",
      status: "pending",
      dueReasons: [],
      createdAt: "2026-09-01T02:00:00.000Z",
    },
    {
      id: "CAD-2026-ARJ21-002:R1:B-5005",
      directiveId: "CAD-2026-ARJ21-002",
      directiveRevision: 1,
      aircraftSn: "B-5005",
      status: "awaiting_materials",
      dueReasons: ["日历到期 2026-09-10"],
      createdAt: "2026-09-01T02:00:00.000Z",
      materialNote: "航材未到货：电瓶备件预计 2026-10-08 到港，到货后恢复办理",
    },
  ],
};
