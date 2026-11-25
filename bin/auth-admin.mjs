#!/usr/bin/env node
// Host-only entry, typically run in a one-off Compose container over SSH.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { authenticationConfig } from '../server/auth-config.mjs';
import { initializeAuthStore, openAuthStore } from '../server/auth-store.mjs';

const usage = 'auth-admin <init|reset-password|revoke-all|revoke-shares>\n' +
  '请用 CONCEPT_SERVICE_CONFIG 指向目标实例的 service.json，并在可信的终端中运行。';

async function withTerminal(action) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('此命令需要交互式终端。');
  const terminal = process.stderr;
  const silentOutput = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output: silentOutput, terminal: true, historySize: 0 });
  const controller = new AbortController();
  input.on('SIGINT', () => controller.abort());
  input.on('close', () => controller.abort());
  try {
    return await action({
      async question(prompt) {
        terminal.write(prompt);
        try {
          return await input.question('', { signal: controller.signal });
        } finally {
          terminal.write('\n');
        }
      },
    });
  } finally {
    input.close();
  }
}

async function newPassword({ question }) {
  const password = await question('新密码（至少 15 个字符）：');
  const repeated = await question('再输入一次新密码：');
  if (password !== repeated) throw new Error('两次输入的密码不同。');
  return password;
}

async function main([command, ...extra]) {
  if (!command || command === '--help') {
    console.log(usage);
    return;
  }
  if (extra.length || !['init', 'reset-password', 'revoke-all', 'revoke-shares'].includes(command)) {
    throw new Error(usage);
  }
  if (!process.env.CONCEPT_SERVICE_CONFIG) throw new Error('请先设置 CONCEPT_SERVICE_CONFIG。');
  const configPath = resolve(process.env.CONCEPT_SERVICE_CONFIG);
  const config = authenticationConfig(JSON.parse(readFileSync(configPath, 'utf8')), configPath);
  if (config.mode !== 'required') throw new Error('请选择启用认证的目标实例。');

  if (command === 'init') {
    await withTerminal(async terminal => {
      const username = await terminal.question('站主用户名：');
      const password = await newPassword(terminal);
      await initializeAuthStore(config, { username, password });
    });
    console.log('站主已创建，可以登录。');
    return;
  }

  const store = openAuthStore(config);
  try {
    store.assertReady();
    if (command === 'revoke-shares') {
      store.shares.revokeAll();
      console.log('所有分享链接已撤销。');
      return;
    }
    if (command === 'reset-password') {
      await store.resetPassword(await withTerminal(newPassword));
    } else {
      store.revokeAll();
    }
    console.log('原会话已撤销。');
  } finally {
    store.close();
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.name === 'AbortError' ? '已取消。' : error.message);
  process.exitCode = 1;
}
