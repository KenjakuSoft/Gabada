from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scraper.engine import _bot_challenge_result  # noqa: E402


def test_bot_challenge_result_stops_price_extraction() -> None:
    result = _bot_challenge_result()

    assert result.price is None
    assert result.discounted_price is None
    assert result.dealer_price is None
    assert result.review_status == "needs_review"
    assert result.error is not None
    assert "Bot-check challenge" in result.error
    assert any("extraction stopped" in note for note in result.review_notes)
    assert any("Save session" in note for note in result.review_notes)
