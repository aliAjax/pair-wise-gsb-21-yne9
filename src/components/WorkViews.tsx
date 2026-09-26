import { useState } from "react";
import type { ExecutionRecord, LedgerState } from "../types";
import { ROSTER, activeDirectiveKeys, nowInputValue, todayStr } from "../ledger";
import { EmptyState, HistoryDetails, RecordHead, TriggerBadges, findAircraft, findDirective } from "./common";

interface WorkProps {
  state: LedgerState;
  onReport: (id: string, data: { completedBy: string; workBasis: string; completedAt: string }) => void;
  onReview: (id: string, data: { reviewedBy: string; reviewBasis: string; pass: boolean; note?: string }) => void;
  onSupplement: (id: string, data: { completedBy: string; workBasis: string; note: string }) => void;
}

function activeRecords(state: LedgerState): ExecutionRecord[] {
  const keys = activeDirectiveKeys(state);
  return state.records.filter((r) => keys.has(r.directiveKey));
}

// ---------- 待办清单 ----------

function ReportForm({ record, onReport }: { record: ExecutionRecord; onReport: WorkProps["onReport"] }) {
  const [by, setBy] = useState("");
  const [basis, setBasis] = useState("");
  const [at, setAt] = useState(nowInputValue());
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onReport(record.id, { completedBy: by, workBasis: basis, completedAt: at });
      }}
    >
      <label>
        <span>执行人员</span>
        <select value={by} onChange={(e) => setBy(e.target.value)}>
          <option value="">请选择</option>
          {ROSTER.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>执行依据（工单 / EO 号）</span>
        <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="如 EO-26-0204" />
      </label>
      <label>
        <span>完成时刻</span>
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </label>
      <button type="submit" className="primary-action">
        登记完成
      </button>
      <p className="form-hint">执行人员或依据未填将按材料不齐转入待补区。</p>
    </form>
  );
}

