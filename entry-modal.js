// ---- Modale : Nouvelle / Édition intervention ----
function renderCtDefectRows(defects){
  return (defects || []).map(function(d){
    return '<div class="ct-defect-row" data-defect-id="' + d.id + '">' +
      '<input type="checkbox" class="ct-defect-resolved" ' + (d.resolved ? 'checked' : '') + '>' +
      '<input type="text" class="ct-defect-label" value="' + escapeHtml(d.label) + '" placeholder="Ex : Jeu de direction">' +
      '<button type="button" class="trash-btn ct-defect-remove" title="Retirer" aria-label="Retirer ce défaut">' + trashSvg() + '</button>' +
      '</div>';
  }).join('');
}

function renderCtSection(entry){
  var ct = (entry && entry.ct) || { result: 'ok', defects: [], counterVisit: null };
  var result = ct.result || 'ok';
  var deadline = (ct.counterVisit && ct.counterVisit.deadline) || '';
  var cvDone = !!(ct.counterVisit && ct.counterVisit.done);
  var cvDate = (ct.counterVisit && ct.counterVisit.date) || '';
  var cvResult = (ct.counterVisit && ct.counterVisit.result) || 'ok';

  var html = '<div class="ct-section" id="ctSection">';
  html += '<div class="field"><label>Résultat du contrôle technique</label><select id="ct-result">';
  html += '<option value="ok"' + (result === 'ok' ? ' selected' : '') + '>✅ Favorable</option>';
  html += '<option value="remarks"' + (result === 'remarks' ? ' selected' : '') + '>✅ Favorable avec remarques (défauts mineurs, levée optionnelle)</option>';
  html += '<option value="ko_major"' + (result === 'ko_major' ? ' selected' : '') + '>🟠 Défavorable — défaillance(s) majeure(s) (contre-visite sous 2 mois)</option>';
  html += '<option value="ko_critical"' + (result === 'ko_critical' ? ' selected' : '') + '>🔴 Défavorable — défaillance(s) critique(s) (validité limitée au jour même, contre-visite sous 2 mois)</option>';
  html += '</select></div>';

  html += '<div class="field"><label>Défauts / anomalies relevés</label>';
  html += '<div id="ctDefectsList">' + renderCtDefectRows(ct.defects) + '</div>';
  html += '<button type="button" class="ct-add-defect-btn" id="ctAddDefectBtn">+ Ajouter un défaut</button>';
  html += '</div>';

  var needsCv = (result === 'ko_major' || result === 'ko_critical');
  html += '<div id="ctCounterVisitWrap" style="display:' + (needsCv ? 'block' : 'none') + ';">';
  html += '<div class="ct-counter-visit">';
  html += '<div class="field-hint" style="margin-bottom:8px;">Les défaillances mineures éventuelles ne sont pas recontrôlées à la contre-visite (levée optionnelle).</div>';
  html += '<div class="field"><label>Date limite de contre-visite</label><input type="date" id="ct-cv-deadline" value="' + deadline + '"></div>';
  html += '<div class="type-row" style="border:none; padding:4px 0;"><input type="checkbox" id="ct-cv-done" ' + (cvDone ? 'checked' : '') + '><span class="name">Contre-visite effectuée</span></div>';
  html += '<div id="ctCvDoneFields" style="display:' + (cvDone ? 'block' : 'none') + ';">';
  html += '<div class="row2">';
  html += '<div class="field"><label>Date de la contre-visite</label><input type="date" id="ct-cv-date" value="' + cvDate + '"></div>';
  html += '<div class="field"><label>Résultat</label><select id="ct-cv-result"><option value="ok"' + (cvResult === 'ok' ? ' selected' : '') + '>✅ Favorable</option><option value="ko"' + (cvResult === 'ko' ? ' selected' : '') + '>❌ Toujours défavorable</option></select></div>';
  html += '</div></div>';
  html += '</div></div>';

  html += '</div>';
  return html;
}

