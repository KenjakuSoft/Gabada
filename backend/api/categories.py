from fastapi import APIRouter, HTTPException
from database.db import get_db
from database.models import Category, CategoryCreate

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("/", response_model=list[Category])
async def list_categories():
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT id, name, color, created_at FROM categories ORDER BY name"
        )
        return [Category(**dict(r)) for r in rows]
    finally:
        await db.close()


@router.post("/", response_model=Category, status_code=201)
async def create_category(body: CategoryCreate):
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO categories (name, color) VALUES (?, ?)",
            (body.name, body.color),
        )
        await db.commit()
        row = await db.execute_fetchall(
            "SELECT id, name, color, created_at FROM categories WHERE id=?",
            (cur.lastrowid,),
        )
        return Category(**dict(row[0]))
    except Exception as e:
        if "UNIQUE constraint" in str(e):
            raise HTTPException(status_code=409, detail="Category already exists")
        raise
    finally:
        await db.close()


@router.patch("/{category_id}", response_model=Category)
async def update_category(category_id: int, body: CategoryCreate):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE categories SET name=?, color=? WHERE id=?",
            (body.name, body.color, category_id),
        )
        await db.commit()
        row = await db.execute_fetchall(
            "SELECT id, name, color, created_at FROM categories WHERE id=?",
            (category_id,),
        )
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        return Category(**dict(row[0]))
    finally:
        await db.close()


@router.delete("/{category_id}", status_code=204)
async def delete_category(category_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM categories WHERE id=?", (category_id,))
        await db.commit()
    finally:
        await db.close()
