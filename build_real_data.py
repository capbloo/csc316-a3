import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path("dataverse_files")
OUT = Path("data.js")

CITY_META = {
    "Alaska": {"city": "Alaska", "state": "AK", "lat": 64.2, "lng": -152.5},
    "Maine": {"city": "Maine", "state": "ME", "lat": 45.25, "lng": -69.0},
    "NewYorkCity": {"city": "New York City", "state": "NY", "lat": 40.71, "lng": -74.00},
    "Minneapolis": {"city": "Minneapolis", "state": "MN", "lat": 44.98, "lng": -93.27},
    "Bloomington": {"city": "Bloomington", "state": "MN", "lat": 44.84, "lng": -93.30},
    "SanFrancisco": {"city": "San Francisco", "state": "CA", "lat": 37.77, "lng": -122.42},
    "Oakland": {"city": "Oakland", "state": "CA", "lat": 37.80, "lng": -122.27},
    "Berkeley": {"city": "Berkeley", "state": "CA", "lat": 37.87, "lng": -122.27},
    "SanLeandro": {"city": "San Leandro", "state": "CA", "lat": 37.72, "lng": -122.16},
    "Burlington": {"city": "Burlington", "state": "VT", "lat": 44.48, "lng": -73.21},
    "SantaFe": {"city": "Santa Fe", "state": "NM", "lat": 35.69, "lng": -105.94},
    "PortlandOR": {"city": "Portland", "state": "OR", "lat": 45.52, "lng": -122.68},
    "PortlandME": {"city": "Portland", "state": "ME", "lat": 43.66, "lng": -70.26},
    "Boulder": {"city": "Boulder", "state": "CO", "lat": 40.01, "lng": -105.27},
    "Vineyard": {"city": "Vineyard", "state": "UT", "lat": 40.30, "lng": -111.75},
    "Eastpointe": {"city": "Eastpointe", "state": "MI", "lat": 42.47, "lng": -82.95},
    "Minnetonka": {"city": "Minnetonka", "state": "MN", "lat": 44.92, "lng": -93.47},
    "StLouisPark": {"city": "St. Louis Park", "state": "MN", "lat": 44.95, "lng": -93.37},
    "TakomaPark": {"city": "Takoma Park", "state": "MD", "lat": 38.98, "lng": -77.01},
    "RedondoBeach": {"city": "Redondo Beach", "state": "CA", "lat": 33.85, "lng": -118.39},
    "PierceCounty": {"city": "Pierce County", "state": "WA", "lat": 47.04, "lng": -122.13},
    "LasCruces": {"city": "Las Cruces", "state": "NM", "lat": 32.32, "lng": -106.76},
    "Springville": {"city": "Springville", "state": "UT", "lat": 40.17, "lng": -111.61},
    "Corvallis": {"city": "Corvallis", "state": "OR", "lat": 44.56, "lng": -123.26},
    "WoodlandHills": {"city": "Woodland Hills", "state": "UT", "lat": 40.01, "lng": -111.65},
    "Westbrook": {"city": "Westbrook", "state": "ME", "lat": 43.68, "lng": -70.37},
    "USVirginIslands": {"city": "US Virgin Islands", "state": "VI", "lat": 18.34, "lng": -64.90},
    "ElkRidge": {"city": "Elk Ridge", "state": "UT", "lat": 40.02, "lng": -111.67},
    "Easthampton": {"city": "Easthampton", "state": "MA", "lat": 42.27, "lng": -72.67},
}

INVALID_VALUES = {
    "",
    "skipped",
    "skip",
    "overvote",
    "undervote",
    "write-in",
    "write in",
    "writein",
    "write ins",
    "blank",
    "none",
    "nan",
    "null",
    "no rank",
    "unranked",
    "exhausted",
}


def normalize_candidate_name(value: str) -> str:
    text = re.sub(r"\s+", " ", (value or "").strip())
    if not text:
        return ""

    letters_only = re.sub(r"[^A-Za-z]", "", text)
    if letters_only and letters_only.isupper():
        text = re.sub(r"[A-Za-z]+", lambda m: m.group(0)[0].upper() + m.group(0)[1:].lower(), text)
    return text


def clean_choice(value: str) -> str:
    v = (value or "").strip()
    if not v:
        return ""
    low = v.lower()
    if low in INVALID_VALUES or "write-in" in low:
        return ""
    return normalize_candidate_name(v)


