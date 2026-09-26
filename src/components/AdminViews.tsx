import { useState } from "react";
import type { Aircraft, Directive, LedgerState } from "../types";
import { DirectiveInput, activeDirectiveKeys, deriveExclusions } from "../ledger";
import { EmptyState, HistoryDetails, RecordHead, StatusBadge, findDirective } from "./common";

interface AdminProps {
  state: LedgerState;
  onImport: (input: DirectiveInput) => void;
  onUpdateHours: (msn: string, hours: number) => void;
  onAddAircraft: (ac: Aircraft) => void;
}

// ---------- 机队台账 ----------

function HoursCell({ msn, hours, onSave }: { msn: string; hours: number; onSave: (msn: string, h: number) => void }) {
  const [value, setValue] = useState(String(hours));
  const dirty = Number(value) !== hours && value.trim() !== "" && !Number.isNaN(Number(value));
  return (
    <div className="hours-cell">
      <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
      <button disabled={!dirty} onClick={() => onSave(msn, Number(value))}>
        保存
      </button>
    </div>
  );
}

export function FleetView({ state, onUpdateHours, onAddAircraft }: AdminProps) {
  const keys = activeDirectiveKeys(state);
  const [msn, setMsn] = useState("");
  const [model, setModel] = useState("");
  const [batch, setBatch] = useState("");
  const [hours, setHours] = useState("");
  const models = [...new Set(state.aircraft.map((a) => a.model))];

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>型号 / 序列号 / 改装状态 / 当前飞行小时</p>
          <h2>机队台账（{state.aircraft.length}）</h2>
        </div>
      </div>
      <table className="ledger-table">
        <thead>
          <tr>
            <th>序列号</th>
            <th>型号</th>
            <th>改装批次</th>
            <th>当前飞行小时</th>
            <th>待执行 / 监控</th>
          </tr>
        </thead>
        <tbody>
          {state.aircraft.map((a) => {
            const mine = state.records.filter((r) => r.msn === a.msn && keys.has(r.directiveKey));
            const due = mine.filter((r) => r.status === "due").length;
            const monitoring = mine.filter((r) => r.status === "monitoring").length;
            return (
              <tr key={a.msn}>
                <td>MSN {a.msn}</td>
                <td>{a.model}</td>
                <td>
                  <span className="badge st-batch">{a.modBatch}</span>
                </td>
                <td>
                  <HoursCell msn={a.msn} hours={a.flightHours} onSave={onUpdateHours} />
                </td>
                <td>
                  {due} / {monitoring}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 className="sub-heading">登记新飞机</h3>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!msn.trim() || !model.trim() || !batch.trim() || hours.trim() === "") return;
          onAddAircraft({ msn: msn.trim(), model: model.trim(), modBatch: batch.trim(), flightHours: Number(hours) });
          setMsn("");
          setModel("");
          setBatch("");
          setHours("");
        }}
      >
        <label>
          <span>序列号</span>
          <input value={msn} onChange={(e) => setMsn(e.target.value)} placeholder="如 10241" />
        </label>
        <label>
          <span>型号</span>
          <input list="model-list" value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 A320" />
          <datalist id="model-list">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          <span>改装批次</span>
          <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="如 M1" />
        </label>
        <label>
          <span>当前飞行小时</span>
          <input type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="如 9800" />
        </label>
        <button type="submit" className="primary-action">
          登记并评估适用指令
        </button>
      </form>
    </section>
  );
}

// ---------- 指令库 ----------

interface DirectiveFormProps {
  initial: DirectiveInput;
  submitLabel: string;
  onSubmit: (input: DirectiveInput) => void;
}

