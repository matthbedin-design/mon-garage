// ---- Rendu UI ----
function render(){
  renderTabs();
  renderContent();
  var fab = document.querySelector('.fab');
  if(fab) fab.style.display = (activeVehicleId === DASHBOARD_ID) ? 'none' : 'flex';
}

function renderTabs(){
  var nav = document.getElementById('tabsNav');
  if(!nav) return;

  var dashActiveClass = (activeVehicleId === DASHBOARD_ID) ? ' active' : '';
  var dashStyle = (activeVehicleId === DASHBOARD_ID) ? 'border-bottom-color:var(--yellow); color:var(--yellow);' : '';
  var html = '<button class="tab-btn' + dashActiveClass + '" style="' + dashStyle + '" data-id="' + DASHBOARD_ID + '" role="tab" aria-selected="' + (activeVehicleId === DASHBOARD_ID) + '" tabindex="' + (activeVehicleId === DASHBOARD_ID ? '0' : '-1') + '">📊 Aperçu</button>';

  html += state.order.map(function(id){
    var v = state.vehicles[id];
    if(!v) return '';
    var isActive = (id === activeVehicleId);
    var activeClass = isActive ? ' active' : '';
    var style = isActive ? 'border-bottom-color:' + v.color + '; color:' + v.color + ';' : '';
    return '<button class="tab-btn' + activeClass + '" style="' + style + '" data-id="' + id + '" role="tab" aria-selected="' + isActive + '" tabindex="' + (isActive ? '0' : '-1') + '">' + escapeHtml(v.name) + '</button>';
  }).join('');

  html += '<button class="tab-add" id="addVehicleTabBtn" title="Ajouter un véhicule" aria-label="Ajouter un véhicule">+</button>';
  nav.innerHTML = html;
  nav.setAttribute('role', 'tablist');

  var tabButtons = Array.prototype.slice.call(nav.querySelectorAll('.tab-btn'));
  tabButtons.forEach(function(btn, idx){
    btn.onclick = function(){
      activeVehicleId = btn.getAttribute('data-id');
      render();
    };
    // Navigation clavier : flèches gauche/droite pour passer d'un onglet à l'autre
    btn.addEventListener('keydown', function(e){
      if(e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      var nextIdx = e.key === 'ArrowRight' ? (idx + 1) % tabButtons.length : (idx - 1 + tabButtons.length) % tabButtons.length;
      tabButtons[nextIdx].focus();
      tabButtons[nextIdx].click();
    });
  });

  var addTab = document.getElementById('addVehicleTabBtn');
  if(addTab) addTab.onclick = openAddVehicleModal;
}

function renderDashboardContent(content){
  var vehicleIds = state.order.filter(function(id){ return state.vehicles[id]; });

  document.documentElement.style.setProperty('--accent', 'var(--yellow)');

  if(!vehicleIds.length){
    content.innerHTML = '<div class="empty-state">Aucun véhicule enregistré.<br><br><button class="btn btn-primary" style="width:auto; display:inline-block;" id="emptyStateAddBtn">+ Ajouter un véhicule</button></div>';
    var emptyBtn1 = document.getElementById('emptyStateAddBtn');
    if(emptyBtn1) emptyBtn1.onclick = openAddVehicleModal;
    return;
  }

  var summaries = vehicleIds.map(function(id){
    var v = state.vehicles[id];
    var enabled = v.enabledTypes || [];
    var items = [];
    enabled.forEach(function(typeId){
      var st = computeStatus(id, typeId);
      if(st && st.last) items.push(st);
    });
    var overdue = items.filter(function(s){ return s.isOverdue; });
    var warning = items.filter(function(s){ return s.isWarning && !s.isOverdue; });
    var worst = overdue.length ? 'overdue' : (warning.length ? 'warning' : 'ok');

    var alertItems = overdue.concat(warning).sort(function(a, b){
      var ra = (a.remainingKm !== null ? a.remainingKm : Infinity);
      var rb = (b.remainingKm !== null ? b.remainingKm : Infinity);
      var da = (a.remainingDays !== null ? a.remainingDays : Infinity);
      var db = (b.remainingDays !== null ? b.remainingDays : Infinity);
      return Math.min(ra, da) - Math.min(rb, db);
    });

    return { id: id, v: v, worst: worst, overdueCount: overdue.length, warningCount: warning.length, alertItems: alertItems };
  });

  var totalOverdue = summaries.reduce(function(sum, s){ return sum + s.overdueCount; }, 0);
  var totalWarning = summaries.reduce(function(sum, s){ return sum + s.warningCount; }, 0);

  var html = '<section>';
  html += '<h2 class="section-title">Vue d\'ensemble</h2>';
  if(totalOverdue > 0 || totalWarning > 0){
    var bannerParts = [];
    if(totalOverdue > 0) bannerParts.push(totalOverdue + ' échéance' + (totalOverdue > 1 ? 's' : '') + ' dépassée' + (totalOverdue > 1 ? 's' : ''));
    if(totalWarning > 0) bannerParts.push(totalWarning + ' à surveiller');
    html += '<div class="dash-banner ' + (totalOverdue > 0 ? 'overdue' : 'warning') + '">⚠️ ' + bannerParts.join(' · ') + '</div>';
  } else {
    html += '<div class="dash-banner ok">✅ Tous les véhicules sont à jour</div>';
  }
  html += '</section>';

  // Interventions à prévoir, tous véhicules confondus — visibilité immédiate à l'accueil
  var allPlanned = [];
  vehicleIds.forEach(function(id){
    getPlannedInterventions(id).forEach(function(p){
      allPlanned.push({ vehicleId: id, vehicleName: state.vehicles[id].name, item: p });
    });
  });
  if(allPlanned.length){
    allPlanned.sort(function(a,b){ return a.item.createdAt < b.item.createdAt ? 1 : -1; });
    html += '<section>';
    html += '<h2 class="section-title">Interventions à prévoir (' + allPlanned.length + ')</h2>';
    allPlanned.forEach(function(entry){
      html += '<div class="planned-item" data-planned-id="' + entry.item.id + '" data-planned-vehicle-id="' + entry.vehicleId + '">';
      html += '<div class="planned-item-main">';
      html += '<div class="planned-item-label">' + escapeHtml(entry.item.label) + '</div>';
      html += '<div class="planned-item-veh">' + escapeHtml(entry.vehicleName) + '</div>';
      if(entry.item.notes) html += '<div class="planned-item-notes">' + escapeHtml(entry.item.notes) + '</div>';
      html += '</div>';
      html += '<div class="planned-item-actions">';
      html += '<button type="button" class="export-btn dash-planned-convert-btn" data-planned-id="' + entry.item.id + '" data-planned-vehicle-id="' + entry.vehicleId + '">✅ Créer l\'intervention</button>';
      html += '</div>';
      html += '</div>';
    });
    html += '</section>';
  }

  html += '<section><div class="dash-grid">';
  summaries.forEach(function(s){
    var badgeColor = s.worst === 'overdue' ? 'var(--red)' : (s.worst === 'warning' ? 'var(--yellow)' : 'var(--green)');
    var badgeText = s.worst === 'overdue'
      ? (s.overdueCount + ' dépassée' + (s.overdueCount > 1 ? 's' : ''))
      : (s.worst === 'warning' ? (s.warningCount + ' à surveiller') : 'À jour');

    html += '<div class="dash-card" data-vehicle-id="' + s.id + '" style="--accent:' + (s.v.color || 'var(--yellow)') + '">';
    html += '<div class="dash-card-top">';
    html += '<div class="dash-card-name">' + escapeHtml(s.v.name) + '</div>';
    html += '<span class="dash-badge" style="background:' + badgeColor + ';">' + escapeHtml(badgeText) + '</span>';
    html += '</div>';
    var metaParts = [];
    if(!isTrailer(s.v)) metaParts.push(fmtKm(s.v.mileage));
    if(s.v.plate) metaParts.push(escapeHtml(s.v.plate));
    html += '<div class="dash-card-meta">' + metaParts.join(' · ') + '</div>';

    if(s.alertItems.length){
      html += '<ul class="dash-alert-list">';
      s.alertItems.slice(0, 3).forEach(function(item){
        var parts = [];
        if(item.needsCounterVisit){
          parts.push('contre-visite ' + (item.isOverdue ? 'dépassée' : 'dans ' + item.remainingDays + ' j'));
        } else {
          if(item.remainingKm !== null){
            parts.push(item.remainingKm <= 0
              ? ('dépassé de ' + Math.abs(item.remainingKm).toLocaleString('fr-FR') + ' km')
              : ('dans ' + item.remainingKm.toLocaleString('fr-FR') + ' km'));
          }
          if(item.remainingDays !== null){
            parts.push(item.remainingDays <= 0
              ? ('dépassé de ' + Math.abs(item.remainingDays) + ' j')
              : ('dans ' + item.remainingDays + ' j'));
          }
        }
        var dot = item.isOverdue ? 'var(--red)' : 'var(--yellow)';
        html += '<li><span class="dash-dot" style="background:' + dot + ';"></span>' + escapeHtml(item.cfg.label) + ' — ' + parts.join(' / ') + '</li>';
      });
      html += '</ul>';
    } else {
      html += '<div class="dash-ok-text">Aucune échéance proche</div>';
    }

    html += '</div>';
  });
  html += '</div></section>';

  content.innerHTML = html;

  Array.prototype.forEach.call(content.querySelectorAll('.dash-card'), function(card){
    card.onclick = function(){
      activeVehicleId = card.getAttribute('data-vehicle-id');
      render();
    };
  });

  Array.prototype.forEach.call(content.querySelectorAll('.dash-planned-convert-btn'), function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      startConvertPlannedIntervention(btn.getAttribute('data-planned-vehicle-id'), btn.getAttribute('data-planned-id'));
    };
  });
}

