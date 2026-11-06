const DEFAULT_TEMPLATE_EXTENSION = "html" as const;

export function toTemplate<T extends string, U extends string = typeof DEFAULT_TEMPLATE_EXTENSION>(
    name: T,
    ext: U = DEFAULT_TEMPLATE_EXTENSION as U,
): `${T}.${U}` {
    return `${name}.${ext}`;
}
