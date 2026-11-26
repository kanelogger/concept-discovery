import { assertReadCommand } from './read-commands.mjs';
import { fail, validBlockID } from './read-contract.mjs';

const deprecated = new Set(['locale','locales','language','chineseArticleId']);
const wiki = new Set(['sources-list','source-get','wiki-card','wiki-proposals','wiki-proposal','wiki-events']);
const suffix = '(?:[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})';
const sourceId = new RegExp('^src_' + suffix + '$');
const proposalId = new RegExp('^prop_' + suffix + '$');

function hasLanguageOption(value) {
  return value !== null && typeof value === 'object' &&
    (Object.keys(value).some(key => deprecated.has(key)) || Object.values(value).some(hasLanguageOption));
}

export function createContentCommands(store, {origin = ''} = {}) {
  store.assertCommandReady();
  const publicOrigin = origin.replace(/\/$/, '');
  function document(id) {
    try {
      if (typeof id === 'string') return store.document(id, publicOrigin);
    } catch (error) {
      if (error.code !== 'not_found') throw error;
    }
    if (validBlockID(id)) fail('outside_scope', 'Block is not in configured notebook');
    fail('identity_conflict', 'Concept missing or identity duplicated');
  }
  return (command, input = {}) => {
    assertReadCommand(command);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail('invalid_input', wiki.has(command) ? '需要JSON对象。' : 'A JSON object is required');
    if (!wiki.has(command) && (input.concept !== undefined || hasLanguageOption(input)))
      fail('invalid_input', 'Language options and fixed-field concept inputs are no longer supported');
    switch (command) {
      case 'list': return store.list(input);
      case 'search': return store.search(input, publicOrigin);
      case 'get': return store.card(input.id, publicOrigin);
      case 'get-document': return document(input.id);
      case 'wiki-card': {
        const {id,revision,question} = document(input.id);
        return {id,revision,question};
      }
      case 'sources-list': {
        const items = store.records('sources').map(({markdown, ...source}) => ({...source, characters:[...markdown].length}));
        return {items};
      }
      case 'source-get':
        if (typeof input.id !== 'string' || !sourceId.test(input.id)) fail('invalid_input', '资料或提案标识无效。');
        return store.record('sources', input.id);
      case 'wiki-proposals': return {items:store.records('proposals').filter(row => row.kind === 'proposal')};
      case 'wiki-proposal': {
        if (typeof input.id !== 'string' || !proposalId.test(input.id)) fail('invalid_input', '资料或提案标识无效。');
        const record = store.record('proposals', input.id);
        if (record.kind !== 'proposal') fail('outside_scope', '此归档记录不是整理提案。');
        return record;
      }
      case 'wiki-events': return {items:store.records('events')};
    }
  };
}
