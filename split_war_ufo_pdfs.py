from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader, PdfWriter

BASE = Path("/Users/adam/Desktop/AI Projects/DOW:UFO")
CHUNK_SIZE = 20
LOG_PATH = BASE / "war_ufo_split_log.json"


def is_pdf(path: Path) -> bool:
    try:
        return path.read_bytes()[:4] == b"%PDF"
    except OSError:
        return False


def safe_folder_name(stem: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._ -]+", "_", stem).strip(" ._")
    return stem or "untitled"


def existing_chunks_ok(folder: Path, stem: str, pages: int) -> bool:
    expected = []
    for start in range(0, pages, CHUNK_SIZE):
        end = min(start + CHUNK_SIZE, pages)
        expected.append(folder / f"{stem}_pages_{start + 1:03d}-{end:03d}.pdf")
    return bool(expected) and all(path.exists() and is_pdf(path) for path in expected)


def split_pdf(pdf_path: Path) -> dict:
    stem = pdf_path.stem
    out_dir = BASE / safe_folder_name(stem)
    out_dir.mkdir(exist_ok=True)

    reader = PdfReader(str(pdf_path))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            pass

    page_count = len(reader.pages)
    if existing_chunks_ok(out_dir, stem, page_count):
        print(f"exists {pdf_path.name}: {page_count} pages")
        return {
            "file": pdf_path.name,
            "status": "exists",
            "pages": page_count,
            "chunks": len(list(out_dir.glob(f"{stem}_pages_*.pdf"))),
            "folder": str(out_dir),
        }

    for old in out_dir.glob(f"{stem}_pages_*.pdf"):
        old.unlink()

    chunks = 0
    for start in range(0, page_count, CHUNK_SIZE):
        end = min(start + CHUNK_SIZE, page_count)
        writer = PdfWriter()
        for page_index in range(start, end):
            writer.add_page(reader.pages[page_index])

        out_path = out_dir / f"{stem}_pages_{start + 1:03d}-{end:03d}.pdf"
        tmp_path = out_path.with_suffix(".pdf.part")
        with tmp_path.open("wb") as f:
            writer.write(f)
        tmp_path.rename(out_path)
        chunks += 1

    print(f"split {pdf_path.name}: {page_count} pages -> {chunks} chunks")
    return {
        "file": pdf_path.name,
        "status": "split",
        "pages": page_count,
        "chunks": chunks,
        "folder": str(out_dir),
    }


def main() -> None:
    pdfs = sorted(path for path in BASE.glob("*.pdf") if is_pdf(path))
    print(f"Splitting {len(pdfs)} PDFs from {BASE}")

    results = []
    failures = []
    for index, pdf_path in enumerate(pdfs, 1):
        print(f"[{index}/{len(pdfs)}] {pdf_path.name}")
        try:
            result = split_pdf(pdf_path)
            results.append(result)
        except Exception as exc:
            failure = {"file": pdf_path.name, "status": "failed", "error": str(exc)}
            failures.append(failure)
            results.append(failure)
            print(f"FAILED {pdf_path.name}: {exc}")
        LOG_PATH.write_text(json.dumps({"results": results}, indent=2), encoding="utf-8")

    summary = {
        "total": len(pdfs),
        "split_or_exists": len([r for r in results if r["status"] in {"split", "exists"}]),
        "failed": len(failures),
        "results": results,
    }
    LOG_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "results"}, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
