import io
import csv

import httpx
import openpyxl
import pdfplumber
from fastapi import APIRouter, HTTPException, UploadFile, File

from database.db import get_db
from database.models import (
    WooProductPreview,
    WooPreviewRequest,
    WooImportRequest,
    FileImportPreviewResponse,
    FileImportCommitRequest,
)

router = APIRouter(prefix="/import", tags=["import"])


def _map_woo_stock(status: str) -> str:
    return {
        "instock": "in_stock",
        "outofstock": "out_of_stock",
        "onbackorder": "limited",
    }.get(status, "unknown")


# ── WooCommerce ────────────────────────────────────────────────────────────────

@router.post("/woo/preview", response_model=list[WooProductPreview])
async def woo_preview(body: WooPreviewRequest):
    url = f"{body.credentials.site_url.rstrip('/')}/wp-json/wc/v3/products"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                url,
                auth=(body.credentials.consumer_key, body.credentials.consumer_secret),
                params={"per_page": body.per_page, "page": body.page},
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach WooCommerce: {exc}")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="WooCommerce API error")

    result = []
    for p in resp.json():
        images = p.get("images", [])
        result.append(WooProductPreview(
            woo_id=p["id"],
            name=p["name"],
            permalink=p["permalink"],
            regular_price=p.get("regular_price") or None,
            sale_price=p.get("sale_price") or None,
            stock_status=_map_woo_stock(p.get("stock_status", "outofstock")),
            image_url=images[0]["src"] if images else None,
            categories=[c["name"] for c in p.get("categories", [])],
        ))
    return result


@router.post("/woo/import")
async def woo_import(body: WooImportRequest):
    url = f"{body.credentials.site_url.rstrip('/')}/wp-json/wc/v3/products"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                url,
                auth=(body.credentials.consumer_key, body.credentials.consumer_secret),
                params={
                    "include": ",".join(str(i) for i in body.product_ids),
                    "per_page": 100,
                },
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach WooCommerce: {exc}")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="WooCommerce API error")

    db = await get_db()
    imported = 0
    try:
        for p in resp.json():
            images = p.get("images", [])
            cur = await db.execute(
                "INSERT INTO products (canonical_name, image_url) VALUES (?, ?)",
                (p["name"], images[0]["src"] if images else None),
            )
            await db.execute(
                "INSERT INTO product_stores (product_id, store_id, product_url) VALUES (?, ?, ?)",
                (cur.lastrowid, body.store_id, p["permalink"]),
            )
            imported += 1
        await db.commit()
    finally:
        await db.close()

    return {"imported": imported}


# ── File Import ────────────────────────────────────────────────────────────────

def _to_str(v) -> str:
    return str(v) if v is not None else ""


@router.post("/file/preview", response_model=FileImportPreviewResponse)
async def file_preview(file: UploadFile = File(...)):
    content = await file.read()
    fname = (file.filename or "").lower()

    if fname.endswith(".csv"):
        text = content.decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(text)))
        if not rows:
            raise HTTPException(400, "Empty CSV file")
        return FileImportPreviewResponse(
            columns=rows[0],
            sample_rows=rows[1:6],
            total_rows=len(rows) - 1,
            file_format="csv",
        )

    if fname.endswith((".xlsx", ".xls")):
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
        if not all_rows:
            raise HTTPException(400, "Empty spreadsheet")
        return FileImportPreviewResponse(
            columns=[_to_str(c) for c in all_rows[0]],
            sample_rows=[[_to_str(c) for c in row] for row in all_rows[1:6]],
            total_rows=len(all_rows) - 1,
            file_format="excel",
        )

    if fname.endswith(".pdf"):
        rows: list[list] = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                tbl = page.extract_table()
                if tbl:
                    rows.extend(tbl)
        if not rows:
            raise HTTPException(400, "No table found in PDF")
        return FileImportPreviewResponse(
            columns=[_to_str(c) for c in rows[0]],
            sample_rows=[[_to_str(c) for c in row] for row in rows[1:6]],
            total_rows=len(rows) - 1,
            file_format="pdf",
        )

    raise HTTPException(400, "Unsupported format — use .csv, .xlsx, or .pdf")


@router.post("/file/commit")
async def file_commit(body: FileImportCommitRequest):
    db = await get_db()
    imported = 0
    try:
        for row in body.rows:
            cur = await db.execute(
                "INSERT INTO products (canonical_name, image_url, category_id) VALUES (?, ?, ?)",
                (row.name, row.image_url, body.category_id),
            )
            await db.execute(
                "INSERT INTO product_stores (product_id, store_id, product_url) VALUES (?, ?, ?)",
                (cur.lastrowid, body.store_id, row.url),
            )
            imported += 1
        await db.commit()
    finally:
        await db.close()

    return {"imported": imported}
