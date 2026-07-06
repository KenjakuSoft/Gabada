from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest  # noqa: E402
from pydantic import ValidationError  # noqa: E402

from database.models import (  # noqa: E402
    FileImportRow,
    ProductCreate,
    ProductStoreCreate,
    ProductStoreUpdate,
    QuickAddRequest,
    Store,
    StoreCreate,
    WooCredentials,
    neutralize_web_url,
)


def test_product_store_rejects_javascript_url() -> None:
    with pytest.raises(ValidationError):
        ProductStoreCreate(store_id=1, product_url="javascript:alert(1)")


def test_product_store_rejects_control_char_smuggled_scheme() -> None:
    """Browsers strip tab/newline inside URLs, so "jav\\tascript:" executes."""
    with pytest.raises(ValidationError):
        ProductStoreCreate(store_id=1, product_url="jav\tascript:alert(1)")
    with pytest.raises(ValidationError):
        ProductStoreUpdate(product_url="\x00 javascript:alert(1)")


def test_product_store_accepts_web_and_schemeless_urls() -> None:
    ok = ProductStoreCreate(store_id=1, product_url="https://a.lk/x")
    assert ok.product_url == "https://a.lk/x"
    upper = ProductStoreCreate(store_id=1, product_url="HTTP://a.lk/x")
    assert upper.product_url == "HTTP://a.lk/x"
    bare = ProductStoreCreate(store_id=1, product_url="www.a.lk/x")
    assert bare.product_url == "www.a.lk/x"
    assert ProductStoreCreate(store_id=1, product_url=None).product_url is None
    assert ProductStoreCreate(store_id=1, product_url="").product_url == ""


def test_store_create_rejects_non_web_schemes() -> None:
    with pytest.raises(ValidationError):
        StoreCreate(name="s", base_url="data:text/html,<script>1</script>")
    with pytest.raises(ValidationError):
        StoreCreate(name="s", login_url="file:///etc/passwd")
    with pytest.raises(ValidationError):
        WooCredentials(site_url="vbscript:x", consumer_key="k", consumer_secret="s")


def test_store_create_accepts_empty_base_url() -> None:
    assert StoreCreate(name="s").base_url == ""


def test_quick_add_rejects_bad_scheme_in_list() -> None:
    with pytest.raises(ValidationError):
        QuickAddRequest(urls=["https://ok.lk/x", "javascript:alert(1)"])


def test_file_import_row_rejects_bad_urls() -> None:
    with pytest.raises(ValidationError):
        FileImportRow(name="row", image_url="javascript:alert(1)")
    with pytest.raises(ValidationError):
        FileImportRow(name="row", url="data:text/html,x")


def test_product_create_rejects_bad_image_url() -> None:
    with pytest.raises(ValidationError):
        ProductCreate(canonical_name="p", image_url="data:text/html,x")


def test_store_output_model_tolerates_legacy_values() -> None:
    """Reads must never fail because a stored row predates the guard."""
    store = Store(
        id=1,
        name="legacy",
        base_url="javascript:alert(1)",
        created_at=datetime.now(timezone.utc),
    )
    assert store.base_url == "javascript:alert(1)"


def test_neutralize_drops_unsafe_and_keeps_web() -> None:
    assert neutralize_web_url("javascript:alert(1)") is None
    assert neutralize_web_url("jav\tascript:alert(1)") is None
    assert neutralize_web_url("https://a.lk/x") == "https://a.lk/x"
    assert neutralize_web_url("www.a.lk/x") == "www.a.lk/x"
    assert neutralize_web_url("") is None
    assert neutralize_web_url(None) is None


def test_neutralize_api_sentinel_only_when_allowed() -> None:
    assert neutralize_web_url("api://catalog/123") is None
    assert (
        neutralize_web_url("api://catalog/123", allow_api_scheme=True)
        == "api://catalog/123"
    )
