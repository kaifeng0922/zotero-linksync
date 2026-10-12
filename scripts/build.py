"""Reproducibly package an explicit plugin allowlist. No user-library access."""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parents[1]
files = ["manifest.json", "bootstrap.js", "LICENSE"] + sorted(
    str(p.relative_to(root)) for folder in ("hooks", "modules")
    for p in (root / folder).glob("*.js")
)
version = json.loads((root / "manifest.json").read_text())["version"]
dest = root / "dist"
dest.mkdir(exist_ok=True)
output = dest / f"zotero-linksync-{version}.xpi"
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / name).read_bytes())
digest = hashlib.sha256(output.read_bytes()).hexdigest()
(dest / "SHA256SUMS.txt").write_text(f"{digest}  {output.name}\n")
print(output)
print(digest)
