import { execFile, fork, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { MongoClient } from "mongodb";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = createRequire(import.meta.url);
const execute = promisify(execFile);
const serve = process.argv[2] === "--serve";
const runId = `hydro-blog-${process.pid}-${randomUUID().slice(0, 8)}`;
const container = `${runId}-mongo`;
const output = join(root, "test-results", runId);
const directory = await mkdtemp(join(tmpdir(), "hydro-blog-"));
const abort = new AbortController();
let hydro;
let tests;
let logs = "";
let ownsContainer = false;

process.once("SIGINT", () => abort.abort());
process.once("SIGTERM", () => abort.abort());

async function docker(...args) {
    return (await execute("docker", args, { timeout: 120000, maxBuffer: 1024 * 1024 })).stdout.trim();
}

async function availablePort() {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port;
    await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
    return port;
}

async function stop(child) {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
        await exited;
    } finally {
        clearTimeout(timer);
    }
}

async function cleanup(name, action) {
    try {
        await action();
    } catch (error) {
        console.error(`${name} cleanup failed: ${error.message}`);
        process.exitCode = 1;
    }
}

async function waitForMongo(uri) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        abort.signal.throwIfAborted();
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: 500, connectTimeoutMS: 500 });
        try {
            await client.connect();
            await client.db().command({ ping: 1 });
            return;
        } catch {
            await delay(200, undefined, { signal: abort.signal });
        } finally {
            await client.close();
        }
    }
    throw new Error("The disposable MongoDB did not become ready within 30 seconds");
}

