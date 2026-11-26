import { createHash } from "node:crypto";

export function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

export const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || ArrayBuffer.isView(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");

export function canonical(value) {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
}

export const emptyFixedField = "\u200b";
const blockID = /^\d{14}-[a-z0-9]{7}$/;
export function validBlockID(value) { return blockID.test(value); }

export function splitQuery(query) {
  return query.trim().split(/\s+/).filter(Boolean);
}

export function listOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['offset','limit','query','tag','updatedFrom','updatedTo','includeTags'].includes(key)))
    fail('invalid_input', 'Invalid list fields');
  const { offset = 0, limit = 50, query = '', tag = '', updatedFrom = '', updatedTo = '', includeTags = false } = input;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100 || typeof query !== 'string' || query.length > 1000 || typeof tag !== 'string' || tag.length > 100 || ![false, true, 'page'].includes(includeTags)) fail('invalid_input', 'Invalid list filters or pagination');
  for (const date of [updatedFrom, updatedTo]) {
    if (typeof date !== 'string') fail('invalid_input','Invalid update date');
    if (date) {
      const parsed=Date.parse(date+'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==date) fail('invalid_input','Invalid update date');
    }
  }
  if (updatedFrom && updatedTo && updatedFrom > updatedTo) fail('invalid_input', 'Update date range is reversed');
  return { offset, limit, query: query.trim(), tag: tag.trim().normalize('NFC'), updatedFrom, updatedTo, includeTags };
}
