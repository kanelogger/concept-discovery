import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { authHTTPSFixture, card, fragment, owner } from "../service/auth-https-fixture.mjs";

const test = base.extend({
  service: async ({}, use) => {
    const service = await authHTTPSFixture({ getShareMaterial: () => ({
      title: "转发给朋友的标题", description: "自动生成的转发摘要", cover: new URL("../../web/share-cover.png", import.meta.url),
    }), wechatShare: {
      sign: async url => ({ appId: "wx0123456789abcdef", timestamp: 1, nonceStr: "fixture", signature: url }),
      sdk: async () => Buffer.from(`
        let ready;
        window.wx = {
          ready(fn) { ready = fn; },
          error() {},
          config(data) { window.wechatConfig = data; ready(); },
          updateAppMessageShareData({ success, fail, ...data }) { window.wechatFriend = data; success(); },
          updateTimelineShareData({ success, fail, ...data }) { window.wechatTimeline = data; success(); },
        };
      `),
    } });
    try { await use(service); }
    finally { await service.close(); }
  },
});

test.use({
  ignoreHTTPSErrors: true,
  launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
});

test.beforeAll(() => {
  execFileSync(process.execPath, [fileURLToPath(new URL("../../scripts/build-web.mjs", import.meta.url))], { stdio: "pipe" });
});

async function login(page) {
  await page.getByLabel("用户名", { exact: true }).fill(owner.username);
  const password = page.getByLabel("密码", { exact: true });
  await password.fill(owner.password);
  await password.press("Enter");
}

const readerURL = (service) => service.url + "/?id=" + card.id + "&tag=learning#" + fragment;

test("站主跨页面查看原稿删除提醒，复制后由主分支读回更新清单", async ({ page, context }, info) => {
  const paths = ["raw/合成 学科/第一张卡/article.md", "raw/合成 学科/第一张卡/assets/图示.png"];
  const command = "git --literal-pathspecs rm -- " + paths.map(path => "'" + path + "'").join(" ");
  let items = [
    { rawId:"first", title:"第一张合成卡", paths, command },
    { rawId:"second", title:"归属待核实的合成卡", paths:[], command:null, reason:"ownership_conflict" },
  ];
  let unavailable = false, reads = 0;
  const mutations = [];
  const service = await authHTTPSFixture({ lifecycle:{
    archives:() => [],
    syncStatus:() => {
      reads++;
      if (unavailable) throw new Error("fixture unavailable");
      return {enabled:true, manualDeletions:items, pendingCount:1, nextBatchAt:Date.now()+14400000};
    },
  } });
  try {
    await page.clock.install({time:service.now()});
    page.on("request", request => {
      if (request.url().includes("/api/card-lifecycle/") && request.method() !== "GET")
        mutations.push(request.method());
    });
    await context.grantPermissions(["clipboard-read","clipboard-write"], {origin:service.url});
    await page.goto(readerURL(service));
    const trigger = page.getByRole("button", {name:"原稿待删 · 2"});
    await expect(trigger).toHaveCount(0);
    expect(reads).toBe(0);
    await login(page);
    await trigger.click();
    const dialog = page.getByRole("dialog", {name:"待手动删除的原稿"});
    await expect(dialog.getByRole("button", {name:"关闭"})).toBeFocused();
    const first = dialog.getByRole("region", {name:"第一张合成卡"});
    await expect(first.getByRole("listitem")).toHaveText(paths);
    await expect(first.locator("pre")).toHaveText(command);
    await first.getByRole("button", {name:"复制命令"}).click();
    await expect(first.getByRole("status")).toHaveText("已复制");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
    const pending = dialog.getByRole("region", {name:"归属待核实的合成卡"});
    await expect(pending).toContainText("删除范围待核对");
    await expect(pending.getByRole("button")).toHaveCount(0);
    await page.screenshot({path:info.outputPath("manual-deletion-desktop.png")});
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.getByRole("button", {name:"知识卡", exact:true}).click();
    await expect(page.getByRole("heading", {name:"知识卡", exact:true})).toBeVisible();
    await page.setViewportSize({width:375,height:812});
    await expect(trigger).toBeInViewport();
    await page.getByRole("link", {name:"归档列表", exact:true}).click();
    await trigger.click();
    await expect(dialog).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
      value:{writeText:async () => { throw new Error("fixture denied"); }}, configurable:true,
    }));
    await first.getByRole("button", {name:"复制命令"}).click();
    await expect(first.getByRole("status")).toContainText("请手动复制");
    expect(await page.evaluate(() => getSelection().toString())).toBe(command);
    await page.screenshot({path:info.outputPath("manual-deletion-mobile.png")});
    unavailable = true;
    await page.clock.fastForward(31000);
    await expect(first).toContainText("暂时无法核实删除范围");
    await expect(dialog.locator("pre")).toHaveCount(0);
    unavailable = false;
    items = [items[1]];
    await dialog.getByRole("button", {name:"重新读取状态"}).click();
    await expect(first).toHaveCount(0);
    await expect(pending).toContainText("删除范围待核对");
    items = [];
    await page.clock.fastForward(31000);
    await expect(dialog.getByRole("status")).toHaveText("当前没有待手动删除的原稿。");
    await dialog.getByRole("button", {name:"关闭"}).click();
    await expect(page.getByRole("button", {name:/原稿待删/})).toHaveCount(0);
    await expect(page.getByRole("link", {name:"Concept Discovery"})).toBeFocused();
    const privateReads = reads;
    await page.goto(service.url + "/share");
    await expect(page.getByRole("button", {name:/原稿待删/})).toHaveCount(0);
    expect(reads).toBe(privateReads);
    expect(mutations).toEqual([]);
  } finally { await service.close(); }
});

