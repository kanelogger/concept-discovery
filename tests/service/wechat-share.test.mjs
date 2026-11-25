import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWechatShare, wechatSignature } from '../../server/wechat-share.mjs';

const credentials = { appId: 'wx0123456789abcdef', appSecret: 'fixture-secret' };
const url = 'https://concept.example/share/529768011664f7e0a51b39286fd06b19?entry=friend%2Fwechat';

test('WeChat uses the serialized URL and caches one ticket for simultaneous signatures', async () => {
  let time = 1700000000000;
  const requests = [];
  const provider = createWechatShare(credentials, {
    now: () => time,
    async fetcher(endpoint, options) {
      requests.push({ endpoint, options });
      if (endpoint.endsWith('/stable_token')) return Response.json({ access_token: 'fixture-access' });
      return Response.json({ errcode: 0, ticket: 'fixture-ticket', expires_in: 3600 });
    },
  });
  const [first, second] = await Promise.all([provider.sign(url), provider.sign(url)]);
  assert.equal(first.appId, credentials.appId);
  assert.equal(first.timestamp, 1700000000);
  assert.match(first.nonceStr, /^[a-f0-9]{32}$/);
  assert.notEqual(first.nonceStr, second.nonceStr);
  assert.equal(first.signature, wechatSignature('fixture-ticket', first.nonceStr, first.timestamp, url));
  assert.notEqual(first.signature, wechatSignature('fixture-ticket', first.nonceStr, first.timestamp, decodeURI(url).replace('%2F', '/')));
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    grant_type: 'client_credential', appid: credentials.appId, secret: credentials.appSecret, force_refresh: false,
  });
  assert.equal(requests[1].endpoint, 'https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=fixture-access&type=jsapi');
  assert.ok(requests.every(request => request.options.redirect === 'error'));
  assert.equal(requests.length, 2);
  time += 3540000;
  await provider.sign(url);
  assert.equal(requests.length, 4);
});

test('failed WeChat calls cool down and unofficial SDK bytes are refused', async () => {
  let time = 0;
  let requests = 0;
  const provider = createWechatShare(credentials, {
    now: () => time,
    async fetcher(endpoint) {
      requests++;
      if (endpoint.startsWith('https://res.wx.qq.com/')) return new Response('different vendor bytes');
      return Response.json({ errcode: 40164, errmsg: 'test failure ' + credentials.appSecret });
    },
  });
  await assert.rejects(provider.sign(url), { message: 'WeChat sharing is temporarily unavailable' });
  await assert.rejects(provider.sign(url), { message: 'WeChat sharing is temporarily unavailable' });
  assert.equal(requests, 1);
  time += 10000;
  await assert.rejects(provider.sign(url));
  assert.equal(requests, 2);
  await assert.rejects(provider.sdk(), { message: 'WeChat sharing is temporarily unavailable' });
  assert.equal(requests, 3);
});
