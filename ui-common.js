// ---- Confirmation stylée (remplace window.confirm) ----
function showConfirm(message, okLabel){
  return new Promise(function(resolve){
    var overlay = document.getElementById('confirmOverlay');
    var msgEl = document.getElementById('confirmMsg');
    var okBtn = document.getElementById('confirmOkBtn');
    var cancelBtn = document.getElementById('confirmCancelBtn');
    if(!overlay || !msgEl || !okBtn || !cancelBtn){ resolve(window.confirm(message)); return; }

    msgEl.textContent = message;
    okBtn.textContent = okLabel || 'Confirmer';
    overlay.classList.add('open');

    function cleanup(result){
      overlay.classList.remove('open');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(result);
    }
    okBtn.onclick = function(){ cleanup(true); };
    cancelBtn.onclick = function(){ cleanup(false); };
  });
}

// ---- Alerte stylée (remplace window.alert) — réutilise la modale de confirmation
// avec le bouton "Annuler" masqué et un seul bouton "OK". ----
function showAlert(message){
  return new Promise(function(resolve){
    var overlay = document.getElementById('confirmOverlay');
    var msgEl = document.getElementById('confirmMsg');
    var okBtn = document.getElementById('confirmOkBtn');
    var cancelBtn = document.getElementById('confirmCancelBtn');
    if(!overlay || !msgEl || !okBtn || !cancelBtn){ window.alert(message); resolve(); return; }

    msgEl.textContent = message;
    okBtn.textContent = 'OK';
    okBtn.className = 'btn btn-primary';
    okBtn.style.flex = '1';
    cancelBtn.style.display = 'none';
    overlay.classList.add('open');

    function cleanup(){
      overlay.classList.remove('open');
      okBtn.onclick = null;
      okBtn.className = 'btn btn-danger';
      cancelBtn.style.display = '';
      resolve();
    }
    okBtn.onclick = cleanup;
  });
}

function escapeHtml(str){
  if(!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function slugify(str){
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'custom-'+Date.now();
}

// ---- Gestion des fichiers joints (documents) ----
// Les documents partent dans le bucket Supabase Storage (pas dans le JSON de state),
// donc ces limites servent juste à garder des tailles raisonnables à l'upload/l'affichage.
var MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;  // cible après compression (qualité d'aperçu suffisante)
var MAX_DOC_BYTES = 10 * 1024 * 1024;     // 10 Mo pour les PDF (ex : carnet d'entretien scanné multi-pages)

// Redimensionne et compresse une image côté client (limite la taille du base64 stocké)
function compressImage(file, maxDim, quality){
  return new Promise(function(resolve, reject){
    var img = new Image();
    var reader = new FileReader();
    reader.onload = function(evt){
      img.onload = function(){
        var w = img.width, h = img.height;
        if(w > maxDim || h > maxDim){
          if(w > h){ h = Math.round(h * (maxDim / w)); w = maxDim; }
          else { w = Math.round(w * (maxDim / h)); h = maxDim; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality || 0.75));
      };
      img.onerror = function(){ reject(new Error('Image illisible')); };
      img.src = evt.target.result;
    };
    reader.onerror = function(){ reject(new Error('Lecture du fichier impossible')); };
    reader.readAsDataURL(file);
  });
}

function readFileAsDataUrl(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(evt){ resolve(evt.target.result); };
    reader.onerror = function(){ reject(new Error('Lecture du fichier impossible')); };
    reader.readAsDataURL(file);
  });
}

