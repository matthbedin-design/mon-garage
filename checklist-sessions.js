// ---- Modale : gestion de la checklist de vérifications d'usage (globale) ----
function openChecklistManagerModal(returnToVehicleId){
  var modal = document.getElementById('modal');

  var themesSet = {};
  state.checklistItems.forEach(function(c){ if(c.theme) themesSet[c.theme] = true; });
  var themeOptionsHtml = Object.keys(themesSet).sort(function(a,b){ return a.localeCompare(b, 'fr'); })
    .map(function(t){ return '<option value="' + escapeHtml(t) + '">'; }).join('');

  var rows = state.checklistItems.map(function(c){
    return '<div class="ct-defect-row checklist-row" data-checklist-id="' + c.id + '">' +
      '<input type="text" class="checklist-item-theme" list="checklistThemesList" value="' + escapeHtml(c.theme || '') + '" placeholder="Thème (ex : Freinage)">' +
      '<input type="text" class="checklist-item-label" value="' + escapeHtml(c.label) + '" placeholder="Point de vérification">' +
      '<button type="button" class="trash-btn checklist-item-remove" title="Retirer" aria-label="Retirer ce point de vérification">' + trashSvg() + '</button>' +
      '</div>';
  }).join('');

  modal.innerHTML =
    '<h3>Checklist de vérifications d\'usage <button class="icon-btn" id="closeModalBtn" aria-label="Fermer">\u2715</button></h3>' +
    '<div class="field-hint" style="margin-bottom:10px;">Cette liste est partagée par tous les véhicules et réutilisée à chaque fiche d\'entretien. Groupe les points par thème pour une lecture plus claire (ex : Freinage, Niveaux et étanchéité).</div>' +
    '<datalist id="checklistThemesList">' + themeOptionsHtml + '</datalist>' +
    '<div id="checklistItemsList">' + rows + '</div>' +
    '<button type="button" class="ct-add-defect-btn" id="addChecklistItemBtn" style="margin-top:10px;">+ Ajouter un point de vérification</button>' +
    '<div class="modal-actions" style="margin-top:16px;">' +
      '<button class="btn btn-primary" id="cancelBtn">Fermer</button>' +
    '</div>';

  document.getElementById('modalOverlay').classList.add('open');
  var closeAndReturn = function(){
    closeModal();
    if(returnToVehicleId) openMaintenanceSheetModal(returnToVehicleId);
  };
  document.getElementById('closeModalBtn').onclick = closeAndReturn;
  document.getElementById('cancelBtn').onclick = closeAndReturn;

  function bindRow(row){
    var removeBtn = row.querySelector('.checklist-item-remove');
    if(removeBtn) removeBtn.onclick = async function(){
      var id = row.getAttribute('data-checklist-id');
      state.checklistItems = state.checklistItems.filter(function(c){ return c.id !== id; });
      await persist();
      row.remove();
    };
    var labelInput = row.querySelector('.checklist-item-label');
    if(labelInput) labelInput.onchange = async function(){
      var id = row.getAttribute('data-checklist-id');
      var item = state.checklistItems.filter(function(c){ return c.id === id; })[0];
      if(!item) return;
      var newLabel = labelInput.value.trim();
      if(!newLabel){ labelInput.value = item.label; return; }
      item.label = newLabel;
      await persist();
    };
    var themeInput = row.querySelector('.checklist-item-theme');
    if(themeInput) themeInput.onchange = async function(){
      var id = row.getAttribute('data-checklist-id');
      var item = state.checklistItems.filter(function(c){ return c.id === id; })[0];
      if(!item) return;
      item.theme = themeInput.value.trim() || null;
      await persist();
    };
  }
  Array.prototype.forEach.call(modal.querySelectorAll('.checklist-row'), bindRow);

  document.getElementById('addChecklistItemBtn').onclick = async function(){
    var id = genId('chk');
    state.checklistItems.push({ id: id, label: '', theme: null });
    await persist();
    var list = document.getElementById('checklistItemsList');
    var row = document.createElement('div');
    row.className = 'ct-defect-row checklist-row';
    row.setAttribute('data-checklist-id', id);
    row.innerHTML = '<input type="text" class="checklist-item-theme" list="checklistThemesList" value="" placeholder="Thème (ex : Freinage)">' +
      '<input type="text" class="checklist-item-label" value="" placeholder="Point de vérification">' +
      '<button type="button" class="trash-btn checklist-item-remove" title="Retirer" aria-label="Retirer ce point de vérification">' + trashSvg() + '</button>';
    list.appendChild(row);
    bindRow(row);
    row.querySelector('.checklist-item-label').focus();
  };
}

