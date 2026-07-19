import { addPage, i18n, NamedPage } from "@hydrooj/ui-default";

addPage(
    new NamedPage(["user_detail"], () => {
        $("<a>")
            .append($("<span>").addClass("icon icon-book"))
            .attr("data-tooltip", i18n("Blog"))
            .attr(
                "href",
                UiContext.domainId === "system"
                    ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                      `/blog/${UiContext.udoc._id}`
                    : // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                      `/d/${UiContext.domainId}/blog/${UiContext.udoc._id}`,
            )
            .addClass("profile-header__contact-item")
            .insertBefore($('a.profile-header__contact-item[href*="/home/messages"]'));
    }),
);
