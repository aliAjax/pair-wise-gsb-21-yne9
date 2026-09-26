import type { Aircraft, AuditEvent, Directive, ExecutionRecord, LedgerState, RecordStatus } from "../types";
import { STATUS_LABEL } from "../ledger";

export function findDirective(state: LedgerState, key: string): Directive | undefined {
  return state.directives.find((d) => d.key === key);
}

export function findAircraft(state: LedgerState, msn: string): Aircraft | undefined {
  return state.aircraft.find((a) => a.msn === msn);
}

export function StatusBadge({ status }: { status: RecordStatus }) {
  return <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** 记录抬头：指令 + 飞机一行摘要 */
export function RecordHead({ state, record }: { state: LedgerState; record: ExecutionRecord }) {
  const d = findDirective(state, record.directiveKey);
  const ac = findAircraft(state, record.msn);
  return (
    <div className="record-head">
      <div>
        <h3>
          {record.directiveKey.replace("@", " ")}
          {d?.superseded && <span className="badge st-superseded">已换版</span>}
        </h3>
        <p>{d?.title ?? "（指令已移除）"}</p>
      </div>
      <div className="record-aircraft">
        <strong>MSN {record.msn}</strong>
        <span>
          {ac ? `${ac.model} · 批次 ${ac.modBatch} · ${ac.flightHours.toLocaleString()} h` : "飞机已移除"}
        </span>
      </div>
    </div>
  );
}

/** 触发条件徽标：达到任一条件即列待执行 */
export function TriggerBadges({ state, record }: { state: LedgerState; record: ExecutionRecord }) {
  const d = findDirective(state, record.directiveKey);
  const ac = findAircraft(state, record.msn);
  if (!d) return null;
  return (
    <div className="triggers">
      {record.dueByCalendar && <span className="trigger trigger-calendar">日历到期 · 期限 {d.calendarDue}</span>}
      {record.dueByHours && (
        <span className="trigger trigger-hours">
          小时到门槛 · {ac ? ac.flightHours.toLocaleString() : "?"} / {d.hourThreshold.toLocaleString()} h
        </span>
      )}
      {!record.dueByCalendar && !record.dueByHours && (
        <span className="trigger trigger-none">
          未到期 · 日历 {d.calendarDue} / 门槛 {d.hourThreshold.toLocaleString()} h
        </span>
      )}
    </div>
  );
}

export function HistoryDetails({ history }: { history: AuditEvent[] }) {
  return (
    <details className="history">
      <summary>操作轨迹（{history.length}）</summary>
      <ul>
        {history.map((h, i) => (
          <li key={i}>
            <span className="history-at">{h.at}</span>
            <strong>{h.actor}</strong> · {h.action} — {h.detail}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}
