#!/usr/bin/env python3
"""Сборка файла морфологического словаря для Gena (`public/morph/ru-morph-v1.json`).

Откуда данные:
  * `pymorphy3` — морфология (словарь OpenCorpora, CC BY-SA 3.0);
  * `wordfreq` — частотный список русского (CC BY-SA 4.0), берём верхние N слов;
  * дополнительно — слова из документов репозитория и рабочего корпуса, чтобы
    закрыть домен («вклад», «облигация», «полис», «брокер» и т. п.).

Установка в venv (разово):
    python3 -m venv .venv-morph
    .venv-morph/bin/pip install pymorphy3 pymorphy3-dicts-ru wordfreq

Запуск из корня репозитория:
    .venv-morph/bin/python scripts/gen-morph.py
    TOP_WORDS=60000 .venv-morph/bin/python scripts/gen-morph.py   # шире словарь

Формат результата описан в `src/lib/tokens/morph/format.ts`; пересобранный файл
нужно закоммитить — приложение качает его с собственного адреса.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

CASES = ["nomn", "gent", "datv", "accs", "ablt", "loct"]
GENDERS = ["masc", "femn", "neut"]

REPO = Path(__file__).resolve().parent.parent
TOP_WORDS = int(os.environ.get("TOP_WORDS", "40000"))
OUT = Path(os.environ.get("OUT", REPO / "public" / "morph" / "ru-morph-v1.json"))

# Документы репозитория и, если есть, рабочий корпус ассистента.
CORPUS_DIRS = [
    REPO / "docs",
    Path("/root/.picoclaw/workspace/memory"),
    Path("/root/.picoclaw/workspace/reports"),
]

WORD_RE = re.compile(r"[А-Яа-яЁё][А-Яа-яЁё-]{1,30}")


def corpus_words(limit_files: int = 400) -> set[str]:
    seen: set[str] = set()
    files: list[Path] = []
    for root in CORPUS_DIRS:
        if not root.is_dir():
            continue
        for path in root.rglob("*.md"):
            files.append(path)
    for path in files[:limit_files]:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        seen.update(word.lower() for word in WORD_RE.findall(text))
    return seen


def build_entry(parse) -> dict | None:
    """Собрать формы одной парадигмы: 12 слотов у существительного, 24 у прилагательного."""
    lexeme = parse.lexeme
    if parse.tag.POS == "NOUN":
        forms: list[str | None] = [None] * 12
        for form in lexeme:
            tag = form.tag
            if tag.POS != "NOUN" or tag.case not in CASES or not tag.number:
                continue
            slot = CASES.index(tag.case) + (0 if tag.number == "sing" else 6)
            if forms[slot] is None:
                forms[slot] = form.word
        if not any(forms):
            return None
        gender = parse.tag.gender
        return {"p": "N", "g": gender[0] if gender in GENDERS else "", "f": forms}

    if parse.tag.POS == "ADJF":
        forms = [None] * 24
        for form in lexeme:
            tag = form.tag
            if tag.POS != "ADJF" or tag.case not in CASES or not tag.number:
                continue
            case_index = CASES.index(tag.case)
            if tag.number == "sing":
                if tag.gender not in GENDERS:
                    continue
                slot = case_index * 3 + GENDERS.index(tag.gender)
            else:
                slot = 18 + case_index
            if forms[slot] is None:
                forms[slot] = form.word
        if not any(forms):
            return None
        return {"p": "A", "f": forms}

    return None


def main() -> int:
    import pymorphy3
    from wordfreq import top_n_list

    started = time.time()
    frequent = top_n_list("ru", TOP_WORDS)
    corpus = corpus_words()
    vocabulary = list(dict.fromkeys([*frequent, *sorted(corpus)]))
    print(
        f"источник: частотных {len(frequent)}, корпус {len(corpus)}, всего {len(vocabulary)}",
        flush=True,
    )

    morph = pymorphy3.MorphAnalyzer()
    lemmas: dict[str, dict] = {}
    for index, word in enumerate(vocabulary):
        if index % 5000 == 0:
            print(f"  {index}/{len(vocabulary)} лемм={len(lemmas)}", flush=True)
        if word in lemmas:
            continue
        # Две трактовки: у «деньги» первая форма — множественное число, у «очки»
        # первая может быть формой другого слова.
        for parse in morph.parse(word)[:2]:
            if parse.tag.POS not in ("NOUN", "ADJF"):
                continue
            lemma = parse.normal_form
            if lemma in lemmas:
                break
            entry = build_entry(parse)
            if entry:
                lemmas[lemma] = entry
            break

    data = {
        "format": "gena.morph",
        "version": 1,
        "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": f"pymorphy3 / OpenCorpora; wordfreq top-{TOP_WORDS}; домен word list",
        "license": "формы: OpenCorpora (CC BY-SA 3.0), частоты: wordfreq (CC BY-SA 4.0)",
        "cases": CASES,
        "lemmas": lemmas,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        encoding="utf-8",
    )

    size = OUT.stat().st_size
    nouns = sum(1 for entry in lemmas.values() if entry["p"] == "N")
    print(f"лемм: {len(lemmas)} (сущ {nouns}, прил {len(lemmas) - nouns})")
    print(f"файл: {OUT} — {size / 1024 / 1024:.2f} МиБ")
    print(f"время: {time.time() - started:.1f} c")
    return 0


if __name__ == "__main__":
    sys.exit(main())
