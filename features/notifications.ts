import type { Context } from "hydrooj";
import { MessageModel, SystemModel, UserModel } from "hydrooj";

export async function sendBlogMessage(
    ctx: Context,
    to: number | number[],
    message: string,
    params: (string | number)[],
) {
    const ids = [...new Set(Array.isArray(to) ? to : [to])];
    if (!ids.length) return;
    const users = await UserModel.getMulti({ _id: { $in: ids } })
        .project<{ _id: number; viewLang?: string }>({ _id: 1, viewLang: 1 })
        .toArray();
    const groups = new Map<string, number[]>();
    for (const user of users) {
        const language = user.viewLang || SystemModel.get("server.language");
        const recipients = groups.get(language) ?? [];
        recipients.push(user._id);
        groups.set(language, recipients);
    }
    for (const [language, recipients] of groups) {
        await MessageModel.send(
            1,
            Array.isArray(to) ? recipients : recipients[0],
            JSON.stringify({ message: ctx.i18n.translate(message, [language]), params }),
            MessageModel.FLAG_RICHTEXT | MessageModel.FLAG_UNREAD,
        );
    }
}
