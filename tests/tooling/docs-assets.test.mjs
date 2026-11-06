import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { npmScriptReferences, currentCommandDocument, validateRepository } from '../../scripts/validate.mjs';
import { readUIAsset } from '../../server/ui-assets.mjs';

test('npm script references preserve source lines and ignore prose, package commands and JS examples', () => {
  const source = 'npm run invented in prose\n`npm run check -- --flag`\n\n```sh\nnpm ci\nnpm --silent run --silent test:browser\nnpm test\n```\n```js\nconst text = "npm run not-a-command";\n```';
  assert.deepEqual(npmScriptReferences(source), [{name:'check',line:2},{name:'test:browser',line:6},{name:'test',line:7}]);
  assert.deepEqual(npmScriptReferences('`npm run-script validate` `npm start` `npm stop`'), [{name:'validate',line:1},{name:'start',line:1},{name:'stop',line:1}]);
  assert.equal(currentCommandDocument('tasks/other.md','tasks/current.md'), false);
  assert.equal(currentCommandDocument('docs/notes.md','tasks/current.md'), false);
  assert.equal(currentCommandDocument('tasks/current.md','tasks/current.md'), true);
});

test('an idle workflow accepts a fresh repository and rejects carried-over task state', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-workflow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const writeJson = (file, value) => writeFileSync(join(dir, file), JSON.stringify(value));
  writeFileSync(join(dir, 'README.md'), '# Fresh repository\n');
  writeJson('package.json', {
    engines: { node: '>=24 <25' }, private: true, scripts: { validate: 'node validate.mjs' },
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
    blockers: [], next_actions: [], required_checks: [], verification: [],
  };
  writeJson('workflow-state.json', idle);
  assert.deepEqual(validateRepository(dir).errors, []);

  writeJson('workflow-state.json', {
    ...idle, task_id: 'old-task', verification: [{ command: 'npm test', result: 'passed' }],
  });
  assert.deepEqual(validateRepository(dir).errors, [
    'workflow-state.json: idle requires null task pointers',
    'workflow-state.json: idle requires empty verification',
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
