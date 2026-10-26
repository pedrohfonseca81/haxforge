// Short messages at the bottom of the screen.
import { Store } from "../vendor/kickr/client/store";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}
export const toasts = new Store<Toast[]>([]);
let toastId = 0;
export function toast(text: string, kind: Toast["kind"] = "info"): void {
  const id = ++toastId;
  toasts.set([...toasts.get(), { id, text, kind }]);
  setTimeout(() => toasts.set(toasts.get().filter((t) => t.id !== id)), kind === "error" ? 6000 : 2800);
}
