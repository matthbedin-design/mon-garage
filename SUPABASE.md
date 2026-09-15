# Configuration Supabase — référence

Ce fichier est la source de référence pour tout ce qui vit côté Supabase
(schéma, sécurité, storage, auth) et qui n'apparaît nulle part dans le code
JS de l'app. Objectif : ne plus avoir à réexpliquer ou re-vérifier ces points
à chaque nouvelle session de travail. À tenir à jour à chaque changement côté
dashboard/SQL — voir le journal en bas de fichier.

Dernière vérification complète : **13 septembre 2026**.

## Modèle de rôles

Un véhicule a un propriétaire (`vehicles.owner_id`) et peut être partagé avec
d'autres comptes via `vehicle_shares`, avec un rôle parmi :

| Rôle | Lecture | Ajouter (intervention/session/à prévoir) | Modifier réglages véhicule / éditer-supprimer une ligne existante | Supprimer le véhicule |
|---|---|---|---|---|
| `owner` (implicite, pas une valeur de `role`) | ✅ | ✅ | ✅ | ✅ |
| `editor` | ✅ | ✅ | ✅ | ❌ |
| `contributor` | ✅ | ✅ | ❌ | ❌ |
| `viewer` | ✅ | ❌ | ❌ | ❌ |

Ce tableau doit rester identique des deux côtés : côté client dans
`getVehicleRole`/`canEditVehicle`/`canContribute` (`data-sync-calc.js`), et
côté serveur dans les fonctions RLS ci-dessous. Le client ne fait que
*refléter* ce que la RLS autorise déjà — il ne faut jamais ajouter une
restriction uniquement côté client sans l'ajouter aussi en RLS.

## Schéma des tables

| Table | Rôle | Colonnes principales |
|---|---|---|
| `vehicles` | Un véhicule | `id`, `owner_id`, `name`, `plate`, `color`, `mileage`, `vehicle_type`, `enabled_types` (jsonb), `intervals` (jsonb), `documents` (jsonb), `brand`, `model`, `year`, `vin`, `fuel`, `first_reg_date`, `insurance`, `sort_order` |
| `entries` | Une intervention réalisée | `id`, `vehicle_id`, `type_id`, `date`, `km`, `cost`, `notes`, `garage`, `supplier`, `invoice_doc` (jsonb), `batch_id`, `ct` (jsonb), `documents` (jsonb), `created_at`, `updated_at`, `session_id`, `created_by` |
| `sessions` | Une fiche de vérification (checklist) | `id`, `vehicle_id`, `data` (jsonb), `status`, `created_by` |
| `planned_interventions` | Une intervention "à prévoir" | `id`, `vehicle_id`, `label`, `notes`, `created_at`, `source_session_id`, `source_item_id`, `created_by` |
| `user_settings` | Réglages non partagés par utilisateur | `user_id` (PK), `journal` (jsonb), `types` (jsonb), `checklist_items` (jsonb), `updated_at` |
| `vehicle_shares` | Partage d'un véhicule avec un autre compte | `id`, `vehicle_id`, `owner_id`, `invited_email`, `role` (`viewer`/`contributor`/`editor`), `shared_with_user_id`, `status` (`pending`/`active`) |
| `user_data` | Miroir JSON complet de l'état (source des sauvegardes/historique ; n'est plus utilisé pour charger l'app, best-effort) | `user_id` (PK), `state` (jsonb), `updated_at` |
| `user_data_history` | Archive automatique (trigger sur `user_data`), purgée après 90 jours | `id`, `user_id`, `state` (jsonb), `updated_at`, `archived_at` |

## Policies RLS (vérifiées en direct le 13/09/2026)

Récupérées via :
```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
```

