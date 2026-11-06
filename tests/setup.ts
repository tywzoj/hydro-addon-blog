import { afterAll, afterEach, vi } from "vitest";

vi.mock("hydrooj", () => import("./helpers/hydro"));
vi.stubGlobal("Hydro", { model: {} });

afterEach(() => {
    vi.useRealTimers();
});

afterAll(() => {
    vi.unstubAllGlobals();
});
