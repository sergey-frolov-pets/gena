import pathlib

units = {
    "ar": ("س", "د", "ث"),
    "de": ("Std.", "Min.", "Sek."),
    "en": ("h", "min", "s"),
    "es": ("h", "min", "s"),
    "hi": ("घं", "मि", "से"),
    "ja": ("時間", "分", "秒"),
    "pt": ("h", "min", "s"),
    "ru": ("ч", "мин", "с"),
    "zh": ("时", "分", "秒"),
}

root = pathlib.Path("src/i18n")
for loc, (h, m, s) in units.items():
    p = root / loc / "chat.ts"
    text = p.read_text(encoding="utf-8")
    if '"chat.time.h"' in text:
        continue
    anchor = None
    for line in text.splitlines():
        if '"chat.typing.llm"' in line:
            anchor = line
            break
    if anchor is None:
        raise SystemExit(f"anchor not found in {p}")
    added = (
        anchor
        + '\n  "chat.time.h": "%s",' % h
        + '\n  "chat.time.m": "%s",' % m
        + '\n  "chat.time.s": "%s",' % s
    )
    text = text.replace(anchor, added, 1)
    p.write_text(text, encoding="utf-8")
    print("ok", loc)
