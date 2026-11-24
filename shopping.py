#!/usr/bin/env python3
"""Shared shopping list API helper.

Configuration comes from the environment (nothing is hard-coded):
  SHOPPING_API_BASE   base URL of the deployment,
                      e.g. https://katte.example.workers.dev
  SHOPPING_TOKEN_FILE path to a protected JSON file (mode 600, never
                      committed) mapping actor names to Bearer tokens,
                      e.g. {"alice": "...", "bob": "..."}
  SHOPPING_ACTOR      which actor's token to use (default: "alice")

The token is read from the file at call time and never printed.

Usage:
  shopping.py list
  shopping.py add NAME [MEMO] [--personal]
  shopping.py scope ID family|personal
  shopping.py check ID | uncheck ID
  shopping.py edit ID NAME [MEMO]
  shopping.py remove ID
  shopping.py clear-checked
"""
import json
import os
import subprocess
import sys

BASE = os.environ.get("SHOPPING_API_BASE", "")
TOKEN_FILE = os.environ.get("SHOPPING_TOKEN_FILE", "")


def token():
    with open(TOKEN_FILE) as f:
        data = json.load(f)
    actor = os.environ.get("SHOPPING_ACTOR", "alice")
    return data[actor]


def call(method, path, body=None):
    args = ["curl", "-sS", "-X", method, BASE + path,
            "-H", "Authorization: Bearer " + token(),
            "-H", "Content-Type: application/json",
            "-w", "\n%{http_code}"]
    if body is not None:
        args += ["-d", json.dumps(body, ensure_ascii=False)]
    out = subprocess.run(args, capture_output=True, text=True)
    text = out.stdout
    payload, _, code = text.rpartition("\n")
    print(payload)
    if int(code) >= 400:
        sys.exit(1)


def main():
    if not BASE or not TOKEN_FILE:
        print("Set SHOPPING_API_BASE and SHOPPING_TOKEN_FILE first.", file=sys.stderr)
        sys.exit(2)
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == "list":
        call("GET", "/items")
    elif cmd == "add":
        argv = [a for a in sys.argv[2:] if a != "--personal"]
        body = {"name": argv[0]}
        if len(argv) > 1:
            body["memo"] = argv[1]
        if "--personal" in sys.argv:
            body["scope"] = "personal"
        call("POST", "/items", body)
    elif cmd == "scope":
        call("PATCH", "/items/" + sys.argv[2], {"scope": sys.argv[3]})
        call("POST", "/items", body)
    elif cmd == "check":
        call("PATCH", "/items/" + sys.argv[2], {"checked": True})
    elif cmd == "uncheck":
        call("PATCH", "/items/" + sys.argv[2], {"checked": False})
    elif cmd == "edit":
        body = {"name": sys.argv[3]}
        if len(sys.argv) > 4:
            body["memo"] = sys.argv[4]
        call("PATCH", "/items/" + sys.argv[2], body)
    elif cmd == "remove":
        call("DELETE", "/items/" + sys.argv[2])
    elif cmd == "clear-checked":
        call("POST", "/items/clear-checked", {})
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
