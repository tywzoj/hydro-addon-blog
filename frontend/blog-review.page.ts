import { ActionDialog, addPage, confirm, i18n, NamedPage, Notification, request } from "@hydrooj/ui-default";

import {
    BlogConfirmMessages,
    BlogOperations,
    ReviewMessages,
    ROUTE_BLOG_REVIEW_DETAIL,
    ROUTE_BLOG_REVIEW_RESET,
    TEMPLATE_BLOG_DETAIL,
    TEMPLATE_BLOG_EDIT,
    TEMPLATE_BLOG_SETTINGS,
} from "../features/constants";
import { confirmationMessage, isSubmitShortcut } from "./blog-confirmation";

function formConfirmation(form: HTMLFormElement, submitter: HTMLElement | null) {
    const data = new FormData(form);
    if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
        if (submitter.name) data.set(submitter.name, submitter.value);
    }
    const wasDraft = form.dataset.initialDraft !== "false";
    const draftInput = form.querySelector<HTMLInputElement>('input[name="draft"]');
    const operation = data.get("operation");
    const decision = data.get("decision");
    const mode = data.get("mode");
    return confirmationMessage({
        operation: typeof operation === "string" ? operation : undefined,
        decision: typeof decision === "string" ? decision : undefined,
        mode: typeof mode === "string" ? mode : undefined,
        reviewRequired: form.dataset.publishReview === "true",
        reviewPending: form.dataset.reviewPending === "true",
        wasDraft,
        draft: draftInput
            ? draftInput.type === "checkbox"
                ? draftInput.checked
                : draftInput.value === "true"
            : wasDraft,
    });
}

addPage(
    new NamedPage(TEMPLATE_BLOG_DETAIL, () => {
        const trigger = $("[data-blog-report]");
        if (!trigger.length) return;
        const dialog = new ActionDialog({ $body: $(".dialog__body--blog-report > div") });
        async function report() {
            if ((await dialog.open()) !== "ok") return;
            try {
                const result = (await request.post(trigger.attr("data-report-url")!, {
                    operation: BlogOperations.Report,
                    version: Number(trigger.attr("data-version")),
                    comments: dialog.$dom.find('[name="reportComments"]').val(),
                })) as { duplicate?: boolean };
                Notification.success(
                    i18n(result.duplicate ? ReviewMessages.AlreadyReported : ReviewMessages.ReportAccepted),
                );
                window.location.href = trigger.attr("data-return-url")!;
            } catch (error) {
                Notification.error(error instanceof Error ? error.message : String(error));
            }
        }
        trigger.on("click", (event) => {
            event.preventDefault();
            void report().catch((error: unknown) => {
                Notification.error(String(error));
            });
        });
    }),
);

addPage(
    new NamedPage(
        [
            TEMPLATE_BLOG_DETAIL,
            TEMPLATE_BLOG_EDIT,
            ROUTE_BLOG_REVIEW_DETAIL,
            ROUTE_BLOG_REVIEW_RESET,
            TEMPLATE_BLOG_SETTINGS,
        ],
        () => {
            const pending = new WeakSet<HTMLFormElement>();
            const approved = new WeakSet<HTMLFormElement>();
            for (const form of document.querySelectorAll<HTMLFormElement>("form[data-initial-draft]")) {
                // Stop the editor's Mod-Enter newline before Hydro's bubbling submit hotkey.
                form.addEventListener(
                    "keydown",
                    (event) => {
                        if (!isSubmitShortcut(event)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (!event.repeat) form.querySelector<HTMLButtonElement>("[data-default-submit]")?.click();
                    },
                    true,
                );
            }
            $("form[data-blog-confirm]").on("click", ":submit", (event) => {
                // Hydro's document-level click throttle also consumes cancelled submissions.
                if (formConfirmation(event.delegateTarget as HTMLFormElement, event.currentTarget as HTMLElement)) {
                    event.stopPropagation();
                }
            });
            $("form[data-blog-confirm]").on("submit", (event) => {
                const form = event.currentTarget as HTMLFormElement;
                if (approved.delete(form)) return;
                if (pending.has(form)) {
                    event.preventDefault();
                    return;
                }
                const submitter =
                    (event.originalEvent as SubmitEvent | undefined)?.submitter ??
                    form.querySelector<HTMLButtonElement>("[data-default-submit]");
                const message = formConfirmation(form, submitter);
                // Native hotkeys can trigger a jQuery submit without a submitter.
                if (!message && event.originalEvent) return;
                event.preventDefault();
                if (!form.reportValidity()) return;
                pending.add(form);
                void (async () => {
                    try {
                        // The cached native language asset can predate newly added addon messages.
                        const translations = UiContext.blogConfirmations as Record<string, string> | undefined;
                        if (message && !(await confirm(translations?.[message] ?? i18n(message)))) return;
                        if (message === BlogConfirmMessages.DisableReview) {
                            form.querySelector<HTMLInputElement>('[name="confirmDisable"]')!.value = "true";
                        }
                        approved.add(form);
                        form.requestSubmit(submitter ?? undefined);
                    } catch (error) {
                        Notification.error(String(error));
                    } finally {
                        approved.delete(form);
                        pending.delete(form);
                    }
                })();
            });
        },
    ),
);
