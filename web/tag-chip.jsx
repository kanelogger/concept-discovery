import { tagTone } from "./lib/utils.mjs";

export function TagChip({ tag }) {
  return <span className="tag-chip" data-tag-tone={tagTone(tag)}>{tag}</span>;
}
