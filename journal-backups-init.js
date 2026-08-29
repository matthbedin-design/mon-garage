// ---- Modale : Journal ----
function openJournalModal(){
  var modal = document.getElementById('modal');
  var list = (state.journal || []).slice().sort(function(a,b){ return new Date(b.ts) - new Date(a.ts); });

  var rows = list.map(function(j){
    var vehicle = state.vehicles[j.vehicleId];
    var color = vehicle ? vehicle.color : '#6B6E70';
    var tag = j.vehicleName || 'Général';
    return '<div class="journal-row">' +
      '<div class="journal-meta"><span class="journal-tag" style="background:' + color + '">' + escapeHtml(tag) + '</span><span class="journal-time">' + fmtDateTime(j.ts) + '</span></div>' +
      '<div class="journal-msg">' + escapeHtml(j.message) + '</div>' +
      '</div>';
  }).join('');

  modal.innerHTML =
    '<h3>Journal des modifications <button class="icon-btn" id="closeModalBtn" aria-label="Fermer">\u2715</button></h3>' +
    (list.length ? rows : '<div class="empty-state">Aucune modification enregistrée pour le moment.</div>') +
    '<div class="modal-actions" style="margin-top:16px;"><button class="btn btn-ghost" id="cancelBtn" style="flex:1;">Fermer</button></div>';

  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('closeModalBtn').onclick = closeModal;
  document.getElementById('cancelBtn').onclick = closeModal;
}

// ---- Sauvegardes / historique (restauration de versions antérieures) ----
async function openBackupsModal(){
  var modal = document.getElementById('modal');
  modal.innerHTML =
    '<h3>Sauvegardes <button class="icon-btn" id="closeModalBtn" aria-label="Fermer">\u2715</button></h3>' +
    '<div class="empty-state" id="backupsLoading">Chargement des versions précédentes...</div>' +
    '<div class="modal-actions" style="margin-top:16px;"><button class="btn btn-ghost" id="cancelBtn" style="flex:1;">Fermer</button></div>';

  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('closeModalBtn').onclick = closeModal;
  document.getElementById('cancelBtn').onclick = closeModal;

  if(!cloudReady || !currentUser){
    document.getElementById('backupsLoading').textContent = 'Non connecté.';
    return;
  }

  try {
    var res = await sb.from('user_data_history')
      .select('id, updated_at, archived_at')
      .eq('user_id', currentUser.id)
      .order('archived_at', { ascending: false })
      .limit(30);

    if(res.error){
      console.error('Erreur chargement des sauvegardes:', res.error);
      document.getElementById('backupsLoading').textContent = 'Impossible de charger les sauvegardes.';
      return;
    }

    var rows = res.data || [];
    var loadingEl = document.getElementById('backupsLoading');
    if(!loadingEl) return; // la modale a été fermée entre-temps

    if(!rows.length){
      loadingEl.textContent = 'Aucune sauvegarde antérieure pour le moment. Une version est archivée automatiquement à chaque modification.';
      return;
    }

    var list = document.createElement('div');
    rows.forEach(function(row){
      var item = document.createElement('div');
      item.className = 'journal-row';
      item.innerHTML =
        '<div class="journal-meta"><span class="journal-time">' + fmtDateTime(row.archived_at) + '</span></div>' +
        '<div class="journal-msg">Version datée du ' + fmtDateTime(row.updated_at) + '</div>';
      var restoreBtn = document.createElement('button');
      restoreBtn.className = 'btn btn-ghost';
      restoreBtn.style.marginTop = '6px';
      restoreBtn.textContent = 'Restaurer cette version';
      restoreBtn.onclick = function(){ restoreBackup(row.id); };
      item.appendChild(restoreBtn);
      list.appendChild(item);
    });

    loadingEl.replaceWith(list);
  } catch(e){
    console.error('Exception chargement des sauvegardes:', e);
    var el = document.getElementById('backupsLoading');
    if(el) el.textContent = 'Impossible de charger les sauvegardes.';
  }
}

