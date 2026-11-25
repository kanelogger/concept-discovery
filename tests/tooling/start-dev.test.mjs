import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function launch(t, { args = [], configured = true, context = "orbstack", dockerHost = "", dockerStatus = 0, npmStatus = 0 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "cd-launch-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const project = join(directory, "test project");
  const commands = join(directory, "bin");
  const trace = join(directory, "trace");
  mkdirSync(project);
  mkdirSync(commands);
  writeFileSync(trace, "");
  if (configured) {
    mkdirSync(join(project, ".local/knowledge"), { recursive: true });
    writeFileSync(join(project, ".local/knowledge/compose.env"), "");
  }
  const launcher = join(project, "start-dev.sh");
  cpSync(new URL("../../start-dev.sh", import.meta.url), launcher);
  const stubs = {
    docker: `case "$*" in
  'context show') printf '%s\n' "$CD_TEST_CONTEXT" ;;
  info) exit "$CD_TEST_DOCKER_STATUS" ;;
  *) exit 99 ;;
esac`,
    orbctl: 'test "$*" = start',
    npm: 'test -r .local/knowledge/compose.env && exit "$CD_TEST_NPM_STATUS"',
  };
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(commands, name), `#!/bin/sh\nprintf '%s %s\n' '${name}' "$*" >> "$CD_TEST_TRACE"\n${body}\n`, { mode: 0o755 });
  }
  const result = spawnSync(launcher, args, {
    cwd: directory,
    encoding: "utf8",
    env: {
      PATH: `${commands}:/usr/bin:/bin`,
      DOCKER_HOST: dockerHost,
      CD_TEST_TRACE: trace,
      CD_TEST_CONTEXT: context,
      CD_TEST_DOCKER_STATUS: String(dockerStatus),
      CD_TEST_NPM_STATUS: String(npmStatus),
    },
  });
  assert.ifError(result.error);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls: readFileSync(trace, "utf8").split("\n").filter(Boolean) };
}

test("launches from outside the project and starts the selected OrbStack before npm", t => {
  const result = launch(t, { dockerStatus: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["docker context show", "docker info", "orbctl start", "npm start"]);
});

test("keeps a running OrbStack and returns npm's failure status", t => {
  const result = launch(t, { npmStatus: 23 });
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(result.calls, ["docker context show", "docker info", "npm start"]);
});

test("leaves other Docker contexts and explicit hosts in control", t => {
  const other = launch(t, { context: "default", dockerStatus: 1 });
  assert.equal(other.status, 0, other.stderr);
  assert.deepEqual(other.calls, ["docker context show", "npm start"]);
  const explicitHost = launch(t, { dockerHost: "unix:///tmp/other.sock", dockerStatus: 1 });
  assert.equal(explicitHost.status, 0, explicitHost.stderr);
  assert.deepEqual(explicitHost.calls, ["npm start"]);
});

test("reports missing private configuration before starting anything", t => {
  const result = launch(t, { configured: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm run deploy:init/);
  assert.deepEqual(result.calls, []);
});

test("stops the stack without launching OrbStack and preserves the stop exit status", t => {
  const result = launch(t, { args: ["stop"], dockerStatus: 1, npmStatus: 23 });
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(result.calls, ["npm stop"]);
});

test("restart reuses startup and forces containers to be recreated", t => {
  const result = launch(t, { args: ["restart"], dockerStatus: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["docker context show", "docker info", "orbctl start", "npm start -- --force-recreate"]);
});

test("validates action arguments and displays help before accessing private configuration", t => {
  const help = launch(t, { args: ["--help"], configured: false });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /\[start\|stop\|restart\]/);
  assert.deepEqual(help.calls, []);
  for (const args of [["invalid"], ["stop", "extra"], [""]]) {
    const invalid = launch(t, { args, configured: false });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /\[start\|stop\|restart\]/);
    assert.deepEqual(invalid.calls, []);
  }
});
