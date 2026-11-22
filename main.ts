// main.ts is mend, the CLI SPEC.md specifies (MIT). It does all of SPEC.md: the command line, the output and exit
// codes, safe paths, format detection, matching lines at three tiers, the unified, SEARCH/REPLACE, V4A and JSON
// formats, and the all-or-nothing write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** A text file as section 3 reads it: its lines, its line break, and whether it ends with one. */
interface TextFile {
  lines: string[];
  br: string;
  final: boolean;
}

function splitText(text: string): TextFile {
  const nl = text.indexOf('\n');
  const crlf = nl > 0 && text[nl - 1] === '\r';
  const br = crlf ? '\r\n' : '\n';
  if (text === '') return { lines: [], br, final: false };
  const lines = text.split(br);
  const final = text.endsWith(br);
  if (final) lines.pop();
  return { lines, br, final };
}

function joinText(lines: string[], br: string, final: boolean): string {
  if (lines.length === 0) return '';
  return lines.join(br) + (final ? br : '');
}

/** A file an edit creates: LF breaks, a final one, and nothing at all for no lines. */
function createdText(lines: string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

const leadingWs = (s: string): string => /^[ \t]*/.exec(s)![0];

function normalized(s: string, tier: number): string {
  if (tier === 0) return s;
  if (tier === 1) return s.replace(/[ \t]+$/, '');
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

/** Every position at which O occurs at one tier; occurrences may overlap. */
function occurrences(lines: string[], o: string[], tier: number): number[] {
  const at: number[] = [];
  if (o.length === 0) {
    for (let i = 0; i <= lines.length; i++) at.push(i);
    return at;
  }
  outer: for (let i = 0; i + o.length <= lines.length; i++) {
    for (let j = 0; j < o.length; j++) {
      if (normalized(lines[i + j]!, tier) !== normalized(o[j]!, tier)) continue outer;
    }
    at.push(i);
  }
  return at;
}

/** The first tier at which O occurs, with its occurrences there; null when no tier has one. */
function tierOf(lines: string[], o: string[], strict: boolean): { tier: number; at: number[] } | null {
  for (let tier = 0; tier <= (strict ? 0 : 2); tier++) {
    const at = occurrences(lines, o, tier);
    if (at.length > 0) return { tier, at };
  }
  return null;
}

/** Like tierOf, but only occurrences at or after `from` and, for an eof chunk, ending at the end. */
function tierFrom(lines: string[], o: string[], from: number, eof: boolean, strict: boolean): { tier: number; at: number[] } | null {
  for (let tier = 0; tier <= (strict ? 0 : 2); tier++) {
    const at = occurrences(lines, o, tier).filter((p) => p >= from && (!eof || p + o.length === lines.length));
    if (at.length > 0) return { tier, at };
  }
  return null;
}

/** The first line at or after `from` equal to a one-line anchor at the first tier with one. */
function anchorLine(lines: string[], anchor: string, from: number, strict: boolean): number | null {
  for (let tier = 0; tier <= (strict ? 0 : 2); tier++) {
    const want = normalized(anchor, tier);
    for (let i = from; i < lines.length; i++) if (normalized(lines[i]!, tier) === want) return i;
  }
  return null;
}

type BodyKind = ' ' | '-' | '+' | '\\';

/** One line of a unified hunk or a V4A chunk. */
interface BodyLine {
  kind: BodyKind;
  text: string;
}

/** One line of N, with a context line's index into O (null for a `+` line). */
interface NewLine {
  text: string;
  context: number | null;
}

function splitBody(body: BodyLine[]): { o: string[]; n: NewLine[] } {
  const o: string[] = [];
  const n: NewLine[] = [];
  for (const line of body) {
    if (line.kind === '\\') continue;
    if (line.kind === ' ' || line.kind === '-') o.push(line.text);
    if (line.kind === ' ' || line.kind === '+') n.push({ text: line.text, context: line.kind === ' ' ? o.length - 1 : null });
  }
  return { o, n };
}

/** N's lines: context lines from the file, the rest re-indented at tier 2 as section 5 says. */
function makeNewLines(n: NewLine[], matched: string[], oFirst: string | undefined, tier: number): string[] {
  if (tier !== 2 || oFirst === undefined) return n.map((x) => (x.context === null ? x.text : matched[x.context]!));
  const f = leadingWs(matched[0]!);
  const p = leadingWs(oFirst);
  return n.map((x) => {
    if (x.context !== null) return matched[x.context]!;
    const text = x.text;
    if (text !== '' && /\S/.test(text) && text.startsWith(p)) return f + text.slice(p.length);
    return text;
  });
}

/** Whether a `\` line immediately follows the hunk's last context or `+` line. */
function noFinalBreak(body: BodyLine[]): boolean {
  let last = -1;
  for (let i = 0; i < body.length; i++) if (body[i]!.kind === ' ' || body[i]!.kind === '+') last = i;
  return last >= 0 && body[last + 1]?.kind === '\\';
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  /** Move edits that succeeded, in patch order (a move to a path is reported only if its ends still hold). */
  readonly moves: { old: string; new: string }[] = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** A hunk of a unified-diff section: its old start line A and its body (section 6). */
interface UnifiedHunk {
  a: bigint;
  body: BodyLine[];
}

/** A unified-diff section's header (before the first hunk) and its hunks. */
interface UnifiedSection {
  diffOld: string | null;
  diffNew: string | null;
  pairOld: string | null;
  pairNew: string | null;
  hasPair: boolean;
  renameOld: string | null;
  renameNew: string | null;
  hasRenameOld: boolean;
  hasRenameNew: boolean;
  newMode: boolean;
  delMode: boolean;
  hunks: UnifiedHunk[];
}

function emptyUnifiedSection(diffOld: string | null, diffNew: string | null): UnifiedSection {
  return {
    diffOld,
    diffNew,
    pairOld: null,
    pairNew: null,
    hasPair: false,
    renameOld: null,
    renameNew: null,
    hasRenameOld: false,
    hasRenameNew: false,
    newMode: false,
    delMode: false,
    hunks: [],
  };
}

/** The old and new path of a `diff --git a/<X> b/<Y>` line, or null when it is not that form. */
function diffGitPaths(line: string): [string, string] | null {
  const rest = line.slice('diff --git '.length);
  if (!rest.startsWith('a/')) return null;
  const at = rest.indexOf(' b/');
  if (at < 0) return null;
  const oldPath = rest.slice(2, at);
  const newPath = rest.slice(at + 3);
  if (oldPath === '' || newPath === '') return null;
  return [oldPath, newPath];
}

/** A `---`/`+++` path: after four characters, up to a tab, trimmed, with a leading a/ or b/ gone. */
function headerPath(line: string): string | null {
  let path = line.slice(4);
  const tab = path.indexOf('\t');
  if (tab >= 0) path = path.slice(0, tab);
  path = path.trim();
  if (path === '/dev/null') return null;
  if (path.startsWith('a/') || path.startsWith('b/')) path = path.slice(2);
  return path;
}

function bodyFromRaw(raw: string[]): BodyLine[] {
  return raw.map((line) => {
    if (line === '') return { kind: ' ', text: '' };
    return { kind: line[0] as BodyKind, text: line.slice(1) };
  });
}

/** Parse one section from `start` to the next section's start; return that next index. */
function parseUnifiedSection(lines: string[], start: number, section: UnifiedSection): number {
  let i = start;
  let seenHunk = false;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) return i;
    if ((seenHunk || section.hasPair) && line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) return i;
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      seenHunk = true;
      const raw: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const b = lines[j]!;
        if (b.startsWith('diff --git ')) break;
        if (b.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
        if (b.startsWith('@@')) break;
        if (b === '' || b.startsWith(' ') || b.startsWith('-') || b.startsWith('+') || b.startsWith('\\')) {
          raw.push(b);
          j++;
          continue;
        }
        break;
      }
      while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
      section.hunks.push({ a: BigInt(m[1]!), body: bodyFromRaw(raw) });
      i = j;
      continue;
    }
    if (!seenHunk) {
      if (line.startsWith('--- ')) {
        if (!(lines[i + 1] ?? '').startsWith('+++ ')) throw new Exit2(`error: parse ${i + 2}`);
        section.hasPair = true;
        section.pairOld = headerPath(line);
        section.pairNew = headerPath(lines[i + 1]!);
        i += 2;
        continue;
      }
      if (line.startsWith('rename from ')) {
        section.hasRenameOld = true;
        section.renameOld = line.slice('rename from '.length).trim();
      } else if (line.startsWith('rename to ')) {
        section.hasRenameNew = true;
        section.renameNew = line.slice('rename to '.length).trim();
      } else if (line.startsWith('new file mode')) {
        section.newMode = true;
      } else if (line.startsWith('deleted file mode')) {
        section.delMode = true;
      }
      i++;
      continue;
    }
    i++;
  }
  return i;
}