function DirectiveForm({ initial, submitLabel, onSubmit }: DirectiveFormProps) {
  const [number, setNumber] = useState(initial.number);
  const [revision, setRevision] = useState(String(initial.revision));
  const [title, setTitle] = useState(initial.title);
  const [model, setModel] = useState(initial.applicableModel);
  const [batches, setBatches] = useState(initial.applicableBatches.join(","));
  const [due, setDue] = useState(initial.calendarDue);
  const [threshold, setThreshold] = useState(String(initial.hourThreshold));
  const [error, setError] = useState("");

  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        const rev = Number(revision);
        const th = Number(threshold);
        if (!number.trim() || !title.trim() || !model.trim() || !batches.trim() || !due) {
          setError("编号、标题、适用机型、适用批次、日历到期日均为必填。");
          return;
        }
        if (!Number.isInteger(rev) || rev < 0 || Number.isNaN(th) || th < 0) {
          setError("版次须为不小于 0 的整数，小时门槛须为不小于 0 的数字。");
          return;
        }
        setError("");
        onSubmit({
          number: number.trim(),
          revision: rev,
          title: title.trim(),
          applicableModel: model.trim(),
          applicableBatches: batches.split(/[,，、]/).map((b) => b.trim()).filter(Boolean),
          calendarDue: due,
          hourThreshold: th,
        });
      }}
    >
      <label>
        <span>指令编号</span>
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="如 AD-2026-015" />
      </label>
      <label>
        <span>版次</span>
        <input type="number" min={0} value={revision} onChange={(e) => setRevision(e.target.value)} />
      </label>
      <label>
        <span>标题</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="指令标题" />
      </label>
      <label>
        <span>适用机型</span>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 A320" />
      </label>
      <label>
        <span>适用改装批次（逗号分隔）</span>
        <input value={batches} onChange={(e) => setBatches(e.target.value)} placeholder="如 M1,M2" />
      </label>
      <label>
        <span>日历到期日</span>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <label>
        <span>飞行小时门槛</span>
        <input type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="如 15000" />
      </label>
      <button type="submit" className="primary-action">
        {submitLabel}
      </button>
      {error && <p className="error-text">{error}</p>}
      <p className="form-hint">同编号同版次重复导入将被忽略；同编号更高版次按换版处理，仅重算尚未执行飞机的期限。</p>
    </form>
  );
}

const blankDirective: DirectiveInput = {
  number: "",
  revision: 0,
  title: "",
  applicableModel: "",
  applicableBatches: [],
  calendarDue: "",
  hourThreshold: 0,
};

