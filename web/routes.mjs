export const pageSize = 20;
export function readRoute(value) {
  const url = new URL(value, 'http://localhost');
  const params = url.searchParams;
  const number = Number(params.get('page') || 1);
  const filters = { query: params.get('q') || '', tag: params.get('tag') || '', updatedFrom: params.get('from') || '', updatedTo: params.get('to') || '', page: Number.isSafeInteger(number) && number>0 ? number : 1 };
  if (url.pathname==='/' && params.get('id')) return {kind:'detail',id:params.get('id'),filters,hash:url.hash};
  if (url.pathname==='/' || url.pathname==='/cards') return {kind:'list',filters,hash:url.hash};
  if (url.pathname === '/cards/new') {
    return { kind: 'list', filters, hash: url.hash, redirect: routeHref('list', null, filters, url.hash) };
  }
  if (url.pathname==='/wiki') return {kind:'wiki',filters,hash:''};
  if (url.pathname === '/graph') return { kind: 'graph', filters, hash: '' };
  if (url.pathname === '/scenarios') {
    let categoryId = '';
    try { categoryId = decodeURIComponent(url.hash.slice(1)); } catch {}
    const view = params.get('view') === 'discipline' ? 'disciplines' : 'scenes';
    const entryId = params.get('entry'), cardId = params.get('card');
    const selection = entryId && cardId ? { jumpEntry: entryId, open: { [view]: entryId }, cards: { [entryId]: cardId } } : {};
    return { kind: 'scenarios', filters, hash: url.hash, scenario: { view, categoryId, ...selection } };
  }
  const match=url.pathname.match(/^\/cards\/([^/]+)(\/edit)?$/);
  if (match) {
    try {
      const id = decodeURIComponent(match[1]);
      return { kind: 'detail', id, filters, hash: url.hash,
        ...(match[2] && { redirect: routeHref('detail', id, filters, url.hash) }) };
    } catch {}
  }
  return {kind:'missing',filters,hash:''};
}
export function routeHref(kind, id, filters = {}, hash = '') {
  if (kind === 'graph') return '/graph';
  if(kind==='wiki')return '/wiki'+(id?'?source='+encodeURIComponent(id):'');
  if (kind === 'scenarios') {
    const entryId = id?.jumpEntry;
    if (entryId && id.open?.[id.view] === entryId && id.cards?.[entryId]) {
      return atlasTargetHref({ view: id.view, categoryId: id.categoryId, entryId }, id.cards[entryId]);
    }
    return '/scenarios' + (id?.view === 'disciplines' ? '?view=discipline' : '') +
      (id?.categoryId ? '#' + encodeURIComponent(id.categoryId) : '');
  }
  const path = kind === 'list' ? '/cards' : '/cards/' + encodeURIComponent(id);
  const params=new URLSearchParams();
  for(const [key,value]of[['q',filters.query],['tag',filters.tag],['from',filters.updatedFrom],['to',filters.updatedTo],['page',filters.page>1?filters.page:'']])if(value)params.set(key,String(value));
  return path+(params.size?'?'+params:'')+hash;
}

export function atlasTargetHref({ view, categoryId, entryId }, cardId) {
  const params = new URLSearchParams();
  if (view === 'disciplines') params.set('view', 'discipline');
  params.set('entry', entryId);
  params.set('card', cardId);
  return '/scenarios?' + params + (categoryId ? '#' + encodeURIComponent(categoryId) : '');
}
