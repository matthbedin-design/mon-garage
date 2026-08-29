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

async function persist(){
  if(!cloudReady || !currentUser){
    console.error('persist() appelé sans session cloud active — sauvegarde ignorée.');
    setSyncStatus('error', 'Non connecté — sauvegarde impossible');
    return false;
  }

  setSyncStatus('saving');
  isWriting = true;
  try {
    var nowIso = new Date().toISOString();
    var payload = { user_id: currentUser.id, state: state, updated_at: nowIso };
    var res;

    if(lastKnownUpdatedAt === null){
      // Pas encore de version serveur connue (première sauvegarde de la session) :
      // upsert normal. Un conflit avec une écriture concurrente à cet instant précis
      // reste possible ici, mais c'est une fenêtre bien plus étroite que l'ancien
      // comportement (upsert systématique à chaque sauvegarde).
      res = await sb.from('user_data').upsert(payload, { onConflict: 'user_id' }).select('updated_at').single();
    } else {
      // Écriture conditionnelle : on n'écrase que si la ligne serveur a toujours le
      // updated_at qu'on avait chargé/vu en dernier. Sinon, quelqu'un d'autre a
      // sauvegardé entre-temps (autre appareil) et on ne doit pas écraser son travail.
      res = await sb.from('user_data').update({ state: state, updated_at: nowIso })
        .eq('user_id', currentUser.id).eq('updated_at', lastKnownUpdatedAt)
        .select('updated_at').single();
    }

    if(res.error){
      // PGRST116 = aucune ligne ne correspondait au filtre .eq('updated_at', ...) :
      // c'est un conflit de version, pas une erreur réseau.
      if(res.error.code === 'PGRST116'){
        await handleSyncConflict();
        return false;
      }
      console.error('Erreur sauvegarde cloud:', res.error);
      setSyncStatus('error', 'Sauvegarde échouée — vérifiez la connexion');
      return false;
    }

    lastKnownUpdatedAt = res.data.updated_at;
    setSyncStatus('synced');
    return true;
  } catch(e) {
    console.error('Exception sauvegarde cloud:', e);
    setSyncStatus('error', 'Sauvegarde échouée — vérifiez la connexion');
    return false;
  } finally {
    // Petit délai avant de rebaisser le flag : laisse le temps à l'écho realtime
    // de notre propre écriture d'arriver et d'être ignoré, plutôt que de comparer
    // des chaînes de timestamp dont le format peut différer entre le client et Postgres.
    setTimeout(function(){ isWriting = false; }, 2000);
  }
}

// Un autre appareil a sauvegardé entre-temps : on ne perd rien silencieusement.
// On recharge la version la plus récente du serveur et on prévient clairement,
// pour que l'utilisateur puisse refaire sa dernière action si elle n'a pas été prise
// en compte.
async function handleSyncConflict(){
  console.error('Conflit de synchronisation détecté : une version plus récente existe côté serveur.');
  try {
    var res = await sb.from('user_data').select('state, updated_at').eq('user_id', currentUser.id).single();
    if(res.data){
      state = res.data.state;
      lastKnownUpdatedAt = res.data.updated_at;
      renderContent();
    }
  } catch(e){
    console.error('Erreur rechargement après conflit:', e);
  }
  setSyncStatus('error', 'Modifié ailleurs — dernière version rechargée');
  await showAlert('Ce carnet a été modifié depuis un autre appareil au même moment. La dernière version a été rechargée automatiquement — si votre dernière action n\'apparaît pas, merci de la refaire.');
}

async function loadState(){
  if(!cloudReady || !currentUser){
    console.error('loadState() appelé sans session cloud active.');
    setSyncStatus('error', 'Non connecté — impossible de charger les données');
    return;
  }

  try {
    var res = await sb.from('user_data').select('state, updated_at').eq('user_id', currentUser.id).single();
    if(res.data && res.data.state){
      state = res.data.state;
      lastKnownUpdatedAt = res.data.updated_at;
    } else {
      initDefaultState();
      lastKnownUpdatedAt = null;
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
  if(!state.checklistItems || !state.checklistItems.length) state.checklistItems = DEFAULT_CHECKLIST_ITEMS.slice();
  if(!state.sessions) state.sessions = {};

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
    journal: []
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
// Écoute les changements sur la ligne de cet utilisateur dans user_data : quand une
// saisie est faite depuis un autre appareil, on recharge l'état et on redessine
// automatiquement, sans avoir besoin de recharger la page.
function subscribeRealtime(){
  if(!cloudReady || !currentUser || !sb) return;

  // Évite les abonnements en doublon si onAuthStateChange se déclenche plusieurs fois
  if(realtimeChannel){
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = sb
    .channel('user_data_changes_' + currentUser.id)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'user_data',
      filter: 'user_id=eq.' + currentUser.id
    }, function(payload){
      var row = payload.new;
      if(!row || !row.state) return;
      // Ignore l'écho de notre propre écriture en cours (voir isWriting dans persist())
      if(isWriting) return;

      state = row.state;
      lastKnownUpdatedAt = row.updated_at;
      renderContent();
    })
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