| Table | Policy | Commande | USING | WITH CHECK |
|---|---|---|---|---|
| `vehicles` | `vehicles_select` | SELECT | `owner_id = auth.uid() OR has_vehicle_access(id)` | — |
| `vehicles` | `vehicles_insert` | INSERT | — | `owner_id = auth.uid()` |
| `vehicles` | `vehicles_update` | UPDATE | `can_edit_vehicle(id)` | — |
| `vehicles` | `vehicles_delete` | DELETE | `owner_id = auth.uid()` | — |
| `entries` | `entries_select` | SELECT | `has_vehicle_access(vehicle_id)` | — |
| `entries` | `entries_insert` | INSERT | — | `has_contribute_access(vehicle_id)` |
| `entries` | `entries_update` | UPDATE | `can_edit_vehicle(vehicle_id)` | — |
| `entries` | `entries_delete` | DELETE | `can_edit_vehicle(vehicle_id)` | — |
| `sessions` | `sessions_*` | (idem entries) | même schéma que `entries`, sur `vehicle_id` | |
| `planned_interventions` | `planned_*` | (idem entries) | même schéma que `entries`, sur `vehicle_id` | |
| `vehicle_shares` | `shares_select` | SELECT | `owner_id = auth.uid() OR shared_with_user_id = auth.uid()` | — |
| `vehicle_shares` | `shares_select_pending_by_email` | SELECT | `status='pending' AND invited_email is not null AND lower(invited_email) = lower(auth.jwt()->>'email')` | — |
| `vehicle_shares` | `shares_insert` | INSERT | — | `owner_id = auth.uid()` |
| `vehicle_shares` | `shares_update` | UPDATE | `owner_id = auth.uid()` | — (usage réel : owner ne fait jamais d'UPDATE côté client, seulement delete+insert pour changer un rôle) |
| `vehicle_shares` | `shares_self_claim` | UPDATE | `status='pending' AND invited_email is not null AND lower(invited_email)=lower(auth.jwt()->>'email')` | `shared_with_user_id = auth.uid() AND status = 'active'` |
| `vehicle_shares` | `shares_delete` | DELETE | `owner_id = auth.uid()` | — |
| `user_data` | `user_data_owner` | ALL | `auth.uid() = user_id` | `auth.uid() = user_id` |
| `user_settings` | `settings_select` / `settings_insert` / `settings_update` | SELECT/INSERT/UPDATE | `user_id = auth.uid()` | `user_id = auth.uid()` |

Pas de policy DELETE sur `user_settings` (personne ne peut supprimer sa ligne
de réglages via l'API — non bloquant, l'app ne le fait jamais).

## Fonctions `SECURITY DEFINER` (vérifiées en direct le 13/09/2026)

Ces trois fonctions portent toute la logique de rôle et sont appelées depuis
les policies RLS ci-dessus. `SECURITY DEFINER` est nécessaire pour qu'elles
puissent lire `vehicles`/`vehicle_shares` sans se heurter à la RLS de ces
tables elles-mêmes (sinon risque de récursion/blocage).

```sql
create or replace function public.has_vehicle_access(v_id text)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from vehicles where id = v_id and owner_id = auth.uid()
  ) or exists (
    select 1 from vehicle_shares
    where vehicle_id = v_id and status = 'active' and shared_with_user_id = auth.uid()
  );
$$;

create or replace function public.has_contribute_access(v_id text)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from vehicles where id = v_id and owner_id = auth.uid()
  ) or exists (
    select 1 from vehicle_shares
    where vehicle_id = v_id and status = 'active'
      and shared_with_user_id = auth.uid() and role in ('editor','contributor')
  );
$$;

create or replace function public.can_edit_vehicle(v_id text)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from vehicles where id = v_id and owner_id = auth.uid()
  ) or exists (
    select 1 from vehicle_shares
    where vehicle_id = v_id and status = 'active'
      and shared_with_user_id = auth.uid() and role = 'editor'
  );
$$;
```

`search_path` fixé explicitement sur les trois (durcissement recommandé par
le Database Linter de Supabase pour toute fonction `SECURITY DEFINER`).

## Triggers de sécurité

**`prevent_share_tampering`** sur `vehicle_shares` — empêche qu'un utilisateur
qui s'auto-attribue une invitation en attente (policy `shares_self_claim`)
puisse au passage modifier `role`, `vehicle_id`, `owner_id` ou
`invited_email` : la policy RLS ne vérifie que l'état final de
`shared_with_user_id`/`status`, pas que ces autres colonnes sont restées
inchangées.

```sql
create or replace function public.prevent_share_tampering()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.role is distinct from old.role
     or new.vehicle_id is distinct from old.vehicle_id
     or new.owner_id is distinct from old.owner_id
     or new.invited_email is distinct from old.invited_email then
    raise exception 'Modification non autorisée sur ce partage.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_share_tampering on public.vehicle_shares;
create trigger trg_prevent_share_tampering
before update on public.vehicle_shares
for each row
execute function public.prevent_share_tampering();
```

## Contraintes

`vehicle_shares.vehicle_id` référence `vehicles.id` avec **`ON DELETE
CASCADE`** — supprimer un véhicule supprime automatiquement ses partages côté
base, indépendamment du nettoyage déjà fait côté client dans `deleteVehicle`
(`vehicle-modals.js`), qui devient une optimisation plutôt que la seule
protection.

```sql
alter table public.vehicle_shares
  add constraint vehicle_shares_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles(id)
  on delete cascade;
```

## Storage

Bucket privé **`vehicle-documents`** — les seuls types réellement envoyés par
l'app sont `image/jpeg` (toute image est réencodée côté client via canvas
avant upload, quel que soit le format d'origine) et `application/pdf`
(factures scannées).

```sql
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'application/pdf'],
    file_size_limit = 15728640  -- 15 Mo
where id = 'vehicle-documents';
```

Accès : dossier `{user_id}/{vehicle_id}/...` du propriétaire ; les autres
utilisateurs (partage) consultent via une URL signée temporaire générée côté
client (`openStorageDoc` dans `ui-common.js`), jamais par accès public au
bucket.

## Auth

- **Minimum du mot de passe : 8 caractères** (Authentication > Settings >
  Password Requirements), aligné sur le contrôle côté client dans
  `journal-backups-init.js` (modale de changement de mot de passe). Ne
  s'applique qu'aux futurs changements/créations de compte, pas
  rétroactivement aux comptes existants.
- Lien magique (OTP par e-mail) activé par défaut ; mot de passe en option.

## Edge Functions

- `send-reminders` — cron quotidien, rappels d'échéances par e-mail (Resend).
  **"Enforce JWT Verification" désactivé** (nécessaire pour accepter les
  nouvelles clés `sb_secret_...`, qui ne sont pas des JWT — voir incident du
  13/09/2026 dans le journal). Appelée avec la clé secrète envoyée à la fois
  dans `apikey` et `Authorization`.
- `send-history` — export d'historique par e-mail.
- `resolve-user-email` — résout un e-mail en `user_id` côté serveur pour le
  partage de véhicule, sans exposer la table des utilisateurs au client.

*(Contenu de ces fonctions non audité dans cette session — à faire si besoin,
même principe : coller le code ici une fois vérifié.)*

## Cron jobs (pg_cron)

Vérifiés en direct le 13/09/2026 :

| jobid | jobname | schedule | rôle |
|---|---|---|---|
| 1 | `daily-maintenance-reminders` | `0 8 * * *` (8h chaque jour) | Appelle l'Edge Function `send-reminders` via `net.http_post`, authentifié par une clé secrète moderne (`sb_secret_...`) envoyée dans les en-têtes `apikey` et `Authorization`. |
| 3 | `cleanup_user_data_history` | `0 3 * * *` (3h chaque jour) | `delete from user_data_history where archived_at < now() - interval '90 days'` — confirme la purge à 90 jours mentionnée ailleurs dans cette doc. |

⚠️ **Ne jamais faire un `select command from cron.job` dans un canal partagé**
sans avoir d'abord vérifié qu'aucun secret n'y est stocké en clair (voir
incident du 13/09/2026). Le job 1 contient actuellement une clé secrète en
clair dans sa définition — à migrer vers **Supabase Vault** dès que possible
(voir "Points encore à vérifier" plus bas) pour que ce risque ne se
reproduise pas à la prochaine modification de ce job.

