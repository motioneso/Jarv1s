#!/usr/bin/env python3
"""debloat_jsonl.py — strip a Claude Code session .jsonl down to a lightweight transcript.

The raw session files are dominated by tool *results* — full file contents and
command output echoed back into context. This tool drops that bloat and keeps the
conversation skeleton:

  * your (user) messages, verbatim
  * each assistant turn, labelled with the model that wrote it (so you can spot Fable)
  * assistant thinking blocks (kept when non-empty)
  * one compact line per tool call: the tool name + a short hint of its args
  * tool results are omitted (just their size is noted)

Goal: pull every Fable turn out of a session so the back-and-forth can be studied.

Usage:
    python3 debloat_jsonl.py SESSION.jsonl              # full lightweight transcript
    python3 debloat_jsonl.py SESSION.jsonl --model fable   # only assistant turns from Fable (+ user context)
    python3 debloat_jsonl.py SESSION.jsonl --no-thinking   # drop thinking blocks
    python3 debloat_jsonl.py SESSION.jsonl -o out.md       # write to a file
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def one_line(s: str, limit: int = 140) -> str:
    """Collapse whitespace and truncate to a single readable line."""
    s = " ".join(str(s).split())
    return s if len(s) <= limit else s[: limit - 1] + "…"


def tool_hint(block: dict) -> str:
    """A short, tool-aware summary of a tool_use block's arguments."""
    name = block.get("name", "?")
    inp = block.get("input", {}) or {}
    # pick the most informative field per tool
    key_order = {
        "Bash": ["command"],
        "Read": ["file_path"],
        "Edit": ["file_path"],
        "Write": ["file_path"],
        "NotebookEdit": ["notebook_path"],
        "Glob": ["pattern"],
        "Grep": ["pattern"],
        "Task": ["description", "subagent_type"],
        "Agent": ["description", "subagent_type"],
        "WebFetch": ["url"],
        "WebSearch": ["query"],
        "Skill": ["skill"],
        "TodoWrite": [],
    }
    hint = ""
    for k in key_order.get(name, []):
        if k in inp and inp[k]:
            hint = one_line(inp[k])
            break
    if not hint and inp:
        # generic fallback: first scalar-ish field
        for k, v in inp.items():
            if isinstance(v, (str, int, float)) and str(v).strip():
                hint = f"{k}={one_line(v, 100)}"
                break
    return f"[tool: {name}] {hint}".rstrip()


def result_size(obj: dict) -> int:
    """Approx byte size of a tool result line's payload."""
    msg = obj.get("message", {})
    content = msg.get("content")
    try:
        return len(json.dumps(content))
    except Exception:
        return len(str(content))


def is_tool_result_line(obj: dict) -> bool:
    if "toolUseResult" in obj:
        return True
    msg = obj.get("message")
    if isinstance(msg, dict):
        c = msg.get("content")
        if isinstance(c, list) and any(
            isinstance(b, dict) and b.get("type") == "tool_result" for b in c
        ):
            return True
    return False


def render(path: Path, model_filter: str | None, keep_thinking: bool, show_result_size: bool):
    out: list[str] = []
    model_counts: dict[str, int] = {}
    tool_counts: dict[str, int] = {}
    user_msgs = 0

    with path.open() as f:
        lines = [json.loads(l) for l in f if l.strip()]

    for obj in lines:
        typ = obj.get("type")
        msg = obj.get("message")

        # --- assistant turns ---
        if typ == "assistant" and isinstance(msg, dict):
            model = msg.get("model", "unknown")
            model_counts[model] = model_counts.get(model, 0) + 1
            if model_filter and model_filter.lower() not in model.lower():
                continue  # skip non-matching assistant turns entirely
            blocks = msg.get("content") or []
            if isinstance(blocks, str):
                blocks = [{"type": "text", "text": blocks}]
            rendered_any = False
            piece: list[str] = []
            for b in blocks:
                if not isinstance(b, dict):
                    continue
                bt = b.get("type")
                if bt == "text":
                    txt = b.get("text", "").strip()
                    if txt:
                        piece.append(txt)
                        rendered_any = True
                elif bt == "thinking" and keep_thinking:
                    th = b.get("thinking", "").strip()
                    if th:
                        piece.append("  <thinking> " + one_line(th, 400))
                        rendered_any = True
                elif bt == "tool_use":
                    tn = b.get("name", "?")
                    tool_counts[tn] = tool_counts.get(tn, 0) + 1
                    piece.append("  " + tool_hint(b))
                    rendered_any = True
            if rendered_any:
                out.append(f"\n### assistant [{model}]")
                out.extend(piece)
            continue

        # --- tool result lines (the bloat) -> omit, optionally note size ---
        if is_tool_result_line(obj):
            if show_result_size and not model_filter:
                out.append(f"  └─ (tool result omitted, {human(result_size(obj))})")
            continue

        # --- real user messages ---
        if typ == "user" and isinstance(msg, dict):
            content = msg.get("content")
            text = None
            if isinstance(content, str):
                text = content.strip()
            elif isinstance(content, list):
                parts = [
                    b.get("text", "")
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                ]
                text = "\n".join(p for p in parts if p.strip()).strip()
            if text:
                user_msgs += 1
                out.append(f"\n## user\n{text}")
            continue

    # --- header / summary ---
    header = [
        f"# Transcript: {path.name}",
        f"models seen: " + ", ".join(f"{m}×{c}" for m, c in sorted(model_counts.items(), key=lambda x: -x[1])),
        f"user messages: {user_msgs}",
        f"tool calls: " + (", ".join(f"{t}×{c}" for t, c in sorted(tool_counts.items(), key=lambda x: -x[1])) or "none"),
    ]
    if model_filter:
        header.append(f"filter: assistant turns matching '{model_filter}'")
    header.append("=" * 60)
    return "\n".join(header) + "\n" + "\n".join(out) + "\n"


