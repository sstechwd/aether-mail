"""Aether Mail ↔ Sibyl Memory (official SDK, local file, no mailbox upload).

Usage:
  python scripts/sibyl_aether.py --db PATH remember --kind person --name priya --body '{"note":"..."}'
  python scripts/sibyl_aether.py --db PATH recall --query "priya"
  python scripts/sibyl_aether.py --db PATH event --acted "taught workflow"
  python scripts/sibyl_aether.py --db PATH list
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def client(db: str):
    from sibyl_memory_client import MemoryClient

    Path(db).parent.mkdir(parents=True, exist_ok=True)
    return MemoryClient.local(db)


def out(payload: object) -> None:
    sys.stdout.write(json.dumps(payload, default=str))
    sys.stdout.write("\n")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", required=True)
    p.add_argument("action", choices=["remember", "recall", "event", "list"])
    p.add_argument("--kind", default="note")
    p.add_argument("--name", default="")
    p.add_argument("--body", default="{}")
    p.add_argument("--query", default="")
    p.add_argument("--acted", default="")
    args = p.parse_args()
    mem = client(args.db)

    if args.action == "remember":
        body = json.loads(args.body)
        if not args.name:
            raise SystemExit("need --name")
        mem.set_entity(args.kind, args.name, body)
        out({"ok": True, "kind": args.kind, "name": args.name})
        return 0

    if args.action == "recall":
        hits = mem.search_entities(args.query or args.name) if (args.query or args.name) else []
        slim = []
        for h in hits[:8]:
            slim.append(
                {
                    "kind": h.get("category") or h.get("kind"),
                    "name": h.get("name"),
                    "body": h.get("body"),
                }
            )
        out({"ok": True, "hits": slim})
        return 0

    if args.action == "event":
        acted = [args.acted] if args.acted else []
        mem.write_event(acted=acted)
        out({"ok": True})
        return 0

    rows = []
    listed = mem.list_entities() if hasattr(mem, "list_entities") else []
    for h in listed[:40]:
        rows.append(
            {
                "kind": h.get("category") or h.get("kind"),
                "name": h.get("name"),
                "body": h.get("body"),
            }
        )
    out({"ok": True, "hits": rows})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        out({"ok": False, "error": str(e)[:240]})
        raise SystemExit(1)