## Journal des vérifications/modifications

- **13/09/2026 — Realtime : bug fonctionnel trouvé et corrigé.** La publication
  `supabase_realtime` était **vide** (0 table) — la synchro en temps réel
  entre appareils n'a probablement jamais fonctionné en pratique (l'app
  restait utilisable car `loadState()` recharge tout à la connexion, mais
  aucune mise à jour instantanée entre deux appareils ouverts en même temps).
  Corrigé :
  ```sql
  alter publication supabase_realtime
  add table public.vehicles, public.entries, public.sessions, public.planned_interventions;
  ```
  Vérifié : les 4 tables apparaissent maintenant dans
  `pg_publication_tables`. À re-tester en conditions réelles (deux appareils
  ouverts simultanément) pour confirmer que la synchro live fonctionne
  désormais de bout en bout (RLS + publication + code client
  `subscribeRealtime()`).
- **13/09/2026** — Vérification complète des policies RLS et des 3 fonctions
  `SECURITY DEFINER` (conformes au modèle de rôles). Ajouté : trigger
  `prevent_share_tampering`, `search_path` fixé sur les 3 fonctions,
  contrainte `ON DELETE CASCADE` sur `vehicle_shares.vehicle_id`, restriction
  `allowed_mime_types`/`file_size_limit` sur le bucket `vehicle-documents`,
  minimum du mot de passe relevé à 8 caractères côté Auth. Les 4 changements
  confirmés appliqués par l'utilisateur.
