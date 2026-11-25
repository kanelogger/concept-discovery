// This list is the public HTTP and CLI contract. Local maintenance has its own dispatcher.
export const commands = Object.freeze([
  'list', 'search', 'get', 'get-document', 'sources-list', 'source-get',
  'wiki-card', 'wiki-proposals', 'wiki-proposal', 'wiki-events',
]);

export const readOnlyReason = '此接口仅供阅读。请在 raw/ 维护原稿，运行 npm run raw 查看本地维护命令。';

export function assertReadCommand(command) {
  if (!commands.includes(command)) {
    throw Object.assign(new Error(readOnlyReason), {code: 'invalid_command'});
  }
}