function generateMaintenanceSheet(vehicleId, selectedTypeIds, selectedChecklistIds){
  var v = state.vehicles[vehicleId];
  if(!v) return;
  var entries = state.entries[vehicleId] || [];
  var now = new Date();
  var nowStr = now.toLocaleDateString('fr-FR') + ' à ' + now.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  var titre = [v.brand, v.model].filter(Boolean).join(' ') || v.name;

  var html = '<div id="dossier-top"></div>';
  html += '<div class="dossier-cover">';
  html += '<h1>Fiche d\'entretien — ' + escapeHtml(titre) + '</h1>';
  html += '<div class="dossier-sub">Préparée le ' + nowStr + (isTrailer(v) ? '' : ' — ' + fmtKm(v.mileage)) + '</div>';
  html += '<a href="#dossier-bottom" class="jump-link dossier-jump">↓ Aller en bas (imprimer)</a>';
  html += '</div>';

  if(selectedTypeIds.length){
    html += '<div class="dossier-section-title">Interventions à réaliser</div>';
    selectedTypeIds.forEach(function(typeId){
      var st = computeStatus(vehicleId, typeId);
      if(!st) return;
      var last = getLatestEntryFromList(entries, typeId);
      var refNote = (v.intervals && v.intervals[typeId] && v.intervals[typeId].notes) || '';

      html += '<div class="msheet-item">';
      html += '<div class="msheet-item-title">🔧 ' + escapeHtml(st.cfg.label) + '</div>';

      var deadlineParts = [];
      var hasThresholdMs = !!(st.cfg.km || st.cfg.months);
      if(st.needsCounterVisit){
        var cvDeadlineStrMs = (st.last && st.last.ct && st.last.ct.counterVisit && st.last.ct.counterVisit.deadline) ? fmtDate(st.last.ct.counterVisit.deadline) : null;
        deadlineParts.push(cvDeadlineStrMs
          ? (st.cvDeadlinePassed ? 'Contre-visite dépassée depuis le ' + cvDeadlineStrMs : 'Contre-visite à faire avant le ' + cvDeadlineStrMs)
          : (st.cvDeadlinePassed ? 'Contre-visite dépassée' : 'Contre-visite en attente'));
      } else if(hasThresholdMs && st.last){
        if(st.cfg.km){
          var kmThresholdMs = (st.last.km || 0) + st.cfg.km;
          deadlineParts.push(kmThresholdMs.toLocaleString('fr-FR') + ' km');
        }
        if(st.cfg.months && st.last.date){
          var dateThresholdMs = new Date(st.last.date);
          dateThresholdMs.setMonth(dateThresholdMs.getMonth() + st.cfg.months);
          deadlineParts.push('le ' + dateThresholdMs.toLocaleDateString('fr-FR'));
        }
      }
      var deadlineLabel = st.isOverdue ? 'Échéance dépassée : ' : 'À ne pas dépasser : ';
      if(deadlineParts.length) html += '<div class="msheet-item-line">📅 ' + escapeHtml(st.needsCounterVisit ? deadlineParts.join('') : deadlineLabel + deadlineParts.join(' ou ')) + '</div>';

      if(refNote) html += '<div class="msheet-item-line">🧰 Fournitures : ' + escapeHtml(refNote) + '</div>';

      if(last){
        var lastLine = 'Dernière fois le ' + fmtDate(last.date) + (last.km != null ? ' à ' + fmtKm(last.km) : '') + (last.garage ? ' chez ' + last.garage : '');
        html += '<div class="msheet-item-line">🕓 ' + escapeHtml(lastLine) + '</div>';
        if(last.notes) html += '<div class="msheet-item-line msheet-item-quote">« ' + escapeHtml(last.notes) + ' »</div>';
      } else {
        html += '<div class="msheet-item-line">🕓 Aucune intervention de ce type enregistrée jusqu\'ici</div>';
      }

      html += '</div>';
    });
  }

  if(selectedChecklistIds.length){
    html += '<div class="dossier-section-title">Vérifications d\'usage</div>';
    var selectedChecklistObjs = selectedChecklistIds.map(function(id){ return state.checklistItems.filter(function(c){ return c.id === id; })[0]; }).filter(Boolean);
    groupByTheme(selectedChecklistObjs).forEach(function(grp){
      html += '<div class="checklist-theme-title" style="margin-top:10px;">' + escapeHtml(grp.theme) + '</div>';
      html += '<div class="msheet-checklist-print">';
      grp.items.forEach(function(item){
        html += '<div class="msheet-checkbox-row"><span class="msheet-checkbox">☐</span>' + escapeHtml(item.label) + '</div>';
      });
      html += '</div>';
    });
  }

  var area = document.getElementById('dossierPrintArea');
  area.innerHTML = html;
  document.body.classList.add('dossier-mode');
  window.scrollTo(0, 0);

  var actionsHtml = '<div id="dossier-bottom">' +
    '<div style="text-align:center; margin-bottom:10px;"><a href="#dossier-top" class="jump-link dossier-jump">↑ Remonter en haut</a></div>' +
    '<div class="dossier-actions">' +
      '<button class="btn btn-primary" id="dossierPrintNowBtn" style="width:auto; display:inline-block;">🖨 Imprimer / Enregistrer en PDF</button>' +
      '<button class="btn btn-ghost" id="dossierBackBtn" style="width:auto; display:inline-block;">← Retour à l\'app</button>' +
    '</div>' +
  '</div>';
  area.insertAdjacentHTML('beforeend', actionsHtml);
  document.getElementById('dossierPrintNowBtn').onclick = function(){ window.print(); };
  document.getElementById('dossierBackBtn').onclick = function(){
    document.body.classList.remove('dossier-mode');
    area.innerHTML = '';
  };
}