export function DirectivesView({ state, onImport }: AdminProps) {
  const [formInitial, setFormInitial] = useState<DirectiveInput>(blankDirective);
  const [formKey, setFormKey] = useState(0);
  const keys = activeDirectiveKeys(state);
  const sorted = [...state.directives].sort((a, b) => Number(a.superseded) - Number(b.superseded) || b.issuedAt.localeCompare(a.issuedAt));

  const supersededBy = (d: Directive): Directive | undefined =>
    state.directives
      .filter((x) => x.number === d.number && x.revision > d.revision)
      .sort((a, b) => b.revision - a.revision)[0];

  return (
    <div className="directives-layout">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>适用构型 · 日历到期 · 小时门槛</p>
            <h2>指令库（{state.directives.length}）</h2>
          </div>
        </div>
        <div className="record-list">
          {sorted.map((d) => {
            const mine = state.records.filter((r) => r.directiveKey === d.key);
            const due = mine.filter((r) => r.status === "due").length;
            const closed = mine.filter((r) => r.status === "closed").length;
            const next = d.superseded ? supersededBy(d) : undefined;
            return (
              <article key={d.key} className={`record-card wide ${d.superseded ? "is-superseded" : ""}`}>
                <div className="record-head">
                  <div>
                    <h3>
                      {d.number} R{d.revision}
                      {d.superseded && <span className="badge st-superseded">已被 R{next?.revision ?? "?"} 取代</span>}
                    </h3>
                    <p>{d.title}</p>
                  </div>
                  {!d.superseded && (
                    <button
                      onClick={() => {
                        setFormInitial({
                          number: d.number,
                          revision: d.revision + 1,
                          title: d.title,
                          applicableModel: d.applicableModel,
                          applicableBatches: d.applicableBatches,
                          calendarDue: d.calendarDue,
                          hourThreshold: d.hourThreshold,
                        });
                        setFormKey((k) => k + 1);
                      }}
                    >
                      换版
                    </button>
                  )}
                </div>
                <div className="triggers">
                  <span className="trigger trigger-none">
                    适用构型：{d.applicableModel} / 批次 {d.applicableBatches.join("、")}
                  </span>
                  <span className="trigger trigger-calendar">日历到期 {d.calendarDue}</span>
                  <span className="trigger trigger-hours">门槛 {d.hourThreshold.toLocaleString()} h</span>
                </div>
                <p className="directive-stats">
                  待执行 {due} · 已闭环 {closed} · 记录 {mine.length} 条 · 签发 {d.issuedAt}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>工程部门发布</p>
            <h2>导入指令</h2>
          </div>
        </div>
        <DirectiveForm
          key={formKey}
          initial={formInitial}
          submitLabel={formInitial.number ? `导入 R${formInitial.revision}（换版）` : "导入指令"}
          onSubmit={(input) => {
            onImport(input);
            setFormInitial(blankDirective);
            setFormKey((k) => k + 1);
          }}
        />
        <h3 className="sub-heading">导入 / 换版日志</h3>
        {state.importLog.length === 0 && <EmptyState text="暂无日志。" />}
        <ul className="log-list">
          {[...state.importLog].reverse().map((l, i) => (
            <li key={i}>
              <span className="history-at">{l.at}</span>
              <strong>{l.actor}</strong> · {l.action} — {l.detail}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------- 排除与档案 ----------

export function ArchiveView({ state }: { state: LedgerState }) {
  const exclusions = deriveExclusions(state);
  const keys = activeDirectiveKeys(state);
  const archived = state.records.filter((r) => r.status === "closed" || !keys.has(r.directiveKey));

  return (
    <div className="directives-layout">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>构型不匹配的飞机不进入待办</p>
            <h2>排除说明（{exclusions.length}）</h2>
          </div>
        </div>
        {exclusions.length === 0 && <EmptyState text="暂无排除项。" />}
        {exclusions.length > 0 && (
          <table className="ledger-table">
            <thead>
              <tr>
                <th>指令</th>
                <th>飞机</th>
                <th>排除原因</th>
              </tr>
            </thead>
            <tbody>
              {exclusions.map((x, i) => (
                <tr key={i}>
                  <td>{x.directiveKey.replace("@", " ")}</td>
                  <td>MSN {x.msn}</td>
                  <td>{x.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>已闭环记录与换版前的旧记录</p>
            <h2>档案（{archived.length}）</h2>
          </div>
        </div>
        {archived.length === 0 && <EmptyState text="暂无档案记录。" />}
        <div className="record-list">
          {archived.map((r) => {
            const d = findDirective(state, r.directiveKey);
            return (
              <article key={r.id} className="record-card wide">
                <RecordHead state={state} record={r} />
                <div className="card-actions">
                  <StatusBadge status={r.status} />
                  {d?.superseded && <span className="badge st-superseded">旧版留档</span>}
                </div>
                <dl className="fact-grid">
                  <div>
                    <dt>执行人员 / 时刻</dt>
                    <dd>
                      {r.completedBy ?? "—"} {r.completedAt ? `· ${r.completedAt}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>执行依据</dt>
                    <dd>{r.workBasis ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>复核放行 / 时刻</dt>
                    <dd>
                      {r.reviewedBy ?? "—"} {r.reviewedAt ? `· ${r.reviewedAt}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>复核依据</dt>
                    <dd>{r.reviewBasis ?? "—"}</dd>
                  </div>
                </dl>
                <HistoryDetails history={r.history} />
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
