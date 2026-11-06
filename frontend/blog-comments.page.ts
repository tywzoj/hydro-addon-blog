import { addPage, i18n, NamedPage, Notification, request } from "@hydrooj/ui-default";

import { BlogMessages, BlogOperations, TEMPLATE_BLOG_DETAIL } from "../features/constants";

async function setLike(button: HTMLButtonElement) {
    if (button.disabled) return;
    button.disabled = true;
    try {
        const state = (await request.post("", {
            operation: BlogOperations.Like,
            drid: button.dataset.drid,
            ...(button.dataset.drrid ? { drrid: button.dataset.drrid } : {}),
            liked: button.dataset.liked !== "true",
        })) as { nLike: number; liked: boolean };
        button.dataset.liked = String(state.liked);
        button.setAttribute("aria-pressed", String(state.liked));
        button.setAttribute("aria-label", i18n(state.liked ? BlogMessages.UnlikeComment : BlogMessages.LikeComment));
        $(button)
            .find("[data-like-label]")
            .text(i18n(state.liked ? BlogMessages.UnlikeComment : BlogMessages.LikeComment));
        $(button).find("[data-like-count]").text(state.nLike);
    } catch (error) {
        Notification.error((error as Error).message);
    } finally {
        button.disabled = false;
    }
}

addPage(
    new NamedPage(TEMPLATE_BLOG_DETAIL, () => {
        $(document).on("click", "[data-blog-like]", (event) => {
            void setLike(event.currentTarget as HTMLButtonElement);
        });
    }),
);
