import { afterEach, expect, it, vi } from "vitest";
import { AutoRefresh } from "./auto-refresh";

const state = vi.hoisted(() => ({ refresh: vi.fn(), effect: undefined as undefined | (() => () => void) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("react", () => ({ useEffect: (effect: () => () => void) => { state.effect = effect; } }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("polls only when visible and online, catches up on return, and cleans up", () => {
  vi.useFakeTimers();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const window = new EventTarget();
  const navigator = { onLine: true };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("navigator", navigator);
  AutoRefresh({ seconds: 8 });
  const cleanup = state.effect!();
  vi.advanceTimersByTime(8000);
  expect(state.refresh).toHaveBeenCalledTimes(1);
  document.visibilityState = "hidden";
  vi.advanceTimersByTime(24000);
  expect(state.refresh).toHaveBeenCalledTimes(1);
  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  expect(state.refresh).toHaveBeenCalledTimes(2);
  navigator.onLine = false;
  vi.advanceTimersByTime(8000);
  expect(state.refresh).toHaveBeenCalledTimes(2);
  navigator.onLine = true;
  window.dispatchEvent(new Event("online"));
  expect(state.refresh).toHaveBeenCalledTimes(3);
  cleanup();
  vi.advanceTimersByTime(8000);
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("online"));
  expect(state.refresh).toHaveBeenCalledTimes(3);
});
