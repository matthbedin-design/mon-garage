// ---- Modèle & Helpers ----
function makeVehicle(name, color, enabledTypes){
  return {
    name: name,
    plate: '',
    color: color,
    mileage: 0,
    documents: [],
    enabledTypes: enabledTypes || DEFAULT_TYPES.map(function(t){ return t.id; }),
    intervals: {},
    vehicleType: 'motorized', // 'motorized' (véhicule à moteur) ou 'trailer' (remorque/caravane, pas de kilométrage)
    // Fiche véhicule (facultatif, éditable dans les réglages)
    brand: '', model: '', year: '', vin: '', fuel: '', firstRegDate: '', insurance: ''
  };
}

function isTrailer(v){
  return v && v.vehicleType === 'trailer';
}

function logEvent(vehicleId, message){
  var vehicleName = null;
  if(vehicleId && state.vehicles[vehicleId]){
    vehicleName = state.vehicles[vehicleId].name;
  }
  state.journal.push({
    id: genId('j'),
    ts: new Date().toISOString(),
    vehicleId: vehicleId || null,
    vehicleName: vehicleName,
    message: message
  });
  // Garde-fou : évite une croissance non bornée du journal sur plusieurs années
  // d'usage (le JSON reste léger même après des centaines d'actions).
  var JOURNAL_MAX = 300;
  if(state.journal.length > JOURNAL_MAX){
    state.journal = state.journal.slice(state.journal.length - JOURNAL_MAX);
  }
}

// ---- Persistance & Auth Cloud ----
function setSyncStatus(mode, detail){
  var el = document.getElementById('syncStatus');
  var label = document.getElementById('syncStatusLabel');
  if(!el || !label) return;

  if(mode === 'off'){
    el.style.display = 'none';
    return;
  }

  el.style.display = 'flex';
  el.className = 'sync-status ' + mode;
  if(mode === 'saving') label.textContent = 'Sauvegarde…';
  else if(mode === 'synced') label.textContent = 'Synchronisé';
  else if(mode === 'error') label.textContent = detail || 'Erreur de connexion';
}

// ============================================================================
// ÉTAPE 1 — MODÈLE NORMALISÉ
// ============================================================================
// L'état en mémoire (`state`) garde exactement la même forme qu'avant (objet
// `vehicles` par id, `entries` par vehicleId, etc.) pour que tout le reste du
// code (render.js, entry-modal.js, vehicle-modals.js, checklist-sessions.js)
// continue de fonctionner sans modification. Ce qui change : `loadState()` et
// `persist()` lisent/écrivent désormais dans des tables normalisées
// (vehicles, entries, sessions, planned_interventions, user_settings) au lieu
// d'un unique blob JSON — c'est ce qui permettra le partage par véhicule à
// l'étape 2.
//
// `user_data` (l'ancien blob JSON) continue d'être écrit en parallèle, en
// miroir, uniquement pour préserver le système de sauvegardes/versioning
// existant (table user_data_history + trigger d'archivage). Il n'est plus
// utilisé pour charger l'application.

// Dernier instantané connu comme synchronisé, pour ne pousser vers Supabase
// que ce qui a réellement changé plutôt que de tout réécrire à chaque sauvegarde.
var lastSynced = { vehicles: {}, entries: {}, sessions: {}, planned: {} };

function snapshotCurrent(){
  return {
    vehicles: JSON.parse(JSON.stringify(state.vehicles || {})),
    entries: JSON.parse(JSON.stringify(state.entries || {})),
    sessions: JSON.parse(JSON.stringify(state.sessions || {})),
    planned: JSON.parse(JSON.stringify(state.plannedInterventions || {}))
  };
}

