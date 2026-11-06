import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "tsconfig.json");
const formatHost = {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => ts.sys.newLine,
};

function report(diagnostics) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
}

function isProjectFile(file) {
    const path = relative(root, resolve(file.fileName));
    return !isAbsolute(path) && !path.split(sep).includes("..") && !path.split(sep).includes("node_modules");
}

const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) {
    report([config.error]);
    process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, { noEmit: true }, configPath);
if (parsed.errors.length) {
    report(parsed.errors);
    process.exit(1);
}
const program = ts.createProgram(parsed.fileNames, parsed.options);
const files = program.getSourceFiles().filter(isProjectFile);
if (!files.length) {
    console.error("Typecheck failed: no project TypeScript files were found.");
    process.exit(1);
}

// Hydro publishes TS source as its type API. Resolve it normally, but check our implementation, not theirs.
const diagnostics = [
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...files.flatMap((file) => [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]),
];
if (diagnostics.length) report(diagnostics);
const failed = diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
console.log(
    `Typecheck ${failed ? "failed" : "passed"}: ${files.length} project files; dependency implementations are not checked.`,
);
process.exitCode = failed ? 1 : 0;
