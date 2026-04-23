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

_WOO_API_MAX_PER_PAGE = 100


def _map_woo_stock(status: str) -> str:
    return {
        "instock": "in_stock",
        "outofstock": "out_of_stock",
        "onbackorder": "limited",
    }.get(status, "unknown")


def _woo_products_url(site_url: str) -> str:
    return f"{site_url.rstrip('/')}/wp-json/wc/v3/products"


def _woo_per_page(value: int) -> int:
    return max(1, min(value, _WOO_API_MAX_PER_PAGE))


def _chunked(values: list[int], size: int) -> list[list[int]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def _woo_total_pages(resp: httpx.Response) -> int | None:
    raw = resp.headers.get("X-WP-TotalPages")
    if not raw:
        return None
    try:
        return max(1, int(raw))
    except ValueError:
        return None


def _woo_preview_item(product: dict) -> WooProductPreview:
    images = product.get("images", [])
    return WooProductPreview(
        woo_id=product["id"],
        name=product["name"],
        permalink=product["permalink"],
        regular_price=product.get("regular_price") or None,
        sale_price=product.get("sale_price") or None,
        stock_status=_map_woo_stock(product.get("stock_status", "outofstock")),
        image_url=images[0]["src"] if images else None,
        categories=[category["name"] for category in product.get("categories", [])],
    )


async def _woo_get_products(
    client: httpx.AsyncClient,
    *,
    site_url: str,
    consumer_key: str,
    consumer_secret: str,
    params: dict,
) -> httpx.Response:
    try:
        resp = await client.get(
            _woo_products_url(site_url),
            auth=(consumer_key, consumer_secret),
            params=params,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach WooCommerce: {exc}")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="WooCommerce API error")
    return resp


async def _woo_fetch_preview_products(body: WooPreviewRequest) -> list[WooProductPreview]:
    per_page = _woo_per_page(body.per_page)
    async with httpx.AsyncClient(timeout=30) as client:
        if not body.fetch_all:
            resp = await _woo_get_products(
                client,
                site_url=body.credentials.site_url,
                consumer_key=body.credentials.consumer_key,
                consumer_secret=body.credentials.consumer_secret,
                params={"per_page": per_page, "page": max(1, body.page)},
            )
            return [_woo_preview_item(product) for product in resp.json()]

        previews: list[WooProductPreview] = []
        page = 1
        total_pages: int | None = None

        while True:
            resp = await _woo_get_products(
                client,
                site_url=body.credentials.site_url,
                consumer_key=body.credentials.consumer_key,
                consumer_secret=body.credentials.consumer_secret,
                params={"per_page": per_page, "page": page},
            )
            products = resp.json()
            previews.extend(_woo_preview_item(product) for product in products)

            if total_pages is None:
                total_pages = _woo_total_pages(resp)
            if total_pages is not None and page >= total_pages:
                break
            if len(products) < per_page:
                break
            page += 1

        return previews


async def _woo_fetch_products_by_ids(body: WooImportRequest) -> list[dict]:
    product_ids = list(dict.fromkeys(body.product_ids))
    if not product_ids:
        return []

    products_by_id: dict[int, dict] = {}
    async with httpx.AsyncClient(timeout=30) as client:
        for chunk in _chunked(product_ids, _WOO_API_MAX_PER_PAGE):
            resp = await _woo_get_products(
                client,
                site_url=body.credentials.site_url,
                consumer_key=body.credentials.consumer_key,
                consumer_secret=body.credentials.consumer_secret,
                params={
                    "include": ",".join(str(product_id) for product_id in chunk),
                    "per_page": len(chunk),
                },
            )
            for product in resp.json():
                products_by_id[product["id"]] = product

    return [products_by_id[product_id] for product_id in product_ids if product_id in products_by_id]


@router.post("/woo/preview", response_model=list[WooProductPreview])
async def woo_preview(body: WooPreviewRequest):
    return await _woo_fetch_preview_products(body)


@router.post("/woo/import")
async def woo_import(body: WooImportRequest):
    products = await _woo_fetch_products_by_ids(body)

    db = await get_db()
    imported = 0
    try:
        for product in products:
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
