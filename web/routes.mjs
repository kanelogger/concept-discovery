export const pageSize = 20;
export function readRoute(value) {
  const url = new URL(value, 'http://localhost');
  const params = url.searchParams;
  const number = Number(params.get('page') || 1);
  const filters = { query: params.get('q') || '', tag: params.get('tag') || '', updatedFrom: params.get('from') || '', updatedTo: params.get('to') || '', page: Number.isSafeInteger(number) && number>0 ? number : 1 };
  if (url.pathname==='/' && params.get('id')) return {kind:'detail',id:params.get('id'),filters,hash:url.hash};
  if (url.pathname==='/' || url.pathname==='/cards') return {kind:'list',filters,hash:''};
  if (url.pathname==='/cards/new') return {kind:'new',filters,hash:''};
  if (url.pathname==='/wiki') return {kind:'wiki',filters,hash:''};
  const match=url.pathname.match(/^\/cards\/([^/]+)(\/edit)?$/);
  if(match){try{return{kind:match[2]?'edit':'detail',id:decodeURIComponent(match[1]),filters,hash:url.hash};}catch{}}
  return {kind:'missing',filters,hash:''};
}
export function routeHref(kind, id, filters = {}, hash = '') {
  if(kind==='wiki')return '/wiki'+(id?'?source='+encodeURIComponent(id):'');
  const path=kind==='list'?'/cards':kind==='new'?'/cards/new':'/cards/'+encodeURIComponent(id)+(kind==='edit'?'/edit':'');
  const params=new URLSearchParams();
  for(const [key,value]of[['q',filters.query],['tag',filters.tag],['from',filters.updatedFrom],['to',filters.updatedTo],['page',filters.page>1?filters.page:'']])if(value)params.set(key,String(value));
  return path+(params.size?'?'+params:'')+hash;
}