async function restoreBackup(historyId){
  var ok = await showConfirm(
    'Restaurer cette version remplacera l\'état actuel du carnet (véhicules, historique, documents liés). Cette action peut être annulée en restaurant une version plus récente ensuite. Continuer ?',
    'Restaurer'
  );
  if(!ok) return;

  try {
    var res = await sb.from('user_data_history').select('state').eq('id', historyId).eq('user_id', currentUser.id).single();
    if(res.error || !res.data){
      console.error('Erreur lecture de la sauvegarde:', res.error);
      await showAlert('Impossible de récupérer cette sauvegarde.');
      return;
    }

    state = res.data.state;
    var saved = await persist();
    if(saved){
      closeModal();
      renderContent();
      await showAlert('Version restaurée avec succès.');
    } else {
      await showAlert('La restauration a échoué pendant la sauvegarde. Réessayez.');
    }
  } catch(e){
    console.error('Exception restauration de sauvegarde:', e);
    await showAlert('Impossible de restaurer cette version.');
  }
}

// ---- Événements globaux & Démarrage ----
var emailBtn = document.getElementById('emailLoginBtn');
if(emailBtn) emailBtn.addEventListener('click', signInEmail);

var syncStatusEl = document.getElementById('syncStatus');
if(syncStatusEl) syncStatusEl.addEventListener('click', function(){
  if(syncStatusEl.classList.contains('error')) persist();
});

var accountBtn = document.getElementById('accountBtn');
if(accountBtn) accountBtn.addEventListener('click', async function(){
  if(!currentUser) return;
  var ok = await showConfirm('Se déconnecter ?', 'Se déconnecter');
  if(ok) signOutCloud();
});

var addBtn = document.getElementById('addBtn');
if(addBtn) addBtn.addEventListener('click', function(){ openEntryModal(null); });

var journalBtn = document.getElementById('journalBtn');
if(journalBtn) journalBtn.addEventListener('click', openJournalModal);

var backupsBtn = document.getElementById('backupsBtn');
if(backupsBtn) backupsBtn.addEventListener('click', openBackupsModal);

var scrollTopBtn = document.getElementById('scrollTopBtn');
if(scrollTopBtn){
  window.addEventListener('scroll', debounce(function(){
    scrollTopBtn.style.display = (window.scrollY > 400) ? 'flex' : 'none';
  }, 100));
  scrollTopBtn.onclick = function(){
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
}

var modalOverlay = document.getElementById('modalOverlay');
if(modalOverlay){
  modalOverlay.addEventListener('click', function(e){
    if(e.target.id === 'modalOverlay') closeModal();
  });
}

// Fermeture au clavier (Échap) — modale d'édition et modale de confirmation/alerte
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  var overlay = document.getElementById('modalOverlay');
  if(overlay && overlay.classList.contains('open')){ closeModal(); return; }
  var confirmOverlay = document.getElementById('confirmOverlay');
  if(confirmOverlay && confirmOverlay.classList.contains('open')){
    var cancelBtn = document.getElementById('confirmCancelBtn');
    if(cancelBtn && cancelBtn.style.display !== 'none' && cancelBtn.onclick) cancelBtn.onclick();
  }
});

// Initialisation
initCloud();
if(cloudReady){
  sb.auth.onAuthStateChange(function(event, session){
    if(session){
      currentUser = session.user;
      var authEl = document.getElementById('authOverlay');
      if(authEl) authEl.style.display = 'none';
      loadState();
    } else {
      var authEl = document.getElementById('authOverlay');
      if(authEl) authEl.style.display = 'flex';
    }
  });
} else {
  // Sans configuration Supabase valide, l'app ne peut fonctionner : pas de mode
  // local de secours (pour éviter toute confusion entre données synchronisées
  // et données restées uniquement sur cet appareil).
  var content = document.getElementById('content');
  if(content){
    content.innerHTML = '<div class="empty-state">⚠️ Configuration cloud manquante ou invalide.<br><br>Vérifiez SUPABASE_URL et SUPABASE_KEY dans le code.</div>';
  }
  var authOverlay = document.getElementById('authOverlay');
  if(authOverlay) authOverlay.style.display = 'none';
}

