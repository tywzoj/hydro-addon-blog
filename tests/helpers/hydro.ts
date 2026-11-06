import { createRequire } from "node:module";
import { resolve } from "node:path";

import type * as Permissions from "@hydrooj/common/permission";
import type * as Decorators from "@hydrooj/framework/decorators";
import type * as Errors from "@hydrooj/framework/error";
import type * as Validators from "@hydrooj/framework/validator";
import type { ObjectId } from "mongodb";
import { vi } from "vitest";

import type { BlogCommentDoc, BlogDoc, BlogStatusDoc } from "../../features/types";

const load = createRequire(resolve("package.json"));
load("@hydrooj/register");

export const { param } = load("@hydrooj/framework/decorators") as typeof Decorators;
export const { Types } = load("@hydrooj/framework/validator") as typeof Validators;
export const { ValidationError, CreateError, ForbiddenError } = load("@hydrooj/framework/error") as typeof Errors;
export const { PRIV } = load("@hydrooj/common/permission") as typeof Permissions;

export class UserNotFoundError extends Error {}
export class DiscussionNotFoundError extends Error {}
export class DocumentNotFoundError extends Error {}
export class PrivilegeError extends Error {}

export interface Cursor {
    sort: (sort: Record<string, number>) => Cursor;
    project: (projection: Record<string, number>) => Cursor;
}

export const DocumentModel = {
    coll: {
        findOne: vi.fn(),
        findOneAndDelete: vi.fn(),
        updateOne: vi.fn(),
        deleteMany: vi.fn(),
        findOneAndUpdate: vi.fn<(...args: unknown[]) => Promise<BlogDoc | null>>(),
        deleteOne: vi.fn<(...args: unknown[]) => Promise<{ deletedCount: number }>>(),
    },
    collStatus: {
        find: vi.fn(),
        findOne: vi.fn(),
        findOneAndUpdate: vi.fn(),
        deleteMany: vi.fn(),
    },
    add: vi.fn<(...args: unknown[]) => Promise<ObjectId>>(),
    get: vi.fn<(...args: unknown[]) => Promise<BlogDoc | null>>(),
    set: vi.fn<(...args: unknown[]) => Promise<BlogDoc>>(),
    inc: vi.fn<(...args: unknown[]) => Promise<BlogDoc>>(),
    deleteOne: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    deleteMultiStatus: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    count: vi.fn<(...args: unknown[]) => Promise<number>>(),
    getMulti: vi.fn<(...args: unknown[]) => Cursor>(),
    push: vi.fn<(...args: unknown[]) => Promise<[BlogCommentDoc | null, ObjectId]>>(),
    incAndSet: vi.fn<(...args: unknown[]) => Promise<BlogDoc>>(),
    deleteSub: vi.fn(),
    getStatus: vi.fn<(...args: unknown[]) => Promise<BlogStatusDoc | null>>(),
    setStatus: vi.fn<(...args: unknown[]) => Promise<BlogStatusDoc>>(),
};

export function makeUser(id = 1, privileges = PRIV.PRIV_USER_PROFILE) {
    return {
        _id: id,
        uname: `user${id}`,
        hasPriv: (privilege: number) => (privileges & privilege) === privilege,
        own: (doc: { owner: number }, _strict?: boolean) => doc.owner === id,
    };
}

export const UserModel = {
    coll: { collectionName: "user", aggregate: vi.fn() },
    getById: vi.fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUser> | null>>(),
    getByUname: vi.fn<(...args: unknown[]) => Promise<ReturnType<typeof makeUser> | null>>(),
    getList: vi.fn<(...args: unknown[]) => Promise<Record<number, ReturnType<typeof makeUser>>>>(),
};

export const OplogModel = {
    log: vi.fn<(...args: unknown[]) => Promise<void>>(),
};
export const MessageModel = {
    FLAG_RICHTEXT: 4,
    FLAG_UNREAD: 1,
    send: vi.fn(),
};

export class Handler {
    user = makeUser();
    udoc = makeUser();
    ddoc!: BlogDoc;
    request = { ip: "192.0.2.1", body: {} as Record<string, unknown> };
    session = { sudo: true };
    UiContext: Record<string, unknown> = {};
    response: { template?: string; body?: Record<string, unknown>; redirect?: string } = {};
    ctx = {
        db: {
            paginate: vi.fn<(cursor: Cursor, page: number, size: number) => Promise<[BlogDoc[], number, number]>>(),
        },
    };
    paginate(cursor: Cursor, page: number, size: number | string) {
        return this.ctx.db.paginate(cursor, page, typeof size === "string" ? 50 : size);
    }
    checkPriv = vi.fn((privilege: number) => {
        if (!this.user.hasPriv(privilege)) throw new PrivilegeError("Fixture privilege denial");
    });
    limitRate = vi.fn<(...args: unknown[]) => Promise<void>>();
    url = vi.fn((route: string, _args: Record<string, unknown>) => `/${route}`);
    back = vi.fn<(body?: Record<string, unknown>) => void>();
}

export function requireSudo(_target: unknown, _name: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value as (this: Handler, ...args: unknown[]) => unknown;
    descriptor.value = function (this: Handler, ...args: unknown[]) {
        if (!this.session.sudo) {
            this.response.redirect = "/sudo";
            return "cleanup";
        }
        return original.apply(this, args);
    };
}