/** Apply a change's hunks in order, with the running offset d (section 6). */
function applyUnifiedHunks(file: TextFile, hunks: UnifiedHunk[], strict: boolean, path: string): TextFile {
  let cur = file.lines.slice();
  let final = file.final;
  let d = 0;
  for (const hunk of hunks) {
    const { o, n } = splitBody(hunk.body);
    let pos = 0;
    let tier = 0;
    let matched: string[] = [];
    if (o.length === 0) {
      const target = hunk.a + BigInt(d);
      pos = target < 0n ? 0 : target > BigInt(cur.length) ? cur.length : Number(target);
    } else {
      const found = tierOf(cur, o, strict);
      if (found === null) throw new Fail('no-match', path);
      tier = found.tier;
      const target = hunk.a - 1n + BigInt(d);
      const distance = (at: number): bigint => {
        const delta = BigInt(at) - target;
        return delta < 0n ? -delta : delta;
      };
      pos = found.at[0]!;
      for (const at of found.at) {
        if (distance(at) < distance(pos)) pos = at;
      }
      matched = cur.slice(pos, pos + o.length);
    }
    const atEnd = pos + o.length === cur.length;
    cur = [...cur.slice(0, pos), ...makeNewLines(n, matched, o.length > 0 ? o[0] : undefined, tier), ...cur.slice(pos + o.length)];
    if (atEnd) final = !noFinalBreak(hunk.body);
    d += n.length - o.length;
  }
  return { lines: cur, br: file.br, final };
}

