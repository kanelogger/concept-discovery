import test from "node:test";
import assert from "node:assert/strict";
import { taskDescription, descriptionBody, composeDescription } from "../../lib/task-description.mjs";
import { polishDescription } from "../../lib/polish-description.mjs";

test("reuse the existing section and preserve all unrelated Markdown", () => {
  const source = "正文。\n\n## 适用情境\n\n- 场景一\n- 场景二\n\n## 边界\n\n边界。";
  assert.equal(taskDescription(source), "- 场景一\n- 场景二");
  assert.equal(composeDescription(descriptionBody(source), taskDescription(source), source), source);
  const edited = composeDescription(descriptionBody(source).replace("正文。", "更新正文。"), "新描述。", source);
  assert.equal(edited, "更新正文。\n\n## 适用情境\n\n新描述。\n\n## 边界\n\n边界。");
  assert.equal(taskDescription(composeDescription(descriptionBody(source), "", source)), "");
});
test("empty old cards stay unchanged, optional new sections are created on save", () => {
  assert.equal(composeDescription("正文", ""), "正文");
  assert.equal(composeDescription("正文", "任务描述"), "正文\n\n## 适用任务\n\n任务描述");
  assert.equal(taskDescription("```md\n## 适用情境\n假的标题\n```"), "");
  const duplicate = "## 适用任务\n\n一\n\n## 适用情境\n\n二";
  assert.ok(composeDescription(descriptionBody(duplicate), "修改一", duplicate).endsWith("## 适用情境\n\n二"));
});
test("polishing is read-only, bounded and validates suggestions", async () => {
  let request;
  const result = await polishDescription({title:"测试",description:"原描述"}, {complete: async input => { request = input; return {description:"新描述。"}; }});
  assert.deepEqual(request.data, {title:"测试",description:"原描述"});
  assert.deepEqual(result, {description:"新描述。"});
  await assert.rejects(polishDescription({title:"测试",description:"x".repeat(601)}, {}), {code:"invalid_description"});
  await assert.rejects(polishDescription({title:"测试",description:""}, {complete: async () => ({description:"", extra:true})}), {code:"ask_invalid_output"});
});

test("pasted description is preserved when the separate optional input is empty", () => {
  const pasted = "正文\n\n## 适用任务\n\n用户正文中的描述";
  assert.equal(composeDescription(pasted, ""), pasted);
  const original = "正文\n\n## 适用情境\n\n描述\n\n## 边界\n\n原边界";
  assert.equal(composeDescription(descriptionBody(original).replace("原边界", "新边界"), "新描述", original), "正文\n\n## 适用情境\n\n新描述\n\n## 边界\n\n新边界");
});

test("section position recovery ignores heading examples inside fenced code", () => {
  const source="```md\n## 边界\n示例\n```\n\n正文\n\n## 适用情境\n\n旧描述\n\n## 边界\n\n原边界";
  const result=composeDescription(descriptionBody(source).replace('原边界','新边界'),'新描述',source);
  assert.equal(taskDescription(result),'新描述');
  assert.ok(result.startsWith('```md\n## 边界\n示例\n```'));
});

test("a complete suffix duplicated in a code sample never becomes the insertion point", () => {
  const source="```md\n## 边界\n\n原边界\n```\n\n正文\n\n## 适用情境\n\n旧描述\n\n## 边界\n\n原边界";
  const result=composeDescription(descriptionBody(source),'新描述',source);
  assert.equal(taskDescription(result),'新描述');
  assert.equal(result,source.replace('旧描述','新描述'));
});
