import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { documentAnchors, markdownLinks, npmScriptReferences, currentCommandDocument, validateRepository } from '../../scripts/validate.mjs';
import { readUIAsset } from '../../server/ui-assets.mjs';

test('npm script references preserve source lines and ignore prose, package commands and JS examples', () => {
  const source = 'npm run invented in prose\n`npm run check -- --flag`\n\n```sh\nnpm ci\nnpm --silent run --silent test:browser\nnpm test\n```\n```js\nconst text = "npm run not-a-command";\n```';
  assert.deepEqual(npmScriptReferences(source), [{name:'check',line:2},{name:'test:browser',line:6},{name:'test',line:7}]);
  assert.deepEqual(npmScriptReferences('`npm run-script validate` `npm start` `npm stop`'), [{name:'validate',line:1},{name:'start',line:1},{name:'stop',line:1}]);
  assert.equal(currentCommandDocument('tasks/other.md','tasks/current.md'), false);
  assert.equal(currentCommandDocument('docs/notes.md','tasks/current.md'), false);
  assert.equal(currentCommandDocument('tasks/current.md','tasks/current.md'), true);
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cd-workflow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const writeJson = (file, value) => writeFileSync(join(dir, file), JSON.stringify(value));
  writeFileSync(join(dir, 'README.md'), '# Fresh repository\n');
  writeJson('package.json', {
    engines: { node: '>=24.7 <25' }, private: true, scripts: { validate: 'node validate.mjs' },
  });
  writeJson('project.json', {
    schema_version: 1,
    project: { id: 'concept-discovery', stage: 'local', product_status: 'implemented' },
    runtime: { node_major: 24 },
    commands: { doctor: 'validate', validate: 'validate', test: 'validate', check: 'validate', start: 'validate' },
    context: {
      agent_entry: 'README.md', environment: 'README.md', product_contract: 'README.md',
      workflow: 'README.md', active_state: 'workflow-state.json',
    },
    services: [],
    capabilities: { project_skills: [], connectors: [] },
  });
  const idle = {
    schema_version: 1, phase: 'idle', task_id: null, task_file: null,
    updated_at: '2026-11-06', summary: 'No current task',
  };
  writeJson('workflow-state.json', idle);
  return { dir, writeJson, idle };
}

test('workflow validates its task pointer without requiring duplicate check records', (t) => {
  const { dir, writeJson, idle } = fixture(t);
  assert.deepEqual(validateRepository(dir).errors, []);

  writeJson('workflow-state.json', {
    ...idle, task_id: 'old-task', verification: [{ command: 'npm test', result: 'passed' }],
  });
  assert.deepEqual(validateRepository(dir).errors, ['workflow-state.json: idle requires null task pointers']);

  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks/current.md'), '# Current task\n\nValidation results live here.\n');
  const active = { ...idle, phase: 'complete', task_id: 'current', task_file: 'tasks/current.md' };
  writeJson('workflow-state.json', active);
  assert.deepEqual(validateRepository(dir).errors, []);
  writeJson('workflow-state.json', {
    ...active, required_checks: ['old check'], verification: [{ command: 'old check', result: 'failed' }],
  });
  assert.deepEqual(validateRepository(dir).errors, [], 'legacy verification fields are no longer a completion gate');
  writeJson('workflow-state.json', { ...active, task_file: 'tasks/missing.md' });
  assert.ok(validateRepository(dir).errors.some(error => error.includes('missing path: tasks/missing.md')));
  writeJson('workflow-state.json', { ...active, updated_at: '2026-02-30' });
  assert.ok(validateRepository(dir).errors.some(error => error.includes('valid ISO date')));
});

test('Markdown validation reads link, image and definition destinations with their source lines', () => {
  const source = [
    '---', 'title: "[metadata](ghost.md)"', '---',
    'bare ](ghost.md), `![code](ghost.png)` and \\[literal](ghost.md)',
    '<!-- [comment](ghost.md)', '![also](ghost.png) -->', '',
    '    [indented](ghost.md)', '', '~~~md', '[fenced](ghost.md)', '~~~~', '',
    '[two', 'lines](<dir/a b.md> "title") and ![image](img\\(1\\).png)', '',
    '[from definition][Multi Word]', '', '[multi word]:', '  <target &amp; another.md>',
  ].join('\r\n');
  assert.deepEqual(markdownLinks(source), [
    { destination: 'dir/a b.md', line: 14 }, { destination: 'img(1).png', line: 15 },
    { destination: 'target & another.md', line: 19 },
  ]);
});

test('repository validation checks Markdown between leading thematic breaks', (t) => {
  const { dir } = fixture(t);
  for (const [bom, eol] of [['', '\n'], ['\uFEFF', '\r\n']]) {
    const check = lines => {
      writeFileSync(join(dir, 'README.md'), bom + lines.join(eol));
      return validateRepository(dir).errors;
    };
    const runbook = 'Consult the [runbook](missing.md).';
    assert.deepEqual(check(['---', runbook, '---']), ['README.md:2: missing path: missing.md']);
    assert.deepEqual(check(['---', '[manual]: missing.md', '---']), ['README.md:2: missing path: missing.md']);
    assert.deepEqual(check(['---', 'title: [', '', runbook, '---']), ['README.md:4: missing path: missing.md']);
    assert.deepEqual(check(['---', 'title: *absent', 'note: ' + runbook, '---']), ['README.md:3: missing path: missing.md']);
    assert.deepEqual(check(['---', '# Operations', '', '`npm run unavailable`', '', '[lost][manual]', '', '---', '[here](#operations)']), [
      'README.md:4: unknown npm script: unavailable', 'README.md:6: undefined link reference: manual',
    ]);
    assert.deepEqual(check(['---', '# Operations', '---', '[here](#operations)']), []);
    assert.deepEqual(check(['---', '# Metadata comment', 'details:', '  note: "[runbook](missing.md) `npm run unavailable`"', '...', '', runbook]), [
      'README.md:7: missing path: missing.md',
    ]);
  }
});

test('only unresolved full and collapsed references produce diagnostics', () => {
  const source = [
    '[ordinary] and bare ][unused] and \\[escaped][Missing]',
    'literal [word][next](here.md) and `![code][Missing]`',
    '[**formatted**][Missing] and ![lost][]',
    '[escaped label][needs\\]definition]',
    '> [quoted][multiple', '> words]', '',
    '[existing][] and ![ok][EXISTING]', '', '[existing]: here.md', '',
    '~~~md', '[ignored][Missing]',
  ].join('\n');
  assert.deepEqual(markdownLinks(source), [
    { destination: 'here.md', line: 2 }, { destination: 'here.md', line: 10 },
    { error: 'undefined link reference: Missing', line: 3 },
    { error: 'undefined link reference: lost', line: 3 },
    { error: 'undefined link reference: needs]definition', line: 4 },
    { error: 'undefined link reference: multiple\nwords', line: 5 },
  ]);
});

test("multiline unresolved references point at the missing label, including escaped newlines", () => {
  for (const eol of ["\n","\r\n"]) {
    const source = ["[first", "second][a\\", "b]"].join(eol);
    const errors = markdownLinks(source);
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /undefined link reference/);
    assert.equal(errors[0].line, 2);
  }
});

