import { useEffect, useMemo, useState } from "react";
import * as L from "./ledger";
import type { Aircraft, LedgerState } from "./types";

export interface Notice {
  kind: "ok" | "warn" | "error";
  text: string;
}

export function useLedger() {
  const [state, setState] = useState<LedgerState>(() => L.loadState());
  const [notice, setNotice] = useState<Notice | null>(null);

  // 每次变更自动写入本机留档（localStorage），刷新/关机后可接着办理
  useEffect(() => {
    L.saveState(state);
  }, [state]);

  const actions = useMemo(
    () => ({
      importDirective(input: L.DirectiveInput) {
        setState((prev) => {
          const r = L.importDirective(prev, input);
          setNotice({ kind: r.created ? "ok" : "warn", text: r.message });
          return r.state;
        });
      },
      reportCompletion(id: string, data: L.CompletionInput) {
        setState((prev) => {
          const r = L.reportCompletion(prev, id, data);
          setNotice({ kind: r.ok ? "ok" : "error", text: r.message });
          return r.state;
        });
      },
      reviewRecord(id: string, data: L.ReviewInput) {
        setState((prev) => {
          const r = L.reviewRecord(prev, id, data);
          setNotice({ kind: r.ok ? "ok" : "error", text: r.message });
          return r.state;
        });
      },
      supplementRecord(id: string, data: L.SupplementInput) {
        setState((prev) => {
          const r = L.supplementRecord(prev, id, data);
          setNotice({ kind: r.ok ? "ok" : "warn", text: r.message });
          return r.state;
        });
      },
      updateFlightHours(msn: string, hours: number) {
        setState((prev) => {
          const r = L.updateFlightHours(prev, msn, hours);
          setNotice({ kind: r.ok ? "ok" : "error", text: r.message });
          return r.state;
        });
      },
      addAircraft(ac: Aircraft) {
        setState((prev) => {
          const r = L.addAircraft(prev, ac);
          setNotice({ kind: r.ok ? "ok" : "error", text: r.message });
          return r.state;
        });
      },
      exportArchive() {
        const blob = new Blob([L.exportArchive(state)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ad-ledger-${L.todayStr()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setNotice({ kind: "ok", text: "留档文件已导出，可移交或归档；恢复后继续办理。" });
      },
      importArchive(text: string) {
        try {
          const restored = L.parseArchive(text);
          setState(restored);
          setNotice({ kind: "ok", text: "留档已恢复，可接着办理。" });
        } catch (e) {
          setNotice({ kind: "error", text: `恢复失败：${e instanceof Error ? e.message : "文件无法解析"}` });
        }
      },
      reset() {
        setState(L.freshSeed());
        setNotice({ kind: "warn", text: "已重置为示例台账，本机留档同步覆盖。" });
      },
    }),
    [state]
  );

  return { state, notice, dismissNotice: () => setNotice(null), actions };
}
