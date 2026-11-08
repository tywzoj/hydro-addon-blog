import { randomUUID } from "node:crypto";

import type { Context, User } from "hydrooj";
import { DocumentModel, Logger, ObjectId, PRIV, ScheduleModel, SystemModel, UserModel } from "hydrooj";
import type { Collection } from "mongodb";

import { sendBlogMessage } from "../common/notifications";
import { BlogSettingsModel, resolveBlogPolicy } from "../settings/settings.model";
import {
    BlogCollections,
    DEFAULT_REVIEW_SETTINGS,
    REVIEW_BATCH_SIZE,
    REVIEW_LEASE_MS,
    REVIEW_MINUTE_MS,
    REVIEW_RUNTIME_ID,
    REVIEW_TASK,
    ReviewMessages,
    ROUTE_BLOG_REVIEW,
    SYSTEM_DOMAIN,
    TYPE_BLOG,
} from "../shared/constants";
import type { BlogReviewRuntime } from "../shared/types";
import { BlogReviewModel } from "./review.model";

declare module "hydrooj" {
    interface Collections {
        [BlogCollections.ReviewRuntime]: BlogReviewRuntime;
    }
}

const logger = new Logger("blog/review");

export class BlogReviewNotifications {
    runtime: Collection<BlogReviewRuntime>;
    disposed = false;

    constructor(readonly ctx: Context) {
        this.runtime = ctx.db.collection(BlogCollections.ReviewRuntime);
    }

    url() {
        const path = this.ctx.server.router.url(ROUTE_BLOG_REVIEW, {}).toString();
        return new URL(path, SystemModel.get("server.url")).toString();
    }

    async init() {
        await this.runtime.updateOne(
            { _id: REVIEW_RUNTIME_ID },
            { $setOnInsert: { taskId: new ObjectId(), configRevision: -1, nextSummaryAt: new Date() } },
            { upsert: true },
        );
        const state = (await this.runtime.findOne({ _id: REVIEW_RUNTIME_ID }))!;
        this.ctx.worker.addHandler(REVIEW_TASK, () => this.tick(state.taskId));
        this.ctx.on("auth/login", async (_, user) => this.login(user));
        this.ctx.effect(() => () => {
            this.disposed = true;
        });
        if (process.env.NODE_APP_INSTANCE !== "0") return;
        try {
            await ScheduleModel.coll.updateOne(
                { _id: state.taskId },
                {
                    $setOnInsert: {
                        type: "schedule",
                        subType: REVIEW_TASK,
                        executeAfter: new Date(Date.now() + REVIEW_MINUTE_MS),
                        interval: [1, "minute"],
                    },
                },
                { upsert: true },
            );
        } catch (error) {
            if (
                !(error instanceof Error && "code" in error && error.code === 11000) ||
                !(await ScheduleModel.coll.findOne({ _id: state.taskId, subType: REVIEW_TASK }))
            ) {
                throw error;
            }
        }
    }

    async login(user: User) {
        try {
            const settings = await BlogSettingsModel.review();
            if (!settings.reminders) return;
            const policy = await BlogSettingsModel.policy(user);
            if (!policy.canReview()) return;
            const count = await BlogReviewModel.count();
            if (count && (await BlogSettingsModel.review()).reminders) {
                await sendBlogMessage(this.ctx, user._id, ReviewMessages.SummaryNotice, [count, this.url()]);
            }
        } catch (error) {
            logger.error("Login review reminder failed: %s", error);
        }
    }

    async recover() {
        const [last] = await DocumentModel.getMulti(SYSTEM_DOMAIN, TYPE_BLOG, { pendingReportWrite: { $exists: true } })
            .sort({ docId: -1 })
            .limit(1)
            .toArray();
        if (!last) return;
        let after: ObjectId | undefined;
        while (!this.disposed) {
            const docs = await DocumentModel.getMulti(SYSTEM_DOMAIN, TYPE_BLOG, {
                pendingReportWrite: { $exists: true },
                docId: { $lte: last.docId, ...(after ? { $gt: after } : {}) },
            })
                .sort({ docId: 1 })
                .limit(REVIEW_BATCH_SIZE)
                .toArray();
            if (!docs.length) break;
            for (const doc of docs) {
                try {
                    await BlogReviewModel.materialize(doc);
                } catch (error) {
                    logger.error("Report recovery failed for %s: %s", doc.docId, error);
                }
            }
            after = docs[docs.length - 1].docId;
        }
    }

