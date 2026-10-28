import os
import subprocess
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tools = os.path.join(os.path.dirname(__file__), "updatecfg-tools")
log = os.path.join(os.path.dirname(__file__), "mempalace-mine-log.txt")
os.chdir(root)
env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

cmds = [
    [sys.executable, "-m", "mempalace", "init", tools, "--yes", "--auto-mine"],
    [sys.executable, "-m", "mempalace", "status"],
]

lines = [f"cwd: {os.getcwd()}", f"tools: {tools}", ""]
for cmd in cmds:
    lines.append("$ " + " ".join(cmd))
    r = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=300,
    )
    lines.append(f"exit {r.returncode}")
    if r.stdout:
        lines.append(r.stdout.rstrip())
    if r.stderr:
        lines.append("stderr:\n" + r.stderr.rstrip())
    lines.append("")

with open(log, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("done ->", log)
