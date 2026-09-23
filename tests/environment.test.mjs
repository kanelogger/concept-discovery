import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { diagnose } from '../scripts/doctor.mjs';
import { documentAnchors, markdownLinks, validateRepository } from '../scripts/validate.mjs';

const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function writeJson(root, path, value) { write(root, path, JSON.stringify(value, null, 2)); }
function update(root, file, transform) {
  const value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  transform(value);
  writeJson(root, file, value);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'concept-discovery-test-'));
  directories.push(root);
  const context = {
    agent_entry: 'AGENTS.md', environment: 'AI_ENVIRONMENT.md', product_contract: 'specs/product-contract.md',
    workflow: 'workflow/README.md', active_state: 'workflow-state.json', backlog: 'tasks/backlog.md',
  };
  for (const path of Object.values(context)) write(root, path, '# Fixture\n');
  write(root, 'tasks/0001-bootstrap.md', '# Bootstrap\n');
  write(root, 'README.md', '[Workflow](workflow/README.md)\n');
  writeJson(root, 'package.json', {
    private: true, engines: { node: '>=24 <25' },
    scripts: { doctor: 'node scripts/doctor.mjs', validate: 'node scripts/validate.mjs', test: 'node --test', check: 'npm run validate && npm test' },
  });
  writeJson(root, 'project.json', {
    schema_version: 1, project: { id: 'concept-discovery', stage: 'environment-bootstrap', product_status: 'not-implemented' },
    runtime: { node_major: 24 }, commands: { doctor: 'doctor', validate: 'validate', test: 'test', check: 'check' },
    context, required_paths: ['README.md', ...Object.values(context)], services: [], capabilities: { project_skills: [], connectors: [] },
  });
  writeJson(root, 'workflow-state.json', {
    schema_version: 1, task_id: '0001-bootstrap', phase: 'implementation', task_file: 'tasks/0001-bootstrap.md',
    updated_at: '2026-09-23T00:00:00Z', summary: 'Environment fixture', blockers: [], next_actions: ['Verify environment'],
    required_checks: ['npm run doctor', 'npm run check'], verification: [],
  });
  return root;
}

test('valid bootstrap environment passes without network or installed dependencies', () => {
  const result = validateRepository(fixture());
  assert.deepEqual(result.errors, []);
  assert.equal(result.markdownCount, 7);
});

test('missing or malformed root JSON reports useful validation errors', () => {
  const root = fixture();
  rmSync(join(root, 'project.json'));
  write(root, 'workflow-state.json', '{broken');
  const errors = validateRepository(root).errors;
  assert.ok(errors.some((error) => error.startsWith('project.json:')));
  assert.ok(errors.some((error) => error.startsWith('workflow-state.json:')));
});

test('manifest rejects unsupported schema, runtime, missing commands and malformed dependencies', () => {
  const root = fixture();
  update(root, 'project.json', (project) => {
    project.schema_version = 2;
    project.runtime.node_major = 22;
    project.commands.check = 'absent';
    project.capabilities.connectors = 'unknown';
  });
  update(root, 'package.json', (pkg) => { pkg.dependencies = ['accidental']; });
  const errors = validateRepository(root).errors.join('\n');
  for (const text of ['schema_version', 'runtime.node_major', 'commands.check', 'capabilities.connectors', 'dependencies']) assert.ok(errors.includes(text), errors);
});

test('project can advance stages and declare services or dependencies without changing the validator', () => {
  const root = fixture();
  update(root, 'project.json', (project) => {
    project.project.stage = 'mvp-development';
    project.project.product_status = 'in-progress';
    project.services = [{ name: 'local-app', command: 'npm run dev' }];
  });
  update(root, 'package.json', (pkg) => { pkg.dependencies = { example: '^1.0.0' }; });
  assert.deepEqual(validateRepository(root).errors, []);
});

