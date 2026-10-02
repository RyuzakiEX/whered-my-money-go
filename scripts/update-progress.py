"""Regenerate the Progress section of tasks/milestones.md from the backlog
checkbox tables, so the summary cannot drift from the per-task source."""

import glob
import re
import sys

NAMES = {
    'm0': ('M0', 'Foundation & Toolchain'),
    'm1': ('M1', 'Auth & Profile'),
    'm2': ('M2', 'Accounts'),
    'm3': ('M3', 'Transactions & Categories'),
    'm4': ('M4', 'Dashboard Core'),
    'm5': ('M5', 'Budgets'),
    'm6': ('M6', 'Savings Goals'),
    'm7': ('M7', 'Safe to Spend ⭐'),
    'm8': ('M8', 'Money Timeline ⭐'),
    'm9': ('M9', 'MVP Hardening & Launch'),
}

BAR_WIDTH = 10
rows = []
total_done = total_all = 0

for path in sorted(glob.glob('tasks/backlog/m[0-9]*.md')):
    key = re.search(r'(m\d)', path).group(1)
    if key not in NAMES:
        continue
    mid, name = NAMES[key]
    text = open(path, encoding='utf-8').read()
    # Only the Progress table's checkboxes.
    section = text.split('## Progress', 1)[-1].split('## Tasks', 1)[0]
    done = len(re.findall(r'^\| \[x\] \|', section, re.M | re.I))
    todo = len(re.findall(r'^\| \[ \] \|', section, re.M))
    count = done + todo
    if count == 0:
        continue
    total_done += done
    total_all += count

    pct = round(100 * done / count)
    filled = round(BAR_WIDTH * done / count)
    bar = '█' * filled + '░' * (BAR_WIDTH - filled)
    status = 'done' if done == count else ('in progress' if done else 'not started')
    fname = path.replace('tasks/', '').replace('\\', '/')
    rows.append(
        f'| **{mid}** | [{name}]({fname}) | `{bar}` | {done}/{count} | {pct}% | {status} |'
    )

overall_pct = round(100 * total_done / total_all) if total_all else 0
filled = round(BAR_WIDTH * total_done / total_all) if total_all else 0
overall_bar = '█' * filled + '░' * (BAR_WIDTH - filled)

block = [
    '## Progress',
    '',
    '> [!NOTE]',
    '> Generated from the checkbox tables in each backlog file — tick a task'
    ' there and regenerate, so this summary cannot drift from its source.',
    '',
    '| ID | Milestone | | Tasks | | Status |',
    '|---|---|---|---|---|---|',
    *rows,
    f'| | **MVP total** | `{overall_bar}` | **{total_done}/{total_all}** |'
    f' **{overall_pct}%** | |',
    # Two entries, so the join leaves a BLANK LINE after the table rather than
    # just a newline. markdownlint's MD058 (blanks-around-tables) and MD022
    # (blanks-around-headings) both fail without it, and the heading that
    # follows this section would be flagged.
    '',
    '',
]
new_section = '\n'.join(block)

p = 'tasks/milestones.md'
s = open(p, encoding='utf-8').read()

if '## Progress' in s:
    start = s.index('## Progress')
    rest = s[start + len('## Progress'):]
    nxt = rest.find('\n## ')
    end = len(s) if nxt == -1 else start + len('## Progress') + nxt + 1
    s = s[:start] + new_section + s[end:]
else:
    # Insert before the first H2 after the intro.
    m = re.search(r'^## ', s, re.M)
    if not m:
        print('could not find an insertion point')
        sys.exit(1)
    s = s[: m.start()] + new_section + '\n' + s[m.start():]

open(p, 'w', encoding='utf-8').write(s)
print(f'progress: {total_done}/{total_all} tasks ({overall_pct}%)')
