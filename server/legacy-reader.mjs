import { Siyuan, quote } from '../lib/siyuan.mjs';
import { execute } from '../lib/commands.mjs';
import { CardBodyReader } from '../lib/card-body-reader.mjs';
import { cardScope } from '../lib/library-scope.mjs';
import { executeWiki, headingQuestion, wikiCommands } from '../lib/wiki.mjs';
import { readScenarioAtlas } from '../lib/scenario-atlas.mjs';
import { readKnowledgeGraph } from './knowledge-graph.mjs';
import { renderCardReferences } from './card-references.mjs';

export function createLegacyReader({api: providedAPI, kernelConfig, executeCommand = execute, wikiRoot}) {
  const api = providedAPI ?? new Siyuan(kernelConfig);
  const cardBodies = new CardBodyReader(api);
  return {
    get token() { return api.c?.token; },
    dispatch(command, input, options = {}) {
      if (wikiCommands.has(command)) return executeWiki(api, command, input, {...options, wikiRoot, executeCommand});
      return executeCommand(api, command, input, command === 'list' ? {...options, cardBodies} : options);
    },
    renderDocument(data, origin) {
      const {html} = renderCardReferences(data.markdown, {
        origin, id:data.id, legacyFixedFields:data.legacyFixedFields, blocks:data.editable ? data.blocks : undefined,
      });
      return {...data, html, question:headingQuestion(data.markdown)};
    },
    readView(name, options) {
      return name === 'graph' ? readKnowledgeGraph(api, {...options, cardBodies}) : readScenarioAtlas(api, options);
    },
    readAsset(file, signal) {
      return fetch(api.origin+'/api/file/getFile', {
        method:'POST', redirect:'error', signal,
        headers:{Authorization:'Token '+api.c.token, 'Content-Type':'application/json'},
        body:JSON.stringify({path:file}),
      });
    },
    async cardInfo(id) {
      const rows = await api.sql(`SELECT b.id, b.content AS title,
        (SELECT value FROM attributes WHERE block_id = b.id AND name = 'custom-cd-legacy-id' LIMIT 1) AS rawId
        FROM blocks b WHERE b.id = ${quote(id)} AND ${cardScope(api.c)}
        AND NOT EXISTS (SELECT 1 FROM attributes parent WHERE parent.block_id = b.id
          AND parent.name = 'custom-cd-parent' AND parent.value <> '')`, { signal: AbortSignal.timeout(5000) });
      return rows[0];
    },
  };
}
