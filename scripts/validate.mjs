import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const phases = new Set(['planning', 'implementation', 'verification', 'complete', 'blocked']);
const contextKeys = ['agent_entry', 'environment', 'product_contract', 'workflow', 'active_state', 'backlog'];
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
  if (!strings(project.required_paths) || project.required_paths.length === 0) {
    errors.push('project.json: required_paths must be a nonempty array of paths');
  } else {
    for (const path of project.required_paths) {
      const error = checkLocalPath(root, root, path);
      if (error) errors.push(`project.json: required_paths: ${error}`);
    }
  }
  if (!Array.isArray(project.services)) errors.push('project.json: services must be an array');
  if (!object(project.capabilities)) errors.push('project.json: capabilities must be an object');
  for (const name of ['project_skills', 'connectors']) {
    if (!strings(project.capabilities?.[name])) errors.push(`project.json: capabilities.${name} must be an array of strings`);
  }
  if (pkg?.engines?.node !== '>=24 <25') errors.push('package.json: engines.node must be >=24 <25');
  if (pkg?.private !== true) errors.push('package.json: private must be true');
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (pkg?.[key] !== undefined && (!object(pkg[key]) || !Object.values(pkg[key]).every(nonempty))) errors.push(`package.json: ${key} must map package names to nonempty version strings`);
  }
}

function validateState(root, state, errors) {
  if (!state) return;
  if (state.schema_version !== 1) errors.push('workflow-state.json: schema_version must be 1');
  if (!nonempty(state.task_id) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(state.task_id)) errors.push('workflow-state.json: task_id must contain only letters, numbers, underscores or hyphens');
  if (!phases.has(state.phase)) errors.push('workflow-state.json: invalid phase');
  const taskError = checkLocalPath(root, root, state.task_file);
  if (taskError) errors.push(`workflow-state.json: task_file: ${taskError}`);
  else if (!statSync(resolve(root, state.task_file)).isFile()) errors.push('workflow-state.json: task_file must point to a file');
  if (state.task_file !== `tasks/${state.task_id}.md`) errors.push('workflow-state.json: task_file must be tasks/<task_id>.md');
  if (!timestamp(state.updated_at)) errors.push('workflow-state.json: updated_at must be a valid ISO date or timestamp with timezone');
  if (!nonempty(state.summary)) errors.push('workflow-state.json: summary is required');
  if (!strings(state.blockers)) errors.push('workflow-state.json: blockers must be an array of strings');
  if (!strings(state.next_actions)) errors.push('workflow-state.json: next_actions must be an array of strings');
  if (!strings(state.required_checks) || !state.required_checks.length) errors.push('workflow-state.json: required_checks must be a nonempty array of nonempty command strings');
  if (!Array.isArray(state.verification)) {
    errors.push('workflow-state.json: verification must be an array');
  } else {
    for (const record of state.verification) {
      if (!object(record) || !nonempty(record.command)
        || !['passed', 'failed', 'skipped'].includes(record.result) || !timestamp(record.recorded_at)) {
        errors.push('workflow-state.json: invalid verification record');
      }
    }
  }
  if (state.phase === 'complete') {
    if (!Array.isArray(state.blockers) || state.blockers.length) errors.push('workflow-state.json: complete requires no blockers');
    for (const command of Array.isArray(state.required_checks) ? state.required_checks : []) {
      const latest = Array.isArray(state.verification) ? state.verification.filter((record) => record?.command === command).at(-1) : null;
      if (latest?.result !== 'passed') errors.push(`workflow-state.json: complete requires a passed ${command} record as the latest result`);
    }
  }
  if (state.phase === 'blocked' && (!Array.isArray(state.blockers) || !state.blockers.length)) errors.push('workflow-state.json: blocked requires a blocker');
}

function withoutCode(markdown) {
  let fence = null;
  return markdown.replace(/<!--[\s\S]*?-->/g, (text) => text.replace(/[^\n]/g, ' ')).split('\n').map((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*$/.test(line.slice(marker[0].length))) fence = null;
      return '';
    }
    if (marker) { fence = marker[1]; return ''; }
    if (/^(?: {4}|\t)/.test(line)) return '';
    return line.replace(/(`+)[\s\S]*?\1/g, (text) => ' '.repeat(text.length));
  }).join('\n');
}

function slugify(text) {
  return text.trim().toLowerCase()
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Collect GitHub-style heading anchors so local links with fragments can be checked.
export function documentAnchors(markdown) {
  const anchors = new Set();
  const seen = new Map();
  for (const line of withoutCode(markdown).split('\n')) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!match) continue;
    const base = slugify(match[1]);
    if (!base) continue;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function destination(text, start) {
  let cursor = start;
  while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++;
  if (text[cursor] === '<') {
    const end = text.indexOf('>', cursor + 1);
    return end === -1 ? null : { value: text.slice(cursor + 1, end), end: end + 1 };
  }
  let depth = 0;
  const from = cursor;
  for (; cursor < text.length; cursor++) {
    const char = text[cursor];
    if (char === '\\') { cursor++; continue; }
    if (char === '(') depth++;
    if (char === ')') { if (!depth) break; depth--; }
    if (/\s/.test(char) && depth === 0) break;
  }
  return { value: text.slice(from, cursor), end: cursor };
}

export function markdownLinks(markdown) {
  const text = withoutCode(markdown);
  const links = [];
  const definitions = new Set();
  const normalize = (label) => label.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const match of text.matchAll(/^\s{0,3}\[([^\]\n]+)\]:[^\S\n]*/gm)) {
    const target = destination(text, match.index + match[0].length);
    if (target?.value) links.push({ destination: target.value, line: text.slice(0, match.index).split('\n').length });
    definitions.add(normalize(match[1]));
  }
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] !== ']') continue;
    if (text[index + 1] === '(') {
      const target = destination(text, index + 2);
      if (target?.value) links.push({ destination: target.value, line: text.slice(0, index).split('\n').length });
      if (target) index = target.end - 1;
    } else if (text[index + 1] === '[') {
      const end = text.indexOf(']', index + 2);
      if (end !== -1) {
        const label = text.slice(index + 2, end) || text.slice(text.lastIndexOf('[', index) + 1, index);
        if (!definitions.has(normalize(label))) links.push({ error: `undefined link reference: ${label}`, line: text.slice(0, index).split('\n').length });
        index = end;
      }
    }
  }
  return links;
}

function markdownFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && (excludedDirectories.has(entry.name) || /^\..*cache.*$/i.test(entry.name))) continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...markdownFiles(root, path));
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
    for (const link of markdownLinks(readFileSync(file, 'utf8'))) {
      const label = `${relative(root, file)}:${link.line}`;
      if (link.error) { errors.push(`${label}: ${link.error}`); continue; }
      let target = link.destination.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\])/g, '$1');
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = validateRepository();
  if (result.errors.length) {
    for (const error of result.errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS project manifest, workflow state, required paths, and local links in ${result.markdownCount} Markdown files`);
  }
}
