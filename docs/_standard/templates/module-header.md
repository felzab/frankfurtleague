# Module header

**Shape:** INC-2 in [`../chapters/2-in-code.md`](../chapters/2-in-code.md). Copy the matching block
to the top of the file and delete everything else on this page.

A header survives in a **shell script**, and in a Python module under `fl_backend/app/` or
`scripts/` carrying a module-scope fact that attaches to no symbol. TypeScript, TSX, JavaScript and
Python test modules carry none — a comment sits at the thing it explains. Either shape is capped at
twenty lines including the delimiters.

**Shell:**

```sh
#!/usr/bin/env bash
#
# <TOKEN> · <what this script is>
#
# <At most three sentences, why-first: the one thing a reader must know before running it.>
```

**Python.** The docstring is the file's first statement, above the imports, and opens on its title
line with a blank line after it:

```python
"""
<TOKEN> · <what this module is>

<At most three sentences, why-first.>

Invariants:
- <something true of this module that a reasonable change could violate silently>

See:
- <the spec sheet or related module worth pointing at, or drop the list>
"""

<the imports start here, below the docstring>
```

\<Drop `Invariants:` or `See:` where it would hold nothing, and cite only a file that exists.\>