// Retourne une dataURL prête à stocker, en compressant les images trop lourdes.
// Rejette (via alert) les fichiers non-image trop volumineux.
async function prepareDocForStorage(file){
  var isImage = file.type && file.type.indexOf('image/') === 0;

  if(isImage){
    // Compression systématique pour les images : limite la dimension et la taille finale
    var dataUrl = await compressImage(file, 1600, 0.75);
    if(dataUrl.length > MAX_IMAGE_BYTES){
      dataUrl = await compressImage(file, 1000, 0.6);
    }
    if(dataUrl.length > MAX_IMAGE_BYTES){
      await showAlert('Cette image reste trop volumineuse même après compression. Merci d\'en choisir une autre.');
      return null;
    }
    return dataUrl;
  }

  // Non-image (ex : PDF) : pas de compression possible, on applique juste une limite de taille
  if(file.size > MAX_DOC_BYTES){
    await showAlert('Ce fichier dépasse la taille maximale autorisée (' + Math.round(MAX_DOC_BYTES/1024/1024*10)/10 + ' Mo). Merci de choisir un fichier plus léger.');
    return null;
  }
  return readFileAsDataUrl(file);
}

// ---- Upload/suppression vers Supabase Storage (bucket privé "vehicle-documents") ----
var DOCS_BUCKET = 'vehicle-documents';

