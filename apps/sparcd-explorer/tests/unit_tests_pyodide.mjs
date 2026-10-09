// Run the Python unit tests inside the Pyodide build the exported page loads.
// polars' wasm build can fail where native polars passes, and the page only
// shows that after login.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPyodide, version } from "pyodide";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const [marimo, pyodide] = execFileSync(
  "uv",
  ["run", "--locked", "python", "-c",
    "import marimo; from marimo._pyodide.pyodide_constraints import PYODIDE_VERSION; print(marimo.__version__, PYODIDE_VERSION)"],
  { cwd: app, encoding: "utf8" },
).trim().split(" ");
if (pyodide !== version) {
  console.error(`marimo ${marimo} loads Pyodide ${pyodide}; set the pyodide devDependency to ${pyodide} (it is ${version}).`);
  process.exit(1);
}

// The page takes package versions from marimo's lockfile, not Pyodide's own.
const lockText = await (await fetch(`https://wasm.marimo.app/pyodide-lock.json?v=${marimo}&pyodide=v${pyodide}`)).text();
const lockFile = join(mkdtempSync(join(tmpdir(), "marimo-lock-")), "pyodide-lock.json");
writeFileSync(lockFile, lockText);
const { packages } = JSON.parse(lockText);

const py = await loadPyodide({ lockFileURL: lockFile });
py.FS.mkdirTree("/app");
py.FS.mount(py.FS.filesystems.NODEFS, { root: app }, "/app");

// What marimo's worker preloads, plus polars. Pyodide's Node loader can't fetch
// lock entries given as absolute URLs, so micropip installs those.
const preload = ["msgspec", "marimo-base", "markdown", "pymdown-extensions", "narwhals", "packaging", "polars"];
const byUrl = preload.map((name) => packages[name].file_name).filter((file) => file.startsWith("https://"));
await py.loadPackage(["micropip", ...preload.filter((name) => !packages[name].file_name.startsWith("https://"))]);
py.globals.set("by_url", py.toPy(byUrl));
await py.runPythonAsync(`
import micropip
await micropip.install(by_url, deps=False)
await micropip.install(["minio", "plotly", "anywidget", "python-dotenv"])
`);

const ok = py.runPython(`
import os, sys, unittest
os.chdir("/app/tests")
sys.path.insert(0, "/app/tests")
unittest.TextTestRunner().run(unittest.defaultTestLoader.discover(".", pattern="test_*.py")).wasSuccessful()
`);
process.exit(ok ? 0 : 1);