function bindCtSectionEvents(){
  var resultSelect = document.getElementById('ct-result');
  var cvWrap = document.getElementById('ctCounterVisitWrap');
  var cvDeadlineInput = document.getElementById('ct-cv-deadline');
  if(resultSelect){
    resultSelect.onchange = function(){
      var isKo = (resultSelect.value === 'ko_major' || resultSelect.value === 'ko_critical');
      if(cvWrap) cvWrap.style.display = isKo ? 'block' : 'none';
      // Pré-remplit la date limite à +2 mois (délai légal, identique pour les deux
      // catégories de défaillance) si elle est vide
      if(isKo && cvDeadlineInput && !cvDeadlineInput.value){
        var dateInput = document.getElementById('f-date');
        var base = dateInput && dateInput.value ? new Date(dateInput.value) : new Date();
        base.setMonth(base.getMonth() + 2);
        cvDeadlineInput.value = base.toISOString().substring(0, 10);
      }
    };
  }

  var cvDoneCheckbox = document.getElementById('ct-cv-done');
  var cvDoneFields = document.getElementById('ctCvDoneFields');
  if(cvDoneCheckbox){
    cvDoneCheckbox.onchange = function(){
      if(cvDoneFields) cvDoneFields.style.display = cvDoneCheckbox.checked ? 'block' : 'none';
    };
  }

  var addDefectBtn = document.getElementById('ctAddDefectBtn');
  var defectsList = document.getElementById('ctDefectsList');
  if(addDefectBtn && defectsList){
    addDefectBtn.onclick = function(){
      var row = document.createElement('div');
      row.className = 'ct-defect-row';
      row.setAttribute('data-defect-id', genId('ctd'));
      row.innerHTML = '<input type="checkbox" class="ct-defect-resolved">' +
        '<input type="text" class="ct-defect-label" placeholder="Ex : Jeu de direction">' +
        '<button type="button" class="trash-btn ct-defect-remove" title="Retirer" aria-label="Retirer ce défaut">' + trashSvg() + '</button>';
      defectsList.appendChild(row);
      bindCtDefectRemove(row);
      row.querySelector('.ct-defect-label').focus();
    };
  }

  Array.prototype.forEach.call(document.querySelectorAll('.ct-defect-row'), bindCtDefectRemove);
}

function bindCtDefectRemove(row){
  var btn = row.querySelector('.ct-defect-remove');
  if(btn) btn.onclick = function(){ row.remove(); };
}

function collectCtData(){
  var result = document.getElementById('ct-result').value;
  var defects = [];
  Array.prototype.forEach.call(document.querySelectorAll('.ct-defect-row'), function(row){
    var labelInput = row.querySelector('.ct-defect-label');
    var label = labelInput ? labelInput.value.trim() : '';
    if(!label) return; // ignore les lignes vides
    defects.push({
      id: row.getAttribute('data-defect-id') || genId('ctd'),
      label: label,
      resolved: row.querySelector('.ct-defect-resolved').checked
    });
  });

  var counterVisit = null;
  if(result === 'ko_major' || result === 'ko_critical'){
    var done = document.getElementById('ct-cv-done').checked;
    counterVisit = {
      required: true,
      deadline: document.getElementById('ct-cv-deadline').value || null,
      done: done,
      date: done ? (document.getElementById('ct-cv-date').value || null) : null,
      result: done ? document.getElementById('ct-cv-result').value : null
    };
  }

  return { result: result, defects: defects, counterVisit: counterVisit };
}

var pendingInvoiceFile = null;   // File sélectionné mais pas encore uploadé (upload différé à l'enregistrement)
var removeInvoiceRequested = false;

