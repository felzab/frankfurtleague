---
description: Scan the last code block for deprecated patterns and give replacements
argument-hint: "[optional: file path or scope to scan instead]"
---

Scan for deprecated patterns and provide the modern replacement for each.

**Target:** `$ARGUMENTS` if provided (a file, directory, or described scope). Otherwise the most recent code block in this conversation.

**Check against:**
1. Every ❌ entry in the `CLAUDE.md` §2 deprecated table.
2. Patterns that are generally deprecated in this stack even if absent from that table — the table is a floor, not a ceiling.

**Output:** one row per finding — Pattern found | Location (`file:line` where applicable) | Required replacement | Why it changed.

If nothing is found, say so in one line. Do not invent findings to fill the table.

If a fix is non-mechanical (changes behavior, not just syntax), flag it separately as needing review rather than presenting it as a drop-in swap.
