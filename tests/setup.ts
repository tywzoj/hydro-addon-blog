import type { Collection } from "mongodb";
import { afterAll, afterEach, beforeEach, vi } from "vitest";

import { BlogReviewModel } from "../features/review/review.model";
import type { BlogReport } from "../features/shared/types";

vi.mock("hydrooj", () => import("./helpers/hydro"));
vi.stubGlobal("Hydro", { model: {} });

beforeEach(() => {
    BlogReviewModel.reports = {
        findOne: vi.fn(),
        updateOne: vi.fn(),
        deleteOne: vi.fn(),
        deleteMany: vi.fn(),
    } as unknown as Collection<BlogReport>;
});

afterEach(() => {
    vi.useRealTimers();
});

afterAll(() => {
    vi.unstubAllGlobals();
});
