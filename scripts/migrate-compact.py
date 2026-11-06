#!/usr/bin/env python3
"""Offline conversion of a verified, stopped import into a fresh private root."""
import argparse
from collections import defaultdict
import hashlib
import html
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
import re
import shutil
import sys

ID = re.compile(r"\d{14}-[a-z0-9]{7}")
LINK = re.compile(r"kane://blocks/([0-9]{14}-[a-z0-9]{7})(?![a-z0-9])")
ASSET = re.compile(r"assets/[a-zA-Z0-9_.-]+")
WEB = re.compile(r'https?://[^\s"<>]+')
LABELS = {"related_to": "相关", "often_used_with": "常一起使用", "contrasts_with": "对照"}


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def read(path):
    return json.loads(path.read_bytes())


def walk(node):
    yield node
    for child in node.get("Children", []):
        yield from walk(child)


def text_values(node):
    return (value for item in walk(node) for key, value in item.items()
            if (key == "Data" or key.startswith("TextMark")) and isinstance(value, str))


def plain(node):
    return "".join(item.get("Data", "") for item in walk(node))


def urls(nodes):
    targets = set()
    for section in nodes:
        for node in walk(section):
            exact = [node.get("TextMarkAHref", "")]
            if node["Type"] == "NodeLinkDest":
                exact.append(node.get("Data", ""))
            for value in map(html.unescape, exact):
                if value.lower().startswith(("https://", "http://")):
                    require(not re.search(r"\s", value) and urlsplit(value).hostname,
                            "Invalid supplementary source URL")
                    targets.add(value)
            if node["Type"] not in ("NodeText", "NodeTextMark"):
                continue
            for key in ("Data", "TextMarkTextContent"):
                for value in WEB.findall(html.unescape(node.get(key, ""))):
                    value = value.rstrip(".,;。")
                    while value.endswith(")") and value.count(")") > value.count("("):
                        value = value[:-1]
                    if urlsplit(value).hostname:
                        targets.add(value)
    return targets


def assets(nodes):
    return {match for node in nodes for value in text_values(node) for match in ASSET.findall(value)}


def empty(node):
    return node["Type"] == "NodeParagraph" and all(
        child["Type"] == "NodeText" and not child.get("Data", "").strip("\u200b \t\n")
        for child in node.get("Children", []))


def inventory(root):
    entries = sorted(root.rglob("*"))
    require(not any(p.is_symlink() for p in entries), "Symbolic link in workspace")
    return {str(p.relative_to(root)): sha(p.read_bytes()) for p in entries
            if p.is_file() and (p.suffix == ".sy" or p.relative_to(root).parts[0] == "assets")}


def block(kind, updated, seed, children, **extra):
    block_id = updated + "-" + sha(seed.encode())[:7]
    return {"ID": block_id, "Type": kind, **extra,
            "Properties": {"id": block_id, "updated": updated}, "Children": children}


