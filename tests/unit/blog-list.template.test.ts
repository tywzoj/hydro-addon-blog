import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const load = createRequire(resolve("package.json"));
const uiRoot = dirname(load.resolve("@hydrooj/ui-default/package.json"));
const { Environment } = createRequire(join(uiRoot, "package.json"))("nunjucks") as {
    Environment: new (
        loader: { getSource: (name: string) => { src: string; path: string; noCache: boolean } },
        options: { autoescape: boolean },
    ) => { render: (name: string, context: Record<string, unknown>) => string };
};

const sources: Record<string, string> = {
    "blog_main.html": readFileSync(resolve("templates/blog_main.html"), "utf8"),
    "components/paginator.html": readFileSync(join(uiRoot, "templates/components/paginator.html"), "utf8"),
    "layout/basic.html": "{% block content %}{% endblock %}",
    "components/nothing.html": "",
    "components/user.html": "",
    "components/blog_user.html": "",
    "components/blog_list.html": "{% macro render() %}{% endmacro %}",
};
const environment = new Environment(
    { getSource: (name) => ({ src: sources[name], path: name, noCache: true }) },
    { autoescape: true },
);

describe("blog list pagination", () => {
    it.each(["views", "latest", "latest_update"])("preserves %s on every paginator link", (sort) => {
        const html = environment.render("blog_main.html", {
            ddocs: [{}],
            page: 5,
            dpcount: 10,
            sort,
            sort_keys: ["views", "latest", "latest_update"],
            _: (text: string) => text,
            paginate: () => [
                ["first", 1],
                ["previous", 4],
                ["page", 3],
                ["current", 5],
                ["ellipsis", 0],
                ["next", 6],
                ["last", 10],
            ],
        });
        const urls = [...html.matchAll(/href="([^"]+)"/g)].map(
            ([, href]) => new URL(href.replaceAll("&amp;", "&"), "http://localhost/blog"),
        );
        expect(urls.map((url) => url.searchParams.get("page"))).toEqual(["1", "4", "3", "6", "10"]);
        for (const url of urls) expect(url.searchParams.get("sort")).toBe(sort);
    });
});