- **13/09/2026 — Incident de sécurité résolu : fuite de la clé `service_role`.**
  En vérifiant le cron job `daily-maintenance-reminders` (job SQL
  `pg_cron`, voir ci-dessous), un token JWT `service_role` complet est
  apparu en clair dans le résultat d'une requête partagée en conversation.
  Cette clé contourne entièrement RLS. Remédiation appliquée et vérifiée :
  1. Migration du cron job vers une clé secrète moderne (`sb_secret_...`,
     système de clés publishable/secret) au lieu de l'ancien JWT
     `service_role`, envoyée à la fois dans les en-têtes `apikey` et
     `Authorization` (nécessaire : les nouvelles clés ne sont pas des JWT,
     donc le contrôle `verify_jwt` de la passerelle les rejette si elles ne
     sont envoyées que dans `Authorization` — voir note Edge Functions
     ci-dessous).
  2. Désactivation de "Enforce JWT Verification" sur la fonction
     `send-reminders` (Edge Functions > send-reminders), requise pour
     accepter la nouvelle clé.
  3. Désactivation des anciennes clés legacy (`anon`/`service_role`) via
     Project Settings > API Keys > "Disable JWT-based API keys" — l'app
     n'est pas affectée car elle utilise déjà une clé `sb_publishable_...`
     dans `config.js`, pas l'ancienne clé `anon`.
  4. Révocation de l'ancienne clé de signature JWT (Legacy HS256) via
     Project Settings > JWT Keys > JWT Signing Keys — invalide
     cryptographiquement le token qui avait fuité, quel que soit le moyen
     par lequel il serait présenté. Confirmé "REVOKED" dans le dashboard.
  Fonctionnement de l'app revérifié après chaque étape, aucune régression.
  **Point de vigilance pour la suite** : ne jamais faire tourner de requête
  SQL qui affiche le `command` complet de `cron.job` dans un canal partagé
  (chat, ticket, capture d'écran) sans d'abord vérifier qu'aucun secret n'y
  est stocké en clair — l'idéal à terme est de migrer ce secret vers
  **Supabase Vault** (`vault.create_secret`) pour que `cron.job` ne
  contienne plus qu'une référence, jamais la valeur brute.

## Points encore à vérifier (non faits dans cette session)

- **Contenu réel des Edge Functions** `send-reminders`, `send-history`,
  `resolve-user-email` — jamais audité, seulement décrit par leur rôle
  supposé.
- **Migration du secret du cron job vers Supabase Vault** (voir point de
  vigilance ci-dessus) plutôt que de le laisser en clair dans `cron.job`.
- Types de colonnes exacts et contraintes (`NOT NULL`, valeurs par défaut)
  des tables — seuls les noms de colonnes sont documentés ici.
