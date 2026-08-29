// ---- Modale : Réglages du véhicule ----
// Capture l'état actuel du formulaire (cases cochées, valeurs km/mois, nom,
// couleur) et l'applique à v — utilisé avant tout rafraîchissement de la
// modale (ajout/suppression de type) pour ne jamais perdre une saisie en cours.
function collectSettingsFormData(v, modal, swatchWrap){
  var name = document.getElementById('s-name').value.trim();
  if(name) v.name = name;

  var selected = swatchWrap.querySelector('.swatch.selected');
  if(selected) v.color = selected.getAttribute('data-color');

  var vehicleTypeEl = document.getElementById('s-vehicletype');
  if(vehicleTypeEl){
    var wasTrailer = isTrailer(v);
    v.vehicleType = vehicleTypeEl.value;
    // En passant en remorque, on efface le kilométrage (qui n'a plus de sens) ;
    // en repassant à moteur, on repart de 0 si rien n'était enregistré avant.
    if(v.vehicleType === 'trailer' && !wasTrailer) v.mileage = null;
    if(v.vehicleType === 'motorized' && wasTrailer && v.mileage == null) v.mileage = 0;
  }

  var brandEl = document.getElementById('s-brand');
  if(brandEl) v.brand = brandEl.value.trim();
  var modelEl = document.getElementById('s-model');
  if(modelEl) v.model = modelEl.value.trim();
  var yearEl = document.getElementById('s-year');
  if(yearEl) v.year = yearEl.value.trim();
  var fuelEl = document.getElementById('s-fuel');
  if(fuelEl) v.fuel = fuelEl.value;
  var vinEl = document.getElementById('s-vin');
  if(vinEl) v.vin = vinEl.value.trim().toUpperCase();
  var firstRegEl = document.getElementById('s-firstreg');
  if(firstRegEl) v.firstRegDate = firstRegEl.value;
  var insuranceEl = document.getElementById('s-insurance');
  if(insuranceEl) v.insurance = insuranceEl.value.trim();

  // Note : l'activation/désactivation des types se fait désormais uniquement
  // via "Gérer les types pour plusieurs véhicules" (modale globale) — cette
  // modale n'affiche que les types déjà actifs et ne modifie donc plus v.enabledTypes.

  if(!v.intervals) v.intervals = {};
  Array.prototype.forEach.call(modal.querySelectorAll('.type-row input[type=number]'), function(inp){
    var t = inp.getAttribute('data-type');
    var field = inp.getAttribute('data-field');
    var val = inp.value === '' ? null : parseInt(inp.value, 10);
    if(!v.intervals[t]) v.intervals[t] = {};
    v.intervals[t][field] = val;
  });
  Array.prototype.forEach.call(modal.querySelectorAll('.type-row .ref-input'), function(inp){
    var t = inp.getAttribute('data-type');
    if(!v.intervals[t]) v.intervals[t] = {};
    v.intervals[t].notes = inp.value.trim() || null;
  });
  Array.prototype.forEach.call(modal.querySelectorAll('.type-row .notify-checkbox'), function(cb){
    var t = cb.getAttribute('data-type');
    if(!v.intervals[t]) v.intervals[t] = {};
    v.intervals[t].notify = cb.checked; // false = pas d'email pour ce type sur ce véhicule
  });
  Array.prototype.forEach.call(modal.querySelectorAll('.type-row .always-show-checkbox'), function(cb){
    var t = cb.getAttribute('data-type');
    if(!v.intervals[t]) v.intervals[t] = {};
    v.intervals[t].alwaysShowGauge = cb.checked;
  });
}

