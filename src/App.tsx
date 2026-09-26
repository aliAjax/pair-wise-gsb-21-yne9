import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import "./styles.css";
import type { Aircraft, Directive, LedgerState, Task } from "./types";
import {
  canReview,
  checkApplicability,
  completeTask,
  deferTask,
  formatTime,
  importDirective,
  nowIso,
  registerAircraft,
  resumeTask,
  reviewTask,
  todayStr,
  updateFlightHours,
} from "./logic";
import {
  exportArchive,
  loadOperator,
  loadState,
  parseArchive,
  saveOperator,
  saveState,
} from "./storage";
import { seedState } from "./seed";

const statusLabel = (task: Task): string => {
  if (task.status === "awaiting_materials") return "待补";
  if (task.status === "completed") return task.reviewedAt ? "已复核" : "待复核";
  return task.dueReasons.length > 0 ? "待执行" : "跟踪中";
};

const statusClass = (task: Task): string => {
  if (task.status === "awaiting_materials") return "badge badge-hold";
  if (task.status === "completed") return task.reviewedAt ? "badge badge-done" : "badge badge-review";
  return task.dueReasons.length > 0 ? "badge badge-due" : "badge badge-track";
};

interface TaskView {
  task: Task;
  directive: Directive;
  aircraft: Aircraft;
}

function MetricCard({ label, value, index }: { label: string; value: number; index: number }) {
  const colors = ["status-danger", "status-watch", "status-review", "status-ok", "status-muted"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={colors[index % colors.length]} />
    </article>
  );
}