function getLatestEntryFromList(entries, typeId){
  var filtered = entries.filter(function(e){ return e.typeId === typeId; });
  if(!filtered.length) return null;
  filtered.sort(function(a, b){
    if(a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.km || 0) - (a.km || 0);
  });
  return filtered[0];
}

// ---- Modale : liste des fiches d'entretien (sessions) d'un véhicule ----
function openSessionsListModal(vehicleId){
  var v = state.vehicles[vehicleId];
  if(!v) return;
  var modal = document.getElementById('modal');
  var sessions = (state.sessions[vehicleId] || []).slice().sort(function(a, b){ return a.date < b.date ? 1 : -1; });
  var planned = sessions.filter(function(s){ return s.status === 'planned'; });
  var completed = sessions.filter(function(s){ return s.status === 'completed'; });

  function sessionRow(s){
    var typeLabels = s.plannedTypeIds.map(function(id){
      var t = state.types.filter(function(x){ return x.id === id; })[0];
      return t ? t.label : id;
    }).join(', ');
    return '<div class="history-row" data-session-id="' + s.id + '" style="cursor:pointer;">' +
      '<div class="history-main">' +
      '<div class="history-type">📋 ' + fmtDate(s.date) + '</div>' +
      (typeLabels ? '<div class="history-notes">' + escapeHtml(typeLabels) + '</div>' : '') +
      '<div class="history-notes">' + s.entryIds.length + ' / ' + s.plannedTypeIds.length + ' intervention(s) réalisée(s)' + (s.checklistItemIds.length ? ' · ' + s.checklistItemIds.length + ' vérification(s)' : '') + '</div>' +
      '</div></div>';
  }

  var html = '<h3>Fiches d\'entretien <button class="icon-btn" id="closeModalBtn" aria-label="Fermer">\u2715</button></h3>';
  if(planned.length){
    html += '<div class="field-hint" style="margin-bottom:8px;">En cours</div>' + planned.map(sessionRow).join('');
  }
  if(completed.length){
    html += '<div class="field-hint" style="margin:14px 0 8px;">Terminées</div>' + completed.map(sessionRow).join('');
  }
  if(!sessions.length){
    html += '<div class="empty-state">Aucune fiche d\'entretien pour ce véhicule.</div>';
  }
  html += '<div class="modal-actions" style="margin-top:16px;"><button class="btn btn-primary" id="cancelBtn">Fermer</button></div>';

  modal.innerHTML = html;
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('closeModalBtn').onclick = closeModal;
  document.getElementById('cancelBtn').onclick = closeModal;

  Array.prototype.forEach.call(modal.querySelectorAll('[data-session-id]'), function(row){
    row.onclick = function(){ openSessionDetailModal(vehicleId, row.getAttribute('data-session-id')); };
  });
}

