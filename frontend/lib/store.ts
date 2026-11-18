import { create } from "zustand";
import { flushSync } from "react-dom";
export type Page =
  | "overview"
  | "accounts"
  | "tasks"
  | "automation"
  | "logs"
  | "tools"
  | "settings";
interface UI {
  page: Page;
  setPage: (page: Page) => void;
  revision: number;
  refresh: () => void;
  authOpen: boolean;
  setAuthOpen: (v: boolean) => void;
}
type Transition = { finished: Promise<void>; skipTransition: () => void };
let activeTransition: Transition | undefined;
export const useUI = create<UI>((set, get) => ({
  page: "overview",
  setPage: (page) => {
    if (get().page === page) return;
    const update = () => flushSync(() => set({ page }));
    if (typeof document === "undefined") {
      set({ page });
      return;
    }
    const viewDocument = document as Document & {
      startViewTransition?: (update: () => void) => Transition;
    };
    const focus = () =>
      document.getElementById("page-heading")?.focus({ preventScroll: true });
    if (
      get().page === "overview" ||
      page === "overview" ||
      !viewDocument.startViewTransition ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motion === "paused" ||
      document.querySelector("dialog[open]")
    ) {
      update();
      focus();
      return;
    }
    activeTransition?.skipTransition();
    const transition = viewDocument.startViewTransition(update);
    activeTransition = transition;
    transition.finished
      .catch(() => {})
      .then(() => {
        if (activeTransition === transition) {
          activeTransition = undefined;
          focus();
        }
      });
  },
  revision: 0,
  refresh: () => set((s) => ({ revision: s.revision + 1 })),
  authOpen: false,
  setAuthOpen: (authOpen) => set({ authOpen }),
}));
