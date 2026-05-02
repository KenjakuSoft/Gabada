import aiosqlite
from app_paths import database_path

DB_PATH = str(database_path())

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
                manual_only INTEGER NOT NULL DEFAULT 0,
                login_url TEXT,
                storage_state_path TEXT,
                session_updated_at DATETIME,
                woo_enabled INTEGER NOT NULL DEFAULT 0,
                woo_site_url TEXT,
                woo_consumer_key TEXT,
                woo_consumer_secret TEXT,
                woo_auto_import_new INTEGER NOT NULL DEFAULT 0,
                woo_last_synced_at DATETIME,
                api_enabled INTEGER NOT NULL DEFAULT 0,
                api_platform TEXT,
                api_base_url TEXT,
                api_key TEXT,
                api_config TEXT NOT NULL DEFAULT '{}',
                api_auto_import_new INTEGER NOT NULL DEFAULT 0,
                api_last_synced_at DATETIME,
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
                dealer_price REAL,
                warranty TEXT,
                stock_status TEXT DEFAULT 'unknown',
                raw_price TEXT,
                raw_discounted TEXT,
                raw_dealer TEXT,
                currency_code TEXT
            );

            CREATE TABLE IF NOT EXISTS product_store_overrides (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_store_id INTEGER NOT NULL REFERENCES product_stores(id) ON DELETE CASCADE UNIQUE,
                manual_price REAL,
                manual_stock_status TEXT,
                manual_warranty TEXT,
                imported_dealer_price REAL,
                imported_warranty TEXT,
                override_note TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_price_logs_product_store ON price_logs(product_store_id);
            CREATE INDEX IF NOT EXISTS idx_price_logs_scraped_at ON price_logs(scraped_at);

            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                currency_code TEXT NOT NULL DEFAULT 'USD',
                currency_symbol TEXT NOT NULL DEFAULT '$',
                country_code TEXT NOT NULL DEFAULT 'US',
                timezone TEXT NOT NULL DEFAULT 'UTC',
                scrape_cron TEXT NOT NULL DEFAULT '0 8 * * *',
                scrape_enabled INTEGER NOT NULL DEFAULT 1,
                locale TEXT NOT NULL DEFAULT 'en-US',
                price_display_mode TEXT NOT NULL DEFAULT 'regional',
                exchange_rates TEXT NOT NULL DEFAULT '{}',
                theme TEXT NOT NULL DEFAULT 'system',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            INSERT OR IGNORE INTO settings (id) VALUES (1);
        """)
        await db.commit()

        # Migrations for existing databases
        try:
            await db.execute("ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL")
            await db.commit()
        except Exception:
            pass

        # Rename legacy dealer_* columns to neutral names; no-op on fresh DBs.
        for rename_sql in [
            "ALTER TABLE stores RENAME COLUMN dealer_login_url TO login_url",
            "ALTER TABLE stores RENAME COLUMN dealer_storage_state_path TO storage_state_path",
            "ALTER TABLE stores RENAME COLUMN dealer_session_updated_at TO session_updated_at",
        ]:
            try:
                await db.execute(rename_sql)
                await db.commit()
            except Exception:
                pass

        for col_sql in [
            "ALTER TABLE stores ADD COLUMN manual_only INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE stores ADD COLUMN login_url TEXT",
            "ALTER TABLE stores ADD COLUMN storage_state_path TEXT",
            "ALTER TABLE stores ADD COLUMN session_updated_at DATETIME",
            "ALTER TABLE stores ADD COLUMN woo_enabled INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE stores ADD COLUMN woo_site_url TEXT",
            "ALTER TABLE stores ADD COLUMN woo_consumer_key TEXT",
            "ALTER TABLE stores ADD COLUMN woo_consumer_secret TEXT",
            "ALTER TABLE stores ADD COLUMN woo_auto_import_new INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE stores ADD COLUMN woo_last_synced_at DATETIME",
            "ALTER TABLE stores ADD COLUMN api_enabled INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE stores ADD COLUMN api_platform TEXT",
            "ALTER TABLE stores ADD COLUMN api_base_url TEXT",
            "ALTER TABLE stores ADD COLUMN api_key TEXT",
            "ALTER TABLE stores ADD COLUMN api_config TEXT NOT NULL DEFAULT '{}'",
            "ALTER TABLE stores ADD COLUMN api_auto_import_new INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE stores ADD COLUMN api_last_synced_at DATETIME",
        ]:
            try:
                await db.execute(col_sql)
                await db.commit()
            except Exception:
                pass

        for col_sql in [
            "ALTER TABLE price_logs ADD COLUMN change_type TEXT",
            "ALTER TABLE price_logs ADD COLUMN price_delta REAL",
            "ALTER TABLE price_logs ADD COLUMN previous_price REAL",
            "ALTER TABLE price_logs ADD COLUMN previous_stock_status TEXT",
            "ALTER TABLE price_logs ADD COLUMN dealer_price REAL",
            "ALTER TABLE price_logs ADD COLUMN raw_dealer TEXT",
            "ALTER TABLE price_logs ADD COLUMN warranty TEXT",
            "ALTER TABLE price_logs ADD COLUMN currency_code TEXT",
        ]:
            try:
                await db.execute(col_sql)
                await db.commit()
            except Exception:
                pass

        for col_sql in [
            "ALTER TABLE product_store_overrides ADD COLUMN manual_warranty TEXT",
            "ALTER TABLE product_store_overrides ADD COLUMN imported_dealer_price REAL",
            "ALTER TABLE product_store_overrides ADD COLUMN imported_warranty TEXT",
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

        for col_sql in [
            "ALTER TABLE settings ADD COLUMN price_display_mode TEXT NOT NULL DEFAULT 'regional'",
            "ALTER TABLE settings ADD COLUMN exchange_rates TEXT NOT NULL DEFAULT '{}'",
        ]:
            try:
                await db.execute(col_sql)
                await db.commit()
            except Exception:
                pass

        try:
            await db.execute(
                """
                INSERT INTO product_store_overrides (
                    product_store_id,
                    imported_dealer_price,
                    imported_warranty
                )
                SELECT
                    ps.id,
                    (
                        SELECT pl.dealer_price
                        FROM price_logs pl
                        WHERE pl.product_store_id = ps.id
                          AND pl.dealer_price IS NOT NULL
                        ORDER BY pl.scraped_at DESC, pl.id DESC
                        LIMIT 1
                    ) AS imported_dealer_price,
                    (
                        SELECT pl.warranty
                        FROM price_logs pl
                        WHERE pl.product_store_id = ps.id
                          AND NULLIF(TRIM(pl.warranty), '') IS NOT NULL
                        ORDER BY pl.scraped_at DESC, pl.id DESC
                        LIMIT 1
                    ) AS imported_warranty
                FROM product_stores ps
                WHERE EXISTS (
                    SELECT 1
                    FROM price_logs pl
                    WHERE pl.product_store_id = ps.id
                      AND (
                          pl.dealer_price IS NOT NULL
                          OR NULLIF(TRIM(pl.warranty), '') IS NOT NULL
                      )
                )
                ON CONFLICT(product_store_id) DO UPDATE SET
                    imported_dealer_price = COALESCE(
                        product_store_overrides.imported_dealer_price,
                        excluded.imported_dealer_price
                    ),
                    imported_warranty = COALESCE(
                        NULLIF(TRIM(product_store_overrides.imported_warranty), ''),
                        NULLIF(TRIM(excluded.imported_warranty), '')
                    ),
                    updated_at = CURRENT_TIMESTAMP
                WHERE product_store_overrides.imported_dealer_price IS NULL
                   OR NULLIF(TRIM(product_store_overrides.imported_warranty), '') IS NULL
                """
            )
            await db.commit()
        except Exception:
            pass
