import type { Locale } from "./model";

export type Navigation = { locale: Locale; section: "discover" | "manage" | "dashboard" | "settings"; density: "cards" | "table"; search: string; status: string; tag: string; domain: string[]; page: number; pageSize: number; concept: string | null };
export function readNavigation(search: string): Navigation {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page") || 1);
  const pageSize = Number(params.get("pageSize") || 20);
  const status = params.get("status") || "browsable";
  const storedSection = params.get("section");
  const hasLegacyLibraryState = ["concept", "q", "tag", "domain", "status", "view", "page", "pageSize"].some((key) => params.has(key));
  const invalidDetailOrigin = params.has("concept") && ["dashboard", "settings"].includes(storedSection || "");
  const section: Navigation["section"] = invalidDetailOrigin ? "manage" : ["discover", "manage", "dashboard", "settings"].includes(storedSection || "")
    ? storedSection as Navigation["section"]
    : hasLegacyLibraryState ? "manage" : "discover";
  return {
    locale: params.get("locale") === "en" ? "en" : "cn",
    section,
    density: params.get("view") === "table" ? "table" : "cards",
    search: params.get("q") || "", status: section === "discover" ? "browsable" : ["all", "draft", "browsable", "recommendable", "archived"].includes(status) ? status : "browsable",
    tag: section === "discover" ? "" : params.get("tag") || "", domain: section === "discover" ? [] : [...new Set((params.get("domain") || "").split(",").filter(Boolean))],
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 20, 50].includes(pageSize) ? pageSize : 20,
    concept: params.get("concept") || null,
  };
}
export function navigationUrl(state: Navigation) {
  const params = new URLSearchParams({ locale: state.locale, section: state.section, view: state.density, status: state.status, page: String(state.page), pageSize: String(state.pageSize) });
  if (state.search) params.set("q", state.search);
  if (state.tag) params.set("tag", state.tag);
  if (state.domain.length) params.set("domain", state.domain.join(","));
  if (state.concept) params.set("concept", state.concept);
  return `/?${params}`;
}
