# Devine le prix — Lyon

Jeu PWA : on montre une vraie vente immobilière lyonnaise (DVF), le joueur estime le prix, on révèle le vrai.

## Lancer en local

```bash
python -m http.server 5173 --directory public
```

Puis ouvrir http://localhost:5173. Aucune étape de build : HTML/CSS/JS + Leaflet (CDN).

## Régénérer les données

```bash
curl -o data_raw/69_2024.csv.gz https://files.data.gouv.fr/geo-dvf/latest/csv/2024/departements/69.csv.gz
curl -o data_raw/69_2025.csv.gz https://files.data.gouv.fr/geo-dvf/latest/csv/2025/departements/69.csv.gz
python scripts/prepare_dvf.py data_raw/69_2024.csv.gz data_raw/69_2025.csv.gz -o public/data/lyon.json
```

Filtres appliqués (voir `scripts/prepare_dvf.py`) : ventes simples d'un seul logement (dépendances tolérées),
pas de local commercial, surface 9–350 m², prix 30 k€–3 M€, prix au m² entre 0,6× et 1,8× la médiane
de l'arrondissement. Résultat actuel : ~11 900 ventes jouables, échantillon de 6 000 (≈ 600 Ko).

Format compact d'une vente : `t` type (A/M), `p` prix, `s` surface, `r` pièces, `a` arrondissement,
`v` voie, `d` mois de vente, `x`/`y` lon/lat arrondies, `k` nb de dépendances, `g` terrain (maisons).

## Conformité DVF

- `<meta name="robots" content="noindex">` + `robots.txt` qui interdit tout.
- Ni numéro de rue ni parcelle ; coordonnées arrondies à ~100 m, carte affichée comme une zone.

## Fonctionnement

- **Défi du jour** : graine = date locale (`lyon:AAAA-MM-JJ`) → mêmes 5 biens pour tous. Le résultat
  est stocké avec les biens eux-mêmes, donc il reste juste même si les données sont régénérées
  (mais le défi d'un jour donné change si `lyon.json` change ce jour-là).
- **Score** : 1000 pts à ±2 %, puis linéaire jusqu'à 0 à ±50 %. Grille 🟩 ≥800, 🟨 ≥500, 🟧 >0, 🟥 0.
- **Stockage** : `localStorage` (`dlp:v1`) : historique, défis joués, série.
- **Service worker** : réseau d'abord, cache en secours (jeu jouable hors ligne, hors tuiles de carte).

## Déployer (gratuit)

Publier le dossier `public/` sur GitHub Pages, Netlify ou Vercel (chemins relatifs, fonctionne dans un sous-dossier).

## À faire ensuite

- Icônes PNG 192/512 px (certaines versions d'Android refusent l'installation avec seulement un SVG).
- Tester avec des proches, ajuster la difficulté (bornes de score, curseur).
- Plus de villes : rendre la liste des communes et le fichier de données paramétrables.
