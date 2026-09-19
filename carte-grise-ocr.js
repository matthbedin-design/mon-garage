// ---- Scan OCR de la carte grise (certificat d'immatriculation) ----
//
// Fonctionne entièrement dans le navigateur via Tesseract.js : la photo
// n'est JAMAIS envoyée à un service tiers pour la reconnaissance de texte
// (contrairement à un OCR "cloud" type Google Vision/AWS Textract). Seul le
// moteur Tesseract lui-même (~10-15 Mo la première fois) est téléchargé
// depuis un CDN au premier scan.
//
// La carte grise française a un format standardisé par zones lettrées
// (D.1 = marque, D.3 = modèle, E = VIN, B = date de 1ère immatriculation,
// P.3 = énergie...), identique sur tous les documents — on s'appuie
// dessus pour retrouver les valeurs plutôt que de deviner à l'aveugle.
//
// Volontairement IGNORÉ : les zones d'identité du titulaire (C.1 nom,
// C.3 adresse) — on n'extrait que les informations techniques du véhicule,
// jamais les données personnelles du propriétaire, même si l'OCR les capte.
//
// L'extraction reste heuristique (regex sur du texte OCR, jamais garanti
// sans erreur) : chaque champ est présenté pré-rempli mais MODIFIABLE dans
// la modale de confirmation, jamais appliqué sans validation explicite.

var carteGriseOcrWorker = null;

async function getCarteGriseOcrWorker(){
  if(carteGriseOcrWorker) return carteGriseOcrWorker;
  carteGriseOcrWorker = await Tesseract.createWorker('fra');
  return carteGriseOcrWorker;
}

// Recherche un motif VIN valide (17 caractères, sans I/O/Q comme l'exige la
// norme ISO 3779) n'importe où dans le texte — plus fiable en pratique que
// de chercher le libellé "E" qui est souvent mal reconnu par l'OCR.
function extractVin(text){
  var match = text.match(/[A-HJ-NPR-Z0-9]{17}/);
  return match ? match[0] : null;
}

// Cherche la valeur associée à un code de zone (ex: "D.1") : sur la même
// ligne après le code, ou sur la ligne suivante si la ligne du code est
// vide après le code lui-même (mise en page carte grise très variable).
function extractZoneValue(lines, codeRegex){
  for(var i = 0; i < lines.length; i++){
    var m = lines[i].match(codeRegex);
    if(!m) continue;
    var rest = lines[i].slice(m.index + m[0].length).trim().replace(/^[):.\-]+/, '').trim();
    if(rest) return rest;
    if(lines[i+1] && lines[i+1].trim()) return lines[i+1].trim();
  }
  return null;
}

function extractDate(text){
  var m = text.match(/\b(\d{2})[\/\.\-](\d{2})[\/\.\-](\d{4})\b/);
  if(!m) return null;
  return { day: m[1], month: m[2], year: m[3], iso: m[3] + '-' + m[2] + '-' + m[1] };
}

// Priorité à la date trouvée près du repère de zone B (première
// immatriculation) plutôt que "la première date rencontrée n'importe où
// dans le document" — un certificat contient souvent plusieurs dates
// (émission du document, etc.), la précédente approche pouvait en attraper
// une autre que celle voulue.
function extractFirstRegDate(text, lines){
  var nearB = extractZoneValue(lines, /^B\b/);
  var fromZone = nearB ? extractDate(nearB) : null;
  return fromZone || extractDate(text);
}

function mapFuelLabel(raw){
  if(!raw) return null;
  var s = raw.toUpperCase();
  if(s.indexOf('ELEC') !== -1) return 'Électrique';
  if(s.indexOf('HYBRID') !== -1) return 'Hybride';
  if(s.indexOf('GAZOLE') !== -1 || s.indexOf('DIESEL') !== -1 || s.indexOf('GO') === 0) return 'Diesel';
  if(s.indexOf('ESSENCE') !== -1 || s.indexOf('EE') === 0) return 'Essence';
  if(s.indexOf('GPL') !== -1) return 'GPL';
  return null; // pas de correspondance fiable plutôt que de deviner
}

// Extraction heuristique — ne renvoie que ce qui a été trouvé avec une
// confiance raisonnable ; laisse le reste à null plutôt que d'inventer.
function extractCarteGriseFields(ocrText){
  var lines = ocrText.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);

  var brand = extractZoneValue(lines, /^D\.?\s?1\b/i);
  var model = extractZoneValue(lines, /^D\.?\s?3\b/i);
  var fuelRaw = extractZoneValue(lines, /^P\.?\s?3\b/i);
  var vin = extractVin(ocrText) || extractZoneValue(lines, /^E\b/);
  var dateB = extractFirstRegDate(ocrText, lines);

  return {
    brand: brand ? brand.replace(/[^A-ZÀ-Ÿa-zà-ÿ0-9 \-]/g, '').trim() : null,
    model: model ? model.replace(/[^A-ZÀ-Ÿa-zà-ÿ0-9 \-]/g, '').trim() : null,
    vin: vin ? vin.toUpperCase() : null,
    fuel: mapFuelLabel(fuelRaw),
    year: dateB ? dateB.year : null,
    firstRegDate: dateB ? dateB.iso : null
  };
}

