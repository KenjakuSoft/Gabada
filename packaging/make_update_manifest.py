from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def classify_asset(path: Path) -> str:
    name = path.name.lower()
    if name.endswith(".json") and "update" in name:
        return "manifest"
    if name.endswith(".exe"):
        return "installer"
    if name.endswith(".zip") or name.endswith(".tar.gz"):
        return "portable"
    return "other"


def build_manifest(args: argparse.Namespace) -> dict:
    assets = []
    for raw in args.assets:
        path = Path(raw)
        if not path.is_file():
            continue
        if path.resolve() == Path(args.output).resolve():
            continue
        kind = classify_asset(path)
        if kind == "other":
            continue
        assets.append(
            {
                "name": path.name,
                "kind": kind,
                "platform": args.platform,
                "arch": args.arch,
                "size": path.stat().st_size,
                "sha256": sha256_file(path),
                "download_url": (
                    f"https://github.com/{args.repo}/releases/download/"
                    f"{args.tag}/{path.name}"
                ),
            }
        )

    return {
        "schema": "gabada.update.v1",
        "app": "Gabada",
        "version": args.version,
        "tag": args.tag,
        "channel": args.channel,
        "repo": args.repo,
        "platform": args.platform,
        "arch": args.arch,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "release_url": f"https://github.com/{args.repo}/releases/tag/{args.tag}",
        "minimum_supported_version": args.minimum_supported_version,
        "assets": assets,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create a Gabada release update manifest."
    )
    parser.add_argument("--tag", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--platform", required=True)
    parser.add_argument("--arch", required=True)
    parser.add_argument("--repo", default="Xx-LiDAF-xX/Gabada")
    parser.add_argument("--channel", default="stable")
    parser.add_argument("--minimum-supported-version", default="0.1.0")
    parser.add_argument("--output", required=True)
    parser.add_argument("assets", nargs="*")
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(build_manifest(args), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote update manifest: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