function openEntryModal(entryId){
  editingEntryId = entryId;
  pendingInvoiceFile = null;
  removeInvoiceRequested = false;
  var v = state.vehicles[activeVehicleId];
  if(!v) return;

  var entries = state.entries[activeVehicleId] || [];
  var entry = entryId ? entries.filter(function(e){ return e.id === entryId; })[0] : null;

  var enabledTypes = v.enabledTypes || [];
  var availableTypes = state.types
    .filter(function(t){ return enabledTypes.indexOf(t.id) > -1 || (entry && entry.typeId === t.id); })
    .sort(function(a, b){ return a.label.localeCompare(b.label, 'fr'); });

  var typeSelectionHtml;
  if(entry){
    // Édition d'une intervention existante : un seul type, comme avant.
    var typeOptions = availableTypes.map(function(t){
      var selected = entry.typeId === t.id ? ' selected' : '';
      return '<option value="' + t.id + '"' + selected + '>' + escapeHtml(t.label) + '</option>';
    }).join('');
    typeSelectionHtml = '<div class="field"><label>Type d\'intervention</label><select id="f-type">' + typeOptions + '</select></div>';
  } else {
    // Nouvelle intervention : sélection multiple, pour loguer en une fois
    // plusieurs opérations réalisées le même jour au même kilométrage.
    var chips = availableTypes.map(function(t){
      return '<label class="type-select-chip"><input type="checkbox" class="f-type-multi" value="' + t.id + '">' + escapeHtml(t.label) + '</label>';
    }).join('');
    typeSelectionHtml = '<div class="field"><label>Type(s) d\'intervention</label>' +
      '<div class="type-select-list" id="typeSelectList">' + chips + '</div>' +
      '<button type="button" class="ct-add-defect-btn" id="quickAddTypeBtn" style="margin-top:8px;">+ Nouveau type</button>' +
      '<div class="quick-add-type-form" id="quickAddTypeForm" style="display:none;">' +
        '<input type="text" id="quickTypeName" placeholder="Nom du type (ex : Recharge Clim)">' +
        '<select id="quickTypeCategory">' + HISTORY_CATEGORIES.map(function(c){ return '<option value="' + c.id + '">' + c.label + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="btn btn-primary" id="quickTypeCreateBtn" style="width:auto;">Créer</button>' +
      '</div>' +
    '</div>';
  }

  var modal = document.getElementById('modal');
  var title = entry ? 'Modifier l\'intervention' : 'Nouvelle intervention';
  var dateVal = entry ? entry.date : new Date().toISOString().substring(0, 10);
  var kmVal = entry ? entry.km : v.mileage;
  var notesVal = entry ? (entry.notes || '') : '';

  var showCtInitially = entry ? (entry.typeId === 'ct') : false;
  var costVal = entry ? (entry.cost != null ? entry.cost : '') : '';
  var costLabel = entry ? 'Coût (€)' : 'Coût total (€) — optionnel, appliqué à toutes les interventions sélectionnées';
  var garageVal = entry ? (entry.garage || '') : '';
  var supplierVal = entry ? (entry.supplier || '') : '';

  var invoiceCurrentHtml = '';
  if(entry && entry.invoiceDoc){
    invoiceCurrentHtml = '<div class="invoice-current" id="invoiceCurrentChip">📎 ' + escapeHtml(entry.invoiceDoc.name) +
      ' <button type="button" class="link-btn" id="viewInvoiceBtn">Voir</button>' +
      ' <button type="button" class="link-btn" id="removeInvoiceBtn">Retirer</button></div>';
  }

  var trailerVehicle = isTrailer(v);
  var dateKmHtml = trailerVehicle
    ? '<div class="field"><label>Date</label><input type="date" id="f-date" value="' + dateVal + '"></div>'
    : '<div class="row2">' +
        '<div class="field"><label>Date</label><input type="date" id="f-date" value="' + dateVal + '"></div>' +
        '<div class="field"><label>Kilométrage</label><input type="number" id="f-km" value="' + kmVal + '"></div>' +
      '</div>';

  modal.innerHTML =
    '<h3>' + title + ' <button class="icon-btn" id="closeModalBtn" aria-label="Fermer">\u2715</button></h3>' +
    typeSelectionHtml +
    dateKmHtml +
    '<div class="row2">' +
      '<div class="field"><label>' + costLabel + '</label><input type="number" step="0.01" min="0" id="f-cost" value="' + costVal + '" placeholder="—"></div>' +
      '<div class="field"><label>Garage</label><input type="text" id="f-garage" value="' + escapeHtml(garageVal) + '" placeholder="Ex : Feu Vert, Norauto, moi-même..."></div>' +
    '</div>' +
    '<div class="field"><label>Fournisseur (pièces)</label><input type="text" id="f-supplier" value="' + escapeHtml(supplierVal) + '" placeholder="Ex : Oscaro, Mister Auto, concession..."></div>' +
    '<div class="field"><label>Facture (PDF/photo)</label>' + invoiceCurrentHtml +
      '<button type="button" class="export-btn" id="invoiceFileBtn">📎 Joindre une facture</button>' +
      '<span id="invoiceFileName" class="field-hint" style="display:block; margin-top:4px;"></span>' +
      '<input type="file" id="invoiceFileInput" style="display:none;" accept="image/*,application/pdf">' +
    '</div>' +
    '<div class="field"><label>Notes / Observations' + (entry ? '' : ' <span class="field-hint" style="display:inline;">(appliquées à toutes les interventions sélectionnées, sinon la référence de chaque type est utilisée)</span>') + '</label><textarea id="f-notes" placeholder="Référence pièces, garage, remarques...">' + escapeHtml(notesVal) + '</textarea></div>' +
    '<div id="ctSectionWrap" style="display:' + (showCtInitially ? 'block' : 'none') + ';">' + renderCtSection(entry) + '</div>' +
    '<div class="modal-actions">' +
      (entry ? '<button class="btn btn-danger" id="deleteBtn">Supprimer</button>' : '') +
      '<button class="btn btn-ghost" id="cancelBtn">Annuler</button>' +
      '<button class="btn btn-primary" id="saveBtn">Enregistrer</button>' +
    '</div>';

  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('closeModalBtn').onclick = closeModal;
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('saveBtn').onclick = saveEntry;
  if(entry) document.getElementById('deleteBtn').onclick = function(){ deleteEntry(entry.id); };

  var invoiceFileBtn = document.getElementById('invoiceFileBtn');
  var invoiceFileInput = document.getElementById('invoiceFileInput');
  if(invoiceFileBtn && invoiceFileInput){
    invoiceFileBtn.onclick = function(){ invoiceFileInput.click(); };
    invoiceFileInput.onchange = function(){
      var file = invoiceFileInput.files[0];
      if(!file) return;
      pendingInvoiceFile = file;
      removeInvoiceRequested = false;
      var nameEl = document.getElementById('invoiceFileName');
      if(nameEl) nameEl.textContent = 'Sera jointe à l\'enregistrement : ' + file.name;
      var chip = document.getElementById('invoiceCurrentChip');
      if(chip) chip.style.display = 'none';
    };
  }
  var viewInvoiceBtn = document.getElementById('viewInvoiceBtn');
  if(viewInvoiceBtn && entry && entry.invoiceDoc) viewInvoiceBtn.onclick = function(){ openStorageDoc(entry.invoiceDoc.path); };
  var removeInvoiceBtn = document.getElementById('removeInvoiceBtn');
  if(removeInvoiceBtn){
    removeInvoiceBtn.onclick = function(){
      removeInvoiceRequested = true;
      pendingInvoiceFile = null;
      var chip = document.getElementById('invoiceCurrentChip');
      if(chip) chip.style.display = 'none';
      var nameEl = document.getElementById('invoiceFileName');
      if(nameEl) nameEl.textContent = 'La facture sera retirée à l\'enregistrement.';
    };
  }

  bindCtSectionEvents();

  if(entry){
    var typeSelect = document.getElementById('f-type');
    if(typeSelect){
      typeSelect.addEventListener('change', function(){
        var wrap = document.getElementById('ctSectionWrap');
        var isCt = typeSelect.value === 'ct';
        if(wrap){
          wrap.style.display = isCt ? 'block' : 'none';
          if(isCt && !document.getElementById('ct-result')){
            wrap.innerHTML = renderCtSection(null);
            bindCtSectionEvents();
          }
        }
      });
    }
  } else {
    Array.prototype.forEach.call(document.querySelectorAll('.f-type-multi'), function(cb){
      cb.addEventListener('change', function(){
        var wrap = document.getElementById('ctSectionWrap');
        var ctChecked = Array.prototype.some.call(document.querySelectorAll('.f-type-multi'), function(c){ return c.checked && c.value === 'ct'; });
        if(wrap){
          wrap.style.display = ctChecked ? 'block' : 'none';
          if(ctChecked && !document.getElementById('ct-result')){
            wrap.innerHTML = renderCtSection(null);
            bindCtSectionEvents();
          }
        }
      });
    });

    // "+ Nouveau type" : créer un type à la volée sans fermer la modale ni
    // perdre la saisie déjà en cours (date, km, autres types cochés...).
    var quickAddTypeBtn = document.getElementById('quickAddTypeBtn');
    var quickAddTypeForm = document.getElementById('quickAddTypeForm');
    if(quickAddTypeBtn && quickAddTypeForm){
      quickAddTypeBtn.onclick = function(){
        var showing = quickAddTypeForm.style.display !== 'none';
        quickAddTypeForm.style.display = showing ? 'none' : 'flex';
        if(!showing) document.getElementById('quickTypeName').focus();
      };
    }
    var quickTypeCreateBtn = document.getElementById('quickTypeCreateBtn');
    if(quickTypeCreateBtn){
      quickTypeCreateBtn.onclick = async function(){
        var nameInput = document.getElementById('quickTypeName');
        var name = nameInput.value.trim();
        if(!name){ await showAlert('Merci de nommer le nouveau type.'); return; }
        var id = slugify(name);
        if(state.types.filter(function(t){ return t.id === id; }).length){
          await showAlert('Un type avec un nom trop proche existe déjà.');
          return;
        }
        var category = document.getElementById('quickTypeCategory').value;
        state.types.push({ id: id, label: name, km: null, months: null, category: category });
        if(!v.enabledTypes) v.enabledTypes = [];
        v.enabledTypes.push(id);
        if(!v.intervals) v.intervals = {};
        v.intervals[id] = { km: null, months: null };
        logEvent(activeVehicleId, 'Type d\'intervention créé : ' + name);
        await persist();

        // Ajoute la puce directement dans la liste déjà affichée, sans tout reconstruire.
        var list = document.getElementById('typeSelectList');
        if(list){
          var label = document.createElement('label');
          label.className = 'type-select-chip';
          label.innerHTML = '<input type="checkbox" class="f-type-multi" value="' + id + '" checked>' + escapeHtml(name);
          list.appendChild(label);
        }
        nameInput.value = '';
        quickAddTypeForm.style.display = 'none';
      };
    }
  }
}

async function saveEntry(){
  var vSave = state.vehicles[activeVehicleId];
  var date = document.getElementById('f-date').value;
  var kmField = document.getElementById('f-km');
  var km = kmField ? parseInt(kmField.value || '0', 10) : null;
  var sharedNotes = document.getElementById('f-notes').value.trim();
  var costInput = document.getElementById('f-cost').value;
  var cost = costInput === '' ? null : parseFloat(costInput);
  var garage = document.getElementById('f-garage').value.trim();
  var supplier = document.getElementById('f-supplier').value.trim();

  if(!date){ await showAlert('Merci de renseigner une date.'); return; }
  if(kmField && (isNaN(km) || km < 0)){ await showAlert('Le kilométrage doit être un nombre positif.'); return; }
  if(cost !== null && (isNaN(cost) || cost < 0)){ await showAlert('Le coût doit être un nombre positif.'); return; }

  var typeIds;
  if(editingEntryId){
    typeIds = [document.getElementById('f-type').value];
  } else {
    typeIds = Array.prototype.filter.call(document.querySelectorAll('.f-type-multi'), function(cb){ return cb.checked; })
      .map(function(cb){ return cb.value; });
    if(!typeIds.length){ await showAlert('Merci de sélectionner au moins un type d\'intervention.'); return; }
  }

  var conflict = km != null ? findKmConflict(activeVehicleId, date, km, editingEntryId) : null;
  if(conflict){
    var conflictType = state.types.filter(function(t){ return t.id === conflict.typeId; })[0];
    var conflictLabel = conflictType ? conflictType.label : conflict.typeId;
    var msg = 'Ce kilométrage (' + fmtKm(km) + ' le ' + fmtDate(date) + ') est incohérent avec une intervention déjà enregistrée : "' + conflictLabel + '" à ' + fmtKm(conflict.km) + ' le ' + fmtDate(conflict.date) + '. Continuer quand même ?';
    var okConflict = await showConfirm(msg, 'Continuer');
    if(!okConflict) return;
  }

  var v = state.vehicles[activeVehicleId];
  var now = new Date().toISOString();
  var ctData = (typeIds.indexOf('ct') > -1) ? collectCtData() : null;
  var list = state.entries[activeVehicleId] || [];

  // Upload de la facture (différé jusqu'ici pour connaître l'id de l'intervention/du lot)
  var saveBtn = document.getElementById('saveBtn');
  if(saveBtn){ saveBtn.disabled = true; saveBtn.textContent = 'Enregistrement…'; }

  var invoiceDoc = null;
  var invoiceKeyId = editingEntryId || genId('batch');
  try {
    if(pendingInvoiceFile){
      var dataUrl = await prepareDocForStorage(pendingInvoiceFile);
      if(dataUrl){
        var storedType = (pendingInvoiceFile.type && pendingInvoiceFile.type.indexOf('image/') === 0) ? 'image/jpeg' : pendingInvoiceFile.type;
        var path = await uploadEntryInvoice(dataUrl, storedType, pendingInvoiceFile.name, activeVehicleId, invoiceKeyId);
        invoiceDoc = { name: pendingInvoiceFile.name, type: storedType, path: path };
      }
    }
  } catch(e){
    console.error('Erreur upload facture:', e);
    await showAlert('Impossible de joindre la facture, l\'intervention sera quand même enregistrée.');
  }

  if(editingEntryId){
    var typeId = typeIds[0];
    var typeObj = state.types.filter(function(t){ return t.id === typeId; })[0];
    var label = typeObj ? typeObj.label : typeId;
    for(var i = 0; i < list.length; i++){
      if(list[i].id === editingEntryId){
        list[i].typeId = typeId;
        list[i].date = date;
        list[i].km = km;
        list[i].notes = sharedNotes;
        list[i].cost = cost;
        list[i].garage = garage || null;
        list[i].supplier = supplier || null;
        list[i].updatedAt = now;
        if(ctData) list[i].ct = ctData; else delete list[i].ct;

        if(invoiceDoc){
          list[i].invoiceDoc = invoiceDoc;
        } else if(removeInvoiceRequested && list[i].invoiceDoc){
          await deleteInvoiceIfUnshared(list[i].invoiceDoc.path, activeVehicleId, editingEntryId);
          delete list[i].invoiceDoc;
        }
        break;
      }
    }
    logEvent(activeVehicleId, 'Intervention modifiée : ' + label + ' (' + fmtKm(km) + ', ' + fmtDate(date) + ')');
  } else {
    var batchId = (typeIds.length > 1) ? invoiceKeyId : null;
    var createdLabels = [];
    typeIds.forEach(function(tId){
      var tObj = state.types.filter(function(t){ return t.id === tId; })[0];
      var tLabel = tObj ? tObj.label : tId;
      // Texte partagé prioritaire s'il a été renseigné ; sinon on retombe sur la
      // référence propre à ce type pour ce véhicule (huile, pneus, pièce...).
      var refNote = (v.intervals && v.intervals[tId] && v.intervals[tId].notes) || '';
      var notesForThis = sharedNotes || refNote;

      var newEntry = {
        id: genId('e'),
        typeId: tId,
        date: date,
        km: km,
        notes: notesForThis,
        cost: cost,
        garage: garage || null,
        supplier: supplier || null,
        batchId: batchId,
        documents: [],
        createdAt: now,
        updatedAt: now
      };
      if(tId === 'ct' && ctData) newEntry.ct = ctData;
      if(invoiceDoc) newEntry.invoiceDoc = invoiceDoc;
      list.push(newEntry);
      createdLabels.push(tLabel);
    });
    logEvent(activeVehicleId, 'Intervention' + (createdLabels.length > 1 ? 's' : '') + ' ajoutée' + (createdLabels.length > 1 ? 's' : '') + ' : ' + createdLabels.join(', ') + ' (' + fmtKm(km) + ', ' + fmtDate(date) + ')');
  }

  if(v && km != null && km > v.mileage) v.mileage = km;

  // Si cette intervention provient d'une "intervention à prévoir" en cours de
  // conversion, on la retire de la liste d'attente au moment où l'enregistrement
  // réussit réellement — pas à l'ouverture du formulaire, pour ne rien perdre en
  // cas d'annulation.
  if(!editingEntryId && convertingPlannedIntervention && convertingPlannedIntervention.vehicleId === activeVehicleId){
    var plannedList = state.plannedInterventions[activeVehicleId] || [];
    state.plannedInterventions[activeVehicleId] = plannedList.filter(function(p){ return p.id !== convertingPlannedIntervention.id; });
  }

  pendingInvoiceFile = null;
  removeInvoiceRequested = false;

  await persist();
  closeModal();
  renderContent();
}

// Supprime le fichier de facture en Storage seulement si plus aucune autre
// intervention de ce véhicule ne le référence (cas d'une facture partagée).
async function deleteInvoiceIfUnshared(path, vehicleId, excludeEntryId){
  if(!path) return;
  var list = state.entries[vehicleId] || [];
  var stillUsed = list.some(function(e){ return e.id !== excludeEntryId && e.invoiceDoc && e.invoiceDoc.path === path; });
  if(!stillUsed) await deleteDocFromStorage(path);
}

async function deleteEntry(id){
  var ok = await showConfirm('Supprimer cette intervention ?', 'Supprimer');
  if(!ok) return;
  var list = state.entries[activeVehicleId] || [];
  var entry = list.filter(function(e){ return e.id === id; })[0];

  if(entry){
    var typeObj = state.types.filter(function(t){ return t.id === entry.typeId; })[0];
    var label = typeObj ? typeObj.label : entry.typeId;
    logEvent(activeVehicleId, 'Intervention supprimée : ' + label);
    if(entry.invoiceDoc) await deleteInvoiceIfUnshared(entry.invoiceDoc.path, activeVehicleId, id);
  }

  state.entries[activeVehicleId] = list.filter(function(e){ return e.id !== id; });
  await persist();
  closeModal();
  renderContent();
}

function closeModal(){
  var overlay = document.getElementById('modalOverlay');
  if(overlay) overlay.classList.remove('open');
  editingEntryId = null;
  convertingPlannedIntervention = null;
}

