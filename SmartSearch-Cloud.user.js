// ==UserScript==
// @name        SmartSearch-Cloud
// @description Search equipment on e-hentai trade forums (Cloud DB Sync Edition)
// @namespace   SmartSearch-Cloud
// @author      Superlatanium, nekolor, ericeric91, claude
// @include     https://forums.e-hentai.org/index.php*showforum=*
// @version     3.4.0
// @grant       GM_registerMenuCommand
// @grant       GM_xmlhttpRequest
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       unsafeWindow
// @connect     github.com
// @connect     objects.githubusercontent.com
// @connect     release-assets.githubusercontent.com
// @connect     raw.githubusercontent.com
// @updateURL   https://raw.githubusercontent.com/ericericsw/eric-s-SmartSearch/main/SmartSearch-Cloud.user.js
// @downloadURL https://raw.githubusercontent.com/ericericsw/eric-s-SmartSearch/main/SmartSearch-Cloud.user.js
// ==/UserScript==

// Shown in the Settings panel title: read from the header's @version so the two never drift apart (SMS-USR-085)
var version = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || '3.4.0';

// Board 78 (WTB) is not supported for now: its posts only describe wanted equipment in free text (SMS-USR-080)
const FORUM_LABELS = {
  '77': 'WTS',
  '90': 'ISK'
};

const DEFAULT_SETTINGS = {
  githubRepo: 'ericericsw/eric-s-SmartSearch',
  customBaseUrl: '',
  syncMode: 'full', // 'full' (完全重建) or 'incremental' (增量合併)
  excludePinned: true,
  excludedUsers: [],
  showStrikeouts: false,
  daysAgoLimit: 60,
  wildGuess: false,
  hideLocked: false,
  language: 'en', // Settings panel language: 'en' (default) or 'zh' adds the Chinese notes (SMS-USR-087)
  forumVersions: { '77': '', '90': '' }
};

// Settings panel languages (SMS-USR-087). English is the default; Chinese only adds notes after the English labels.
var UI_LANGUAGES = [['en', 'English'], ['zh', '中文']];

function uiLanguage(cfg) {
  return cfg && cfg.language === 'zh' ? 'zh' : 'en';
}

// ' (<Chinese note>)' in the Chinese language, nothing in English
function zhNote(lang, text) {
  return lang === 'zh' ? ' (' + escapeHtml(text) + ')' : '';
}

// SmartSearch-Cloud keeps its own storage and never reads the original HV SmartSearch's or 2.x's (SMS-USR-078)
var SETTINGS_KEY = 'SmartSearchCloudSettings';
var RECENT_KEY = 'SmartSearchCloud';

function loadSettings() {
  var raw = null;
  try {
    if (typeof GM_getValue === 'function') {
      raw = GM_getValue(SETTINGS_KEY, null);
    }
  } catch (e) {}
  if (!raw) {
    try {
      raw = localStorage.getItem(SETTINGS_KEY);
    } catch (e) {}
  }
  var parsed = {};
  if (raw) {
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      parsed = {};
    }
  }
  var cfg = Object.assign({}, DEFAULT_SETTINGS, parsed);
  cfg.forumVersions = Object.assign({}, DEFAULT_SETTINGS.forumVersions, parsed.forumVersions || {});
  if (!Array.isArray(cfg.excludedUsers)) {
    cfg.excludedUsers = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.excludedUsers));
  }
  return cfg;
}

function saveSettings(cfg) {
  var str = JSON.stringify(cfg);
  try {
    if (typeof GM_setValue === 'function') {
      GM_setValue(SETTINGS_KEY, str);
    }
  } catch (e) {}
  try {
    localStorage.setItem(SETTINGS_KEY, str);
  } catch (e) {}
}

var settings = loadSettings();

function clampDaysLimit(val) {
  var n = parseInt(val, 10);
  if (isNaN(n) || n < 1) return 60;
  return Math.min(n, 3650);
}

function normalizeGithubRepo(raw) {
  var s = String(raw == null ? '' : raw).trim();
  s = s.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) {
    return s;
  }
  return '';
}

var showStrikeouts = !!settings.showStrikeouts;
var daysAgoLimit = clampDaysLimit(settings.daysAgoLimit);
var wildGuess = !!settings.wildGuess;
var hideLocked = !!settings.hideLocked;

function applyRuntimeSettings() {
  showStrikeouts = !!settings.showStrikeouts;
  daysAgoLimit = clampDaysLimit(settings.daysAgoLimit);
  wildGuess = !!settings.wildGuess;
  hideLocked = !!settings.hideLocked;
}

const recent_searches_max = 18;

var forumMatch = window.location.href.match(/showforum=(\d+)/);
if (!forumMatch || (forumMatch[1] !== '77' && forumMatch[1] !== '90'))
  return;
var forum = forumMatch[1];
var forumLabel = FORUM_LABELS[forum] || ('Forum ' + forum);

// Independent IndexedDB database per forum board (77=WTS, 90=ISK) (SMS-USR-022)
var DB_NAME = 'SmartSearchCloudDb_' + forum;

// Register Tampermonkey menu commands (SMS-USR-031)
try {
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙️ Settings', function() {
      openSettingsModal();
    });
    GM_registerMenuCommand('🔄 Update ' + forumLabel + ' Database', function() {
      updateCurrentForumDatabase();
    });
  }
} catch (e) {}

var needsStorageInit = true;
if (typeof localStorage[RECENT_KEY] === 'string' && localStorage[RECENT_KEY]) {
  try {
    var parsedStorage = JSON.parse(localStorage[RECENT_KEY]);
    if (
      parsedStorage &&
      typeof parsedStorage === 'object' &&
      !Object.prototype.hasOwnProperty.call(parsedStorage, 'ignored') &&
      Array.isArray(parsedStorage.recentSearches)
    ) {
      needsStorageInit = false;
    }
  } catch (e) {
    needsStorageInit = true;
  }
}
if (needsStorageInit) {
  localStorage[RECENT_KEY] = '{"recentSearches":["pha elem"], "lowestEid":"67180000"}';
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(str) {
  var entityMap = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"'
  };
  return String(str == null ? '' : str).replace(
    /&(?:amp|lt|gt|quot|#0*39|#x0*27);/gi,
    function(m) {
      var lower = m.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(entityMap, lower)) {
        return entityMap[lower];
      }
      return "'";
    }
  );
}

function isAllowedHvUrl(url) {
  try {
    var parsed = new URL(String(url || '').trim());
    var proto = parsed.protocol.toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    var host = parsed.hostname.toLowerCase();
    return host === 'hentaiverse.org' || host === 'alt.hentaiverse.org';
  } catch (e) {
    return false;
  }
}

function appendSafePostLine(doc, container, line, startsWithStrike) {
  if (startsWithStrike && line.indexOf('[s]') !== 0) {
    container.appendChild(doc.createTextNode('[s]'));
  }
  var linkRe = /<a\s+href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  var lastIdx = 0;
  var match;
  while ((match = linkRe.exec(line)) !== null) {
    if (match.index > lastIdx) {
      container.appendChild(doc.createTextNode(decodeHtmlEntities(line.slice(lastIdx, match.index))));
    }
    var rawHref = decodeHtmlEntities(match[1] || match[2] || '').trim();
    var normalizedHref = rawHref.replace(
      /https?:\/\/(?:alt\.)?hentaiverse\.org\/(isekai\/)?pages\/showequip\.php\?eid=(\d+)&key=(\w+)/i,
      'https://hentaiverse.org/$1equip/$2/$3'
    );
    var innerPlain = decodeHtmlEntities(
      (match[3] || '').replace(/<\/?(?:a|b|i|u|s|span|font|div|strike|del|br|strong|em)\b[^>]*>/gi, '')
    );
    if (isAllowedHvUrl(normalizedHref)) {
      var aEl = doc.createElement('a');
      aEl.href = normalizedHref;
      aEl.target = '_blank';
      aEl.dataset.windowFlags = 'popup,width=450,height=520';
      aEl.textContent = innerPlain;
      aEl.onclick = linkClickPopup;
      container.appendChild(aEl);
    } else {
      container.appendChild(doc.createTextNode(innerPlain));
    }
    lastIdx = linkRe.lastIndex;
  }
  if (lastIdx < line.length) {
    container.appendChild(doc.createTextNode(decodeHtmlEntities(line.slice(lastIdx))));
  }
}

var lastStorage = JSON.parse(localStorage[RECENT_KEY]);
var recentSearches = Array.isArray(lastStorage.recentSearches) ? lastStorage.recentSearches : [];
var lowestEid = lastStorage.lowestEid || '67180000';
var include = 0;

var headTable = document.querySelector('.ipbtable');
if (!headTable) return;
var searchDiv = headTable.parentNode.insertBefore(document.createElement('div'), headTable.nextSibling);

var useRE = searchDiv.appendChild(document.createElement('input'));
useRE.type = 'checkbox';
useRE.title = 'Use regular expression in search field? (unticked: words in any order, e.g. pha elem)';
useRE.checked = !!lastStorage.useSearchRegEx;

var input = searchDiv.appendChild(document.createElement('input'));
input.type = 'search';
input.style.width = '350px';
input.setAttribute('list', 'recent-searches');
input.autocomplete = 'off';

var dataRecent = searchDiv.appendChild(document.createElement('datalist'));
dataRecent.id = 'recent-searches';
input.placeholder = 'e.g. pha elem (press ? for syntax)';

// Keyword syntax help for players who never read the forum post or the README (SMS-USR-083)
var forumHelpBtn = searchDiv.appendChild(document.createElement('button'));
forumHelpBtn.textContent = '?';
forumHelpBtn.title = 'Keyword syntax and examples';
forumHelpBtn.style.marginLeft = '4px';
var forumHelpPanel = searchDiv.parentNode.insertBefore(buildSyntaxHelp(document), searchDiv.nextSibling);
forumHelpBtn.addEventListener('click', function() {
  forumHelpPanel.style.display = forumHelpPanel.style.display === 'none' ? 'block' : 'none';
});

function updateRecentList() {
  dataRecent.innerHTML = '';
  recentSearches.forEach(function(item) {
    var option = document.createElement('option');
    option.value = item;
    dataRecent.appendChild(option);
  });
}
updateRecentList();

if (recentSearches.length && !(input.list instanceof HTMLDataListElement)) input.value = recentSearches[0];

var selectOnce = true;
input.addEventListener('click', function() {
  if (selectOnce) { input.select(); selectOnce = false; }
});

function pushRecentSearch(val) {
  if (val) {
    recentSearches = recentSearches.filter(function(x) { return x !== val; });
    recentSearches.unshift(val);
    if (recentSearches.length > recent_searches_max) recentSearches.length = recent_searches_max;
    updateRecentList();
  }
}

function deleteRecentSearch(val) {
  if (val) {
    recentSearches = recentSearches.filter(function(x) { return x !== val; });
    updateRecentList();
  }
}

input.onkeyup = function(event) {
  if (event.keyCode === 13) {
    search.click();
  } else if (event.keyCode === 46 && event.shiftKey) {
    deleteRecentSearch(input.value);
    input.select();
  }
};

function updateStorage() {
  lastStorage.recentSearches = recentSearches;
  lastStorage.lowestEid = lowestEid;
  lastStorage.useSearchRegEx = useRE.checked;
  localStorage[RECENT_KEY] = JSON.stringify(lastStorage);
}

const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
function linkClickPopup(e) {
  e.preventDefault();
  e.stopPropagation();
  const targetLink = e.currentTarget || e.target;
  const flags = (targetLink.dataset && targetLink.dataset.windowFlags) || 'popup';
  win.open(targetLink.href, '_blank', flags);
}

function isThreadExcludedBySettings(thread) {
  if (!thread) return false;
  if (settings.excludePinned) {
    if (thread.pinned === true || /^Pinned:\s*/i.test(thread.title || '')) {
      return true;
    }
  }
  if (Array.isArray(settings.excludedUsers)) {
    var tUid = String(thread.opUid || '').trim();
    var tName = String(thread.opName || '').trim().toLowerCase();
    for (var i = 0; i < settings.excludedUsers.length; i++) {
      var u = settings.excludedUsers[i];
      if (!u || !u.active) continue;
      var exUid = String(u.uid || '').trim();
      var exName = String(u.displayName || '').trim().toLowerCase();
      if (exUid && tUid && exUid === tUid) return true;
      if (exName && tName && exName === tName) return true;
    }
  }
  return false;
}

function getEquipFromLink(href) {
  if (!href) return false;
  var isIsekai = /\/isekai\//i.test(href);
  var eidRe = href.match(/(?:isekai\/)?pages\/showequip\.php\?eid=(\d+)&(?:amp;)?key=([0-9a-fA-F]{10})(?![0-9a-fA-F])/i);
  if (!eidRe)
    eidRe = href.match(/hentaiverse\.org\/(?:isekai\/)?equip\/(\d+)\/([0-9a-fA-F]{10})(?![0-9a-fA-F])/i);
  if (!eidRe)
    return false;
  return { eid: eidRe[1], key: eidRe[2].toLowerCase(), isIsekai: isIsekai };
}

// What a player sees on a line: HTML and BBCode tags removed (link targets are not searched), entities decoded
function lineVisibleText(line) {
  var text = String(line == null ? '' : line)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[\/?(?:url|b|i|u|s|color|size|font|img|quote|code|center|left|right|indent|email|list|sub|sup|\*)(?:=[^\]]*)?\]/gi, ' ');
  return decodeHtmlEntities(text);
}

// Keyword matcher (SMS-USR-082). Returns null for an empty keyword (every equipment line, SMS-USR-061),
// otherwise a function(line) -> boolean. Throws on an invalid regular expression.
//  - Default (fuzzy): words separated by spaces, all required, in any order, case-insensitive. A word that
//    starts with a letter or digit must match the start of a word in the visible text ('pha elem' finds
//    'Phase ... of the Elementalist'); '*' inside a word stands for any letters ('*sword' finds 'Shortsword').
//  - RegEx box ticked: the keyword is a JavaScript regular expression tested against the raw line, as before.
function buildKeywordMatcher(query, useRegEx) {
  var q = String(query == null ? '' : query).trim();
  if (!q) return null;
  if (useRegEx) {
    var strict = new RegExp(q, 'i');
    return function(line) { return strict.test(line); };
  }
  var parts = q.split(/\s+/).filter(function(word) { return /[^*]/.test(word); }).map(function(word) {
    var body = word.split('*').map(function(piece) {
      return piece.replace(/[.*+?^${}()|[\]\\\/\-]/g, '\\$&');
    }).join('\\S*');
    return new RegExp((/^[A-Za-z0-9_]/.test(word) ? '\\b' : '') + body, 'i');
  });
  if (!parts.length) return null;
  return function(line) {
    var text = lineVisibleText(line);
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i].test(text)) return false;
    }
    return true;
  };
}

// ── Filter import / export (SMS-USR-086) ──
// One line of JSON that a player can keep or share. Only the search conditions are included; Lowest EID,
// the thread title filter and Show Stats are view settings of each board and stay as they are.
var FILTER_SHARE_TAG = 'SmartSearchCloudFilter';
var FILTER_SHARE_TEXT_FIELDS = ['keyword', 'quality', 'levelMin', 'levelMax', 'priceMin', 'priceMax', 'rollMin', 'rollMax', 'sort'];
var FILTER_SHARE_SELECT_FIELDS = ['quality', 'sort'];
var FILTER_SHARE_MAPS = ['cats', 'types', 'prefixes', 'suffixes', 'slots', 'stats'];

function exportFilterText(state) {
  var out = {};
  out[FILTER_SHARE_TAG] = 1;
  FILTER_SHARE_TEXT_FIELDS.forEach(function(field) {
    var value = String(state[field] == null ? '' : state[field]).trim();
    if (value) out[field] = value;
  });
  if (state.useRE === true) out.useRE = true;
  FILTER_SHARE_MAPS.forEach(function(mapName) {
    var map = state[mapName] || {};
    var picked = Object.keys(map).filter(function(key) { return map[key]; });
    if (picked.length) out[mapName] = picked;
  });
  return JSON.stringify(out);
}

