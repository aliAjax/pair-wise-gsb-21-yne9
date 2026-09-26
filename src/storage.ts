import type { LedgerState } from "./types";
import { seedState } from "./seed";

const STORAGE_KEY = "hxwl07-ad-ledger-v1";
const OPERATOR_KEY = "hxwl07-ad-ledger-operator";

const isLedgerState = (value: unknown): value is LedgerState => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.aircraft) && Array.isArray(v.directives) && Array.isArray(v.tasks);
};

/** 读取本机留档；无存档或存档损坏时回到初始台账 */
export function loadState(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState;
    const parsed: unknown = JSON.parse(raw);
    return isLedgerState(parsed) ? parsed : seedState;
  } catch {
    return seedState;
  }
}

export function saveState(state: LedgerState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadOperator(): string {
  return localStorage.getItem(OPERATOR_KEY) ?? "";
}

export function saveOperator(name: string): void {
  localStorage.setItem(OPERATOR_KEY, name);
}

/** 导出本机留档（JSON 文件），便于交接与归档 */
export function exportArchive(state: LedgerState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `适航指令执行期限台账_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 从留档文件恢复，结构不符时返回 null */
export function parseArchive(text: string): LedgerState | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isLedgerState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
