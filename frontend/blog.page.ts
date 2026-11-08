import { addPage, i18n, NamedPage } from "@hydrooj/ui-default";

import { SYSTEM_DOMAIN } from "../features/shared/constants";

addPage(
    new NamedPage(["user_detail"], () => {
        if (!UiContext.blogAccess) return;
        $("<a>")
            .append($("<span>").addClass("icon icon-book"))
            .attr("data-tooltip", i18n("Blog"))
            .attr(
                "href",
                /* eslint-disable @typescript-eslint/no-unsafe-member-access */
                UiContext.domainId === SYSTEM_DOMAIN
                    ? `/blog/${UiContext.udoc._id}`
                    : `/d/${UiContext.domainId}/blog/${UiContext.udoc._id}`,
                /* eslint-enable @typescript-eslint/no-unsafe-member-access */
            )
            .addClass("profile-header__contact-item")
            .insertBefore($('a.profile-header__contact-item[href*="/home/messages"]'));
    }),
);