// Reads text made by exportFilterText() into a fresh filter. isAllowed(field, value) says whether this script
// has that select option or chip; anything else is skipped (a newer or older script may differ).
// Returns { filter, skipped: [labels] }; throws an Error when the text is not an exported filter.
function parseFilterText(text, isAllowed) {
  var notFilter = 'This is not SmartSearch-Cloud filter text: paste the whole line made by Export';
  var obj;
  try {
    obj = JSON.parse(String(text == null ? '' : text).trim());
  } catch (parseErr) {
    throw new Error(notFilter);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj[FILTER_SHARE_TAG] !== 1) throw new Error(notFilter);
  var filter = emptyEquipFilter();
  var skipped = [];
  FILTER_SHARE_TEXT_FIELDS.forEach(function(field) {
    if (obj[field] == null || typeof obj[field] === 'object') return;
    var value = String(obj[field]).trim();
    if (FILTER_SHARE_SELECT_FIELDS.indexOf(field) !== -1 && !isAllowed(field, value)) {
      skipped.push(field + ' ' + value);
      return;
    }
    filter[field] = value;
  });
  filter.useRE = obj.useRE === true;
  FILTER_SHARE_MAPS.forEach(function(mapName) {
    if (!Array.isArray(obj[mapName])) return;
    obj[mapName].forEach(function(key) {
      key = String(key);
      if (isAllowed(mapName, key)) filter[mapName][key] = true;
      else skipped.push(key);
    });
  });
  return { filter: filter, skipped: skipped };
}