def parse_ballots(csv_path: Path):
    ballots = []
    reader = None
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            with csv_path.open("r", newline="", encoding=encoding) as f:
                reader = csv.DictReader(f)
                if not reader.fieldnames:
                    return ballots
                rank_cols = [c for c in reader.fieldnames if re.fullmatch(r"rank\d+", c, flags=re.IGNORECASE)]
                rank_cols.sort(key=lambda c: int(re.findall(r"\d+", c)[0]))

                for row in reader:
                    ranking = []
                    seen = set()
                    for col in rank_cols:
                        cand = clean_choice(row.get(col, ""))
                        if not cand or cand in seen:
                            continue
                        ranking.append(cand)
                        seen.add(cand)
                    if ranking:
                        ballots.append(ranking)
                return ballots
        except UnicodeDecodeError:
            ballots = []
            continue

    return ballots


def plurality_winner(ballots):
    c = Counter()
    for b in ballots:
        c[b[0]] += 1
    return sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if c else None


def irv_winner(ballots):
    candidates = sorted({cand for b in ballots for cand in b})
    active = set(candidates)
    if not active:
        return None

    while len(active) > 1:
        counts = Counter()
        for ballot in ballots:
            for cand in ballot:
                if cand in active:
                    counts[cand] += 1
                    break

        if not counts:
            return sorted(active)[0]

        total = sum(counts.values())
        for cand, votes in counts.items():
            if votes > total / 2:
                return cand

        min_votes = min(counts.get(c, 0) for c in active)
        losers = sorted([c for c in active if counts.get(c, 0) == min_votes])
        active.remove(losers[0])

    return sorted(active)[0]


def compute_pairwise(ballots):
    candidates = sorted({cand for b in ballots for cand in b})
    if len(candidates) < 2:
        return candidates, {}

    pair = {a: {b: 0 for b in candidates if b != a} for a in candidates}

    for ballot in ballots:
        pos = {cand: idx for idx, cand in enumerate(ballot)}
        ranked = set(pos.keys())
        for a in candidates:
            for b in candidates:
                if a == b:
                    continue
                a_in = a in ranked
                b_in = b in ranked
                if a_in and b_in:
                    if pos[a] < pos[b]:
                        pair[a][b] += 1
                elif a_in and not b_in:
                    pair[a][b] += 1

    return candidates, pair


def condorcet_winner_from_pairwise(candidates, pair):
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    winners = []
    for a in candidates:
        if all(pair[a][b] > pair[b][a] for b in candidates if b != a):
            winners.append(a)

    return winners[0] if len(winners) == 1 else None


def build_pairwise_ratios(candidates, pair):
    ratios = {}
    for a in candidates:
        versus = {}
        for b in candidates:
            if a == b:
                continue
            a_over_b = pair[a][b]
            b_over_a = pair[b][a]
            total = a_over_b + b_over_a
            versus[b] = round(a_over_b / total, 4) if total else None
        ratios[a] = versus
    return ratios


def next_active_choice(ballot, active):
    for cand in ballot:
        if cand in active:
            return cand
    return None


def build_sankey(ballots):
    candidates = sorted({cand for b in ballots for cand in b})
    if not candidates:
        return {"nodes": [], "links": [], "rounds": []}

    nodes = {}
    links = Counter()
    rounds = []
    active = set(candidates)
    round_idx = 1

    def node_id(stage, name):
        return f"R{stage}:{name}"

    def ensure_node(stage, name):
        nid = node_id(stage, name)
        if nid not in nodes:
            nodes[nid] = {"id": nid, "name": name, "stage": stage}
        return nid

    while active:
        tallies = Counter()
        assignments = []
        for ballot in ballots:
            choice = next_active_choice(ballot, active)
            assignments.append(choice)
            if choice is not None:
                tallies[choice] += 1

        exhausted_count = len(ballots) - sum(tallies.values())
        for cand in sorted(active):
            ensure_node(round_idx, cand)
        if exhausted_count > 0:
            ensure_node(round_idx, "Exhausted")

        total_active = sum(tallies.values())
        majority_winner = None
        if total_active > 0:
            for cand, votes in tallies.items():
                if votes > total_active / 2:
                    majority_winner = cand
                    break

        round_record = {
            "stage": round_idx,
            "activeCandidates": sorted(active),
            "tallies": {cand: tallies.get(cand, 0) for cand in sorted(active)},
            "exhausted": exhausted_count,
        }

        if len(active) == 1 or majority_winner is not None:
            round_record["winner"] = majority_winner or sorted(active)[0]
            rounds.append(round_record)
            break

        min_votes = min(tallies.get(c, 0) for c in active)
        losers = sorted([c for c in active if tallies.get(c, 0) == min_votes])
        eliminated = losers[0]
        round_record["eliminated"] = eliminated
        rounds.append(round_record)

        next_active = set(active)
        next_active.remove(eliminated)

        for cand in sorted(next_active):
            ensure_node(round_idx + 1, cand)
        ensure_node(round_idx + 1, "Exhausted")

        for choice, ballot in zip(assignments, ballots):
            source_name = choice if choice is not None else "Exhausted"
            if choice == eliminated:
                target_choice = next_active_choice(ballot, next_active)
                target_name = target_choice if target_choice is not None else "Exhausted"
            elif choice in next_active:
                target_name = choice
            else:
                target_name = "Exhausted"

            source_id = ensure_node(round_idx, source_name)
            target_id = ensure_node(round_idx + 1, target_name)
            links[(source_id, target_id)] += 1

        active = next_active
        round_idx += 1

    sorted_nodes = sorted(nodes.values(), key=lambda n: (n["stage"], n["name"]))
    sorted_links = [
        {"source": source, "target": target, "value": value}
        for (source, target), value in sorted(links.items(), key=lambda item: (item[0][0], item[0][1]))
    ]

    return {
        "nodes": sorted_nodes,
        "links": sorted_links,
        "rounds": rounds,
    }