function openSettingsModal(){
  var v = state.vehicles[activeVehicleId];
  var modal = document.getElementById('modal');

  var enabledTypeIds = v.enabledTypes || [];
  var rows = state.types
    .filter(function(t){ return enabledTypeIds.indexOf(t.id) > -1; })
    .sort(function(a, b){ return a.label.localeCompare(b.label, 'fr'); })
    .map(function(t){
      var iv = (v.intervals && v.intervals[t.id]) || {};
      var kmVal = iv.km !== undefined ? iv.km : t.km;
      var monthsVal = iv.months !== undefined ? iv.months : t.months;
      var notesVal = iv.notes || '';
      var notifyChecked = iv.notify !== false; // activé par défaut
      var alwaysShowChecked = !!iv.alwaysShowGauge;

      return '<div class="type-row">' +
        '<div class="type-row-main">' +
        '<span class="name">' + escapeHtml(t.label) + '</span>' +
        (isTrailer(v) ? '' : '<input type="number" data-type="' + t.id + '" data-field="km" value="' + (kmVal == null ? '' : kmVal) + '" placeholder="—"><span class="unit">km</span>') +
        '<input type="number" data-type="' + t.id + '" data-field="months" value="' + (monthsVal == null ? '' : monthsVal) + '" placeholder="—"><span class="unit">mois</span>' +
        '<button class="trash-btn" data-deltype="' + t.id + '" title="Supprimer ce type pour tous les véhicules" aria-label="Supprimer ce type pour tous les véhicules">' + trashSvg() + '</button>' +
        '</div>' +
        '<input type="text" class="ref-input" data-type="' + t.id + '" data-field="notes" value="' + escapeHtml(notesVal) + '" placeholder="Référence (ex : 5W30 - 4,5L - filtre réf. XYZ)">' +
        '<label class="notify-toggle"><input type="checkbox" class="notify-checkbox" data-type="' + t.id + '"' + (notifyChecked ? ' checked' : '') + '> 🔔 Notifier par email pour ce véhicule</label>' +
        '<label class="notify-toggle"><input type="checkbox" class="always-show-checkbox" data-type="' + t.id + '"' + (alwaysShowChecked ? ' checked' : '') + '> 👁️ Toujours afficher dans les échéances (même sans km/mois configurés)</label>' +
        '</div>';
    }).join('');

  if(!rows){
    rows = '<div class="field-hint" style="padding:10px 0;">Aucun type actif pour ce véhicule. Utilisez "Gérer les types pour plusieurs véhicules" ci-dessous pour en activer.</div>';
  }

  var canDelete = state.order.length > 1;

  modal.innerHTML =
    '<h3>Réglages du véhicule <button class="icon-btn" id="closeModalBtn" aria-label="Fermer">\u2715</button></h3>' +
    '<div class="field"><label>Nom du véhicule</label><input type="text" id="s-name" value="' + escapeHtml(v.name) + '"></div>' +
    '<div class="field"><label>Type de véhicule</label><select id="s-vehicletype">' +
      '<option value="motorized"' + (!isTrailer(v) ? ' selected' : '') + '>Véhicule à moteur (suivi au kilométrage)</option>' +
      '<option value="trailer"' + (isTrailer(v) ? ' selected' : '') + '>Remorque / Caravane (pas de kilométrage)</option>' +
    '</select></div>' +
    '<div class="field"><label>Couleur</label><div class="swatches" id="s-swatches"></div></div>' +
    '<hr class="hr">' +
    '<div class="field-hint" style="margin-bottom:8px;">Fiche véhicule (facultatif)</div>' +
    '<div class="row2">' +
      '<div class="field"><label>Marque</label><input type="text" id="s-brand" value="' + escapeHtml(v.brand || '') + '" placeholder="Ex : Renault"></div>' +
      '<div class="field"><label>Modèle</label><input type="text" id="s-model" value="' + escapeHtml(v.model || '') + '" placeholder="Ex : Kangoo"></div>' +
    '</div>' +
    '<div class="row2">' +
      '<div class="field"><label>Année</label><input type="number" id="s-year" value="' + escapeHtml(v.year || '') + '" placeholder="Ex : 2019"></div>' +
      '<div class="field"><label>Carburant</label><select id="s-fuel">' +
        '<option value=""' + (!v.fuel ? ' selected' : '') + '>—</option>' +
        ['Essence','Diesel','Hybride','Électrique','GPL','Autre'].map(function(f){
          return '<option value="' + f + '"' + (v.fuel === f ? ' selected' : '') + '>' + f + '</option>';
        }).join('') +
      '</select></div>' +
    '</div>' +
    '<div class="field"><label>VIN (numéro de châssis)</label><input type="text" id="s-vin" value="' + escapeHtml(v.vin || '') + '" placeholder="17 caractères"></div>' +
    '<div class="row2">' +
      '<div class="field"><label>Date de mise en circulation</label><input type="date" id="s-firstreg" value="' + escapeHtml(v.firstRegDate || '') + '"></div>' +
      '<div class="field"><label>Assurance</label><input type="text" id="s-insurance" value="' + escapeHtml(v.insurance || '') + '" placeholder="Assureur + n° police"></div>' +
    '</div>' +
    '<hr class="hr">' +
    '<div class="field"><label>Types d\'intervention suivis pour ce véhicule</label>' + rows +
      '<div class="add-type-row">' +
        '<input type="text" id="newTypeName" placeholder="Nouveau type (ex : Recharge Clim)">' +
        '<button id="addTypeBtn">+ Ajouter</button>' +
      '</div>' +
      '<button type="button" class="export-btn" id="openTypesManagerBtn" style="margin-top:10px;">🏷️ Gérer les types pour plusieurs véhicules</button>' +
    '</div>' +
    '<div class="modal-actions" style="margin-top:16px;">' +
      (canDelete ? '<button class="btn btn-danger" id="deleteVehicleBtn">Supprimer ce véhicule</button>' : '') +
      '<button class="btn btn-ghost" id="cancelBtn">Fermer</button>' +
      '<button class="btn btn-primary" id="saveSettingsBtn">Enregistrer</button>' +
    '</div>' +
    '<div id="settingsSaveStatus" style="text-align:center; font-size:12.5px; color:var(--green); margin-top:8px; min-height:16px;"></div>';

  var swatchWrap = document.getElementById('s-swatches');
  PALETTE.forEach(function(c){
    var sw = document.createElement('div');
    sw.className = 'swatch' + (c === v.color ? ' selected' : '');
    sw.style.background = c;
    sw.setAttribute('data-color', c);
    sw.onclick = function(){
      Array.prototype.forEach.call(swatchWrap.children, function(el){ el.classList.remove('selected'); });
      sw.classList.add('selected');
    };
    swatchWrap.appendChild(sw);
  });

  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('closeModalBtn').onclick = closeModal;
  document.getElementById('cancelBtn').onclick = closeModal;

  if(canDelete){
    document.getElementById('deleteVehicleBtn').onclick = function(){ deleteVehicle(activeVehicleId); };
  }

  Array.prototype.forEach.call(modal.querySelectorAll('[data-deltype]'), function(btn){
    btn.onclick = async function(){
      collectSettingsFormData(v, modal, swatchWrap);
      await persist();
      var removed = await deleteType(btn.getAttribute('data-deltype'));
      if(removed) openSettingsModal();
    };
  });

  var openTypesManagerBtn = document.getElementById('openTypesManagerBtn');
  if(openTypesManagerBtn) openTypesManagerBtn.onclick = function(){
    collectSettingsFormData(v, modal, swatchWrap);
    persist();
    openTypesManagerModal();
  };

  document.getElementById('addTypeBtn').onclick = async function(){
    var input = document.getElementById('newTypeName');
    var name = input.value.trim();
    if(!name){ await showAlert('Merci de nommer le nouveau type.'); return; }
    var id = slugify(name);

    // Sauvegarde d'abord les modifications déjà faites dans le formulaire
    // (cases cochées, valeurs km/mois) avant d'ajouter le nouveau type,
    // pour ne pas les perdre au rafraîchissement de la modale.
    collectSettingsFormData(v, modal, swatchWrap);

    state.types.push({ id: id, label: name, km: null, months: null });
    if(!v.enabledTypes) v.enabledTypes = [];
    v.enabledTypes.push(id);
    if(!v.intervals) v.intervals = {};
    v.intervals[id] = { km: null, months: null };

    logEvent(activeVehicleId, 'Type d\'intervention créé : ' + name);
    await persist();
    openSettingsModal();
  };

  document.getElementById('saveSettingsBtn').onclick = async function(){
    var oldName = v.name, oldColor = v.color;
    collectSettingsFormData(v, modal, swatchWrap);

    if(v.name !== oldName) logEvent(activeVehicleId, 'Véhicule renommé : "' + oldName + '" -> "' + v.name + '"');
    if(v.color !== oldColor) logEvent(activeVehicleId, 'Couleur du véhicule modifiée');
    logEvent(activeVehicleId, 'Réglages des échéances mis à jour');

    var ok = await persist();
    render(); // met à jour la page derrière la modale, qui reste ouverte

    var statusEl = document.getElementById('settingsSaveStatus');
    if(statusEl){
      statusEl.style.color = ok ? 'var(--green)' : 'var(--red)';
      statusEl.textContent = ok ? '✓ Enregistré' : '❌ Échec de l\'enregistrement, réessayez.';
      clearTimeout(statusEl._clearTimer);
      statusEl._clearTimer = setTimeout(function(){ if(statusEl) statusEl.textContent = ''; }, 3000);
    }
  };
}