// ---- Modale : détail d'une fiche d'entretien — checklist interactive et
// interventions à marquer réalisées (créent une vraie ligne d'historique) ----
function openSessionDetailModal(vehicleId, sessionId){
  var v = state.vehicles[vehicleId];
  var sessions = state.sessions[vehicleId] || [];
  var session = sessions.filter(function(s){ return s.id === sessionId; })[0];
  if(!v || !session) return;
  var modal = document.getElementById('modal');
  var entries = state.entries[vehicleId] || [];
  var readOnly = session.status === 'completed';

  var checklistObjs = session.checklistItemIds.map(function(id){ return state.checklistItems.filter(function(c){ return c.id === id; })[0]; }).filter(Boolean);
  var checklistHtml = groupByTheme(checklistObjs).map(function(grp){
    var itemsHtml = grp.items.map(function(item){
      var res = session.checklistResults.filter(function(r){ return r.itemId === item.id; })[0] || { checked: false, anomaly: null };
      return '<div class="session-check-row" data-item-id="' + item.id + '">' +
        '<label class="type-row-main" style="border:none; padding:6px 0;"><input type="checkbox" class="session-check-box"' + (res.checked ? ' checked' : '') + (readOnly ? ' disabled' : '') + '><span class="name">' + escapeHtml(item.label) + '</span></label>' +
        '<input type="text" class="session-anomaly-input" placeholder="Anomalie / remarque (optionnel)" value="' + escapeHtml(res.anomaly || '') + '"' + (readOnly ? ' disabled' : '') + '>' +
        (readOnly ? '' : '<button type="button" class="link-btn session-anomaly-to-entry" data-item-id="' + item.id + '">+ Créer une intervention à partir de cette remarque</button>') +
        '</div>';
    }).join('');
    return '<div class="checklist-theme-block"><div class="checklist-theme-title">' + escapeHtml(grp.theme) + '</div>' + itemsHtml + '</div>';
  }).join('');

  var typesHtml = session.plannedTypeIds.map(function(typeId){
    var t = state.types.filter(function(x){ return x.id === typeId; })[0];
    var label = t ? t.label : typeId;
    var doneEntry = entries.filter(function(e){ return e.sessionId === session.id && e.typeId === typeId; })[0];
    if(doneEntry){
      return '<div class="msheet-item" style="border-left-color:var(--green);">' +
        '<div class="msheet-item-title">✅ ' + escapeHtml(label) + ' — réalisée</div>' +
        '<div class="msheet-item-line">Le ' + fmtDate(doneEntry.date) + (doneEntry.km != null ? ' à ' + fmtKm(doneEntry.km) : '') + (doneEntry.cost != null ? ' · ' + fmtEuro(doneEntry.cost) : '') + '</div>' +
        '</div>';
    }
    if(readOnly){
      return '<div class="msheet-item"><div class="msheet-item-title">⏳ ' + escapeHtml(label) + ' — non réalisée</div></div>';
    }
    return '<div class="msheet-item">' +
      '<div class="msheet-item-title">🔧 ' + escapeHtml(label) + '</div>' +
      '<button type="button" class="export-btn session-mark-done-btn" data-type="' + typeId + '">✅ Marquer réalisée</button>' +
      '<div class="session-done-form" id="doneForm-' + typeId + '" style="display:none; margin-top:10px;">' +
        '<div class="row2">' +
          '<div class="field"><label>Date</label><input type="date" class="session-done-date" value="' + new Date().toISOString().substring(0, 10) + '"></div>' +
          (isTrailer(v) ? '' : '<div class="field"><label>Kilométrage</label><input type="number" class="session-done-km" value="' + (v.mileage || 0) + '"></div>') +
        '</div>' +
        '<div class="row2">' +
          '<div class="field"><label>Coût (€)</label><input type="number" step="0.01" min="0" class="session-done-cost"></div>' +
          '<div class="field"><label>Garage</label><input type="text" class="session-done-garage"></div>' +
        '</div>' +
        '<div class="field"><label>Notes</label><textarea class="session-done-notes"></textarea></div>' +
        '<button type="button" class="btn btn-primary session-save-done-btn" data-type="' + typeId + '" style="width:auto; display:inline-block;">Enregistrer cette intervention</button>' +
      '</div>' +
    '</div>';
  }).join('');

  modal.innerHTML =
    '<h3>Fiche du ' + fmtDate(session.date) + (readOnly ? ' (terminée)' : '') + ' <button class="icon-btn" id="closeModalBtn" aria-label="Fermer">\u2715</button></h3>' +
    (session.plannedTypeIds.length ? '<div class="dossier-section-title" style="margin-top:0;">Interventions</div>' + typesHtml : '') +
    (checklistObjs.length ? '<div class="dossier-section-title">Vérifications d\'usage</div>' + checklistHtml : '') +
    '<div class="modal-actions" style="margin-top:16px;">' +
      (!readOnly ? '<button class="btn btn-danger" id="deleteSessionBtn">Supprimer la fiche</button>' : '') +
      '<button class="btn btn-ghost" id="cancelBtn">Fermer</button>' +
      (!readOnly ? '<button class="btn btn-primary" id="completeSessionBtn">Terminer la session</button>' : '') +
    '</div>';

  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('closeModalBtn').onclick = closeModal;
  document.getElementById('cancelBtn').onclick = closeModal;

  Array.prototype.forEach.call(modal.querySelectorAll('.session-check-row'), function(row){
    var itemId = row.getAttribute('data-item-id');
    var checkbox = row.querySelector('.session-check-box');
    var anomalyInput = row.querySelector('.session-anomaly-input');
    if(readOnly) return;
    function saveResult(){
      var res = session.checklistResults.filter(function(r){ return r.itemId === itemId; })[0];
      if(!res){ res = { itemId: itemId, checked: false, anomaly: null }; session.checklistResults.push(res); }
      res.checked = checkbox.checked;
      res.anomaly = anomalyInput.value.trim() || null;
      persist();
    }
    checkbox.onchange = saveResult;
    anomalyInput.onchange = saveResult;
  });

  Array.prototype.forEach.call(modal.querySelectorAll('.session-anomaly-to-entry'), function(btn){
    btn.onclick = function(){
      var itemId = btn.getAttribute('data-item-id');
      var item = state.checklistItems.filter(function(c){ return c.id === itemId; })[0];
      var row = modal.querySelector('.session-check-row[data-item-id="' + itemId + '"]');
      var noteText = row ? row.querySelector('.session-anomaly-input').value.trim() : '';
      closeModal();
      activeVehicleId = vehicleId;
      openEntryModal(null);
      var notesField = document.getElementById('f-notes');
      if(notesField) notesField.value = (item ? item.label + ' — ' : '') + noteText;
    };
  });

  Array.prototype.forEach.call(modal.querySelectorAll('.session-mark-done-btn'), function(btn){
    btn.onclick = function(){
      var typeId = btn.getAttribute('data-type');
      var form = document.getElementById('doneForm-' + typeId);
      if(form) form.style.display = (form.style.display === 'none') ? 'block' : 'none';
    };
  });

  Array.prototype.forEach.call(modal.querySelectorAll('.session-save-done-btn'), function(btn){
    btn.onclick = async function(){
      var typeId = btn.getAttribute('data-type');
      var form = document.getElementById('doneForm-' + typeId);
      var dateEl = form.querySelector('.session-done-date');
      var kmEl = form.querySelector('.session-done-km');
      var costInputEl = form.querySelector('.session-done-cost');
      var garageEl = form.querySelector('.session-done-garage');
      var notesEl = form.querySelector('.session-done-notes');

      var date = dateEl.value;
      if(!date){ await showAlert('Merci de renseigner une date.'); return; }
      var km = kmEl ? parseInt(kmEl.value || '0', 10) : null;
      if(kmEl && (isNaN(km) || km < 0)){ await showAlert('Le kilométrage doit être un nombre positif.'); return; }
      var cost = costInputEl.value === '' ? null : parseFloat(costInputEl.value);

      var vv = state.vehicles[vehicleId];
      var now = new Date().toISOString();
      var newEntry = {
        id: genId('e'),
        typeId: typeId,
        date: date,
        km: km,
        notes: notesEl.value.trim(),
        cost: cost,
        garage: garageEl.value.trim() || null,
        sessionId: session.id,
        documents: [],
        createdAt: now,
        updatedAt: now
      };
      var list = state.entries[vehicleId] || [];
      list.push(newEntry);
      state.entries[vehicleId] = list;
      session.entryIds.push(newEntry.id);
      if(vv && km != null && km > vv.mileage) vv.mileage = km;

      var tObj = state.types.filter(function(t){ return t.id === typeId; })[0];
      logEvent(vehicleId, 'Intervention réalisée (fiche du ' + fmtDate(session.date) + ') : ' + (tObj ? tObj.label : typeId));

      await persist();
      openSessionDetailModal(vehicleId, session.id);
    };
  });

  var completeBtn = document.getElementById('completeSessionBtn');
  if(completeBtn) completeBtn.onclick = async function(){
    session.status = 'completed';
    await persist();
    closeModal();
    renderContent();
  };

  var deleteSessionBtn = document.getElementById('deleteSessionBtn');
  if(deleteSessionBtn) deleteSessionBtn.onclick = async function(){
    var ok = await showConfirm('Supprimer cette fiche ? Les interventions déjà enregistrées à partir d\'elle resteront dans l\'historique.', 'Supprimer');
    if(!ok) return;
    state.sessions[vehicleId] = state.sessions[vehicleId].filter(function(s){ return s.id !== session.id; });
    await persist();
    closeModal();
    renderContent();
  };
}