test("迟到的原稿清单不能恢复已失效会话的删除命令", async ({ page, context }) => {
  const requested = Promise.withResolvers(), release = Promise.withResolvers();
  const item = {rawId:"expired", title:"旧会话合成卡", paths:["raw/合成卡/article.md"], command:"git rm -- 'raw/合成卡/article.md'"};
  let reads = 0;
  const service = await authHTTPSFixture({lifecycle:{
    syncStatus:async () => {
      if (++reads === 2) {
        requested.resolve();
        await release.promise;
      }
      return {enabled:true, manualDeletions:reads <= 2 ? [item] : [], nextBatchAt:Date.now()+14400000};
    },
  }});
  try {
    await page.clock.install({time:service.now()});
    await page.goto(readerURL(service));
    await login(page);
    const trigger = page.getByRole("button", {name:/原稿待删/});
    await trigger.click();
    const dialog = page.getByRole("dialog", {name:"待手动删除的原稿"});
    await expect(dialog).toContainText(item.command);
    await page.clock.fastForward(31000);
    await requested.promise;
    const cookie = (await context.cookies(service.url)).find(item => item.name === "__Host-cd-session");
    await service.revoke(cookie.value);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("heading", {name:"登录知识库"})).toBeVisible();
    release.resolve();
    await login(page);
    await expect(page.getByRole("heading", {name:card.title})).toBeVisible();
    await expect.poll(() => reads).toBeGreaterThan(2);
    await expect(trigger).toHaveCount(0);
    await expect(page.getByText(item.command)).toHaveCount(0);
  } finally {
    release.resolve();
    await service.close();
  }
});

