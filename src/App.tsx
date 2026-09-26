import { useRef, useState } from "react";
import "./styles.css";
import { useLedger } from "./useLedger";
import { activeDirectiveKeys } from "./ledger";
import { PendingView, ReviewView, SupplementView } from "./components/WorkViews";
import { ArchiveView, DirectivesView, FleetView } from "./components/AdminViews";

type Tab = "pending" | "review" | "supplement" | "fleet" | "directives" | "archive";

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "待办清单" },
  { key: "review", label: "待复核" },
  { key: "supplement", label: "待补区" },
  { key: "fleet", label: "机队台账" },
  { key: "directives", label: "指令库" },
  { key: "archive", label: "排除与档案" },
];

function App() {
  const { state, notice, dismissNotice, actions } = useLedger();
  const [tab, setTab] = useState<Tab>("pending");
  const fileRef = useRef<HTMLInputElement>(null);

  const active = activeDirectiveKeys(state);
  const open = state.records.filter((r) => active.has(r.directiveKey));
  const count = (s: string) => open.filter((r) => r.status === s).length;
  const metrics: { label: string; value: number; cls: string }[] = [
    { label: "待执行", value: count("due"), cls: "status-danger" },
    { label: "待复核", value: count("awaiting-review"), cls: "status-watch" },
    { label: "待补", value: count("pending-supplement"), cls: "status-watch" },
    { label: "监控中", value: count("monitoring"), cls: "status-ok" },
    { label: "已闭环", value: state.records.filter((r) => r.status === "closed").length, cls: "status-ok" },
  ];

  const workProps = {
    state,
    onReport: actions.reportCompletion,
    onReview: actions.reviewRecord,
    onSupplement: actions.supplementRecord,
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-07 · port 5107</p>
          <h1>适航指令执行期限台账</h1>
          <p className="subtitle">
            按适用构型（机型 + 改装批次）精确匹配飞机，日历到期或飞行小时到门槛任一条件达成即列待执行；
            完成后由未参加本次工作的放行人员复核闭环，材料不齐留在待补区，换版只重算尚未执行的飞机。
          </p>
        </div>
        <div className="stack-card">
          <span>本机留档</span>
          <strong>改动自动存入本机，刷新后可接着办理</strong>
          <div className="archive-actions">
            <button onClick={actions.exportArchive}>导出留档</button>
            <button onClick={() => fileRef.current?.click()}>恢复留档</button>
            <button
              onClick={() => {
                if (window.confirm("确定重置为示例台账？当前本机留档将被覆盖。")) actions.reset();
              }}
            >
              重置示例
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                f.text().then(actions.importArchive);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </section>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button onClick={dismissNotice}>知道了</button>
        </div>
      )}

      <section className="metrics-grid">
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={m.cls} />
          </article>
        ))}
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "pending" && <PendingView {...workProps} />}
      {tab === "review" && <ReviewView {...workProps} />}
      {tab === "supplement" && <SupplementView {...workProps} />}
      {tab === "fleet" && <FleetView state={state} onImport={actions.importDirective} onUpdateHours={actions.updateFlightHours} onAddAircraft={actions.addAircraft} />}
      {tab === "directives" && <DirectivesView state={state} onImport={actions.importDirective} onUpdateHours={actions.updateFlightHours} onAddAircraft={actions.addAircraft} />}
      {tab === "archive" && <ArchiveView state={state} />}
    </main>
  );
}

export default App;
