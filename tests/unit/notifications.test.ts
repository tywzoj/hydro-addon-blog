import type { Context } from "hydrooj";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendBlogMessage } from "../../features/common/notifications";
import { MessageModel, SystemModel, UserModel } from "../helpers/hydro";

const translate = vi.fn<(message: string, languages: string[]) => string>();
const ctx = { i18n: { translate } } as unknown as Context;
const message = "Notice {0} ({1:link})";
const params = ["<b>{user text}</b>", "/blog/2/article"];

function recipients(users: { _id: number; viewLang?: string }[]) {
    const cursor = {
        project: vi.fn((_fields: Record<string, number>) => cursor),
        toArray: () => Promise.resolve(users),
    };
    const getMulti = vi.spyOn(UserModel, "getMulti").mockReturnValue(cursor);
    return { getMulti, cursor };
}

beforeEach(() => {
    vi.resetAllMocks();
    SystemModel.get.mockReturnValue("en");
    translate.mockImplementation((key, [language]) => `${language}: ${key}`);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("recipient-localized notifications", () => {
    it("groups a mixed-language batch by recipient preference without formatting user parameters", async () => {
        const { getMulti, cursor } = recipients([
            { _id: 2, viewLang: "zh" },
            { _id: 3, viewLang: "en" },
            { _id: 4, viewLang: "zh" },
        ]);
        await sendBlogMessage(ctx, [2, 3, 4, 2], message, params);
        expect(getMulti).toHaveBeenCalledExactlyOnceWith({ _id: { $in: [2, 3, 4] } });
        expect(cursor.project).toHaveBeenCalledExactlyOnceWith({ _id: 1, viewLang: 1 });
        expect(translate.mock.calls).toEqual([
            [message, ["zh"]],
            [message, ["en"]],
        ]);
        expect(MessageModel.send.mock.calls).toEqual([
            [1, [2, 4], JSON.stringify({ message: `zh: ${message}`, params }), 5],
            [1, [3], JSON.stringify({ message: `en: ${message}`, params }), 5],
        ]);
    });

    it.each([undefined, ""])("falls back to the server language for preference %s", async (viewLang) => {
        recipients([{ _id: 2, viewLang }]);
        SystemModel.get.mockReturnValue("zh_TW");
        await sendBlogMessage(ctx, 2, message, params);
        expect(SystemModel.get).toHaveBeenCalledWith("server.language");
        expect(translate).toHaveBeenCalledExactlyOnceWith(message, ["zh_TW"]);
        expect(MessageModel.send).toHaveBeenCalledExactlyOnceWith(
            1,
            2,
            JSON.stringify({ message: `zh_TW: ${message}`, params }),
            5,
        );
    });

    it("does not query an empty batch or send notifications to missing accounts", async () => {
        const { getMulti } = recipients([]);
        await sendBlogMessage(ctx, [], message, params);
        expect(getMulti).not.toHaveBeenCalled();
        await sendBlogMessage(ctx, [99], message, params);
        expect(MessageModel.send).not.toHaveBeenCalled();
    });

    it("propagates delivery failures rather than reporting success", async () => {
        recipients([{ _id: 2, viewLang: "ko" }]);
        const failure = new Error("message write failed");
        MessageModel.send.mockRejectedValueOnce(failure);
        await expect(sendBlogMessage(ctx, 2, message, params)).rejects.toBe(failure);
    });
});
