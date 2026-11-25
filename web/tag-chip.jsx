import Tag from "antd/es/tag";
import { tagTone } from "./lib/utils.mjs";

export function TagChip({ tag }) {
  return <Tag className="tag-chip" data-tag-tone={tagTone(tag)} variant="filled">{tag}</Tag>;
}
