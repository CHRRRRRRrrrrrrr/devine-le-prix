"""Prépare un petit JSON de ventes jouables à partir des CSV géo-DVF.

Usage :
    python scripts/prepare_dvf.py data_raw/69_2024.csv.gz data_raw/69_2025.csv.gz -o public/data/lyon.json

Sources : https://files.data.gouv.fr/geo-dvf/latest/csv/<annee>/departements/<dep>.csv.gz

Filtres :
- nature_mutation = Vente, commune = un arrondissement de Lyon (69381-69389)
- exactement un logement (Appartement ou Maison) par mutation ; dépendances
  (cave, parking) tolérées et comptées ; tout local commercial/industriel => rejet
- surface, prix et prix au m² dans des bornes plausibles (prix symboliques et
  lignes aberrantes exclus)

Confidentialité (conditions DVF) : on ne garde ni le numéro de rue ni la
parcelle, et les coordonnées sont arrondies à ~100 m.
"""
import argparse
import csv
import gzip
import json
import random
import re
import statistics
from collections import defaultdict

LYON = {f"6938{i}": i for i in range(1, 10)}
SMALL_WORDS = {"de", "des", "du", "la", "le", "les", "et", "aux", "au", "en", "sur", "sous", "a"}
# Abréviations de types de voie et de prénoms utilisées par DVF
ABBREV = {
    "av": "avenue", "bd": "boulevard", "crs": "cours", "pl": "place", "qua": "quai",
    "che": "chemin", "imp": "impasse", "all": "allée", "mte": "montée", "pas": "passage",
    "sq": "square", "rte": "route", "rpt": "rond-point", "esp": "esplanade", "prom": "promenade",
    "sen": "sentier", "ham": "hameau", "res": "résidence", "grde": "grande", "gde": "grande", "pte": "petite",
    "montee": "montée",
    "st": "saint", "ste": "sainte", "gen": "général", "mal": "maréchal", "pr": "professeur",
}

MIN_SURFACE, MAX_SURFACE = 9, 350
MIN_PRICE, MAX_PRICE = 30_000, 3_000_000
MIN_M2, MAX_M2 = 1_500, 15_000
MEDIAN_RANGE = (0.6, 1.8)  # prix au m² toléré par rapport à la médiane de l'arrondissement


def nice_street(name):
    parts = name.lower().split()
    # "GR"/"PTR" = types de voie « Grande/Petite Rue », souvent suivis du nom complet :
    # "GR GRANDE RUE", "GR GDE RUE DE VAISE", "GR RUE DE LA MALADIERE", "PTR PETITE RUE DE MONPLAISIR"
    prefix = {"gr": "grande", "ptr": "petite"}.get(parts[0]) if len(parts) > 1 else None
    if prefix:
        parts = parts[1:] if parts[1][0] == prefix[0] else [prefix] + parts[1:]
    if parts and parts[0] == "gd":
        parts[0] = "grande"
    words = []
    for i, w in enumerate(parts):
        w = "-".join(ABBREV.get(p, p) for p in w.split("-"))
        if i > 0 and w in SMALL_WORDS:
            words.append(w)
        elif re.match(r"^[dl]'", w):
            words.append(w[:2] + w[2:].capitalize())
        else:
            words.append("-".join(p.capitalize() for p in w.split("-")))
    return " ".join(words)


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def read_mutations(paths):
    muts = defaultdict(list)
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="") as f:
            for row in csv.DictReader(f):
                if row["nature_mutation"] == "Vente" and row["code_commune"] in LYON:
                    muts[row["id_mutation"]].append(row)
    return muts


def clean(rows):
    logements, deps = set(), 0
    for r in rows:
        t = r["type_local"]
        if t in ("Appartement", "Maison"):
            logements.add((t, r["surface_reelle_bati"], r["nombre_pieces_principales"]))
        elif t.startswith("D"):  # Dépendance
            deps += 1
        elif t:  # local industriel / commercial
            return None
    if len(logements) != 1 or len({r["valeur_fonciere"] for r in rows}) != 1:
        return None

    t, surface, pieces = next(iter(logements))
    ref = next(r for r in rows if r["type_local"] == t)
    price, surface, pieces = to_float(ref["valeur_fonciere"]), to_float(surface), to_float(pieces)
    lat, lon = to_float(ref["latitude"]), to_float(ref["longitude"])
    if None in (price, surface, pieces, lat, lon) or pieces < 1:
        return None
    if not (MIN_SURFACE <= surface <= MAX_SURFACE and MIN_PRICE <= price <= MAX_PRICE):
        return None
    if not (MIN_M2 <= price / surface <= MAX_M2):
        return None

    terrain = max((to_float(r["surface_terrain"]) or 0 for r in rows), default=0)
    return {
        "t": "A" if t == "Appartement" else "M",
        "p": int(round(price)),
        "s": int(round(surface)),
        "r": int(pieces),
        "a": LYON[ref["code_commune"]],
        "v": nice_street(ref["adresse_nom_voie"]) if ref["adresse_nom_voie"] else "",
        "d": ref["date_mutation"][:7],
        "x": round(lon, 3),
        "y": round(lat, 3),
        "k": deps,
        **({"g": int(terrain)} if t == "Maison" and terrain else {}),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--max", type=int, default=6000, help="taille max de l'échantillon")
    args = ap.parse_args()

    muts = read_mutations(args.inputs)
    sales = [s for s in (clean(rows) for rows in muts.values()) if s]
    print(f"{len(muts)} mutations à Lyon, {len(sales)} ventes simples")

    # Viagers, ventes de parts, biens à rénover entièrement… : on écarte les prix au m²
    # trop loin de la médiane de l'arrondissement (et du type de bien).
    medians = {}
    for key in {(s["a"], s["t"]) for s in sales}:
        medians[key] = statistics.median(s["p"] / s["s"] for s in sales if (s["a"], s["t"]) == key)
    sales = [s for s in sales if MEDIAN_RANGE[0] <= s["p"] / s["s"] / medians[(s["a"], s["t"])] <= MEDIAN_RANGE[1]]
    print(f"{len(sales)} ventes jouables après filtre des prix atypiques")

    rnd = random.Random(42)
    rnd.shuffle(sales)
    sales = sales[: args.max]
    sales.sort(key=lambda s: (s["d"], s["a"], s["p"]))  # ordre stable, sans lien avec l'ordre DVF

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(sales, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(sales)} ventes écrites dans {args.output}")


if __name__ == "__main__":
    main()