try {
    await mkdir(output, { recursive: true });
    await writeFile(
        join(output, "runtime.json"),
        JSON.stringify({ runId, container, directory, driverPid: process.pid }, null, 2),
    );
    await docker("info", "--format", "{{.ServerVersion}}");
    ownsContainer = true;
    await docker(
        "run",
        "--detach",
        "--rm",
        "--name",
        container,
        "--label",
        `hydro-addon-blog.e2e=${runId}`,
        "--publish",
        "127.0.0.1::27017",
        "--tmpfs",
        "/data/db",
        "--tmpfs",
        "/data/configdb",
        "mongo:7-jammy",
    );
    const published = await docker("port", container, "27017/tcp");
    if (!/^127\.0\.0\.1:\d+$/.test(published)) throw new Error("Unexpected MongoDB port binding");
    const uri = `mongodb://${published}/blog_e2e`;
    await waitForMongo(uri);
    const port = Number(process.env.HYDRO_E2E_PORT || (serve ? 8888 : await availablePort()));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("HYDRO_E2E_PORT must be a valid port");
    const url = `http://127.0.0.1:${port}`;
    const home = join(directory, "home");
    const temporary = join(directory, "tmp");
    const storage = join(directory, "storage");
    const profile = join(home, ".hydro", "profiles", "blog-e2e");
    await Promise.all([
        mkdir(profile, { recursive: true }),
        mkdir(temporary),
        mkdir(storage),
        mkdir(output, { recursive: true }),
    ]);
    await writeFile(join(profile, "config.json"), JSON.stringify({ uri }));
    await writeFile(
        join(profile, "addon.json"),
        JSON.stringify([dirname(load.resolve("@hydrooj/ui-default/package.json")), root]),
    );
    const environment = {
        ...process.env,
        HOME: home,
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
        DEFAULT_STORE_PATH: storage,
        HYDRO_PROFILE: "blog-e2e",
        NODE_APP_INSTANCE: "0",
        NODE_ENV: "development",
        DEV: "1",
        HYDRO_E2E_URL: url,
    };
    // Hydro's CI branch bypasses the configured database and storage defaults.
    delete environment.CI;
    delete environment.HYDRO_CLI;
    hydro = fork(
        join(root, "scripts/hydro-entry.cjs"),
        ["--host", "127.0.0.1", "--port", String(port), "--disableWorker"],
        {
            cwd: root,
            env: environment,
            execArgv: [],
            stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
    );
    for (const stream of [hydro.stdout, hydro.stderr]) {
        stream.on("data", (chunk) => {
            logs = (logs + chunk.toString()).slice(-100000);
            if (serve) process.stdout.write(chunk);
        });
    }
    await new Promise((done, reject) => {
        const timeout = setTimeout(() => finish(new Error("Hydro startup exceeded 90 seconds")), 90000);
        const exit = (code, signal) => finish(new Error(`Hydro exited during startup (${code ?? signal})`));
        const cancelled = () => finish(new Error("Hydro startup interrupted"));
        const message = (value) => {
            if (value?.type === "hydro-e2e-ready") finish();
            if (value?.type === "hydro-e2e-error") finish(new Error(value.message));
        };
        function finish(error) {
            clearTimeout(timeout);
            hydro.off("exit", exit);
            hydro.off("message", message);
            abort.signal.removeEventListener("abort", cancelled);
            if (error) reject(error);
            else done();
        }
        hydro.once("exit", exit);
        hydro.on("message", message);
        abort.signal.addEventListener("abort", cancelled, { once: true });
        if (abort.signal.aborted) cancelled();
    });
    const response = await fetch(`${url}/login`, {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok || !(await response.text()).includes('data-page="user_login"')) {
        throw new Error("Hydro's login template did not become ready");
    }
    const blog = await fetch(`${url}/blog`, {
        redirect: "manual",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
    });
    if (![200, 302, 403].includes(blog.status)) {
        throw new Error(`The blog route did not become ready (HTTP ${blog.status})`);
    }
    console.log(`Hydro ready: ${url}\nIsolated storage: ${storage}\nRun artifacts: ${output}`);
    if (serve) {
        console.log(
            "Disposable test accounts: blog_author, blog_viewer, blog_editor\nPassword: Disposable-Blog-Test-2026\nPress Ctrl+C to stop and remove the disposable environment.",
        );
        await new Promise((done) => {
            if (abort.signal.aborted) done();
            else abort.signal.addEventListener("abort", done, { once: true });
            hydro.once("exit", () => {
                if (!abort.signal.aborted) process.exitCode = 1;
                done();
            });
        });
    } else {
        tests = spawn(process.execPath, [load.resolve("@playwright/test/cli"), "test", ...process.argv.slice(2)], {
            cwd: root,
            env: { ...process.env, HYDRO_E2E_URL: url, HYDRO_E2E_MONGO_URI: uri, HYDRO_E2E_OUTPUT: output },
            stdio: "inherit",
        });
        let forceStop;
        const cancel = () => {
            if (forceStop) return;
            process.exitCode = 1;
            tests.kill("SIGTERM");
            forceStop = setTimeout(() => tests.kill("SIGKILL"), 5000);
        };
        const serverExited = () => {
            process.exitCode = 1;
            cancel();
        };
        hydro.once("exit", serverExited);
        abort.signal.addEventListener("abort", cancel, { once: true });
        if (abort.signal.aborted) cancel();
        const timeout = setTimeout(cancel, 180000);
        try {
            const [code] = await once(tests, "exit");
            if (process.exitCode !== 1) process.exitCode = code ?? 1;
        } finally {
            clearTimeout(timeout);
            clearTimeout(forceStop);
            hydro.off("exit", serverExited);
            abort.signal.removeEventListener("abort", cancel);
        }
    }
} catch (error) {
    console.error(error.message);
    if (logs) console.error(logs);
    process.exitCode = 1;
} finally {
    await cleanup("Playwright", () => stop(tests));
    await cleanup("Hydro", () => stop(hydro));
    if (logs) {
        await cleanup("Hydro log", async () => {
            await mkdir(output, { recursive: true });
            await writeFile(join(output, "hydro.log"), logs);
        });
    }
    if (ownsContainer) {
        try {
            const label = await docker(
                "inspect",
                "--format",
                '{{index .Config.Labels "hydro-addon-blog.e2e"}}',
                container,
            );
            if (label !== runId) {
                console.error("Refusing to remove a container not owned by this run");
                process.exitCode = 1;
            } else {
                await docker("rm", "--force", container);
            }
        } catch (error) {
            if (!/No such (object|container)/i.test(error.message)) {
                console.error(`MongoDB cleanup failed: ${error.message}`);
                process.exitCode = 1;
            }
        }
    }
    await cleanup("Authentication state", () => rm(join(output, "auth"), { recursive: true, force: true }));
    await cleanup("Runtime directory", () => rm(directory, { recursive: true, force: true }));
}