test('heading anchors use rendered text and reserve suffixed names in document order', () => {
  const source = [
    '---', 'title: Example', '# metadata', '---', '# Read `inline`, **bold** & [links](ok.md)',
    '## Scale', '## Scale-1', '## Scale', '## Scale-1', '',
    '标题 / 示例', '------', '', '```md', '# hidden', '```', '<!-- # hidden -->',
  ].join('\n');
  assert.deepEqual([...documentAnchors(source)], ['read-inline-bold--links', 'scale', 'scale-1', 'scale-2', 'scale-1-1', '标题--示例']);
});

test('repository link validation retains the path boundary and checks anchors across files', (t) => {
  const { dir } = fixture(t);
  symlinkSync(tmpdir(), join(dir, 'outside'));
  writeFileSync(join(dir, 'target.md'), '# Hello `world`\n');
  writeFileSync(join(dir, 'README.md'), [
    '---', 'note: "`npm run metadata`"', '---', '<!-- `npm run comment` -->', '',
    '[ok](target.md#hello-world)', '[missing](target.md#absent)',
    '[escape](%2e%2e/secret)', '[symlink](outside/missing.md)', '[file](file:///secret)',
    '[backslash](a\\\\/b)', '`npm run unknown`',
  ].join('\n'));
  assert.deepEqual(validateRepository(dir).errors, [
    'README.md:12: unknown npm script: unknown', 'README.md:7: missing anchor: #absent',
    'README.md:8: path escapes repository: ../secret', 'README.md:9: symlink escapes repository: outside/missing.md',
    'README.md:10: local URL must be repository-relative: file:///secret', 'README.md:11: absolute or unsupported path: a\\/b',
  ]);
});

test('UI publication serves only manifest assets and rejects escape, source and symlink requests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-ui-assets-'));
  try {
    mkdirSync(join(dir,'chunks'));
    writeFileSync(join(dir,'manifest.json'),JSON.stringify({assets:[{path:'chunks/app.js'},{path:'escape.js'}]}));
    writeFileSync(join(dir,'chunks/app.js'),'export const ok = true;');
    symlinkSync(join(dir,'chunks/app.js'),join(dir,'escape.js'));
    assert.equal(readUIAsset('chunks/app.js',dir).type,'text/javascript; charset=utf-8');
    for(const path of ['../package.json','%2e%2e/package.json','chunks//app.js','source.jsx','escape.js']) assert.equal(readUIAsset(path,dir),null,path);
    assert.equal(readUIAsset('manifest.json',dir).type,'application/json; charset=utf-8');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
