"""Aggregate generations + scores into leaderboard, per-criterion, agreement and per-case stats."""
import math
import statistics
from collections import defaultdict


def normalize(score: float, scale_max: int) -> float:
    return float(score) if scale_max == 1 else (float(score) - 1) / (scale_max - 1)


def _mean(xs):
    return statistics.fmean(xs) if xs else None


def _pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    k = (len(xs) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def pearson(xs, ys):
    if len(xs) < 3:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def _weighted(norm_by_crit: dict[str, float], weights: dict[str, float]) -> float | None:
    tot = sum(weights[c] for c in norm_by_crit if c in weights)
    if not tot:
        return None
    return sum(v * weights[c] for c, v in norm_by_crit.items() if c in weights) / tot


def compute(run: dict, generations: list[dict], scores: list[dict]) -> dict:
    suite = run["suite"]
    criteria = {c["id"]: c for c in suite["criteria"]}
    weights = {c["id"]: c.get("weight", 1.0) for c in suite["criteria"]}
    slots = [s["slot"] for s in run["slots"]]

    # gen_id -> source -> crit -> normalized
    by_gen: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
    raw: dict[tuple, float] = {}
    for s in scores:
        c = criteria.get(s["criterion_id"])
        if not c:
            continue
        by_gen[s["generation_id"]][s["source"]][c["id"]] = normalize(s["score"], c["scale_max"])
        raw[(s["generation_id"], s["source"], c["id"])] = s["score"]

    gen_scores = {}
    for g in generations:
        src = by_gen.get(g["id"], {})
        human = _weighted(src.get("human", {}), weights)
        ai = _weighted(src.get("ai", {}), weights)
        final_crit = {**src.get("ai", {}), **src.get("human", {})}  # human overrides AI where both exist
        gen_scores[g["id"]] = {"human": human, "ai": ai, "final": _weighted(final_crit, weights)}

    # ---- per-slot leaderboard ----
    slot_rows = []
    for slot in slots:
        gens = [g for g in generations if g["slot"] == slot]
        ok = [g for g in gens if not g.get("error") and g.get("status") == "done"]
        checks = [c["passed"] for g in ok for c in g.get("checks", [])]
        lat = [g["latency_ms"] for g in ok if g.get("latency_ms") is not None]
        crit_rows = {}
        for cid, c in criteria.items():
            h = [by_gen[g["id"]]["human"][cid] for g in ok if cid in by_gen.get(g["id"], {}).get("human", {})]
            a = [by_gen[g["id"]]["ai"][cid] for g in ok if cid in by_gen.get(g["id"], {}).get("ai", {})]
            hr = [raw[(g["id"], "human", cid)] for g in ok if (g["id"], "human", cid) in raw]
            ar = [raw[(g["id"], "ai", cid)] for g in ok if (g["id"], "ai", cid) in raw]
            crit_rows[cid] = {
                "human": _r(_mean(h) * 100 if h else None), "ai": _r(_mean(a) * 100 if a else None),
                "human_raw": _r(_mean(hr), 2), "ai_raw": _r(_mean(ar), 2), "human_n": len(h), "ai_n": len(a),
            }
        def avg(key):
            vals = [gen_scores[g["id"]][key] for g in ok if gen_scores[g["id"]][key] is not None]
            return _r(_mean(vals) * 100) if vals else None
        # consistency: std of final score across samples of the same case
        per_case = defaultdict(list)
        for g in ok:
            if gen_scores[g["id"]]["final"] is not None:
                per_case[g["case_id"]].append(gen_scores[g["id"]]["final"])
        stds = [statistics.pstdev(v) for v in per_case.values() if len(v) > 1]
        slot_rows.append({
            "slot": slot,
            "generations": len(gens), "completed": len(ok),
            "errors": sum(1 for g in gens if g.get("error")),
            "auto_pass_rate": _r(sum(checks) / len(checks) * 100) if checks else None,
            "auto_checks_run": len(checks),
            "human_score": avg("human"), "ai_score": avg("ai"), "final_score": avg("final"),
            "criteria": crit_rows,
            "latency_avg_ms": _r(_mean(lat), 0), "latency_p50_ms": _r(_pct(lat, 0.5), 0), "latency_p95_ms": _r(_pct(lat, 0.95), 0),
            "input_tokens": sum(g.get("input_tokens", 0) for g in ok),
            "output_tokens": sum(g.get("output_tokens", 0) for g in ok),
            "avg_output_tokens": _r(_mean([g.get("output_tokens", 0) for g in ok]), 0),
            "avg_output_words": _r(_mean([len((g.get("output") or "").split()) for g in ok]), 0),
            "cost_usd": round(sum(g.get("cost_usd", 0.0) for g in ok), 6),
            "consistency_std": _r(_mean(stds) * 100) if stds else None,
            "wins": 0, "losses": 0, "ties": 0, "win_rate": None,
        })
    rows_by_slot = {r["slot"]: r for r in slot_rows}

    # ---- pairwise win rate per (case, sample) ----
    units = defaultdict(dict)
    for g in generations:
        units[(g["case_id"], g["sample"])][g["slot"]] = g
    case_spread = defaultdict(lambda: defaultdict(list))
    for (case_id, _sample), by_slot in units.items():
        vals = {}
        for slot, g in by_slot.items():
            v = gen_scores[g["id"]]["final"]
            if g.get("error"):
                v = 0.0
            if v is not None:
                vals[slot] = v
                case_spread[case_id][slot].append(v)
        ss = list(vals)
        for i in range(len(ss)):
            for j in range(i + 1, len(ss)):
                a, b = ss[i], ss[j]
                if abs(vals[a] - vals[b]) < 1e-9:
                    rows_by_slot[a]["ties"] += 1; rows_by_slot[b]["ties"] += 1
                elif vals[a] > vals[b]:
                    rows_by_slot[a]["wins"] += 1; rows_by_slot[b]["losses"] += 1
                else:
                    rows_by_slot[b]["wins"] += 1; rows_by_slot[a]["losses"] += 1
    for r in slot_rows:
        n = r["wins"] + r["losses"] + r["ties"]
        r["win_rate"] = _r((r["wins"] + 0.5 * r["ties"]) / n * 100) if n else None

    # ---- per-case discrimination ----
    case_rows = []
    for c in suite["cases"]:
        per_slot = {s: _r(_mean(v) * 100) for s, v in case_spread.get(c["id"], {}).items() if v}
        vals = [v for v in per_slot.values() if v is not None]
        case_rows.append({
            "case_id": c["id"], "input": c["input"][:160], "tags": c.get("tags", []),
            "per_slot": per_slot,
            "mean": _r(_mean(vals)) if vals else None,
            "spread": _r(max(vals) - min(vals)) if len(vals) > 1 else None,
        })

    # ---- human vs AI agreement ----
    agreement = {"by_criterion": {}, "overall": None}
    all_h, all_a = [], []
    disagreements = []
    for cid, c in criteria.items():
        hs, as_ = [], []
        for g in generations:
            src = by_gen.get(g["id"], {})
            if cid in src.get("human", {}) and cid in src.get("ai", {}):
                h, a = src["human"][cid], src["ai"][cid]
                hs.append(h); as_.append(a)
                disagreements.append({
                    "generation_id": g["id"], "case_id": g["case_id"], "slot": g["slot"], "criterion_id": cid,
                    "human": raw[(g["id"], "human", cid)], "ai": raw[(g["id"], "ai", cid)], "diff": abs(h - a),
                })
        all_h += hs; all_a += as_
        if hs:
            step = 1.0 if c["scale_max"] == 1 else 1 / (c["scale_max"] - 1)
            agreement["by_criterion"][cid] = {
                "n": len(hs), "pearson": _r(pearson(hs, as_), 3),
                "mae": _r(_mean([abs(h - a) for h, a in zip(hs, as_)]) * 100),
                "within_one_point": _r(sum(abs(h - a) <= step + 1e-9 for h, a in zip(hs, as_)) / len(hs) * 100),
                "ai_bias": _r((_mean(as_) - _mean(hs)) * 100),
            }
    if all_h:
        agreement["overall"] = {
            "n": len(all_h), "pearson": _r(pearson(all_h, all_a), 3),
            "mae": _r(_mean([abs(h - a) for h, a in zip(all_h, all_a)]) * 100),
            "ai_bias": _r((_mean(all_a) - _mean(all_h)) * 100),
        }
    hum_rank = sorted([r for r in slot_rows if r["human_score"] is not None], key=lambda r: -r["human_score"])
    ai_rank = sorted([r for r in slot_rows if r["ai_score"] is not None], key=lambda r: -r["ai_score"])
    agreement["human_ranking"] = [r["slot"] for r in hum_rank]
    agreement["ai_ranking"] = [r["slot"] for r in ai_rank]
    disagreements.sort(key=lambda d: -d["diff"])

    # ---- length bias signal: does judge score correlate with output length? ----
    lens, ai_vals, hum_vals, lens_h = [], [], [], []
    for g in generations:
        gs = gen_scores.get(g["id"], {})
        if gs.get("ai") is not None:
            lens.append(len((g.get("output") or "").split())); ai_vals.append(gs["ai"])
        if gs.get("human") is not None:
            lens_h.append(len((g.get("output") or "").split())); hum_vals.append(gs["human"])
    bias = {"ai_score_vs_length_r": _r(pearson(lens, ai_vals), 3), "human_score_vs_length_r": _r(pearson(lens_h, hum_vals), 3)}

    human_crit = [cid for cid, c in criteria.items() if c.get("graded_by", "both") in ("human", "both")]
    ai_crit = [cid for cid, c in criteria.items() if c.get("graded_by", "both") in ("ai", "both")]
    done_gens = [g for g in generations if g.get("status") == "done" and not g.get("error")]
    progress = {
        "generations_total": len(generations),
        "generations_done": sum(1 for g in generations if g.get("status") in ("done", "error")),
        "human_needed": len(done_gens) * len(human_crit),
        "human_done": sum(1 for g in done_gens for cid in human_crit if cid in by_gen.get(g["id"], {}).get("human", {})),
        "ai_needed": len(done_gens) * len(ai_crit),
        "ai_done": sum(1 for g in done_gens for cid in ai_crit if cid in by_gen.get(g["id"], {}).get("ai", {})),
    }

    return {
        "slots": slot_rows, "cases": case_rows, "agreement": agreement,
        "disagreements": disagreements[:25], "bias": bias, "progress": progress,
    }


def _r(x, nd=1):
    return None if x is None else round(x, nd)