async function deleteType(typeId){
  var t = state.types.filter(function(x){ return x.id === typeId; })[0];
  if(!t) return false;
  var ok = await showConfirm('Supprimer le type "' + t.label + '" pour tous les véhicules ? Les interventions déjà enregistrées restent visibles dans l\'historique.', 'Supprimer');
  if(!ok) return false;

  state.types = state.types.filter(function(x){ return x.id !== typeId; });
  state.order.forEach(function(id){
    var v = state.vehicles[id];
    if(v){
      if(v.enabledTypes) v.enabledTypes = v.enabledTypes.filter(function(x){ return x !== typeId; });
      if(v.intervals && v.intervals[typeId]) delete v.intervals[typeId];
    }
  });

  logEvent(null, 'Type d\'intervention supprimé (tous véhicules) : ' + t.label);
  await persist();
  renderContent();
  return true;
}

// ---- Modale : gestion des types d'intervention pour plusieurs véhicules ----
function openTypesManagerModal(){
  renderTypesManagerModal();
  document.getElementById('modalOverlay').classList.add('open');
}

function renderTypesManagerModal(){
  var modal = document.getElementById('modal');

  function vehicleChecklist(typeId, checkboxClass){
    return state.order.map(function(vid){
      var vv = state.vehicles[vid];
      if(!vv) return '';
      var checked = typeId ? ((vv.enabledTypes || []).indexOf(typeId) > -1) : false;
      return '<label class="tm-vehicle-chip"><input type="checkbox" class="' + checkboxClass + '" data-type="' + (typeId || '') + '" data-vehicle="' + vid + '"' + (checked ? ' checked' : '') + '>' + escapeHtml(vv.name) + '</label>';
    }).join('');
  }

  var rows = state.types.slice().sort(function(a, b){ return a.label.localeCompare(b.label, 'fr'); }).map(function(t){
    var reminderKmVal = (t.reminderKm != null) ? t.reminderKm : '';
    var reminderDaysVal = (t.reminderDays != null) ? t.reminderDays : '';
    var catOptions = HISTORY_CATEGORIES.map(function(c){
      return '<option value="' + c.id + '"' + ((t.category || 'autre') === c.id ? ' selected' : '') + '>' + c.label + '</option>';
    }).join('');
    return '<div class="tm-type-row">' +
      '<div class="tm-type-head">' +
        '<input type="text" class="tm-type-name" data-type="' + t.id + '" value="' + escapeHtml(t.label) + '">' +
        '<select class="tm-type-category" data-type="' + t.id + '">' + catOptions + '</select>' +
        '<button class="trash-btn tm-type-delete" data-type="' + t.id + '" title="Supprimer ce type pour tous les véhicules" aria-label="Supprimer ce type pour tous les véhicules">' + trashSvg() + '</button>' +
      '</div>' +
      '<div class="tm-reminder-row">' +
        '<span class="tm-reminder-label">🔔 Prévenir</span>' +
        '<input type="number" class="tm-reminder-input" data-type="' + t.id + '" data-field="reminderKm" value="' + reminderKmVal + '" placeholder="1000"><span class="unit">km avant</span>' +
        '<input type="number" class="tm-reminder-input" data-type="' + t.id + '" data-field="reminderDays" value="' + reminderDaysVal + '" placeholder="30"><span class="unit">j avant</span>' +
      '</div>' +
      '<div class="tm-vehicle-list">' + vehicleChecklist(t.id, 'tm-vehicle-toggle') + '</div>' +
    '</div>';
  }).join('');

  modal.innerHTML =
    '<h3>Types d\'intervention <button class="icon-btn" id="closeModalBtn" aria-label="Fermer">\u2715</button></h3>' +
    '<div class="field-hint" style="margin-bottom:12px;">Ces types sont partagés entre tous les véhicules. Renommez-les ou cochez/décochez les véhicules concernés — tout se sauvegarde automatiquement.</div>' +
    '<div id="tmTypesList">' + rows + '</div>' +
    '<hr class="hr">' +
    '<div class="field"><label>Nouveau type</label>' +
      '<input type="text" id="tmNewTypeName" placeholder="Ex : Recharge Clim" style="width:100%; background:var(--surface-2); border:1px solid var(--border); color:var(--text); font-size:13.5px; padding:9px 11px; border-radius:9px; margin-bottom:8px;">' +
      '<select id="tmNewTypeCategory" class="tm-type-category">' + HISTORY_CATEGORIES.map(function(c){ return '<option value="' + c.id + '">' + c.label + '</option>'; }).join('') + '</select>' +
      '<div class="tm-vehicle-list" id="tmNewTypeVehicles" style="margin-top:8px;">' + vehicleChecklist(null, 'tm-new-vehicle-toggle') + '</div>' +
      '<button type="button" class="ct-add-defect-btn" id="tmAddTypeBtn" style="margin-top:10px;">+ Ajouter ce type</button>' +
    '</div>' +
    '<div class="modal-actions" style="margin-top:16px;">' +
      '<button class="btn btn-primary" id="cancelBtn">Fermer</button>' +
    '</div>';

  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('closeModalBtn').onclick = function(){ closeModal(); render(); };
  document.getElementById('cancelBtn').onclick = function(){ closeModal(); render(); };

  Array.prototype.forEach.call(modal.querySelectorAll('.tm-type-name'), function(inp){
    inp.onchange = async function(){
      var id = inp.getAttribute('data-type');
      var newLabel = inp.value.trim();
      var t = state.types.filter(function(x){ return x.id === id; })[0];
      if(!t) return;
      if(!newLabel){ inp.value = t.label; return; }
      if(t.label !== newLabel){
        logEvent(null, 'Type d\'intervention renommé : "' + t.label + '" -> "' + newLabel + '"');
        t.label = newLabel;
        await persist();
        renderContent();
      }
    };
  });

  Array.prototype.forEach.call(modal.querySelectorAll('.tm-type-category'), function(sel){
    sel.onchange = async function(){
      var id = sel.getAttribute('data-type');
      var t = state.types.filter(function(x){ return x.id === id; })[0];
      if(!t) return;
      t.category = sel.value;
      await persist();
      renderContent();
    };
  });

  Array.prototype.forEach.call(modal.querySelectorAll('.tm-reminder-input'), function(inp){
    inp.onchange = async function(){
      var id = inp.getAttribute('data-type');
      var field = inp.getAttribute('data-field');
      var t = state.types.filter(function(x){ return x.id === id; })[0];
      if(!t) return;
      var val = inp.value === '' ? null : parseInt(inp.value, 10);
      if(val !== null && val < 0){ inp.value = ''; val = null; }
      t[field] = val;
      await persist();
      renderContent();
    };
  });

  Array.prototype.forEach.call(modal.querySelectorAll('.tm-vehicle-toggle'), function(cb){
    cb.onchange = async function(){
      var typeId = cb.getAttribute('data-type');
      var vehicleId = cb.getAttribute('data-vehicle');
      var vv = state.vehicles[vehicleId];
      if(!vv) return;
      if(!vv.enabledTypes) vv.enabledTypes = [];
      var idx = vv.enabledTypes.indexOf(typeId);
      if(cb.checked && idx === -1){
        vv.enabledTypes.push(typeId);
        if(!vv.intervals) vv.intervals = {};
        if(!vv.intervals[typeId]) vv.intervals[typeId] = {};
        logEvent(vehicleId, 'Type activé : ' + typeId);
      } else if(!cb.checked && idx > -1){
        vv.enabledTypes.splice(idx, 1);
        logEvent(vehicleId, 'Type désactivé : ' + typeId);
      }
      await persist();
    };
  });

  Array.prototype.forEach.call(modal.querySelectorAll('.tm-type-delete'), function(btn){
    btn.onclick = async function(){
      var removed = await deleteType(btn.getAttribute('data-type'));
      if(removed) renderTypesManagerModal();
    };
  });

  var addBtnTm = document.getElementById('tmAddTypeBtn');
  if(addBtnTm) addBtnTm.onclick = async function(){
    var input = document.getElementById('tmNewTypeName');
    var name = input.value.trim();
    if(!name){ await showAlert('Merci de nommer le nouveau type.'); return; }
    var id = slugify(name);
    if(state.types.filter(function(t){ return t.id === id; }).length){
      await showAlert('Un type avec un nom trop proche existe déjà.');
      return;
    }
    var categorySelect = document.getElementById('tmNewTypeCategory');
    state.types.push({ id: id, label: name, km: null, months: null, category: categorySelect ? categorySelect.value : 'autre' });

    var checkedVehicles = Array.prototype.filter.call(modal.querySelectorAll('.tm-new-vehicle-toggle'), function(cb){ return cb.checked; })
      .map(function(cb){ return cb.getAttribute('data-vehicle'); });

    checkedVehicles.forEach(function(vid){
      var vv = state.vehicles[vid];
      if(!vv) return;
      if(!vv.enabledTypes) vv.enabledTypes = [];
      vv.enabledTypes.push(id);
      if(!vv.intervals) vv.intervals = {};
      vv.intervals[id] = { km: null, months: null };
    });

    logEvent(null, 'Type d\'intervention créé : ' + name);
    await persist();
    renderTypesManagerModal();
  };
}

