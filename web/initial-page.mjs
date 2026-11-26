import { pageSize } from './routes.mjs';

export function listPageInput({query, updatedFrom, updatedTo, tag, page}) {
  return {query:query.trim(), updatedFrom, updatedTo, offset:(page-1)*pageSize,
    limit:pageSize, tag, includeTags:tag ? true : 'page'};
}

// A seed belongs only to the navigation and session that received this no-store HTML.
export function takeInitialPage(browser) {
  const node = browser.document.getElementById('initial-page');
  if (node?.tagName !== 'SCRIPT' || node.type !== 'application/json') return null;
  const text = node.textContent;
  node.remove();
  if (browser.document.visibilityState === 'hidden' || browser.performance?.getEntriesByType('navigation')[0]?.type === 'back_forward') return null;
  try {
    const seed = JSON.parse(text);
    const url = new URL(browser.location.href);
    return seed.route === url.pathname + url.search ? seed : null;
  } catch { return null; }
}
