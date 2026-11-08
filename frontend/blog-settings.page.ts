import {
    ActionDialog,
    addPage,
    confirm,
    i18n,
    NamedPage,
    Notification,
    prompt,
    request,
    UserSelectAutoComplete,
} from "@hydrooj/ui-default";
import type { Udoc } from "hydrooj/src/interface";

import type { BlogOperation } from "../features/shared/constants";
import {
    BLOG_SETTINGS_PAGES,
    BlogMessages,
    BlogOperations,
    BlogRoles,
    SYSTEM_DOMAIN,
    TEMPLATE_BLOG_SETTINGS_ROLES,
    TEMPLATE_BLOG_SETTINGS_USERS,
} from "../features/shared/constants";

const DIALOG_CONFIRM_ACTION = "ok" as const;
const DIALOG_SHOWN_EVENT = "vjDomDialogShown";
const ROLE_SELECT = 'select[name="role"]';

async function findUsers(args: { search: string } | { auto: string[] }) {
    const result = (await request.post(`/d/${SYSTEM_DOMAIN}/api/users`, {
        args,
        projection: ["_id", "uname", "displayName", "avatarUrl"],
    })) as Udoc[] & { error?: string };
    if (result.error) throw new Error(result.error);
    return result;
}

function showError(error: unknown) {
    Notification.error(error instanceof Error ? error.message : String(error));
}

function prepareDialogs() {
    // Native dialog actions can resolve before the opening animation allows the dialog to close.
    $(document).on("vjContentNew.blogSettings", ".dialog__content", (event) => {
        $(event.currentTarget).closest(".dialog").find("[data-action]").prop("disabled", true);
    });
    $(document).on(`${DIALOG_SHOWN_EVENT}.blogSettings`, ".dialog", (event) => {
        $(event.currentTarget).find("[data-action]").prop("disabled", false);
    });
}

function selectedRows(container: string, attribute: string, message: string) {
    const values = $(`${container} tbody input[type="checkbox"]:checked:not(:disabled)`)
        .map((_, checkbox) => $(checkbox).closest("tr").attr(attribute)!)
        .get();
    if (!values.length) Notification.error(i18n(message));
    return values;
}

async function save(data: { operation: BlogOperation } & Record<string, unknown>) {
    await request.post("", data);
    window.location.reload();
}

addPage(
    new NamedPage([...BLOG_SETTINGS_PAGES], (pageName: string) => {
        $(".blog-settings-menu .menu__link").removeClass("active").removeAttr("aria-current");
        $(`#menu-item-${pageName} > .menu__link`).addClass("active").attr("aria-current", "page");
    }),
);

addPage(
    new NamedPage(TEMPLATE_BLOG_SETTINGS_USERS, () => {
        prepareDialogs();
        const roles = (UiContext as { blogRoles: string[] }).blogRoles;
        const roleField = { type: "text" as const, required: true, label: i18n(BlogMessages.Role), options: roles };
        const assignmentDialog = new ActionDialog({
            $body: $(".dialog__body--add-blog-user > div"),
            onDispatch(action: string) {
                if (action === DIALOG_CONFIRM_ACTION && !userSelector.value().length) {
                    Notification.error(i18n(BlogMessages.SelectUsers));
                    userSelector.focus();
                    return false;
                }
                return true;
            },
        });
        const userSelectorOptions = {
            multi: true as const,
            props: {
                multi: true,
                cacheKey: "blog-system-user",
                queryItems: (search: string) => findUsers({ search }),
                fetchItems: (auto: string[]) => findUsers({ auto }),
            },
        };
        const userSelector = new UserSelectAutoComplete<true>(
            assignmentDialog.$dom.find('[name="uids"]'),
            userSelectorOptions,
        );
        assignmentDialog.$dom.on(DIALOG_SHOWN_EVENT, () => userSelector.focus());

        async function assignUserRoles() {
            userSelector.clear();
            assignmentDialog.$dom
                .find(ROLE_SELECT)
                .val(roles.find((role) => role !== BlogRoles.Default) ?? BlogRoles.Root);
            if ((await assignmentDialog.open()) !== DIALOG_CONFIRM_ACTION) return;
            await save({
                operation: BlogOperations.SetUsers,
                uids: userSelector.value(),
                role: assignmentDialog.$dom.find(ROLE_SELECT).val(),
            });
        }

        function selectedUsers() {
            return selectedRows(".domain-users", "data-uid", BlogMessages.SelectUsers);
        }

        async function setRoles() {
            const users = selectedUsers();
            if (!users.length) return;
            const result = await prompt(i18n(BlogMessages.SetRole), { role: roleField });
            if (result?.role) await save({ operation: BlogOperations.SetUsers, uids: users, role: result.role });
        }

        async function changeRole(select: HTMLSelectElement) {
            const row = $(select).closest("tr");
            const previous = row.attr("data-role")!;
            const role = select.value;
            select.disabled = true;
            try {
                await request.post("", { operation: BlogOperations.SetUsers, uids: [row.attr("data-uid")], role });
                row.attr("data-role", role);
                Notification.success(i18n(BlogMessages.RoleUpdated, role));
                if (role === BlogRoles.Default) window.location.reload();
            } catch (error) {
                select.value = previous;
                throw error;
            } finally {
                select.disabled = false;
            }
        }

        $('[name="add_user"]').on("click", () => {
            void assignUserRoles().catch(showError);
        });
        $('[name="set_roles"]').on("click", () => {
            void setRoles().catch(showError);
        });
        $<HTMLSelectElement>(`.domain-users ${ROLE_SELECT}`).on("change", (event) => {
            void changeRole(event.currentTarget).catch(showError);
        });
    }),
);

addPage(
    new NamedPage(TEMPLATE_BLOG_SETTINGS_ROLES, () => {
        prepareDialogs();
        const revision = $("[data-blog-revision]").attr("data-blog-revision")!;
        async function createRole() {
            const result = await prompt(i18n(BlogMessages.CreateRole), {
                role: { type: "text", label: i18n(BlogMessages.Role), required: true, autofocus: true },
            });
            if (result?.role) await save({ operation: BlogOperations.AddRole, role: result.role, revision });
        }
        async function deleteRoles() {
            const roles = selectedRows(".domain-roles", "data-role", BlogMessages.SelectRoles);
            if (!roles.length || !(await confirm(i18n(BlogMessages.DeleteRolesConfirm)))) {
                return;
            }
            await save({ operation: BlogOperations.DeleteRoles, roles, revision });
        }
        $('[name="create_role"]').on("click", () => {
            void createRole().catch(showError);
        });
        $('[name="delete_selected"]').on("click", () => {
            void deleteRoles().catch(showError);
        });
    }),
);