def classify(irv, plurality, cond):
    if cond is None:
        return "purple"
    if irv == cond and plurality == cond:
        return "green"
    if irv == cond and plurality != cond:
        return "blue"
    return "yellow"


def result_note(category, irv, plurality, cond, ballots_count, candidate_count, pairwise_ratios=None):
    if category == "purple":
        if pairwise_ratios:
            ratio_bits = []
            for cand in sorted(pairwise_ratios.keys()):
                versus = pairwise_ratios[cand]
                details = ", ".join(
                    f"{opp}:{ratio:.1%}" for opp, ratio in sorted(versus.items()) if ratio is not None
                )
                ratio_bits.append(f"{cand} over others -> {details}")
            return (
                f"No Condorcet winner found from {ballots_count} ballots and {candidate_count} candidates. "
                f"Pairwise preference ratios: {'; '.join(ratio_bits)}."
            )
        return f"No Condorcet winner found from {ballots_count} ballots and {candidate_count} candidates."
    return f"IRV winner: {irv}. Plurality leader: {plurality}. Condorcet winner: {cond}."


def parse_filename(fp: Path):
    parts = fp.stem.split("_")
    city_key = parts[0]
    year = 0
    split_idx = 1
    for i, part in enumerate(parts[1:], start=1):
        if re.fullmatch(r"\d{8}", part):
            year = int(part[:4])
            split_idx = i + 1
            break
    office = " ".join(parts[split_idx:]).replace("-", " ").strip() or "Election"
    return city_key, year, office


files = sorted(BASE.glob("*.csv"))
by_city = defaultdict(list)
summary = Counter()
skipped_unknown = Counter()

for fp in files:
    city_key, year, office = parse_filename(fp)
    ballots = parse_ballots(fp)
    if not ballots:
        continue

    irv = irv_winner(ballots)
    plurality = plurality_winner(ballots)
    candidates, pairwise = compute_pairwise(ballots)
    cond = condorcet_winner_from_pairwise(candidates, pairwise)
    category = classify(irv, plurality, cond)
    summary[category] += 1
    pairwise_ratios = build_pairwise_ratios(candidates, pairwise) if cond is None else None
    sankey = build_sankey(ballots)

    candidate_count = len(candidates)
    note = result_note(category, irv, plurality, cond, len(ballots), candidate_count, pairwise_ratios)

    if city_key not in CITY_META:
        skipped_unknown[city_key] += 1
        continue

    by_city[city_key].append({
        "year": year,
        "office": office,
        "condorcet": category,
        "notes": note,
        "sankey": sankey,
        "pairwiseRatios": pairwise_ratios,
    })

jurisdictions = []
for city_key, elections in sorted(by_city.items()):
    meta = CITY_META[city_key]
    elections.sort(key=lambda e: (e["year"], e["office"]))
    jurisdictions.append(
        {
            "city": meta["city"],
            "state": meta["state"],
            "lat": meta["lat"],
            "lng": meta["lng"],
            "elections": elections,
        }
    )

total_elections = sum(len(j["elections"]) for j in jurisdictions)
out_lines = []
out_lines.append("// Election dataset derived from dataverse_files CSV ballots")
out_lines.append(f"// Processed files: {len(files)}")
out_lines.append(f"// Included elections: {total_elections}")
out_lines.append(
    f"// Category counts: green={summary['green']}, blue={summary['blue']}, yellow={summary['yellow']}, purple={summary['purple']}"
)
if skipped_unknown:
    skipped_desc = ", ".join(f"{k}:{v}" for k, v in sorted(skipped_unknown.items()))
    out_lines.append(f"// Skipped unknown location keys: {skipped_desc}")
out_lines.append("window.JURISDICTIONS = " + json.dumps(jurisdictions, indent=2) + ";")

OUT.write_text("\n".join(out_lines) + "\n", encoding="utf-8")

print(f"Wrote {OUT} with {len(jurisdictions)} jurisdictions and {total_elections} elections")
print("Category counts:", dict(summary))
if skipped_unknown:
    print("Skipped unknown location keys:", dict(skipped_unknown))
