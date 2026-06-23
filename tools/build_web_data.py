# -*- coding: utf-8 -*-
"""从完整报价表生成可公开发布的脱敏网页数据。"""

import json
from datetime import datetime
from pathlib import Path

import pandas as pd


WEB_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = WEB_ROOT.parent
SOURCE = PROJECT_ROOT / "报价" / "报价" / "报价.xlsx"
DATA_DIR = WEB_ROOT / "data"


def text(value):
    if pd.isna(value):
        return ""
    return str(value).strip()


def first_value(series):
    for value in series:
        value = text(value)
        if value:
            return value
    return ""


def build_records(source):
    required = {"电池型号", "电芯尺寸"}
    missing = required - set(source.columns)
    if missing:
        raise ValueError(f"报价表缺少标题：{'、'.join(sorted(missing))}")

    frame = source.copy()
    for column in ["电池型号", "电芯尺寸", "外观", "容量", "单价"]:
        if column not in frame.columns:
            frame[column] = ""
        frame[column] = frame[column].map(text)

    frame = frame[frame["电池型号"] != ""].copy()
    frame["型号键"] = frame["电池型号"].str.replace(" ", "", regex=False).str.lower()

    appearance_by_size = {}
    for size, group in frame[frame["电芯尺寸"] != ""].groupby("电芯尺寸", sort=False):
        appearance_by_size[size] = first_value(group["外观"])

    records = []
    for key, group in frame.groupby("型号键", sort=False):
        sizes = group.loc[group["电芯尺寸"] != "", "电芯尺寸"]
        size = sizes.value_counts().index[0] if not sizes.empty else ""
        records.append({
            "model": first_value(group["电池型号"]),
            "key": key,
            "size": size,
            "appearance": appearance_by_size.get(size, first_value(group["外观"])),
            "capacity": first_value(group["容量"]),
            "price": first_value(group["单价"]),
        })

    records.sort(key=lambda row: row["key"])
    return records


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    source = pd.read_excel(SOURCE, dtype=str)
    records = build_records(source)
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")

    payload = {
        "generatedAt": generated_at,
        "source": "网页报价数据.xlsx",
        "count": len(records),
        "records": records,
    }
    (DATA_DIR / "quotes.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    public_table = pd.DataFrame([
        {
            "电池型号": row["model"],
            "电芯尺寸": row["size"],
            "外观": row["appearance"],
            "容量": row["capacity"],
            "单价": row["price"],
        }
        for row in records
    ])
    public_table.to_excel(DATA_DIR / "网页报价数据.xlsx", index=False)
    print(f"已生成 {len(records)} 条脱敏网页报价数据：{DATA_DIR}")


if __name__ == "__main__":
    main()