function renderContent(){
  var content = document.getElementById('content');
  if(!content) return;

  if(activeVehicleId === DASHBOARD_ID){
    renderDashboardContent(content);
    return;
  }

  var v = state.vehicles[activeVehicleId];
  if(!v){
    content.innerHTML = '<div class="empty-state">Aucun véhicule enregistré.<br><br><button class="btn btn-primary" style="width:auto; display:inline-block;" id="emptyStateAddBtn2">+ Ajouter un véhicule</button></div>';
    var emptyBtn2 = document.getElementById('emptyStateAddBtn2');
    if(emptyBtn2) emptyBtn2.onclick = openAddVehicleModal;
    return;
  }

  // Appliquer la couleur d'accent au véhicule
  document.documentElement.style.setProperty('--accent', v.color || 'var(--yellow)');

  var entries = state.entries[activeVehicleId] || [];

  var html = '<div class="print-export-date" id="printExportDate"></div>';

  // Entête du véhicule
  html += '<div class="vehicle-header" style="--accent:' + (v.color || 'var(--yellow)') + '">';
  html += '<div class="row1">';
  html += '<div>';
  html += '<h1 class="vehicle-name">' + escapeHtml(v.name) + '</h1>';
  html += '<input type="text" class="vehicle-plate-input" id="v-plate" value="' + escapeHtml(v.plate || '') + '" placeholder="Immatriculation (ex: AA-123-BB)">';
  html += '</div>';
  html += '<button class="icon-btn" id="settingsBtn" title="Réglages du véhicule" aria-label="Réglages du véhicule">' + gearSvg() + '</button>';
  html += '</div>';

  // Kilométrage (masqué pour les remorques/caravanes)
  if(!isTrailer(v)){
    html += '<div class="mileage-row">';
    html += '<input type="number" class="mileage-input" id="v-km" value="' + (v.mileage || 0) + '">';
    html += '<span class="mileage-unit">km parcourus</span>';
    html += '</div>';
  }

  // Fiche véhicule (affichée seulement si au moins un champ est renseigné)
  var fiche = [];
  if(v.brand || v.model) fiche.push([v.brand, v.model].filter(Boolean).join(' '));
  if(v.year) fiche.push(v.year);
  if(v.fuel) fiche.push(v.fuel);
  if(v.vin) fiche.push('VIN ' + v.vin);
  if(v.firstRegDate) fiche.push('Mise en circ. ' + fmtDate(v.firstRegDate));
  if(v.insurance) fiche.push('🛡️ ' + v.insurance);
  if(fiche.length){
    html += '<div class="vehicle-fiche">' + fiche.map(escapeHtml).join(' · ') + '</div>';
  }

  // Documents attachés au véhicule
  html += '<div class="doc-section">';
  html += '<div class="doc-section-label">Documents (carte grise, assurance...)</div>';
  html += '<div class="doc-chip-row">';
  
  (v.documents || []).forEach(function(doc, idx){
    html += '<div class="doc-chip">';
    var thumbContent = (doc.type && doc.type.indexOf('image/') === 0 && doc.data)
      ? '<img src="' + doc.data + '" alt="' + escapeHtml(doc.name) + '">'
      : (doc.type && doc.type.indexOf('image/') === 0 ? '🖼' : '📄');
    html += '<div class="doc-thumb" data-doc-idx="' + idx + '">' + thumbContent + '</div>';
    html += '<div class="doc-name" title="' + escapeHtml(doc.name) + '">' + escapeHtml(doc.name) + '</div>';
    html += '<button class="doc-remove" data-idx="' + idx + '" title="Supprimer" aria-label="Supprimer le document">✕</button>';
    html += '</div>';
  });

  html += '<button class="doc-add-btn" id="addDocBtn" title="Ajouter un document">+</button>';
  html += '<input type="file" id="docFileInput" style="display:none;" accept="image/*,application/pdf">';
  html += '</div></div>';
  html += '</div>'; // Fin vehicle-header

  // Section 1 : Échéances à venir (repliable — pratique sur mobile pour
  // atteindre l'historique sans tout dérouler)
  var isCollapsed = !!gaugesSectionCollapsed[activeVehicleId];
  var plannedCount = (state.sessions[activeVehicleId] || []).filter(function(s){ return s.status === 'planned'; }).length;
  html += '<section>';
  html += '<h2 class="section-title">';
  html += '<span class="collapsible-title-inline" id="gaugesToggle"><span>Échéances d\'entretien</span><span class="collapse-chevron">' + (isCollapsed ? '▸' : '▾') + '</span></span>';
  html += '<span class="export-actions">';
  if(plannedCount) html += '<button class="export-btn" id="openSessionsBtn" title="Voir les fiches en cours">📋 ' + plannedCount + ' en cours</button>';
  html += '<button class="export-btn" id="maintenanceSheetBtn" title="Générer une fiche d\'entretien">🧾 Fiche d\'entretien</button>';
  html += '</span></h2>';
  html += '<div id="gaugesBody" style="display:' + (isCollapsed ? 'none' : 'block') + ';">';

  var enabled = v.enabledTypes || [];
  // Ne garde que les types ayant une échéance réellement configurée (km ou mois),
  // sauf si l'utilisateur a explicitement demandé à toujours afficher ce type
  // (case "Toujours afficher" dans les réglages du véhicule).
  var gaugeTypeIds = enabled.filter(function(typeId){
    var cfg = getTypeConfig(v, typeId);
    if(!cfg) return false;
    var alwaysShow = !!(v.intervals && v.intervals[typeId] && v.intervals[typeId].alwaysShowGauge);
    return alwaysShow || cfg.km != null || cfg.months != null;
  });
  // Tri alphabétique — plus facile à parcourir sur une longue liste de types.
  gaugeTypeIds.sort(function(a, b){
    var ta = state.types.filter(function(t){ return t.id === a; })[0];
    var tb = state.types.filter(function(t){ return t.id === b; })[0];
    return (ta ? ta.label : a).localeCompare(tb ? tb.label : b, 'fr');
  });

  if(!gaugeTypeIds.length){
    html += '<div class="gauge-empty">Aucune échéance configurée pour ce véhicule. Renseigne un seuil (km/mois) ou coche "Toujours afficher" dans les réglages du véhicule.</div>';
  } else {
    gaugeTypeIds.forEach(function(typeId){
      var st = computeStatus(activeVehicleId, typeId);
      if(!st) return;

      var hasThreshold = !!(st.cfg.km || st.cfg.months);
      var barColor = 'var(--green)';
      if(st.isOverdue) barColor = 'var(--red)';
      else if(st.isWarning) barColor = 'var(--yellow)';
      if(st.needsCounterVisit && st.last && st.last.ct && st.last.ct.result === 'ko_major' && !st.cvDeadlinePassed) barColor = 'var(--orange)';

      var statusText = 'Aucun historique';
      if(st.last){
        if(st.needsCounterVisit){
          var cvDeadlinePassed = !!st.cvDeadlinePassed;
          var cvDeadlineStr = (st.last.ct && st.last.ct.counterVisit && st.last.ct.counterVisit.deadline) ? fmtDate(st.last.ct.counterVisit.deadline) : null;
          var cvPrefix = (st.last.ct && st.last.ct.result === 'ko_critical') ? 'Défaillance critique — contre-visite ' : 'Contre-visite ';
          statusText = cvDeadlineStr
            ? (cvPrefix + (cvDeadlinePassed ? 'dépassée depuis le ' + cvDeadlineStr : 'à faire avant le ' + cvDeadlineStr))
            : (cvPrefix + (cvDeadlinePassed ? 'dépassée' : 'en attente'));
        } else if(!hasThreshold){
          // Type suivi sans seuil configuré ("toujours afficher") : simple repère
          // informatif, pas une échéance — couleur neutre, pas de barre de jauge.
          statusText = 'Dernière intervention : ' + fmtDate(st.last.date);
          barColor = 'var(--text)';
        } else {
          // Échéance exprimée en valeur absolue (km/date à ne pas dépasser),
          // plus parlante qu'un compte à rebours pour anticiper.
          var parts = [];
          if(st.cfg.km){
            var kmThreshold = (st.last.km || 0) + st.cfg.km;
            parts.push(kmThreshold.toLocaleString('fr-FR') + ' km');
          }
          if(st.cfg.months && st.last.date){
            var dateThreshold = new Date(st.last.date);
            dateThreshold.setMonth(dateThreshold.getMonth() + st.cfg.months);
            parts.push('le ' + dateThreshold.toLocaleDateString('fr-FR'));
          }
          statusText = (st.isOverdue ? 'Échéance dépassée : ' : 'Prochaine échéance : ') + parts.join(' ou ');
        }
      }

      html += '<div class="gauge-card">';
      html += '<div class="gauge-top">';
      html += '<span class="gauge-label">' + escapeHtml(st.cfg.label) + '</span>';
      html += '<span class="gauge-status" style="color:' + barColor + ';">' + escapeHtml(statusText) + '</span>';
      html += '</div>';
      var typeNotes = (v.intervals && v.intervals[st.cfg.id] && v.intervals[st.cfg.id].notes) || '';
      if(typeNotes) html += '<div class="gauge-ref">📎 ' + escapeHtml(typeNotes) + '</div>';
      if(hasThreshold || st.needsCounterVisit){
        html += '<div class="gauge-track">';
        html += '<div class="fill" style="width:' + st.pct + '%; background:' + barColor + ';"></div>';
        html += '</div>';
      }
      html += '</div>';
    });
  }
  html += '</div>'; // fin #gaugesBody
  html += '</section>';

  // Section 1ter : Interventions à prévoir (besoins identifiés — checklist ou saisie
  // manuelle — en attente de planification avant d'être converties en intervention réelle)
  var plannedList = getPlannedInterventions(activeVehicleId);
  html += '<section>';
  html += '<h2 class="section-title"><span>Interventions à prévoir' + (plannedList.length ? ' (' + plannedList.length + ')' : '') + '</span>';
  html += '<span class="export-actions"><button class="export-btn" id="addPlannedBtn" title="Ajouter une intervention à prévoir">+ Ajouter</button></span></h2>';
  if(!plannedList.length){
    html += '<div class="gauge-empty">Aucune intervention à prévoir pour ce véhicule.</div>';
  } else {
    plannedList.slice().sort(function(a,b){ return a.createdAt < b.createdAt ? 1 : -1; }).forEach(function(p){
      html += '<div class="planned-item" data-planned-id="' + p.id + '">';
      html += '<div class="planned-item-main">';
      html += '<div class="planned-item-label">' + escapeHtml(p.label) + '</div>';
      if(p.notes) html += '<div class="planned-item-notes">' + escapeHtml(p.notes) + '</div>';
      html += '</div>';
      html += '<div class="planned-item-actions">';
      html += '<button type="button" class="export-btn planned-convert-btn" data-planned-id="' + p.id + '">✅ Créer l\'intervention</button>';
      html += '<button type="button" class="trash-btn planned-remove-btn" data-planned-id="' + p.id + '" title="Retirer" aria-label="Retirer cette intervention à prévoir">' + trashSvg() + '</button>';
      html += '</div>';
      html += '</div>';
    });
  }
  html += '</section>';

  // Section 1bis : Coûts d'entretien (déduplication des factures partagées par batchId)
  var costStats = computeCostStats(entries);
  if(costStats.hasAny){
    var costsCollapsed = !!costsSectionCollapsed[activeVehicleId];
    html += '<section>';
    html += '<h2 class="section-title collapsible-title" id="costsToggle"><span>Coûts d\'entretien</span><span class="collapse-chevron">' + (costsCollapsed ? '▸' : '▾') + '</span></h2>';
    html += '<div id="costsBody" style="display:' + (costsCollapsed ? 'none' : 'block') + ';">';
    html += '<div class="cost-stats-grid">';
    html += '<div class="cost-stat"><div class="cost-stat-value">' + fmtEuro(costStats.total) + '</div><div class="cost-stat-label">Total dépensé</div></div>';
    if(costStats.perKm != null){
      html += '<div class="cost-stat"><div class="cost-stat-value">' + fmtEuro(costStats.perKm) + '</div><div class="cost-stat-label">par km parcouru</div></div>';
    }
    if(costStats.currentYear != null){
      html += '<div class="cost-stat"><div class="cost-stat-value">' + fmtEuro(costStats.currentYear) + '</div><div class="cost-stat-label">Cette année (' + new Date().getFullYear() + ')</div></div>';
    }
    html += '</div>';
    if(costStats.byYear.length > 1){
      if(costChartYears[activeVehicleId] == null) costChartYears[activeVehicleId] = Math.min(10, costStats.byYear.length);
      var yearsCount = Math.max(2, Math.min(costChartYears[activeVehicleId], costStats.byYear.length));
      var chart = renderCostChart(costStats.byYear, yearsCount, v.color || 'var(--yellow)');

      html += '<div class="cost-chart-controls">';
      html += '<button type="button" class="cost-chart-btn" id="costChartMinus" ' + (yearsCount <= 2 ? 'disabled' : '') + '>−</button>';
      html += '<span>' + yearsCount + ' dernière' + (yearsCount > 1 ? 's' : '') + ' année' + (yearsCount > 1 ? 's' : '') + '</span>';
      html += '<button type="button" class="cost-chart-btn" id="costChartPlus" ' + (yearsCount >= costStats.byYear.length ? 'disabled' : '') + '>+</button>';
      html += '</div>';
      html += '<div class="cost-chart-wrap">' + chart.svg + '</div>';
      if(chart.avg != null){
        html += '<div class="cost-chart-legend">Moyenne : ' + fmtEuro(chart.avg) + ' · Médiane : ' + fmtEuro(chart.med) + '</div>';
      }
    }
    html += '</div>'; // fin #costsBody
    html += '</section>';
  }

  // Section 2 : Historique
  if(historyFiltersVehicleId !== activeVehicleId){
    historyFilters = { category: 'all', garage: '', search: '', invoiceOnly: false, dateFrom: '', dateTo: '' };
    historyFiltersVehicleId = activeVehicleId;
  }
  var historyCollapsed = !!historySectionCollapsed[activeVehicleId];

  html += '<section id="historique-section">';
  html += '<h2 class="section-title">';
  html += '<span class="collapsible-title-inline" id="historyToggle"><span>Historique complet (' + entries.length + ')</span><span class="collapse-chevron">' + (historyCollapsed ? '▸' : '▾') + '</span></span>';
  html += '<span class="export-actions">';
  html += '<button class="export-btn" id="printBtn" title="Imprimer / Enregistrer en PDF">🖨 PDF</button>';
  html += '<button class="export-btn" id="exportCsvBtn" title="Exporter en CSV">⬇ CSV</button>';
  html += '<button class="export-btn" id="emailHistoryBtn" title="Envoyer par email">✉️ Email</button>';
  html += '<button class="export-btn" id="saleDossierBtn" title="Générer un dossier de vente">🚗 Dossier de vente</button>';
  html += '</span></h2>';

  html += '<div id="historyBody" style="display:' + (historyCollapsed ? 'none' : 'block') + ';">';

  if(entries.length){
    html += '<div class="hist-filters">';
    html += '<select id="histFilterCategory">';
    html += '<option value="all"' + (historyFilters.category === 'all' ? ' selected' : '') + '>Toutes catégories</option>';
    HISTORY_CATEGORIES.forEach(function(c){
      html += '<option value="' + c.id + '"' + (historyFilters.category === c.id ? ' selected' : '') + '>' + c.label + '</option>';
    });
    html += '</select>';
    html += '<input type="text" id="histFilterGarage" placeholder="Garage" value="' + escapeHtml(historyFilters.garage) + '">';
    html += '<input type="text" id="histFilterSearch" placeholder="🔍 Recherche (type, notes...)" value="' + escapeHtml(historyFilters.search) + '">';
    html += '<input type="date" id="histFilterDateFrom" title="Du" value="' + historyFilters.dateFrom + '">';
    html += '<input type="date" id="histFilterDateTo" title="Au" value="' + historyFilters.dateTo + '">';
    html += '<label class="hist-filter-check"><input type="checkbox" id="histFilterInvoice"' + (historyFilters.invoiceOnly ? ' checked' : '') + '> 📎 Avec facture</label>';
    if(hasActiveHistoryFilters()) html += '<button type="button" class="export-btn" id="histFilterReset">✕ Réinitialiser</button>';
    html += '</div>';
  }

  if(!entries.length){
    html += '<div class="empty-state">Aucune intervention enregistrée pour ce véhicule.</div>';
  } else {
    var sortedEntries = entries.slice().sort(function(a,b){
      if(a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.km || 0) - (a.km || 0);
    });

    var filteredEntries = sortedEntries.filter(function(entry){
      var typeObjF = state.types.filter(function(t){ return t.id === entry.typeId; })[0];
      var labelF = typeObjF ? typeObjF.label : entry.typeId;
      var categoryF = typeObjF ? (typeObjF.category || 'autre') : 'autre';
      return matchesHistoryFilters(entry, labelF, categoryF);
    });

    if(hasActiveHistoryFilters()){
      html = html.replace('Historique complet (' + entries.length + ')', 'Historique (' + filteredEntries.length + ' sur ' + entries.length + ')');
    }

    if(!filteredEntries.length){
      html += '<div class="empty-state">Aucune intervention ne correspond à ces filtres.</div>';
    }
    sortedEntries = filteredEntries;

    sortedEntries.forEach(function(entry){
      var typeObj = state.types.filter(function(t){ return t.id === entry.typeId; })[0];
      var label = typeObj ? typeObj.label : entry.typeId;
      var hasDocs = entry.documents && entry.documents.length > 0;

      html += '<div class="history-row" data-entry-id="' + entry.id + '">';
      html += '<div class="history-icon" style="color:' + (v.color || 'var(--yellow)') + ';">' + iconSvg();
      if(hasDocs) html += '<span class="doc-dot" title="Documents joints"></span>';
      html += '</div>';
      html += '<div class="history-main">';
      html += '<div class="history-type">' + escapeHtml(label) + '</div>';
      if(entry.notes) html += '<div class="history-notes">' + escapeHtml(entry.notes) + '</div>';
      if(entry.garage || entry.supplier){
        var gsParts = [];
        if(entry.garage) gsParts.push('🔧 ' + entry.garage);
        if(entry.supplier) gsParts.push('📦 ' + entry.supplier);
        html += '<div class="history-notes">' + escapeHtml(gsParts.join(' · ')) + '</div>';
      }
      if(entry.ct){
        var ctResultMap = { ok: ['✅ Favorable', 'ok'], remarks: ['✅ Favorable avec remarques', 'remarks'], ko_major: ['🟠 Défavorable (majeure)', 'ko-major'], ko_critical: ['🔴 Défavorable (critique)', 'ko-critical'] };
        var ctBadge = ctResultMap[entry.ct.result] || ctResultMap.ok;
        html += '<span class="ct-badge ' + ctBadge[1] + '">' + ctBadge[0] + '</span>';
        var defects = entry.ct.defects || [];
        if(defects.length){
          var resolvedCount = defects.filter(function(d){ return d.resolved; }).length;
          html += '<div class="ct-defects-summary">' + defects.length + ' défaut' + (defects.length > 1 ? 's' : '') + ' relevé' + (defects.length > 1 ? 's' : '') + ' (' + resolvedCount + ' levé' + (resolvedCount > 1 ? 's' : '') + ')</div>';
        }
        if((entry.ct.result === 'ko_major' || entry.ct.result === 'ko_critical') && entry.ct.counterVisit){
          var cv = entry.ct.counterVisit;
          if(cv.done){
            html += '<div class="ct-defects-summary">Contre-visite effectuée le ' + fmtDate(cv.date) + ' — ' + (cv.result === 'ok' ? '✅ Favorable' : '❌ Toujours défavorable') + '</div>';
          } else if(cv.deadline){
            html += '<div class="ct-defects-summary">⏳ Contre-visite à faire avant le ' + fmtDate(cv.deadline) + '</div>';
          }
        }
      }
      if(entry.invoiceDoc){
        html += '<div class="ct-defects-summary">📎 ' + escapeHtml(entry.invoiceDoc.name) + (entry.batchId ? ' (facture partagée)' : '') + '</div>';
      }
      if(entry.sessionId){
        html += '<button type="button" class="link-btn session-badge-link" data-session-id="' + entry.sessionId + '">📋 Issue d\'une fiche d\'entretien</button>';
      }
      html += '</div>';
      html += '<div class="history-meta">';
      if(entry.cost != null) html += '<div class="km">' + entry.cost.toLocaleString('fr-FR', {minimumFractionDigits:0, maximumFractionDigits:2}) + ' €</div>';
      if(!isTrailer(v)) html += '<div class="km">' + fmtKm(entry.km) + '</div>';
      html += '<div>' + fmtDate(entry.date) + '</div>';
      html += '</div>';
      html += '</div>';
    });
  }
  html += '</div>'; // fin #historyBody
  html += '</section>';

  content.innerHTML = html;

  // Binding des événements dynamiques de la vue
  var plateInput = document.getElementById('v-plate');
  if(plateInput){
    plateInput.onchange = async function(){
      v.plate = plateInput.value.trim();
      logEvent(activeVehicleId, 'Immatriculation mise à jour');
      await persist();
    };
  }

  var kmInput = document.getElementById('v-km');
  if(kmInput){
    kmInput.onchange = async function(){
      var val = parseInt(kmInput.value, 10);
      if(isNaN(val)){ kmInput.value = v.mileage || 0; return; }

      if(val < 0){
        await showAlert('Le kilométrage ne peut pas être négatif.');
        kmInput.value = v.mileage || 0;
        return;
      }

      if(val === v.mileage) return;

      // Cohérence : le kilométrage du véhicule ne devrait pas repasser sous une
      // intervention déjà enregistrée (l'odomètre n'avance normalement que vers l'avant).
      var maxEntryKm = getMaxEntryKm(activeVehicleId);
      if(maxEntryKm !== null && val < maxEntryKm){
        var ok = await showConfirm(
          'Ce kilométrage (' + fmtKm(val) + ') est inférieur à une intervention déjà enregistrée (' + fmtKm(maxEntryKm) + '). Continuer quand même ?',
          'Continuer'
        );
        if(!ok){ kmInput.value = v.mileage || 0; return; }
      }

      v.mileage = val;
      logEvent(activeVehicleId, 'Kilométrage mis à jour : ' + fmtKm(val));
      await persist();
      renderContent();
    };
  }

  var settingsBtn = document.getElementById('settingsBtn');
  if(settingsBtn) settingsBtn.onclick = openSettingsModal;

  var gaugesToggle = document.getElementById('gaugesToggle');
  if(gaugesToggle) gaugesToggle.onclick = function(){
    gaugesSectionCollapsed[activeVehicleId] = !gaugesSectionCollapsed[activeVehicleId];
    renderContent();
  };

  var costsToggle = document.getElementById('costsToggle');
  if(costsToggle) costsToggle.onclick = function(){
    costsSectionCollapsed[activeVehicleId] = !costsSectionCollapsed[activeVehicleId];
    renderContent();
  };

  var historyToggle = document.getElementById('historyToggle');
  if(historyToggle) historyToggle.onclick = function(){
    historySectionCollapsed[activeVehicleId] = !historySectionCollapsed[activeVehicleId];
    renderContent();
  };

  var costChartMinus = document.getElementById('costChartMinus');
  if(costChartMinus) costChartMinus.onclick = function(){
    costChartYears[activeVehicleId] = Math.max(2, (costChartYears[activeVehicleId] || 10) - 1);
    renderContent();
  };
  var costChartPlus = document.getElementById('costChartPlus');
  if(costChartPlus) costChartPlus.onclick = function(){
    costChartYears[activeVehicleId] = (costChartYears[activeVehicleId] || 10) + 1;
    renderContent();
  };

  Array.prototype.forEach.call(content.querySelectorAll('.cost-chart-bar-group'), function(g){
    g.addEventListener('click', function(){
      var year = g.getAttribute('data-year');
      historyFilters.category = 'all';
      historyFilters.garage = '';
      historyFilters.search = '';
      historyFilters.invoiceOnly = false;
      historyFilters.dateFrom = year + '-01-01';
      historyFilters.dateTo = year + '-12-31';
      historySectionCollapsed[activeVehicleId] = false;
      renderContent();
      var histSection = document.getElementById('historique-section');
      if(histSection) histSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  var printBtn = document.getElementById('printBtn');
  if(printBtn) printBtn.onclick = printVehicle;

  var exportCsvBtn = document.getElementById('exportCsvBtn');
  if(exportCsvBtn) exportCsvBtn.onclick = function(){ exportHistoryCSV(activeVehicleId); };

  var emailHistoryBtn = document.getElementById('emailHistoryBtn');
  if(emailHistoryBtn) emailHistoryBtn.onclick = function(){ openEmailExportModal(activeVehicleId); };

  var histFilterCategory = document.getElementById('histFilterCategory');
  if(histFilterCategory) histFilterCategory.onchange = function(){ historyFilters.category = histFilterCategory.value; rerenderPreservingFocus(); };

  var histFilterGarage = document.getElementById('histFilterGarage');
  if(histFilterGarage) histFilterGarage.oninput = debounce(function(){ historyFilters.garage = histFilterGarage.value; rerenderPreservingFocus(); }, 300);

  var histFilterSearch = document.getElementById('histFilterSearch');
  if(histFilterSearch) histFilterSearch.oninput = debounce(function(){ historyFilters.search = histFilterSearch.value; rerenderPreservingFocus(); }, 300);

  var histFilterDateFrom = document.getElementById('histFilterDateFrom');
  if(histFilterDateFrom) histFilterDateFrom.onchange = function(){ historyFilters.dateFrom = histFilterDateFrom.value; rerenderPreservingFocus(); };

  var histFilterDateTo = document.getElementById('histFilterDateTo');
  if(histFilterDateTo) histFilterDateTo.onchange = function(){ historyFilters.dateTo = histFilterDateTo.value; rerenderPreservingFocus(); };

  var histFilterInvoice = document.getElementById('histFilterInvoice');
  if(histFilterInvoice) histFilterInvoice.onchange = function(){ historyFilters.invoiceOnly = histFilterInvoice.checked; rerenderPreservingFocus(); };

  var histFilterReset = document.getElementById('histFilterReset');
  if(histFilterReset) histFilterReset.onclick = function(){
    historyFilters = { category: 'all', garage: '', search: '', invoiceOnly: false, dateFrom: '', dateTo: '' };
    renderContent();
  };

  var saleDossierBtn = document.getElementById('saleDossierBtn');
  if(saleDossierBtn) saleDossierBtn.onclick = function(){ openSaleDossierModal(activeVehicleId); };

  var maintenanceSheetBtn = document.getElementById('maintenanceSheetBtn');
  if(maintenanceSheetBtn) maintenanceSheetBtn.onclick = function(){ openMaintenanceSheetModal(activeVehicleId); };

  var openSessionsBtn = document.getElementById('openSessionsBtn');
  if(openSessionsBtn) openSessionsBtn.onclick = function(){ openSessionsListModal(activeVehicleId); };

  var addPlannedBtn = document.getElementById('addPlannedBtn');
  if(addPlannedBtn) addPlannedBtn.onclick = function(){ openAddPlannedInterventionModal(activeVehicleId); };

  Array.prototype.forEach.call(content.querySelectorAll('.planned-convert-btn'), function(btn){
    btn.onclick = function(){ startConvertPlannedIntervention(activeVehicleId, btn.getAttribute('data-planned-id')); };
  });

  Array.prototype.forEach.call(content.querySelectorAll('.planned-remove-btn'), function(btn){
    btn.onclick = async function(){
      var ok = await showConfirm('Retirer cette intervention à prévoir ? Elle ne sera pas historisée.', 'Retirer');
      if(!ok) return;
      await removePlannedIntervention(activeVehicleId, btn.getAttribute('data-planned-id'));
      renderContent();
    };
  });

  var addDocBtn = document.getElementById('addDocBtn');
  var docFileInput = document.getElementById('docFileInput');
  if(addDocBtn && docFileInput){
    addDocBtn.onclick = function(){ docFileInput.click(); };
    docFileInput.onchange = async function(e){
      var file = e.target.files[0];
      docFileInput.value = ''; // permet de re-sélectionner le même fichier plus tard
      if(!file) return;

      addDocBtn.disabled = true;
      addDocBtn.textContent = '…';
      try {
        if(!cloudReady || !currentUser){
          await showAlert('Impossible d\'ajouter un document : non connecté.');
          return;
        }

        var dataUrl = await prepareDocForStorage(file);
        if(!dataUrl) return; // message déjà affiché par prepareDocForStorage

        if(!v.documents) v.documents = [];
        var storedType = (file.type && file.type.indexOf('image/') === 0) ? 'image/jpeg' : file.type;

        // Le fichier part dans le bucket privé ; seule la référence (chemin) est
        // gardée dans state, ça évite d'alourdir le JSON synchronisé.
        var path = await uploadDocToStorage(dataUrl, storedType, file.name, activeVehicleId);
        v.documents.push({ name: file.name, type: storedType, path: path });

        logEvent(activeVehicleId, 'Document ajouté : ' + file.name);
        await persist();
        renderContent();
      } catch(err) {
        console.error(err);
        await showAlert('Impossible d\'ajouter ce document.');
      } finally {
        addDocBtn.disabled = false;
        addDocBtn.textContent = '+';
      }
    };
  }

  Array.prototype.forEach.call(content.querySelectorAll('.doc-thumb'), function(el){
    el.onclick = function(){
      var idx = parseInt(el.getAttribute('data-doc-idx'), 10);
      var doc = v.documents && v.documents[idx];
      if(!doc) return;
      if(doc.path) openStorageDoc(doc.path);
      else if(doc.data) window.open(doc.data, '_blank');
    };
  });

  Array.prototype.forEach.call(content.querySelectorAll('.doc-remove'), function(btn){
    btn.onclick = async function(e){
      e.stopPropagation();
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      if(!isNaN(idx) && v.documents && v.documents[idx]){
        var removed = v.documents.splice(idx, 1)[0];
        if(removed.path) await deleteDocFromStorage(removed.path);
        logEvent(activeVehicleId, 'Document supprimé : ' + removed.name);
        await persist();
        renderContent();
      }
    };
  });

  // Charge les vraies vignettes d'images en arrière-plan (URLs signées groupées),
  // sans bloquer l'affichage initial (qui montre 🖼 en attendant).
  loadDocThumbnails(v, content);

  Array.prototype.forEach.call(content.querySelectorAll('.history-row'), function(row){
    row.onclick = function(){
      var entryId = row.getAttribute('data-entry-id');
      openEntryModal(entryId);
    };
  });

  Array.prototype.forEach.call(content.querySelectorAll('.session-badge-link'), function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      openSessionDetailModal(activeVehicleId, btn.getAttribute('data-session-id'));
    };
  });
}
