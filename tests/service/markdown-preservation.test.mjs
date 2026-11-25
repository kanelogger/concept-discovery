import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../../lib/siyuan.mjs";
import { documentMarkdown, markdownChunks, markdownEquivalent, matchesNativeSnapshot } from "../../lib/documents.mjs";

const attribute = '{: id="20260101000000-abcdefg" title="} and `literal`" }';
const dollars = "$$ $& $` $'";

test("native attributes are removed while code and HTML keep their original bytes", () => {
  const fence = ["~~~txt", dollars, attribute, "~~~   "].join("\r\n");
  const html = "<pre>" + dollars + "\r\n" + attribute + "</pre>";
  const inline = "示例 ``" + dollars + " " + attribute + "``。";
  const source = ["", "正文" + attribute, inline, "", html, "", fence, ""].join("\r\n");
  const expected = ["正文", inline, "", html, "", fence].join("\n");
  for (const read of [normalize, documentMarkdown]) {
    assert.equal(read(source), expected);
    assert.equal(read(source), read(source));
    assert.equal(read(expected), expected);
  }
});

test("escaped and incomplete native attributes remain literal outside code", () => {
  const text = '\\{: id="20260101000000-abcdefg"}\n{: id="20260101000000-abcdefg" title="unfinished';
  assert.equal(normalize(" \n" + text + "\n "), text);
});

test("an unfinished attribute cannot consume later lines or their literal Markdown", () => {
  const start = '{: id="20260101000000-abcdefg"';
  const fenced = ["~~~txt", attribute, dollars, "~~~  "].join("\r\n");
  const examples = [
    `${start} title="unfinished\n${fenced}\n"}`,
    `${start} title="\`first\nsecond\`"}`,
    `${start} title='<em\nclass="sample">'}`,
    `${start} \\\n}`,
  ];
  for (const read of [normalize, documentMarkdown]) {
    for (const example of examples) {
      const expected = example + "\n末段";
      assert.equal(read(example + "\n末段" + attribute), expected);
      assert.equal(read(expected), expected);
    }
    for (const eol of ["\r", "\r\n"]) {
      assert.equal(read(`${start}${eol}}`), `${start}\n}`);
    }
  }
});

test("historical receipts compare the preserved native bytes even if their old signature lost a dollar", () => {
  const oldSignature = "7eabf6965d15ffd77e08c0439a09b2fb6558ead6539f323e96ccc3ea88e06eb0";
  const saved = { title: "代码", attrs: {}, signature: oldSignature,
    nodes: [{ id: "b", type: "c", parent: "d", attrs: {}, raw: "~~~\necho $$\n~~~" }] };
  const exact = "8aefb3cbc1188e4569a76df561bf2eab01f9611d7e1683675c9d44a13d402118";
  assert.equal(matchesNativeSnapshot({signature: exact}, saved), true);
  assert.equal(matchesNativeSnapshot({signature: oldSignature}, saved), false);
});

test("fenced code retains semantic indentation in both document and native block writes", () => {
  const fenced = "  ~~~sh\n  echo $$\n  ~~~";
  assert.equal(documentMarkdown("  \n" + fenced), fenced);
  assert.equal(markdownEquivalent(fenced, documentMarkdown(fenced)), true);
  const body = "段落\n\n" + fenced;
  assert.equal(markdownChunks(body)[1].markdown, fenced);
  assert.equal(markdownEquivalent(body, markdownChunks(body).map(block => block.markdown).join("\n\n")), true);
});

test("a leading UTF-8 BOM does not shift Markdown source positions", () => {
  const literal = "  ~~~txt\n  x$&\n  ~~~  ";
  assert.equal(documentMarkdown("\uFEFF"+literal), literal);
  assert.equal(markdownChunks("\uFEFF"+literal)[0].markdown, literal);
  assert.equal(markdownChunks("\uFEFFhtml$$")[0].markdown, "html$$");
  const image = '\uFEFF<img src="assets/a.png" alt="图" />';
  assert.equal(markdownEquivalent(image, documentMarkdown(image)), true);
});