// Keyword syntax help panel (SMS-USR-083), shared by the forum bar and the results tab; hidden until '?' is pressed
function buildSyntaxHelp(d) {
  // Built inside the function: the forum bar calls it before a top-level var would be assigned
  var html =
  '<b>Keyword syntax</b> (RegEx box unticked)' +
  '<ul style="margin:4px 0 4px 18px; padding:0;">' +
  '<li>Words in any order, each matching the start of a word, upper or lower case: ' +
  '<code>pha elem</code> finds <i>Legendary Phase Shoes of the Elementalist</i></li>' +
  '<li>Every word must be on the line: <code>leg fiery oak</code>, <code>peer pha sh</code>, <code>mag shade arca</code></li>' +
  '<li><code>*</code> stands for any letters inside a word: <code>*sword</code> finds Shortsword, Longsword</li>' +
  '<li>Only the text you see is searched, not the link addresses. Numbers work too: <code>lv.500</code>, <code>500k</code></li>' +
  '<li>Leave it empty to list every equipment line; otherwise type at least 3 characters.</li>' +
  '</ul>' +
  '<b>RegEx box ticked</b>: the keyword is a JavaScript regular expression, matched anywhere on the line: ' +
  '<code>peerless.*(phase|cotton)</code>, <code>\\bof the (arcanist|elementalist)\\b</code>' +
  '<div style="margin-top:4px;">Quality, type, prefix, suffix, slot and primary attributes are easier with the <b>Equipment filter</b> in the results tab.</div>';
  var panel = d.createElement('div');
  panel.className = 'ssHelp';
  panel.style.cssText = 'display:none; text-align:left; margin:6px 0; padding:6px 10px; border:1px solid #9fb8bd; ' +
    'border-radius:3px; background:#f4f9fa; color:#23404a; font-size:12px; line-height:1.6;';
  panel.innerHTML = html;
  return panel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Equipment filter for the search results tab (SMS-USR-062, 063)
// Several picks in one section = any of them; different sections must all match.
// ─────────────────────────────────────────────────────────────────────────────
var EQUIP_QUALITIES = ['Peerless', 'Legendary', 'Magnificent', 'Exquisite', 'Superior', 'Average', 'Fair', 'Crude'];
var EQUIP_CATEGORIES = [
  { key: 'One-handed', label: '1H', types: ['Axe', 'Club', 'Dagger', 'Rapier', 'Shortsword', 'Wakizashi'] },
  { key: 'Two-handed', label: '2H', types: ['Estoc', 'Katana', 'Longsword', 'Mace', 'Scythe', 'Swordchucks'] },
  { key: 'Staff', label: 'Staff', types: ['Oak', 'Redwood', 'Willow', 'Katalox', 'Ebony'] },
  { key: 'Shield', label: 'Shield', types: ['Buckler', 'Kite', 'Tower', 'Force'] },
  { key: 'Cloth', label: 'Cloth', types: ['Cotton', 'Gossamer', 'Ironsilk', 'Phase'] },
  { key: 'Light', label: 'Light', types: ['Leather', 'Drakehide', 'Kevlar', 'Shade'] },
  { key: 'Heavy', label: 'Heavy', types: ['Plate', 'Chain', 'Reactive', 'Power'] }
];
var EQUIP_ARMOR_CATEGORIES = ['Cloth', 'Light', 'Heavy'];
var EQUIP_SLOTS = [
  { label: 'Head', words: ['Cap', 'Helmet'] },
  { label: 'Body', words: ['Robe', 'Breastplate', 'Cuirass', 'Armor'] },
  { label: 'Hands', words: ['Gloves', 'Gauntlets'] },
  { label: 'Legs', words: ['Pants', 'Leggings', 'Greaves'] },
  { label: 'Feet', words: ['Shoes', 'Boots', 'Sabatons'] }
];
var EQUIP_PREFIX_GROUPS = [
  { label: 'Weapon / staff', items: ['Ethereal', 'Fiery', 'Arctic', 'Shocking', 'Tempestuous', 'Hallowed', 'Demonic'] },
  { label: 'Armor / shield', items: ['Radiant', 'Charged', 'Mystic', 'Frugal', 'Reinforced', 'Agile', 'Savage', 'Mithril', 'Shielding'] },
  { label: 'Mitigation', items: ['Ruby', 'Cobalt', 'Amber', 'Jade', 'Zircon', 'Onyx'] }
];
// A suffix may sit in more than one group (e.g. the Battlecaster on weapons and on light armor / shields);
// every copy toggles the same condition (SMS-USR-079)
var EQUIP_SUFFIX_GROUPS = [
  { label: 'Weapon', items: ['Slaughter', 'Balance', 'Swiftness', 'the Nimble', 'the Battlecaster', 'the Vampire', 'the Illithid', 'the Banshee'] },
  { label: 'Staff / magic', items: ['Destruction', 'Focus', 'Surtr', 'Niflheim', 'Mjolnir', 'Freyr', 'Heimdall', 'Fenrir'] },
  { label: 'Proficiency', items: ['the Elementalist', 'the Heaven-sent', 'the Demon-fiend', 'the Earth-walker', 'the Curse-weaver'] },
  { label: 'Defence', items: ['Protection', 'Warding', 'Dampening', 'Deflection', 'Stoneskin', 'Negation', 'the Barrier', 'the Fleet', 'the Shadowdancer', 'the Arcanist', 'the Battlecaster', 'Slaughter', 'Balance', 'the Nimble'] },
  { label: 'Mitigation', items: ['the Fire-eater', 'the Frost-born', 'the Thunder-child', 'the Wind-waker', 'the Thrice-blessed', 'the Spirit-ward'] },
  { label: 'Primary attributes', items: ['the Ox', 'the Raccoon', 'the Cheetah', 'the Fox', 'the Owl', 'the Turtle'] }
];
var EQUIP_PRIMARY_STATS = ['S', 'D', 'E', 'A', 'I', 'W'];
// Which equipment types each prefix / suffix occurs on (SMS-USR-066). Generated from the backend equip cache
// (11204 equips, 2026-11-21); types with < 100 samples also inherit every affix seen in their category.
var EQUIP_AFFIX_TYPES = {
  prefix: {
    "Ethereal": ['Axe', 'Club', 'Dagger', 'Ebony', 'Estoc', 'Katalox', 'Katana', 'Longsword', 'Mace', 'Oak', 'Rapier', 'Redwood', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi', 'Willow'],
    "Fiery": ['Axe', 'Club', 'Dagger', 'Ebony', 'Estoc', 'Katalox', 'Katana', 'Longsword', 'Mace', 'Oak', 'Rapier', 'Redwood', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi', 'Willow'],
    "Arctic": ['Axe', 'Club', 'Dagger', 'Ebony', 'Estoc', 'Katalox', 'Katana', 'Longsword', 'Mace', 'Oak', 'Rapier', 'Redwood', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi', 'Willow'],
    "Shocking": ['Axe', 'Club', 'Dagger', 'Ebony', 'Estoc', 'Katalox', 'Katana', 'Longsword', 'Mace', 'Oak', 'Rapier', 'Redwood', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi', 'Willow'],
    "Tempestuous": ['Axe', 'Club', 'Dagger', 'Ebony', 'Estoc', 'Katalox', 'Katana', 'Longsword', 'Mace', 'Oak', 'Rapier', 'Redwood', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi', 'Willow'],
    "Hallowed": ['Axe', 'Club', 'Dagger', 'Ebony', 'Estoc', 'Katalox', 'Katana', 'Longsword', 'Mace', 'Oak', 'Rapier', 'Redwood', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi', 'Willow'],
    "Demonic": ['Axe', 'Club', 'Dagger', 'Ebony', 'Estoc', 'Katalox', 'Katana', 'Longsword', 'Mace', 'Oak', 'Rapier', 'Redwood', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi', 'Willow'],
    "Radiant": ['Ironsilk', 'Phase'],
    "Charged": ['Cotton', 'Ironsilk', 'Phase'],
    "Mystic": ['Ironsilk', 'Phase'],
    "Frugal": ['Cotton', 'Ironsilk', 'Phase'],
    "Reinforced": ['Buckler', 'Chain', 'Drakehide', 'Ironsilk', 'Kevlar', 'Kite', 'Leather', 'Tower'],
    "Agile": ['Buckler', 'Drakehide', 'Kevlar', 'Kite', 'Leather', 'Shade'],
    "Savage": ['Chain', 'Drakehide', 'Kevlar', 'Power', 'Shade'],
    "Mithril": ['Buckler', 'Chain', 'Kite', 'Plate', 'Power', 'Reactive', 'Tower'],
    "Shielding": ['Chain', 'Plate'],
    "Ruby": ['Chain', 'Cotton', 'Drakehide', 'Force', 'Gossamer', 'Ironsilk', 'Kevlar', 'Leather', 'Phase', 'Plate', 'Power', 'Reactive', 'Shade'],
    "Cobalt": ['Chain', 'Cotton', 'Drakehide', 'Force', 'Gossamer', 'Ironsilk', 'Kevlar', 'Leather', 'Phase', 'Plate', 'Power', 'Reactive', 'Shade'],
    "Amber": ['Chain', 'Cotton', 'Drakehide', 'Force', 'Gossamer', 'Ironsilk', 'Kevlar', 'Leather', 'Phase', 'Plate', 'Power', 'Reactive', 'Shade'],
    "Jade": ['Chain', 'Cotton', 'Drakehide', 'Force', 'Gossamer', 'Ironsilk', 'Kevlar', 'Leather', 'Phase', 'Plate', 'Power', 'Reactive', 'Shade'],
    "Zircon": ['Chain', 'Cotton', 'Drakehide', 'Force', 'Gossamer', 'Ironsilk', 'Kevlar', 'Leather', 'Phase', 'Plate', 'Power', 'Reactive', 'Shade'],
    "Onyx": ['Chain', 'Cotton', 'Drakehide', 'Force', 'Gossamer', 'Ironsilk', 'Kevlar', 'Leather', 'Phase', 'Plate', 'Power', 'Reactive', 'Shade']
  },
  suffix: {
    "Slaughter": ['Axe', 'Chain', 'Club', 'Dagger', 'Estoc', 'Katana', 'Longsword', 'Mace', 'Power', 'Rapier', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi'],
    "Balance": ['Axe', 'Chain', 'Club', 'Dagger', 'Estoc', 'Katana', 'Longsword', 'Mace', 'Power', 'Rapier', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi'],
    "Swiftness": ['Club', 'Dagger', 'Rapier', 'Shortsword', 'Wakizashi'],
    "the Nimble": ['Buckler', 'Club', 'Dagger', 'Rapier', 'Wakizashi'],
    "the Battlecaster": ['Axe', 'Buckler', 'Club', 'Dagger', 'Drakehide', 'Estoc', 'Katana', 'Kevlar', 'Kite', 'Longsword', 'Mace', 'Rapier', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi'],
    "the Vampire": ['Axe', 'Club', 'Estoc', 'Longsword', 'Mace', 'Rapier', 'Scythe', 'Shortsword', 'Swordchucks'],
    "the Illithid": ['Axe', 'Club', 'Estoc', 'Longsword', 'Mace', 'Rapier', 'Scythe', 'Shortsword', 'Swordchucks'],
    "the Banshee": ['Axe', 'Club', 'Estoc', 'Longsword', 'Mace', 'Rapier', 'Scythe', 'Shortsword', 'Swordchucks'],
    "the Ox": ['Axe', 'Estoc', 'Katana', 'Longsword', 'Mace', 'Scythe', 'Shortsword', 'Swordchucks'],
    "the Raccoon": ['Axe', 'Club', 'Dagger', 'Ironsilk', 'Phase', 'Rapier', 'Scythe', 'Shortsword', 'Swordchucks', 'Wakizashi'],
    "the Cheetah": ['Club', 'Dagger', 'Ironsilk', 'Phase', 'Rapier'],
    "Destruction": ['Ebony', 'Katalox', 'Oak', 'Redwood', 'Willow'],
    "Focus": ['Dagger', 'Ebony', 'Katalox', 'Oak', 'Redwood', 'Shortsword', 'Willow'],
    "Surtr": ['Ebony', 'Ironsilk', 'Phase', 'Redwood'],
    "Niflheim": ['Ebony', 'Ironsilk', 'Phase', 'Redwood'],
    "Mjolnir": ['Ebony', 'Ironsilk', 'Phase', 'Redwood'],
    "Freyr": ['Ebony', 'Ironsilk', 'Phase', 'Redwood'],
    "Heimdall": ['Ebony', 'Ironsilk', 'Katalox', 'Oak', 'Phase'],
    "Fenrir": ['Ebony', 'Ironsilk', 'Katalox', 'Phase', 'Willow'],
    "the Elementalist": ['Cotton', 'Ebony', 'Gossamer', 'Ironsilk', 'Phase', 'Redwood'],
    "the Heaven-sent": ['Cotton', 'Ebony', 'Gossamer', 'Ironsilk', 'Katalox', 'Phase'],
    "the Demon-fiend": ['Cotton', 'Ebony', 'Gossamer', 'Ironsilk', 'Katalox', 'Phase'],
    "the Earth-walker": ['Cotton', 'Ebony', 'Gossamer', 'Ironsilk', 'Oak', 'Phase'],
    "the Curse-weaver": ['Cotton', 'Ebony', 'Gossamer', 'Ironsilk', 'Phase', 'Willow'],
    "the Fox": ['Ebony', 'Gossamer', 'Ironsilk', 'Katalox', 'Oak', 'Phase', 'Redwood', 'Willow'],
    "the Owl": ['Ebony', 'Gossamer', 'Ironsilk', 'Phase', 'Redwood', 'Willow'],
    "Protection": ['Buckler', 'Chain', 'Cotton', 'Drakehide', 'Force', 'Ironsilk', 'Kevlar', 'Kite', 'Leather', 'Plate', 'Power', 'Reactive', 'Tower'],
    "Warding": ['Buckler', 'Chain', 'Cotton', 'Drakehide', 'Force', 'Ironsilk', 'Kevlar', 'Kite', 'Leather', 'Plate', 'Power', 'Reactive', 'Tower'],
    "Dampening": ['Buckler', 'Chain', 'Drakehide', 'Force', 'Kevlar', 'Kite', 'Leather', 'Plate', 'Reactive', 'Tower'],
    "Deflection": ['Buckler', 'Chain', 'Drakehide', 'Force', 'Kevlar', 'Kite', 'Leather', 'Plate', 'Reactive', 'Tower'],
    "Stoneskin": ['Buckler', 'Chain', 'Drakehide', 'Force', 'Kevlar', 'Kite', 'Leather', 'Plate', 'Reactive', 'Tower'],
    "Negation": ['Drakehide', 'Kevlar', 'Leather', 'Shade'],
    "the Barrier": ['Buckler', 'Chain', 'Kite', 'Reactive', 'Tower'],
    "the Fleet": ['Buckler', 'Drakehide', 'Ironsilk', 'Kevlar', 'Shade'],
    "the Shadowdancer": ['Drakehide', 'Kevlar', 'Shade'],
    "the Arcanist": ['Drakehide', 'Kevlar', 'Shade'],
    "the Turtle": ['Force', 'Kite', 'Tower'],
    "the Fire-eater": ['Chain', 'Cotton', 'Drakehide', 'Ironsilk', 'Kevlar', 'Leather', 'Plate', 'Reactive'],
    "the Frost-born": ['Chain', 'Cotton', 'Drakehide', 'Ironsilk', 'Kevlar', 'Leather', 'Plate', 'Reactive'],
    "the Thunder-child": ['Chain', 'Cotton', 'Drakehide', 'Ironsilk', 'Kevlar', 'Leather', 'Plate', 'Reactive'],
    "the Wind-waker": ['Chain', 'Cotton', 'Drakehide', 'Ironsilk', 'Kevlar', 'Leather', 'Plate', 'Reactive'],
    "the Thrice-blessed": ['Chain', 'Cotton', 'Drakehide', 'Ironsilk', 'Kevlar', 'Leather', 'Plate', 'Reactive'],
    "the Spirit-ward": ['Chain', 'Cotton', 'Drakehide', 'Ironsilk', 'Kevlar', 'Leather', 'Plate', 'Reactive']
  }
};
var EQUIP_NONE = '(none)'; // 'No prefix' / 'No suffix' pick

function emptyEquipFilter() {
  return {
    name: '', quality: '', levelMin: '', levelMax: '', priceMin: '', priceMax: '', rollMin: '', rollMax: '',
    stats: {}, cats: {}, types: {}, slots: {}, prefixes: {}, suffixes: {}, sort: '',
    keyword: '', useRE: false // results-tab search box (SMS-USR-064)
  };
}

// Equipment types still possible under the picked Category / Type chips; null = nothing picked (SMS-USR-066)
function availableEquipTypes(f) {
  var pickedCats = anyPicked(f.cats);
  var pickedTypes = anyPicked(f.types);
  if (!pickedCats && !pickedTypes) return null;
  var out = [];
  EQUIP_CATEGORIES.forEach(function(c) {
    if (pickedCats && !f.cats[c.key]) return;
    c.types.forEach(function(t) {
      if (pickedTypes && !f.types[t]) return;
      out.push(t);
    });
  });
  return out;
}

// A Category chip stays available only if one of its Types is picked; no Type picked = all categories
function isCategoryAvailable(f, catKey) {
  if (!anyPicked(f.types)) return true;
  return EQUIP_CATEGORIES.some(function(c) {
    return c.key === catKey && c.types.some(function(t) { return !!f.types[t]; });
  });
}

// A Type chip stays available only inside the picked categories; no category picked = all types
function isTypeAvailable(f, type) {
  if (!anyPicked(f.cats)) return true;
  return !!f.cats[categoryOfType(type)];
}

// Types still possible after the picked prefixes / suffixes: those on which at least one picked affix occurs.
// 'No prefix' / 'No suffix' fits every type. types === null means "no restriction yet" (SMS-USR-079)
function narrowTypesByAffix(kind, picked, types) {
  var keys = Object.keys(picked || {}).filter(function(k) { return !!picked[k]; });
  if (!keys.length || keys.indexOf(EQUIP_NONE) !== -1) return types;
  var base = types;
  if (base === null) {
    base = [];
    EQUIP_CATEGORIES.forEach(function(c) { base = base.concat(c.types); });
  }
  return base.filter(function(t) {
    return keys.some(function(k) { return (EQUIP_AFFIX_TYPES[kind][k] || []).indexOf(t) !== -1; });
  });
}

function isSlotAvailable(types) {
  if (types === null) return true;
  return types.some(function(t) { return EQUIP_ARMOR_CATEGORIES.indexOf(categoryOfType(t)) !== -1; });
}

// kind: 'prefix' | 'suffix'; 'No prefix' / 'No suffix' are always available
function isAffixAvailable(kind, affix, types) {
  if (types === null || affix === EQUIP_NONE) return true;
  var allowed = EQUIP_AFFIX_TYPES[kind][affix] || [];
  return types.some(function(t) { return allowed.indexOf(t) !== -1; });
}

// WTS data rules (SMS-USR-067): only for these boards
var WTS_RULE_FORUMS = ['77'];

// Tradeable = numeric or Unassigned level ('Soulbound' / 'Untradeable' / 'No such item' / 'Error' are not)
function isTradeableItem(item) {
  return !!item && /^(\d+|Unassigned)$/.test(String(item.level || ''));
}

// A WTS line is listed only when it links an equipment that is Tradeable and, when the backend checked the
// holder, held by the thread's poster (savedEquips[eid].own, SMS-EXP-028 / SMS-EQP-048)
function passesWtsRules(line, thread, savedEquips) {
  var eq = getEquipFromLink(line);
  if (!eq) return false;
  var item = savedEquips ? savedEquips[eq.eid] : null;
  if (!isTradeableItem(item)) return false;
  if (item.key && eq.key && String(item.key).toLowerCase() !== eq.key) return false;
  if (item.own && item.own !== String((thread && thread.opUid) || '')) return false;
  return true;
}

// Stats columns (SMS-USR-069, 074): [Quality, Type, PAB, ROLL %, Base avg]
function statCellTexts(item) {
  var d = describeEquip(item);
  if (!d) return ['', '', '', '', ''];
  var catLabel = '';
  EQUIP_CATEGORIES.forEach(function(c) { if (c.key === d.cat) catLabel = c.label; });
  var avg = parseFloat(item && item.avg);
  return [
    d.quality,
    [catLabel || d.cat, d.type].filter(function(x) { return !!x; }).join(' · '),
    d.pab,
    d.pct === null ? '' : d.pct.toFixed(1),
    isNaN(avg) ? '' : avg.toFixed(2)
  ];
}

// Text left for Wild Guess (SMS-USR-075): equipment links, bracketed tags with digits ([123456], [_123456]), URLs,
// levels ("Lv.287", a leading "(285, ..."), AVG/Ave/Base notes and percentages are removed first.
// ISK equipment IDs restart every season, so they are short enough to look like prices.
function wildGuessText(line) {
  return String(line)
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ')
    .replace(/\[url[^\]]*\][\s\S]*?\[\/url\]/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\[[^\]\n]*\d[^\]\n]*\]/g, ' ')
    .replace(/\b(?:lv|lvl|level)\s*\.?\s*\d+/gi, ' ')
    .replace(/\b(?:avg|ave|average|base)\s*[:=]?\s*-?\d+(?:\.\d+)?%?/gi, ' ')
    .replace(/-?\d+(?:\.\d+)?\s*%/g, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:pts?|points?)\b/gi, ' ') // exchange-shop points, not prices
    .replace(/\b(?:seller|buyer|by)\s*:\s*[^\s)]+/gi, ' ')
    .replace(/\b[SDEAIW]{1,6}\s+\d+\b/g, ' ') // primary-stat values such as "IW 25"
    .replace(/^\s*\d+\s*[.)]/, ' ')            // list numbering "2)" / "1."
    .replace(/\d+\s*\/\s*\d+/g, ' ')           // fractions / counters "0/1"
    .replace(/\(\s*\d{1,3}\s*(?=[,)])/g, '( ')
    .replace(/[^\s()]*[A-Za-z_][^\s()]*/g, ' '); // words with digits in them, e.g. seller names "hentai2024-1"
}

// Price text of one post line (also used to pre-filter lines before rendering)
function linePriceText(line) {
  var priceRe = line.replace(/start(\s?bid)?\s?:\s?[0-9,.]+\s?[kmc]/ig, '#').match(/([1-9]\d*(?:[\.,]\d+)?\s?[kmc])(?:[^\w"]|$)/i);
  if (!priceRe)
    priceRe = line.match(/@\s?([1-9]\d*(?:[\.,]\d+)?)/i);
  if (!priceRe && wildGuess)
    // A bare number only: not glued to a word (seller names like "Jake643"), '=', '.' or another digit
    priceRe = wildGuessText(line).match(/(?:^|[^\w=.])([1-9]\d*(?:[\.,]\d+)?)([^\w"]|$)/i);
  return priceRe && (priceRe[1].length < 9 || priceRe[1].indexOf(',') !== -1) ? priceRe[1] : '';
}

// Price text -> credits: '1.5m' 1500000, '500k' 500000, '300c' 300, '1,500,000' 1500000, '1,5m' 1500000; null if unparseable
function parsePriceAmount(text) {
  var s = String(text === undefined || text === null ? '' : text).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  s = /,\d{3}(?!\d)/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  var m = s.match(/^(\d+(?:\.\d+)?)([kmc]?)$/);
  if (!m) return null;
  var n = parseFloat(m[1]);
  if (m[2] === 'k') n *= 1000;
  else if (m[2] === 'm') n *= 1000000;
  return Math.round(n);
}

function parseBound(text) {
  var s = String(text === undefined || text === null ? '' : text).trim();
  if (!s) return null;
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function anyPicked(map) {
  return Object.keys(map || {}).some(function(k) { return !!map[k]; });
}

function normalizeEquipType(type) {
  var t = String(type || '').trim();
  return t === 'Great Mace' ? 'Mace' : t; // HV lists two-handed maces as both 'Mace' and 'Great Mace'
}

function categoryOfType(type) {
  for (var i = 0; i < EQUIP_CATEGORIES.length; i++) {
    if (EQUIP_CATEGORIES[i].types.indexOf(type) !== -1) return EQUIP_CATEGORIES[i].key;
  }
  return '';
}

// savedEquips item -> structured description, or null when the equip name is unknown
function describeEquip(item) {
  if (!item || !item.name || item.name === 'No such item' || item.name === 'Error') return null;
  var fullName = String(item.name);
  var name = fullName;
  var inner = fullName.match(/\(([^()]*)\)\s*$/); // renamed equips: 'Holy II(Legendary Hallowed Oak Staff of Destruction)'
  if (inner) name = inner[1];
  name = name.trim();
  var ofIdx = name.indexOf(' of ');
  var head = ofIdx === -1 ? name : name.slice(0, ofIdx);
  var suffix = ofIdx === -1 ? '' : name.slice(ofIdx + 4).trim();
  var words = head.split(/\s+/);
  var spaced = ' ' + head + ' ';
  var type = normalizeEquipType(item.type);
  if (!type) {
    if (spaced.indexOf(' Great Mace ') !== -1) type = 'Mace';
    EQUIP_CATEGORIES.forEach(function(c) {
      c.types.forEach(function(t) {
        if (!type && spaced.indexOf(' ' + t + ' ') !== -1) type = t;
      });
    });
  }
  var cat = String(item.cat || '') || categoryOfType(type);
  var prefix = '';
  EQUIP_PREFIX_GROUPS.forEach(function(g) {
    g.items.forEach(function(p) {
      if (!prefix && words.indexOf(p) !== -1) prefix = p;
    });
  });
  var slot = '';
  if (EQUIP_ARMOR_CATEGORIES.indexOf(cat) !== -1) {
    var last = words[words.length - 1];
    EQUIP_SLOTS.forEach(function(s) {
      if (!slot && s.words.indexOf(last) !== -1) slot = s.label;
    });
  }
  var levelText = String(item.level || '');
  var pct = parseFloat(item.pct);
  return {
    fullName: fullName,
    quality: String(item.rarity || '') || (EQUIP_QUALITIES.indexOf(words[0]) !== -1 ? words[0] : ''),
    cat: cat,
    type: type,
    slot: slot,
    prefix: prefix,
    suffix: suffix,
    pab: String(item.pab || '').toUpperCase(),
    pct: isNaN(pct) ? null : pct,
    level: /^\d+$/.test(levelText) ? parseInt(levelText, 10) : null
  };
}

// Any condition that needs equipment data; rows without it are hidden while one is active
function equipFilterNeedsEquip(f) {
  return !!(String(f.name || '').trim() || f.quality ||
    parseBound(f.levelMin) !== null || parseBound(f.levelMax) !== null ||
    parseBound(f.rollMin) !== null || parseBound(f.rollMax) !== null ||
    anyPicked(f.stats) || anyPicked(f.cats) || anyPicked(f.types) || anyPicked(f.slots) ||
    anyPicked(f.prefixes) || anyPicked(f.suffixes));
}

function equipFilterIsActive(f) {
  return equipFilterNeedsEquip(f) || parsePriceAmount(f.priceMin) !== null || parsePriceAmount(f.priceMax) !== null;
}

// f: filter state, desc: describeEquip() result or null, price: credits or null
function matchEquipFilter(f, desc, price) {
  var pMin = parsePriceAmount(f.priceMin);
  var pMax = parsePriceAmount(f.priceMax);
  if (pMin !== null || pMax !== null) {
    if (price === null || price === undefined || isNaN(price)) return false;
    if (pMin !== null && price < pMin) return false;
    if (pMax !== null && price > pMax) return false;
  }
  if (!equipFilterNeedsEquip(f)) return true;
  if (!desc) return false;
  var nameQuery = String(f.name || '').trim().toLowerCase();
  if (nameQuery && desc.fullName.toLowerCase().indexOf(nameQuery) === -1) return false;
  if (f.quality && desc.quality !== f.quality) return false;
  var lMin = parseBound(f.levelMin), lMax = parseBound(f.levelMax);
  if (lMin !== null || lMax !== null) {
    if (desc.level === null) return false;
    if (lMin !== null && desc.level < lMin) return false;
    if (lMax !== null && desc.level > lMax) return false;
  }
  var rMin = parseBound(f.rollMin), rMax = parseBound(f.rollMax);
  if (rMin !== null || rMax !== null) {
    if (desc.pct === null) return false;
    if (rMin !== null && desc.pct < rMin) return false;
    if (rMax !== null && desc.pct > rMax) return false;
  }
  var statsOk = EQUIP_PRIMARY_STATS.every(function(s) {
    return !f.stats[s] || desc.pab.indexOf(s) !== -1; // every picked primary stat must be present
  });
  if (!statsOk) return false;
  if (anyPicked(f.cats) && !f.cats[desc.cat]) return false;
  if (anyPicked(f.types) && !f.types[desc.type]) return false;
  if (anyPicked(f.slots) && !f.slots[desc.slot]) return false;
  if (anyPicked(f.prefixes) && !f.prefixes[desc.prefix || EQUIP_NONE]) return false;
  if (anyPicked(f.suffixes) && !f.suffixes[desc.suffix || EQUIP_NONE]) return false;
  return true;
}

var SmartSearch;

// Two entry points on the forum bar (SMS-USR-064):
//  - Filter Search: search the forum keyword at once; the keyword is put into the results tab's search box,
//    where it can be edited together with the other conditions.
//  - Open Search Window: open an empty results tab; nothing is searched until its Search button is pressed.
var search = searchDiv.appendChild(document.createElement('button'));
search.textContent = 'Filter Search';
search.style['margin-left'] = '30px';
search.title = 'Search this keyword now; more conditions can be added in the results tab';
search.addEventListener('click', function() {
  openSearchTab(true);
});

var openSearchWindowBtn = searchDiv.appendChild(document.createElement('button'));
openSearchWindowBtn.textContent = 'Open Search Window';
openSearchWindowBtn.style.marginLeft = '10px';
openSearchWindowBtn.title = 'Open an empty search tab: set the conditions there, then press Search';
openSearchWindowBtn.addEventListener('click', function() {
  openSearchTab(false);
});

function openSearchTab(runNow) {
  settings = loadSettings();
  applyRuntimeSettings();
  updateStatusSpan();
  var entryBtn = runNow ? search : openSearchWindowBtn;
  var entryLabel = runNow ? 'Filter Search' : 'Open Search Window';
  entryBtn.disabled = true;
  setTimeout(function() {
    entryBtn.textContent = entryLabel;
    entryBtn.disabled = false;
  }, 1500);
  var forumQuery = runNow ? input.value : '';
  if (forumQuery) pushRecentSearch(forumQuery);
  updateStorage();
  // An empty keyword lists every line with an equipment link (SMS-USR-061)
  if (forumQuery.length > 0 && forumQuery.length < 3) {
    entryBtn.textContent = 'String is too short';
    return;
  }
  // Results open in a new browser tab left at about:blank, so the address bar never shows a forum URL.
  // The page is built with DOM calls only: document.open()/write() from this page would rewrite the tab URL (SMS-USR-060).
  var w = win.open('', '_blank');
  if (w === null || w === undefined) {
    error('The browser blocked the new tab, so SmartSearch\'s results can\'t be opened. Please allow pop-ups from https://forums.e-hentai.org/');
    return;
  }
  if (w.document.head) w.document.head.innerHTML = '';
  w.document.body.innerHTML = '';

  // This tab's conditions. They are drafts: nothing is searched until Search is pressed (SMS-USR-062)
  var tabState = emptyEquipFilter();
  tabState.keyword = forumQuery;
  tabState.useRE = !!useRE.checked;
  var applySortHook = null;
  function updateTabTitle() {
    w.document.title = (tabState.keyword || 'Search') + ' • SmartSearch-Cloud (' + forumLabel + ')';
  }
  updateTabTitle();

  function reopenCurrentSearch() {
    runSearch(); // Ignore panel writes and 'Reload interface' re-run the search in this tab
  }

  function buildCSS() {
    var cssSource = `
body {background:#DFEBED; font-family:arial; text-align:center;}
ul {text-align:left;}

input::-webkit-inner-spin-button {-webkit-appearance: none; margin:0;}
input[type='number'] {-moz-appearance:textfield;}

.filterInput {margin-left:3px; margin-right:20px;}
#filterThreadCheckboxDiv {display:inline-block; vertical-align:middle;}
#filterThreadResult {width:270px}

table {border-collapse:collapse; width:100%; table-layout:fixed; margin-top:20px;}
tr {border:1px solid black; font-size:80%;}
tr:hover {background-color:#ccd9ff;}
td {padding:0 10px; overflow:hidden; white-space:nowrap;}
.main th:nth-child(1) {width:100px;}
.main th:nth-child(2) {width:220px;}
.main th:nth-child(3) {width:80px; color:blue; text-decoration:underline; cursor:pointer;}
.main th:nth-child(4) {width:70px; color:blue; text-decoration:underline; cursor:pointer;}
.main td:nth-child(3) {text-align:right;}
.main td:nth-child(1), .main td:nth-child(4), .main td:nth-child(5) {text-align:center;}
.main th:nth-child(5) {width:90px; color:blue; text-decoration:underline; cursor:pointer;}
.main th:nth-child(7) {width:100px;}
.main th:nth-child(8) {width:90px; color:blue; text-decoration:underline; cursor:pointer;}
.main th:nth-child(9) {width:90px; color:blue; text-decoration:underline; cursor:pointer;}
.main th:nth-child(10) {width:120px;}
.main th:nth-child(11) {width:55px;}
.main th:nth-child(12) {width:65px; color:blue; text-decoration:underline; cursor:pointer;}
.main th:nth-child(13) {width:60px; color:blue; text-decoration:underline; cursor:pointer;}
.main td:nth-child(12), .main td:nth-child(13) {text-align:right;}
.main th:nth-child(14) {width:70px;}
.main .st {display:none;}
.showStats .main .st {display:table-cell;}
.main {min-width:1000px;}
.showStats .main {min-width:1450px;}
.warn {background:#fdb;}
.ended {background:#fff;}

.ignoredDiv {text-align:center; background:white; width:95%; border:3px solid black; padding:20px; margin-bottom:100px;}
.ignoredDiv td:nth-child(1) {width:70px;}
.ignoredDiv td:nth-child(2) {width:200px;}
.ignoredPosts td:nth-child(3) {width:170px;}

a:visited {color:#c06}

.ssBar {position:sticky; top:0; z-index:20; text-align:left; background:#DFEBED; border-bottom:1px solid #9fb8bd; padding:6px 2px 8px 2px; margin:0 0 12px 0; font-size:13px; color:#23404a;}
.ssBarRow {display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:3px 0;}
.ssBar input[type='text'] {padding:5px 8px; border:1px solid #9fb8bd; border-radius:3px; background:#fff; font-size:13px;}
.ssBar .ssNum {width:70px;}
.ssBar .ssKeyword {width:260px;}
.ssBar select {padding:4px 6px; border:1px solid #9fb8bd; border-radius:3px; background:#fff; font-size:13px;}
.ssBar .ssLbl {margin-left:8px;}
.ssBtn {padding:3px 9px; border:1px solid #2f5866; border-radius:3px; background:#fff; color:#2f5866; font-weight:bold; cursor:pointer; font-size:13px;}
.ssBtnDark {background:#2f5866; color:#fff;}
.ssChip {padding:3px 9px; border:1px solid #9fb8bd; border-radius:3px; background:#fff; color:#23404a; font-weight:bold; cursor:pointer; font-size:13px; margin:2px 4px 2px 0;}
.ssChip.on {background:#2f5866; border-color:#2f5866; color:#fff;}
.ssChip:disabled {background:#e6ecee; border-color:#d0dadd; color:#a9b8bc; cursor:not-allowed;}
.ssPanel {position:absolute; left:0; right:0; top:100%; z-index:10; background:#eef5f6; border:1px solid #2f5866; border-radius:4px; box-shadow:0 4px 14px rgba(0,0,0,.25); max-height:70vh; display:flex; flex-direction:column;}
.ssPanelBody {overflow-y:auto; padding:10px 14px;}
.ssSection {border-bottom:1px solid #c8d8db; padding:8px 0;}
.ssSection:last-child {border-bottom:none;}
.ssSectionTitle {font-weight:bold; margin-bottom:4px;}
.ssGroup {display:flex; align-items:center; flex-wrap:wrap;}
.ssGroupLabel {width:95px; font-size:12px; color:#4b6870;}
.ssPanelFoot {display:flex; align-items:center; gap:10px; border-top:1px solid #c8d8db; padding:8px 14px;}
.ssPanelFoot .ssSpacer {flex:1;}
.ssBarMain {display:flex; align-items:flex-start; gap:12px;}
.ssBarLeft {flex:1; min-width:0;}
.ssBarSide {display:flex; flex-direction:column; gap:4px; align-items:flex-end; white-space:nowrap;}
.ssBarSide .ssSideRow {display:flex; align-items:center; gap:6px;}
.ssBarSide .ssEid {width:90px;}
.ssBarSide .ssTitleText {width:110px;}
.ssSideNote {font-size:11px; color:#4b6870; min-width:60px;}
.ssHint {color:#4b6870; margin-top:30px;}
.ssShare {text-align:left; margin:6px 0; padding:6px 10px; border:1px solid #9fb8bd; border-radius:3px; background:#f4f9fa; font-size:12px;}
.ssShare textarea {width:100%; box-sizing:border-box; font-family:monospace; font-size:12px; margin:4px 0;}
.ssShareFoot {display:flex; align-items:center; gap:8px;}
`;
    w.document.head.appendChild(w.document.createElement('style')).innerHTML = cssSource;
  }
  buildCSS();

  // ── Filter bar (SMS-USR-062): keyword box, conditions and Search; the option panel stays collapsed ──
  var doc = w.document;
  var matchCountEls = [];
  var filterSyncers = [];
  function updateMatchCount(n) {
    matchCountEls.forEach(function(span) { span.textContent = n + ' match'; });
  }
  function mk(tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function addTextFilter(row, cls, field, placeholder) {
    var box = row.appendChild(mk('input', cls));
    box.type = 'text';
    box.placeholder = placeholder;
    box.value = tabState[field];
    box.addEventListener('input', function() {
      tabState[field] = box.value; // draft only: applied when Search is pressed
    });
    box.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') runSearchFromBar();
    });
    filterSyncers.push(function() { box.value = tabState[field]; });
    return box;
  }
  function addRangeFilter(row, label, minField, maxField, minPh, maxPh) {
    row.appendChild(mk('span', 'ssLbl', label));
    addTextFilter(row, 'ssNum', minField, minPh);
    row.appendChild(mk('span', '', '–'));
    addTextFilter(row, 'ssNum', maxField, maxPh);
  }
  function addSelect(row, field, options, onChange) {
    var sel = row.appendChild(mk('select'));
    options.forEach(function(o) {
      var opt = sel.appendChild(mk('option', '', o[1]));
      opt.value = o[0];
    });
    sel.value = tabState[field];
    sel.addEventListener('change', function() {
      tabState[field] = sel.value;
      if (onChange) onChange(sel.value);
    });
    filterSyncers.push(function() { sel.value = tabState[field]; });
    return sel;
  }
  var chipRegistry = []; // { chip, mapName, key }
  function addChip(container, label, mapName, key) {
    var chip = container.appendChild(mk('button', 'ssChip', label));
    function sync() {
      chip.className = tabState[mapName][key] ? 'ssChip on' : 'ssChip';
    }
    chip.addEventListener('click', function() {
      if (chip.disabled) return;
      tabState[mapName][key] = !tabState[mapName][key];
      // Redraw every chip of this condition: a suffix can appear in more than one group (SMS-USR-079)
      chipRegistry.forEach(function(entry) {
        if (entry.mapName === mapName && entry.key === key) {
          entry.chip.className = tabState[mapName][key] ? 'ssChip on' : 'ssChip';
        }
      });
      refreshChipAvailability();
      updateFilterToggleLabel();
    });
    filterSyncers.push(sync);
    chipRegistry.push({ chip: chip, mapName: mapName, key: key });
    sync();
  }
  // Grey out choices that cannot occur, narrowing Category → Type → Prefix → Suffix → Slot (SMS-USR-066, 079)
  function refreshChipAvailability() {
    function setAvailable(entry, ok) {
      entry.chip.disabled = !ok;
      if (!ok && tabState[entry.mapName][entry.key]) {
        tabState[entry.mapName][entry.key] = false; // a disabled choice cannot stay picked
        entry.chip.className = 'ssChip';
      }
    }
    // Pass 0: Category chips follow the picked Types (strict across sections, SMS-USR-066)
    chipRegistry.forEach(function(entry) {
      if (entry.mapName === 'cats') setAvailable(entry, isCategoryAvailable(tabState, entry.key));
    });
    // Pass 1: Type chips follow Category; types unpicked here must not count in pass 2
    chipRegistry.forEach(function(entry) {
      if (entry.mapName === 'types') setAvailable(entry, isTypeAvailable(tabState, entry.key));
    });
    // Then each later section narrows the possible types for the next one: Prefix → Suffix → Slot (SMS-USR-079).
    // A later pick never greys an earlier section.
    function passFor(mapName, okFn) {
      chipRegistry.forEach(function(entry) {
        if (entry.mapName === mapName) setAvailable(entry, okFn(entry.key));
      });
    }
    var types = availableEquipTypes(tabState);
    passFor('prefixes', function(key) { return isAffixAvailable('prefix', key, types); });
    types = narrowTypesByAffix('prefix', tabState.prefixes, types);
    passFor('suffixes', function(key) { return isAffixAvailable('suffix', key, types); });
    types = narrowTypesByAffix('suffix', tabState.suffixes, types);
    var slotOk = isSlotAvailable(types);
    passFor('slots', function() { return slotOk; });
  }
  function clearEquipFilter() {
    var keep = { keyword: tabState.keyword, useRE: tabState.useRE, sort: tabState.sort, showStats: tabState.showStats };
    tabState = Object.assign(emptyEquipFilter(), keep);
    filterSyncers.forEach(function(fn) { fn(); });
    refreshChipAvailability();
    updateFilterToggleLabel();
  }

  var filterBar = doc.body.appendChild(mk('div', 'ssBar'));
  var barMain = filterBar.appendChild(mk('div', 'ssBarMain'));
  var barLeft = barMain.appendChild(mk('div', 'ssBarLeft'));
  var barRow1 = barLeft.appendChild(mk('div', 'ssBarRow'));
  addTextFilter(barRow1, 'ssKeyword', 'keyword', 'Keyword, e.g. pha elem (empty = all lines)');
  var reLabel = barRow1.appendChild(mk('label'));
  reLabel.title = 'Use regular expression in the keyword box';
  var reCbox = reLabel.appendChild(mk('input'));
  reCbox.type = 'checkbox';
  reCbox.checked = tabState.useRE;
  reCbox.addEventListener('change', function() { tabState.useRE = reCbox.checked; });
  filterSyncers.push(function() { reCbox.checked = tabState.useRE; });
  reLabel.appendChild(doc.createTextNode('RegEx'));
  var helpBtn = barRow1.appendChild(mk('button', 'ssBtn', '?'));
  helpBtn.title = 'Keyword syntax and examples';
  var helpPanel = filterBar.appendChild(buildSyntaxHelp(doc));
  helpBtn.addEventListener('click', function() {
    helpPanel.style.display = helpPanel.style.display === 'none' ? 'block' : 'none';
  });
  var filterToggle = barRow1.appendChild(mk('button', 'ssBtn ssBtnDark'));
  var qualitySel = addSelect(barRow1, 'quality', [['', 'All qualities']].concat(EQUIP_QUALITIES.map(function(q) { return [q, q]; })), null);
  addRangeFilter(barRow1, 'Level', 'levelMin', 'levelMax', 'min', 'max');
  addRangeFilter(barRow1, 'Price', 'priceMin', 'priceMax', 'min', 'max');
  addRangeFilter(barRow1, 'ROLL %', 'rollMin', 'rollMax', '0', '100');

  var barRow2 = barLeft.appendChild(mk('div', 'ssBarRow'));
  var sortSel = addSelect(barRow2, 'sort', [
    ['', 'Sort: post edited (newest)'],
    ['price-desc', 'Price: high to low'],
    ['price-asc', 'Price: low to high'],
    ['level-desc', 'Level: high to low'],
    ['level-asc', 'Level: low to high'],
    ['roll-desc', 'ROLL %: high to low'],
    ['roll-asc', 'ROLL %: low to high']
  ], function(mode) {
    if (applySortHook) applySortHook(mode); // re-orders the current results only, no new search
  });
  var barClear = barRow2.appendChild(mk('button', 'ssBtn', 'Clear filters'));
  barClear.addEventListener('click', clearEquipFilter);
  var barSearch = barRow2.appendChild(mk('button', 'ssBtn ssBtnDark', 'Search'));
  barSearch.title = 'Search the database with the conditions above';
  barSearch.addEventListener('click', runSearchFromBar);
  // Show Stats (SMS-USR-069): toggles the Quality / Type / PAB / ROLL % / Score columns, no new search
  var statsBtn = barRow2.appendChild(mk('button', 'ssBtn', 'Show Stats'));
  statsBtn.addEventListener('click', function() {
    tabState.showStats = !tabState.showStats;
    resultsDiv.className = tabState.showStats ? 'showStats' : '';
    statsBtn.textContent = tabState.showStats ? 'Hide Stats' : 'Show Stats';
  });
  var barCount = barRow2.appendChild(mk('b', 'ssLbl'));
  matchCountEls.push(barCount);

  // Top-right: Lowest EID and thread-title filter, applied when Search is pressed (SMS-USR-068)
  var barSide = barMain.appendChild(mk('div', 'ssBarSide'));
  var eidRow = barSide.appendChild(mk('div', 'ssSideRow'));
  // Filter import / export (SMS-USR-086), left of Lowest EID; the text box opens under the bar
  var exportBtn = eidRow.appendChild(mk('button', 'ssBtn', 'Export'));
  exportBtn.title = 'Copy these search conditions as text, to keep or share';
  var importBtn = eidRow.appendChild(mk('button', 'ssBtn', 'Import'));
  importBtn.title = 'Paste conditions made by Export, then search';
  eidRow.appendChild(mk('span', '', 'Lowest EID'));
  var lowestEidInput = eidRow.appendChild(mk('input', 'ssEid'));
  lowestEidInput.type = 'text';
  lowestEidInput.value = forum === '90' ? '0' : String(lowestEid);
  var filterEidResult = eidRow.appendChild(mk('span', 'ssSideNote'));
  var titleRow = barSide.appendChild(mk('div', 'ssSideRow'));
  titleRow.appendChild(mk('span', '', 'Thread title'));
  var threadModeSel = titleRow.appendChild(mk('select'));
  [['0', 'Any'], ['1', 'Includes'], ['-1', 'Excludes']].forEach(function(o) {
    var opt = threadModeSel.appendChild(mk('option', '', o[1]));
    opt.value = o[0];
  });
  threadModeSel.value = String(include);
  var filterThreadInput = titleRow.appendChild(mk('input', 'ssTitleText'));
  filterThreadInput.type = 'text';
  filterThreadInput.value = 'auction';
  var filterThreadResult = titleRow.appendChild(mk('span', 'ssSideNote'));
  [lowestEidInput, filterThreadInput].forEach(function(box) {
    box.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') runSearchFromBar();
    });
  });

  var sharePanel = filterBar.appendChild(mk('div', 'ssShare'));
  sharePanel.style.display = 'none';
  var shareNote = sharePanel.appendChild(mk('div'));
  var shareText = sharePanel.appendChild(mk('textarea'));
  shareText.rows = 3;
  shareText.spellcheck = false;
  var shareFoot = sharePanel.appendChild(mk('div', 'ssShareFoot'));
  var shareApply = shareFoot.appendChild(mk('button', 'ssBtn ssBtnDark', 'Apply and search'));
  var shareClose = shareFoot.appendChild(mk('button', 'ssBtn', 'Close'));
  var shareStatus = shareFoot.appendChild(mk('span', 'ssSideNote'));
  function setShareStatus(text, isError) {
    shareStatus.textContent = text;
    shareStatus.style.color = isError ? 'red' : '';
  }
  function isShareValueAllowed(field, value) {
    if (field === 'quality' || field === 'sort') {
      var sel = field === 'quality' ? qualitySel : sortSel;
      return Array.prototype.some.call(sel.options, function(o) { return o.value === value; });
    }
    return chipRegistry.some(function(entry) { return entry.mapName === field && entry.key === value; });
  }
  exportBtn.addEventListener('click', function() {
    var text = exportFilterText(tabState);
    shareNote.textContent = 'Copy this line to keep or share the conditions above (Lowest EID and thread title are not included).';
    shareText.value = text;
    shareApply.style.display = 'none';
    sharePanel.style.display = 'block';
    shareText.focus();
    shareText.select();
    setShareStatus('Press Ctrl+C to copy', false);
    var clip = w.navigator && w.navigator.clipboard;
    if (clip && clip.writeText) {
      clip.writeText(text).then(function() { setShareStatus('Copied to clipboard', false); }, function() {});
    }
  });
  importBtn.addEventListener('click', function() {
    shareNote.textContent = 'Paste a line made by Export. It replaces the conditions above, then searches.';
    shareText.value = '';
    shareApply.style.display = '';
    sharePanel.style.display = 'block';
    setShareStatus('', false);
    shareText.focus();
  });
  shareClose.addEventListener('click', function() { sharePanel.style.display = 'none'; });
  shareApply.addEventListener('click', function() {
    var result;
    try {
      result = parseFilterText(shareText.value, isShareValueAllowed);
    } catch (importErr) {
      setShareStatus(importErr && importErr.message ? importErr.message : String(importErr), true);
      return;
    }
    tabState = Object.assign(result.filter, { showStats: tabState.showStats });
    filterSyncers.forEach(function(fn) { fn(); });
    refreshChipAvailability();
    updateFilterToggleLabel();
    if (result.skipped.length) {
      setShareStatus('Imported; not found in this version and skipped: ' + result.skipped.join(', '), true);
    } else {
      sharePanel.style.display = 'none';
    }
    runSearchFromBar();
  });

  var filterPanel = filterBar.appendChild(mk('div', 'ssPanel'));
  filterPanel.style.display = 'none';
  var panelBody = filterPanel.appendChild(mk('div', 'ssPanelBody'));
  function addSection(title) {
    var sec = panelBody.appendChild(mk('div', 'ssSection'));
    sec.appendChild(mk('div', 'ssSectionTitle', title));
    return sec;
  }
  function addGroup(sec, label) {
    var group = sec.appendChild(mk('div', 'ssGroup'));
    group.appendChild(mk('span', 'ssGroupLabel', label));
    return group;
  }
  var catSec = addSection('Category');
  var catRow = catSec.appendChild(mk('div', 'ssGroup'));
  EQUIP_CATEGORIES.forEach(function(c) { addChip(catRow, c.label, 'cats', c.key); });
  var typeSec = addSection('Type');
  EQUIP_CATEGORIES.forEach(function(c) {
    var g = addGroup(typeSec, c.label);
    c.types.forEach(function(t) { addChip(g, t, 'types', t); });
  });
  // Section order follows the narrowing order Category → Type → Prefix → Suffix → Slot → Primary attributes (SMS-USR-079)
  var prefixSec = addSection('Prefix');
  EQUIP_PREFIX_GROUPS.forEach(function(pg) {
    var g = addGroup(prefixSec, pg.label);
    pg.items.forEach(function(p) { addChip(g, p, 'prefixes', p); });
  });
  addChip(addGroup(prefixSec, ''), 'No prefix', 'prefixes', EQUIP_NONE);
  var suffixSec = addSection('Suffix');
  EQUIP_SUFFIX_GROUPS.forEach(function(sg) {
    var g = addGroup(suffixSec, sg.label);
    sg.items.forEach(function(sx) { addChip(g, sx, 'suffixes', sx); });
  });
  addChip(addGroup(suffixSec, ''), 'No suffix', 'suffixes', EQUIP_NONE);
  var slotSec = addSection('Slot');
  var slotRow = slotSec.appendChild(mk('div', 'ssGroup'));
  EQUIP_SLOTS.forEach(function(sl) { addChip(slotRow, sl.label, 'slots', sl.label); });
  // Unlike the other sections, every picked primary attribute must be present (SMS-USR-063)
  var statsSec = addSection('Primary attributes (must have all picked)');
  var statsRow = statsSec.appendChild(mk('div', 'ssGroup'));
  EQUIP_PRIMARY_STATS.forEach(function(st) { addChip(statsRow, st, 'stats', st); });

  var panelFoot = filterPanel.appendChild(mk('div', 'ssPanelFoot'));
  matchCountEls.push(panelFoot.appendChild(mk('b')));
  panelFoot.appendChild(mk('span', '', 'Several in one section = any of them; different sections must all match'));
  panelFoot.appendChild(mk('span', 'ssSpacer'));
  var panelClear = panelFoot.appendChild(mk('button', 'ssBtn', 'Clear filters'));
  panelClear.addEventListener('click', clearEquipFilter);
  var panelDone = panelFoot.appendChild(mk('button', 'ssBtn', 'Done'));
  var panelSearch = panelFoot.appendChild(mk('button', 'ssBtn ssBtnDark', 'Search'));
  panelSearch.addEventListener('click', runSearchFromBar);

  function updateFilterToggleLabel() {
    var picks = 0;
    ['cats', 'types', 'slots', 'prefixes', 'suffixes', 'stats'].forEach(function(m) {
      Object.keys(tabState[m]).forEach(function(k) { if (tabState[m][k]) picks++; });
    });
    filterToggle.textContent = 'Equipment filter' + (picks ? ' (' + picks + ')' : '') + (filterPanel.style.display === 'none' ? ' ▾' : ' ▴');
  }
  filterToggle.addEventListener('click', function() {
    filterPanel.style.display = filterPanel.style.display === 'none' ? 'flex' : 'none';
    updateFilterToggleLabel();
  });
  panelDone.addEventListener('click', function() {
    filterPanel.style.display = 'none';
    updateFilterToggleLabel();
  });
  refreshChipAvailability();
  updateFilterToggleLabel();

  var resultsDiv = doc.body.appendChild(mk('div'));
  function showResultsMessage(text, isError) {
    resultsDiv.innerHTML = '';
    var h = resultsDiv.appendChild(mk('h3', isError ? '' : 'ssHint', text));
    if (isError) h.style.color = 'red';
  }

  function runSearchFromBar() {
    filterPanel.style.display = 'none';
    updateFilterToggleLabel();
    runSearch();
  }

  if (runNow)
    runSearch();
  else
    showResultsMessage('Set the conditions above, then press Search.', false);

  // Search the database with this tab's current conditions (SMS-USR-062): keyword AND equipment conditions
  function runSearch() {
  if (inProgress !== false || isUpdatingDb) {
    showResultsMessage('Another transaction is in progress, please wait and press Search again', true);
    return;
  }
  var popupQuery = String(tabState.keyword || '').trim();
  if (popupQuery.length > 0 && popupQuery.length < 3) {
    showResultsMessage('Keyword is too short: use at least 3 characters, or leave it empty', true);
    return;
  }
  var matcher = null; // null = empty keyword: every line with an equipment link matches (SMS-USR-061)
  try {
    matcher = buildKeywordMatcher(popupQuery, tabState.useRE === true); // fuzzy unless RegEx (SMS-USR-082)
  } catch (regexErr) {
    showResultsMessage('Invalid regular expression: ' + (regexErr && regexErr.message ? regexErr.message : String(regexErr)), true);
    return;
  }
  if (ignoredDiv && ignoredDiv.parentNode) ignoredDiv.parentNode.removeChild(ignoredDiv);
  ignoredDiv = null;
  updateTabTitle();
  include = parseInt(threadModeSel.value, 10) || 0;
  if (forum !== '90') {
    lowestEid = lowestEidInput.value;
    updateStorage();
  }
  var wtsRules = WTS_RULE_FORUMS.indexOf(forum) !== -1;
  var f = JSON.parse(JSON.stringify(tabState)); // conditions of this search
  var filterActive = equipFilterIsActive(f);
  applySortHook = null;
  showResultsMessage('Searching...', false);
  updateMatchCount('…');

  dbGet(function(obj) {
    SmartSearch = obj;
    if (!SmartSearch[forum]) SmartSearch[forum] = {};
    if (!SmartSearch.savedEquips) SmartSearch.savedEquips = {};
    if (!SmartSearch.ignored) SmartSearch.ignored = { threads: {}, posts: {} };
    resultsDiv.innerHTML = '';

    var navStrip = document.getElementById('navstrip');
    var navText = navStrip ? navStrip.textContent : ('Forum ' + forumLabel);
    resultsDiv.appendChild(w.document.createElement('h3')).textContent = navText + ':\n' + Object.keys(SmartSearch[forum]).length + ' threads saved in ' + forumLabel + ' database';
    var resultsCountDiv = resultsDiv.appendChild(w.document.createElement('div'));
    function resetStatsToggle() {} // stats are columns now (SMS-USR-069): sorting no longer has info rows to drop

    function hide() {
      var activeLowest = parseInt(lowestEidInput.value, 10);
      if (isNaN(activeLowest)) {
        filterEidResult.textContent = 'lowestEid is not an integer';
        return;
      }
      var hideEidCount = 0;
      var hideTitleCount = 0;
      var shownCount = 0;
      [].forEach.call(table.getElementsByTagName('tr'), function(tr) {
        if (tr.children[0].tagName === 'TH' || tr.className === 'info')
          return;
        tr.style.display = '';
        var eid = parseInt(tr.children[2].textContent, 10);
        // Plain-text lines without equipment URLs have empty eid (isNaN), so they are NEVER hidden by lowestEid
        if (!isNaN(eid) && eid < activeLowest) {
          tr.style.display = 'none';
          hideEidCount++;
        }
        if (filterThreadInput.value) {
          var filterVal = filterThreadInput.value.toLowerCase();
          if (include === -1 && tr.children[1].textContent.toLowerCase().indexOf(filterVal) !== -1) {
            tr.style.display = 'none';
            hideTitleCount++;
          } else if (include === 1 && tr.children[1].textContent.toLowerCase().indexOf(filterVal) === -1) {
            tr.style.display = 'none';
            hideTitleCount++;
          }
        }
        if (tr.style.display !== 'none') shownCount++;
      });
      if (hideEidCount === 0)
        filterEidResult.textContent = '';
      else
        filterEidResult.textContent = hideEidCount + ' hidden';
      if (hideTitleCount === 0) {
        filterThreadResult.textContent = '0 hidden';
        filterThreadResult.style.visibility = 'hidden';
      } else {
        filterThreadResult.style.visibility = '';
        filterThreadResult.textContent = hideTitleCount + ' hidden';
      }
      updateMatchCount(shownCount);
    }


    var table = resultsDiv.appendChild(w.document.createElement('table'));
    table.className = 'main';
    table.appendChild(w.document.createElement('thead')).innerHTML = '<tr><th>Poster</th><th>Thread</th><th>eid</th><th>Price</th><th>Level</th><th>Line content</th><th>Thread saved</th><th>Post edited</th><th class="st">Quality</th><th class="st">Type</th><th class="st">PAB</th><th class="st">ROLL %</th><th class="st">Base avg</th><th>Ignore</th></tr>';
    resultsDiv.className = tabState.showStats ? 'showStats' : '';
    var tbody = table.appendChild(w.document.createElement('tbody'));
    var now = Date.now();
    var resultsCount = 0;
    Object.keys(SmartSearch[forum]).forEach(function(threadId) {
      if (threadId === 'ignored' || Object.keys(SmartSearch.ignored.threads).indexOf(threadId) !== -1)
        return;
      var thread = SmartSearch[forum][threadId];
      if (!thread || !Array.isArray(thread.posts))
        return;
      if (thread.locked && hideLocked)
        return;
      // Client-side pinned & UID exclusions from Settings (SMS-USR-050)
      if (isThreadExcludedBySettings(thread))
        return;

      thread.posts.forEach(function(post) {
        if (Object.keys(SmartSearch.ignored.posts).indexOf(post.postId) !== -1)
          return;
        var lines = (post.postText || '').split('\n');
        var lineStartsWithStrikethrough = false;
        lines.forEach(function(line) {
          var prevStartsWithS = lineStartsWithStrikethrough;
          var openIdx = line.lastIndexOf('[s]');
          var closeIdx = line.lastIndexOf('[/s]');
          var lineEndsWithStrikethrough = prevStartsWithS;
          if (openIdx !== -1 || closeIdx !== -1) {
            lineEndsWithStrikethrough = openIdx > closeIdx;
          }
          lineStartsWithStrikethrough = lineEndsWithStrikethrough;
          if (matcher === null ? !getEquipFromLink(line) : !matcher(line)) {
            return;
          }
          if (!showStrikeouts && (prevStartsWithS || lineEndsWithStrikethrough || openIdx !== -1)) {
            return;
          }
          // WTS: equipment URL required, Tradeable only, held by the thread's poster (SMS-USR-067)
          if (wtsRules && !passesWtsRules(line, thread, SmartSearch.savedEquips)) return;
          if (filterActive) {
            var lineEquip = getEquipFromLink(line);
            var lineItem = lineEquip ? SmartSearch.savedEquips[lineEquip.eid] : null;
            if (!matchEquipFilter(f, describeEquip(lineItem), parsePriceAmount(linePriceText(line)))) return;
          }
          resultsCount++;
          var tr = tbody.appendChild(w.document.createElement('tr'));
          tr.appendChild(w.document.createElement('td')).textContent = thread.opName;
          var titleTd = tr.appendChild(w.document.createElement('td'));

          const a = w.document.createElement('a');
          a.href = 'https://forums.e-hentai.org/index.php?showtopic=' + threadId + '&view=findpost&p=' + post.postId;
          a.textContent = thread.title;
          a.onclick = linkClickPopup;
          titleTd.appendChild(a);

          titleTd.title = thread.title;
          if (/close/i.test(thread.title) || /delete/i.test(thread.title) || /end/i.test(thread.title) || /done/i.test(thread.title))
            tr.className = 'ended';
          var eidTd = tr.appendChild(w.document.createElement('td'));
          var equip = getEquipFromLink(line);
          if (equip && equip.eid)
            eidTd.textContent = equip.eid;
          var priceText = linePriceText(line);
          tr.appendChild(w.document.createElement('td')).textContent = priceText;
          var priceAmount = parsePriceAmount(priceText);
          tr.dataset.price = priceAmount === null ? '' : String(priceAmount);
          tr.appendChild(w.document.createElement('td'));

          let itemEl = tr.appendChild(w.document.createElement('td'));
          appendSafePostLine(w.document, itemEl, line, prevStartsWithS);

          var warn1 = false;
          var warn2 = false;
          var agoObj = ago(thread.dateSaved);
          tr.appendChild(w.document.createElement('td')).textContent = agoObj[0];
          warn1 = agoObj[1];
          agoObj = ago(post.lastEdited);
          tr.dataset.edited = post.lastEdited;
          tr.appendChild(w.document.createElement('td')).textContent = agoObj[0];
          warn2 = agoObj[1];
          if (warn1 || warn2)
            tr.className = 'warn';
          for (var sc = 0; sc < 5; sc++) tr.appendChild(w.document.createElement('td')).className = 'st';
          var ignoreBtn = tr.appendChild(w.document.createElement('td')).appendChild(w.document.createElement('button'));
          ignoreBtn.textContent = 'Ignore';
          ignoreBtn.addEventListener('click', function() {
            makeIgnoreInterface(threadId, post, line);
          });
        });
      });
    });
    resultsCountDiv.textContent = resultsCount + ' results';
    hide();

    function refreshLevels() {
      [].slice.call(tbody.children).forEach(function(tr) {
        if (!tr.children || tr.children.length < 6 || tr.className === 'info') return;
        var a = tr.children[5].getElementsByTagName('a');
        if (a.length === 0)
          return;
        var equip = getEquipFromLink(a[0].href);
        if (!equip)
          return;
        var item = SmartSearch.savedEquips && SmartSearch.savedEquips[equip.eid];
        if (!item)
          return;
        tr.children[4].textContent = item.level || '';
        statCellTexts(item).forEach(function(text, i) {
          if (tr.children[8 + i]) tr.children[8 + i].textContent = text;
        });
      });
    }

    refreshLevels();

    function ago(num) {
      if (!num || isNaN(num) || num <= 0)
        return ['Unknown', true];
      var daysAgo = Math.round((now - num) / (1000 * 3600 * 24));
      if (daysAgo < 364) {
        if (daysAgo < daysAgoLimit)
          return [daysAgo + ' days ago', false];
        else
          return [daysAgo + ' days ago', true];
      } else
        return [Math.round(daysAgo / 36.5) / 10 + ' years ago', 1];
    }

    // Sort by level
    table.children[0].children[0].children[4].addEventListener('click', function() {
      resetStatsToggle();
      var trs = [];
      for (var i = table.children[1].children.length - 1; i >= 0; i--) {
        var tr = table.children[1].children[i];
        if (tr.className !== 'info')
          trs.push(tr);
        table.children[1].removeChild(tr);
      }
      trs.sort(function(a, b) {
        return levelValue(b.children[4].textContent) - levelValue(a.children[4].textContent);
      });
      function levelValue(levelText) {
        if (levelText === 'Error')
          return -4;
        else if (levelText === 'No such item')
          return -3;
        else if (levelText === 'Soulbound' || levelText === 'Untradeable')
          return -2;
        else if (!levelText)
          return -1;
        else if (levelText === 'Unassigned')
          return 501;
        var parsedLvl = parseInt(levelText, 10);
        if (isNaN(parsedLvl))
          return -4;
        return 500 - parsedLvl;
      }
      trs.forEach(function(tr) {
        table.children[1].appendChild(tr);
      });
    });

    // Sort by price
    table.children[0].children[0].children[3].addEventListener('click', function() {
      resetStatsToggle();
      var trs = [];
      for (var i = table.children[1].children.length - 1; i >= 0; i--) {
        var tr = table.children[1].children[i];
        if (tr.className !== 'info')
          trs.push(tr);
        table.children[1].removeChild(tr);
      }
      trs.sort(function(a, b) {
        return priceValue(b.children[3].textContent) - priceValue(a.children[3].textContent);
      });
      function priceValue(priceText) {
        if (!priceText)
          return -999999;
        priceText = priceText.replace(/,/g, '').toLowerCase();
        var priceNumber;
        try {
          priceNumber = priceText.match(/\d+\.?(\d+)?/)[0];
        } catch (err) {
          return -499999;
        }
        if (priceText.substring(priceText.length - 1) === 'k')
          priceNumber *= 1000;
        else if (priceText.substring(priceText.length - 1) === 'm')
          priceNumber *= 1000000;
        return priceNumber / 1000000;
      }
      trs.forEach(function(tr) {
        table.children[1].appendChild(tr);
      });
    });

    // Sort by eid
    table.children[0].children[0].children[2].addEventListener('click', function() {
      resetStatsToggle();
      var trs = [];
      for (var i = table.children[1].children.length - 1; i >= 0; i--) {
        var tr = table.children[1].children[i];
        if (tr.className !== 'info')
          trs.push(tr);
        table.children[1].removeChild(tr);
      }
      trs.sort(function(a, b) {
        return parseInt(b.children[2].textContent || 0, 10) - parseInt(a.children[2].textContent || 0, 10);
      });
      trs.forEach(function(tr) {
        table.children[1].appendChild(tr);
      });
    });

    // Sort by date
    table.children[0].children[0].children[7].addEventListener('click', function() {
      resetStatsToggle();
      var trs = [];
      for (var i = table.children[1].children.length - 1; i >= 0; i--) {
        var tr = table.children[1].children[i];
        if (tr.className !== 'info')
          trs.push(tr);
        table.children[1].removeChild(tr);
      }
      trs.sort(function(a, b) {
        return parseInt(b.dataset.edited || 0, 10) - parseInt(a.dataset.edited || 0, 10);
      });
      trs.forEach(function(tr) {
        table.children[1].appendChild(tr);
      });
    });
    function applySort(mode) {
      resetStatsToggle();
      var trs = [];
      [].slice.call(tbody.children).forEach(function(tr) {
        tbody.removeChild(tr);
        if (tr.className !== 'info') trs.push(tr);
      });
      function sortKey(tr) {
        if (mode.indexOf('price') === 0)
          return tr.dataset.price ? Number(tr.dataset.price) : null;
        if (mode.indexOf('level') === 0) {
          var lvl = tr.children[4] ? tr.children[4].textContent : '';
          return /^\d+$/.test(lvl) ? parseInt(lvl, 10) : null;
        }
        if (mode.indexOf('roll') === 0) {
          var rowEid = tr.children[2] ? tr.children[2].textContent : '';
          var d = rowEid ? describeEquip(SmartSearch.savedEquips[rowEid]) : null;
          return d ? d.pct : null;
        }
        if (mode.indexOf('avg') === 0) {
          var av = tr.children[12] ? parseFloat(tr.children[12].textContent) : NaN;
          return isNaN(av) ? null : av;
        }
        if (mode.indexOf('quality') === 0) {
          var qi = EQUIP_QUALITIES.indexOf(tr.children[8] ? tr.children[8].textContent : '');
          return qi === -1 ? null : EQUIP_QUALITIES.length - qi; // Peerless first
        }
        return parseInt(tr.dataset.edited || 0, 10) || null; // default: post edited, newest first
      }
      var asc = /-asc$/.test(mode);
      trs.sort(function(a, b) {
        var ka = sortKey(a), kb = sortKey(b);
        if (ka === null && kb === null) return 0;
        if (ka === null) return 1; // rows without a value always go last
        if (kb === null) return -1;
        return asc ? ka - kb : kb - ka;
      });
      trs.forEach(function(tr) { tbody.appendChild(tr); });
    }

    // Stats column headers sort high to low (SMS-USR-069)
    [[8, 'quality-desc'], [11, 'roll-desc'], [12, 'avg-desc']].forEach(function(hs) {
      table.children[0].children[0].children[hs[0]].addEventListener('click', function() { applySort(hs[1]); });
    });
    table.children[0].children[0].children[7].click();
    applySortHook = applySort;
    if (f.sort) applySort(f.sort);
  }, function(dbErr) {
    resultsDiv.innerHTML = '';
    var dbErrHeading = resultsDiv.appendChild(w.document.createElement('h3'));
    dbErrHeading.style.color = 'red';
    dbErrHeading.textContent = 'Failed to open IndexedDB for ' + forumLabel + ': ' + (dbErr && dbErr.message ? dbErr.message : 'Database error');
  });
  } // end runSearch

  var ignoredDiv;
  function makeIgnoreInterface(threadId, post, str) {
    if (ignoredDiv)
      return;

    var thread = SmartSearch && SmartSearch[forum] && SmartSearch[forum][threadId];
    if (!thread)
      return;

    ignoredDiv = w.document.body.insertBefore(w.document.createElement('div'), w.document.body.children[0]);
    ignoredDiv.className = 'ignoredDiv';

    function runFreshDbMutation(btn, defaultLabel, mutatorFn, onDone) {
      if (inProgress !== false || isUpdatingDb) {
        btn.textContent = 'Another transaction is in progress, please wait';
        setTimeout(function() {
          btn.textContent = defaultLabel;
        }, 1500);
        return;
      }
      function onDbErr() {
        btn.textContent = 'Database error, please retry';
        setTimeout(function() {
          btn.textContent = defaultLabel;
        }, 2000);
      }
      dbGet(function(freshObj) {
        if (!freshObj.ignored) freshObj.ignored = { threads: {}, posts: {} };
        if (!freshObj.ignored.threads) freshObj.ignored.threads = {};
        if (!freshObj.ignored.posts) freshObj.ignored.posts = {};
        if (!freshObj[forum]) freshObj[forum] = {};
        mutatorFn(freshObj);
        dbSet(freshObj, function() {
          SmartSearch = freshObj;
          onDone();
        }, onDbErr);
      }, onDbErr);
    }

    var addToIgnoredThreads = ignoredDiv.appendChild(w.document.createElement('button'));
    var ignoreThreadLabel = 'Always ignore thread by ' + thread.opName + ' titled "' + thread.title + '"?';
    addToIgnoredThreads.textContent = ignoreThreadLabel;
    addToIgnoredThreads.addEventListener('click', function() {
      runFreshDbMutation(addToIgnoredThreads, ignoreThreadLabel, function(freshObj) {
        freshObj.ignored.threads[thread.threadId] = thread;
      }, reopenCurrentSearch);
    });
    ignoredDiv.appendChild(w.document.createElement('br'));
    ignoredDiv.appendChild(w.document.createElement('br'));

    var addToIgnoredPosts = ignoredDiv.appendChild(w.document.createElement('button'));
    str = str.replace(/<\/?[^>]+(>|$)/g, '');
    var ignorePostLabel = 'Always ignore the post in this thread that includes "' + str + '"?';
    addToIgnoredPosts.textContent = ignorePostLabel;
    addToIgnoredPosts.addEventListener('click', function() {
      var ignoredPost = { postId: post.postId, threadId: thread.threadId, opName: thread.opName, title: thread.title, str: str };
      runFreshDbMutation(addToIgnoredPosts, ignorePostLabel, function(freshObj) {
        freshObj.ignored.posts[post.postId] = ignoredPost;
      }, reopenCurrentSearch);
    });
    ignoredDiv.appendChild(w.document.createElement('br'));
    ignoredDiv.appendChild(w.document.createElement('br'));

    var deleteFromDb = ignoredDiv.appendChild(w.document.createElement('button'));
    var deleteThreadLabel = 'Completely remove this thread from the database?';
    deleteFromDb.textContent = deleteThreadLabel;
    deleteFromDb.addEventListener('click', function() {
      runFreshDbMutation(deleteFromDb, deleteThreadLabel, function(freshObj) {
        if (freshObj[forum]) delete freshObj[forum][threadId];
      }, reopenCurrentSearch);
    });

    ignoredDiv.appendChild(w.document.createElement('br'));
    ignoredDiv.appendChild(w.document.createElement('br'));

    ignoredDiv.appendChild(w.document.createElement('span')).textContent = 'Ignored threads';
    var ignoredThreadsTable = ignoredDiv.appendChild(w.document.createElement('table'));
    Object.keys(SmartSearch.ignored.threads).forEach(function(tId) {
      var ignoredThread = SmartSearch.ignored.threads[tId];
      var tr = ignoredThreadsTable.appendChild(w.document.createElement('tr'));
      tr.appendChild(w.document.createElement('td')).textContent = ignoredThread.opName;
      var ignoredThreadTd = tr.appendChild(w.document.createElement('td'));
      var ignoredThreadLink = ignoredThreadTd.appendChild(w.document.createElement('a'));
      ignoredThreadLink.href = 'https://forums.e-hentai.org/index.php?showtopic=' + encodeURIComponent(ignoredThread.threadId);
      ignoredThreadLink.textContent = ignoredThread.title;
      var removeIgnoreButton = tr.appendChild(w.document.createElement('td')).appendChild(w.document.createElement('button'));
      removeIgnoreButton.textContent = 'Remove from ignoredThreads';
      removeIgnoreButton.addEventListener('click', function() {
        runFreshDbMutation(removeIgnoreButton, 'Remove from ignoredThreads', function(freshObj) {
          if (freshObj.ignored && freshObj.ignored.threads) delete freshObj.ignored.threads[tId];
        }, function() {
          if (tr.parentNode === ignoredThreadsTable) ignoredThreadsTable.removeChild(tr);
        });
      });
    });
    ignoredDiv.appendChild(w.document.createElement('br'));
    ignoredDiv.appendChild(w.document.createElement('br'));

    ignoredDiv.appendChild(w.document.createElement('span')).textContent = 'Ignored posts';
    var ignoredPostsTable = ignoredDiv.appendChild(w.document.createElement('table'));
    ignoredPostsTable.className = 'ignoredPosts';
    Object.keys(SmartSearch.ignored.posts).forEach(function(postId) {
      var ignoredPost = SmartSearch.ignored.posts[postId];
      var tr = ignoredPostsTable.appendChild(w.document.createElement('tr'));
      tr.appendChild(w.document.createElement('td')).textContent = ignoredPost.opName;
      var ignoredPostTd = tr.appendChild(w.document.createElement('td'));
      var ignoredPostLink = ignoredPostTd.appendChild(w.document.createElement('a'));
      ignoredPostLink.href = 'https://forums.e-hentai.org/index.php?showtopic=' + encodeURIComponent(ignoredPost.threadId) + '&view=findpost&p=' + encodeURIComponent(ignoredPost.postId);
      ignoredPostLink.textContent = ignoredPost.title;

      var removeIgnoreButton = tr.appendChild(w.document.createElement('td')).appendChild(w.document.createElement('button'));
      removeIgnoreButton.textContent = 'Remove from ignoredPosts';
      removeIgnoreButton.addEventListener('click', function() {
        runFreshDbMutation(removeIgnoreButton, 'Remove from ignoredPosts', function(freshObj) {
          if (freshObj.ignored && freshObj.ignored.posts) delete freshObj.ignored.posts[postId];
        }, function() {
          if (tr.parentNode === ignoredPostsTable) ignoredPostsTable.removeChild(tr);
        });
      });

      tr.appendChild(w.document.createElement('td')).textContent = '...' + ignoredPost.str.substring(0, 80) + '...';
    });
    ignoredDiv.appendChild(w.document.createElement('br'));
    ignoredDiv.appendChild(w.document.createElement('br'));

    var close = ignoredDiv.appendChild(w.document.createElement('button'));
    close.textContent = 'Close';
    close.addEventListener('click', function() {
      w.document.body.removeChild(ignoredDiv);
      ignoredDiv = null;
    });
    ignoredDiv.appendChild(w.document.createElement('br'));
    ignoredDiv.appendChild(w.document.createElement('br'));

    var reload = ignoredDiv.appendChild(w.document.createElement('button'));
    reload.textContent = 'Reload interface';
    reload.addEventListener('click', function() {
      reopenCurrentSearch();
    });
    w.scrollTo(0, 0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-Forum Cloud DB Update & Settings Bar Buttons (SMS-USR-020 ~ 040)
// ─────────────────────────────────────────────────────────────────────────────

function formatVersionLabel(v) {
  if (!v || v.length !== 14) return v || 'Not downloaded';
  return v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8) + ' ' + v.slice(8, 10) + ':' + v.slice(10, 12);
}

// The database is only downloaded when the user clicks this button; its label shows the version in use (SMS-USR-021, 023)
var updateDbBtn = searchDiv.appendChild(document.createElement('button'));
updateDbBtn.style.marginLeft = '20px';
updateDbBtn.title = 'Click to download the latest ' + forumLabel + ' database from GitHub Releases (skipped when already up to date)';
updateDbBtn.addEventListener('click', function() {
  updateCurrentForumDatabase();
});

function refreshDbButtonLabel() {
  var curVer = (settings.forumVersions && settings.forumVersions[forum]) || '';
  updateDbBtn.textContent = 'Update Database (' + (curVer ? 'v' + formatVersionLabel(curVer) : 'not downloaded') + ')';
}
refreshDbButtonLabel();

var settingsBtn = searchDiv.appendChild(document.createElement('button'));
settingsBtn.textContent = '⚙️ Settings';
settingsBtn.style.marginLeft = '10px';
settingsBtn.addEventListener('click', function() {
  openSettingsModal();
});

var statusSpan = searchDiv.appendChild(document.createElement('span'));
statusSpan.style.marginLeft = '12px';
statusSpan.style.fontSize = '12px';

function updateStatusSpan(extraMsg) {
  var modeLabel = settings.syncMode === 'full' ? 'Full Rebuild' : 'Incremental';
  statusSpan.textContent = forumLabel + ' DB [' + modeLabel + ']' + (extraMsg ? ' — ' + extraMsg : '');
}
updateStatusSpan();

function getForumAssetUrl(forumId) {
  var assetName = 'SmartSearch_' + forumId + '.json';
  if (settings.customBaseUrl && settings.customBaseUrl.trim()) {
    return settings.customBaseUrl.trim().replace(/\/+$/, '') + '/' + assetName;
  }
  var repo = (settings.githubRepo || DEFAULT_SETTINGS.githubRepo).trim();
  // GitHub's own "latest release" link: every combined release carries all boards (SMS-EXP-051, 043)
  return 'https://github.com/' + repo + '/releases/latest/download/' + assetName;
}

// gzip copies of the board files (SMS-EXP-054) need the browser's DecompressionStream
function canGunzip() {
  return typeof DecompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function';
}

async function gunzipToText(buffer) {
  var stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

function fetchJsonViaGM(url, gz) {
  return new Promise(function(resolve, reject) {
    var bustUrl = url + (url.indexOf('?') === -1 ? '?' : '&') + '_t=' + Date.now();
    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({
        method: 'GET',
        url: bustUrl,
        headers: { 'Accept': gz ? 'application/gzip, application/octet-stream' : 'application/json' },
        responseType: gz ? 'arraybuffer' : undefined,
        timeout: 30000,
        onload: function(resp) {
          if (resp.status >= 200 && resp.status < 300) {
            if (gz) {
              gunzipToText(resp.response).then(function(text) {
                resolve(JSON.parse(text));
              }).catch(function() {
                reject(new Error('Invalid gzip JSON from ' + url));
              });
              return;
            }
            try {
              resolve(JSON.parse(resp.responseText));
            } catch (e) {
              reject(new Error('Invalid JSON from ' + url));
            }
          } else {
            var httpErr = new Error('HTTP ' + resp.status + ' fetching ' + url);
            httpErr.status = resp.status;
            reject(httpErr);
          }
        },
        onerror: function() {
          reject(new Error('Network error fetching ' + url));
        },
        ontimeout: function() {
          reject(new Error('Timeout fetching ' + url));
        },
        onabort: function() {
          reject(new Error('Aborted fetching ' + url));
        }
      });
    } else {
      fetch(bustUrl)
        .then(function(r) {
          if (!r.ok) {
            var e = new Error('HTTP ' + r.status);
            e.status = r.status;
            throw e;
          }
          return gz ? r.arrayBuffer().then(gunzipToText).then(JSON.parse) : r.json();
        })
        .then(resolve)
        .catch(reject);
    }
  });
}

async function fetchForumJsonWithRetry(url, gz) {
  try {
    return await fetchJsonViaGM(url, gz);
  } catch (err) {
    var status = err && err.status;
    if (status === 404 || (status >= 500 && status < 600)) {
      await new Promise(function(r) { setTimeout(r, 1500); });
      return await fetchJsonViaGM(url, gz);
    }
    throw err;
  }
}

// Download a board: the .json.gz copy when the source offers one, else (or if it fails) the plain .json (SMS-USR-076)
async function fetchForumBoard(source) {
  if (source.gzUrl) {
    try {
      return await fetchForumJsonWithRetry(source.gzUrl, true);
    } catch (gzErr) {
      console.warn('[SmartSearch] gzip download failed, falling back to plain JSON', gzErr);
    }
  }
  return await fetchForumJsonWithRetry(source.url, false);
}

// ── Download source (SMS-USR-084) ──
// No GitHub API: it allows 60 requests per hour per IP without a token, which players behind a shared IP use up.
// The latest release's manifest.json (a plain release download) gives each board's version; the board file
// comes from the same 'releases/latest/download/' link. A custom base URL serves manifest.json next to the boards.
function getManifestUrl() {
  if (settings.customBaseUrl && String(settings.customBaseUrl).trim()) {
    return String(settings.customBaseUrl).trim().replace(/\/+$/, '') + '/manifest.json';
  }
  var repo = normalizeGithubRepo(settings.githubRepo) || DEFAULT_SETTINGS.githubRepo;
  return 'https://github.com/' + repo + '/releases/latest/download/manifest.json';
}

async function fetchLatestManifest() {
  var manifest = await fetchJsonViaGM(getManifestUrl());
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid manifest.json');
  return manifest;
}

// Returns { url, gzUrl ('' = plain JSON only), version (the board's version in the manifest, '' = unknown), via }
async function resolveForumDownloadSource(forumId) {
  var gzOk = canGunzip();
  var url = getForumAssetUrl(forumId);
  var via = (settings.customBaseUrl && String(settings.customBaseUrl).trim()) ? 'custom base URL' : 'latest release';
  var manifest = null;
  try {
    manifest = await fetchLatestManifest();
  } catch (manifestErr) {
    // Without the manifest the board file itself is downloaded; its own version decides (SMS-USR-071)
    console.warn('[SmartSearch] manifest.json unavailable, downloading the board directly', manifestErr);
    return { url: url, gzUrl: gzOk ? url + '.gz' : '', version: '', via: via + ' (no manifest)' };
  }
  var entry = manifest.forums && manifest.forums[String(forumId)];
  if (!entry || typeof entry !== 'object') {
    throw new Error((FORUM_LABELS[forumId] || forumId) + ' is not in the latest database release ' + (manifest.version || ''));
  }
  var version = String(entry.version || manifest.version || '');
  return {
    url: url,
    gzUrl: gzOk && entry.asset_gz ? url + '.gz' : '',
    version: version,
    via: via + (manifest.version ? ' ' + manifest.version : '')
  };
}

async function updateCurrentForumDatabase() {
  if (inProgress !== false || isUpdatingDb) {
    updateStatusSpan('Busy, please wait...');
    return;
  }
  settings = loadSettings();
  isUpdatingDb = true;
  updateDbBtn.disabled = true;
  updateDbBtn.style.backgroundColor = '';
  updateDbBtn.style.color = '';
  updateDbBtn.textContent = 'Downloading ' + forumLabel + '...';
  var assetName = 'SmartSearch_' + forum + '.json';
  updateStatusSpan('Downloading ' + assetName + '...');

  try {
    // Only the current forum board, version from the latest release's manifest.json (SMS-USR-084)
    var source = await resolveForumDownloadSource(forum);
    var localVersion = (settings.forumVersions && settings.forumVersions[forum]) || '';
    if (source.version && source.version === localVersion) {
      refreshDbButtonLabel();
      updateStatusSpan('Already up to date (' + source.via + ')');
      return;
    }
    updateStatusSpan('Downloading ' + assetName + ' from ' + source.via + '...');
    var json = await fetchForumBoard(source);
    if (!json || !json.value || typeof json.value !== 'object' || Array.isArray(json.value)) {
      throw new Error('Invalid payload in ' + assetName);
    }
    if (String(json.key) !== String(forum)) {
      throw new Error('Rejected ' + assetName + ': file is for forum ' + (FORUM_LABELS[json.key] || json.key) + ', not ' + forumLabel);
    }
    // Fallback / mirror sources carry no version up front: the file's own version decides (no rewrite when equal)
    if (json.version && String(json.version) === localVersion) {
      refreshDbButtonLabel();
      updateStatusSpan('Already up to date (' + source.via + ')');
      return;
    }
    var remoteThreadCount = Object.keys(json.value).length;
    // Remember the board's version from the manifest when known, so a carried-over board is not downloaded again (SMS-USR-084)
    var remoteVersion = String(source.version || json.version || formatTimestampVersion(new Date()));

    await new Promise(function(resolve, reject) {
      dbGet(function(obj) {
        if (!obj.ignored) obj.ignored = { threads: {}, posts: {} };
        if (!obj.savedEquips) obj.savedEquips = {};

        var localThreadCount = (obj[forum] && typeof obj[forum] === 'object' && !Array.isArray(obj[forum])) ? Object.keys(obj[forum]).length : 0;
        if (settings.syncMode === 'full' && remoteThreadCount === 0 && localThreadCount > 0) {
          reject(new Error('Refusing empty cloud snapshot in Full Rebuild mode (' + assetName + ' has 0 threads; keeping ' + localThreadCount + ' local threads)'));
          return;
        }

        if (settings.syncMode === 'full' || !obj[forum]) {
          // 完全重建 (Full Rebuild)：清空本版塊舊討論串與裝備快取，保留個人 ignored 黑名單 (SMS-USR-040)
          obj[forum] = {};
          obj.savedEquips = {};
        }
        Object.assign(obj[forum], json.value);
        if (json.savedEquips && typeof json.savedEquips === 'object' && !Array.isArray(json.savedEquips)) {
          Object.assign(obj.savedEquips, json.savedEquips);
        }

        dbSet(obj, function() {
          resolve();
        }, reject);
      }, reject);
    });

    var latestSettings = loadSettings();
    if (!latestSettings.forumVersions) latestSettings.forumVersions = {};
    latestSettings.forumVersions[forum] = remoteVersion;
    saveSettings(latestSettings);
    settings = latestSettings;

    refreshDbButtonLabel();
    updateDbBtn.style.cssText = 'margin-left:20px; background-color:#33cccc; color:black;';
    updateStatusSpan('Update complete ✓ (' + Object.keys(json.value).length + ' threads, ' + source.via + ')');
  } catch (err) {
    console.error('[SmartSearch Update Error]', err);
    refreshDbButtonLabel();
    updateDbBtn.style.backgroundColor = '';
    updateDbBtn.style.color = '';
    updateStatusSpan(err && err.message ? err.message : 'Update failed');
  } finally {
    isUpdatingDb = false;
    updateDbBtn.disabled = false;
  }
}

function formatTimestampVersion(d) {
  return d.getFullYear() +
    ('0' + (d.getMonth() + 1)).slice(-2) +
    ('0' + d.getDate()).slice(-2) +
    ('0' + d.getHours()).slice(-2) +
    ('0' + d.getMinutes()).slice(-2) +
    ('0' + d.getSeconds()).slice(-2);
}

// Manage Database (Backup / Restore / Delete for the current forum board's independent DB) (SMS-USR-020)
var manage = searchDiv.appendChild(document.createElement('button'));
manage.textContent = 'Manage Database';
manage.style.marginLeft = '20px';
manage.addEventListener('click', function() {
  manage.disabled = true;

  var backup = searchDiv.appendChild(document.createElement('button'));
  backup.textContent = 'Backup';
  backup.style.marginLeft = '10px';
  var link = searchDiv.appendChild(document.createElement('a'));
  link.style.display = 'none';
  backup.addEventListener('click', function() {
    if (inProgress !== false || isUpdatingDb) {
      alert('Another transaction is in progress, please wait.');
      return;
    }
    var date = new Date();
    link.download = 'SmartSearch_' + forumLabel + '_' + (date.getFullYear() + ('0' + (date.getMonth() + 1)).slice(-2) + ('0' + date.getDate()).slice(-2)) + '.json';
    dbGet(function(obj) {
      if (link.href) window.URL.revokeObjectURL(link.href);
      var backupPayload = {
        key: forum,
        version: (settings.forumVersions && settings.forumVersions[forum]) || '',
        value: Object.prototype.hasOwnProperty.call(obj, forum) ? obj[forum] : {},
        savedEquips: obj.savedEquips || {}
      };
      link.href = window.URL.createObjectURL(new Blob([JSON.stringify(backupPayload)], { type: 'application/json' }));
      link.click();
    }, function(err) {
      alert('Backup failed: ' + (err && err.message ? err.message : 'Database error'));
    });
  });

  var restore = searchDiv.appendChild(document.createElement('button'));
  restore.textContent = 'Restore';
  restore.style.marginLeft = '10px';
  var restoreFile = document.createElement('input');
  restoreFile.type = 'file';
  restoreFile.style.cssText = 'margin:0;border:0;padding:0;vertical-align:baseline;background:none';
  searchDiv.appendChild(restoreFile);
  restore.addEventListener('click', function() {
    if (inProgress !== false || isUpdatingDb) {
      alert('Another transaction is in progress, please wait.');
      return;
    }
    var file = restoreFile.files[0];
    if (!file) {
      alert('Select a file first');
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      var json;
      try {
        json = JSON.parse(e.target.result);
        if (!json || !json.key || !json.value || typeof json.value !== 'object' || Array.isArray(json.value)) {
          alert('Invalid JSON');
          return;
        }
      } catch (err) {
        alert('Failed to parse the file\n\nSelect a valid SmartSearch_*.json file');
        return;
      }
      if (String(json.key) !== String(forum)) {
        alert('This file is for forum ' + (FORUM_LABELS[json.key] || json.key) + ', but you are currently in ' + forumLabel + '.\nPlease navigate to the matching forum board to restore it.');
        return;
      }
      if (inProgress !== false || isUpdatingDb) {
        alert('Another transaction is in progress, please wait.');
        return;
      }
      dbGet(function(obj) {
        var replaceMode = !obj[json.key] || !confirm('[OK] Just merge the file with the ' + forumLabel + ' database\n[Cancel] Clear the ' + forumLabel + ' database and replace with the file');
        if (replaceMode) {
          obj[json.key] = {};
          obj.savedEquips = {};
        }
        Object.assign(obj[json.key], json.value);
        if (json.savedEquips && typeof json.savedEquips === 'object' && !Array.isArray(json.savedEquips)) {
          if (!obj.savedEquips) obj.savedEquips = {};
          Object.assign(obj.savedEquips, json.savedEquips);
        }
        dbSet(obj, function() {
          if (json.version) {
            var latestSettings = loadSettings();
            if (!latestSettings.forumVersions) latestSettings.forumVersions = {};
            latestSettings.forumVersions[forum] = String(json.version);
            saveSettings(latestSettings);
            settings = latestSettings;
          }
          refreshDbButtonLabel();
          updateStatusSpan('Restored ' + Object.keys(json.value).length + ' threads');
          alert('Restored ' + forumLabel + ' SmartSearch Database successfully');
        }, function(err) {
          alert('Failed to save restored database: ' + (err && err.message ? err.message : 'Database error'));
        });
      }, function(err) {
        alert('Failed to open database for restore: ' + (err && err.message ? err.message : 'Database error'));
      });
    };
    reader.onerror = function() {
      alert('Failed to read the file');
    };
    reader.readAsText(file);
  });

  var del = searchDiv.appendChild(document.createElement('button'));
  del.textContent = 'Delete';
  del.style.marginLeft = '10px';
  del.addEventListener('click', function() {
    if (inProgress !== false || isUpdatingDb) {
      alert('Another transaction is in progress, please wait.');
      return;
    }
    if (!confirm('This will delete the ' + forumLabel + ' (' + DB_NAME + ') Database in the browser.\nOther forum boards will NOT be affected.\nAre you sure?')) {
      return;
    }
    dbDelete(function() {
      var latestSettings = loadSettings();
      if (!latestSettings.forumVersions) latestSettings.forumVersions = {};
      latestSettings.forumVersions[forum] = '';
      saveSettings(latestSettings);
      settings = latestSettings;
      refreshDbButtonLabel();
      updateStatusSpan('Database deleted');
      alert('Deleted ' + forumLabel + ' database.\nRefresh the page.');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dark Modal Settings Overlay (SMS-USR-030 ~ 050)
// ─────────────────────────────────────────────────────────────────────────────

var settingsModalEl = null;

function openSettingsModal() {
  if (settingsModalEl) {
    document.body.removeChild(settingsModalEl);
    settingsModalEl = null;
  }
  settings = loadSettings();

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(20,22,25,0.92);z-index:999999;display:flex;align-items:center;justify-content:center;color:#e8eaed;font-family:Consolas,monospace,Arial;font-size:13px;';
  settingsModalEl = overlay;

  var panel = document.createElement('div');
  panel.style.cssText = 'background:#232629;border:1px solid #aaa;padding:22px 28px;max-width:680px;width:92%;max-height:88vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.7);text-align:left;';
  overlay.appendChild(panel);

  var wtsVer = escapeHtml(formatVersionLabel(settings.forumVersions && settings.forumVersions['77']));
  var iskVer = escapeHtml(formatVersionLabel(settings.forumVersions && settings.forumVersions['90']));
  var daysLimitVal = clampDaysLimit(settings.daysAgoLimit);
  var lang = uiLanguage(settings);
  var languageOptions = UI_LANGUAGES.map(function(l) {
    return '<option value="' + l[0] + '"' + (l[0] === lang ? ' selected' : '') + '>' + escapeHtml(l[1]) + '</option>';
  }).join('');

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #555;padding-bottom:10px;margin-bottom:16px;">
      <strong style="font-size:16px;color:#fff;">⚙️ SmartSearch-Cloud Settings (v${version} — Current Board: ${forumLabel})</strong>
      <button id="ss-set-close-top" style="background:none;border:none;color:#aaa;font-size:20px;cursor:pointer;">×</button>
    </div>

    <div style="margin-bottom:16px;">
      <span style="font-weight:bold;color:#fff;">Language${zhNote(lang, '語系')}: </span>
      <select id="ss-language" style="background:#333;color:#fff;border:1px solid #777;padding:2px 4px;">${languageOptions}</select>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-weight:bold;color:#fff;margin-bottom:6px;">Database Update Mode${zhNote(lang, '按下 Update Database 時的更新模式')}</div>
      <label style="display:block;margin-bottom:4px;cursor:pointer;">
        <input type="radio" name="ss-sync-mode" value="full" ${settings.syncMode === 'full' ? 'checked' : ''} />
        <strong>Full Rebuild${zhNote(lang, '完全重建')}</strong>
        <div style="color:#aaa;font-size:12px;margin-left:22px;">Clear old threads in the current board's DB (${DB_NAME}) and replace with latest Cloud DB. Your personal Ignored threads/posts &amp; Search History are preserved.</div>
      </label>
      <label style="display:block;cursor:pointer;">
        <input type="radio" name="ss-sync-mode" value="incremental" ${settings.syncMode === 'incremental' ? 'checked' : ''} />
        <strong>Incremental Merge${zhNote(lang, '增量合併')}</strong>
        <div style="color:#aaa;font-size:12px;margin-left:22px;">Keep older threads already in the current board's DB (${DB_NAME}) and merge/overwrite updated threads from Cloud DB.</div>
      </label>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-weight:bold;color:#fff;margin-bottom:6px;">Independent Forum Databases &amp; Cloud Source${zhNote(lang, '各版塊獨立資料庫狀態')}</div>
      <div style="color:#bbb;font-size:12px;margin-bottom:8px;">
        Each forum board maintains its own isolated IndexedDB database and is only downloaded when you click <strong>Update Database</strong> inside that board:<br/>
        • <strong>WTS (77)</strong> [SmartSearchCloudDb_77]: ${wtsVer}<br/>
        • <strong>ISK (90)</strong> [SmartSearchCloudDb_90]: ${iskVer}
      </div>
      <div style="margin-top:6px;">
        <span>GitHub Repo (owner/name): </span>
        <input type="text" id="ss-github-repo" value="${escapeHtml(settings.githubRepo || '')}" placeholder="owner/repo" style="width:260px;background:#333;color:#fff;border:1px solid #777;padding:3px 6px;" />
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-weight:bold;color:#fff;margin-bottom:6px;">Search Display &amp; Thread Filtering${zhNote(lang, '搜尋顯示與置頂過濾')}</div>
      <label style="display:block;margin-bottom:6px;cursor:pointer;">
        <input type="checkbox" id="ss-exclude-pinned" ${settings.excludePinned ? 'checked' : ''} />
        <strong>Exclude Pinned Threads${zhNote(lang, '排除置頂討論串')}</strong>
        <div style="color:#aaa;font-size:12px;margin-left:22px;">Hide forum announcement and pinned threads from search results.</div>
      </label>
      <label style="display:block;margin-bottom:6px;cursor:pointer;">
        <input type="checkbox" id="ss-hide-locked" ${settings.hideLocked ? 'checked' : ''} />
        <strong>Hide Locked Threads${zhNote(lang, '隱藏已鎖定討論串')}</strong>
      </label>
      <label style="display:block;margin-bottom:6px;cursor:pointer;">
        <input type="checkbox" id="ss-show-strikeouts" ${settings.showStrikeouts ? 'checked' : ''} />
        <strong>Show Strikeouts${zhNote(lang, '顯示已被 [s] 刪除線劃掉的裝備')}</strong>
      </label>
      <label style="display:block;margin-bottom:6px;cursor:pointer;">
        <input type="checkbox" id="ss-wild-guess" ${settings.wildGuess ? 'checked' : ''} />
        <strong>Wild Guess Price${zhNote(lang, '寬鬆猜測未標明單位的價格數字')}</strong>
      </label>
      <div style="margin-top:6px;">
        <span>Highlight posts older than (days): </span>
        <input type="number" id="ss-days-limit" value="${daysLimitVal}" min="1" max="3650" style="width:60px;background:#333;color:#fff;border:1px solid #777;padding:2px 4px;" />
      </div>
    </div>

    <div style="border:1px solid #bbb;background:#2b2e32;padding:12px;margin-bottom:16px;">
      <div style="font-weight:bold;color:#fff;margin-bottom:8px;text-align:center;">Excluded Poster UIDs / Names${zhNote(lang, '排除特定發文者')}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:4px;" id="ss-excluded-table">
        <thead>
          <tr style="border:none;color:#ddd;font-size:12px;">
            <th style="text-align:center;padding:4px;">Display Name</th>
            <th style="text-align:center;padding:4px;">UID</th>
            <th style="text-align:center;padding:4px;width:70px;">Active?</th>
            <th style="text-align:center;padding:4px;width:40px;"></th>
          </tr>
        </thead>
        <tbody id="ss-excluded-tbody"></tbody>
      </table>
      <div style="text-align:center;margin-top:10px;">
        <button id="ss-add-excluded" style="background:#3a3d42;color:#fff;border:1px solid #999;border-radius:4px;padding:4px 16px;cursor:pointer;">Add User</button>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #555;padding-top:12px;">
      <button id="ss-set-sync-now" style="background:#2d6a7a;color:#fff;border:1px solid #5bc0de;padding:6px 14px;cursor:pointer;">Save &amp; Update ${forumLabel} DB Now</button>
      <button id="ss-set-save" style="background:#3a5a40;color:#fff;border:1px solid #70a288;padding:6px 16px;cursor:pointer;">Save Settings</button>
      <button id="ss-set-cancel" style="background:#444;color:#ddd;border:1px solid #777;padding:6px 14px;cursor:pointer;">Close</button>
    </div>
  `;

  var tbody = panel.querySelector('#ss-excluded-tbody');

  function addExcludedRow(userObj) {
    var tr = document.createElement('tr');
    tr.style.border = 'none';
    tr.innerHTML = `
      <td style="padding:4px;text-align:center;">
        <input type="text" class="ss-ex-name" value="${escapeHtml(userObj.displayName || '')}" placeholder="Seller Name" style="width:90%;background:#fff;color:#000;border:1px solid #888;padding:3px 6px;" />
      </td>
      <td style="padding:4px;text-align:center;">
        <input type="text" class="ss-ex-uid" value="${escapeHtml(userObj.uid || '')}" placeholder="UID" style="width:85%;background:#999;color:#222;border:1px solid #888;padding:3px 6px;" />
      </td>
      <td style="padding:4px;text-align:center;">
        <input type="checkbox" class="ss-ex-active" ${userObj.active !== false ? 'checked' : ''} style="cursor:pointer;" />
      </td>
      <td style="padding:4px;text-align:center;">
        <button type="button" class="ss-ex-remove" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;" title="Remove">×</button>
      </td>
    `;
    tr.querySelector('.ss-ex-remove').addEventListener('click', function() {
      tbody.removeChild(tr);
    });
    tbody.appendChild(tr);
  }

  settings.excludedUsers.forEach(addExcludedRow);

  panel.querySelector('#ss-add-excluded').addEventListener('click', function() {
    addExcludedRow({ displayName: '', uid: '', active: true });
  });

  function collectAndSave() {
    var rawRepo = panel.querySelector('#ss-github-repo').value.trim();
    var repoVal = rawRepo ? normalizeGithubRepo(rawRepo) : DEFAULT_SETTINGS.githubRepo;
    if (!repoVal) {
      alert('Invalid GitHub Repo format. Expected "owner/repo" (or full GitHub repo URL).');
      return false;
    }
    var modeRadio = panel.querySelector('input[name="ss-sync-mode"]:checked');
    settings.syncMode = modeRadio ? modeRadio.value : 'full';
    settings.githubRepo = repoVal;
    settings.excludePinned = !!panel.querySelector('#ss-exclude-pinned').checked;
    settings.hideLocked = !!panel.querySelector('#ss-hide-locked').checked;
    settings.showStrikeouts = !!panel.querySelector('#ss-show-strikeouts').checked;
    settings.wildGuess = !!panel.querySelector('#ss-wild-guess').checked;
    settings.daysAgoLimit = clampDaysLimit(panel.querySelector('#ss-days-limit').value);
    settings.language = uiLanguage({ language: panel.querySelector('#ss-language').value });

    var exList = [];
    [].forEach.call(tbody.querySelectorAll('tr'), function(tr) {
      var nameVal = tr.querySelector('.ss-ex-name').value.trim();
      var uidVal = tr.querySelector('.ss-ex-uid').value.trim();
      var actVal = !!tr.querySelector('.ss-ex-active').checked;
      if (nameVal || uidVal) {
        exList.push({ displayName: nameVal, uid: uidVal, active: actVal });
      }
    });
    settings.excludedUsers = exList;
    var latestSaved = loadSettings();
    settings.forumVersions = Object.assign({}, DEFAULT_SETTINGS.forumVersions, latestSaved.forumVersions || {});
    saveSettings(settings);
    applyRuntimeSettings();
    updateStatusSpan();
    return true;
  }

  function closeModal() {
    if (settingsModalEl) {
      document.body.removeChild(settingsModalEl);
      settingsModalEl = null;
    }
  }

  panel.querySelector('#ss-language').addEventListener('change', function() {
    if (!collectAndSave()) return;
    openSettingsModal();
  });
  panel.querySelector('#ss-set-close-top').addEventListener('click', closeModal);
  panel.querySelector('#ss-set-cancel').addEventListener('click', closeModal);
  panel.querySelector('#ss-set-save').addEventListener('click', function() {
    if (!collectAndSave()) return;
    closeModal();
  });
  panel.querySelector('#ss-set-sync-now').addEventListener('click', function() {
    if (!collectAndSave()) return;
    closeModal();
    updateCurrentForumDatabase();
  });

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeModal();
  });

  document.body.appendChild(overlay);
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-Forum Isolated IndexedDB Storage Layer (SmartSearchCloudDb_77 / _90)
// ─────────────────────────────────────────────────────────────────────────────

var isUpdatingDb = false;
var inProgress = false;

function error(str) {
  console.log(str);
  var errorDiv = searchDiv.appendChild(document.createElement('h2'));
  errorDiv.textContent = str;
  errorDiv.style.color = 'red';
}

function dbDelete(callback, onError) {
  inProgress = true;
  var settled = false;
  var DBDeleteRequest = window.indexedDB.deleteDatabase(DB_NAME);
  DBDeleteRequest.onerror = function(event) {
    if (settled) return;
    settled = true;
    inProgress = false;
    var err = new Error('Error deleting db ' + (event && event.target && event.target.errorCode));
    error(err.message);
    if (typeof onError === 'function') onError(err);
  };
  DBDeleteRequest.onblocked = function() {
    if (settled) return;
    settled = true;
    inProgress = false;
    var err = new Error('Blocked deleting db ' + DB_NAME);
    error(err.message);
    if (typeof onError === 'function') onError(err);
  };
  DBDeleteRequest.onsuccess = function() {
    if (settled) return;
    settled = true;
    console.log(DB_NAME + ' deleted');
    inProgress = false;
    callback();
  };
}

function dbSet(obj, callback, onError) {
  inProgress = true;
  var settled = false;
  function fail(msg) {
    if (settled) return;
    settled = true;
    inProgress = false;
    error(msg);
    if (typeof onError === 'function') onError(new Error(msg));
  }
  var serialized;
  try {
    serialized = JSON.stringify(obj);
  } catch (e) {
    fail('dbSet: JSON stringify failed ' + (e && e.message ? e.message : String(e)));
    return;
  }
  var dbRequest = window.indexedDB.open(DB_NAME, 2);
  dbRequest.onupgradeneeded = function(event) {
    var db = event.target.result;
    if (!db.objectStoreNames.contains('SmartSearchObjectStore')) {
      db.createObjectStore('SmartSearchObjectStore', { keyPath: 'SmartSearchObjectStoreKey', autoIncrement: true });
    }
  };
  dbRequest.onblocked = function() {
    fail('dbSet: Database blocked');
  };
  dbRequest.onsuccess = function() {
    var db = dbRequest.result;
    var transaction = db.transaction(['SmartSearchObjectStore'], 'readwrite');
    var objectStore = transaction.objectStore('SmartSearchObjectStore');
    var putReq = objectStore.put({
      SmartSearchObjectStoreKey: '1',
      obj: serialized
    });
    transaction.oncomplete = function() {
      if (settled) return;
      settled = true;
      try { db.close(); } catch (e) {}
      inProgress = false;
      callback();
    };
    putReq.onerror = function(event) {
      try { db.close(); } catch (e) {}
      fail('dbSet: Error on putReq ' + (event && event.target && event.target.errorCode));
    };
    transaction.onerror = function(event) {
      try { db.close(); } catch (e) {}
      fail('dbSet: Error on transaction ' + (event && event.target && event.target.errorCode));
    };
    transaction.onabort = function(event) {
      try { db.close(); } catch (e) {}
      fail('dbSet: Transaction aborted ' + (event && event.target && event.target.errorCode));
    };
  };
  dbRequest.onerror = function(event) {
    fail('dbSet: Error opening db ' + (event && event.target && event.target.errorCode));
  };
}

function dbGet(callback, onError) {
  inProgress = true;
  var settled = false;
  function fail(msg) {
    if (settled) return;
    settled = true;
    inProgress = false;
    error(msg);
    if (typeof onError === 'function') onError(new Error(msg));
  }
  var dbRequest = window.indexedDB.open(DB_NAME, 2);
  dbRequest.onupgradeneeded = function(event) {
    var db = event.target.result;
    if (!db.objectStoreNames.contains('SmartSearchObjectStore')) {
      db.createObjectStore('SmartSearchObjectStore', { keyPath: 'SmartSearchObjectStoreKey', autoIncrement: true });
    }
  };
  dbRequest.onblocked = function() {
    fail('dbGet: Database blocked');
  };
  dbRequest.onsuccess = function() {
    var db = dbRequest.result;
    var transaction = db.transaction(['SmartSearchObjectStore'], 'readwrite');
    var getRequest = transaction.objectStore('SmartSearchObjectStore').get('1');
    getRequest.onsuccess = function() {
      if (settled) return;
      db.close();
      inProgress = false;
      if (!getRequest.result || !getRequest.result.obj) {
        var defaultObj = { ignored: { threads: {}, posts: {} }, savedEquips: {} };
        defaultObj[forum] = {};
        settled = true;
        dbSet(defaultObj, function() {
          callback(defaultObj);
        }, onError);
        return;
      }
      var obj;
      try {
        obj = JSON.parse(getRequest.result.obj);
      } catch (e) {
        fail('dbGet: Failed to parse stored JSON');
        return;
      }
      if (/showforum/.test(Object.keys(obj)[0])) {
        obj = { ignored: { threads: {}, posts: {} }, savedEquips: {} };
      }
      if (!obj.ignored) obj.ignored = { threads: {}, posts: {} };
      if (!obj.savedEquips) obj.savedEquips = {};
      if (!obj[forum]) obj[forum] = {};
      settled = true;
      callback(obj);
    };
    getRequest.onerror = function(event) {
      try { db.close(); } catch (e) {}
      fail('dbGet: Error on getRequest ' + (event && event.target && event.target.errorCode));
    };
    transaction.onerror = function(event) {
      try { db.close(); } catch (e) {}
      fail('dbGet: Error on transaction ' + (event && event.target && event.target.errorCode));
    };
    transaction.onabort = function(event) {
      try { db.close(); } catch (e) {}
      fail('dbGet: Transaction aborted ' + (event && event.target && event.target.errorCode));
    };
  };
  dbRequest.onerror = function(event) {
    fail('dbGet: Error opening db ' + (event && event.target && event.target.errorCode));
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// One-time cleanup of data left by the 2.x script (SMS-USR-078)
// SmartSearch-Cloud never imports the original HV SmartSearch's data. It deletes only what 2.x created on this
// site — its settings ('SmartSearchSettings') and per-forum databases ('SmartSearchDb_77/78/90') — and never
// touches the original script's own localStorage key or its single (un-suffixed) database.
// ─────────────────────────────────────────────────────────────────────────────
var V2_CLEANUP_FLAG = 'SmartSearchCloud.v2DataCleared';

function clearOldV2Data() {
  try {
    if (localStorage.getItem(V2_CLEANUP_FLAG) === '1') return;
    localStorage.removeItem('SmartSearchSettings');
    if (window.indexedDB && typeof window.indexedDB.deleteDatabase === 'function') {
      ['77', '78', '90'].forEach(function(f) {
        try { window.indexedDB.deleteDatabase('SmartSearchDb_' + f); } catch (e) {}
      });
    }
    localStorage.setItem(V2_CLEANUP_FLAG, '1');
  } catch (e) {
    console.warn('[SmartSearch-Cloud] Clearing 2.x data failed, will retry on the next page load', e);
  }
}

// Runs after every declaration above has executed (SMS-USR-078)
clearOldV2Data();
