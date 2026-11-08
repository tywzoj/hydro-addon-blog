import type { Context } from "hydrooj";
import { describe, expect, it, vi } from "vitest";

import { BlogModel } from "../../features/articles/article.model";
import { BlogCommentModel } from "../../features/comments/comment.model";
import { BlogReviewModel } from "../../features/review/review.model";
import { BlogSettingsModel } from "../../features/settings/settings.model";
import { apply } from "../../index";

function setup() {
    const events: string[] = [];
    const initializers = [
        vi.spyOn(BlogModel, "init"),
        vi.spyOn(BlogCommentModel, "init"),
        vi.spyOn(BlogSettingsModel, "init"),
        vi.spyOn(BlogReviewModel, "init"),
    ];
    for (const [index, initialize] of initializers.entries()) {
        initialize.mockImplementation(() => {
            events.push(`storage:${index}`);
            return Promise.resolve();
        });
    }
    const context = {
        Route: vi.fn((_name: string, _path: string, _handler: { name: string }) => events.push("route")),
        i18n: { load: vi.fn(() => events.push("i18n")) },
        on: vi.fn(() => events.push("ui-context")),
        injectUI: vi.fn(() => events.push("ui")),
        inject: vi.fn((_services: string[], _callback: unknown) => events.push("worker")),
    };
    return { events, initializers, context, ctx: context as unknown as Context };
}

describe("addon composition", () => {
    it("awaits storage before registering unchanged routes, UI and worker integration", async () => {
        const { events, initializers, context, ctx } = setup();
        let release!: () => void;
        const ready = new Promise<void>((resolve) => {
            release = resolve;
        });
        initializers[0].mockImplementation(() => {
            events.push("storage:0");
            return ready;
        });
        const pending = apply(ctx);
        expect(events).toEqual(["storage:0"]);
        expect(context.Route).not.toHaveBeenCalled();
        release();
        await pending;

        expect(events.slice(0, 4)).toEqual(["storage:0", "storage:1", "storage:2", "storage:3"]);
        expect(events.indexOf("i18n")).toBeLessThan(events.indexOf("route"));
        expect(events.lastIndexOf("route")).toBeLessThan(events.indexOf("ui-context"));
        expect(events[events.length - 1]).toBe("worker");
        expect(context.Route.mock.calls.map(([name, path, handler]) => [name, path, handler.name])).toEqual([
            ["blog_settings", "/blog/settings", "BlogSettingsHandler"],
            ["blog_settings_roles", "/blog/settings/roles", "BlogRoleHandler"],
            ["blog_settings_permissions", "/blog/settings/permissions", "BlogPermissionHandler"],
            ["blog_settings_users", "/blog/settings/users", "BlogRoleUserHandler"],
            ["blog_review", "/blog/review", "BlogReviewListHandler"],
            ["blog_review_reset", "/blog/review/:did/reset", "BlogReviewResetHandler"],
            ["blog_review_detail", "/blog/review/:did", "BlogReviewDetailHandler"],
            ["blog_report", "/blog/:uid/:did/report", "BlogReportHandler"],
            ["blog_list_home", "/blog", "BlogListHandler"],
            ["blog_list_user", "/blog/:uid", "BlogListUserHandler"],
            ["blog_post_create", "/blog/:uid/create", "BlogUserPostCreateHandler"],
            ["blog_post_detail", "/blog/:uid/:did", "BlogUserPostDetailHandler"],
            ["blog_post_edit", "/blog/:uid/:did/edit", "BlogUserPostEditHandler"],
        ]);
        expect(context.inject.mock.calls[0]?.[0]).toEqual(["server", "worker"]);
    });

    it.each([0, 1, 2, 3])("stops registration when storage initializer %i fails", async (index) => {
        const { initializers, context, ctx } = setup();
        const error = new Error("storage unavailable");
        initializers[index].mockRejectedValue(error);

        await expect(apply(ctx)).rejects.toBe(error);
        for (const initialize of initializers.slice(index + 1)) expect(initialize).not.toHaveBeenCalled();
        expect(context.Route).not.toHaveBeenCalled();
        expect(context.i18n.load).not.toHaveBeenCalled();
        expect(context.on).not.toHaveBeenCalled();
        expect(context.injectUI).not.toHaveBeenCalled();
        expect(context.inject).not.toHaveBeenCalled();
    });
});
