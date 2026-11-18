import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayLink, DaySelection } from "./day-selection";

const url = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(url.search) }));
afterEach(() => vi.unstubAllGlobals());

function render() {
  return renderToStaticMarkup(DaySelection({
    days: { "2026-11-18": "Wednesday run", "2026-11-19": "Thursday rest" },
    children: "Today overview",
  }));
}

describe("local day selection", () => {
  it("updates history without requesting another server navigation", () => {
    const pushState = vi.fn();
    const preventDefault = vi.fn();
    vi.stubGlobal("window", { history: { pushState } });
    url.search = "day=2026-11-19";
    const link = DayLink({
      date: "2026-11-19", selectedDate: "2026-11-18",
      dates: ["2026-11-18", "2026-11-19"],
      children: "Thursday", className: "week-day", "aria-label": "Thursday",
    });
    expect(link.props["aria-current"]).toBe("true");
    expect(link.props.href).toBe("/?day=2026-11-19");
    expect(link.props.prefetch).toBe(false);
    link.props.onNavigate({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledWith(null, "", "/?day=2026-11-19");
  });

  it("shows the overview without a day and rejects dates outside the loaded week", () => {
    for (const search of ["", "day=2026-11-01", "day=toString", "day=__proto__"]) {
      url.search = search;
      expect(render()).toBe("Today overview");
    }
  });

  it("follows the URL for direct links, day switches and back/forward navigation", () => {
    for (const [search, expected] of [
      ["day=2026-11-18", "Wednesday run"],
      ["day=2026-11-19", "Thursday rest"],
      ["day=2026-11-18", "Wednesday run"],
      ["", "Today overview"],
    ]) {
      url.search = search;
      expect(render()).toBe(expected);
    }
  });
});