function vehicleRow(id, v, sortOrder){
  return {
    id: id,
    // Le propriétaire réel est conservé (chargé depuis la base via v.ownerId) ;
    // ne retombe sur l'utilisateur courant que pour un véhicule tout juste créé
    // localement (pas encore de ownerId connu).
    owner_id: v.ownerId || currentUser.id,
    name: v.name, plate: v.plate || '', color: v.color || '',
    mileage: v.mileage || 0, vehicle_type: v.vehicleType || 'motorized',
    enabled_types: v.enabledTypes || [], intervals: v.intervals || {},
    documents: v.documents || [],
    brand: v.brand || '', model: v.model || '', year: v.year || '', vin: v.vin || '',
    fuel: v.fuel || '', first_reg_date: v.firstRegDate || '', insurance: v.insurance || '',
    sort_order: sortOrder
  };
}

function entryRow(id, vehicleId, e){
  return {
    id: id,
    vehicle_id: vehicleId,
    type_id: e.typeId,
    date: e.date || null,
    km: (e.km != null ? e.km : null),
    cost: (e.cost != null ? e.cost : null),
    notes: e.notes || '',
    garage: e.garage || null,
    supplier: e.supplier || null,
    invoice_doc: e.invoiceDoc || null,
    batch_id: e.batchId || null,
    ct: e.ct || null,
    documents: e.documents || [],
    created_at: e.createdAt || new Date().toISOString(),
    updated_at: e.updatedAt || null,
    session_id: e.sessionId || null,
    // Conserve le créateur d'origine (utile pour la notification au
    // propriétaire à l'étape 2b) ; ne retombe sur l'utilisateur courant que
    // pour une entrée tout juste créée localement.
    created_by: e.createdBy || currentUser.id
  };
}

function sessionRow(id, vehicleId, s){
  return { id: id, vehicle_id: vehicleId, data: s, status: s.status || null, created_by: s.createdBy || currentUser.id };
}

function plannedRow(id, vehicleId, p){
  return {
    id: id, vehicle_id: vehicleId, label: p.label || '', notes: p.notes || '',
    created_at: p.createdAt || new Date().toISOString(),
    source_session_id: p.sourceSessionId || null,
    source_item_id: p.sourceItemId || null,
    created_by: p.createdBy || currentUser.id
  };
}

// Compare l'état courant au dernier instantané synchronisé et construit la
// liste des upserts/suppressions à effectuer, table par table.
function buildSyncOps(){
  var ops = {
    vehiclesUpsert: [], vehiclesDelete: [],
    entriesUpsert: [], entriesDelete: [],
    sessionsUpsert: [], sessionsDelete: [],
    plannedUpsert: [], plannedDelete: []
  };

  // Véhicules (l'ordre d'affichage vient de state.order)
  var order = (state.order && state.order.length) ? state.order : Object.keys(state.vehicles || {});
  order.forEach(function(id, idx){
    var v = state.vehicles[id];
    if(!v) return;
    var row = vehicleRow(id, v, idx);
    // On compare la ligne complète (v + position dans `order`), pas juste v,
    // pour détecter aussi un simple changement d'ordre d'affichage.
    var prevRow = lastSynced._vehicleRows && lastSynced._vehicleRows[id];
    if(!prevRow || JSON.stringify(prevRow) !== JSON.stringify(row)) ops.vehiclesUpsert.push(row);
  });
  Object.keys(lastSynced.vehicles).forEach(function(id){
    if(!state.vehicles[id]) ops.vehiclesDelete.push(id);
  });

  // Entrées
  var currentEntryIds = {};
  Object.keys(state.entries || {}).forEach(function(vehicleId){
    (state.entries[vehicleId] || []).forEach(function(e){
      currentEntryIds[e.id] = true;
      var row = entryRow(e.id, vehicleId, e);
      var prev = lastSynced._entryRows && lastSynced._entryRows[e.id];
      if(!prev || JSON.stringify(prev) !== JSON.stringify(row)) ops.entriesUpsert.push(row);
    });
  });
  Object.keys(lastSynced.entries || {}).forEach(function(vehicleId){
    (lastSynced.entries[vehicleId] || []).forEach(function(e){
      if(!currentEntryIds[e.id]) ops.entriesDelete.push(e.id);
    });
  });

  // Sessions
  var currentSessionIds = {};
  Object.keys(state.sessions || {}).forEach(function(vehicleId){
    (state.sessions[vehicleId] || []).forEach(function(s){
      currentSessionIds[s.id] = true;
      var row = sessionRow(s.id, vehicleId, s);
      var prev = lastSynced._sessionRows && lastSynced._sessionRows[s.id];
      if(!prev || JSON.stringify(prev) !== JSON.stringify(row)) ops.sessionsUpsert.push(row);
    });
  });
  Object.keys(lastSynced.sessions || {}).forEach(function(vehicleId){
    (lastSynced.sessions[vehicleId] || []).forEach(function(s){
      if(!currentSessionIds[s.id]) ops.sessionsDelete.push(s.id);
    });
  });

  // Interventions à prévoir
  var currentPlannedIds = {};
  Object.keys(state.plannedInterventions || {}).forEach(function(vehicleId){
    (state.plannedInterventions[vehicleId] || []).forEach(function(p){
      currentPlannedIds[p.id] = true;
      var row = plannedRow(p.id, vehicleId, p);
      var prev = lastSynced._plannedRows && lastSynced._plannedRows[p.id];
      if(!prev || JSON.stringify(prev) !== JSON.stringify(row)) ops.plannedUpsert.push(row);
    });
  });
  Object.keys(lastSynced.planned || {}).forEach(function(vehicleId){
    (lastSynced.planned[vehicleId] || []).forEach(function(p){
      if(!currentPlannedIds[p.id]) ops.plannedDelete.push(p.id);
    });
  });

  return ops;
}

