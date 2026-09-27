import { useEffect, useRef, useState } from "react";
import { navigationUrl, readNavigation } from "./navigation-state";
import type { Navigation } from "./navigation-state";

export function useNavigation() {
  const [navigation, setNavigation] = useState(() => readNavigation(window.location.search));
  const current = useRef(navigation);
  useEffect(() => {
    const restore = () => {
      current.current = readNavigation(window.location.search);
      setNavigation(current.current);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const navigate = (changes: Partial<Navigation>, mode: "push" | "replace" = "push") => {
    const previous = current.current;
    const next = { ...previous, ...changes };
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    const listScroll = previous.concept ? (window.history.state?.listScroll ?? 0) : window.scrollY;
    // Store the originating list position as well as propagating it through related details.
    window.history.replaceState({ ...window.history.state, listScroll }, "");
    window.history[mode === "push" ? "pushState" : "replaceState"]({ listScroll }, "", navigationUrl(next));
    current.current = next;
    setNavigation(next);
  };
  const set = <K extends keyof Navigation>(key: K, value: Navigation[K] | ((previous: Navigation[K]) => Navigation[K])) => {
    const next = typeof value === "function" ? value(current.current[key]) : value;
    const filters = ["locale", "search", "status", "tag", "domain", "pageSize"];
    navigate({ [key]: next, ...(filters.includes(key) ? { page: 1 } : {}) }, ["search", "tag"].includes(key) ? "replace" : "push");
  };
  return { navigation, navigate, set };
}
