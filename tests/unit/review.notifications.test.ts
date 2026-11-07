import type { Context, User } from "hydrooj";
import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BLOG_PERM, DEFAULT_REVIEW_SETTINGS } from "../../features/constants";
import { BlogReviewModel } from "../../features/review.model";
import { BlogReviewNotifications } from "../../features/review.notifications";
import { BlogSettingsModel, initialSettings, resolveBlogPolicy } from "../../features/settings.model";
import type { BlogAssignment, BlogSettings } from "../../features/types";
import { makeBlog } from "../helpers/fixtures";
import { DocumentModel, makeUser, MessageModel, PRIV, ScheduleModel, SystemModel, UserModel } from "../helpers/hydro";

const runtime = { updateOne: vi.fn(), findOneAndUpdate: vi.fn(), findOne: vi.fn() };
let service: BlogReviewNotifications;
let settings: BlogSettings;
let users: { _id: number; priv: number }[];
let assignments: BlogAssignment[];

function cursor<T>(values: T[]) {
    const result = {
        project: () => result,
        sort: () => result,
        limit: (size: number) => cursor(values.slice(0, size)),
        toArray: () => Promise.resolve(values),
    };
    return result;
}

beforeEach(() => {
    vi.resetAllMocks();
    settings = initialSettings();
    settings.roles[1].permissions = (BigInt(settings.roles[1].permissions) | BLOG_PERM.REVIEW).toString();
    users = Array.from({ length: 205 }, (_, i) => ({ _id: i + 1, priv: PRIV.PRIV_USER_PROFILE }));
    assignments = [];
    runtime.updateOne.mockResolvedValue({ matchedCount: 1 });
    runtime.findOneAndUpdate.mockResolvedValue({ runId: "claimed" });
    service = new BlogReviewNotifications({
        db: { collection: () => runtime },
        server: { router: { url: () => "/blog/review" } },
    } as unknown as Context);
    SystemModel.get.mockReturnValue("http://127.0.0.1:8888");
    vi.spyOn(BlogSettingsModel, "get").mockImplementation(() => Promise.resolve(settings));
    vi.spyOn(BlogSettingsModel, "review").mockImplementation(() =>
        Promise.resolve({ ...DEFAULT_REVIEW_SETTINGS, ...settings.review }),
    );
    vi.spyOn(BlogSettingsModel, "policy").mockImplementation((user) =>
        Promise.resolve(resolveBlogPolicy(user, settings)),
    );
    vi.spyOn(BlogReviewModel, "count").mockResolvedValue(7);
    BlogSettingsModel.users = {
        find: ({ _id }: { _id: { $in: number[] } }) => cursor(assignments.filter((a) => _id.$in.includes(a._id))),
    } as unknown as typeof BlogSettingsModel.users;
    UserModel.coll.findOne.mockImplementation(() => Promise.resolve(users[users.length - 1]));
    UserModel.coll.find.mockImplementation(({ _id }: { _id: { $gt: number; $lte: number } }) =>
        cursor(users.filter((u) => u._id > _id.$gt && u._id <= _id.$lte)),
    );
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("native maintenance initialization and recovery", () => {
    it("uses the persisted task identity and disposes its own handler context", async () => {
        vi.stubEnv("NODE_APP_INSTANCE", "0");
        const taskId = new ObjectId();
        runtime.findOne.mockResolvedValue({ taskId });
        const handlers = { addHandler: vi.fn() };
        let dispose!: () => void;
        const context = {
            db: { collection: () => runtime },
            worker: handlers,
            on: vi.fn(),
            effect: (effect: () => () => void) => {
                dispose = effect();
            },
        } as unknown as Context;
        const instance = new BlogReviewNotifications(context);
        await instance.init();
        expect(ScheduleModel.coll.updateOne).toHaveBeenCalledWith(
            { _id: taskId },
            expect.objectContaining({
                $setOnInsert: expect.objectContaining({ subType: "blog.review.maintenance" }) as unknown,
            }),
            { upsert: true },
        );
        dispose();
        await instance.tick(taskId);
        expect(instance.disposed).toBe(true);
        expect(runtime.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("only tolerates duplicate initialization when its own native task actually exists", async () => {
        vi.stubEnv("NODE_APP_INSTANCE", "0");
        const taskId = new ObjectId();
        runtime.findOne.mockResolvedValue({ taskId });
        const duplicate = Object.assign(new Error("duplicate"), { code: 11000 });
        ScheduleModel.coll.updateOne.mockRejectedValue(duplicate);
        const context = {
            db: { collection: () => runtime },
            worker: { addHandler: vi.fn() },
            on: vi.fn(),
            effect: vi.fn(),
        } as unknown as Context;
        ScheduleModel.coll.findOne.mockResolvedValue({ _id: taskId, subType: "blog.review.maintenance" });
        await expect(new BlogReviewNotifications(context).init()).resolves.toBeUndefined();
        ScheduleModel.coll.findOne.mockResolvedValue(null);
        await expect(new BlogReviewNotifications(context).init()).rejects.toBe(duplicate);
    });

    it("continues recovery past a failed article instead of starving the rest of the batch", async () => {
        const first = makeBlog();
        const second = makeBlog({ docId: new ObjectId() });
        const getMulti = vi.spyOn(DocumentModel, "getMulti");
        getMulti
            .mockReturnValueOnce(cursor([second]))
            .mockReturnValueOnce(cursor([first, second]))
            .mockReturnValueOnce(cursor([]));
        const settle = vi
            .spyOn(BlogReviewModel, "materialize")
            .mockRejectedValueOnce(new Error("receipt unavailable"))
            .mockResolvedValue();
        await service.recover();
        expect(settle).toHaveBeenCalledTimes(2);
        expect(settle).toHaveBeenLastCalledWith(second);
    });
});

describe("reviewer login reminders", () => {
    it("notifies an effective default reviewer with the pending count and canonical link", async () => {
        await service.login(makeUser(2) as unknown as User);
        expect(MessageModel.send).toHaveBeenCalledExactlyOnceWith(
            1,
            2,
            JSON.stringify({
                message: "There are {0} blog articles awaiting review ({1:link}).",
                params: [7, "http://127.0.0.1:8888/blog/review"],
            }),
            5,
        );
    });

    it.each(["disabled", "empty", "no-review", "no-access", "guest"])("does not send for %s", async (scenario) => {
        if (scenario === "disabled") settings.review!.reminders = false;
        if (scenario === "empty") vi.spyOn(BlogReviewModel, "count").mockResolvedValue(0);
        if (scenario === "no-review") settings.roles[1].permissions = BLOG_PERM.ACCESS.toString();
        if (scenario === "no-access") settings.roles[1].permissions = BLOG_PERM.REVIEW.toString();
        await service.login(makeUser(scenario === "guest" ? 0 : 2) as unknown as User);
        expect(MessageModel.send).not.toHaveBeenCalled();
    });

    it("isolates reminder failure without undoing successful authentication", async () => {
        MessageModel.send.mockRejectedValueOnce(new Error("message failure"));
        await expect(service.login(makeUser(2) as unknown as User)).resolves.toBeUndefined();
    });
});

describe("periodic summary ownership and recipients", () => {
    it("visits every page including default, retired and legacy-guest roles without duplicate root", async () => {
        settings.deletedRoles.push("retired");
        settings.roles.push({ id: "denied", name: "denied", permissions: "0" });
        assignments = [
            { _id: 2, role: "root" },
            { _id: 3, role: "retired" },
            { _id: 4, role: "guest" },
            { _id: 5, role: "denied" },
            { _id: 6, role: "denied" },
        ];
        users[5].priv |= PRIV.PRIV_EDIT_SYSTEM;
        await service.summary();
        const recipients = MessageModel.send.mock.calls.flatMap((call) => call[1] as number[]);
        expect(recipients).toEqual(users.map((u) => u._id).filter((uid) => uid !== 5));
        expect(new Set(recipients).size).toBe(204);
        expect(MessageModel.send).toHaveBeenCalledTimes(3);
    });

    it("does not send without winning the summary claim", async () => {
        runtime.findOneAndUpdate.mockResolvedValue(null);
        await service.summary();
        expect(MessageModel.send).not.toHaveBeenCalled();
    });

    it("advances an empty occurrence without sending", async () => {
        vi.spyOn(BlogReviewModel, "count").mockResolvedValue(0);
        await service.summary();
        expect(runtime.findOneAndUpdate).toHaveBeenCalledOnce();
        expect(MessageModel.send).not.toHaveBeenCalled();
        expect(runtime.updateOne).toHaveBeenLastCalledWith(
            expect.objectContaining({ runId: expect.any(String) as unknown }),
            {
                $unset: { runId: "", leaseUntil: "" },
            },
        );
    });

    it("stops a scan at the next batch after reminders are disabled", async () => {
        MessageModel.send.mockImplementationOnce(() => {
            settings.review!.reminders = false;
            settings.review!.reminderRevision++;
            return Promise.resolve();
        });
        await service.summary();
        expect(MessageModel.send).toHaveBeenCalledOnce();
    });

    it("does not send after losing its lease", async () => {
        runtime.updateOne.mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValueOnce({ matchedCount: 0 });
        await service.summary();
        expect(MessageModel.send).not.toHaveBeenCalled();
    });

    it("rechecks ownership after slow recipient reads before dispatching", async () => {
        runtime.updateOne
            .mockResolvedValueOnce({ matchedCount: 1 })
            .mockResolvedValueOnce({ matchedCount: 1 })
            .mockResolvedValueOnce({ matchedCount: 0 });
        await service.summary();
        expect(MessageModel.send).not.toHaveBeenCalled();
    });

    it("propagates partial delivery failure but releases only its own claim", async () => {
        MessageModel.send.mockRejectedValueOnce(new Error("message failure"));
        await expect(service.summary()).rejects.toThrow("message failure");
        expect(MessageModel.send).toHaveBeenCalledOnce();
        expect(runtime.updateOne).toHaveBeenLastCalledWith(
            { _id: "global", runId: expect.any(String) as unknown },
            { $unset: { runId: "", leaseUntil: "" } },
        );
    });

    it("keeps report recovery active when reviewer reminders are disabled", async () => {
        settings.review!.reminders = false;
        const recover = vi.spyOn(service, "recover").mockResolvedValue();
        await service.tick(new ObjectId());
        expect(recover).toHaveBeenCalledOnce();
        expect(runtime.findOneAndUpdate).not.toHaveBeenCalled();
        expect(MessageModel.send).not.toHaveBeenCalled();
    });
});