// Instantané enrichi : on garde aussi les "rows" telles qu'envoyées à Supabase
// (et pas seulement les objets d'état) pour pouvoir comparer à l'identique au
// prochain appel, sort_order et champs dérivés inclus.
function refreshLastSynced(){
  var snap = snapshotCurrent();
  snap._vehicleRows = {};
  var order = (state.order && state.order.length) ? state.order : Object.keys(state.vehicles || {});
  order.forEach(function(id, idx){
    var v = state.vehicles[id];
    if(v) snap._vehicleRows[id] = vehicleRow(id, v, idx);
  });
  snap._entryRows = {};
  Object.keys(state.entries || {}).forEach(function(vehicleId){
    (state.entries[vehicleId] || []).forEach(function(e){
      snap._entryRows[e.id] = entryRow(e.id, vehicleId, e);
    });
  });
  snap._sessionRows = {};
  Object.keys(state.sessions || {}).forEach(function(vehicleId){
    (state.sessions[vehicleId] || []).forEach(function(s){
      snap._sessionRows[s.id] = sessionRow(s.id, vehicleId, s);
    });
  });
  snap._plannedRows = {};
  Object.keys(state.plannedInterventions || {}).forEach(function(vehicleId){
    (state.plannedInterventions[vehicleId] || []).forEach(function(p){
      snap._plannedRows[p.id] = plannedRow(p.id, vehicleId, p);
    });
  });
  lastSynced = snap;
}