test("站主在原任务待核对时先预览并复核密码再撤销", async ({page}) => {
  const originalId = randomUUID(), settlementId = randomUUID();
  let cancelled = false, confirmed = false;
  const service = await authHTTPSFixture({lifecycle:{
    archives:() => [],
    preview:(_owner,{action,id}) => {
      expect(action).toBe("compensate");
      expect(id).toBe(originalId);
      return {id:settlementId,action,files:["raw/合成原稿/article.md"],blockers:[]};
    },
    confirmation:() => ({action:"compensate"}),
    confirm:(_owner,id) => {
      expect(id).toBe(settlementId);
      cancelled = confirmed = true;
      return {id,state:"complete",originalId};
    },
    status:(_owner,id) => id===originalId
      ? {id,state:cancelled?"cancelled":"needs-review"}
      : {id,state:"complete",originalId},
  }});
  try {
    await page.goto(service.url+"/archives?operation="+originalId);
    await login(page);
    await expect(page.getByRole("button",{name:"继续原操作",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"撤销原操作",exact:true}).click();
    const dialog=page.getByRole("dialog");
    await expect(dialog.getByRole("heading",{name:"撤销原操作"})).toBeVisible();
    const password=dialog.getByLabel("站主密码");
    await password.fill("wrong");
    await dialog.getByRole("button",{name:"撤销原操作",exact:true}).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(confirmed).toBe(false);
    await password.fill(owner.password);
    await dialog.getByRole("button",{name:"撤销原操作",exact:true}).click();
    await expect(page.getByText("操作已撤回")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(originalId+"$"));
  } finally { await service.close(); }
});

test("站主通过归档列表恢复或复核密码后彻底删除", async ({ page }, info) => {
  const drafts = new Map(), operations = new Map();
  let archived = false;
  const service = await authHTTPSFixture({lifecycle:{
    archives:() => archived ? [{rawId:"synthetic-card",title:card.title,discipline:"方法",state:"archived"}] : [],
    syncStatus:() => ({enabled:true,pendingCount:2,lastSuccessAt:null,nextBatchAt:1795564800000,
      issues:[{rawId:"synthetic-card",code:"git_content_conflict"}]}),
    preview:(_owner, {action}) => {
      const id = randomUUID();
      drafts.set(id,action);
      return { id, action, title:card.title, files:["方法/synthetic-card/article.md"], moves:[], blockers:[] };
    },
    confirmation:(_owner,id) => ({action:drafts.get(id)}),
    confirm:(_owner,id) => {
      archived = drafts.get(id) === "archive";
      const result = {id,state:"complete"};
      operations.set(id,result);
      return result;
    },
    status:(_owner,id) => operations.get(id),
  }});
  try {
    await page.goto(readerURL(service));
    await login(page);
    const archive = page.getByRole("button",{name:"归档",exact:true});
    await archive.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button",{name:"取消"})).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(archive).toBeFocused();
    await archive.click();
    await dialog.getByRole("button",{name:"归档",exact:true}).click();
    await expect(page.getByRole("heading",{name:"归档列表"})).toBeVisible();
    await expect(page.getByRole("heading",{name:card.title})).toBeVisible();
    const sync = page.getByRole("region",{name:"原稿同步"});
    await expect(sync.getByText("synthetic-card · Git 和数据库改动冲突")).toBeVisible();
    await expect(sync.getByText("2 项",{exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath("archives-desktop.png")});
    await page.getByRole("button",{name:"恢复",exact:true}).click();
    await dialog.getByRole("button",{name:"恢复",exact:true}).click();
    await expect(page.getByText("暂无归档卡。可以在知识卡详情页归档卡片。")).toBeVisible();
    await page.goto(readerURL(service));
    await archive.click();
    await dialog.getByRole("button",{name:"归档",exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("button",{name:"彻底删除",exact:true}).click();
    const password = dialog.getByLabel("站主密码");
    await expect(password).toBeVisible();
    await page.screenshot({path:info.outputPath("archives-confirm-mobile.png")});
    await password.fill("wrong");
    await dialog.getByRole("button",{name:"彻底删除",exact:true}).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await password.fill(owner.password);
    await dialog.getByRole("button",{name:"彻底删除",exact:true}).click();
    await expect(page.getByText("操作已完成")).toBeVisible();
    await expect(page.getByRole("heading",{name:card.title})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally { await service.close(); }
});

test("站主从归档列表选择一张待删卡并复核密码撤销",async ({page})=>{
  const originalId=randomUUID(), operationId=randomUUID();
  let completed=false;
  const service=await authHTTPSFixture({lifecycle:{
    archives:()=>completed?[]:[{rawId:"synthetic-card",title:"待撤销合成卡",state:"awaiting-export",purgeOperation:originalId}],
    syncStatus:()=>({enabled:true,pendingCount:completed?0:1,lastSuccessAt:null,nextBatchAt:Date.now()+14400000,issues:[]}),
    preview:(_owner,input)=>{
      expect(input).toEqual({action:"compensate",id:originalId});
      return {id:operationId,files:["方法/synthetic-card/article.md"],blockers:[]};
    },
    confirmation:()=>({action:"compensate"}),
    confirm:()=>{
      completed=true;
      return {id:operationId,originalId,state:"complete",progress:{stage:"deletion-compensated"}};
    },
    status:(_owner,id)=>{
      expect(id).toBe(operationId);
      return {id,originalId,state:"complete",progress:{stage:"deletion-compensated"}};
    },
  }});
  try {
    await page.goto(service.url+"/archives");
    await login(page);
    await page.getByRole("button",{name:"撤销待删"}).click();
    const dialog=page.getByRole("dialog",{name:"撤销原操作"});
    await dialog.getByLabel("站主密码").fill("wrong");
    await dialog.getByRole("button",{name:"撤销原操作",exact:true}).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(completed).toBe(false);
    await dialog.getByLabel("站主密码").fill(owner.password);
    await dialog.getByRole("button",{name:"撤销原操作",exact:true}).click();
    await expect(page.getByText("操作已完成")).toBeVisible();
    await expect(page.getByRole("heading",{name:"待撤销合成卡"})).toHaveCount(0);
    await expect(page).toHaveURL(service.url+"/archives?operation="+operationId);
  } finally {await service.close();}
});

test("数据库优先表单新增卡片并以原生版本编辑",async ({page})=>{
  const draft={id:card.id,title:"合成编辑前",markdown:"## 核心理解\n\n合成旧正文。",revision:"a".repeat(64),signature:"b".repeat(64)};
  const requests=[],previews=new Map();
  const service=await authHTTPSFixture({lifecycle:{
    archives:()=>[],syncStatus:()=>({enabled:true,pendingCount:0,lastSuccessAt:null,nextBatchAt:Date.now()+14400000,issues:[]}),
    draft:()=>draft,
    databasePreview:(_owner,input)=>{
      requests.push(input);
      const id=randomUUID();
      previews.set(id,input.action);
      return {id};
    },
    confirmation:(_owner,id)=>({action:previews.get(id)}),
    confirm:(_owner,id)=>({id,state:"complete",progress:{documentId:card.id}}),
  }});
  try {
    await page.goto(service.url+"/archives");
    await login(page);
    await page.getByRole("button",{name:"新增卡片"}).click();
    let dialog=page.getByRole("dialog");
    await dialog.getByLabel("标题").fill("合成新增");
    await dialog.getByLabel("正文（Markdown）").fill("## 核心理解\n\n合成新增正文。");
    await dialog.getByRole("button",{name:"保存"}).click();
    await expect(page).toHaveURL(service.url+"/cards/"+card.id);
    await page.getByRole("button",{name:"编辑",exact:true}).click();
    dialog=page.getByRole("dialog");
    await expect(dialog.getByLabel("标题")).toHaveValue(draft.title);
    await dialog.getByLabel("标题").fill("合成编辑完成");
    await dialog.getByRole("button",{name:"保存"}).click();
    await expect(dialog).toHaveCount(0);
    expect(requests.map(item=>item.action)).toEqual(["create","edit"]);
    expect(requests[1]).toMatchObject({id:card.id,revision:draft.revision,signature:draft.signature,title:"合成编辑完成"});
  } finally {await service.close();}
});

test("the owner copies and revokes a card link that opens in a separate mobile context", async ({ page, service, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: service.url });
  service.shareFixture.markdown = "\n\n![配图](assets/share.png)";
  await page.goto(readerURL(service));
  await login(page);
  await page.getByRole("button", { name: "分享", exact: true }).click();
  await expect(page.getByText("转发给朋友的标题", { exact: true })).toBeVisible();
  await expect(page.getByText("自动生成的转发摘要", { exact: true })).toBeVisible();
  await expect(page.locator("#card-share-panel").getByRole("textbox")).toHaveCount(0);
  await page.getByRole("button", { name: "创建分享链接" }).click();
  const field = page.getByLabel("分享链接", { exact: true });
  await expect(field).toHaveValue(/\/share\/[a-f0-9]{32}#[\w-]{43}$/);
  const url = await field.inputValue();
  await page.getByRole("button", { name: "复制链接" }).click();
  await expect(page.getByText("已复制链接", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", {
    value: () => Promise.reject(new Error("Clipboard blocked by browser")),
  }));
  await page.getByRole("button", { name: "复制链接" }).click();
  await expect(page.getByText("自动复制失败，请手动复制已选中的链接。")).toBeVisible();
  expect(await field.evaluate(input => input.value.slice(input.selectionStart, input.selectionEnd))).toBe(url);

  const visitor = await browser.newContext({
    ignoreHTTPSErrors: true, viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 MicroMessenger/8.0",
  });
  try {
    const phone = await visitor.newPage();
    let bodyReads = 0;
    let failNextWithGateway = false;
    await phone.route("**/api/card-share/read", route => {
      bodyReads++;
      if (bodyReads === 1) return route.abort("connectionreset");
      if (failNextWithGateway) {
        failNextWithGateway = false;
        return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad Gateway</h1>" });
      }
      return route.continue();
    });
    const entry = new URL(url);
    entry.searchParams.set("from", "friend");
    await phone.route("https://share-source.example/", route => route.fulfill({
      contentType: "text/html; charset=utf-8", body: `<meta name="viewport" content="width=device-width, initial-scale=1"><a href="${entry.href}">打开知识卡</a>`,
    }));
    await phone.goto("https://share-source.example/");
    await phone.getByRole("link", { name: "打开知识卡" }).click({ timeout: 10000 });
    await expect(phone.getByRole("heading", { name: card.title, exact: true })).toBeVisible();
    await expect(phone.getByText(card.body)).toBeVisible();
    expect(bodyReads).toBe(2);
    await expect.poll(() => phone.evaluate(() => window.wechatFriend?.title)).toBe("转发给朋友的标题");
    await expect(phone.getByText("微信转发样式已就绪，可用右上角菜单转发。")).toBeVisible();
    const configured = await phone.evaluate(() => ({ friend: window.wechatFriend, timeline: window.wechatTimeline, config: window.wechatConfig }));
    expect(configured.friend.desc).toBe("自动生成的转发摘要");
    expect(configured.friend.link).toBe(url);
    expect(configured.timeline.title).toBe(configured.friend.title);
    expect(configured.timeline.imgUrl).toBe(configured.friend.imgUrl);
    expect(configured.config.signature).toBe(entry.href.split("#")[0]);
    expect((await visitor.request.get(configured.friend.imgUrl)).status()).toBe(200);
    await expect(phone.getByRole("img", { name: "配图" })).toHaveJSProperty("complete", true);
    expect(await phone.getByRole("img", { name: "配图" }).evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect(await visitor.cookies()).toEqual([]);

    await phone.route("**/api/card-share/wechat-config", route => route.fulfill({
      status: 503, json: { ok: false, error: { message: "fixture: provider unavailable" } },
    }));
    failNextWithGateway = true;
    await phone.reload();
    await expect(phone.getByText("微信暂未加载转发样式，仍可分享普通链接。")).toBeVisible();
    await expect(phone.getByText(card.body)).toBeVisible();
    expect(bodyReads).toBe(4);

    await phone.goto(service.url + "/cards");
    await expect(phone.getByRole("heading", { name: "登录知识库", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "撤销链接" }).click();
    await expect(page.getByText("分享链接已撤销")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByRole("heading", { name: "此分享链接无效或已撤销" })).toBeVisible();
    await expect(phone.getByText(card.body)).toHaveCount(0);
    expect(bodyReads).toBe(5);
  } finally {
    await visitor.close();
  }
});

test("an old card bookmark resumes after password login and logout locks other tabs", async ({ page, service, context }) => {
  await page.goto(readerURL(service));
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByRole("heading", { name: "登录知识库", exact: true })).toBeVisible();
  await expect(page.getByText(card.body)).toHaveCount(0);
  await login(page);
  await expect(page.getByRole("heading", { name: card.title, exact: true })).toBeVisible();
  await expect(page.locator("#reader")).toContainText(card.body);
  const restored = new URL(page.url());
  expect(restored.searchParams.get("tag")).toBe("learning");
  expect(restored.hash).toBe("#" + fragment);

  const other = await context.newPage();
  await other.goto(readerURL(service));
  await expect(other.locator("#reader")).toContainText(card.body);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录知识库", exact: true })).toBeVisible();
  await expect(other.getByRole("heading", { name: "登录知识库", exact: true })).toBeVisible();
  await expect(other.locator("#reader")).toHaveCount(0);
  await expect(other).not.toHaveTitle(new RegExp(card.title));
  expect((await context.request.get(service.url + "/assets/image.png")).status()).toBe(401);
});

test("an in-flight card response cannot restore the private workspace after logout", async ({ page, service, context }) => {
  await page.goto(readerURL(service));
  await login(page);
  await expect(page.locator("#reader")).toContainText(card.body);
  const other = await context.newPage();
  await other.goto(service.url + "/cards");
  const cardLink = other.getByRole("link", { name: card.title, exact: true });
  await expect(cardLink).toBeVisible();
  const requested = Promise.withResolvers();
  const release = Promise.withResolvers();
  service.beforeRead.current = (name) => {
    if (name !== "get-document") return;
    requested.resolve();
    return release.promise;
  };
  try {
    await cardLink.click();
    await requested.promise;
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(other.getByRole("heading", { name: "登录知识库", exact: true })).toBeVisible();
    release.resolve();
    await expect(other.locator("#reader")).toHaveCount(0);
    await expect(other).not.toHaveTitle(new RegExp(card.title));
  } finally {
    service.beforeRead.current = null;
    release.resolve();
  }
});

test("a live graph retains positions on refresh and a replacement workspace starts the same graph afresh", async ({ page, service }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const other = { id: "20261123080002-authabc", title: "另一张卡" };
  let graphReads = 0;
  await page.route("**/api/graph", route => {
    const first = ++graphReads === 1;
    return route.fulfill({ json: { ok: true, data: {
      complete: !first, nodes: first ? [card, other] : [other, card], edges: [],
    } } });
  });
  await page.goto(service.url + "/graph");
  await login(page);
  const selected = page.locator(`.graph-node[data-node-id="${card.id}"]`);
  const otherNode = page.locator(`.graph-node[data-node-id="${other.id}"]`);
  await expect(selected).toBeVisible();
  const previous = await selected.getAttribute("transform");
  const otherPosition = await otherNode.getAttribute("transform");
  expect(previous).not.toBe(otherPosition);

  await selected.press("Enter");
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".graph-node").first()).toHaveAttribute("data-node-id", other.id);
  await expect(selected).toHaveAttribute("transform", previous);

  // A failed session check disposes the workspace before React unmounts its canvas.
  // Retrying authenticates the same session, so the selected node remains in history.
  await page.route("**/api/session", route => route.fulfill({ status: 503, json: { ok: false } }), { times: 1 });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "暂时无法验证会话" })).toBeVisible();
  await expect(selected).toHaveCount(0);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  // With identical nodes and no edges, the first and second layout slots are deterministic.
  await expect(selected).toHaveAttribute("transform", otherPosition);
});

test("an idle document locks when its session expires", async ({ page, service }) => {
  await page.clock.install({ time: service.now() });
  await page.goto(readerURL(service));
  await login(page);
  await expect(page.locator("#reader")).toContainText(card.body);
  const sessionAge = 24 * 60 * 60_000 + 1_000;
  service.advance(sessionAge);
  await page.clock.fastForward(sessionAge);
  await expect(page.getByText("会话已过期，请重新登录", { exact: true })).toBeVisible();
  await expect(page.locator("#reader")).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe("#" + fragment);
});

test("a delayed logout response cannot clear a newer login in another tab", async ({ page, service, context }) => {
  await page.goto(readerURL(service));
  await login(page);
  await expect(page.locator("#reader")).toContainText(card.body);
  const revoked = Promise.withResolvers();
  const release = Promise.withResolvers();
  const delivered = Promise.withResolvers();
  await page.route("**/api/session/logout", async route => {
    try {
      const response = await route.fetch();
      revoked.resolve(response);
      await release.promise;
      await route.fulfill({ response });
      delivered.resolve();
    } catch (error) {
      revoked.reject(error);
      delivered.reject(error);
    }
  });
  try {
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    expect((await revoked.promise).status()).toBe(204);
    service.advance(60_000);
    const other = await context.newPage();
    await other.goto(readerURL(service));
    await login(other, service);
    await expect(other.locator("#reader")).toContainText(card.body);
    release.resolve();
    await delivered.promise;
    await other.reload();
    await expect(other.locator("#reader")).toContainText(card.body);
  } finally {
    release.resolve();
  }
});

test("returning to a previously opened private page after revocation does not disclose it", async ({ page, service, context }, testInfo) => {
  await page.addInitScript(() => {
    window.addEventListener("pageshow", event => {
      if (event.persisted && document.querySelector("[data-private-workspace]")) {
        sessionStorage.setItem("fixture-private-cached-page-restored", "true");
      }
    }, { capture: true });
  });
  await page.goto(readerURL(service));
  await login(page, service);
  await expect(page.locator("#reader")).toContainText(card.body);
  const cookie = (await context.cookies(service.url)).find(item => item.name === "__Host-cd-session");
  // A public same-origin page leaves the reading document in browser history.
  await page.goto(service.url + "/api/status");
  await service.revoke(cookie.value);
  await page.goBack({ waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "登录知识库", exact: true })).toBeVisible();
  await expect(page.locator("#reader")).toHaveCount(0);
  const persisted = await page.evaluate(() => sessionStorage.getItem("fixture-private-cached-page-restored") === "true");
  testInfo.annotations.push({
    type: "back-forward-cache",
    description: persisted ? "Verified pageshow.persisted on restored private document" : "Browser loaded a fresh document. Ordinary back verified only.",
  });
});

