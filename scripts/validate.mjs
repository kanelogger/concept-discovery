import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { parse as parseYaml } from 'yaml';

const phases = new Set(['idle', 'planning', 'implementation', 'verification', 'complete', 'blocked']);
const contextKeys = ['agent_entry', 'environment', 'product_contract', 'workflow', 'active_state'];
const commands = ['doctor', 'validate', 'test', 'check'];
const excludedDirectories = new Set(['.git', 'node_modules', '.local', 'coverage', '.cache', '.npm', '.pnpm-store', '.yarn', '.next', '.turbo']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const strings = (value) => Array.isArray(value) && value.every(nonempty);
const within = (root, target) => {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
const timestamp = (value) => {
  if (!nonempty(value)) return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2})))?$/);
  if (!match) return false;
  const [, yearText, monthText, dayText, hour, minute, second, offsetHour, offsetMinute] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && (hour === undefined || (Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60))
    && (offsetHour === undefined || (Number(offsetHour) < 24 && Number(offsetMinute) < 60));
};

function readJson(root, file, errors) {
  try {
    const pathError = checkLocalPath(root, root, file);
    if (pathError) throw new Error(pathError);
    const value = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
    if (!object(value)) throw new Error('expected a JSON object');
    return value;
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
    return null;
  }
}

// Check lexical and real paths: a symlink must never make a local reference leave the repository.
export function checkLocalPath(root, sourceDirectory, value) {
  if (!nonempty(value)) return 'path must be a nonempty string';
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes('\\') || value.includes('\0')) {
    return `absolute or unsupported path: ${value}`;
  }
  const target = resolve(sourceDirectory, value);
  if (!within(root, target)) return `path escapes repository: ${value}`;
  // Inspect each existing parent too, so broken paths behind an escaping symlink fail safely.
  let parent = target;
  while (within(root, parent)) {
    try {
      if (!within(realpathSync(root), realpathSync(parent))) return `symlink escapes repository: ${value}`;
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return `${value}: ${error.message}`;
      if (parent === root) break;
      parent = dirname(parent);
    }
  }
  try {
    statSync(target);
  } catch {
    return `missing path: ${value}`;
  }
  return null;
}

function validateProject(root, project, pkg, errors) {
  if (!project) return;
  if (project.schema_version !== 1) errors.push('project.json: schema_version must be 1');
  if (!object(project.project) || project.project.id !== 'concept-discovery'
    || !nonempty(project.project.stage) || !nonempty(project.project.product_status)) {
    errors.push('project.json: expected concept-discovery project with nonempty stage and product_status');
  }
  if (!object(project.runtime) || project.runtime.node_major !== 24) errors.push('project.json: runtime.node_major must be 24');
  for (const command of commands) {
    const script = project.commands?.[command];
    if (!nonempty(script) || !nonempty(pkg?.scripts?.[script])) errors.push(`project.json: commands.${command} must name an existing package.json script`);
  }
  for (const key of contextKeys) {
    const value = project.context?.[key];
    const error = checkLocalPath(root, root, value);
    if (error) errors.push(`project.json: context.${key}: ${error}`);
    else if (!statSync(resolve(root, value)).isFile()) errors.push(`project.json: context.${key} must point to a file`);
  }
  if (project.context?.active_state !== 'workflow-state.json') errors.push('project.json: context.active_state must be workflow-state.json');
  if (project.required_paths !== undefined) {
    if (!strings(project.required_paths) || project.required_paths.length === 0) {
      errors.push('project.json: required_paths must be a nonempty array of paths');
    } else {
      for (const path of project.required_paths) {
        const error = checkLocalPath(root, root, path);
        if (error) errors.push(`project.json: required_paths: ${error}`);
      }
    }
  }
  if (!Array.isArray(project.services)) errors.push('project.json: services must be an array');
  if (!object(project.capabilities)) errors.push('project.json: capabilities must be an object');
  for (const name of ['project_skills', 'connectors']) {
    if (!strings(project.capabilities?.[name])) errors.push(`project.json: capabilities.${name} must be an array of strings`);
  }
  if (pkg?.engines?.node !== '>=24.7 <25') errors.push('package.json: engines.node must be >=24.7 <25');
  if (pkg?.private !== true) errors.push('package.json: private must be true');
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (pkg?.[key] !== undefined && (!object(pkg[key]) || !Object.values(pkg[key]).every(nonempty))) errors.push(`package.json: ${key} must map package names to nonempty version strings`);
  }
}