async function applySyncOps(ops){
  var tasks = [];
  if(ops.vehiclesUpsert.length) tasks.push(sb.from('vehicles').upsert(ops.vehiclesUpsert));
  if(ops.vehiclesDelete.length) tasks.push(sb.from('vehicles').delete().in('id', ops.vehiclesDelete));
  if(ops.entriesUpsert.length) tasks.push(sb.from('entries').upsert(ops.entriesUpsert));
  if(ops.entriesDelete.length) tasks.push(sb.from('entries').delete().in('id', ops.entriesDelete));
  if(ops.sessionsUpsert.length) tasks.push(sb.from('sessions').upsert(ops.sessionsUpsert));
  if(ops.sessionsDelete.length) tasks.push(sb.from('sessions').delete().in('id', ops.sessionsDelete));
  if(ops.plannedUpsert.length) tasks.push(sb.from('planned_interventions').upsert(ops.plannedUpsert));
  if(ops.plannedDelete.length) tasks.push(sb.from('planned_interventions').delete().in('id', ops.plannedDelete));

  // Réglages restants (journal, types, checklist) : toujours réécrits en
  // entier, volume négligeable et jamais partagés entre utilisateurs.
  tasks.push(sb.from('user_settings').upsert({
    user_id: currentUser.id,
    journal: state.journal || [],
    types: state.types || [],
    checklist_items: state.checklistItems || [],
    updated_at: new Date().toISOString()
  }));

  var results = await Promise.all(tasks);
  var firstError = results.map(function(r){ return r.error; }).filter(Boolean)[0];
  if(firstError) throw firstError;
}

async function persist(){
  if(!cloudReady || !currentUser){
    console.error('persist() appelé sans session cloud active — sauvegarde ignorée.');
    setSyncStatus('error', 'Non connecté — sauvegarde impossible');
    return false;
  }

  setSyncStatus('saving');
  isWriting = true;
  try {
    var ops = buildSyncOps();
    await applySyncOps(ops);
    refreshLastSynced();

    // Miroir de l'état complet dans user_data : sert uniquement à préserver le
    // système de sauvegardes/versioning existant (table user_data_history,
    // archivée via un trigger sur cette table). Ce n'est plus la source
    // utilisée pour charger l'application (voir loadState) — un échec ici
    // n'est donc pas bloquant, les tables normalisées ci-dessus font foi.
    var nowIso = new Date().toISOString();
    var payload = { user_id: currentUser.id, state: state, updated_at: nowIso };
    var res;
    if(lastKnownUpdatedAt === null){
      res = await sb.from('user_data').upsert(payload, { onConflict: 'user_id' }).select('updated_at').single();
    } else {
      res = await sb.from('user_data').update({ state: state, updated_at: nowIso })
        .eq('user_id', currentUser.id).eq('updated_at', lastKnownUpdatedAt)
        .select('updated_at').single();
    }
    if(res.error){
      if(res.error.code === 'PGRST116'){
        // Une autre session a écrit le miroir entre-temps : sans gravité, les
        // tables normalisées viennent d'être sauvegardées avec succès
        // ci-dessus. On rafraîchit juste le jeton de concurrence.
        var latest = await sb.from('user_data').select('updated_at').eq('user_id', currentUser.id).single();
        if(latest.data) lastKnownUpdatedAt = latest.data.updated_at;
      } else {
        console.error('Erreur miroir user_data (sauvegardes/historique) :', res.error);
      }
    } else {
      lastKnownUpdatedAt = res.data.updated_at;
    }

    setSyncStatus('synced');
    return true;
  } catch(e) {
    console.error('Exception sauvegarde cloud:', e);
    setSyncStatus('error', 'Sauvegarde échouée — vérifiez la connexion');
    return false;
  } finally {
    // Petit délai avant de rebaisser le flag : laisse le temps à l'écho realtime
    // de notre propre écriture d'arriver et d'être ignoré.
    setTimeout(function(){ isWriting = false; }, 2000);
  }
}

// ============================================================================
// ÉTAPE 2 — PARTAGE PAR VÉHICULE
// ============================================================================
// Rôle de l'utilisateur courant sur chaque véhicule non-possédé (chargé dans
// loadState depuis vehicle_shares). Les véhicules possédés n'ont pas besoin
// d'entrée ici : isOwner() suffit.
var myVehicleRoles = {};

function isOwner(vehicleId){
  var v = state.vehicles[vehicleId];
  return !!(v && v.ownerId === currentUser.id);
}