/** One unified-diff section as one edit (section 6). */
function unifiedEdit(section: UnifiedSection, strict: boolean): Edit {
  const oldPath = section.hasPair ? section.pairOld : section.hasRenameOld ? section.renameOld : section.diffOld;
  const newPath = section.hasPair ? section.pairNew : section.hasRenameNew ? section.renameNew : section.diffNew;
  const checkPaths = (): void => {
    if (oldPath !== null && !safe(oldPath)) throw new Fail('unsafe', oldPath);
    if (newPath !== null && !safe(newPath)) throw new Fail('unsafe', newPath);
  };
  if (section.newMode || oldPath === null) {
    const path = newPath ?? '';
    return (tree) => {
      checkPaths();
      if (!safe(path)) throw new Fail('unsafe', path);
      if (tree.get(path) !== null) throw new Fail('exists', path);
      const plus: string[] = [];
      let final = false;
      for (const hunk of section.hunks) {
        hunk.body.forEach((line, k) => {
          if (line.kind === '+') {
            plus.push(line.text);
            final = hunk.body[k + 1]?.kind !== '\\';
          }
        });
      }
      tree.now.set(path, plus.length === 0 ? '' : plus.join('\n') + (final ? '\n' : ''));
    };
  }
  if (section.delMode || newPath === null) {
    const path = oldPath ?? '';
    return (tree) => {
      checkPaths();
      if (!safe(path)) throw new Fail('unsafe', path);
      if (tree.get(path) === null) throw new Fail('missing', path);
      tree.now.set(path, null);
    };
  }
  const from = oldPath!;
  const to = newPath!;
  const move = from !== to;
  return (tree) => {
    checkPaths();
    const before = tree.get(from);
    if (before === null) throw new Fail('missing', from);
    if (move && tree.get(to) !== null) throw new Fail('exists', to);
    const after = applyUnifiedHunks(splitText(before), section.hunks, strict, from);
    const text = joinText(after.lines, after.br, after.final);
    if (move) {
      tree.now.set(to, text);
      tree.now.set(from, null);
      tree.moves.push({ old: from, new: to });
    } else {
      tree.now.set(from, text);
    }
  };
}

function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const paths = diffGitPaths(line);
      if (paths === null) throw new Exit2(`error: parse ${i + 1}`);
      const section = emptyUnifiedSection(paths[0], paths[1]);
      i = parseUnifiedSection(lines, i + 1, section);
      edits.push(unifiedEdit(section, strict));
      continue;
    }
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      const section = emptyUnifiedSection(null, null);
      i = parseUnifiedSection(lines, i, section);
      edits.push(unifiedEdit(section, strict));
      continue;
    }
    if (line.startsWith('@@')) throw new Exit2(`error: parse ${i + 1}`);
    i++;
  }
  return edits;
}

/** A SEARCH/REPLACE block's marker, with its trailing whitespace removed (section 7). */
const srMarker = (line: string): string => line.trimEnd();

function searchReplaceEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let previousPath: string | null = null;
  let after = 0;
  let i = 0;
  while (i < lines.length) {
    if (srMarker(lines[i]!) !== '<<<<<<< SEARCH') {
      i++;
      continue;
    }
    const search = i;
    let sep = -1;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const marker = srMarker(lines[j]!);
      if (marker === '>>>>>>> REPLACE') break;
      if (marker === '=======') {
        sep = j;
        break;
      }
    }
    if (sep < 0) throw new Exit2(`error: parse ${search + 1}`);
    let end = -1;
    for (j = sep + 1; j < lines.length; j++) {
      if (srMarker(lines[j]!) === '>>>>>>> REPLACE') {
        end = j;
        break;
      }
    }
    if (end < 0) throw new Exit2(`error: parse ${search + 1}`);
    let path: string | null = null;
    for (j = search - 1; j >= after; j--) {
      const text = lines[j]!.trim();
      if (text !== '' && !text.startsWith('```')) {
        path = text;
        break;
      }
    }
    if (path === null) path = previousPath;
    if (path === null) throw new Exit2(`error: parse ${search + 1}`);
    const oldLines = lines.slice(search + 1, sep);
    const newText = lines.slice(sep + 1, end);
    const at = path;
    if (oldLines.length === 0) {
      edits.push((tree) => {
        if (!safe(at)) throw new Fail('unsafe', at);
        if (tree.get(at) !== null) throw new Fail('exists', at);
        tree.now.set(at, createdText(newText));
      });
    } else {
      const replacement = newText.map((text): NewLine => ({ text, context: null }));
      edits.push((tree) => {
        if (!safe(at)) throw new Fail('unsafe', at);
        const before = tree.get(at);
        if (before === null) throw new Fail('missing', at);
        const file = splitText(before);
        const found = tierOf(file.lines, oldLines, strict);
        if (found === null) throw new Fail('no-match', at);
        if (found.at.length > 1) throw new Fail('ambiguous', at);
        const pos = found.at[0]!;
        const written = makeNewLines(replacement, file.lines.slice(pos, pos + oldLines.length), oldLines[0], found.tier);
        const out = [...file.lines.slice(0, pos), ...written, ...file.lines.slice(pos + oldLines.length)];
        tree.now.set(at, joinText(out, file.br, file.final));
      });
    }
    previousPath = path;
    after = end + 1;
    i = end + 1;
  }
  return edits;
}

/** A V4A update chunk: its anchor, whether `*** End of File` ended it, and its body (section 8). */
interface V4aChunk {
  anchor: string | null;
  eof: boolean;
  body: BodyLine[];
}

function isV4aSectionStart(line: string): boolean {
  return line.startsWith('*** Add File: ') || line.startsWith('*** Delete File: ') || line.startsWith('*** Update File: ');
}

function isV4aBodyLine(line: string): boolean {
  return line === '' || line.startsWith(' ') || line.startsWith('-') || line.startsWith('+');
}

function parseV4aChunk(lines: string[], start: number, end: number, anchor: string | null): { chunk: V4aChunk; next: number } {
  const body: BodyLine[] = [];
  let eof = false;
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    if (line.trimEnd() === '*** End of File') {
      eof = true;
      i++;
      break;
    }
    if (line.startsWith('@@')) break;
    if (line === '') {
      body.push({ kind: ' ', text: '' });
    } else if (line.startsWith(' ')) {
      body.push({ kind: ' ', text: line.slice(1) });
    } else if (line.startsWith('-')) {
      body.push({ kind: '-', text: line.slice(1) });
    } else if (line.startsWith('+')) {
      body.push({ kind: '+', text: line.slice(1) });
    } else {
      throw new Exit2(`error: parse ${i + 1}`);
    }
    i++;
  }
  return { chunk: { anchor, eof, body }, next: i };
}

/** Apply an update's chunks in order with a cursor, as section 8 says. */
function applyV4aChunks(file: TextFile, chunks: V4aChunk[], strict: boolean, path: string): TextFile {
  let cur = file.lines.slice();
  let cursor = 0;
  for (const chunk of chunks) {
    if (chunk.anchor !== null) {
      const hit = anchorLine(cur, chunk.anchor, cursor, strict);
      if (hit === null) throw new Fail('no-match', path);
      cursor = hit + 1;
    }
    const { o, n } = splitBody(chunk.body);
    let pos = 0;
    let tier = 0;
    let matched: string[] = [];
    if (o.length === 0) {
      pos = chunk.eof ? cur.length : cursor;
    } else {
      const found = tierFrom(cur, o, cursor, chunk.eof, strict);
      if (found === null) throw new Fail('no-match', path);
      tier = found.tier;
      pos = found.at[0]!;
      matched = cur.slice(pos, pos + o.length);
    }
    const written = makeNewLines(n, matched, o.length > 0 ? o[0] : undefined, tier);
    cur = [...cur.slice(0, pos), ...written, ...cur.slice(pos + o.length)];
    cursor = pos + written.length;
  }
  return { lines: cur, br: file.br, final: file.final };
}

