import { addPage, i18n, NamedPage } from "@hydrooj/ui-default";

addPage(
    new NamedPage(["user_detail"], () => {
        $("<a>")
            .append($("<span>").addClass("icon icon-book"))
            .attr("data-tooltip", i18n("Blog"))
            .attr(
                "href",
                /* eslint-disable @typescript-eslint/no-unsafe-member-access */
                UiContext.domainId === "system"
                    ? `/blog/${UiContext.udoc._id}`
                    : `/d/${UiContext.domainId}/blog/${UiContext.udoc._id}`,
                /* eslint-enable @typescript-eslint/no-unsafe-member-access */
            )
            .addClass("profile-header__contact-item")
            .insertBefore($('a.profile-header__contact-item[href*="/home/messages"]'));
    }),
);