def prepare(root, verification):
    data = root / "workspace/data"
    config = read(root / "kernel.json")
    archived = read(root / "import/archive.json")
    result = read(verification)
    require(result["ok"] and result["data"]["verified"], "Baseline verification required")
    proof = result["data"]
    require(read(root / "import/manifest.json")["archiveHash"] == proof["archiveHash"],
            "Archive and verification differ")
    receipt = read(root / ("import/target-" + sha(proof["target"].encode()) + ".json"))
    before = inventory(data)
    docs = {p: read(data / p) for p in before if p.endswith(".sy") and not p.startswith("assets/")}
    by_id = {doc["ID"]: p for p, doc in docs.items()}
    require(len(by_id) == len(docs), "Duplicate document ID")
    marker = docs[by_id[config["libraryRootId"]]]["Properties"]["custom-cd-library"]
    require(proof["target"] == config["url"] + "|" + config["notebookId"] + "|" + marker,
            "Verification belongs to another library")
    concepts = receipt["concepts"]
    require(set(concepts) == {item["id"] for item in archived["concepts"]}, "Concept mapping incomplete")
    require(set(receipt["relations"]) == {str(item["id"]) for item in archived["relations"]},
            "Relation mapping incomplete")
    require(set(receipt["assets"]) == {item["hash"] for item in archived["assets"]}, "Asset mapping incomplete")
    for digest, asset in receipt["assets"].items():
        require(before.get(asset) == digest, "Imported attachment hash differs")
    articles, related = defaultdict(dict), defaultdict(list)
    actual = defaultdict(set)
    for path, doc in docs.items():
        attrs = doc["Properties"]
        kind = attrs.get("custom-cd-kind")
        actual[kind].add(doc["ID"])
        if kind == "article":
            parent, locale = attrs["custom-cd-parent"], attrs["custom-cd-locale"]
            require(parent in concepts.values() and locale in ("cn", "en")
                    and locale not in articles[parent], "Unrecognized supplementary document")
            require(Path(path).parent == Path(by_id[parent]).with_suffix(""), "Unexpected article path")
            articles[parent][locale] = path
        elif kind not in ("concept", "relation"):
            require(doc["ID"] in (config["libraryRootId"], config["relationsRootId"]),
                    "Unexpected document outside imported mapping")
    require(actual["concept"] == set(concepts.values()) and len(concepts) == len(actual["concept"]),
            "Imported concepts differ from mapping")
    require(actual["relation"] == set(receipt["relations"].values()), "Imported relations differ from mapping")
    for relation in archived["relations"]:
        left, right = relation["source_concept_id"], relation["target_concept_id"]
        require(left != right and relation["note_cn"].strip(), "Unexpected relation without Chinese reason")
        doc = docs[by_id[receipt["relations"][str(relation["id"])]]]
        require(json.loads(html.unescape(doc["Properties"]["custom-cd-relation"])) == relation,
                "Imported relation metadata differs")
        require(set(LINK.findall(" ".join(text_values(doc)))) == {concepts[left], concepts[right]},
                "Imported relation endpoints differ")
        related[left].append((right, relation))
        related[right].append((left, relation))

    changed, removed, records = {}, set(), []
    for legacy, identifier in sorted(concepts.items()):
        path = by_id[identifier]
        doc = docs[path]
        props = doc["Properties"]
        require(props["custom-cd-legacy-id"] == legacy and props["custom-cd-schema"] == "1",
                "Unexpected legacy card layout")
        locales = articles[identifier]
        if set(locales) == {"en"}:
            records.append({"legacyId": legacy, "cardId": identifier, "keepEnglish": True,
                            "articleId": docs[locales["en"]]["ID"]})
            continue
        require(set(locales) == {"cn", "en"}, "Unreviewed article language layout")
        cn, en = docs[locales["cn"]], docs[locales["en"]]
        require(cn["Properties"]["title"] == "中文长文" and en["Properties"]["title"] == "English article",
                "Unexpected article title")
        cn_notes, en_notes = doc["Children"][:29], doc["Children"][29:]
        require(len(cn_notes) == len(en_notes) == 29 and plain(cn_notes[0]).startswith("回想")
                and plain(en_notes[0]).startswith("Recall"), "Unreviewed legacy field structure")
        notes = [cn_notes[0]]
        for ch, cg, eh, eg in zip(cn_notes[1::2], cn_notes[2::2], en_notes[1::2], en_notes[2::2]):
            ca, ea = cg["Properties"], eg["Properties"]
            require(ch["Type"] == eh["Type"] == "NodeHeading"
                    and plain(ch).startswith("中文 · ") and plain(eh).startswith("English · ")
                    and ca["custom-cd-field"] == ea["custom-cd-field"]
                    and (ca["custom-cd-locale"], ea["custom-cd-locale"]) == ("cn", "en"),
                    "Unreviewed legacy field layout")
            for group in (cg, eg):
                children = group["Children"]
                require(group["Type"] == "NodeSuperBlock" and len(children) >= 4
                        and [x["Type"] for x in (children[0], children[1], children[-1])] ==
                        ["NodeSuperBlockOpenMarker", "NodeSuperBlockLayoutMarker", "NodeSuperBlockCloseMarker"],
                        "Unreviewed fixed field wrapper")
            kept = [node for node in cg["Children"][2:-1] if not empty(node)]
            if kept:
                label = "出处" if ca["custom-cd-field"] == "source_text" else plain(ch).removeprefix("中文 · ")
                notes.extend([dict(ch, Children=[{"Type": "NodeText", "Data": label}]), *kept])
        english = en["Children"] + en_notes
        chinese = cn["Children"] + notes
        source_only = sorted(urls(english) - urls(chinese))
        asset_only = sorted(assets(english) - assets(chinese))
        require(set(asset_only) <= set(receipt["assets"].values()), "Unmapped supplementary attachment")
        anchor = {"ID": cn["ID"], "Type": "NodeHeading", "HeadingLevel": 2,
                  "Properties": {k: cn["Properties"][k] for k in ("id", "updated")},
                  "Children": [{"Type": "NodeText", "Data": "中文长文"}]}
        updated = max(d["Properties"]["updated"] for d in (doc, cn, en))
        supplemental = []
        if source_only or asset_only:
            supplemental.append(block("NodeHeading", updated, identifier + ":supplement",
                                      [{"Type": "NodeText", "Data": "补充资料"}], HeadingLevel=2))
        images = {child["Data"]: node for section in english for node in walk(section)
                  if node["Type"] == "NodeImage" for child in node["Children"]
                  if child["Type"] == "NodeLinkDest"}
        for target in source_only + asset_only:
            contents = [images[target]] if target in images else [
                {"Type": "NodeTextMark", "TextMarkType": "a", "TextMarkAHref": target,
                 "TextMarkTextContent": target if target in source_only else "补充附件"}]
            supplemental.append(block("NodeParagraph", updated, identifier + ":supplement:" + target, contents))
        links = []
        endpoints = sorted(related[legacy], key=lambda pair: pair[1]["id"])
        if endpoints:
            links.append(block("NodeHeading", updated, identifier + ":relations",
                               [{"Type": "NodeText", "Data": "相关卡片"}], HeadingLevel=2))
        for other, relation in endpoints:
            other_id = concepts[other]
            links.append(block("NodeParagraph", updated, identifier + ":" + str(relation["id"]), [
                {"Type": "NodeTextMark", "TextMarkType": "a", "TextMarkAHref": "kane://blocks/" + other_id,
                 "TextMarkTextContent": html.unescape(docs[by_id[other_id]]["Properties"]["title"])},
                {"Type": "NodeText", "Data": " · " + LABELS[relation["relation_type"]] + "：" + relation["note_cn"].strip()},
            ]))
        changed[path] = dict(doc, Properties=dict(props, updated=updated, **{
            "custom-cd-schema": "2", "custom-cd-language": "cn"}),
            Children=[anchor, *cn["Children"], *notes, *supplemental, *links])
        removed.update(locales.values())
        records.append({"legacyId": legacy, "cardId": identifier, "articleId": cn["ID"],
                        "removedEnglishId": en["ID"], "relatedCardIds": [concepts[key] for key, _ in endpoints],
                        "chineseArticleHash": sha(encoded(cn["Children"])), "notesHash": sha(encoded(notes)),
                        "supplementalSourceHashes": [sha(value.encode()) for value in source_only],
                        "supplementalAssets": asset_only})

    final = [changed.get(p, d) for p, d in docs.items() if p not in removed]
    ids = [n["ID"] for d in final for n in walk(d) if n.get("ID")]
    require(len(ids) == len(set(ids)), "Duplicate block ID after conversion")
    values = [value for doc in final for value in text_values(doc)]
    old_ids = {n["ID"] for d in docs.values() for n in walk(d) if n.get("ID")}
    require(not (old_ids - set(ids)) & {m for value in values for m in ID.findall(value)},
            "Retained content references a removed block")
    for value in values:
        require("siyuan://" not in value.lower() and value.count("kane://") == len(LINK.findall(value))
                and set(LINK.findall(value)) <= set(ids), "Invalid or unresolved internal link")
    after = {p: sha(encoded(changed[p])) if p in changed else digest
             for p, digest in before.items() if p not in removed}
    return {"library": proof["target"], "archiveHash": proof["archiveHash"],
            "before": before, "after": after, "cards": records, "removed": sorted(removed)}, changed


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan", "apply", "verify"))
    parser.add_argument("baseline", type=Path)
    parser.add_argument("verification", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--candidate", type=Path)
    args = parser.parse_args()
    root = args.baseline.resolve(strict=True)
    manifest, changed = prepare(root, args.verification)
    if args.action == "plan":
        with args.manifest.open("xb") as out:
            out.write(encoded(manifest) + b"\n")
    else:
        require(read(args.manifest) == manifest, "Approved plan does not match current baseline")
        require(args.candidate is not None, "Specify a separate candidate directory")
        candidate = args.candidate.resolve()
        require(candidate.parent == root.parent and candidate != root, "Candidate must be a sibling of baseline")
        data = candidate / "workspace/data"
        if args.action == "apply":
            require(not args.candidate.is_symlink() and not candidate.exists(), "Candidate already exists")
            require(not any(p.is_symlink() for p in root.rglob("*")), "Symbolic link in baseline")
            candidate.mkdir(mode=0o700)
            shutil.copytree(root, candidate, dirs_exist_ok=True)
            env = candidate / "compose.env"
            current = env.read_text()
            updated, count = re.subn(r"^CONCEPT_PRIVATE_ROOT=.*$", lambda _: f"CONCEPT_PRIVATE_ROOT={candidate}",
                                     current, flags=re.M)
            require(count == 1, "Missing or ambiguous Compose private root")
            env.write_text(updated)
            require(inventory(data) == manifest["before"], "Baseline changed during copy")
            for path, doc in changed.items():
                (data / path).write_bytes(encoded(doc))
            for path in manifest["removed"]:
                (data / path).unlink()
        require(inventory(data) == manifest["after"], "Candidate document or attachment hash differs")
    print(json.dumps({"cards": len(manifest["cards"]), "converted": len(changed),
                      "removedPages": len(manifest["removed"]), "verified": args.action != "plan"}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Migration stopped: {error}", file=sys.stderr)
        sys.exit(1)
