export function toTemplate<T extends string, U extends string = "html">(name: T, ext: U = "html" as U): `${T}.${U}` {
    return `${name}.${ext}`;
}