function getVehicleRole(vehicleId){
  if(isOwner(vehicleId)) return 'owner';
  return myVehicleRoles[vehicleId] || null; // null = pas d'accès (ne devrait pas arriver si RLS a livré le véhicule)
}

// Éditeur ou propriétaire : peut modifier les réglages du véhicule, ajouter/
// modifier des interventions, gérer les fiches de vérification.
function canEditVehicle(vehicleId){
  var r = getVehicleRole(vehicleId);
  return r === 'owner' || r === 'editor';
}

// Propriétaire, éditeur ou contributeur : peut ajouter des interventions, des
// fiches de vérification et des interventions à prévoir — mais pas modifier
// les réglages du véhicule ni les interventions déjà enregistrées par d'autres.
function canContribute(vehicleId){
  var r = getVehicleRole(vehicleId);
  return r === 'owner' || r === 'editor' || r === 'contributor';
}

// Récupère les invitations de partage en attente correspondant à l'email du
// compte connecté et les active. Autorisé par la policy RLS "shares_self_claim"
// (l'utilisateur ne peut s'attribuer que les partages dont l'email vérifié par
// Supabase correspond au sien).
async function claimPendingShares(){
  if(!currentUser || !currentUser.email) return;
  try {
    var pending = await sb.from('vehicle_shares').select('id')
      .eq('status', 'pending').ilike('invited_email', currentUser.email);
    if(pending.error || !pending.data || !pending.data.length) return;
    for(var i = 0; i < pending.data.length; i++){
      await sb.from('vehicle_shares')
        .update({ shared_with_user_id: currentUser.id, status: 'active' })
        .eq('id', pending.data[i].id);
    }
  } catch(e){
    console.error('Erreur lors de la réclamation des invitations en attente:', e);
  }
}

