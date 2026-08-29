// Remplacez ces deux valeurs par celles de votre projet Supabase (Project Settings > API).
// SUPABASE_KEY doit être la clé "anon public", jamais la clé "service_role".
// IMPORTANT : sans règles RLS (Row Level Security) sur la table `user_data`, n'importe
// quel détenteur de la clé anon peut lire/écrire les données de tous les utilisateurs.
// Activez RLS puis ajoutez une policy du type :
//   create policy "user_data_owner" on user_data
//   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
var SUPABASE_URL = "https://fobqmyntdlhcepszkwuw.supabase.co";
var SUPABASE_KEY = "sb_publishable_sJ03uwVNlmaB1D-L9Z-sPQ_blLApFkM";

var PALETTE = ['#F0B429', '#E12D39', '#2EC4B6', '#3A86FF', '#8338EC', '#FF006E', '#00F5D4', '#FF9F1C'];

var DEFAULT_TYPES = [
  { id: 'vidange', label: 'Vidange moteur', km: 15000, months: 12, category: 'entretien' },
  { id: 'filtre-huile', label: 'Filtre à huile', km: 15000, months: 12, category: 'entretien' },
  { id: 'filtre-air', label: 'Filtre à air', km: 30000, months: 24, category: 'entretien' },
  { id: 'filtre-habitacle', label: 'Filtre habitacle', km: 15000, months: 12, category: 'entretien' },
  { id: 'distribution', label: 'Courroie de distribution', km: 100000, months: 60, category: 'entretien' },
  { id: 'freins-avant', label: 'Plaquettes / Disques AV', km: 40000, months: null, category: 'freinage' },
  { id: 'ct', label: 'Contrôle Technique', km: null, months: 24, category: 'ct' }
];

var HISTORY_CATEGORIES = [
  { id: 'entretien', label: 'Entretien' },
  { id: 'pneus', label: 'Pneus' },
  { id: 'freinage', label: 'Freinage' },
  { id: 'ct', label: 'CT' },
  { id: 'reparation', label: 'Réparation' },
  { id: 'autre', label: 'Autre' }
];

var DEFAULT_CHECKLIST_ITEMS = [
  { id: 'chk_essuie_glaces', label: 'État et fonctionnement des balais d\'essuie-glace', theme: 'Visibilité' },
  { id: 'chk_feux', label: 'Fonctionnement des feux (avant, arrière, stop, clignotants)', theme: 'Visibilité' },
  { id: 'chk_plaquettes_av', label: 'État des plaquettes AV', theme: 'Freinage' },
  { id: 'chk_plaquettes_ar', label: 'État des plaquettes AR', theme: 'Freinage' },
  { id: 'chk_disques', label: 'État des disques de frein', theme: 'Freinage' },
  { id: 'chk_liquide_refroidissement', label: 'Liquide de refroidissement (niveau, couleur, pH)', theme: 'Niveaux et étanchéité' },
  { id: 'chk_liquide_frein', label: 'Liquide de frein (niveau)', theme: 'Niveaux et étanchéité' },
  { id: 'chk_lave_glace', label: 'Lave-glace (niveau)', theme: 'Niveaux et étanchéité' },
  { id: 'chk_huile', label: 'Niveau d\'huile moteur', theme: 'Niveaux et étanchéité' },
  { id: 'chk_pneus', label: 'Pression et état des pneus (usure, hernies)', theme: 'Pneumatiques' },
  { id: 'chk_batterie', label: 'État de la batterie et des bornes', theme: 'Électrique' },
  { id: 'chk_courroies', label: 'État visuel des courroies', theme: 'Moteur' }
];

var sb = null;
var cloudReady = false;
var currentUser = null;
var realtimeChannel = null;
var isWriting = false; // true pendant/juste après une écriture locale, pour ignorer l'écho realtime correspondant
var lastKnownUpdatedAt = null; // updated_at de la dernière version connue côté serveur (jeton de concurrence optimiste)

var state = {
  vehicles: {},
  entries: {},
  order: [],
  types: DEFAULT_TYPES.slice(),
  journal: []
};

var activeVehicleId = null;
var DASHBOARD_ID = '__dashboard__';
var editingEntryId = null;

// Filtres de l'historique (état d'affichage uniquement, non persisté) — réinitialisés
// automatiquement au changement de véhicule.
var historyFilters = { category: 'all', garage: '', search: '', invoiceOnly: false, dateFrom: '', dateTo: '' };
var historyFiltersVehicleId = null;
var gaugesSectionCollapsed = {}; // { vehicleId: true/false } — état repliable, en mémoire seulement
var costChartYears = {}; // { vehicleId: nombre d'années affichées dans le graphique } — défaut 10
var costsSectionCollapsed = {};   // { vehicleId: true/false } — section "Coûts d'entretien"
var historySectionCollapsed = {}; // { vehicleId: true/false } — section "Historique complet"

function matchesHistoryFilters(entry, typeLabel, category){
  if(historyFilters.category !== 'all' && category !== historyFilters.category) return false;
  if(historyFilters.invoiceOnly && !entry.invoiceDoc) return false;
  if(historyFilters.dateFrom && entry.date < historyFilters.dateFrom) return false;
  if(historyFilters.dateTo && entry.date > historyFilters.dateTo) return false;
  if(historyFilters.garage){
    var g = (entry.garage || '').toLowerCase();
    if(g.indexOf(historyFilters.garage.toLowerCase()) === -1) return false;
  }
  if(historyFilters.search){
    var s = historyFilters.search.toLowerCase();
    var haystack = (typeLabel + ' ' + (entry.notes || '') + ' ' + (entry.garage || '') + ' ' + (entry.supplier || '')).toLowerCase();
    if(haystack.indexOf(s) === -1) return false;
  }
  return true;
}

function hasActiveHistoryFilters(){
  return historyFilters.category !== 'all' || historyFilters.garage || historyFilters.search ||
    historyFilters.invoiceOnly || historyFilters.dateFrom || historyFilters.dateTo;
}

function initCloud(){
  if(window.supabase && SUPABASE_URL.indexOf('VOTRE_SUPABASE') === -1){
    try {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      cloudReady = true;
    } catch(e) {
      console.error("Erreur d'initialisation Supabase", e);
    }
  }
}