function TaskCard({ view, children }: { view: TaskView; children?: ReactNode }) {
  const { task, directive, aircraft } = view;
  return (
    <article className="record-card task-card">
      <div className="task-head">
        <div>
          <h3>
            {directive.id} <em>R{directive.revision}</em> · {directive.title}
          </h3>
          <p>
            {aircraft.sn} · {aircraft.model} · {aircraft.modBatch} · 当前 {aircraft.flightHours}h
          </p>
        </div>
        <span className={statusClass(task)}>{statusLabel(task)}</span>
      </div>
      <div className="task-meta">
        <span>日历到期 {directive.calendarDue}</span>
        <span>小时门槛 {directive.flightHourThreshold}h</span>
        <span>登记于 {formatTime(task.createdAt)}</span>
      </div>
      {task.dueReasons.length > 0 ? (
        <div className="reason-row">
          {task.dueReasons.map((r) => (
            <span key={r} className="reason-chip">
              触发：{r}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted-line">尚未到达期限，持续跟踪；到达日历到期日或飞行小时门槛任一条件即转为待执行。</p>
      )}
      {task.materialNote && <p className="note-line">待补说明:{task.materialNote}</p>}
      {task.completedAt && (
        <p className="muted-line">
          执行人 {task.completedBy} · 完成时刻 {formatTime(task.completedAt)}
        </p>
      )}
      {task.reviewedAt && (
        <p className="muted-line">
          复核人 {task.reviewedBy} · 复核依据:{task.reviewBasis} · 复核时刻 {formatTime(task.reviewedAt)}
        </p>
      )}
      {children && <div className="task-actions">{children}</div>}
    </article>
  );
}

function App() {
  const [state, setState] = useState<LedgerState>(loadState);
  const [operator, setOperator] = useState(loadOperator);
  const [tab, setTab] = useState("todo");
  const [banner, setBanner] = useState("");
  const [deferDraft, setDeferDraft] = useState<Record<string, string>>({});
  const [reviewDraft, setReviewDraft] = useState<Record<string, { reviewer: string; basis: string }>>({});
  const [hoursDraft, setHoursDraft] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    id: "",
    revision: "1",
    title: "",
    models: "",
    batches: "",
    calendarDue: "",
    threshold: "",
  });
  const [aircraftForm, setAircraftForm] = useState({
    sn: "",
    model: "",
    modBatch: "",
    flightHours: "",
  });

  useEffect(() => saveState(state), [state]);
  useEffect(() => saveOperator(operator), [operator]);

  const today = todayStr();

  const views = useMemo<TaskView[]>(() => {
    return state.tasks.flatMap((task) => {
      const directive = state.directives.find(
        (d) => d.id === task.directiveId && d.revision === task.directiveRevision,
      );
      const aircraft = state.aircraft.find((a) => a.sn === task.aircraftSn);
      return directive && aircraft ? [{ task, directive, aircraft }] : [];
    });
  }, [state]);

  const activeDirectives = state.directives.filter((d) => d.status === "active");
  const activeIds = new Set(activeDirectives.map((d) => `${d.id}:${d.revision}`));
  const isActiveView = (v: TaskView) => activeIds.has(`${v.directive.id}:${v.directive.revision}`);

  const pendingViews = views.filter((v) => v.task.status === "pending" && isActiveView(v));
  const dueViews = pendingViews.filter((v) => v.task.dueReasons.length > 0);
  const trackingViews = pendingViews.filter((v) => v.task.dueReasons.length === 0);
  const awaitingViews = views.filter((v) => v.task.status === "awaiting_materials" && isActiveView(v));
  const reviewViews = views.filter(
    (v) => v.task.status === "completed" && !v.task.reviewedAt && isActiveView(v),
  );
  const archivedViews = views.filter((v) => v.task.status === "completed" && v.task.reviewedAt);

  // 构型不匹配的飞机不进待办，但在此给出排除原因
  const exclusions = useMemo(() => {
    return activeDirectives.flatMap((directive) =>
      state.aircraft
        .map((aircraft) => ({ directive, aircraft, result: checkApplicability(directive, aircraft) }))
        .filter((x) => !x.result.ok)
        .map((x) => ({
          directive: x.directive,
          aircraft: x.aircraft,
          reason: (x.result as { ok: false; reason: string }).reason,
        })),
    );
  }, [state, activeDirectives]);

  const update = (next: LedgerState, message: string) => {
    setState(next);
    setBanner(message);
  };

  const handleComplete = (taskId: string) => {
    if (!operator.trim()) {
      setBanner("请先在页首填写当前办理人，再登记执行完成");
      return;
    }
    update(completeTask(state, taskId, operator.trim()), "已登记执行完成，待未参加本次工作的放行人员复核");
  };

  const handleDefer = (taskId: string) => {
    const note = (deferDraft[taskId] ?? "").trim();
    if (!note) {
      setBanner("转入待补区前请填写材料不齐说明");
      return;
    }
    update(deferTask(state, taskId, note), "已移入待补区，材料补齐后可恢复办理");
  };

  const handleReview = (task: Task) => {
    const draft = reviewDraft[task.id] ?? { reviewer: "", basis: "" };
    const check = canReview(task, draft.reviewer, draft.basis);
    if (!check.ok) {
      setBanner(check.message);
      return;
    }
    update(reviewTask(state, task.id, draft.reviewer, draft.basis), "复核完成，记录已归档");
  };

  const handleHours = (sn: string) => {
    const value = Number(hoursDraft[sn]);
    if (!Number.isFinite(value) || value < 0) {
      setBanner("飞行小时须为非负数字");
      return;
    }
    update(updateFlightHours(state, sn, value), `${sn} 飞行小时已更新为 ${value}h，未执行飞机的期限已重算`);
  };

  const handleImport = () => {
    const models = form.models.split(/[,，、\s]+/).filter(Boolean);
    const batches = form.batches.split(/[,，、\s]+/).filter(Boolean);
    const revision = Number(form.revision);
    const threshold = Number(form.threshold);
    if (!form.id.trim() || !form.title.trim() || models.length === 0 || batches.length === 0) {
      setBanner("请完整填写指令编号、标题与适用构型");
      return;
    }
    if (!form.calendarDue || !Number.isInteger(revision) || revision < 1 || !(threshold > 0)) {
      setBanner("请检查版次、日历到期日与飞行小时门槛");
      return;
    }
    const directive: Directive = {
      id: form.id.trim(),
      revision,
      title: form.title.trim(),
      applicableModels: models,
      applicableModBatches: batches,
      calendarDue: form.calendarDue,
      flightHourThreshold: threshold,
      issuedAt: nowIso(),
      status: "active",
    };
    const result = importDirective(state, directive);
    if (result.created > 0 || !result.duplicate) {
      setState(result.state);
    }
    if (!result.duplicate) {
      setForm({ id: "", revision: "1", title: "", models: "", batches: "", calendarDue: "", threshold: "" });
    }
    setBanner(result.message);
  };

  const handleRevisionDemo = () => {
    const directive: Directive = {
      id: "CAD-2026-A320-011",
      revision: 2,
      title: "主起落架收放作动筒检查（第2版）",
      applicableModels: ["A320neo"],
      applicableModBatches: ["已执行SB-32-118改装"],
      calendarDue: "2026-10-31",
      flightHourThreshold: 12500,
      issuedAt: nowIso(),
      status: "active",
    };
    const result = importDirective(state, directive);
    if (result.created > 0 || !result.duplicate) setState(result.state);
    setBanner(result.message);
  };

  const handleRegisterAircraft = () => {
    const sn = aircraftForm.sn.trim();
    const model = aircraftForm.model.trim();
    const modBatch = aircraftForm.modBatch.trim();
    const flightHours = Number(aircraftForm.flightHours);
    if (!sn || !model || !modBatch) {
      setBanner("请完整填写序列号、型号与改装状态");
      return;
    }
    if (!Number.isFinite(flightHours) || flightHours < 0) {
      setBanner("飞行小时须为非负数字");
      return;
    }
    if (state.aircraft.some((a) => a.sn === sn)) {
      setBanner(`序列号 ${sn} 已在册，请直接更新其飞行小时`);
      return;
    }
    update(
      registerAircraft(state, { sn, model, modBatch, flightHours }),
      `${sn} 已登记入册，并按现行指令适用构型生成待办`,
    );
    setAircraftForm({ sn: "", model: "", modBatch: "", flightHours: "" });
  };

  const handleImportArchive = (file: File | undefined) => {
    if (!file) return;
    file.text().then((text) => {
      const parsed = parseArchive(text);
      if (parsed) {
        update(parsed, "留档已恢复，可接着办理");
      } else {
        setBanner("留档文件结构不符，未导入");
      }
    });
  };

  const tabs = [
    { key: "todo", label: `待办 ${pendingViews.length}` },
    { key: "hold", label: `待补区 ${awaitingViews.length}` },
    { key: "done", label: `完成与复核 ${reviewViews.length + archivedViews.length}` },
    { key: "excluded", label: `排除说明 ${exclusions.length}` },
    { key: "fleet", label: `机队台账 ${state.aircraft.length}` },
    { key: "library", label: `指令库 ${state.directives.length}` },
  ];

  const directiveGroups = useMemo(() => {
    const map = new Map<string, Directive[]>();
    for (const d of state.directives) {
      const list = map.get(d.id) ?? [];
      list.push(d);
      map.set(d.id, list);
    }
    return [...map.entries()].map(([id, list]) => ({
      id,
      revisions: [...list].sort((a, b) => b.revision - a.revision),
    }));
  }, [state.directives]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-07 · 适航指令管理 · 今日 {today}</p>
          <h1>适航指令执行期限台账</h1>
          <p className="subtitle">
            按适用构型匹配机队，日历到期日或飞行小时门槛达到任一条件即列为待执行；
            构型不匹配的飞机不进待办但可查看排除原因。完成后由未参加本次工作的放行人员复核，
            材料不齐留在待补区，全部记录本机留档可接着办理。
          </p>
        </div>
        <div className="stack-card">
          <span>当前办理人（执行登记用，本机保存）</span>
          <input
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            placeholder="填写姓名，如：王磊"
          />
          <span className="muted-line">复核人须为未参加本次工作的放行人员，不能与执行人相同。</span>
        </div>
      </section>

      <section className="metrics-grid five">
        <MetricCard label="待执行" value={dueViews.length} index={0} />
        <MetricCard label="待补" value={awaitingViews.length} index={1} />
        <MetricCard label="待复核" value={reviewViews.length} index={2} />
        <MetricCard label="已复核归档" value={archivedViews.length} index={3} />
        <MetricCard label="构型排除" value={exclusions.length} index={4} />
      </section>

      {banner && (
        <div className="banner">
          <span>{banner}</span>
          <button onClick={() => setBanner("")}>知道了</button>
        </div>
      )}

      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "tab active" : "tab"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "todo" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>达到任一期限条件即列入</p>
              <h2>待执行（{dueViews.length}）</h2>
            </div>
          </div>
          <div className="record-list">
            {dueViews.length === 0 && <p className="muted-line">当前没有到达期限的待办。</p>}
            {dueViews.map((view) => (
              <TaskCard key={view.task.id} view={view}>
                <button className="primary-action" onClick={() => handleComplete(view.task.id)}>
                  登记执行完成
                </button>
                <input
                  placeholder="材料不齐说明（转入待补区时必填）"
                  value={deferDraft[view.task.id] ?? ""}
                  onChange={(e) => setDeferDraft({ ...deferDraft, [view.task.id]: e.target.value })}
                />
                <button onClick={() => handleDefer(view.task.id)}>转入待补区</button>
              </TaskCard>
            ))}
          </div>
          <div className="section-heading sub-heading">
            <div>
              <p>尚未到达期限</p>
              <h2>跟踪中（{trackingViews.length}）</h2>
            </div>
          </div>
          <div className="record-list">
            {trackingViews.length === 0 && <p className="muted-line">没有跟踪中的任务。</p>}
            {trackingViews.map((view) => (
              <TaskCard key={view.task.id} view={view} />
            ))}
          </div>
        </section>
      )}

      {tab === "hold" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>材料不齐，留在待补区</p>
              <h2>待补区（{awaitingViews.length}）</h2>
            </div>
          </div>
          <div className="record-list">
            {awaitingViews.length === 0 && <p className="muted-line">待补区为空。</p>}
            {awaitingViews.map((view) => (
              <TaskCard key={view.task.id} view={view}>
                <button
                  className="primary-action"
                  onClick={() => update(resumeTask(state, view.task.id), "材料已补齐，任务回到待办")}
                >
                  材料补齐，恢复办理
                </button>
              </TaskCard>
            ))}
          </div>
        </section>
      )}

      {tab === "done" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>由未参加本次工作的放行人员复核</p>
              <h2>待复核（{reviewViews.length}）</h2>
            </div>
          </div>
          <div className="record-list">
            {reviewViews.length === 0 && <p className="muted-line">没有待复核的记录。</p>}
            {reviewViews.map((view) => {
              const draft = reviewDraft[view.task.id] ?? { reviewer: "", basis: "" };
              return (
                <TaskCard key={view.task.id} view={view}>
                  <input
                    placeholder={`复核放行人员（不得为执行人${view.task.completedBy ?? ""}）`}
                    value={draft.reviewer}
                    onChange={(e) =>
                      setReviewDraft({
                        ...reviewDraft,
                        [view.task.id]: { ...draft, reviewer: e.target.value },
                      })
                    }
                  />
                  <input
                    placeholder="复核依据，如：工作单卡 WO-2026-0918、航材合格证"
                    value={draft.basis}
                    onChange={(e) =>
                      setReviewDraft({
                        ...reviewDraft,
                        [view.task.id]: { ...draft, basis: e.target.value },
                      })
                    }
                  />
                  <button className="primary-action" onClick={() => handleReview(view.task)}>
                    复核归档
                  </button>
                </TaskCard>
              );
            })}
          </div>
          <div className="section-heading sub-heading">
            <div>
              <p>依据与完成时刻已记录</p>
              <h2>已复核归档（{archivedViews.length}）</h2>
            </div>
          </div>
          <div className="record-list">
            {archivedViews.length === 0 && <p className="muted-line">暂无归档记录。</p>}
            {archivedViews.map((view) => (
              <TaskCard key={view.task.id} view={view} />
            ))}
          </div>
        </section>
      )}

      {tab === "excluded" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>构型不匹配的飞机不进入待办</p>
              <h2>排除说明（{exclusions.length}）</h2>
            </div>
          </div>
          <div className="record-list">
            {exclusions.length === 0 && <p className="muted-line">现行指令对全部在册飞机均适用。</p>}
            {exclusions.map(({ directive, aircraft, reason }) => (
              <article key={`${directive.id}-${directive.revision}-${aircraft.sn}`} className="record-card">
                <div>
                  <h3>
                    {aircraft.sn} · {directive.id} R{directive.revision}
                  </h3>
                  <p>{reason}</p>
                </div>
                <span className="badge badge-muted">不列入待办</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "fleet" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>型号 / 序列号 / 改装状态 / 当前飞行小时</p>
              <h2>机队台账（{state.aircraft.length}）</h2>
            </div>
          </div>
          <div className="field-grid">
            <label>
              <span>序列号</span>
              <input
                value={aircraftForm.sn}
                onChange={(e) => setAircraftForm({ ...aircraftForm, sn: e.target.value })}
                placeholder="如 B-1009"
              />
            </label>
            <label>
              <span>型号</span>
              <input
                value={aircraftForm.model}
                onChange={(e) => setAircraftForm({ ...aircraftForm, model: e.target.value })}
                placeholder="如 A320neo"
              />
            </label>
            <label>
              <span>改装状态</span>
              <input
                value={aircraftForm.modBatch}
                onChange={(e) => setAircraftForm({ ...aircraftForm, modBatch: e.target.value })}
                placeholder="如 已执行SB-32-118改装"
              />
            </label>
            <label>
              <span>当前飞行小时</span>
              <input
                type="number"
                min="0"
                value={aircraftForm.flightHours}
                onChange={(e) => setAircraftForm({ ...aircraftForm, flightHours: e.target.value })}
                placeholder="如 9800"
              />
            </label>
          </div>
          <div className="task-actions">
            <button className="primary-action" onClick={handleRegisterAircraft}>
              登记飞机并按现行指令生成待办
            </button>
          </div>
          <div className="record-list fleet-list">
            {state.aircraft.map((a) => (
              <article key={a.sn} className="record-card fleet-card">
                <div>
                  <h3>
                    {a.sn} · {a.model}
                  </h3>
                  <p>
                    改装状态：{a.modBatch} · 当前飞行小时 {a.flightHours}h
                  </p>
                </div>
                <div className="task-actions inline">
                  <input
                    type="number"
                    min="0"
                    placeholder="更新飞行小时"
                    value={hoursDraft[a.sn] ?? ""}
                    onChange={(e) => setHoursDraft({ ...hoursDraft, [a.sn]: e.target.value })}
                  />
                  <button onClick={() => handleHours(a.sn)}>更新并重算期限</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "library" && (
        <>
          <section className="panel">
            <div className="section-heading">
              <div>
                <p>同版次重复导入不生成第二份待办；更高版次自动换版</p>
                <h2>导入适航指令</h2>
              </div>
              <button onClick={handleRevisionDemo}>演示：导入 CAD-2026-A320-011 第 2 版</button>
            </div>
            <div className="field-grid">
              <label>
                <span>指令编号</span>
                <input
                  value={form.id}
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                  placeholder="如 CAD-2026-A320-011"
                />
              </label>
              <label>
                <span>版次</span>
                <input
                  type="number"
                  min="1"
                  value={form.revision}
                  onChange={(e) => setForm({ ...form, revision: e.target.value })}
                />
              </label>
              <label>
                <span>标题</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="如 主起落架收放作动筒检查"
                />
              </label>
              <label>
                <span>适用型号（多个用逗号分隔）</span>
                <input
                  value={form.models}
                  onChange={(e) => setForm({ ...form, models: e.target.value })}
                  placeholder="如 A320neo, B737-800"
                />
              </label>
              <label>
                <span>适用改装批次（多个用逗号分隔）</span>
                <input
                  value={form.batches}
                  onChange={(e) => setForm({ ...form, batches: e.target.value })}
                  placeholder="如 已执行SB-32-118改装"
                />
              </label>
              <label>
                <span>日历到期日</span>
                <input
                  type="date"
                  value={form.calendarDue}
                  onChange={(e) => setForm({ ...form, calendarDue: e.target.value })}
                />
              </label>
              <label>
                <span>飞行小时门槛</span>
                <input
                  type="number"
                  min="1"
                  value={form.threshold}
                  onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                  placeholder="如 12000"
                />
              </label>
            </div>
            <div className="task-actions">
              <button className="primary-action" onClick={handleImport}>
                导入指令并生成待办
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>换版后旧记录仍可查</p>
                <h2>指令库（{state.directives.length} 个版次）</h2>
              </div>
            </div>
            <div className="record-list">
              {directiveGroups.map(({ id, revisions }) => (
                <article key={id} className="record-card directive-card">
                  <h3>{id}</h3>
                  {revisions.map((d) => {
                    const revisionTasks = views.filter(
                      (v) => v.directive.id === d.id && v.directive.revision === d.revision,
                    );
                    return (
                      <div key={`${d.id}-${d.revision}`} className="revision-block">
                        <div className="revision-head">
                          <strong>
                            R{d.revision} · {d.title}
                          </strong>
                          <span className={d.status === "active" ? "badge badge-due" : "badge badge-muted"}>
                            {d.status === "active" ? "现行" : "已换版"}
                          </span>
                        </div>
                        <p>
                          适用构型：{d.applicableModels.join("、")} / {d.applicableModBatches.join("、")} ·
                          日历到期 {d.calendarDue} · 门槛 {d.flightHourThreshold}h · 发布于 {formatTime(d.issuedAt)}
                        </p>
                        {revisionTasks.length > 0 ? (
                          <ul className="revision-tasks">
                            {revisionTasks.map((v) => (
                              <li key={v.task.id}>
                                {v.aircraft.sn} — {statusLabel(v.task)}
                                {v.task.completedAt && ` · 执行 ${v.task.completedBy} ${formatTime(v.task.completedAt)}`}
                                {v.task.reviewedAt && ` · 复核 ${v.task.reviewedBy} ${formatTime(v.task.reviewedAt)}`}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted-line">该版次无任务记录。</p>
                        )}
                      </div>
                    );
                  })}
                </article>
                ))}
            </div>
          </section>
        </>
      )}

      <section className="panel archive-panel">
        <div className="section-heading">
          <div>
            <p>页面与本机留档同步保存，刷新或重开可接着办理</p>
            <h2>本机留档</h2>
          </div>
          <div className="task-actions inline">
            <button onClick={() => exportArchive(state)}>导出留档</button>
            <label className="file-button">
              导入留档
              <input
                type="file"
                accept="application/json"
                onChange={(e) => handleImportArchive(e.target.files?.[0])}
              />
            </label>
            <button onClick={() => update(seedState, "已重置为演示台账")}>重置演示数据</button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
