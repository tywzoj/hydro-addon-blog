import { addPage, NamedPage, UserSelectAutoComplete } from "@hydrooj/ui-default";

addPage(
    new NamedPage("blog_settings_users", () => {
        new UserSelectAutoComplete($('input[name="uid"]:not([type="hidden"])'));
    }),
);
