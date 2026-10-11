#!/usr/bin/env python3
"""Scan a process tree's memory for a marker string (UTF-8 and UTF-16LE), and report resident memory.
Usage: scan_memory.py <pid> <marker>    (needs ptrace permission over the process: same user, yama scope 0 or parent)"""
import os, re, sys

def tree(pid):
    out, todo = [], [pid]
    while todo:
        p = todo.pop(); out.append(p)
        try:
            for t in os.listdir(f'/proc/{p}/task'):
                with open(f'/proc/{p}/task/{t}/children') as f:
                    todo += [int(c) for c in f.read().split()]
        except OSError:
            pass
    return out

def rss_kb(p):
    try:
        with open(f'/proc/{p}/status') as f:
            return int(re.search(r'VmRSS:\s+(\d+)', f.read()).group(1))
    except Exception:
        return 0

def pss_kb(p):
    try:
        with open(f'/proc/{p}/smaps_rollup') as f:
            return int(re.search(r'Pss:\s+(\d+)', f.read()).group(1))
    except Exception:
        return 0

def name(p):
    try:
        return open(f'/proc/{p}/comm').read().strip()
    except OSError:
        return '?'

def scan(p, needles):
    hits = 0
    try:
        maps = open(f'/proc/{p}/maps').read().splitlines()
        mem = open(f'/proc/{p}/mem', 'rb', 0)
    except OSError as e:
        return -1
    for line in maps:
        addr, perms = line.split()[:2]
        if 'r' not in perms or 'w' not in perms:   # writable memory is where runtime strings live
            continue
        a, b = (int(x, 16) for x in addr.split('-'))
        if b - a > 1 << 31:
            continue
        try:
            mem.seek(a); chunk = mem.read(b - a)
        except (OSError, ValueError, OverflowError):
            continue
        for n in needles:
            hits += chunk.count(n)
    return hits

pid, marker = int(sys.argv[1]), sys.argv[2]
needles = [marker.encode(), marker.encode('utf-16-le')]
total_rss, total_pss, total_hits = 0, 0, 0
for p in tree(pid):
    r, q, h = rss_kb(p), pss_kb(p), scan(p, needles)
    total_rss += r; total_pss += q; total_hits += max(h, 0)
    print(f'  {p:>7} {name(p):<20} rss {r/1024:7.1f} MB  pss {q/1024:7.1f} MB  marker copies {h if h >= 0 else "unreadable (protected)"}')
print(f'TOTAL rss {total_rss/1024:.1f} MB, pss {total_pss/1024:.1f} MB, readable marker copies {total_hits}')
