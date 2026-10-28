import os
import subprocess
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
log = os.path.join(os.path.dirname(__file__), "mempalace-run.log")
os.chdir(root)
env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

cmds = [
    [sys.executable, "-m", "mempalace", "init", "private", "--yes"],
    [sys.executable, "-m", "mempalace", "mine", "private", "--wing", "updateCfg", "--no-gitignore"],
    [sys.executable, "-m", "mempalace", "status"],
]

lines = []
for cmd in cmds:
    lines.append("$ " + " ".join(cmd))
    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=600,
        )
        lines.append(f"exit {r.returncode}")
        if r.stdout:
            lines.append(r.stdout.rstrip())
        if r.stderr:
            lines.append("stderr:\n" + r.stderr.rstrip())
    except subprocess.TimeoutExpired:
        lines.append("TIMEOUT")
    lines.append("")

with open(log, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("done ->", log)
