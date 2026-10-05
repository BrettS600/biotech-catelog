#!/usr/bin/env python3
"""Link your eBay account to the collector so the Revenue tab can read your own purchases and sales.

Run this on the droplet, as root, AFTER you have clicked Agree on eBay's approval page:

    python3 /opt/pokemon-collector/repo/ebay_link.py

It asks for two things - your eBay Redirect URL name (RuName) and the code eBay gave you - trades the code for a
long-lived token, saves it next to the other keys in /etc/pokemon-collector.env, and restarts the collector.
The code only works for 5 minutes and only once. Nothing is sent anywhere except to eBay."""
import os
import subprocess
import sys
import urllib.parse

ENV_FILE = "/etc/pokemon-collector.env"


def code_from(text):
    """Accept the bare code, a URL-encoded code, or the whole address eBay sent the browser to."""
    text = text.strip().strip('"').strip("'")
    if "code=" in text:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(text).query or text.split("?", 1)[-1])
        if q.get("code"):
            return q["code"][0]
    return urllib.parse.unquote(text)


def main():
    if not os.path.exists(ENV_FILE):
        sys.exit(f"{ENV_FILE} is missing - this has to run on the collector's machine.")
    env = dict(line.strip().split("=", 1) for line in open(ENV_FILE) if "=" in line and not line.startswith("#"))
    os.environ.update({k: v for k, v in env.items() if k.startswith("EBAY_")})
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import account
    runame = input("1. Your eBay Redirect URL name (RuName): ").strip()
    code = code_from(input("2. The code eBay gave you after you clicked Agree: "))
    if not runame or not code:
        sys.exit("Both are needed. Nothing was changed.")
    ok, j = account.token_request({"grant_type": "authorization_code", "code": code, "redirect_uri": runame})
    if not ok or not j.get("refresh_token"):
        sys.exit("eBay did not accept that (" + j.get("error", "no refresh token came back") + ").\n"
                 "The code lasts 5 minutes and works once: click Agree again for a fresh one, and check the RuName.\n"
                 "Nothing was changed.")
    keep = [line for line in open(ENV_FILE) if not line.startswith(("EBAY_REFRESH_TOKEN=", "EBAY_RUNAME="))]
    with open(ENV_FILE, "w") as f:
        f.writelines(keep)
        f.write(f"EBAY_RUNAME={runame}\nEBAY_REFRESH_TOKEN={j['refresh_token']}\n")
    os.chmod(ENV_FILE, 0o600)
    subprocess.run(["systemctl", "restart", "pokemon-collector"], check=False)
    days = int(j.get("refresh_token_expires_in", 0)) // 86400
    print(f"\nLinked. The collector restarted and will read your purchases and sales within a few minutes."
          + (f"\neBay's approval lasts about {days} days; after that, run this again." if days else ""))


if __name__ == "__main__":
    main()