    async summary() {
        const review = await BlogSettingsModel.review();
        const milliseconds = review.intervalMinutes * REVIEW_MINUTE_MS;
        await this.runtime.updateOne({ _id: REVIEW_RUNTIME_ID, configRevision: { $lt: review.reminderRevision } }, [
            {
                $set: {
                    configRevision: review.reminderRevision,
                    nextSummaryAt: {
                        $add: [
                            review.reminderChangedAt ? { $literal: review.reminderChangedAt } : "$$NOW",
                            milliseconds,
                        ],
                    },
                    runId: "$$REMOVE",
                    leaseUntil: "$$REMOVE",
                },
            },
        ]);
        if (!review.reminders || this.disposed) return;
        const runId = randomUUID();
        const claimed = await this.runtime.findOneAndUpdate(
            {
                _id: REVIEW_RUNTIME_ID,
                configRevision: review.reminderRevision,
                $expr: {
                    $and: [
                        { $lte: ["$nextSummaryAt", "$$NOW"] },
                        { $lte: [{ $ifNull: ["$leaseUntil", new Date(0)] }, "$$NOW"] },
                    ],
                },
            },
            [
                {
                    $set: {
                        runId,
                        nextSummaryAt: { $add: ["$$NOW", milliseconds] },
                        leaseUntil: { $add: ["$$NOW", REVIEW_LEASE_MS] },
                    },
                },
            ],
            { returnDocument: "after" },
        );
        if (!claimed) return;
        try {
            const upper = await UserModel.coll.findOne(
                { _id: { $gt: 0 }, priv: { $bitsAllSet: PRIV.PRIV_USER_PROFILE } },
                { sort: { _id: -1 }, projection: { _id: 1 } },
            );
            if (!upper) return;
            let after = 0;
            while (!this.disposed) {
                const settings = await BlogSettingsModel.get();
                const current = { ...DEFAULT_REVIEW_SETTINGS, ...settings.review };
                if (!current.reminders || current.reminderRevision !== review.reminderRevision) return;
                const renewed = await this.runtime.updateOne(
                    {
                        _id: REVIEW_RUNTIME_ID,
                        runId,
                        configRevision: review.reminderRevision,
                        $expr: { $gt: ["$leaseUntil", "$$NOW"] },
                    },
                    [{ $set: { leaseUntil: { $add: ["$$NOW", REVIEW_LEASE_MS] } } }],
                );
                if (!renewed.matchedCount) return;
                const users = await UserModel.coll
                    .find({
                        _id: { $gt: after, $lte: upper._id },
                        priv: { $bitsAllSet: PRIV.PRIV_USER_PROFILE },
                    })
                    .project<{ _id: number; priv: number }>({ _id: 1, priv: 1 })
                    .sort({ _id: 1 })
                    .limit(REVIEW_BATCH_SIZE)
                    .toArray();
                if (!users.length) return;
                const assignments = await BlogSettingsModel.users
                    .find({ _id: { $in: users.map((u) => u._id) } })
                    .toArray();
                const roles = new Map(assignments.map((a) => [a._id, a]));
                const targets = users
                    .filter((u) =>
                        resolveBlogPolicy(
                            { _id: u._id, hasPriv: (bit) => (u.priv & bit) === bit },
                            settings,
                            roles.get(u._id),
                        ).canReview(),
                    )
                    .map((u) => u._id);
                const count = await BlogReviewModel.count();
                const latest = await BlogSettingsModel.review();
                if (!latest.reminders || latest.reminderRevision !== review.reminderRevision || !count) return;
                if (targets.length) {
                    const owned = await this.runtime.updateOne(
                        {
                            _id: REVIEW_RUNTIME_ID,
                            runId,
                            configRevision: review.reminderRevision,
                            $expr: { $gt: ["$leaseUntil", "$$NOW"] },
                        },
                        [{ $set: { leaseUntil: { $add: ["$$NOW", REVIEW_LEASE_MS] } } }],
                    );
                    if (!owned.matchedCount || this.disposed) return;
                    await sendBlogMessage(this.ctx, targets, ReviewMessages.SummaryNotice, [count, this.url()]);
                }
                after = users[users.length - 1]._id;
            }
        } finally {
            await this.runtime.updateOne({ _id: REVIEW_RUNTIME_ID, runId }, { $unset: { runId: "", leaseUntil: "" } });
        }
    }

    async tick(taskId: ObjectId) {
        if (this.disposed) return;
        await ScheduleModel.coll.updateOne(
            { _id: taskId, subType: REVIEW_TASK, $expr: { $lte: ["$executeAfter", "$$NOW"] } },
            [{ $set: { executeAfter: { $add: ["$$NOW", REVIEW_MINUTE_MS] } } }],
        );
        await this.recover();
        await this.summary();
    }
}

export function applyReviewNotifications(ctx: Context) {
    ctx.inject(["server", "worker"], async (c) => {
        await new BlogReviewNotifications(c).init();
    });
}
