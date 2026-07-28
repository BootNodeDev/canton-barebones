// Centralizes CLI output so the `--json` behavior lives in one place instead of
// being repeated in every command. Commands build a plain data object and a
// human-text renderer; this module decides the format based on the mode set once
// by the entry point. Following CLI conventions: machine-readable success goes to
// stdout, errors go to stderr (even in JSON mode). See https://clig.dev/.

// Module-level flag so commands don't have to thread it through every call. Set
// once from the CLI entry point after parsing argv.
let jsonMode = false;

// Enables or disables machine-readable output for the rest of the process.
export function setJsonMode(on) {
  jsonMode = on;
}

// Lets commands whose JSON is produced elsewhere (e.g. `status`, which delegates
// to `docker compose --format json`) branch on the same flag.
export function isJsonMode() {
  return jsonMode;
}

// Prints a successful command result. In JSON mode `data` is emitted to stdout
// wrapped as `{ ok: true, ...data }`; otherwise `renderText` runs to print the
// human-readable form.
export function printResult(data, renderText) {
  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, ...data }, null, 2));
  } else {
    renderText();
  }
}

// Prints a failure to stderr (per CLI convention, errors stay on stderr in both
// modes). In JSON mode it is a structured `{ ok: false, error }` object so a
// consumer can parse it; the caller is responsible for the non-zero exit code.
export function printError(message) {
  if (jsonMode) {
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(message);
  }
}
