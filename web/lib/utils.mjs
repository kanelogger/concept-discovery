export function tagTone(tag) {
  let hash = 0;
  for (const character of tag.normalize("NFC")) {
    hash = (Math.imul(31, hash) + character.codePointAt(0)) >>> 0;
  }
  return hash % 8;
}
