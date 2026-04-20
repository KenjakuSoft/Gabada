import csv
import io

import httpx
import openpyxl
import pdfplumber
from fastapi import APIRouter, File, HTTPException, UploadFile

from api.product_service import create_product_with_store
from database.db import get_db
from database.models import (
    FileImportCommitRequest,
    FileImportPreviewResponse,
    WooImportRequest,
    WooPreviewRequest,
    WooProductPreview,
)

router = APIRouter(prefix="/import", tags=["import"])


def _map_woo_stock(status: str) -> str:
    return {
        "instock": "in_stock",
        "outofstock": "out_of_stock",
        "onbackorder": "limited",
    }.get(status, "unknown")


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
    for product in resp.json():
        images = product.get("images", [])
        result.append(
            WooProductPreview(
                woo_id=product["id"],
                name=product["name"],
                permalink=product["permalink"],
                regular_price=product.get("regular_price") or None,
                sale_price=product.get("sale_price") or None,
                stock_status=_map_woo_stock(
                    product.get("stock_status", "outofstock")
                ),
                image_url=images[0]["src"] if images else None,
                categories=[category["name"] for category in product.get("categories", [])],
            )
        )
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
                    "include": ",".join(str(product_id) for product_id in body.product_ids),
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
        for product in resp.json():
            images = product.get("images", [])
            await create_product_with_store(
                db,
                canonical_name=product["name"],
                image_url=images[0]["src"] if images else None,
                category_id=None,
                store_id=body.store_id,
                product_url=product["permalink"],
            )
            imported += 1
        await db.commit()
    finally:
        await db.close()

    return {"imported": imported}


def _to_str(value) -> str:
    return str(value) if value is not None else ""


@router.post("/file/preview", response_model=FileImportPreviewResponse)
async def file_preview(file: UploadFile = File(...)):
    content = await file.read()
    filename = (file.filename or "").lower()

    if filename.endswith(".csv"):
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

    if filename.endswith((".xlsx", ".xls")):
        workbook = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        worksheet = workbook.active
        all_rows = list(worksheet.iter_rows(values_only=True))
        if not all_rows:
            raise HTTPException(400, "Empty spreadsheet")
        return FileImportPreviewResponse(
            columns=[_to_str(cell) for cell in all_rows[0]],
            sample_rows=[[_to_str(cell) for cell in row] for row in all_rows[1:6]],
            total_rows=len(all_rows) - 1,
            file_format="excel",
        )

    if filename.endswith(".pdf"):
        rows: list[list] = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                table = page.extract_table()
                if table:
                    rows.extend(table)
        if not rows:
            raise HTTPException(400, "No table found in PDF")
        return FileImportPreviewResponse(
            columns=[_to_str(cell) for cell in rows[0]],
            sample_rows=[[_to_str(cell) for cell in row] for row in rows[1:6]],
            total_rows=len(rows) - 1,
            file_format="pdf",
        )

    raise HTTPException(400, "Unsupported format - use .csv, .xlsx, or .pdf")


@router.post("/file/commit")
async def file_commit(body: FileImportCommitRequest):
    db = await get_db()
    imported = 0
    try:
        for row in body.rows:
            await create_product_with_store(
                db,
                canonical_name=row.name,
                image_url=row.image_url,
                category_id=body.category_id,
                store_id=body.store_id,
                product_url=row.url,
            )
            imported += 1
        await db.commit()
    finally:
        await db.close()

    return {"imported": imported}
