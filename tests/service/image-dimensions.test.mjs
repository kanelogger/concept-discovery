import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../server/render.mjs';
import { markdownChunks } from '../../lib/documents.mjs';
test('resized Markdown images retain bounded dimensions without admitting arbitrary HTML', () => {
  const source = '<img src="/assets/photo.png" alt="示例" width="320" height="180" style="position:fixed" onerror="alert(1)" />';
  assert.equal(markdownChunks(source)[0].markdown, source);
  const html = renderMarkdown(source);
  assert.match(html, /width="320" height="180"/);
  assert.doesNotMatch(html, /style=|onerror=/);
  for (const width of ['0', '-1', '100%', '99999', '100;position:fixed']) assert.doesNotMatch(renderMarkdown(`<img src="/assets/photo.png" width="${width}">`), / width=/);
  assert.doesNotMatch(renderMarkdown('<img src="javascript:alert(1)" width="320">'), /<img/);
});

test('kernel image width and editor HTML are equivalent, width changes remain meaningful, code stays literal', async () => {
  const { markdownEquivalent } = await import('../../lib/documents.mjs');
  const { imageMarkdown } = await import('../../lib/image-markdown.mjs');
  const native = '![示例](/assets/photo.png){: style="width: 160px;"}';
  const editor = '<img src="/assets/photo.png" alt="示例" width="160" height="90" />';
  assert.ok(markdownEquivalent(native, editor));
  assert.ok(!markdownEquivalent(native, editor.replace('width="160"', 'width="320"')));
  assert.match(imageMarkdown(native), /width="160"/);
  const literal = '```html\n'+editor+'\n```';
  assert.equal(imageMarkdown(literal), literal);
});