export function PendingView({ state, onReport }: WorkProps) {
  const records = activeRecords(state);
  const due = records.filter((r) => r.status === "due");
  const monitoring = records.filter((r) => r.status === "monitoring");
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayStr();

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>达到任一条件即列入</p>
          <h2>待执行（{due.length}）</h2>
        </div>
      </div>
      {due.length === 0 && <EmptyState text="暂无待执行项目。" />}
      <div className="record-list">
        {due.map((r) => (
          <article key={r.id} className="record-card wide">
            <RecordHead state={state} record={r} />
            <TriggerBadges state={state} record={r} />
            {openId === r.id ? (
              <ReportForm record={r} onReport={onReport} />
            ) : (
              <div className="card-actions">
                <button className="primary-action" onClick={() => setOpenId(r.id)}>
                  登记执行
                </button>
              </div>
            )}
            <HistoryDetails history={r.history} />
          </article>
        ))}
      </div>

      <div className="section-heading monitor-heading">
        <div>
          <p>尚未到期的适用飞机</p>
          <h2>监控中（{monitoring.length}）</h2>
        </div>
      </div>
      {monitoring.length === 0 && <EmptyState text="暂无监控中的项目。" />}
      {monitoring.length > 0 && (
        <table className="ledger-table">
          <thead>
            <tr>
              <th>指令</th>
              <th>飞机</th>
              <th>日历到期</th>
              <th>剩余天数</th>
              <th>小时门槛</th>
              <th>剩余小时</th>
            </tr>
          </thead>
          <tbody>
            {monitoring.map((r) => {
              const d = findDirective(state, r.directiveKey);
              const ac = findAircraft(state, r.msn);
              if (!d || !ac) return null;
              const daysLeft = Math.ceil((Date.parse(d.calendarDue) - Date.parse(today)) / 86400000);
              const hoursLeft = d.hourThreshold - ac.flightHours;
              return (
                <tr key={r.id}>
                  <td>{r.directiveKey.replace("@", " ")}</td>
                  <td>
                    MSN {r.msn} · {ac.model} / {ac.modBatch}
                  </td>
                  <td>{d.calendarDue}</td>
                  <td>{daysLeft} 天</td>
                  <td>{d.hourThreshold.toLocaleString()} h</td>
                  <td>{hoursLeft.toLocaleString()} h</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------- 待复核 ----------

function ReviewForm({ record, onReview }: { record: ExecutionRecord; onReview: WorkProps["onReview"] }) {
  const [reviewer, setReviewer] = useState("");
  const [basis, setBasis] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const submit = (pass: boolean) => {
    if (!reviewer) {
      setError("请选择复核放行人员。");
      return;
    }
    if (record.completedBy && reviewer === record.completedBy) {
      setError(`${reviewer} 参加了本次工作，须由未参加的放行人员复核。`);
      return;
    }
    setError("");
    onReview(record.id, { reviewedBy: reviewer, reviewBasis: basis, pass, note });
  };

  return (
    <div className="inline-form-wrap">
      <div className="inline-form">
        <label>
          <span>复核放行人员（须未参加本次工作）</span>
          <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
            <option value="">请选择</option>
            {ROSTER.map((n) => (
              <option key={n} value={n} disabled={n === record.completedBy}>
                {n}
                {n === record.completedBy ? "（本次执行人员）" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>复核依据</span>
          <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="如 工单 WO-260925 及附件" />
        </label>
        <label>
          <span>退回说明（转待补时填写）</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="缺哪些材料" />
        </label>
        <div className="button-row">
          <button type="button" className="primary-action" onClick={() => submit(true)}>
            复核通过
          </button>
          <button type="button" onClick={() => submit(false)}>
            材料不齐，转待补
          </button>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export function ReviewView({ state, onReview }: WorkProps) {
  const list = activeRecords(state).filter((r) => r.status === "awaiting-review");
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>由未参加本次工作的放行人员复核</p>
          <h2>待复核（{list.length}）</h2>
        </div>
      </div>
      {list.length === 0 && <EmptyState text="暂无待复核项目。" />}
      <div className="record-list">
        {list.map((r) => (
          <article key={r.id} className="record-card wide">
            <RecordHead state={state} record={r} />
            <dl className="fact-grid">
              <div>
                <dt>执行人员</dt>
                <dd>{r.completedBy ?? "—"}</dd>
              </div>
              <div>
                <dt>完成时刻</dt>
                <dd>{r.completedAt ?? "—"}</dd>
              </div>
              <div>
                <dt>执行依据</dt>
                <dd>{r.workBasis ?? "—"}</dd>
              </div>
            </dl>
            <ReviewForm record={r} onReview={onReview} />
            <HistoryDetails history={r.history} />
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------- 待补区 ----------

function SupplementForm({ record, onSupplement }: { record: ExecutionRecord; onSupplement: WorkProps["onSupplement"] }) {
  const [by, setBy] = useState(record.completedBy ?? "");
  const [basis, setBasis] = useState(record.workBasis ?? "");
  const [note, setNote] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSupplement(record.id, { completedBy: by, workBasis: basis, note });
      }}
    >
      <label>
        <span>执行人员</span>
        <select value={by} onChange={(e) => setBy(e.target.value)}>
          <option value="">请选择</option>
          {ROSTER.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>执行依据（工单 / EO 号）</span>
        <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="补齐缺失依据" />
      </label>
      <label>
        <span>补充说明</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 已补 EO 签署页" />
      </label>
      <button type="submit" className="primary-action">
        补齐并提交复核
      </button>
    </form>
  );
}

export function SupplementView({ state, onSupplement }: WorkProps) {
  const list = activeRecords(state).filter((r) => r.status === "pending-supplement");
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>材料不齐，补齐前不进入复核</p>
          <h2>待补区（{list.length}）</h2>
        </div>
      </div>
      {list.length === 0 && <EmptyState text="待补区为空。" />}
      <div className="record-list">
        {list.map((r) => (
          <article key={r.id} className="record-card wide">
            <RecordHead state={state} record={r} />
            <p className="supplement-note">待补原因：{r.supplementNote ?? "材料不齐"}</p>
            <SupplementForm record={r} onSupplement={onSupplement} />
            <HistoryDetails history={r.history} />
          </article>
        ))}
      </div>
    </section>
  );
}
