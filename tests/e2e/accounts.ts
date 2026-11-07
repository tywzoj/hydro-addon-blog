export const TEST_PASSWORD = "000000";

export const accounts = {
    author: { id: 2, name: "blog_author", password: TEST_PASSWORD },
    viewer: { id: 3, name: "blog_viewer", password: TEST_PASSWORD },
    editor: { id: 4, name: "blog_editor", password: TEST_PASSWORD },
    reporterA: { id: 5, name: "blog_reporter_a", password: TEST_PASSWORD },
    reporterB: { id: 6, name: "blog_reporter_b", password: TEST_PASSWORD },
    reporterC: { id: 7, name: "blog_reporter_c", password: TEST_PASSWORD },
} as const;