test('required paths and context cannot point to absent files', () => {
  const root = fixture();
  rmSync(join(root, 'AGENTS.md'));
  update(root, 'project.json', (project) => { project.required_paths.push('missing.md'); });
  const errors = validateRepository(root).errors.join('\n');
  assert.match(errors, /context.agent_entry: missing path: AGENTS.md/);
  assert.match(errors, /required_paths: missing path: missing.md/);
});

test('context and active task references must identify files rather than directories', () => {
  const root = fixture();
  update(root, 'project.json', (project) => { project.context.backlog = 'tasks'; });
  update(root, 'workflow-state.json', (state) => { state.task_file = 'tasks'; });
  const errors = validateRepository(root).errors.join('\n');
  assert.match(errors, /context.backlog must point to a file/);
  assert.match(errors, /task_file must point to a file/);
});

test('active task must be the matching task ID file under tasks', () => {
  const root = fixture();
  update(root, 'workflow-state.json', (state) => { state.task_file = 'README.md'; });
  assert.match(validateRepository(root).errors.join('\n'), /task_file must be tasks\/<task_id>.md/);
  update(root, 'workflow-state.json', (state) => { state.task_file = 'tasks/0001-bootstrap.md'; state.task_id = '0002-other-task'; });
  assert.match(validateRepository(root).errors.join('\n'), /task_file must be tasks\/<task_id>.md/);
});

test('dates accept ISO calendar dates and timezone timestamps but reject rollover dates', () => {
  const root = fixture();
  for (const date of ['2026-09-23', '2024-02-29', '2026-09-23T00:00:00Z', '2026-09-23T08:00:00.123+08:00']) {
    update(root, 'workflow-state.json', (state) => { state.updated_at = date; });
    assert.deepEqual(validateRepository(root).errors, [], date);
  }
  for (const date of ['2026-02-30', '2026-02-29', '2026-04-31T00:00:00Z', '2026-09-23T24:00:00Z', '2026-09-23T00:00:00', '2026-09-23T00:00:00+99:00']) {
    update(root, 'workflow-state.json', (state) => { state.updated_at = date; });
    assert.match(validateRepository(root).errors.join('\n'), /updated_at must be a valid ISO date/, date);
  }
});

test('state rejects invalid phase, missing task, invalid timestamp and malformed verification', () => {
  const root = fixture();
  update(root, 'workflow-state.json', (state) => {
    state.phase = 'magically-done'; state.task_file = 'tasks/missing.md'; state.updated_at = 'yesterday';
    state.verification = [{ command: 'npm run check', result: 'maybe', recorded_at: 'yesterday' }];
  });
  const errors = validateRepository(root).errors.join('\n');
  for (const text of ['invalid phase', 'missing path', 'updated_at', 'invalid verification']) assert.ok(errors.includes(text), errors);
});

test('complete requires both successful checks and no unresolved blockers', () => {
  const root = fixture();
  update(root, 'workflow-state.json', (state) => { state.phase = 'complete'; state.blockers = ['Still broken']; });
  let errors = validateRepository(root).errors.join('\n');
  assert.match(errors, /complete requires no blockers/);
  assert.match(errors, /passed npm run doctor/);
  assert.match(errors, /passed npm run check/);
  update(root, 'workflow-state.json', (state) => {
    state.blockers = [];
    state.verification = ['npm run doctor', 'npm run check'].map((command) => ({ command, result: 'passed', recorded_at: state.updated_at }));
  });
  assert.deepEqual(validateRepository(root).errors, []);
  update(root, 'workflow-state.json', (state) => { state.verification.push({ command: 'npm run check', result: 'failed', recorded_at: state.updated_at }); });
  assert.match(validateRepository(root).errors.join('\n'), /passed npm run check/);
});

