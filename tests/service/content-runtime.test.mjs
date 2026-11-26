import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fixture } from '../tooling/content-command-fixture.mjs';

test('a fresh SQLite service can list and read compiled cards without the kernel, compiler or Markdown packages', t => {
  const directory = dirname(fixture(t).build());
  const probe = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    registerHooks({load(url, context, next) {
      const parser = /\\/node_modules\\/(?:markdown-it|mdast-util-from-markdown|parse5)\\//;
      if (parser.test(url) || /\\/(?:siyuan|legacy-reader|content-database-writer|card-lifecycle-[^/]+)\\.mjs$/.test(url))
        throw new Error('Unneeded runtime dependency: ' + url);
      return next(url, context);
    }});
    await import('./scripts/start-content-service.mjs');
    const { openContentReader } = await import('./server/content-reader.mjs');
    const { createReaderApp } = await import('./server/reader-http.mjs');
    const reader = openContentReader({directory:process.argv[1], libraryId:'fixture', origin:'http://127.0.0.1'});
    const app = createReaderApp({contentReader:reader, publicUrl:'http://127.0.0.1', authMode:'local', agentToken:'fixture'});
    try {
      await new Promise((yes, no) => app.once('error', no).listen(0, '127.0.0.1', yes));
      const url = 'http://127.0.0.1:' + app.address().port;
      const list = await fetch(url + '/api/v1/commands/list', {
        method:'POST', headers:{Authorization:'Bearer fixture'}, body:'{}',
      });
      assert.equal(list.status, 200);
      assert.equal((await list.json()).data.total, 2);
      const detail = await fetch(url + '/?id=old');
      assert.equal(detail.status, 200);
      assert.match(await detail.text(), /旧解释/);
    } finally {
      app.closeAllConnections();
      await new Promise(resolve => app.close(resolve));
      reader.close();
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe, directory], {
    cwd:new URL('../../', import.meta.url), encoding:'utf8', timeout:15000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
