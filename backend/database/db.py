import aiosqlite
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "gabada.db")

async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#6C63FF',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canonical_name TEXT NOT NULL,
                image_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS stores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                base_url TEXT NOT NULL UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS product_stores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
                product_url TEXT NOT NULL,
                scrape_config TEXT NOT NULL DEFAULT '{}',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(product_id, store_id)
            );

            CREATE TABLE IF NOT EXISTS price_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_store_id INTEGER NOT NULL REFERENCES product_stores(id) ON DELETE CASCADE,
                scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                title TEXT,
                price REAL,
                discounted_price REAL,
                stock_status TEXT DEFAULT 'unknown',
                raw_price TEXT,
                raw_discounted TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_price_logs_product_store ON price_logs(product_store_id);
            CREATE INDEX IF NOT EXISTS idx_price_logs_scraped_at ON price_logs(scraped_at);
        """)
        await db.commit()

        # Migrations for existing databases
        try:
            await db.execute("ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL")
            await db.commit()
        except Exception:
            pass

        for col_sql in [
            "ALTER TABLE price_logs ADD COLUMN change_type TEXT",
            "ALTER TABLE price_logs ADD COLUMN price_delta REAL",
            "ALTER TABLE price_logs ADD COLUMN previous_price REAL",
            "ALTER TABLE price_logs ADD COLUMN previous_stock_status TEXT",
        ]:
            try:
                await db.execute(col_sql)
                await db.commit()
            except Exception:
                pass

        try:
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_price_logs_change ON price_logs(change_type, scraped_at)"
            )
            await db.commit()
        except Exception:
            pass