// ---- Modale : Ajouter un véhicule ----
function openAddVehicleModal(){
  var modal = document.getElementById('modal');
  var usedColor = PALETTE[state.order.length % PALETTE.length];

  modal.innerHTML =
    '<h3>Ajouter un véhicule <button class="icon-btn" id="closeModalBtn" aria-label="Fermer">\u2715</button></h3>' +
    '<div class="field"><label>Nom</label><input type="text" id="nv-name" placeholder="Ex : Clio, Camping-car..."></div>' +
    '<div class="field"><label>Type de véhicule</label><select id="nv-vehicletype">' +
      '<option value="motorized">Véhicule à moteur (suivi au kilométrage)</option>' +
      '<option value="trailer">Remorque / Caravane (pas de kilométrage)</option>' +
    '</select></div>' +
    '<div class="field" id="nv-km-field"><label>Kilométrage actuel</label><input type="number" id="nv-km" value="0"></div>' +
    '<div class="field"><label>Couleur</label><div class="swatches" id="nv-swatches"></div></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="cancelBtn">Annuler</button>' +
      '<button class="btn btn-primary" id="createVehicleBtn">Créer</button>' +
    '</div>';

  var swatchWrap = document.getElementById('nv-swatches');
  PALETTE.forEach(function(c){
    var sw = document.createElement('div');
    sw.className = 'swatch' + (c === usedColor ? ' selected' : '');
    sw.style.background = c;
    sw.setAttribute('data-color', c);
    sw.onclick = function(){
      Array.prototype.forEach.call(swatchWrap.children, function(el){ el.classList.remove('selected'); });
      sw.classList.add('selected');
    };
    swatchWrap.appendChild(sw);
  });

  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('closeModalBtn').onclick = closeModal;
  document.getElementById('cancelBtn').onclick = closeModal;

  var nvTypeSelect = document.getElementById('nv-vehicletype');
  var nvKmField = document.getElementById('nv-km-field');
  if(nvTypeSelect && nvKmField){
    nvTypeSelect.onchange = function(){
      nvKmField.style.display = (nvTypeSelect.value === 'trailer') ? 'none' : 'block';
    };
  }

  document.getElementById('createVehicleBtn').onclick = async function(){
    var name = document.getElementById('nv-name').value.trim();
    if(!name){ await showAlert('Merci de donner un nom au véhicule.'); return; }

    var vehicleType = nvTypeSelect ? nvTypeSelect.value : 'motorized';
    var km = parseInt(document.getElementById('nv-km').value || '0', 10);
    var selected = swatchWrap.querySelector('.swatch.selected');
    var color = selected ? selected.getAttribute('data-color') : usedColor;

    var id = genId('v');
    var allIds = state.types.map(function(t){ return t.id; });
    var vehicle = makeVehicle(name, color, allIds);
    vehicle.vehicleType = vehicleType;
    vehicle.mileage = (vehicleType === 'trailer') ? null : (isNaN(km) ? 0 : km);

    state.vehicles[id] = vehicle;
    state.entries[id] = [];
    state.order.push(id);
    activeVehicleId = id;

    logEvent(id, 'Véhicule créé');
    await persist();
    closeModal();
    render();
  };
}

async function deleteVehicle(id){
  var v = state.vehicles[id];
  if(!v) return;
  var ok = await showConfirm('Supprimer "' + v.name + '" et tout son historique d\'entretien ? Cette action est définitive.', 'Supprimer');
  if(!ok) return;

  logEvent(id, 'Véhicule "' + v.name + '" supprimé');
  state.order = state.order.filter(function(x){ return x !== id; });
  delete state.vehicles[id];
  delete state.entries[id];
  delete state.sessions[id];
  activeVehicleId = DASHBOARD_ID;

  await persist();
  closeModal();
  render();
}

