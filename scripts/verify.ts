import { seedState } from "../src/seed";
import {
  canReview,
  checkApplicability,
  completeTask,
  dueReasonsFor,
  importDirective,
  registerAircraft,
  reviewTask,
  taskKey,
  todayStr,
} from "../src/logic";
import type { Directive } from "../src/types";

let failures = 0;
const assert = (name: string, cond: boolean) => {
  if (!cond) {
    failures += 1;
    console.error("FAIL:", name);
  } else {
    console.log("PASS:", name);
  }
};

let state = seedState;
const dA320 = state.directives.find((d) => d.id === "CAD-2026-A320-011")!;
const b1001 = state.aircraft.find((a) => a.sn === "B-1001")!;
const b1002 = state.aircraft.find((a) => a.sn === "B-1002")!;
const b3007 = state.aircraft.find((a) => a.sn === "B-3007")!;
const dB737 = state.directives.find((d) => d.id === "CAD-2026-B737-004")!;

// 1. 构型匹配：改装批次不同 -> 排除，且给出原因
assert("B-1001 构型适用", checkApplicability(dA320, b1001).ok === true);
const excluded = checkApplicability(dA320, b1002);
assert("B-1002 因批次不匹配被排除", excluded.ok === false && excluded.reason.includes("出厂标准构型"));
assert(
  "排除清单不会生成任务",
  !state.tasks.some((t) => t.aircraftSn === "B-1002" && t.directiveId === dA320.id),
);

// 2. 任一条件到期：B-1001 日历+小时双触发；B-3007 跟踪中
const today = todayStr();
assert("B-1001 两个期限条件均触发", dueReasonsFor(dA320, b1001, today).length === 2);
assert("B-3007 未到期", dueReasonsFor(dB737, b3007, today).length === 0);

// 3. 重复导入幂等：不生成第二份待办
const dup = importDirective(state, dA320);
assert("同编号同版次重复导入被识别", dup.duplicate === true);
assert("重复导入不新增任务", dup.state.tasks.length === state.tasks.length);

// 4. 换版：未执行飞机重算期限；已执行飞机不重算
//    先把 B-1001 的 R1 任务执行完成
const r1TaskId = taskKey(dA320.id, 1, "B-1001");
state = completeTask(state, r1TaskId, "王磊");
const r2: Directive = {
  id: dA320.id,
  revision: 2,
  title: "第2版",
  applicableModels: dA320.applicableModels,
  applicableModBatches: dA320.applicableModBatches,
  calendarDue: "2026-10-31",
  flightHourThreshold: 12500,
  issuedAt: new Date().toISOString(),
  status: "active",
};
const rev = importDirective(state, r2);
state = rev.state;
assert("换版识别", rev.superseded === true);
assert("已执行飞机不再生成新待办", !state.tasks.some((t) => t.id === taskKey(dA320.id, 2, "B-1001")));
assert("旧版记录仍保留可查", state.tasks.some((t) => t.id === r1TaskId));
assert(
  "旧版指令标记为已换版",
  state.directives.find((d) => d.id === dA320.id && d.revision === 1)!.status === "superseded",
);
assert("新版指令为现行版", state.directives.find((d) => d.id === dA320.id && d.revision === 2)!.status === "active");

// 再验证未执行飞机会重算：用第三架适用飞机（新增一架）
state = {
  ...state,
  aircraft: [...state.aircraft, { sn: "B-1009", model: "A320neo", modBatch: "已执行SB-32-118改装", flightHours: 9900 }],
};
const revAgain = importDirective(state, r2);
state = revAgain.state;
assert("换版时未执行新飞机按新版生成待办", state.tasks.some((t) => t.id === taskKey(dA320.id, 2, "B-1009")));

// 4b. 新飞机登记：按现行指令补建待办；构型不匹配不建；已执行指令不重建
state = registerAircraft(state, { sn: "B-1010", model: "A320neo", modBatch: "已执行SB-32-118改装", flightHours: 5000 });
assert("新登记飞机按现行版生成待办", state.tasks.some((t) => t.id === taskKey(dA320.id, 2, "B-1010")));
state = registerAircraft(state, { sn: "B-1011", model: "A320neo", modBatch: "出厂标准构型", flightHours: 5000 });
assert("构型不匹配的新飞机不生成待办", !state.tasks.some((t) => t.aircraftSn === "B-1011"));
const beforeDupRegister = state.tasks.length;
state = registerAircraft(state, { sn: "B-1010", model: "A320neo", modBatch: "已执行SB-32-118改装", flightHours: 5000 });
assert("重复序列号登记被忽略", state.tasks.length === beforeDupRegister);

// 5. 独立复核：复核人=执行人被拒；依据必填；他人复核成功
const completedTask = state.tasks.find((t) => t.id === r1TaskId)!;
assert("复核人不能等于执行人", canReview(completedTask, "王磊", "工作单卡").ok === false);
assert("复核依据必填", canReview(completedTask, "李静", "").ok === false);
assert("未参加工作的放行人员可复核", canReview(completedTask, "李静", "工作单卡 WO-01").ok === true);
state = reviewTask(state, r1TaskId, "李静", "工作单卡 WO-01");
const reviewed = state.tasks.find((t) => t.id === r1TaskId)!;
assert("复核记录依据与时刻", Boolean(reviewed.reviewedAt && reviewed.reviewBasis === "工作单卡 WO-01"));
assert("已复核不可重复复核", canReview(reviewed, "赵强", "依据").ok === false);

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
if (failures > 0) process.exit(1);
