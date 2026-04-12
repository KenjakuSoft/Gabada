from fastapi import APIRouter, HTTPException
from database.db import get_db
from database.models import Store, StoreCreate

router = APIRouter(prefix="/stores", tags=["stores"])


@router.get("/", response_model=list[Store])
async def list_stores():
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, name, base_url, created_at FROM stores ORDER BY name"
        )
        return [Store(**dict(r)) for r in rows]
    finally:
        await db.close()


@router.post("/", response_model=Store, status_code=201)
async def create_store(body: StoreCreate):
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO stores (name, base_url) VALUES (?, ?)",
            (body.name, body.base_url),
        )
        await db.commit()
        row = await db.execute_fetchall(
            "SELECT id, name, base_url, created_at FROM stores WHERE id=?",
            (cur.lastrowid,),
        )
        return Store(**dict(row[0]))
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            raise HTTPException(status_code=409, detail="Store with this base_url already exists")
        raise
    finally:
        await db.close()


@router.delete("/{store_id}", status_code=204)
async def delete_store(store_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM stores WHERE id=?", (store_id,))
        await db.commit()
    finally:
        await db.close()
