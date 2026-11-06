export const TEST_PASSWORD = "000000";

export const accounts = {
    author: { id: 2, name: "blog_author", password: TEST_PASSWORD },
    viewer: { id: 3, name: "blog_viewer", password: TEST_PASSWORD },
    editor: { id: 4, name: "blog_editor", password: TEST_PASSWORD },
} as const;