async function loadState(){
  if(!cloudReady || !currentUser){
    console.error('loadState() appelé sans session cloud active.');
    setSyncStatus('error', 'Non connecté — impossible de charger les données');
    return;
  }

  try {
    // Récupère les invitations de partage en attente correspondant à l'email
    // du compte qui vient de se connecter, et les active — pour que les
    // véhicules partagés apparaissent dès ce chargement.
    await claimPendingShares();

    var results = await Promise.all([
      sb.from('vehicles').select('*').order('sort_order', { ascending: true }),
      sb.from('entries').select('*'),
      sb.from('sessions').select('*'),
      sb.from('planned_interventions').select('*'),
      sb.from('user_settings').select('*').eq('user_id', currentUser.id).maybeSingle(),
      sb.from('vehicle_shares').select('vehicle_id, role').eq('shared_with_user_id', currentUser.id).eq('status', 'active')
    ]);
    var vehRes = results[0], entRes = results[1], sesRes = results[2], planRes = results[3], settRes = results[4], sharesRes = results[5];

    var firstErr = results.map(function(r){ return r.error; }).filter(Boolean)[0];
    if(firstErr) throw firstErr;

    myVehicleRoles = {};
    (sharesRes.data || []).forEach(function(row){
      myVehicleRoles[row.vehicle_id] = row.role;
    });

    var vehicles = {}, order = [];
    (vehRes.data || []).forEach(function(row){
      vehicles[row.id] = {
        ownerId: row.owner_id,
        name: row.name, plate: row.plate, color: row.color, mileage: row.mileage,
        vehicleType: row.vehicle_type, enabledTypes: row.enabled_types || [],
        intervals: row.intervals || {}, documents: row.documents || [],
        brand: row.brand, model: row.model, year: row.year, vin: row.vin,
        fuel: row.fuel, firstRegDate: row.first_reg_date, insurance: row.insurance
      };
      order.push(row.id);
    });

    var entries = {};
    (entRes.data || []).forEach(function(row){
      if(!entries[row.vehicle_id]) entries[row.vehicle_id] = [];
      var e = {
        id: row.id, typeId: row.type_id, date: row.date,
        km: row.km, cost: row.cost, notes: row.notes,
        garage: row.garage, supplier: row.supplier,
        invoiceDoc: row.invoice_doc, batchId: row.batch_id, ct: row.ct,
        documents: row.documents || [],
        createdAt: row.created_at, updatedAt: row.updated_at,
        sessionId: row.session_id, createdBy: row.created_by
      };
      if(!e.ct) delete e.ct;
      if(!e.invoiceDoc) delete e.invoiceDoc;
      entries[row.vehicle_id].push(e);
    });

    var sessions = {};
    (sesRes.data || []).forEach(function(row){
      if(!sessions[row.vehicle_id]) sessions[row.vehicle_id] = [];
      var s = Object.assign({}, row.data, { id: row.id, createdBy: row.created_by });
      sessions[row.vehicle_id].push(s);
    });

    var planned = {};
    (planRes.data || []).forEach(function(row){
      if(!planned[row.vehicle_id]) planned[row.vehicle_id] = [];
      planned[row.vehicle_id].push({
        id: row.id, label: row.label, notes: row.notes,
        createdAt: row.created_at,
        sourceSessionId: row.source_session_id,
        sourceItemId: row.source_item_id,
        createdBy: row.created_by
      });
    });

    var settings = settRes.data || {};

    state = {
      vehicles: vehicles,
      entries: entries,
      order: order,
      types: (settings.types && settings.types.length) ? settings.types : DEFAULT_TYPES.slice(),
      journal: settings.journal || [],
      plannedInterventions: planned,
      sessions: sessions,
      checklistItems: (settings.checklist_items && settings.checklist_items.length) ? settings.checklist_items : DEFAULT_CHECKLIST_ITEMS.slice()
    };

    refreshLastSynced();

    // Récupère le jeton de concurrence du miroir user_data (utilisé par
    // persist()/sauvegardes), sans s'en servir pour charger les données.
    var mirror = await sb.from('user_data').select('updated_at').eq('user_id', currentUser.id).maybeSingle();
    lastKnownUpdatedAt = mirror.data ? mirror.data.updated_at : null;
    if(!mirror.data){
      // Première synchro sous le nouveau schéma : initialise le miroir pour
      // que le système de sauvegardes/historique s'active dès maintenant.
      await persist();
    }

    subscribeRealtime();
    setSyncStatus('synced');
  } catch(e) {
    console.error('Erreur chargement cloud:', e);
    setSyncStatus('error', 'Chargement impossible — vérifiez la connexion');
    initDefaultState();
  }

  // Sanity check
  if(!state.types || !state.types.length) state.types = DEFAULT_TYPES.slice();
  if(!state.journal) state.journal = [];
  if(!state.order) state.order = [];
  if(!state.vehicles) state.vehicles = {};
  if(!state.entries) state.entries = {};
  if(!state.checklistItems || !state.checklistItems.length){
    state.checklistItems = DEFAULT_CHECKLIST_ITEMS.slice();
  } else {
    // Fusionne les nouveaux points de vérification par défaut ajoutés depuis la
    // dernière visite, sans écraser ni supprimer ceux déjà personnalisés.
    var existingChecklistIds = {};
    state.checklistItems.forEach(function(c){ existingChecklistIds[c.id] = true; });
    DEFAULT_CHECKLIST_ITEMS.forEach(function(c){
      if(!existingChecklistIds[c.id]) state.checklistItems.push(c);
    });
  }
  if(!state.sessions) state.sessions = {};
  if(!state.plannedInterventions) state.plannedInterventions = {};

  if(!activeVehicleId){
    activeVehicleId = DASHBOARD_ID;
  }

  render();
}

function initDefaultState(){
  // L'app démarre vide : aucune donnée de démo n'est pré-remplie.
  // L'utilisateur ajoute ses propres véhicules via le bouton "+ Nouveau véhicule".
  state = {
    vehicles: {},
    entries: {},
    order: [],
    types: DEFAULT_TYPES.slice(),
    journal: [],
    plannedInterventions: {}
  };
}