function dataUrlToBlob(dataUrl){
  var parts = dataUrl.split(',');
  var mimeMatch = parts[0].match(/:(.*?);/);
  var mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  var binary = atob(parts[1]);
  var arr = new Uint8Array(binary.length);
  for(var i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Upload un document dans le bucket privé, sous un chemin propre à l'utilisateur
// (userId/vehicleId/...) pour que les policies RLS puissent restreindre l'accès.
async function uploadDocToStorage(dataUrl, mime, originalName, vehicleId){
  var blob = dataUrlToBlob(dataUrl);
  var ext = (originalName.split('.').pop() || 'bin').toLowerCase();
  var path = currentUser.id + '/' + vehicleId + '/' + genId('doc') + '.' + ext;
  var res = await sb.storage.from(DOCS_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if(res.error) throw res.error;
  return path;
}

// Upload d'une facture liée à une (ou plusieurs, si facture partagée) intervention(s).
// keyId identifie la facture (id de l'intervention seule, ou id de lot pour une saisie
// multi-types) — permet de retrouver/supprimer le bon fichier sans ambiguïté.
async function uploadEntryInvoice(dataUrl, mime, originalName, vehicleId, keyId){
  var blob = dataUrlToBlob(dataUrl);
  var ext = (originalName.split('.').pop() || 'bin').toLowerCase();
  var path = currentUser.id + '/' + vehicleId + '/invoices/' + keyId + '.' + ext;
  var res = await sb.storage.from(DOCS_BUCKET).upload(path, blob, { contentType: mime, upsert: true });
  if(res.error) throw res.error;
  return path;
}

async function deleteDocFromStorage(path){
  if(!path) return;
  try { await sb.storage.from(DOCS_BUCKET).remove([path]); }
  catch(e){ console.error('Erreur suppression document cloud:', e); }
}

// Génère une URL signée temporaire (1h) pour visualiser un document privé.
async function openStorageDoc(path){
  try {
    var res = await sb.storage.from(DOCS_BUCKET).createSignedUrl(path, 3600);
    if(res.error || !res.data) throw res.error || new Error('URL non générée');
    window.open(res.data.signedUrl, '_blank');
  } catch(e){
    console.error(e);
    await showAlert('Impossible d\'ouvrir ce document pour le moment.');
  }
}

// ---- Cache des URLs signées pour les vignettes d'images ----
// Évite de régénérer une URL signée à chaque re-render (ex: écho du realtime).
var thumbUrlCache = {}; // path -> { url, expiresAt }
var THUMB_URL_TTL_MS = 5 * 60 * 1000; // 5 minutes, cohérent avec la durée demandée à Supabase

// Récupère (en un seul appel groupé) les URLs signées des vignettes d'images
// manquantes ou expirées, puis met à jour les <div class="doc-thumb"> concernés
// dans le DOM sans redessiner toute la vue.
async function loadDocThumbnails(vehicle, containerEl){
  if(!cloudReady || !currentUser || !vehicle || !vehicle.documents) return;

  var now = Date.now();
  var toFetch = [];
  vehicle.documents.forEach(function(doc){
    if(!doc.path) return;
    if(!(doc.type && doc.type.indexOf('image/') === 0)) return;
    var cached = thumbUrlCache[doc.path];
    if(!cached || cached.expiresAt < now) toFetch.push(doc.path);
  });
  if(!toFetch.length){
    applyCachedThumbnails(vehicle, containerEl);
    return;
  }

  try {
    var res = await sb.storage.from(DOCS_BUCKET).createSignedUrls(toFetch, 300);
    if(res.error || !res.data) throw res.error || new Error('URLs non générées');
    res.data.forEach(function(item){
      if(item.signedUrl && !item.error){
        thumbUrlCache[item.path] = { url: item.signedUrl, expiresAt: now + THUMB_URL_TTL_MS };
      }
    });
  } catch(e){
    console.error('Erreur génération vignettes:', e);
  }

  applyCachedThumbnails(vehicle, containerEl);
}

function applyCachedThumbnails(vehicle, containerEl){
  vehicle.documents.forEach(function(doc, idx){
    if(!doc.path) return;
    if(!(doc.type && doc.type.indexOf('image/') === 0)) return;
    var cached = thumbUrlCache[doc.path];
    if(!cached) return;
    var el = containerEl.querySelector('.doc-thumb[data-doc-idx="' + idx + '"]');
    if(el && !el.querySelector('img')){
      el.innerHTML = '<img src="' + cached.url + '" alt="' + escapeHtml(doc.name) + '">';
    }
  });
}

function genId(prefix){
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function debounce(fn, delay){
  var timer = null;
  return function(){
    var args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function(){ fn.apply(null, args); }, delay);
  };
}

// renderContent() reconstruit tout le DOM à chaque appel — sans ça, taper dans un
// champ de filtre ferait perdre le focus à chaque caractère. On mémorise l'élément
// actif et la position du curseur, puis on les restaure après le nouveau rendu.
function rerenderPreservingFocus(){
  var active = document.activeElement;
  var activeId = active && active.id;
  var selStart = (active && typeof active.selectionStart === 'number') ? active.selectionStart : null;
  var selEnd = (active && typeof active.selectionEnd === 'number') ? active.selectionEnd : null;

  renderContent();

  if(activeId){
    var el = document.getElementById(activeId);
    if(el){
      el.focus();
      if(selStart !== null && el.setSelectionRange){
        try { el.setSelectionRange(selStart, selEnd); } catch(e){}
      }
    }
  }
}

function fmtKm(km){
  if(km == null || isNaN(km)) return '—';
  return km.toLocaleString('fr-FR') + ' km';
}

function fmtEuro(n){
  if(n == null || isNaN(n)) return '—';
  return n.toLocaleString('fr-FR', {minimumFractionDigits:0, maximumFractionDigits:2}) + ' €';
}

// Calcule les statistiques de coûts d'un véhicule à partir de ses interventions,
// en ne comptant qu'une seule fois les factures partagées entre plusieurs lignes (batchId).
function computeCostStats(entries){
  var seenBatch = {};
  var uniqueCosts = []; // { cost, date, km }

  entries.forEach(function(e){
    if(e.cost == null) return;
    if(e.batchId){
      if(seenBatch[e.batchId]) return; // déjà compté via une autre ligne du même lot
      seenBatch[e.batchId] = true;
    }
    uniqueCosts.push({ cost: e.cost, date: e.date, km: e.km });
  });

  var total = uniqueCosts.reduce(function(sum, c){ return sum + c.cost; }, 0);
  var hasAny = uniqueCosts.length > 0;

  var perKm = null;
  if(hasAny){
    var kms = uniqueCosts.map(function(c){ return c.km; }).filter(function(k){ return k != null; });
    if(kms.length >= 2){
      var span = Math.max.apply(null, kms) - Math.min.apply(null, kms);
      if(span > 0) perKm = total / span;
    }
  }

  var thisYear = new Date().getFullYear();
  var byYearMap = {};
  uniqueCosts.forEach(function(c){
    var y = c.date ? new Date(c.date).getFullYear() : thisYear;
    byYearMap[y] = (byYearMap[y] || 0) + c.cost;
  });
  var byYear = Object.keys(byYearMap).sort(function(a,b){ return b - a; }).map(function(y){
    return { year: y, total: byYearMap[y] };
  });
  var currentYear = byYearMap[thisYear] != null ? byYearMap[thisYear] : null;

  return { hasAny: hasAny, total: total, perKm: perKm, currentYear: currentYear, byYear: byYear };
}

function median(nums){
  if(!nums.length) return null;
  var sorted = nums.slice().sort(function(a, b){ return a - b; });
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Construit un graphique en barres SVG "maison" (pas de librairie externe) montrant
// le coût par année sur les N années les plus récentes choisies, avec une ligne de
// moyenne. accentColor : couleur du véhicule (cohérence visuelle avec le reste).
function renderCostChart(byYearAll, yearsCount, accentColor){
  // byYearAll est trié du plus récent au plus ancien (cf computeCostStats) : on
  // prend les N premiers puis on repasse en ordre chronologique pour l'affichage.
  var slice = byYearAll.slice(0, yearsCount).slice().reverse();
  if(!slice.length) return { svg: '', avg: null, med: null };

  var totals = slice.map(function(d){ return d.total; });
  var avg = totals.reduce(function(s, t){ return s + t; }, 0) / totals.length;
  var med = median(totals);
  var maxVal = Math.max.apply(null, totals.concat([1]));

  var w = 640, h = 210;
  var pad = { top: 22, right: 14, bottom: 30, left: 14 };
  var chartW = w - pad.left - pad.right;
  var chartH = h - pad.top - pad.bottom;
  var gap = 12;
  var barW = Math.max(14, (chartW - gap * (slice.length - 1)) / slice.length);
  var totalBarsW = slice.length * barW + (slice.length - 1) * gap;
  var startX = pad.left + Math.max(0, (chartW - totalBarsW) / 2);

  var avgY = pad.top + chartH - (avg / maxVal) * chartH;

  var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" class="cost-chart-svg" preserveAspectRatio="xMidYMid meet">';
  svg += '<line x1="' + pad.left + '" y1="' + avgY.toFixed(1) + '" x2="' + (w - pad.right) + '" y2="' + avgY.toFixed(1) + '" style="stroke:var(--text-muted); stroke-width:1; stroke-dasharray:4,4;" />';
  svg += '<text x="' + (w - pad.right) + '" y="' + (avgY - 6).toFixed(1) + '" text-anchor="end" style="font-size:10px; fill:var(--text-muted); font-family:\'JetBrains Mono\',monospace;">moy. ' + Math.round(avg) + ' €</text>';

  slice.forEach(function(d, i){
    var barH = maxVal > 0 ? (d.total / maxVal) * chartH : 0;
    var x = startX + i * (barW + gap);
    var y = pad.top + chartH - barH;
    svg += '<g class="cost-chart-bar-group" data-year="' + d.year + '" style="cursor:pointer;">';
    svg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(1, barH).toFixed(1) + '" rx="4" style="fill:' + accentColor + ';" />';
    svg += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + Math.max(pad.top - 6, y - 6).toFixed(1) + '" text-anchor="middle" style="font-size:10.5px; fill:var(--text); font-family:\'JetBrains Mono\',monospace;">' + Math.round(d.total) + '€</text>';
    svg += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (h - pad.bottom + 16).toFixed(1) + '" text-anchor="middle" style="font-size:11px; fill:var(--text-muted); font-family:\'Oswald\',sans-serif;">' + d.year + '</text>';
    svg += '</g>';
  });

  svg += '</svg>';
  return { svg: svg, avg: avg, med: med };
}

function fmtDate(dStr){
  if(!dStr) return '—';
  var parts = dStr.split('-');
  if(parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
  return dStr;
}

function fmtDateTime(ts){
  if(!ts) return '—';
  var d = new Date(ts);
  if(isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
}

