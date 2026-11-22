# mend

mend applies AI-written edits to a tree of text files. It supports unified diffs, SEARCH/REPLACE blocks, V4A patches, and JSON text-editor calls, with whitespace-tolerant matching and all-or-nothing writes. The complete behavior is specified in [SPEC.md](SPEC.md).

## Run

With Node.js 22, run `node main.ts [--format=NAME] [--check] [--strict] [PATCH]` from the tree's root. Omit PATCH or use `-` to read standard input. Formats are `auto`, `unified`, `search-replace`, `v4a`, and `json`. Use `--check` to preview without writing or `--strict` for exact line matching only.

Run the independent tests with `node tests/run.ts`. The kit's public checks can be run with `node check.ts <path-to-practice.json>`.

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/AARenor/mend_patch/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/AARenor/mend_patch/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122)
