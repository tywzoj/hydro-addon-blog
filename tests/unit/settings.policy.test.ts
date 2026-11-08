import { describe, expect, it } from "vitest";

import { initialSettings, resolveBlogPolicy } from "../../features/settings/settings.model";
import {
    BLOG_ALL,
    BLOG_DEFAULT,
    BLOG_PERM,
    BlogPermissionError,
    BlogPolicy,
} from "../../features/settings/settings.policy";
import { ForbiddenError, makeUser, PRIV, PrivilegeError, ValidationError } from "../helpers/hydro";

describe("effective blog roles", () => {
    it("resolves guest, default, explicit roles and forced root independently of domain data", () => {
        const settings = initialSettings();
        settings.roles.push({ id: "editor-id", name: "editor", permissions: BLOG_PERM.ACCESS.toString() });
        expect(resolveBlogPolicy(makeUser(0, 0), settings, { _id: 0, role: "root" }).role).toBe("guest");
        expect(resolveBlogPolicy(makeUser(2), settings).mask).toBe(BLOG_DEFAULT);
        expect(resolveBlogPolicy(makeUser(2), settings, { _id: 2, role: "editor-id" }).role).toBe("editor");
        expect(resolveBlogPolicy(makeUser(2), settings, { _id: 2, role: "root" }).mask).toBe(BLOG_ALL);
        const admin = { ...makeUser(2, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_EDIT_SYSTEM), role: "guest", perm: 0n };
        expect(resolveBlogPolicy(admin, settings, { _id: 2, role: "guest" }).role).toBe("root");
        const domainAdmin = makeUser(3, PRIV.PRIV_USER_PROFILE | PRIV.PRIV_MANAGE_ALL_DOMAIN);
        expect(resolveBlogPolicy(domainAdmin, settings).role).toBe("default");
    });

    it("falls back only for known deleted roles and does not revive reused names", () => {
        const settings = initialSettings();
        settings.deletedRoles.push("old-id");
        settings.roles.push({ id: "new-id", name: "editor", permissions: BLOG_ALL.toString() });
        expect(resolveBlogPolicy(makeUser(2), settings, { _id: 2, role: "old-id" }).role).toBe("default");
        expect(() => resolveBlogPolicy(makeUser(2), settings, { _id: 2, role: "unknown" })).toThrow(ValidationError);
    });

    it("respects explicitly empty masks", () => {
        const settings = initialSettings();
        settings.roles.find((r) => r.name === "default")!.permissions = "0";
        const policy = resolveBlogPolicy(makeUser(2), settings);
        expect(policy.has("ACCESS")).toBe(false);
        expect(() => policy.require("ACCESS")).toThrow(BlogPermissionError);
    });

    it("treats legacy guest assignments as default for authenticated users", () => {
        const settings = initialSettings();
        settings.roles[0].permissions = BLOG_ALL.toString();
        settings.roles[1].permissions = "0";
        const policy = resolveBlogPolicy(makeUser(2), settings, { _id: 2, role: "guest" });
        expect(policy.role).toBe("default");
        expect(policy.mask).toBe(0n);
        expect(resolveBlogPolicy(makeUser(0, 0), settings).role).toBe("guest");
    });

    it("keeps configurable guest reading separate from authenticated operations", () => {
        const settings = initialSettings();
        settings.roles[0].permissions = (BLOG_PERM.ACCESS | BLOG_PERM.VIEW_DRAFT_OTHERS | BLOG_PERM.STAR).toString();
        const policy = resolveBlogPolicy(makeUser(0, 0), settings);
        expect(policy.readable({ owner: 2, draft: true })).toBe(true);
        expect(policy.controls({ owner: 2, draft: true }).star).toBe(false);
        expect(() => policy.requireLogin()).toThrow(PrivilegeError);
    });

    it.each([BLOG_DEFAULT, BLOG_ALL])(
        "restricts creation to the authenticated author even with root grants (%s)",
        (mask) => {
            const policy = new BlogPolicy(makeUser(2), "test", mask);
            expect(policy.canCreate(2)).toBe(true);
            expect(() => policy.requireCreate(2)).not.toThrow();
            expect(policy.canCreate(3)).toBe(false);
            expect(() => policy.requireCreate(3)).toThrow(ForbiddenError);
        },
    );

    it("requires login, access and creation permission", () => {
        for (const mask of [BLOG_PERM.CREATE, BLOG_PERM.ACCESS]) {
            const policy = new BlogPolicy(makeUser(2), "restricted", mask);
            expect(policy.canCreate(2)).toBe(false);
            expect(() => policy.requireCreate(2)).toThrow(BlogPermissionError);
        }
        const guest = new BlogPolicy(makeUser(0, 0), "guest", BLOG_ALL);
        expect(guest.canCreate(0)).toBe(false);
        expect(() => guest.requireCreate(0)).toThrow(PrivilegeError);
    });
});
