# mon-garage — Carnet de bord entretien véhicules

Application web (PWA) de suivi d'entretien de véhicules : échéances (vidange,
CT, filtres, pneus...), historique des interventions, checklists de
vérification, coûts, export PDF/CSV, partage entre utilisateurs. Synchronisée
en temps réel via Supabase, installable sur mobile et desktop.

## Installation

L'app est 100% statique (HTML/CSS/JS, aucun build) :

1. Servez le dossier tel quel (GitHub Pages, Netlify, ou un simple
   `python3 -m http.server` en local). Un vrai serveur HTTP est nécessaire
   (pas d'ouverture directe du fichier via `file://`), car le service
   worker/manifest PWA et Supabase Auth (redirection du lien magique) exigent
   une origine http(s).
2. Renseignez votre projet Supabase dans `config.js` (voir ci-dessous).
3. Ouvrez la page : à la première connexion, l'app crée automatiquement vos
   réglages par défaut (types d'entretien, checklist) au premier
   enregistrement.

## Configuration Supabase

Dans `config.js`, renseignez :

```js
var SUPABASE_URL = "https://VOTRE-PROJET.supabase.co";
var SUPABASE_KEY = "VOTRE_CLE_ANON_PUBLIQUE"; // Project Settings > API — jamais la clé service_role
```

Côté projet Supabase, il faut mettre en place :

- **Auth** : lien magique (OTP par e-mail) activé par défaut ; mot de passe en
  option, minimum 8 caractères. Le service email intégré Supabase suffit pour
  un usage personnel (limite de volume, sans nom de domaine à configurer) —
  voir la section Auth > Email du dashboard.
- **Base de données** : les tables, policies RLS et fonctions décrites dans
  [`SUPABASE.md`](./SUPABASE.md) — sans RLS correctement configurée,
  n'importe quel détenteur de la clé anon pourrait lire/écrire les données de
  tous les utilisateurs.
- **Storage** : bucket privé `vehicle-documents`, restreint à
  `image/jpeg`/`application/pdf` (voir `SUPABASE.md`).
- **Edge Functions** : `send-reminders`, `send-history`, `resolve-user-email`
  (voir `SUPABASE.md`).

Le détail complet et vérifié (schéma, policies RLS, fonctions
`SECURITY DEFINER`, triggers, réglages Storage/Auth) vit dans
[`SUPABASE.md`](./SUPABASE.md) — c'est la référence à jour, à consulter avant
de reposer une question déjà tranchée côté Supabase, et à mettre à jour à
chaque changement de ce côté-là.

## Structure du code

Aucun bundler : les fichiers JS sont chargés dans l'ordre via `<script>` dans
`index.html` et partagent un état global (`state`).

- `config.js` — configuration Supabase, types d'entretien et checklist par
  défaut, état global (`state`).
- `ui-common.js` — utilitaires transverses (confirmation/alerte, formatage,
  compression d'images, upload/URLs signées Storage, graphique de coûts SVG).
- `data-sync-calc.js` — persistance cloud (`loadState`/`persist`), auth,
  partage de véhicules, calcul des échéances (`computeStatus`).
- `render.js` — rendu de l'interface (tableau de bord, fiche véhicule,
  historique filtrable).
- `entry-modal.js` — modale d'ajout/édition d'une intervention (dont la
  section Contrôle Technique et contre-visite).
- `vehicle-modals.js` — modales véhicule : réglages, ajout, suppression,
  partage.
- `checklist-sessions.js` — fiches de vérification (checklist), interventions
  à prévoir.
- `export-dossier.js` — export PDF (impression), CSV, et par e-mail.
- `journal-backups-init.js` — journal d'activité, sauvegardes/restauration,
  compte, câblage des événements globaux et démarrage de l'app.

## Limites connues

- Pas de mode hors-ligne : l'app nécessite une connexion à Supabase pour
  fonctionner (aucune donnée de secours locale si le réseau est coupé).
- Concurrence "dernier écrivain gagne" sur les tables normalisées lors
  d'écritures quasi simultanées depuis deux appareils (le jeton de
  concurrence optimiste ne protège que le miroir `user_data`) — acceptable
  pour un usage personnel/familial avec peu d'écritures concurrentes.