async function signInEmail(){
  var email = document.getElementById('emailInput').value.trim();
  var statusEl = document.getElementById('authStatus');
  if(!email){ if(statusEl) statusEl.innerText = 'Merci de saisir un e-mail.'; return; }
  
  if(statusEl) statusEl.innerText = 'Envoi du lien...';
  // On force explicitement l'URL de redirection vers la page actuelle (plutôt que de
  // dépendre uniquement de la "Site URL" configurée dans le dashboard Supabase), pour
  // éviter tout mauvais aiguillage si ce réglage est absent ou incorrect.
  var redirectTo = window.location.origin + window.location.pathname;
  var res = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectTo } });
  if(res.error){
    if(statusEl) statusEl.innerText = 'Erreur : ' + res.error.message;
  } else {
    if(statusEl) statusEl.innerText = 'Lien magique envoyé ! Vérifiez vos e-mails.';
  }
}

// ---- Synchro en temps réel ----
// Écoute les changements sur les tables normalisées : quand une saisie est
// faite depuis un autre appareil, on recharge l'état et on redessine
// automatiquement, sans avoir besoin de recharger la page. Le filtrage des
// lignes visibles est assuré par les policies RLS de chaque table (un
// utilisateur ne reçoit que les événements sur ses propres véhicules, et à
// l'étape 2, ceux qui lui sont partagés).
function subscribeRealtime(){
  if(!cloudReady || !currentUser || !sb) return;

  // Évite les abonnements en doublon si onAuthStateChange se déclenche plusieurs fois
  if(realtimeChannel){
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  var reload = debounce(function(){
    if(isWriting) return; // ignore l'écho de notre propre écriture en cours
    loadState();
  }, 400);

  realtimeChannel = sb
    .channel('carnet_changes_' + currentUser.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'planned_interventions' }, reload)
    .subscribe();
}