def stats(path: Path, model_filter: str | None):
    """Measure thinking + tool-use behaviour for assistant turns (optionally one model).

    Returns a flat dict of metrics, suitable for aggregation across many files.
    A "turn" is one assistant message; it may carry text, thinking, and/or tool_use blocks.
    """
    import statistics as st

    turns = 0
    turns_with_thinking = 0
    turns_with_tool = 0
    turns_with_text = 0
    thinking_chars: list[int] = []
    text_chars: list[int] = []
    tools_per_turn: list[int] = []
    tool_counts: dict[str, int] = {}
    total_tool_calls = 0

    with path.open() as f:
        lines = [json.loads(l) for l in f if l.strip()]

    for obj in lines:
        if obj.get("type") != "assistant":
            continue
        msg = obj.get("message")
        if not isinstance(msg, dict):
            continue
        model = msg.get("model", "unknown")
        if model_filter and model_filter.lower() not in model.lower():
            continue
        blocks = msg.get("content") or []
        if isinstance(blocks, str):
            blocks = [{"type": "text", "text": blocks}]
        n_tools = 0
        had_think = had_text = False
        for b in blocks:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "thinking":
                th = (b.get("thinking") or "").strip()
                if th:
                    thinking_chars.append(len(th))
                    had_think = True
            elif bt == "text":
                tx = (b.get("text") or "").strip()
                if tx:
                    text_chars.append(len(tx))
                    had_text = True
            elif bt == "tool_use":
                tn = b.get("name", "?")
                tool_counts[tn] = tool_counts.get(tn, 0) + 1
                n_tools += 1
        turns += 1
        if had_think:
            turns_with_thinking += 1
        if had_text:
            turns_with_text += 1
        if n_tools:
            turns_with_tool += 1
            total_tool_calls += n_tools
        tools_per_turn.append(n_tools)

    def summ(xs):
        if not xs:
            return {"n": 0, "mean": 0, "median": 0, "max": 0, "total": 0}
        return {
            "n": len(xs),
            "mean": round(st.mean(xs), 1),
            "median": round(st.median(xs), 1),
            "max": max(xs),
            "total": sum(xs),
        }

    return {
        "file": str(path),
        "model_filter": model_filter,
        "turns": turns,
        "turns_with_thinking": turns_with_thinking,
        "turns_with_tool": turns_with_tool,
        "turns_with_text": turns_with_text,
        "pct_turns_thinking": round(100 * turns_with_thinking / turns, 1) if turns else 0,
        "pct_turns_tool": round(100 * turns_with_tool / turns, 1) if turns else 0,
        "total_tool_calls": total_tool_calls,
        "thinking_chars": summ(thinking_chars),
        "text_chars": summ(text_chars),
        "tools_per_turn": summ(tools_per_turn),
        "tool_counts": tool_counts,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="Strip a Claude Code session .jsonl to a lightweight transcript.")
    ap.add_argument("session", type=Path, help="path to a session .jsonl file")
    ap.add_argument("--model", default=None,
                    help="only show assistant turns whose model matches this substring (e.g. 'fable')")
    ap.add_argument("--no-thinking", dest="thinking", action="store_false",
                    help="drop assistant thinking blocks")
    ap.add_argument("--no-sizes", dest="sizes", action="store_false",
                    help="don't print the omitted-result size markers")
    ap.add_argument("-o", "--out", type=Path, default=None, help="write to a file instead of stdout")
    ap.add_argument("--stats", action="store_true",
                    help="emit per-file JSON metrics on thinking/tool-use instead of a transcript")
    args = ap.parse_args(argv)

    if not args.session.exists():
        ap.error(f"no such file: {args.session}")

    if args.stats:
        text = json.dumps(stats(args.session, args.model), indent=2) + "\n"
        if args.out:
            args.out.write_text(text)
            print(f"wrote {args.out}", file=sys.stderr)
        else:
            sys.stdout.write(text)
        return

    text = render(args.session, args.model, args.thinking, args.sizes)
    if args.out:
        args.out.write_text(text)
        print(f"wrote {args.out} ({len(text)} chars)", file=sys.stderr)
    else:
        try:
            sys.stdout.write(text)
        except BrokenPipeError:
            # downstream closed early (e.g. piped to `head`); exit quietly
            try:
                sys.stdout.close()
            except BrokenPipeError:
                pass


if __name__ == "__main__":
    main()
