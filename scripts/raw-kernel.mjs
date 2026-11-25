// Private local administrator process, started by the host CLI in the selected Compose network.
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { config, Siyuan } from '../lib/siyuan.mjs';
import { rawInventory } from '../lib/raw-inventory.mjs';
import { requireInstanceFlock } from '../lib/instance-flock.mjs';
const settings = config('/state/kernel.json');
const receiptLease = process.argv[2] === '--managed' ? () => requireInstanceFlock(join(settings.dataDir,'managed-rpc.lock')) : undefined;
receiptLease?.();
const api = new Siyuan(settings,{receiptLease});
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let request;
  try {
    request = JSON.parse(line);
    let data;
    if (request.method === 'inventory') {
      data = await rawInventory(api, request.input);
    } else {
      const { rawWrite } = await import('../lib/raw-write.mjs');
      data = await rawWrite(api, request.method, request.input);
    }
    process.stdout.write(JSON.stringify({ ok: true, data }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: error.code ?? 'raw_error', message: error.message } }) + '\n');
  }
}
