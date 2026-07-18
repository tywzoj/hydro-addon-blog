import { addPage, i18n, NamedPage } from "@hydrooj/ui-default";

addPage(
    new NamedPage(["user_detail"], () => {
        $("<a>")
            .append($("<span>").addClass("icon icon-book"))
            .attr("data-tooltip", i18n("Blog"))
            .attr("href", `/blog/${UiContext.udoc._id}`) // eslint-disable-line @typescript-eslint/no-unsafe-member-access
            .addClass("profile-header__contact-item")
            .insertBefore($('a.profile-header__contact-item[href*="/home/messages"]'));
    }),
);