test('required checks must be a nonempty array of command strings in every phase', () => {
  const root = fixture();
  for (const required of [undefined, [], 'npm run validate', [''], [42]]) {
    update(root, 'workflow-state.json', (state) => { state.required_checks = required; });
    assert.match(validateRepository(root).errors.join('\n'), /required_checks must be a nonempty array/);
  }
});

test('a document task can complete using its own declared checks and latest recorded outcomes', () => {
  const root = fixture();
  update(root, 'workflow-state.json', (state) => {
    state.phase = 'complete';
    state.required_checks = ['npm run validate', 'manual: review document wording'];
    state.verification = [{ command: 'npm run validate', result: 'passed', recorded_at: state.updated_at }];
  });
  assert.match(validateRepository(root).errors.join('\n'), /passed manual: review document wording/);
  update(root, 'workflow-state.json', (state) => {
    state.verification.push({ command: 'manual: review document wording', result: 'passed', recorded_at: state.updated_at });
  });
  assert.deepEqual(validateRepository(root).errors, []);
  update(root, 'workflow-state.json', (state) => {
    state.verification.push({ command: 'npm run validate', result: 'failed', recorded_at: '2026-09-24' });
  });
  assert.match(validateRepository(root).errors.join('\n'), /passed npm run validate/);
});

test('blocked phase needs an explanation', () => {
  const root = fixture();
  update(root, 'workflow-state.json', (state) => { state.phase = 'blocked'; });
  assert.match(validateRepository(root).errors.join('\n'), /blocked requires a blocker/);
  update(root, 'workflow-state.json', (state) => { state.blockers = ['Decision pending']; });
  assert.deepEqual(validateRepository(root).errors, []);
});

test('local Markdown links support parent paths, spaces, escaped and nested parentheses, images and references', () => {
  const root = fixture();
  write(root, 'README.md', '# Root\n\n[Workflow](workflow/README.md)\n');
  write(root, 'docs/资料 (draft).md', '# Draft\n');
  write(root, 'docs/with(paren).md', '# Draft\n');
  write(root, 'docs/diagram.svg', '<svg/>');
  write(root, 'docs/index.md', [
    '[Root](../README.md#root)',
    '[Space](<资料 (draft).md> "title")',
    '[Encoded](%E8%B5%84%E6%96%99%20%28draft%29.md?raw=1)',
    '[Nested](with(paren).md)',
    '[Escaped](with\\(paren\\).md)',
    '![Diagram](diagram.svg)',
    '## Index',
    '[Reference][root]', '[root][]', '[root]', '[root]: ../README.md',
    '[Web](https://example.invalid/missing) [Email](mailto:test@example.invalid) [Anchor](#index)',
  ].join('\n'));
  assert.deepEqual(validateRepository(root).errors, []);
});

test('headings produce GitHub-style anchors, including duplicate suffixes', () => {
  assert.deepEqual(documentAnchors('# Title\n## 3. Core Methods\n### 13.2 允许无推荐\n## 重复\n## 重复\n'),
    new Set(['title', '3-core-methods', '132-允许无推荐', '重复', '重复-1']));
});

