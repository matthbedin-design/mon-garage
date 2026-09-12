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
  option. Le service email intégré Supabase suffit pour un usage personnel
  (limite de volume, sans nom de domaine à configurer) — voir la section
  Auth > Email du dashboard.
- **Base de données** : les tables listées ci-dessous, toutes avec Row Level
  Security (RLS) activé — sans quoi n'importe quel détenteur de la clé anon
  pourrait lire/écrire les données de tous les utilisateurs.
- **Storage** : un bucket privé `vehicle-documents` pour les photos/factures,
  avec des policies RLS scopées par utilisateur.
- **Edge Functions** : `send-reminders` (cron quotidien, rappels d'échéances
  par e-mail via Resend), `send-history` (export d'historique par e-mail),
  `resolve-user-email` (résout un e-mail en `user_id` côté serveur pour le
  partage de véhicule, sans exposer la table des utilisateurs au client).

### Schéma des tables

⚠️ Cette section est **reconstituée à partir du code** (colonnes lues/écrites
par `data-sync-calc.js` et `vehicle-modals.js`), pas exportée directement
depuis le projet Supabase — utile comme point de départ ou pour recréer le
projet ailleurs, mais à vérifier/compléter avec le schéma réel (types précis,
contraintes, index, policies exactes) via `Database > Schema` ou un
`pg_dump` du projet existant si vous voulez une référence fiable à 100 %.

| Table | Rôle | Colonnes principales |
|---|---|---|
| `vehicles` | Un véhicule | `id`, `owner_id`, `name`, `plate`, `color`, `mileage`, `vehicle_type`, `enabled_types` (jsonb), `intervals` (jsonb), `documents` (jsonb), `brand`, `model`, `year`, `vin`, `fuel`, `first_reg_date`, `insurance`, `sort_order` |
| `entries` | Une intervention réalisée | `id`, `vehicle_id`, `type_id`, `date`, `km`, `cost`, `notes`, `garage`, `supplier`, `invoice_doc` (jsonb), `batch_id`, `ct` (jsonb), `documents` (jsonb), `created_at`, `updated_at`, `session_id`, `created_by` |
| `sessions` | Une fiche de vérification (checklist) | `id`, `vehicle_id`, `data` (jsonb), `status`, `created_by` |
| `planned_interventions` | Une intervention "à prévoir" | `id`, `vehicle_id`, `label`, `notes`, `created_at`, `source_session_id`, `source_item_id`, `created_by` |
| `user_settings` | Réglages non partagés par utilisateur | `user_id` (PK), `journal` (jsonb), `types` (jsonb), `checklist_items` (jsonb), `updated_at` |
| `vehicle_shares` | Partage d'un véhicule avec un autre compte | `id`, `vehicle_id`, `owner_id`, `invited_email`, `role` (`viewer`/`contributor`/`editor`), `shared_with_user_id`, `status` (`pending`/`active`) |
| `user_data` | Miroir JSON complet de l'état (pour l'historique/sauvegardes uniquement, plus utilisé pour charger l'app) | `user_id` (PK), `state` (jsonb), `updated_at` |
| `user_data_history` | Archive automatique (trigger sur `user_data`), purgée après 90 jours | `id`, `user_id`, `state` (jsonb), `updated_at`, `archived_at` |

Policies RLS attendues (résumé, à écrire précisément côté SQL) :
- `vehicles`/`entries`/`sessions`/`planned_interventions` : lecture/écriture
  autorisée au propriétaire (`owner_id` / via le véhicule associé) et aux
  comptes ayant un partage `active` sur ce véhicule (droits différenciés
  selon `role` : `viewer` en lecture seule, `contributor` peut ajouter,
  `editor`/`owner` peuvent tout modifier — ce contrôle fin est fait côté
  client dans `canEditVehicle`/`canContribute`, la policy RLS doit au
  minimum garantir qu'un utilisateur ne voit que ses véhicules + ceux
  partagés avec lui).
- `user_settings`, `user_data` : strictement `auth.uid() = user_id`.
- `vehicle_shares` : le propriétaire gère (crée/révoque) les partages de ses
  véhicules ; un utilisateur invité peut s'auto-attribuer un partage
  `pending` dont l'e-mail correspond au sien (policy "shares_self_claim"
  utilisée par `claimPendingShares()`), mais rien de plus.
- Bucket `vehicle-documents` : accès restreint au dossier
  `{user_id}/{vehicle_id}/...` du propriétaire (les URLs consultées par les
  autres utilisateurs passent par des URLs signées temporaires générées côté
  client via un appel authentifié, pas par un accès public au bucket).

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
