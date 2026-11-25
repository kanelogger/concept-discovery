export function tagTone(tag) {
  let hash = 0;
  for (const character of tag.normalize("NFC")) {
    hash = (Math.imul(31, hash) + character.codePointAt(0)) >>> 0;
  }
  return hash % 8;
}

export function scrollWorkspaceTo(pane, target) {
  if (!pane || !target) return;
  const margin = parseFloat(getComputedStyle(target).scrollMarginBlockStart) || 0;
  pane.scrollTo(0, pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - margin);
}
