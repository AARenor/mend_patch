# Specification checklist

1. Invocation: paths are relative to cwd; patch comes from a file or stdin when absent or `-`.
2. Formats are auto, unified, search-replace, v4a and json; check suppresses writes only; strict uses tier 0 only.
3. Options and patch can be interleaved; `--` ends options; unknown or duplicate options, invalid format and multiple positional arguments are usage errors.
4. Output consists only of LF-terminated lines. Usage, unreadable patch, undetectable format and parse errors exit 2 in that precedence; parse precedes file access; zero edits is parse 1.
5. Failed edits exit 1, with one `error: code path` per failure in patch order and `failed: k of n edits`; codes are no-match, ambiguous, missing, exists and unsafe, with the concerned path.
6. Success lists changed paths in UTF-8 byte order as A, D or M; eligible moves replace D and A with R sorted by destination; then `ok: n files` or `ok: 1 file`. Unchanged bytes are not listed.
7. Paths are unsafe if empty, absolute, contain backslashes or have empty, dot or dot-dot segments; create needed directories.
8. Files use CRLF if the first LF follows CR, otherwise LF; split on that break, discard final empty piece, and represent an empty file as no lines without final break.
9. Changed files keep their line break and final-break state except for unified hunks; created files use LF and a final break except where format says otherwise; JSON create is byte-for-byte.
10. Patch lines split on LF, strip one trailing CR and discard the final empty piece after LF; line numbers are one-based.
11. Auto detects V4A on trimmed first nonblank Begin Patch, then JSON on first nonwhitespace character `[` or `{`, then SEARCH marker with trailing whitespace removed, then unified diff header; otherwise format error.
12. Matching tries exact, then trailing spaces/tabs stripped, then leading and trailing spaces/tabs stripped; strict stops after exact. Overlapping occurrences count.
13. Context lines retain the matched file line. At tier 2 nonblank replacement lines beginning with the old first line's indentation get it replaced by the matched first line's indentation; other lines stay unchanged.
14. Unified sections start with diff --git or paired ---/+++; headers name old/new paths before first hunk, trim surrounding spaces, cut at first tab and remove a/ or b/; /dev/null means absent.
15. Rename headers name paths when no pair does; modes mark creation/deletion; diff paths are fallbacks; other metadata is ignored.
16. Unpaired --- in a section header errors on the next line; malformed diff --git errors on its own line.
17. Unified hunk headers require @@ -A[,B] +C[,D] @@; malformed @@ or hunk before section errors on its line; B and D do not affect matching.
18. Hunk bodies contain context, minus, plus, backslash and empty lines; end at other lines, diff header, paired file headers or EOF; trailing empty body lines are excluded; prose and fences outside are ignored.
19. A unified section is one edit: creation requires absent target and uses all plus lines; deletion requires existing source and ignores hunks; move requires existing source and absent destination and applies hunks; change requires existing path.
20. Hunks apply in order; d accumulates line count changes. Nonempty old lines choose the occurrence at the first matching tier nearest A-1+d, ties earlier. Empty old lines insert after A+d lines, clamped to file length.
21. Backslash lines refer to previous body line. An end-reaching hunk ends with a break unless a backslash follows its last context or plus; otherwise preserve the previous final break. Creation follows the last plus marker.
22. A failing unified hunk fails the whole section without changes.
23. SEARCH markers ignore trailing whitespace. The path is the nearest nonblank non-fence line since the previous block, trimmed, or the previous path if none; missing first path errors on SEARCH line.
24. SEARCH without separator and closing marker errors on SEARCH line; other outside lines ignored. Each block is one edit; empty old creates, otherwise file must exist and first matching tier must have exactly one occurrence.
25. V4A requires trimmed Begin Patch as first nonblank line and End Patch as last; errors name first nonblank or line count plus one respectively. Trailing blank lines in sections are excluded; between sections blank lines are ignored.
26. V4A section headers are Add, Delete and Update with trimmed paths. Add accepts plus lines and empty lines; Delete has no lines; anything else errors at its line.
27. Update allows a first Move to line then chunks. Chunks start at @@ anchor or first body line; body lines are context, minus, plus or empty. End of File ends and end-anchors a chunk. No chunk and no move errors at Update line.
28. V4A add requires absent path, writes LF and final break; delete requires existing path. Update requires source and absent move target; checks safety first.
29. V4A anchor finds the first matching line at or after cursor at the first matching tier and advances past it. Chunk old lines take first occurrence at or after cursor at first matching tier; EOF restricts to occurrences ending at EOF.
30. Empty V4A old lines insert at cursor or EOF for EOF chunks. Cursor moves past written lines. Move writes result to target and deletes source.
31. JSON accepts an array or JSON Lines; array errors name its starting line, JSON Lines errors name the bad line; unknown keys ignored. Empty edits are parse 1.
32. JSON create requires string path and file_text and absent file; writes text exactly.
33. JSON str_replace requires nonempty old_str and optional string new_str, existing file, exactly one overlapping-aware exact occurrence; CRLF normalizes all CRLF to LF for matching then restores CRLF.
34. JSON insert requires integer position in [0, line count] and string new_str; split insertion like patch lines; preserve original final break.
35. Wrong JSON command or missing/mistyped required key is a parse fault.
36. Edits see earlier successful changes. Check every path in an edit for safety before anything else; a failed edit rolls back and later edits still run. Any failure prevents all writes; check prevents writes even on success.

## Hardening baseline and interpretation

- Baseline commands: `node check.ts /tmp/kit_mend/hidden-spec-cli-01-run-20261122-kit/program/generator/practice.json`
  passed 100/100; `node tests/run.ts` passed 215/215.
- The first coverage expansion exercises invocation, precedence, JSON validation,
  unsafe segments, UTF-8 sorting, mixed line breaks, and all three matching tiers
  independently in unified, SEARCH/REPLACE and V4A.
- No original test has been weakened. Two new fixture expectations were corrected
  to the specification: a standalone `[]` is array form with no edits (`parse 1`,
  §§2/9), not a bad JSON Lines object; an old line containing a literal trailing
  CR requires two CRs before the patch LF because §3 removes exactly one.
- Safety is the lexical predicate in §3. The specification does not mention
  symlinks; no additional symlink refusal or error code is invented.