async function sendHistoryByEmail(vehicleId){
  var recipientInput = document.getElementById('email-recipient');
  var noteInput = document.getElementById('email-note');
  var statusEl = document.getElementById('emailSendStatus');
  var sendBtn = document.getElementById('sendEmailBtn');

  var recipient = recipientInput.value.trim();
  if(!recipient || recipient.indexOf('@') === -1){
    statusEl.textContent = 'Merci de renseigner une adresse email valide.';
    statusEl.style.color = 'var(--red)';
    return;
  }

  if(!cloudReady || !currentUser){
    statusEl.textContent = 'Non connecté.';
    statusEl.style.color = 'var(--red)';
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Envoi…';
  statusEl.textContent = '';

  try {
    var res = await sb.functions.invoke('send-history', {
      body: { vehicleId: vehicleId, recipientEmail: recipient, note: noteInput.value.trim() }
    });
    if(res.error){
      throw res.error;
    }
    statusEl.textContent = '✅ Email envoyé à ' + recipient;
    statusEl.style.color = 'var(--green)';
    setTimeout(closeModal, 1500);
  } catch(e){
    console.error('Erreur envoi email historique:', e);
    statusEl.textContent = '❌ Échec de l\'envoi. Réessayez dans un instant.';
    statusEl.style.color = 'var(--red)';
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Envoyer';
  }
}

function iconSvg(){
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>';
}

function gearSvg(){
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
}

function trashSvg(){
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
}