function validateState(root, state, errors) {
  if (!state) return;
  if (state.schema_version !== 1) errors.push('workflow-state.json: schema_version must be 1');
  if (!phases.has(state.phase)) errors.push('workflow-state.json: invalid phase');
  if (!timestamp(state.updated_at)) errors.push('workflow-state.json: updated_at must be a valid ISO date or timestamp with timezone');
  if (!nonempty(state.summary)) errors.push('workflow-state.json: summary is required');
  if (state.phase === 'idle') {
    if (state.task_id !== null || state.task_file !== null) errors.push('workflow-state.json: idle requires null task pointers');
    return;
  }
  if (!nonempty(state.task_id) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(state.task_id)) errors.push('workflow-state.json: task_id must contain only letters, numbers, underscores or hyphens');
  const taskError = checkLocalPath(root, root, state.task_file);
  if (taskError) errors.push(`workflow-state.json: task_file: ${taskError}`);
  else if (!statSync(resolve(root, state.task_file)).isFile()) errors.push('workflow-state.json: task_file must point to a file');
  if (state.task_file !== `tasks/${state.task_id}.md`) errors.push('workflow-state.json: task_file must be tasks/<task_id>.md');
}

// Mask only a YAML mapping. A pair of thematic breaks may enclose ordinary Markdown.
function markdownBody(markdown) {
  const source = markdown.replace(/^\uFEFF/, '');
  return source.replace(/^---[ \t]*\r?\n((?:[^\n]*\n)*?)(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/, (block, candidate) => {
    try {
      const metadata = parseYaml(candidate, { mapAsMap: true, logLevel: 'error' });
      // Markdown reference definitions such as [manual]: guide.md parse as YAML with a sequence key.
      if (metadata instanceof Map && [...metadata.keys()].every(key => typeof key === 'string')) return block.replace(/[^\r\n]/g, ' ');
    } catch { /* Invalid YAML remains Markdown. */ }
    return block;
  });
}

function* nodes(node) {
  yield node;
  for (const child of node.children ?? []) yield* nodes(child);
}

// Explicit references without a definition are plain text in CommonMark. Supply
// candidate definitions in a second parse so the parser decides which are real.
function undefinedReferences(source, tree) {
  const markers = new Set();
  for (const node of nodes(tree)) {
    if (node.type !== 'text' || !node.value.includes('][')) continue;
    const { start, end } = node.position;
    for (const match of source.slice(start.offset, end.offset).matchAll(/\]\[/g)) markers.add(start.offset + match.index);
  }
  if (!markers.size) return [];

  const definitions = new Set();
  const referenceEnds = new Map();
  for (const match of source.matchAll(/\[((?:\\[\s\S]|[^\[\]\\])+)\]/g)) {
    const end = match.index + match[0].length;
    const full = markers.has(match.index - 1);
    const collapsed = markers.has(end - 1) && source.startsWith('[]', end);
    if (!full && !collapsed) continue;
    definitions.add(`[${match[1].replace(/(?:\r\n?|\n)[ \t>]*/g, ' ')}]: #`);
    if (full) referenceEnds.set(end, match.index - 1);
    if (collapsed) referenceEnds.set(end + 2, end - 1);
  }
  if (!definitions.size) return [];
  const prefix = [...definitions].join('\n') + '\n\n';
  const errors = [];
  for (const node of nodes(fromMarkdown(prefix + source))) {
    if ((node.type === 'linkReference' || node.type === 'imageReference') && node.referenceType !== 'shortcut'
      && referenceEnds.has(node.position.end.offset - prefix.length)) {
      const marker = referenceEnds.get(node.position.end.offset - prefix.length);
      errors.push({ error: `undefined link reference: ${node.label}`, line: source.slice(0, marker).split(/\r\n?|\n/).length });
    }
  }
  return errors;
}

function headingText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.alt) return node.alt;
  return (node.children ?? []).map(headingText).join('');
}

export function documentAnchors(markdown) {
  const anchors = new Set();
  for (const node of nodes(fromMarkdown(markdownBody(markdown)))) {
    if (node.type !== 'heading') continue;
    const base = headingText(node).toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replaceAll(' ', '-');
    let anchor = base;
    for (let suffix = 1; anchors.has(anchor); suffix++) anchor = `${base}-${suffix}`;
    anchors.add(anchor);
  }
  return anchors;
}

export function markdownLinks(markdown) {
  const source = markdownBody(markdown);
  const tree = fromMarkdown(source);
  const links = [];
  for (const node of nodes(tree)) {
    if (['link', 'image', 'definition'].includes(node.type)) links.push({ destination: node.url, line: node.position.start.line });
  }
  if (source.includes('][')) links.push(...undefinedReferences(source, tree));
  return links;
}

function markdownFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && (excludedDirectories.has(entry.name) || /^\..*cache.*$/i.test(entry.name) || entry.name.startsWith('private-'))) continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...markdownFiles(root, path));
    else if (entry.name.startsWith('private-') && /\.md$/i.test(entry.name)) continue;
    else if (/\.md$/i.test(entry.name)) files.push(path);
  }
  return files;
}

export function validateRepository(root = process.cwd()) {
  root = resolve(root);
  const errors = [];
  const project = readJson(root, 'project.json', errors);
  const state = readJson(root, 'workflow-state.json', errors);
  const pkg = readJson(root, 'package.json', errors);
  validateProject(root, project, pkg, errors);
  validateState(root, state, errors);
  let files = [];
  try { files = markdownFiles(root); } catch (error) { errors.push(`Markdown traversal: ${error.message}`); }
  const anchors = new Map();
  const anchorsFor = (file) => {
    if (!anchors.has(file)) {
      try { anchors.set(file, documentAnchors(readFileSync(file, 'utf8'))); }
      catch { anchors.set(file, new Set()); }
    }
    return anchors.get(file);
  };
  for (const file of files) {
    const markdown = readFileSync(file, 'utf8');
    if (currentCommandDocument(relative(root, file).split(sep).join('/'), state?.task_file)) {
      for (const reference of npmScriptReferences(markdown)) {
        if (!nonempty(pkg?.scripts?.[reference.name])) errors.push(`${relative(root, file)}:${reference.line}: unknown npm script: ${reference.name}`);
      }
    }
    for (const link of markdownLinks(markdown)) {
      const label = `${relative(root, file)}:${link.line}`;
      if (link.error) { errors.push(`${label}: ${link.error}`); continue; }
      let target = link.destination;
      if (/^file:/i.test(target) || /^[A-Za-z]:[\\/]/.test(target)) { errors.push(`${label}: local URL must be repository-relative: ${target}`); continue; }
      if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(target) || target.startsWith('//')) continue;
      let fragment = '';
      const hash = target.indexOf('#');
      if (hash !== -1) {
        const raw = target.slice(hash + 1);
        target = target.slice(0, hash);
        try { fragment = decodeURIComponent(raw).toLowerCase(); } catch { errors.push(`${label}: invalid URL encoding: ${raw}`); continue; }
      }
      target = target.split('?')[0];
      if (!target) {
        if (fragment && !anchorsFor(file).has(fragment)) errors.push(`${label}: missing anchor: #${fragment}`);
        continue;
      }
      try { target = decodeURIComponent(target); } catch { errors.push(`${label}: invalid URL encoding: ${target}`); continue; }
      const pathError = checkLocalPath(root, dirname(file), target);
      if (pathError) { errors.push(`${label}: ${pathError}`); continue; }
      if (fragment && /\.md$/i.test(target) && !anchorsFor(resolve(dirname(file), target)).has(fragment)) {
        errors.push(`${label}: missing anchor: #${fragment}`);
      }
    }
  }
  return { errors, markdownCount: files.length };
}

export function currentCommandDocument(path, taskFile) {
  return ['README.md', 'AGENTS.md', 'AI_ENVIRONMENT.md', 'specs/product-contract.md', 'docs/reading-experience.md',
    'docs/agent-environment/commands.md',
    'skills/concept-discovery/SKILL.md', taskFile].includes(path)
    || /^(?:workflow|rules|docs\/agents)\/.*\.md$/.test(path);
}

// Only executable-looking inline snippets and shell fences are command references.
export function npmScriptReferences(markdown) {
  const references = [];
  const source = markdownBody(markdown);
  for (const node of nodes(fromMarkdown(source))) {
    let body, line = node.position.start.line;
    if (node.type === 'inlineCode') {
      body = source.slice(node.position.start.offset, node.position.end.offset).replace(/^`+|`+$/g, '');
    } else if (node.type === 'code' && ['sh', 'bash', 'shell', 'zsh', 'console', 'text'].includes(node.lang)) {
      body = node.value;
      line++;
    } else continue;
    for (const match of body.matchAll(/\bnpm\s+(?:(?:--[\w-]+(?:=[^\s]+)?)\s+)*(?:(?:run|run-script)\s+(?:--[\w-]+\s+)*([\w:.-]+)|(test|start|stop|restart))(?=$|[\s;&|])/g)) {
      references.push({ name: match[1] ?? match[2], line: line + body.slice(0, match.index).split(/\r\n?|\n/).length - 1 });
    }
  }
  return references;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = validateRepository();
  if (result.errors.length) {
    for (const error of result.errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS project manifest, workflow state, required paths, and local links in ${result.markdownCount} Markdown files`);
  }
}