// ---- Modale : scan + confirmation ----
// options.vehicleId : id du véhicule existant (réglages) ou null (création,
// pas encore d'id tant que le véhicule n'est pas créé).
// options.onApply(fields, keepPhotoFile) : appelé une fois l'utilisateur a
// validé les champs (édités ou non) — à l'appelant d'écrire les valeurs à
// l'endroit qui lui correspond (formulaire de création ou de réglages).
function openCarteGriseScanModal(options){
  var modal = document.getElementById('modal');
  var currentFile = null;
  var extracted = null;

  modal.innerHTML =
    '<h3>Scanner la carte grise <button class="icon-btn" id="closeModalBtn" aria-label="Fermer">\u2715</button></h3>' +
    '<div class="field-hint" style="margin-bottom:12px;">Analyse faite entièrement sur cet appareil — la photo n\'est envoyée à aucun service extérieur. Les informations d\'identité (nom, adresse) sont volontairement ignorées.</div>' +
    '<div class="field"><label>Photo ou scan de la carte grise</label><input type="file" id="cgFileInput" accept="image/*" capture="environment"></div>' +
    '<div id="cgStatus" style="font-size:12.5px; margin:8px 0; min-height:18px;"></div>' +
    '<div id="cgPreviewFields" style="display:none;">' +
      '<div class="row2">' +
        '<div class="field"><label>Marque</label><input type="text" id="cg-brand"></div>' +
        '<div class="field"><label>Modèle</label><input type="text" id="cg-model"></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Année</label><input type="number" id="cg-year"></div>' +
        '<div class="field"><label>Carburant</label><select id="cg-fuel">' +
          '<option value="">—</option>' +
          ['Essence','Diesel','Hybride','Électrique','GPL','Autre'].map(function(f){ return '<option value="' + f + '">' + f + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="field"><label>VIN (numéro de châssis)</label><input type="text" id="cg-vin" placeholder="17 caractères"></div>' +
      '<div class="field"><label>Date de mise en circulation</label><input type="date" id="cg-firstreg"></div>' +
      '<label style="display:flex; align-items:center; gap:8px; margin-top:8px;">' +
        '<input type="checkbox" id="cg-keepphoto">' +
        '<span style="font-size:13px;">Conserver cette photo comme document du véhicule (contient ton nom et ton adresse)</span>' +
      '</label>' +
    '</div>' +
    '<div class="modal-actions" style="margin-top:16px;">' +
      '<button class="btn btn-ghost" id="cancelBtn">Annuler</button>' +
      '<button class="btn btn-primary" id="cgApplyBtn" style="display:none;">Utiliser ces informations</button>' +
    '</div>';

  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('closeModalBtn').onclick = closeModal;
  document.getElementById('cancelBtn').onclick = closeModal;

  document.getElementById('cgFileInput').onchange = async function(e){
    var file = e.target.files[0];
    if(!file) return;
    currentFile = file;
    var statusEl = document.getElementById('cgStatus');
    statusEl.style.color = 'var(--yellow)';
    statusEl.textContent = 'Préparation de la reconnaissance de texte (peut être long au premier scan)...';

    try {
      var dataUrl = await readFileAsDataUrl(file);
      var worker = await getCarteGriseOcrWorker();
      statusEl.textContent = 'Analyse de la photo en cours...';
      var result = await worker.recognize(dataUrl);

      extracted = extractCarteGriseFields(result.data.text);

      document.getElementById('cg-brand').value = extracted.brand || '';
      document.getElementById('cg-model').value = extracted.model || '';
      document.getElementById('cg-year').value = extracted.year || '';
      document.getElementById('cg-fuel').value = extracted.fuel || '';
      document.getElementById('cg-vin').value = extracted.vin || '';
      document.getElementById('cg-firstreg').value = extracted.firstRegDate || '';

      document.getElementById('cgPreviewFields').style.display = 'block';
      document.getElementById('cgApplyBtn').style.display = 'inline-block';

      var foundCount = ['brand','model','year','fuel','vin','firstRegDate'].filter(function(k){ return extracted[k]; }).length;
      statusEl.style.color = foundCount ? 'var(--green)' : 'var(--yellow)';
      statusEl.textContent = foundCount
        ? '✓ ' + foundCount + ' champ(s) reconnu(s) — vérifie et corrige si besoin avant de valider.'
        : 'Aucun champ reconnu avec certitude — remplis manuellement ou réessaie avec une photo plus nette.';
    } catch(err){
      console.error('Erreur OCR carte grise:', err);
      statusEl.style.color = 'var(--red)';
      statusEl.textContent = 'Échec de l\'analyse. Réessaie avec une photo bien éclairée et cadrée.';
    }
  };

  document.getElementById('cgApplyBtn').onclick = function(){
    var fields = {
      brand: document.getElementById('cg-brand').value.trim() || null,
      model: document.getElementById('cg-model').value.trim() || null,
      year: document.getElementById('cg-year').value.trim() || null,
      fuel: document.getElementById('cg-fuel').value || null,
      vin: document.getElementById('cg-vin').value.trim() || null,
      firstRegDate: document.getElementById('cg-firstreg').value || null
    };
    var keepPhoto = document.getElementById('cg-keepphoto').checked;
    closeModal();
    if(options.onApply) options.onApply(fields, keepPhoto ? currentFile : null);
  };
}