/** One V4A Add/Delete/Update section as one edit (section 8). */
function v4aEdit(path: string, moveTo: string | null, chunks: V4aChunk[], strict: boolean): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (moveTo !== null && !safe(moveTo)) throw new Fail('unsafe', moveTo);
    const before = tree.get(path);
    if (before === null) throw new Fail('missing', path);
    if (moveTo !== null && tree.get(moveTo) !== null) throw new Fail('exists', moveTo);
    const after = applyV4aChunks(splitText(before), chunks, strict, path);
    const text = joinText(after.lines, after.br, after.final);
    if (moveTo === null) {
      tree.now.set(path, text);
    } else {
      tree.now.set(moveTo, text);
      tree.now.set(path, null);
      tree.moves.push({ old: path, new: moveTo });
    }
  };
}

function v4aEdits(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((line) => !blank(line));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = lines.length - 1;
  while (last >= 0 && blank(lines[last]!)) last--;
  if (last < 0 || lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      const path = line.slice('*** Add File: '.length).trim();
      let end = i + 1;
      while (end < last && !isV4aSectionStart(lines[end]!)) end++;
      let stop = end;
      while (stop > i + 1 && blank(lines[stop - 1]!)) stop--;
      const content: string[] = [];
      for (let k = i + 1; k < stop; k++) {
        const body = lines[k]!;
        if (body.startsWith('+')) content.push(body.slice(1));
        else if (body === '') content.push('');
        else throw new Exit2(`error: parse ${k + 1}`);
      }
      const at = path;
      edits.push((tree) => {
        if (!safe(at)) throw new Fail('unsafe', at);
        if (tree.get(at) !== null) throw new Fail('exists', at);
        tree.now.set(at, createdText(content));
      });
      i = end;
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      const path = line.slice('*** Delete File: '.length).trim();
      let end = i + 1;
      while (end < last && !isV4aSectionStart(lines[end]!)) end++;
      for (let k = i + 1; k < end; k++) {
        if (!blank(lines[k]!)) throw new Exit2(`error: parse ${k + 1}`);
      }
      const at = path;
      edits.push((tree) => {
        if (!safe(at)) throw new Fail('unsafe', at);
        if (tree.get(at) === null) throw new Fail('missing', at);
        tree.now.set(at, null);
      });
      i = end;
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const path = line.slice('*** Update File: '.length).trim();
      let end = i + 1;
      while (end < last && !isV4aSectionStart(lines[end]!)) end++;
      let start = i + 1;
      let moveTo: string | null = null;
      if (start < end && lines[start]!.startsWith('*** Move to: ')) {
        moveTo = lines[start]!.slice('*** Move to: '.length).trim();
        start++;
      }
      let stop = end;
      while (stop > start && blank(lines[stop - 1]!)) stop--;
      const chunks: V4aChunk[] = [];
      let k = start;
      while (k < stop) {
        const chunkLine = lines[k]!;
        let anchor: string | null = null;
        if (chunkLine.startsWith('@@')) {
          const text = chunkLine.slice(2).trim();
          anchor = text === '' ? null : text;
          k++;
        } else if (chunks.length > 0 || !isV4aBodyLine(chunkLine)) {
          throw new Exit2(`error: parse ${k + 1}`);
        }
        const parsed = parseV4aChunk(lines, k, stop, anchor);
        chunks.push(parsed.chunk);
        k = parsed.next;
      }
      if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${i + 1}`);
      edits.push(v4aEdit(path, moveTo, chunks, strict));
      i = end;
      continue;
    }
    throw new Exit2(`error: parse ${i + 1}`);
  }
  return edits;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits =
      kind === 'json'
        ? jsonEdits(text, lines)
        : kind === 'unified'
          ? unifiedEdits(lines, strict)
          : kind === 'search-replace'
            ? searchReplaceEdits(lines, strict)
            : v4aEdits(lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const movesBefore = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      tree.moves.length = movesBefore;
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const rows: string[] = [];
  const movedFrom = new Map<string, string>();
  const movedAway = new Set<string>();
  for (const move of tree.moves) {
    if (tree.original(move.old) !== null && tree.get(move.old) === null && tree.original(move.new) === null && tree.get(move.new) !== null) {
      movedFrom.set(move.new, move.old);
      movedAway.add(move.old);
    }
  }
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    const from = movedFrom.get(p);
    if (!movedAway.has(p)) {
      if (from !== undefined) rows.push(`R ${from} -> ${p}`);
      else if (was !== now) rows.push(`${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}`);
    }
    if (was === now) continue;
    if (check) continue;
    if (now === null) rmSync(p, { force: true });
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, now);
    }
  }
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
