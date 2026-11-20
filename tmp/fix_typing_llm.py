"""Разделить ключ chat.typing: базовый (агент) и chat.typing.llm (LLM-модель)."""

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

changed = []
for p in sorted((ROOT / "src" / "i18n").glob("*/chat.ts")):
    txt = p.read_text(encoding="utf-8")
    m = re.search(r'^(\s*)"chat\.typing":\s*"(.*)",\s*$', txt, re.M)
    if not m:
        continue
    indent, value = m.group(1), m.group(2)
    if not value.endswith(" (LLM)"):
        print(f"skip (нет пометки): {p}")
        continue
    base = value[: -len(" (LLM)")]
    repl = (
        f'{indent}"chat.typing": "{base}",\n'
        f'{indent}"chat.typing.llm": "{value}",'
    )
    txt = txt[: m.start()] + repl + txt[m.end():]
    p.write_text(txt, encoding="utf-8")
    changed.append(p.parent.name)

print("обновлено:", ", ".join(changed))
