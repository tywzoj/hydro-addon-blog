import type { Context, User } from "hydrooj";
import { ObjectId } from "hydrooj";
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
        i18n: { translate: (message: string) => message },
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
    it("registers worker and login callbacks on secondary instances without scheduling duplicate tasks", async () => {
        vi.stubEnv("NODE_APP_INSTANCE", "1");
        const taskId = new ObjectId();
        runtime.findOne.mockResolvedValue({ taskId });
        const addHandler = vi.fn<(name: string, callback: () => Promise<void>) => void>();
        const on = vi.fn<(name: string, callback: (_: unknown, user: User) => Promise<void>) => void>();
        const instance = new BlogReviewNotifications({
            db: { collection: () => runtime },
            worker: { addHandler },
            on,
            effect: vi.fn(),
        } as unknown as Context);
        const tick = vi.spyOn(instance, "tick").mockResolvedValue();
        const login = vi.spyOn(instance, "login").mockResolvedValue();
        await instance.init();
        expect(ScheduleModel.coll.updateOne).not.toHaveBeenCalled();
        expect(addHandler.mock.calls[0][0]).toBe("blog.review.maintenance");
        await addHandler.mock.calls[0][1]();
        expect(tick).toHaveBeenCalledWith(taskId);
        expect(on.mock.calls[0][0]).toBe("auth/login");
        const user = makeUser(2) as unknown as User;
        await on.mock.calls[0][1]("password", user);
        expect(login).toHaveBeenCalledWith(user);
    });

    it("finishes recovery immediately when no report writes are pending", async () => {
        DocumentModel.getMulti.mockReturnValue(cursor([]));
        const materialize = vi.spyOn(BlogReviewModel, "materialize");
        await service.recover();
        expect(DocumentModel.getMulti).toHaveBeenCalledOnce();
        expect(materialize).not.toHaveBeenCalled();
    });

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
    it("anchors a changed reminder cadence to its persisted change time", async () => {
        const changedAt = new Date("2026-11-07T10:00:00Z");
        settings.review = {
            ...DEFAULT_REVIEW_SETTINGS,
            reminderChangedAt: changedAt,
            reminderRevision: 4,
            intervalMinutes: 10,
        };
        runtime.findOneAndUpdate.mockResolvedValue(null);
        await service.summary();
        expect(runtime.updateOne).toHaveBeenCalledWith({ _id: "global", configRevision: { $lt: 4 } }, [
            {
                $set: {
                    configRevision: 4,
                    nextSummaryAt: { $add: [{ $literal: changedAt }, 600_000] },
                    runId: "$$REMOVE",
                    leaseUntil: "$$REMOVE",
                },
            },
        ]);
        expect(MessageModel.send).not.toHaveBeenCalled();
    });

    it("releases a claimed summary when there are no eligible user identities", async () => {
        users = [];
        await service.summary();
        expect(UserModel.coll.find).not.toHaveBeenCalled();
        expect(MessageModel.send).not.toHaveBeenCalled();
        expect(runtime.updateOne).toHaveBeenLastCalledWith(
            { _id: "global", runId: expect.any(String) as unknown },
            { $unset: { runId: "", leaseUntil: "" } },
        );
    });

    it("continues past a full batch without reviewers and sends only to later eligible users", async () => {
        settings.roles.push({ id: "denied", name: "denied", permissions: "0" });
        assignments = users.slice(0, 100).map((user) => ({ _id: user._id, role: "denied" }));
        await service.summary();
        const recipients = MessageModel.send.mock.calls.flatMap((call) => call[1] as number[]);
        expect(recipients).toEqual(users.slice(100).map((user) => user._id));
        expect(MessageModel.send).toHaveBeenCalledTimes(2);
    });

    it("does not deliver after a cadence change during recipient lookup", async () => {
        UserModel.coll.find.mockImplementation(({ _id }: { _id: { $gt: number; $lte: number } }) => {
            settings.review!.reminderRevision++;
            return cursor(users.filter((user) => user._id > _id.$gt && user._id <= _id.$lte));
        });
        await service.summary();
        expect(MessageModel.send).not.toHaveBeenCalled();
        expect(runtime.updateOne).toHaveBeenLastCalledWith(
            { _id: "global", runId: expect.any(String) as unknown },
            { $unset: { runId: "", leaseUntil: "" } },
        );
    });

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