test("站主升级旧分享预览后仍可复制同一凭证并打开原链接", async ({ page, service, context }) => {
  const token = service.legacyShare();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: service.url });
  await page.goto(readerURL(service));
  await login(page);
  await page.getByRole("button", { name: "分享", exact: true }).click();
  const field = page.getByLabel("分享链接", { exact: true });
  const oldURL = service.url + "/share#" + token;
  await expect(field).toHaveValue(oldURL);

  const requested = Promise.withResolvers(), release = Promise.withResolvers();
  await page.route("**/api/card-shares/*", async route => {
    if (route.request().method() === "PATCH") {
      requested.resolve();
      await release.promise;
    }
    await route.continue();
  });
  const upgrade = page.getByRole("button", { name: "启用新版转发预览" });
  const copy = page.getByRole("button", { name: "复制链接" });
  try {
    await upgrade.click();
    await requested.promise;
    await expect(upgrade).toBeDisabled();
    await expect(copy).toBeDisabled();
    await expect(page.getByRole("button", { name: "撤销链接" })).toBeDisabled();
    release.resolve();
    await expect(page.getByText("分享预览已更新")).toBeVisible();
    await expect(copy).toBeFocused();
    const url = new URL(await field.inputValue());
    expect(url.pathname).toMatch(/^\/share\/[a-f0-9]{32}$/);
    expect(url.hash).toBe("#" + token);
    await copy.press("Enter");
    await expect(page.getByText("已复制链接")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url.href);
    await page.goto(oldURL);
    await expect(page.getByRole("heading", { name: card.title })).toBeVisible();
    await expect(page.getByText(card.body, { exact: true })).toBeVisible();
  } finally { release.resolve(); }
});