test('local fragments must match an existing heading and missing anchors fail', () => {
  const root = fixture();
  write(root, 'docs/target.md', '# Target Doc\n\n## Section One\n\n## Section One\n');
  write(root, 'README.md', [
    '# Readme',
    '[Ok](docs/target.md#section-one)',
    '[Second](docs/target.md#section-one-1)',
    '[Same](#readme)',
    '[Missing](docs/target.md#nope)',
    '[Self missing](#absent)',
    '[External](https://example.invalid/page#anchor)',
  ].join('\n'));
  const errors = validateRepository(root).errors;
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.match(errors.join('\n'), /README.md:5: missing anchor: #nope/);
  assert.match(errors.join('\n'), /README.md:6: missing anchor: #absent/);
});

test('broken links, images, and undefined references fail with the source filename', () => {
  const root = fixture();
  write(root, 'README.md', '[Broken](missing.md)\n![Missing](image.png)\n[Bad][missing-ref]\n');
  const errors = validateRepository(root).errors.join('\n');
  assert.match(errors, /README.md:1: missing path: missing.md/);
  assert.match(errors, /README.md:2: missing path: image.png/);
  assert.match(errors, /README.md:3: undefined link reference: missing-ref/);
});

test('path traversal, encoded traversal, absolute paths and file URLs are rejected', () => {
  const root = fixture();
  write(root, 'README.md', '[Escape](../outside.md)\n[Encoded](%2e%2e%2foutside.md)\n[Absolute](/tmp/data.md)\n[File](file:///tmp/data.md)\n[Windows](C:\\data.md)\n');
  update(root, 'project.json', (project) => { project.required_paths.push('../outside.md'); });
  const errors = validateRepository(root).errors;
  assert.equal(errors.length, 6, errors.join('\n'));
  assert.ok(errors.every((error) => /escapes repository|absolute or unsupported|repository-relative/.test(error)));
});

test('symlink references cannot escape repository even when the final file is missing', () => {
  const root = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'concept-discovery-outside-'));
  directories.push(outside);
  write(outside, 'private.md', '# Outside');
  symlinkSync(outside, join(root, 'external'));
  write(root, 'README.md', '[Existing](external/private.md)\n[Missing](external/missing.md)\n');
  const errors = validateRepository(root).errors;
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.ok(errors.every((error) => /symlink escapes repository/.test(error)));
});

test('JSON manifests cannot be symlinks to files outside the repository', () => {
  const root = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'concept-discovery-outside-'));
  directories.push(outside);
  write(outside, 'project.json', readFileSync(join(root, 'project.json'), 'utf8'));
  rmSync(join(root, 'project.json'));
  symlinkSync(join(outside, 'project.json'), join(root, 'project.json'));
  assert.match(validateRepository(root).errors.join('\n'), /project.json: symlink escapes repository/);
});

test('malformed URL encoding fails without throwing', () => {
  const root = fixture();
  write(root, 'README.md', '[Bad](%E0%A4%A.md)');
  assert.match(validateRepository(root).errors.join('\n'), /invalid URL encoding/);
});

test('code examples, Git metadata, hidden caches and dependencies are excluded', () => {
  const root = fixture();
  write(root, 'README.md', [
    '```md', '[Example](missing.md)', '```',
    '~~~~', '[Example](missing.md)', '~~~~',
    '`[Example](missing.md)`', '    [Example](missing.md)', '<!-- [Example](missing.md) -->',
  ].join('\n'));
  for (const path of ['.git/README.md', '.cache/README.md', '.local/README.md', 'coverage/README.md', 'node_modules/README.md']) write(root, path, '[Excluded](missing.md)');
  assert.deepEqual(validateRepository(root).errors, []);
  assert.deepEqual(markdownLinks('```md\n[x](missing)\n```\n`[x](missing)`'), []);
});

test('Markdown in configuration directories is still checked', () => {
  const root = fixture();
  write(root, '.github/PULL_REQUEST_TEMPLATE.md', '[Broken](missing.md)');
  assert.match(validateRepository(root).errors.join('\n'), /PULL_REQUEST_TEMPLATE.md:1: missing path/);
});

test('doctor reports wrong Node and missing Git as failures without throwing', () => {
  const checks = diagnose({ nodeVersion: '22.0.0', run() { throw new Error('unavailable'); } });
  assert.ok(checks.every((check) => !check.passed));
});

test('doctor identifies a real Git root and rejects a nested working directory', () => {
  const root = fixture();
  execFileSync('git', ['init', '--quiet', root]);
  assert.ok(diagnose({ root, nodeVersion: '24.18.0' }).every((check) => check.passed));
  assert.equal(diagnose({ root: join(root, 'tasks'), nodeVersion: '24.18.0' }).find((check) => check.name === 'Repository root').passed, false);
});