function unsubscribeRealtime(){
  if(realtimeChannel && sb){
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

async function signOutCloud(){
  unsubscribeRealtime();
  if(sb) await sb.auth.signOut();
  currentUser = null;
  lastKnownUpdatedAt = null;
  var authEl = document.getElementById('authOverlay');
  if(authEl) authEl.style.display = 'flex';
}

// ---- Calculs des échéances ----
function getTypeConfig(vehicle, typeId){
  var globalType = state.types.filter(function(t){ return t.id === typeId; })[0];
  if(!globalType) return null;
  var custom = (vehicle.intervals && vehicle.intervals[typeId]) || {};
  return {
    id: globalType.id,
    label: globalType.label,
    km: custom.km !== undefined ? custom.km : globalType.km,
    months: custom.months !== undefined ? custom.months : globalType.months,
    // Seuils de rappel personnalisables par type (ex : prévenir 2 mois avant une
    // vidange, 1 mois avant un CT) — valeurs par défaut inchangées si non réglées.
    reminderKm: (globalType.reminderKm != null) ? globalType.reminderKm : 1000,
    reminderDays: (globalType.reminderDays != null) ? globalType.reminderDays : 30
  };
}

function getLatestEntry(vehicleId, typeId){
  var list = state.entries[vehicleId] || [];
  var filtered = list.filter(function(e){ return e.typeId === typeId; });
  if(!filtered.length) return null;
  filtered.sort(function(a,b){
    if(a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.km || 0) - (a.km || 0);
  });
  return filtered[0];
}

function getMaxEntryKm(vehicleId){
  var list = state.entries[vehicleId] || [];
  if(!list.length) return null;
  var max = null;
  list.forEach(function(e){
    if(e.km != null && (max === null || e.km > max)) max = e.km;
  });
  return max;
}

// Vérifie qu'un kilométrage saisi pour une date donnée reste cohérent avec les
// autres interventions déjà enregistrées (l'odomètre ne peut qu'avancer avec le temps).
// Retourne la première intervention en conflit, ou null si tout est cohérent.
function findKmConflict(vehicleId, date, km, excludeEntryId){
  var list = state.entries[vehicleId] || [];
  for(var i = 0; i < list.length; i++){
    var e = list[i];
    if(e.id === excludeEntryId) continue;
    if(e.km == null || !e.date) continue;
    // Une intervention antérieure ne devrait pas afficher un km supérieur
    if(e.date < date && e.km > km) return e;
    // Une intervention postérieure ne devrait pas afficher un km inférieur
    if(e.date > date && e.km < km) return e;
  }
  return null;
}

function computeStatus(vehicleId, typeId){
  var v = state.vehicles[vehicleId];
  if(!v) return null;
  var cfg = getTypeConfig(v, typeId);
  if(!cfg) return null;

  var last = getLatestEntry(vehicleId, typeId);
  var currentKm = v.mileage || 0;

  var result = {
    cfg: cfg,
    last: last,
    pct: 0,
    remainingKm: null,
    remainingDays: null,
    isOverdue: false,
    isWarning: false
  };

  if(!last) return result;

  var pctKm = 0;
  if(cfg.km && cfg.km > 0 && !isTrailer(v)){
    var doneKm = currentKm - (last.km || 0);
    result.remainingKm = cfg.km - doneKm;
    pctKm = Math.min(100, Math.max(0, (doneKm / cfg.km) * 100));
    if(result.remainingKm <= 0) result.isOverdue = true;
    else if(result.remainingKm <= cfg.reminderKm) result.isWarning = true;
  }

  var pctDays = 0;
  if(cfg.months && cfg.months > 0 && last.date){
    var lastDate = new Date(last.date);
    var nextDate = new Date(lastDate);
    nextDate.setMonth(nextDate.getMonth() + cfg.months);
    
    var now = new Date();
    var diffMs = nextDate - now;
    result.remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    
    var totalDays = cfg.months * 30.4375;
    var doneDays = totalDays - result.remainingDays;
    pctDays = Math.min(100, Math.max(0, (doneDays / totalDays) * 100));

    if(result.remainingDays <= 0) result.isOverdue = true;
    else if(result.remainingDays <= cfg.reminderDays) result.isWarning = true;
  }

  result.pct = Math.max(pctKm, pctDays);

  // Cas particulier du Contrôle Technique : un résultat défavorable non régularisé
  // prime sur l'échéance normale (24 mois) — la vraie urgence est la contre-visite.
  if(typeId === 'ct' && last.ct){
    result.ct = last.ct;
    var cv = last.ct.counterVisit;
    var isKoResult = (last.ct.result === 'ko_major' || last.ct.result === 'ko_critical');
    if(isKoResult && cv && !cv.done){
      result.needsCounterVisit = true;
      if(cv.deadline){
        var deadlineDate = new Date(cv.deadline);
        var diffCv = Math.ceil((deadlineDate - new Date()) / (1000 * 60 * 60 * 24));
        result.remainingDays = diffCv;
        result.remainingKm = null;
        // Une défaillance critique reste au niveau d'alerte maximal (rouge) même
        // avant l'échéance de contre-visite, puisque la validité du CT est déjà
        // limitée au jour même — contrairement à une défaillance majeure (orange
        // jusqu'à l'approche de l'échéance).
        result.isOverdue = diffCv <= 0 || last.ct.result === 'ko_critical';
        result.isWarning = !result.isOverdue && diffCv <= cfg.reminderDays;
        result.cvDeadlinePassed = diffCv <= 0;
        result.pct = result.isOverdue ? 100 : Math.min(100, Math.max(0, 100 - (diffCv / 60) * 100));
      } else {
        // Pas de date limite renseignée : on force quand même une alerte visible
        result.isOverdue = true;
      }
    }
  }

  return result;
}
