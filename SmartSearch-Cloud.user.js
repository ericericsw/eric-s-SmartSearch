// ==UserScript==
// @name        SmartSearch-Cloud
// @description Search equipment on e-hentai trade forums (Cloud DB Sync Edition)
// @namespace   SmartSearch-Cloud
// @author      Superlatanium, nekolor, ericeric91, claude
// @include     https://forums.e-hentai.org/index.php*showforum=*
// @include     https://forums.e-hentai.org/index.php?act=post*
// @include     https://hentaiverse.org/?s=Bazaar&ss=mm&filter=new*
// @include     https://hentaiverse.org/isekai/?s=Bazaar&ss=mm&filter=new*
// @version     3.6.0
// @grant       GM_registerMenuCommand
// @grant       GM_xmlhttpRequest
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_deleteValue
// @grant       unsafeWindow
// @connect     github.com
// @connect     objects.githubusercontent.com
// @connect     release-assets.githubusercontent.com
// @connect     raw.githubusercontent.com
// @updateURL   https://raw.githubusercontent.com/ericericsw/eric-s-SmartSearch/main/SmartSearch-Cloud.user.js
// @downloadURL https://raw.githubusercontent.com/ericericsw/eric-s-SmartSearch/main/SmartSearch-Cloud.user.js
// ==/UserScript==

// Shown in the Settings panel title: read from the header's @version so the two never drift apart (SMS-USR-085)
var version = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || '3.6.0';

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
  language: 'en', // interface language: 'en' (default) or 'zh' (SMS-USR-087)
  priorityShops: [], // [{ displayName, uid }]: their lines are listed first, in this order (SMS-USR-088)
  forumVersions: { '77': '', '90': '' }
};

// Interface languages (SMS-USR-087). English is the default.
var UI_LANGUAGES = [['en', 'English'], ['zh', '中文']];

function uiLanguage(cfg) {
  return cfg && cfg.language === 'zh' ? 'zh' : 'en';
}

// Chinese interface texts (SMS-USR-087), keyed by the English text; {0}, {1} ... are filled in by tl().
// Equipment names are shown in Chinese too, but keywords still match the English names in the forum posts.
var I18N_ZH = {
  // forum bar
  '⚙️ Settings': '⚙️ 設定',
  '🔄 Update {0} Database': '🔄 更新 {0} 資料庫',
  'Use regular expression in search field? (unticked: words in any order, e.g. pha elem)': '關鍵字使用正規表示式？（未勾選：多個詞不分順序，例如 pha elem）',
  'e.g. pha elem (press ? for syntax)': '例如 pha elem（按 ? 看語法）',
  'Keyword syntax and examples': '關鍵字語法與範例',
  'Filter Search': '篩選搜尋',
  'Search this keyword now; more conditions can be added in the results tab': '立即搜尋這個關鍵字；可在結果分頁再加入其他條件',
  'Open Search Window': '開啟搜尋視窗',
  'Open an empty search tab: set the conditions there, then press Search': '開啟空白的搜尋分頁：在那裡設定條件後按「搜尋」',
  'String is too short': '關鍵字太短',
  "The browser blocked the new tab, so SmartSearch's results can't be opened. Please allow pop-ups from https://forums.e-hentai.org/": '瀏覽器擋下了新分頁，無法開啟 SmartSearch 的搜尋結果。請允許 https://forums.e-hentai.org/ 開啟彈出式視窗',
  'Not downloaded': '尚未下載',
  'not downloaded': '尚未下載',
  'Click to download the latest {0} database from GitHub Releases (skipped when already up to date)': '點擊從 GitHub Releases 下載最新的 {0} 資料庫（已是最新時略過）',
  'Update Database ({0})': '更新資料庫（{0}）',
  'Full Rebuild': '完全重建',
  'Incremental': '增量合併',
  '{0} DB [{1}]': '{0} 資料庫 [{1}]',
  'Busy, please wait...': '忙碌中，請稍候…',
  'Downloading {0}...': '正在下載 {0}…',
  'Downloading {0} from {1}...': '正在從 {1} 下載 {0}…',
  'Already up to date ({0})': '已是最新（{0}）',
  'Update complete ✓ ({0} threads, {1})': '更新完成 ✓（{0} 個討論串，{1}）',
  'Update failed': '更新失敗',
  'custom base URL': '自訂來源網址',
  'latest release': '最新發布',
  '{0} (no manifest)': '{0}（無 manifest）',
  'Invalid manifest.json': 'manifest.json 格式錯誤',
  '{0} is not in the latest database release {1}': '最新的資料庫發布 {1} 中沒有 {0}',
  'Invalid payload in {0}': '{0} 的內容格式錯誤',
  'Rejected {0}: file is for forum {1}, not {2}': '已拒絕 {0}：這是 {1} 版塊的檔案，不是 {2}',
  'Refusing empty cloud snapshot in Full Rebuild mode ({0} has 0 threads; keeping {1} local threads)': '完全重建模式不接受空的雲端資料（{0} 沒有討論串；保留本機 {1} 個討論串）',
  'Invalid gzip JSON from {0}': '{0} 的 gzip JSON 格式錯誤',
  'Invalid JSON from {0}': '{0} 的 JSON 格式錯誤',
  'HTTP {0} fetching {1}': '下載 {1} 時發生 HTTP {0}',
  'Network error fetching {0}': '下載 {0} 時網路錯誤',
  'Timeout fetching {0}': '下載 {0} 逾時',
  'Aborted fetching {0}': '下載 {0} 被中止',
  'Manage Database': '管理資料庫',
  'Backup': '備份',
  'Restore': '還原',
  'Delete': '刪除',
  'Another transaction is in progress, please wait.': '另一項資料庫作業進行中，請稍候。',
  'Backup failed: {0}': '備份失敗：{0}',
  'Database error': '資料庫錯誤',
  'Select a file first': '請先選擇檔案',
  'Invalid JSON': 'JSON 格式錯誤',
  'Failed to parse the file\n\nSelect a valid SmartSearch_*.json file': '無法解析檔案\n\n請選擇有效的 SmartSearch_*.json 檔案',
  'This file is for forum {0}, but you are currently in {1}.\nPlease navigate to the matching forum board to restore it.': '這是 {0} 版塊的檔案，但你目前在 {1}。\n請到對應的版塊還原。',
  '[OK] Just merge the file with the {0} database\n[Cancel] Clear the {0} database and replace with the file': '[確定] 把檔案合併進 {0} 資料庫\n[取消] 清空 {0} 資料庫，改用檔案內容',
  'Restored {0} threads': '已還原 {0} 個討論串',
  'Restored {0} SmartSearch Database successfully': '已成功還原 {0} SmartSearch 資料庫',
  'Failed to save restored database: {0}': '還原的資料庫儲存失敗：{0}',
  'Failed to open database for restore: {0}': '無法開啟資料庫進行還原：{0}',
  'Failed to read the file': '無法讀取檔案',
  'This will delete the {0} ({1}) Database in the browser.\nOther forum boards will NOT be affected.\nAre you sure?': '這會刪除瀏覽器中的 {0}（{1}）資料庫。\n其他版塊不受影響。\n確定要刪除嗎？',
  'Database deleted': '資料庫已刪除',
  'Deleted {0} database.\nRefresh the page.': '已刪除 {0} 資料庫。\n請重新整理頁面。',
  'Error deleting db {0}': '刪除資料庫失敗 {0}',
  'Blocked deleting db {0}': '刪除資料庫 {0} 被阻擋',
  '{0}: JSON stringify failed {1}': '{0}：JSON 序列化失敗 {1}',
  '{0}: Database blocked': '{0}：資料庫被阻擋',
  '{0}: Error on putReq {1}': '{0}：寫入失敗 {1}',
  '{0}: Error on getRequest {1}': '{0}：讀取失敗 {1}',
  '{0}: Error on transaction {1}': '{0}：交易失敗 {1}',
  '{0}: Transaction aborted {1}': '{0}：交易中止 {1}',
  '{0}: Error opening db {1}': '{0}：無法開啟資料庫 {1}',
  '{0}: Failed to parse stored JSON': '{0}：無法解析儲存的 JSON',
  // keyword syntax help
  '<b>Keyword syntax</b> (RegEx box unticked)': '<b>關鍵字語法</b>（未勾選 RegEx；請輸入論壇貼文裡的英文裝備名稱）',
  'Words in any order, each matching the start of a word, upper or lower case: <code>pha elem</code> finds <i>Legendary Phase Shoes of the Elementalist</i>': '多個詞不分順序，每個詞比對單字開頭，不分大小寫：<code>pha elem</code> 可找到 <i>Legendary Phase Shoes of the Elementalist</i>',
  'Every word must be on the line: <code>leg fiery oak</code>, <code>peer pha sh</code>, <code>mag shade arca</code>': '每個詞都必須出現在同一行：<code>leg fiery oak</code>、<code>peer pha sh</code>、<code>mag shade arca</code>',
  '<code>*</code> stands for any letters inside a word: <code>*sword</code> finds Shortsword, Longsword': '<code>*</code> 代表單字中的任意字母：<code>*sword</code> 可找到 Shortsword、Longsword',
  'Only the text you see is searched, not the link addresses. Numbers work too: <code>lv.500</code>, <code>500k</code>': '只搜尋看得到的文字，不搜尋連結網址。數字也可以：<code>lv.500</code>、<code>500k</code>',
  'Leave it empty to list every equipment line; otherwise type at least 3 characters.': '留空會列出所有裝備行；否則至少輸入 3 個字元。',
  '<b>RegEx box ticked</b>: the keyword is a JavaScript regular expression, matched anywhere on the line: ': '<b>勾選 RegEx</b>：關鍵字是 JavaScript 正規表示式，比對整行任何位置：',
  'Quality, type, prefix, suffix, slot and primary attributes are easier with the <b>Equipment filter</b> in the results tab.': '品質、類型、前綴、後綴、部位與主要屬性，用結果分頁的 <b>裝備篩選</b> 更方便。',
  // results tab
  'Search': '搜尋',
  'Keyword, e.g. pha elem (empty = all lines)': '關鍵字，例如 pha elem（留空＝全部）',
  'Use regular expression in the keyword box': '關鍵字使用正規表示式',
  'All qualities': '全部品質',
  'Level': '等級',
  'Price': '價格',
  'min': '最小',
  'max': '最大',
  'Sort: post edited (newest)': '排序：貼文編輯時間（新到舊）',
  'Price: high to low': '價格：高到低',
  'Price: low to high': '價格：低到高',
  'Level: high to low': '等級：高到低',
  'Level: low to high': '等級：低到高',
  'Roll%: high to low': 'Roll%：高到低',
  'Roll%: low to high': 'Roll%：低到高',
  'Clear filters': '清除篩選',
  'Search the database with the conditions above': '用上方條件搜尋資料庫',
  'Show Stats': '顯示屬性欄',
  'Hide Stats': '隱藏屬性欄',
  '{0} match': '{0} 筆符合',
  'Export': '匯出',
  'Import': '匯入',
  'Copy these search conditions as text, to keep or share': '把目前的搜尋條件複製成文字，方便保存或分享',
  'Paste conditions made by Export, then search': '貼上「匯出」產生的條件後搜尋',
  'Lowest EID': '最低 EID',
  'Thread title': '討論串標題',
  'Any': '不限',
  'Includes': '包含',
  'Excludes': '排除',
  'Apply and search': '套用並搜尋',
  'Close': '關閉',
  'Copy this line to keep or share the conditions above (Lowest EID and thread title are not included).': '複製這一行即可保存或分享上方的條件（不含最低 EID 與討論串標題）。',
  'Press Ctrl+C to copy': '按 Ctrl+C 複製',
  'Copied to clipboard': '已複製到剪貼簿',
  'Paste a line made by Export. It replaces the conditions above, then searches.': '貼上「匯出」產生的一行文字，會取代上方的條件並立即搜尋。',
  'Imported; not found in this version and skipped: {0}': '已匯入；以下項目在這個版本不存在，已略過：{0}',
  'This is not SmartSearch-Cloud filter text: paste the whole line made by Export': '這不是 SmartSearch-Cloud 的篩選條件文字：請貼上「匯出」產生的整行文字',
  'Equipment filter': '裝備篩選',
  'Category': '分類',
  'Type': '類型',
  'Prefix': '前綴',
  'Suffix': '後綴',
  'Slot': '部位',
  'Primary attributes (must have all picked)': '主要屬性（須全部具備）',
  'No prefix': '無前綴',
  'No suffix': '無後綴',
  'Several in one section = any of them; different sections must all match': '同一區塊多選＝符合任一即可；不同區塊須全部符合',
  'Done': '完成',
  'Set the conditions above, then press Search.': '設定上方條件後按「搜尋」。',
  'Another transaction is in progress, please wait and press Search again': '另一項資料庫作業進行中，請稍候再按「搜尋」',
  'Keyword is too short: use at least 3 characters, or leave it empty': '關鍵字太短：至少 3 個字元，或留空',
  'Invalid regular expression: {0}': '正規表示式無效：{0}',
  'Searching...': '搜尋中…',
  'Forum {0}': '{0} 版塊',
  '{0} threads saved in {1} database': '{1} 資料庫已儲存 {0} 個討論串',
  'lowestEid is not an integer': '最低 EID 不是整數',
  '{0} hidden': '已隱藏 {0}',
  'Poster': '發文者',
  'Thread': '討論串',
  'Line content': '內容',
  'Thread saved': '討論串儲存',
  'Post edited': '貼文編輯',
  'Quality': '品質',
  'Ignore': '忽略',
  '{0} results': '{0} 筆結果',
  'Unknown': '未知',
  '{0} days ago': '{0} 天前',
  '{0} years ago': '{0} 年前',
  'Unassigned': '未分配',
  'Soulbound': '靈魂綁定',
  'Untradeable': '不可交易',
  'No such item': '查無此裝備',
  'Error': '錯誤',
  'Failed to open IndexedDB for {0}: {1}': '無法開啟 {0} 的 IndexedDB：{1}',
  'Another transaction is in progress, please wait': '另一項資料庫作業進行中，請稍候',
  'Database error, please retry': '資料庫錯誤，請重試',
  'Always ignore thread by {0} titled "{1}"?': '永遠忽略 {0} 的討論串「{1}」？',
  'Always ignore the post in this thread that includes "{0}"?': '永遠忽略這個討論串中包含「{0}」的貼文？',
  'Completely remove this thread from the database?': '從資料庫完全移除這個討論串？',
  'Ignored threads': '已忽略的討論串',
  'Ignored posts': '已忽略的貼文',
  'Remove from ignoredThreads': '從已忽略的討論串移除',
  'Remove from ignoredPosts': '從已忽略的貼文移除',
  'Reload interface': '重新載入介面',
  'Open MoogleMail with a WTB message to the poster': '開啟 MoogleMail，寫好給發文者的 WTB 信',
  'Open a reply in this rental shop thread with the rental request ({0} days)': '開啟這家租借店主題的回覆頁，填好租借叫號（{0} 天）',
  'Open a reply in this exchange shop thread with the claim command': '開啟這家交換店主題的回覆頁，填好領取指令',
  'SmartSearch-Cloud filled this in. Check it, then send it yourself.': 'SmartSearch-Cloud 已自動填好內容，請確認後自行送出。',
  // Settings panel
  '⚙️ SmartSearch-Cloud Settings (v{0} — Current Board: {1})': '⚙️ SmartSearch-Cloud 設定（v{0} — 目前版塊：{1}）',
  'Language: ': '語系：',
  'Database Update Mode': '資料庫更新模式（按下「更新資料庫」時）',
  "Clear old threads in the current board's DB ({0}) and replace with latest Cloud DB. Your personal Ignored threads/posts &amp; Search History are preserved.": '清空目前版塊資料庫（{0}）的舊討論串，改用最新的雲端資料庫。個人的已忽略討論串／貼文與搜尋紀錄會保留。',
  'Incremental Merge': '增量合併',
  "Keep older threads already in the current board's DB ({0}) and merge/overwrite updated threads from Cloud DB.": '保留目前版塊資料庫（{0}）已有的舊討論串，再合併／覆寫雲端資料庫中更新過的討論串。',
  'Independent Forum Databases &amp; Cloud Source': '各版塊獨立資料庫與雲端來源',
  'Each forum board maintains its own isolated IndexedDB database and is only downloaded when you click <strong>Update Database</strong> inside that board:': '每個版塊各有獨立的 IndexedDB 資料庫，只有在該版塊按下 <strong>更新資料庫</strong> 時才會下載：',
  'GitHub Repo (owner/name): ': 'GitHub 儲存庫（owner/name）：',
  'Search Display &amp; Thread Filtering': '搜尋顯示與討論串過濾',
  'Exclude Pinned Threads': '排除置頂討論串',
  'Hide forum announcement and pinned threads from search results.': '搜尋結果不顯示版塊公告與置頂討論串。',
  'Hide Locked Threads': '隱藏已鎖定的討論串',
  'Show Strikeouts': '顯示被 [s] 刪除線劃掉的裝備',
  'Wild Guess Price': '寬鬆猜測未標單位的價格數字',
  'Highlight posts older than (days): ': '標示超過幾天的舊貼文（天）：',
  'Priority Shops': '優先店家',
  'Their lines are listed first in the search results, in this order. Drag ☰ to reorder.': '這些店家的裝備在搜尋結果中排在最前面，依此順序。拖曳 ☰ 調整順序。',
  'Shop Owner Name': '店主名稱',
  'Drag to reorder': '拖曳調整順序',
  'Add Shop': '新增店家',
  'Excluded Poster UIDs / Names': '排除特定發文者（UID／名稱）',
  'Display Name': '顯示名稱',
  'Active?': '啟用',
  'Seller Name': '賣家名稱',
  'Remove': '移除',
  'Add User': '新增使用者',
  'Save &amp; Update {0} DB Now': '儲存並立即更新 {0} 資料庫',
  'Save Settings': '儲存設定',
  'Invalid GitHub Repo format. Expected "owner/repo" (or full GitHub repo URL).': 'GitHub 儲存庫格式錯誤，應為「owner/repo」（或完整的 GitHub 儲存庫網址）。',
  // equipment filter groups, categories and slots
  '1H': '單手武器',
  '2H': '雙手武器',
  'Staff': '法杖',
  'Shield': '盾牌',
  'Cloth': '布甲',
  'Light': '輕甲',
  'Heavy': '重甲',
  'Head': '頭',
  'Body': '身',
  'Hands': '手',
  'Legs': '腿',
  'Feet': '腳',
  'Weapon / staff': '武器／法杖',
  'Armor / shield': '護甲／盾牌',
  'Mitigation': '緩傷',
  'Weapon': '武器',
  'Staff / magic': '法杖／魔法',
  'Proficiency': '熟練度',
  'Defence': '防禦',
  'Primary attributes': '主要屬性',
  // equipment qualities
  'Peerless': '無雙',
  'Legendary': '傳奇',
  'Magnificent': '史詩',
  'Exquisite': '精良',
  'Superior': '上等',
  'Average': '普通',
  'Fair': '尚可',
  'Crude': '粗糙',
  // equipment types
  'Axe': '斧',
  'Club': '棍棒',
  'Dagger': '匕首',
  'Rapier': '西洋劍',
  'Shortsword': '短劍',
  'Wakizashi': '脇差',
  'Estoc': '刺劍',
  'Katana': '太刀',
  'Longsword': '長劍',
  'Mace': '錘矛',
  'Scythe': '鐮刀',
  'Swordchucks': '鎖鏈雙劍',
  'Oak': '橡木',
  'Redwood': '紅杉木',
  'Willow': '柳木',
  'Katalox': '鐵木',
  'Ebony': '烏木',
  'Buckler': '小圓盾',
  'Kite': '鳶盾',
  'Tower': '塔盾',
  'Force': '原力盾',
  'Cotton': '棉製',
  'Gossamer': '薄紗',
  'Ironsilk': '鐵絲絨',
  'Phase': '相位',
  'Leather': '皮革',
  'Drakehide': '龍鱗甲',
  'Kevlar': '凱夫拉',
  'Shade': '暗影',
  'Plate': '板甲',
  'Chain': '鎖子甲',
  'Reactive': '反應裝甲',
  'Power': '動力甲',
  // prefixes
  'Ethereal': '空靈',
  'Fiery': '紅蓮',
  'Arctic': '北極',
  'Shocking': '雷鳴',
  'Tempestuous': '風暴',
  'Hallowed': '聖光',
  'Demonic': '魔性',
  'Radiant': '魔光',
  'Charged': '速充',
  'Mystic': '神秘',
  'Frugal': '節能',
  'Reinforced': '強固',
  'Agile': '敏捷',
  'Savage': '殘暴',
  'Mithril': '秘銀',
  'Shielding': '盾化',
  'Ruby': '紅寶石',
  'Cobalt': '鈷石',
  'Amber': '琥珀',
  'Jade': '翡翠',
  'Zircon': '鋯石',
  'Onyx': '縞瑪瑙',
  // suffixes
  'Slaughter': '殺戮',
  'Balance': '平衡',
  'Swiftness': '迅捷',
  'the Nimble': '鬼靈',
  'the Battlecaster': '戰法師',
  'the Vampire': '吸血鬼',
  'the Illithid': '靈吸怪',
  'the Banshee': '報喪女妖',
  'Destruction': '毀滅',
  'Focus': '專注',
  'Surtr': '史爾特爾',
  'Niflheim': '尼福爾海姆',
  'Mjolnir': '妙爾尼爾',
  'Freyr': '弗雷',
  'Heimdall': '海姆達爾',
  'Fenrir': '芬里爾',
  'the Elementalist': '元素使',
  'the Heaven-sent': '天國賜物',
  'the Demon-fiend': '煉獄妖魔',
  'the Earth-walker': '地行者',
  'the Curse-weaver': '織咒者',
  'Protection': '防護',
  'Warding': '結界',
  'Dampening': '抗震',
  'Deflection': '偏曲',
  'Stoneskin': '硬皮',
  'Negation': '抹煞',
  'the Barrier': '屏障',
  'the Fleet': '機動隊',
  'the Shadowdancer': '影舞者',
  'the Arcanist': '奧術師',
  'the Fire-eater': '食火者',
  'the Frost-born': '霜生者',
  'the Thunder-child': '雷霆之子',
  'the Wind-waker': '喚風者',
  'the Thrice-blessed': '三重祝福者',
  'the Spirit-ward': '靈魂守護者',
  'the Ox': '公牛',
  'the Raccoon': '浣熊',
  'the Cheetah': '獵豹',
  'the Fox': '狐狸',
  'the Owl': '貓頭鷹',
  'the Turtle': '烏龜'
};

// English text -> the chosen language's text, with {0}, {1} ... replaced by the following arguments (SMS-USR-087)
function tl(en) {
  var text = uiLanguage(settings) === 'zh' && Object.prototype.hasOwnProperty.call(I18N_ZH, en) ? I18N_ZH[en] : en;
  var args = arguments;
  return String(text).replace(/\{(\d+)\}/g, function(m, i) {
    return Number(i) + 1 < args.length ? String(args[Number(i) + 1]) : m;
  });
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
  if (!Array.isArray(cfg.priorityShops)) cfg.priorityShops = [];
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

// ── WTB button (SMS-USR-090) ──
// Shops that take commands as forum replies in their own thread instead of MoogleMail
var RENTAL_SHOP = { name: 'HVEquipRental', uid: '7912010' }; // rental call: "[<EID>] <N>days"
var EXCHANGE_SHOP = { name: 'HVEquipExchange', uid: '10063793' }; // exchange claim: "Claim <EID>"
var RENTAL_DAYS = 7;

function isShopThread(thread, shop) {
  if (!thread) return false;
  if (String(thread.opUid || '').trim() === shop.uid) return true;
  return String(thread.opName || '').trim().toLowerCase() === shop.name.toLowerCase();
}

// What the WTB button sends for one equipment line. The forum is in English, so these texts are English only.
// { kind: 'reply', text } for the rental and exchange shops, else { kind: 'mm', recipient, subject, body }
function buildWtbRequest(thread, eid, equipName, priceText) {
  if (isShopThread(thread, EXCHANGE_SHOP)) return { kind: 'reply', text: 'Claim ' + eid };
  if (isShopThread(thread, RENTAL_SHOP)) return { kind: 'reply', text: '[' + eid + '] ' + RENTAL_DAYS + 'days' };
  var name = String(equipName || '').trim();
  var price = String(priceText || '').trim();
  return {
    kind: 'mm',
    recipient: String((thread && thread.opName) || '').trim(),
    subject: 'WTB ' + eid,
    body: 'I Want to buy equip : ' + eid + (name ? ' ' + name : '') + (price ? ' @ ' + price : '')
  };
}

// The results tab stores the draft and opens the page; this script fills it in there. GM storage is shared
// between the forum and HentaiVerse; the URL hash carries a copy for script managers without it.
var WTB_DRAFT_KEY = 'SmartSearchCloudWtbDraft';
var WTB_DRAFT_HASH = '#ss_wtb=';
var WTB_DRAFT_MAX_AGE_MS = 60 * 1000;

function storeWtbDraft(draft) {
  try {
    if (typeof GM_setValue === 'function') GM_setValue(WTB_DRAFT_KEY, JSON.stringify(draft));
  } catch (e) {}
  return WTB_DRAFT_HASH + encodeURIComponent(JSON.stringify(draft));
}

function takeWtbDraft(kind) {
  var draft = null;
  try {
    if (typeof GM_getValue === 'function') {
      var stored = GM_getValue(WTB_DRAFT_KEY, null);
      if (stored) {
        draft = JSON.parse(stored);
        if (typeof GM_deleteValue === 'function') GM_deleteValue(WTB_DRAFT_KEY);
      }
    }
  } catch (e) {}
  if (window.location.hash.indexOf(WTB_DRAFT_HASH) === 0) {
    try {
      if (!draft) draft = JSON.parse(decodeURIComponent(window.location.hash.slice(WTB_DRAFT_HASH.length)));
    } catch (e) {}
    history.replaceState(null, document.title, window.location.pathname + window.location.search);
  }
  if (!draft || draft.kind !== kind || !(Date.now() - Number(draft.at) < WTB_DRAFT_MAX_AGE_MS)) return null;
  return draft;
}

function setFieldValue(selector, value) {
  var field = document.querySelector(selector);
  if (!field || !value) return false;
  field.value = value;
  return true;
}

function showDraftBanner() {
  var banner = document.body.appendChild(document.createElement('div'));
  banner.textContent = tl('SmartSearch-Cloud filled this in. Check it, then send it yourself.');
  banner.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;background:#1b4332;' +
    'color:#d8f3dc;border:1px solid #40916c;padding:8px 16px;border-radius:6px;font:13px sans-serif;';
  setTimeout(function() { banner.remove(); }, 8000);
}

if (window.location.hostname === 'hentaiverse.org') {
  // MoogleMail compose page (the normal page, and HV Utils' own compose form)
  var mmDraft = takeWtbDraft('mm');
  if (mmDraft) {
    var mmFilled = setFieldValue('input[name="message_to_name"]', mmDraft.recipient);
    setFieldValue('input[name="message_subject"]', mmDraft.subject);
    setFieldValue('textarea[name="message_body"]', mmDraft.body);
    mmFilled = setFieldValue('.hvut-mm-left input[tabindex="1"]', mmDraft.recipient) || mmFilled;
    setFieldValue('.hvut-mm-left input[tabindex="2"]', mmDraft.subject);
    setFieldValue('.hvut-mm-left textarea[tabindex="3"]', mmDraft.body);
    if (mmFilled) showDraftBanner();
  }
  return;
}
if (/[?&]act=post\b/i.test(window.location.search)) {
  // Forum reply page: the rental / exchange command goes into the reply box
  var replyDraft = takeWtbDraft('reply');
  if (replyDraft && setFieldValue('textarea[name="Post"]', replyDraft.text)) showDraftBanner();
  return;
}

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
    GM_registerMenuCommand(tl('⚙️ Settings'), function() {
      openSettingsModal();
    });
    GM_registerMenuCommand(tl('🔄 Update {0} Database', forumLabel), function() {
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
useRE.title = tl('Use regular expression in search field? (unticked: words in any order, e.g. pha elem)');
useRE.checked = !!lastStorage.useSearchRegEx;

var input = searchDiv.appendChild(document.createElement('input'));
input.type = 'search';
input.style.width = '350px';
input.setAttribute('list', 'recent-searches');
input.autocomplete = 'off';

var dataRecent = searchDiv.appendChild(document.createElement('datalist'));
dataRecent.id = 'recent-searches';
input.placeholder = tl('e.g. pha elem (press ? for syntax)');

// Keyword syntax help for players who never read the forum post or the README (SMS-USR-083)
var forumHelpBtn = searchDiv.appendChild(document.createElement('button'));
forumHelpBtn.textContent = '?';
forumHelpBtn.title = tl('Keyword syntax and examples');
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

// Position of the thread's poster in the Priority Shops list (SMS-USR-088), -1 = not listed.
// A name or a UID matches, like the exclusions.
function priorityShopRank(thread, shops) {
  if (!thread || !Array.isArray(shops)) return -1;
  var tUid = String(thread.opUid || '').trim();
  var tName = String(thread.opName || '').trim().toLowerCase();
  for (var i = 0; i < shops.length; i++) {
    var shop = shops[i] || {};
    var uid = String(shop.uid || '').trim();
    var name = String(shop.displayName || '').trim().toLowerCase();
    if ((uid && uid === tUid) || (name && name === tName)) return i;
  }
  return -1;
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
  var notFilter = tl('This is not SmartSearch-Cloud filter text: paste the whole line made by Export');
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
  tl('<b>Keyword syntax</b> (RegEx box unticked)') +
  '<ul style="margin:4px 0 4px 18px; padding:0;">' +
  '<li>' + tl('Words in any order, each matching the start of a word, upper or lower case: <code>pha elem</code> finds <i>Legendary Phase Shoes of the Elementalist</i>') + '</li>' +
  '<li>' + tl('Every word must be on the line: <code>leg fiery oak</code>, <code>peer pha sh</code>, <code>mag shade arca</code>') + '</li>' +
  '<li>' + tl('<code>*</code> stands for any letters inside a word: <code>*sword</code> finds Shortsword, Longsword') + '</li>' +
  '<li>' + tl('Only the text you see is searched, not the link addresses. Numbers work too: <code>lv.500</code>, <code>500k</code>') + '</li>' +
  '<li>' + tl('Leave it empty to list every equipment line; otherwise type at least 3 characters.') + '</li>' +
  '</ul>' +
  tl('<b>RegEx box ticked</b>: the keyword is a JavaScript regular expression, matched anywhere on the line: ') +
  '<code>peerless.*(phase|cotton)</code>, <code>\\bof the (arcanist|elementalist)\\b</code>' +
  '<div style="margin-top:4px;">' + tl('Quality, type, prefix, suffix, slot and primary attributes are easier with the <b>Equipment filter</b> in the results tab.') + '</div>';
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

// Sections of the Equipment filter that narrow each other (SMS-USR-089); Primary attributes never do
var EQUIP_NARROWING_SECTIONS = ['cats', 'types', 'prefixes', 'suffixes', 'slots'];

// Equipment types that the picks of one section allow; null = nothing picked there (no restriction)
function sectionEquipTypes(f, mapName) {
  var out = [];
  if (mapName === 'cats' || mapName === 'slots') {
    if (!anyPicked(f[mapName])) return null;
    EQUIP_CATEGORIES.forEach(function(c) {
      // Slots exist only on armor: any picked slot allows every armor type
      var ok = mapName === 'cats' ? !!f.cats[c.key] : EQUIP_ARMOR_CATEGORIES.indexOf(c.key) !== -1;
      if (ok) out = out.concat(c.types);
    });
    return out;
  }
  if (mapName === 'types') {
    if (!anyPicked(f.types)) return null;
    return Object.keys(f.types).filter(function(t) { return !!f.types[t]; });
  }
  if (mapName === 'prefixes') return narrowTypesByAffix('prefix', f.prefixes, null);
  if (mapName === 'suffixes') return narrowTypesByAffix('suffix', f.suffixes, null);
  return null;
}

// Types allowed by the picks of every narrowing section except `skip`; null = no restriction
function equipTypesExcept(f, skip) {
  var types = null;
  EQUIP_NARROWING_SECTIONS.forEach(function(mapName) {
    if (mapName === skip) return;
    var allowed = sectionEquipTypes(f, mapName);
    if (allowed === null) return;
    types = types === null ? allowed.slice() : types.filter(function(t) { return allowed.indexOf(t) !== -1; });
  });
  return types;
}

// A choice stays available while some equipment type fits it and the picks of every other section (SMS-USR-089)
function isChipAvailable(f, mapName, key) {
  if (EQUIP_NARROWING_SECTIONS.indexOf(mapName) === -1) return true;
  var types = equipTypesExcept(f, mapName);
  if (types === null) return true;
  if (mapName === 'cats') {
    return EQUIP_CATEGORIES.some(function(c) {
      return c.key === key && c.types.some(function(t) { return types.indexOf(t) !== -1; });
    });
  }
  if (mapName === 'types') return types.indexOf(key) !== -1;
  if (mapName === 'prefixes') return isAffixAvailable('prefix', key, types);
  if (mapName === 'suffixes') return isAffixAvailable('suffix', key, types);
  return isSlotAvailable(types);
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

// Stats columns (SMS-USR-069, 074, 091): [Quality, PAB, Roll%, Base avg]
function statCellTexts(item) {
  var d = describeEquip(item);
  if (!d) return ['', '', '', ''];
  var avg = parseFloat(item && item.avg);
  return [
    tl(d.quality),
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
search.textContent = tl('Filter Search');
search.style['margin-left'] = '30px';
search.title = tl('Search this keyword now; more conditions can be added in the results tab');
search.addEventListener('click', function() {
  openSearchTab(true);
});

var openSearchWindowBtn = searchDiv.appendChild(document.createElement('button'));
openSearchWindowBtn.textContent = tl('Open Search Window');
openSearchWindowBtn.style.marginLeft = '10px';
openSearchWindowBtn.title = tl('Open an empty search tab: set the conditions there, then press Search');
openSearchWindowBtn.addEventListener('click', function() {
  openSearchTab(false);
});

function openSearchTab(runNow) {
  settings = loadSettings();
  applyRuntimeSettings();
  updateStatusSpan();
  var entryBtn = runNow ? search : openSearchWindowBtn;
  var entryLabel = runNow ? tl('Filter Search') : tl('Open Search Window');
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
    entryBtn.textContent = tl('String is too short');
    return;
  }
  // Results open in a new browser tab left at about:blank, so the address bar never shows a forum URL.
  // The page is built with DOM calls only: document.open()/write() from this page would rewrite the tab URL (SMS-USR-060).
  var w = win.open('', '_blank');
  if (w === null || w === undefined) {
    error(tl("The browser blocked the new tab, so SmartSearch's results can't be opened. Please allow pop-ups from https://forums.e-hentai.org/"));
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
    w.document.title = (tabState.keyword || tl('Search')) + ' • SmartSearch-Cloud (' + forumLabel + ')';
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
.main th:nth-child(7) {width:55px;}
.main td:nth-child(7) {text-align:center;}
.main th:nth-child(8) {width:100px;}
.main th:nth-child(9) {width:90px; color:blue; text-decoration:underline; cursor:pointer;}
.main th:nth-child(10) {width:90px; color:blue; text-decoration:underline; cursor:pointer;}
.main th:nth-child(11) {width:55px;}
.main th:nth-child(12) {width:65px; color:blue; text-decoration:underline; cursor:pointer;}
.main th:nth-child(13) {width:60px; color:blue; text-decoration:underline; cursor:pointer;}
.main td:nth-child(12) {text-align:center;}
.main td:nth-child(13) {text-align:right;}
.main th:nth-child(14) {width:70px;}
.main .st {display:none;}
.showStats .main .st {display:table-cell;}
.main {min-width:1000px;}
.showStats .main {min-width:1330px;}
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
    matchCountEls.forEach(function(span) { span.textContent = tl('{0} match', n); });
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
  // Grey out choices that cannot occur with the picks of the other sections, in every direction (SMS-USR-089)
  function refreshChipAvailability() {
    // A disabled choice cannot stay picked; unpicking one can narrow the other sections further, so repeat until
    // nothing changes. Each round judges every chip against the same snapshot of the picks.
    for (var round = 0; round < 10; round++) {
      var picks = JSON.parse(JSON.stringify(tabState));
      var changed = false;
      chipRegistry.forEach(function(entry) {
        var ok = isChipAvailable(picks, entry.mapName, entry.key);
        entry.chip.disabled = !ok;
        if (!ok && tabState[entry.mapName][entry.key]) {
          tabState[entry.mapName][entry.key] = false;
          entry.chip.className = 'ssChip';
          changed = true;
        }
      });
      if (!changed) break;
    }
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
  addTextFilter(barRow1, 'ssKeyword', 'keyword', tl('Keyword, e.g. pha elem (empty = all lines)'));
  var reLabel = barRow1.appendChild(mk('label'));
  reLabel.title = tl('Use regular expression in the keyword box');
  var reCbox = reLabel.appendChild(mk('input'));
  reCbox.type = 'checkbox';
  reCbox.checked = tabState.useRE;
  reCbox.addEventListener('change', function() { tabState.useRE = reCbox.checked; });
  filterSyncers.push(function() { reCbox.checked = tabState.useRE; });
  reLabel.appendChild(doc.createTextNode('RegEx'));
  var helpBtn = barRow1.appendChild(mk('button', 'ssBtn', '?'));
  helpBtn.title = tl('Keyword syntax and examples');
  var helpPanel = filterBar.appendChild(buildSyntaxHelp(doc));
  helpBtn.addEventListener('click', function() {
    helpPanel.style.display = helpPanel.style.display === 'none' ? 'block' : 'none';
  });
  var filterToggle = barRow1.appendChild(mk('button', 'ssBtn ssBtnDark'));
  var qualitySel = addSelect(barRow1, 'quality', [['', tl('All qualities')]].concat(EQUIP_QUALITIES.map(function(q) { return [q, tl(q)]; })), null);
  addRangeFilter(barRow1, tl('Level'), 'levelMin', 'levelMax', tl('min'), tl('max'));
  addRangeFilter(barRow1, tl('Price'), 'priceMin', 'priceMax', tl('min'), tl('max'));
  addRangeFilter(barRow1, 'Roll%', 'rollMin', 'rollMax', '0', '100');

  var barRow2 = barLeft.appendChild(mk('div', 'ssBarRow'));
  var sortSel = addSelect(barRow2, 'sort', [
    ['', tl('Sort: post edited (newest)')],
    ['price-desc', tl('Price: high to low')],
    ['price-asc', tl('Price: low to high')],
    ['level-desc', tl('Level: high to low')],
    ['level-asc', tl('Level: low to high')],
    ['roll-desc', tl('Roll%: high to low')],
    ['roll-asc', tl('Roll%: low to high')]
  ], function(mode) {
    if (applySortHook) applySortHook(mode); // re-orders the current results only, no new search
  });
  var barClear = barRow2.appendChild(mk('button', 'ssBtn', tl('Clear filters')));
  barClear.addEventListener('click', clearEquipFilter);
  var barSearch = barRow2.appendChild(mk('button', 'ssBtn ssBtnDark', tl('Search')));
  barSearch.title = tl('Search the database with the conditions above');
  barSearch.addEventListener('click', runSearchFromBar);
  // Show Stats (SMS-USR-069, 091): toggles the Quality / PAB / Roll% / Base avg columns, no new search
  var statsBtn = barRow2.appendChild(mk('button', 'ssBtn', tl('Show Stats')));
  statsBtn.addEventListener('click', function() {
    tabState.showStats = !tabState.showStats;
    resultsDiv.className = tabState.showStats ? 'showStats' : '';
    statsBtn.textContent = tabState.showStats ? tl('Hide Stats') : tl('Show Stats');
  });
  var barCount = barRow2.appendChild(mk('b', 'ssLbl'));
  matchCountEls.push(barCount);

  // Top-right: Lowest EID and thread-title filter, applied when Search is pressed (SMS-USR-068)
  var barSide = barMain.appendChild(mk('div', 'ssBarSide'));
  var eidRow = barSide.appendChild(mk('div', 'ssSideRow'));
  // Filter import / export (SMS-USR-086), left of Lowest EID; the text box opens under the bar
  var exportBtn = eidRow.appendChild(mk('button', 'ssBtn', tl('Export')));
  exportBtn.title = tl('Copy these search conditions as text, to keep or share');
  var importBtn = eidRow.appendChild(mk('button', 'ssBtn', tl('Import')));
  importBtn.title = tl('Paste conditions made by Export, then search');
  eidRow.appendChild(mk('span', '', tl('Lowest EID')));
  var lowestEidInput = eidRow.appendChild(mk('input', 'ssEid'));
  lowestEidInput.type = 'text';
  lowestEidInput.value = forum === '90' ? '0' : String(lowestEid);
  var filterEidResult = eidRow.appendChild(mk('span', 'ssSideNote'));
  var titleRow = barSide.appendChild(mk('div', 'ssSideRow'));
  titleRow.appendChild(mk('span', '', tl('Thread title')));
  var threadModeSel = titleRow.appendChild(mk('select'));
  [['0', tl('Any')], ['1', tl('Includes')], ['-1', tl('Excludes')]].forEach(function(o) {
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
  var shareApply = shareFoot.appendChild(mk('button', 'ssBtn ssBtnDark', tl('Apply and search')));
  var shareClose = shareFoot.appendChild(mk('button', 'ssBtn', tl('Close')));
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
    shareNote.textContent = tl('Copy this line to keep or share the conditions above (Lowest EID and thread title are not included).');
    shareText.value = text;
    shareApply.style.display = 'none';
    sharePanel.style.display = 'block';
    shareText.focus();
    shareText.select();
    setShareStatus(tl('Press Ctrl+C to copy'), false);
    var clip = w.navigator && w.navigator.clipboard;
    if (clip && clip.writeText) {
      clip.writeText(text).then(function() { setShareStatus(tl('Copied to clipboard'), false); }, function() {});
    }
  });
  importBtn.addEventListener('click', function() {
    shareNote.textContent = tl('Paste a line made by Export. It replaces the conditions above, then searches.');
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
      setShareStatus(tl('Imported; not found in this version and skipped: {0}', result.skipped.join(', ')), true);
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
  var catSec = addSection(tl('Category'));
  var catRow = catSec.appendChild(mk('div', 'ssGroup'));
  EQUIP_CATEGORIES.forEach(function(c) { addChip(catRow, tl(c.label), 'cats', c.key); });
  var typeSec = addSection(tl('Type'));
  EQUIP_CATEGORIES.forEach(function(c) {
    var g = addGroup(typeSec, tl(c.label));
    c.types.forEach(function(t) { addChip(g, tl(t), 'types', t); });
  });
  // Section order follows the narrowing order Category → Type → Prefix → Suffix → Slot → Primary attributes (SMS-USR-079)
  var prefixSec = addSection(tl('Prefix'));
  EQUIP_PREFIX_GROUPS.forEach(function(pg) {
    var g = addGroup(prefixSec, tl(pg.label));
    pg.items.forEach(function(p) { addChip(g, tl(p), 'prefixes', p); });
  });
  addChip(addGroup(prefixSec, ''), tl('No prefix'), 'prefixes', EQUIP_NONE);
  var suffixSec = addSection(tl('Suffix'));
  EQUIP_SUFFIX_GROUPS.forEach(function(sg) {
    var g = addGroup(suffixSec, tl(sg.label));
    sg.items.forEach(function(sx) { addChip(g, tl(sx), 'suffixes', sx); });
  });
  addChip(addGroup(suffixSec, ''), tl('No suffix'), 'suffixes', EQUIP_NONE);
  var slotSec = addSection(tl('Slot'));
  var slotRow = slotSec.appendChild(mk('div', 'ssGroup'));
  EQUIP_SLOTS.forEach(function(sl) { addChip(slotRow, tl(sl.label), 'slots', sl.label); });
  // Unlike the other sections, every picked primary attribute must be present (SMS-USR-063)
  var statsSec = addSection(tl('Primary attributes (must have all picked)'));
  var statsRow = statsSec.appendChild(mk('div', 'ssGroup'));
  EQUIP_PRIMARY_STATS.forEach(function(st) { addChip(statsRow, st, 'stats', st); });

  var panelFoot = filterPanel.appendChild(mk('div', 'ssPanelFoot'));
  matchCountEls.push(panelFoot.appendChild(mk('b')));
  panelFoot.appendChild(mk('span', '', tl('Several in one section = any of them; different sections must all match')));
  panelFoot.appendChild(mk('span', 'ssSpacer'));
  var panelClear = panelFoot.appendChild(mk('button', 'ssBtn', tl('Clear filters')));
  panelClear.addEventListener('click', clearEquipFilter);
  var panelDone = panelFoot.appendChild(mk('button', 'ssBtn', tl('Done')));
  var panelSearch = panelFoot.appendChild(mk('button', 'ssBtn ssBtnDark', tl('Search')));
  panelSearch.addEventListener('click', runSearchFromBar);

  function updateFilterToggleLabel() {
    var picks = 0;
    ['cats', 'types', 'slots', 'prefixes', 'suffixes', 'stats'].forEach(function(m) {
      Object.keys(tabState[m]).forEach(function(k) { if (tabState[m][k]) picks++; });
    });
    filterToggle.textContent = tl('Equipment filter') + (picks ? ' (' + picks + ')' : '') + (filterPanel.style.display === 'none' ? ' ▾' : ' ▴');
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
    showResultsMessage(tl('Set the conditions above, then press Search.'), false);

  // Search the database with this tab's current conditions (SMS-USR-062): keyword AND equipment conditions
  function runSearch() {
  if (inProgress !== false || isUpdatingDb) {
    showResultsMessage(tl('Another transaction is in progress, please wait and press Search again'), true);
    return;
  }
  var popupQuery = String(tabState.keyword || '').trim();
  if (popupQuery.length > 0 && popupQuery.length < 3) {
    showResultsMessage(tl('Keyword is too short: use at least 3 characters, or leave it empty'), true);
    return;
  }
  var matcher = null; // null = empty keyword: every line with an equipment link matches (SMS-USR-061)
  try {
    matcher = buildKeywordMatcher(popupQuery, tabState.useRE === true); // fuzzy unless RegEx (SMS-USR-082)
  } catch (regexErr) {
    showResultsMessage(tl('Invalid regular expression: {0}', regexErr && regexErr.message ? regexErr.message : String(regexErr)), true);
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
  showResultsMessage(tl('Searching...'), false);
  updateMatchCount('…');

  dbGet(function(obj) {
    SmartSearch = obj;
    if (!SmartSearch[forum]) SmartSearch[forum] = {};
    if (!SmartSearch.savedEquips) SmartSearch.savedEquips = {};
    if (!SmartSearch.ignored) SmartSearch.ignored = { threads: {}, posts: {} };
    resultsDiv.innerHTML = '';

    var navStrip = document.getElementById('navstrip');
    var navText = navStrip ? navStrip.textContent : tl('Forum {0}', forumLabel);
    resultsDiv.appendChild(w.document.createElement('h3')).textContent = navText + ':\n' + tl('{0} threads saved in {1} database', Object.keys(SmartSearch[forum]).length, forumLabel);
    var resultsCountDiv = resultsDiv.appendChild(w.document.createElement('div'));
    function resetStatsToggle() {} // stats are columns now (SMS-USR-069): sorting no longer has info rows to drop

    function hide() {
      var activeLowest = parseInt(lowestEidInput.value, 10);
      if (isNaN(activeLowest)) {
        filterEidResult.textContent = tl('lowestEid is not an integer');
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
        filterEidResult.textContent = tl('{0} hidden', hideEidCount);
      if (hideTitleCount === 0) {
        filterThreadResult.textContent = tl('{0} hidden', 0);
        filterThreadResult.style.visibility = 'hidden';
      } else {
        filterThreadResult.style.visibility = '';
        filterThreadResult.textContent = tl('{0} hidden', hideTitleCount);
      }
      updateMatchCount(shownCount);
    }


    var table = resultsDiv.appendChild(w.document.createElement('table'));
    table.className = 'main';
    table.appendChild(w.document.createElement('thead')).innerHTML = '<tr><th>' + tl('Poster') + '</th><th>' + tl('Thread') + '</th><th>eid</th><th>' + tl('Price') + '</th><th>' + tl('Level') +
      '</th><th>' + tl('Line content') + '</th><th>WTB</th><th>' + tl('Thread saved') + '</th><th>' + tl('Post edited') + '</th><th class="st">' + tl('Quality') +
      '</th><th class="st">PAB</th><th class="st">Roll%</th><th class="st">Base avg</th><th>' + tl('Ignore') + '</th></tr>';
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
          tr.dataset.prio = String(priorityShopRank(thread, settings.priorityShops));
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

          // WTB (SMS-USR-090): only lines that link an equipment
          var wtbTd = tr.appendChild(w.document.createElement('td'));
          if (equip && equip.eid) addWtbButton(wtbTd, threadId, thread, equip, priceText);

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
          for (var sc = 0; sc < 4; sc++) tr.appendChild(w.document.createElement('td')).className = 'st';
          var ignoreBtn = tr.appendChild(w.document.createElement('td')).appendChild(w.document.createElement('button'));
          ignoreBtn.textContent = tl('Ignore');
          ignoreBtn.addEventListener('click', function() {
            makeIgnoreInterface(threadId, post, line);
          });
        });
      });
    });
    resultsCountDiv.textContent = tl('{0} results', resultsCount);
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
        tr.dataset.level = item.level || '';
        tr.children[4].textContent = tl(item.level || '');
        statCellTexts(item).forEach(function(text, i) {
          if (tr.children[9 + i]) tr.children[9 + i].textContent = text;
        });
      });
    }

    refreshLevels();

    function ago(num) {
      if (!num || isNaN(num) || num <= 0)
        return [tl('Unknown'), true];
      var daysAgo = Math.round((now - num) / (1000 * 3600 * 24));
      if (daysAgo < 364) {
        if (daysAgo < daysAgoLimit)
          return [tl('{0} days ago', daysAgo), false];
        else
          return [tl('{0} days ago', daysAgo), true];
      } else
        return [tl('{0} years ago', Math.round(daysAgo / 36.5) / 10), 1];
    }

    // Rows of the Priority Shops come first, in the list's order; the chosen sort applies within them (SMS-USR-088)
    function rowPriority(tr) {
      var rank = parseInt(tr.dataset.prio, 10);
      return rank >= 0 ? rank : Infinity;
    }
    function byPriority(cmp) {
      return function(a, b) {
        var pa = rowPriority(a), pb = rowPriority(b);
        return pa !== pb ? (pa < pb ? -1 : 1) : cmp(a, b);
      };
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
      trs.sort(byPriority(function(a, b) {
        return levelValue(b.dataset.level || '') - levelValue(a.dataset.level || '');
      }));
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
      trs.sort(byPriority(function(a, b) {
        return priceValue(b.children[3].textContent) - priceValue(a.children[3].textContent);
      }));
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
      trs.sort(byPriority(function(a, b) {
        return parseInt(b.children[2].textContent || 0, 10) - parseInt(a.children[2].textContent || 0, 10);
      }));
      trs.forEach(function(tr) {
        table.children[1].appendChild(tr);
      });
    });

    // Sort by date
    table.children[0].children[0].children[8].addEventListener('click', function() {
      resetStatsToggle();
      var trs = [];
      for (var i = table.children[1].children.length - 1; i >= 0; i--) {
        var tr = table.children[1].children[i];
        if (tr.className !== 'info')
          trs.push(tr);
        table.children[1].removeChild(tr);
      }
      trs.sort(byPriority(function(a, b) {
        return parseInt(b.dataset.edited || 0, 10) - parseInt(a.dataset.edited || 0, 10);
      }));
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
          var qEid = tr.children[2] ? tr.children[2].textContent : '';
          var qd = qEid ? describeEquip(SmartSearch.savedEquips[qEid]) : null;
          var qi = qd ? EQUIP_QUALITIES.indexOf(qd.quality) : -1;
          return qi === -1 ? null : EQUIP_QUALITIES.length - qi; // Peerless first
        }
        return parseInt(tr.dataset.edited || 0, 10) || null; // default: post edited, newest first
      }
      var asc = /-asc$/.test(mode);
      trs.sort(byPriority(function(a, b) {
        var ka = sortKey(a), kb = sortKey(b);
        if (ka === null && kb === null) return 0;
        if (ka === null) return 1; // rows without a value always go last
        if (kb === null) return -1;
        return asc ? ka - kb : kb - ka;
      }));
      trs.forEach(function(tr) { tbody.appendChild(tr); });
    }

    // Stats column headers sort high to low (SMS-USR-069)
    [[9, 'quality-desc'], [11, 'roll-desc'], [12, 'avg-desc']].forEach(function(hs) {
      table.children[0].children[0].children[hs[0]].addEventListener('click', function() { applySort(hs[1]); });
    });
    table.children[0].children[0].children[8].click();
    applySortHook = applySort;
    if (f.sort) applySort(f.sort);
  }, function(dbErr) {
    resultsDiv.innerHTML = '';
    var dbErrHeading = resultsDiv.appendChild(w.document.createElement('h3'));
    dbErrHeading.style.color = 'red';
    dbErrHeading.textContent = tl('Failed to open IndexedDB for {0}: {1}', forumLabel, dbErr && dbErr.message ? dbErr.message : tl('Database error'));
  });
  } // end runSearch

  // Opens MoogleMail (or, for the rental / exchange shop, a reply in its thread) filled in for this equipment
  function addWtbButton(td, threadId, thread, equip, priceText) {
    var btn = td.appendChild(w.document.createElement('button'));
    btn.textContent = 'WTB';
    var preview = buildWtbRequest(thread, equip.eid, '', '');
    if (preview.kind === 'mm') btn.title = tl('Open MoogleMail with a WTB message to the poster');
    else if (isShopThread(thread, RENTAL_SHOP)) btn.title = tl('Open a reply in this rental shop thread with the rental request ({0} days)', RENTAL_DAYS);
    else btn.title = tl('Open a reply in this exchange shop thread with the claim command');
    btn.addEventListener('click', function() {
      var item = SmartSearch && SmartSearch.savedEquips ? SmartSearch.savedEquips[equip.eid] : null;
      var request = buildWtbRequest(thread, equip.eid, item && item.name, priceText);
      var url;
      if (request.kind === 'mm') {
        url = 'https://hentaiverse.org/' + (equip.isIsekai ? 'isekai/' : '') + '?s=Bazaar&ss=mm&filter=new&hvut=disabled';
      } else {
        url = 'https://forums.e-hentai.org/index.php?act=post&do=reply_post&f=' + forum + '&t=' + encodeURIComponent(threadId);
      }
      win.open(url + storeWtbDraft(Object.assign({ at: Date.now() }, request)), '_blank');
    });
  }

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
        btn.textContent = tl('Another transaction is in progress, please wait');
        setTimeout(function() {
          btn.textContent = defaultLabel;
        }, 1500);
        return;
      }
      function onDbErr() {
        btn.textContent = tl('Database error, please retry');
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
    var ignoreThreadLabel = tl('Always ignore thread by {0} titled "{1}"?', thread.opName, thread.title);
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
    var ignorePostLabel = tl('Always ignore the post in this thread that includes "{0}"?', str);
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
    var deleteThreadLabel = tl('Completely remove this thread from the database?');
    deleteFromDb.textContent = deleteThreadLabel;
    deleteFromDb.addEventListener('click', function() {
      runFreshDbMutation(deleteFromDb, deleteThreadLabel, function(freshObj) {
        if (freshObj[forum]) delete freshObj[forum][threadId];
      }, reopenCurrentSearch);
    });

    ignoredDiv.appendChild(w.document.createElement('br'));
    ignoredDiv.appendChild(w.document.createElement('br'));

    ignoredDiv.appendChild(w.document.createElement('span')).textContent = tl('Ignored threads');
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
      removeIgnoreButton.textContent = tl('Remove from ignoredThreads');
      removeIgnoreButton.addEventListener('click', function() {
        runFreshDbMutation(removeIgnoreButton, tl('Remove from ignoredThreads'), function(freshObj) {
          if (freshObj.ignored && freshObj.ignored.threads) delete freshObj.ignored.threads[tId];
        }, function() {
          if (tr.parentNode === ignoredThreadsTable) ignoredThreadsTable.removeChild(tr);
        });
      });
    });
    ignoredDiv.appendChild(w.document.createElement('br'));
    ignoredDiv.appendChild(w.document.createElement('br'));

    ignoredDiv.appendChild(w.document.createElement('span')).textContent = tl('Ignored posts');
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
      removeIgnoreButton.textContent = tl('Remove from ignoredPosts');
      removeIgnoreButton.addEventListener('click', function() {
        runFreshDbMutation(removeIgnoreButton, tl('Remove from ignoredPosts'), function(freshObj) {
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
    close.textContent = tl('Close');
    close.addEventListener('click', function() {
      w.document.body.removeChild(ignoredDiv);
      ignoredDiv = null;
    });
    ignoredDiv.appendChild(w.document.createElement('br'));
    ignoredDiv.appendChild(w.document.createElement('br'));

    var reload = ignoredDiv.appendChild(w.document.createElement('button'));
    reload.textContent = tl('Reload interface');
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
  if (!v || v.length !== 14) return v || tl('Not downloaded');
  return v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8) + ' ' + v.slice(8, 10) + ':' + v.slice(10, 12);
}

// The database is only downloaded when the user clicks this button; its label shows the version in use (SMS-USR-021, 023)
var updateDbBtn = searchDiv.appendChild(document.createElement('button'));
updateDbBtn.style.marginLeft = '20px';
updateDbBtn.title = tl('Click to download the latest {0} database from GitHub Releases (skipped when already up to date)', forumLabel);
updateDbBtn.addEventListener('click', function() {
  updateCurrentForumDatabase();
});

function refreshDbButtonLabel() {
  var curVer = (settings.forumVersions && settings.forumVersions[forum]) || '';
  updateDbBtn.textContent = tl('Update Database ({0})', curVer ? 'v' + formatVersionLabel(curVer) : tl('not downloaded'));
}
refreshDbButtonLabel();

var settingsBtn = searchDiv.appendChild(document.createElement('button'));
settingsBtn.textContent = tl('⚙️ Settings');
settingsBtn.style.marginLeft = '10px';
settingsBtn.addEventListener('click', function() {
  openSettingsModal();
});

var statusSpan = searchDiv.appendChild(document.createElement('span'));
statusSpan.style.marginLeft = '12px';
statusSpan.style.fontSize = '12px';

function updateStatusSpan(extraMsg) {
  var modeLabel = settings.syncMode === 'full' ? tl('Full Rebuild') : tl('Incremental');
  statusSpan.textContent = tl('{0} DB [{1}]', forumLabel, modeLabel) + (extraMsg ? ' — ' + extraMsg : '');
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
                reject(new Error(tl('Invalid gzip JSON from {0}', url)));
              });
              return;
            }
            try {
              resolve(JSON.parse(resp.responseText));
            } catch (e) {
              reject(new Error(tl('Invalid JSON from {0}', url)));
            }
          } else {
            var httpErr = new Error(tl('HTTP {0} fetching {1}', resp.status, url));
            httpErr.status = resp.status;
            reject(httpErr);
          }
        },
        onerror: function() {
          reject(new Error(tl('Network error fetching {0}', url)));
        },
        ontimeout: function() {
          reject(new Error(tl('Timeout fetching {0}', url)));
        },
        onabort: function() {
          reject(new Error(tl('Aborted fetching {0}', url)));
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
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error(tl('Invalid manifest.json'));
  return manifest;
}

// Returns { url, gzUrl ('' = plain JSON only), version (the board's version in the manifest, '' = unknown), via }
async function resolveForumDownloadSource(forumId) {
  var gzOk = canGunzip();
  var url = getForumAssetUrl(forumId);
  var via = (settings.customBaseUrl && String(settings.customBaseUrl).trim()) ? tl('custom base URL') : tl('latest release');
  var manifest = null;
  try {
    manifest = await fetchLatestManifest();
  } catch (manifestErr) {
    // Without the manifest the board file itself is downloaded; its own version decides (SMS-USR-071)
    console.warn('[SmartSearch] manifest.json unavailable, downloading the board directly', manifestErr);
    return { url: url, gzUrl: gzOk ? url + '.gz' : '', version: '', via: tl('{0} (no manifest)', via) };
  }
  var entry = manifest.forums && manifest.forums[String(forumId)];
  if (!entry || typeof entry !== 'object') {
    throw new Error(tl('{0} is not in the latest database release {1}', FORUM_LABELS[forumId] || forumId, manifest.version || ''));
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
    updateStatusSpan(tl('Busy, please wait...'));
    return;
  }
  settings = loadSettings();
  isUpdatingDb = true;
  updateDbBtn.disabled = true;
  updateDbBtn.style.backgroundColor = '';
  updateDbBtn.style.color = '';
  updateDbBtn.textContent = tl('Downloading {0}...', forumLabel);
  var assetName = 'SmartSearch_' + forum + '.json';
  updateStatusSpan(tl('Downloading {0}...', assetName));

  try {
    // Only the current forum board, version from the latest release's manifest.json (SMS-USR-084)
    var source = await resolveForumDownloadSource(forum);
    var localVersion = (settings.forumVersions && settings.forumVersions[forum]) || '';
    if (source.version && source.version === localVersion) {
      refreshDbButtonLabel();
      updateStatusSpan(tl('Already up to date ({0})', source.via));
      return;
    }
    updateStatusSpan(tl('Downloading {0} from {1}...', assetName, source.via));
    var json = await fetchForumBoard(source);
    if (!json || !json.value || typeof json.value !== 'object' || Array.isArray(json.value)) {
      throw new Error(tl('Invalid payload in {0}', assetName));
    }
    if (String(json.key) !== String(forum)) {
      throw new Error(tl('Rejected {0}: file is for forum {1}, not {2}', assetName, FORUM_LABELS[json.key] || json.key, forumLabel));
    }
    // Fallback / mirror sources carry no version up front: the file's own version decides (no rewrite when equal)
    if (json.version && String(json.version) === localVersion) {
      refreshDbButtonLabel();
      updateStatusSpan(tl('Already up to date ({0})', source.via));
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
          reject(new Error(tl('Refusing empty cloud snapshot in Full Rebuild mode ({0} has 0 threads; keeping {1} local threads)', assetName, localThreadCount)));
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
    updateStatusSpan(tl('Update complete ✓ ({0} threads, {1})', Object.keys(json.value).length, source.via));
  } catch (err) {
    console.error('[SmartSearch Update Error]', err);
    refreshDbButtonLabel();
    updateDbBtn.style.backgroundColor = '';
    updateDbBtn.style.color = '';
    updateStatusSpan(err && err.message ? err.message : tl('Update failed'));
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
manage.textContent = tl('Manage Database');
manage.style.marginLeft = '20px';
manage.addEventListener('click', function() {
  manage.disabled = true;

  var backup = searchDiv.appendChild(document.createElement('button'));
  backup.textContent = tl('Backup');
  backup.style.marginLeft = '10px';
  var link = searchDiv.appendChild(document.createElement('a'));
  link.style.display = 'none';
  backup.addEventListener('click', function() {
    if (inProgress !== false || isUpdatingDb) {
      alert(tl('Another transaction is in progress, please wait.'));
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
      alert(tl('Backup failed: {0}', err && err.message ? err.message : tl('Database error')));
    });
  });

  var restore = searchDiv.appendChild(document.createElement('button'));
  restore.textContent = tl('Restore');
  restore.style.marginLeft = '10px';
  var restoreFile = document.createElement('input');
  restoreFile.type = 'file';
  restoreFile.style.cssText = 'margin:0;border:0;padding:0;vertical-align:baseline;background:none';
  searchDiv.appendChild(restoreFile);
  restore.addEventListener('click', function() {
    if (inProgress !== false || isUpdatingDb) {
      alert(tl('Another transaction is in progress, please wait.'));
      return;
    }
    var file = restoreFile.files[0];
    if (!file) {
      alert(tl('Select a file first'));
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      var json;
      try {
        json = JSON.parse(e.target.result);
        if (!json || !json.key || !json.value || typeof json.value !== 'object' || Array.isArray(json.value)) {
          alert(tl('Invalid JSON'));
          return;
        }
      } catch (err) {
        alert(tl('Failed to parse the file\n\nSelect a valid SmartSearch_*.json file'));
        return;
      }
      if (String(json.key) !== String(forum)) {
        alert(tl('This file is for forum {0}, but you are currently in {1}.\nPlease navigate to the matching forum board to restore it.', FORUM_LABELS[json.key] || json.key, forumLabel));
        return;
      }
      if (inProgress !== false || isUpdatingDb) {
        alert(tl('Another transaction is in progress, please wait.'));
        return;
      }
      dbGet(function(obj) {
        var replaceMode = !obj[json.key] || !confirm(tl('[OK] Just merge the file with the {0} database\n[Cancel] Clear the {0} database and replace with the file', forumLabel));
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
          updateStatusSpan(tl('Restored {0} threads', Object.keys(json.value).length));
          alert(tl('Restored {0} SmartSearch Database successfully', forumLabel));
        }, function(err) {
          alert(tl('Failed to save restored database: {0}', err && err.message ? err.message : tl('Database error')));
        });
      }, function(err) {
        alert(tl('Failed to open database for restore: {0}', err && err.message ? err.message : tl('Database error')));
      });
    };
    reader.onerror = function() {
      alert(tl('Failed to read the file'));
    };
    reader.readAsText(file);
  });

  var del = searchDiv.appendChild(document.createElement('button'));
  del.textContent = tl('Delete');
  del.style.marginLeft = '10px';
  del.addEventListener('click', function() {
    if (inProgress !== false || isUpdatingDb) {
      alert(tl('Another transaction is in progress, please wait.'));
      return;
    }
    if (!confirm(tl('This will delete the {0} ({1}) Database in the browser.\nOther forum boards will NOT be affected.\nAre you sure?', forumLabel, DB_NAME))) {
      return;
    }
    dbDelete(function() {
      var latestSettings = loadSettings();
      if (!latestSettings.forumVersions) latestSettings.forumVersions = {};
      latestSettings.forumVersions[forum] = '';
      saveSettings(latestSettings);
      settings = latestSettings;
      refreshDbButtonLabel();
      updateStatusSpan(tl('Database deleted'));
      alert(tl('Deleted {0} database.\nRefresh the page.', forumLabel));
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
      <strong style="font-size:16px;color:#fff;">${tl('⚙️ SmartSearch-Cloud Settings (v{0} — Current Board: {1})', version, forumLabel)}</strong>
      <button id="ss-set-close-top" style="background:none;border:none;color:#aaa;font-size:20px;cursor:pointer;">×</button>
    </div>

    <div style="margin-bottom:16px;">
      <span style="font-weight:bold;color:#fff;">${tl('Language: ')}</span>
      <select id="ss-language" style="background:#333;color:#fff;border:1px solid #777;padding:2px 4px;">${languageOptions}</select>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-weight:bold;color:#fff;margin-bottom:6px;">${tl('Database Update Mode')}</div>
      <label style="display:block;margin-bottom:4px;cursor:pointer;">
        <input type="radio" name="ss-sync-mode" value="full" ${settings.syncMode === 'full' ? 'checked' : ''} />
        <strong>${tl('Full Rebuild')}</strong>
        <div style="color:#aaa;font-size:12px;margin-left:22px;">${tl("Clear old threads in the current board's DB ({0}) and replace with latest Cloud DB. Your personal Ignored threads/posts &amp; Search History are preserved.", DB_NAME)}</div>
      </label>
      <label style="display:block;cursor:pointer;">
        <input type="radio" name="ss-sync-mode" value="incremental" ${settings.syncMode === 'incremental' ? 'checked' : ''} />
        <strong>${tl('Incremental Merge')}</strong>
        <div style="color:#aaa;font-size:12px;margin-left:22px;">${tl("Keep older threads already in the current board's DB ({0}) and merge/overwrite updated threads from Cloud DB.", DB_NAME)}</div>
      </label>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-weight:bold;color:#fff;margin-bottom:6px;">${tl('Independent Forum Databases &amp; Cloud Source')}</div>
      <div style="color:#bbb;font-size:12px;margin-bottom:8px;">
        ${tl('Each forum board maintains its own isolated IndexedDB database and is only downloaded when you click <strong>Update Database</strong> inside that board:')}<br/>
        • <strong>WTS (77)</strong> [SmartSearchCloudDb_77]: ${wtsVer}<br/>
        • <strong>ISK (90)</strong> [SmartSearchCloudDb_90]: ${iskVer}
      </div>
      <div style="margin-top:6px;">
        <span>${tl('GitHub Repo (owner/name): ')}</span>
        <input type="text" id="ss-github-repo" value="${escapeHtml(settings.githubRepo || '')}" placeholder="owner/repo" style="width:260px;background:#333;color:#fff;border:1px solid #777;padding:3px 6px;" />
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-weight:bold;color:#fff;margin-bottom:6px;">${tl('Search Display &amp; Thread Filtering')}</div>
      <label style="display:block;margin-bottom:6px;cursor:pointer;">
        <input type="checkbox" id="ss-exclude-pinned" ${settings.excludePinned ? 'checked' : ''} />
        <strong>${tl('Exclude Pinned Threads')}</strong>
        <div style="color:#aaa;font-size:12px;margin-left:22px;">${tl('Hide forum announcement and pinned threads from search results.')}</div>
      </label>
      <label style="display:block;margin-bottom:6px;cursor:pointer;">
        <input type="checkbox" id="ss-hide-locked" ${settings.hideLocked ? 'checked' : ''} />
        <strong>${tl('Hide Locked Threads')}</strong>
      </label>
      <label style="display:block;margin-bottom:6px;cursor:pointer;">
        <input type="checkbox" id="ss-show-strikeouts" ${settings.showStrikeouts ? 'checked' : ''} />
        <strong>${tl('Show Strikeouts')}</strong>
      </label>
      <label style="display:block;margin-bottom:6px;cursor:pointer;">
        <input type="checkbox" id="ss-wild-guess" ${settings.wildGuess ? 'checked' : ''} />
        <strong>${tl('Wild Guess Price')}</strong>
      </label>
      <div style="margin-top:6px;">
        <span>${tl('Highlight posts older than (days): ')}</span>
        <input type="number" id="ss-days-limit" value="${daysLimitVal}" min="1" max="3650" style="width:60px;background:#333;color:#fff;border:1px solid #777;padding:2px 4px;" />
      </div>
    </div>

    <div style="border:1px solid #bbb;background:#2b2e32;padding:12px;margin-bottom:16px;">
      <div style="font-weight:bold;color:#fff;margin-bottom:4px;text-align:center;">${tl('Priority Shops')}</div>
      <div style="color:#aaa;font-size:12px;text-align:center;">${tl('Their lines are listed first in the search results, in this order. Drag ☰ to reorder.')}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:4px;">
        <thead>
          <tr style="border:none;color:#ddd;font-size:12px;">
            <th style="padding:4px;width:30px;"></th>
            <th style="text-align:center;padding:4px;">${tl('Shop Owner Name')}</th>
            <th style="text-align:center;padding:4px;">UID</th>
            <th style="text-align:center;padding:4px;width:40px;"></th>
          </tr>
        </thead>
        <tbody id="ss-priority-tbody"></tbody>
      </table>
      <div style="text-align:center;margin-top:10px;">
        <button id="ss-add-priority" style="background:#3a3d42;color:#fff;border:1px solid #999;border-radius:4px;padding:4px 16px;cursor:pointer;">${tl('Add Shop')}</button>
      </div>
    </div>

    <div style="border:1px solid #bbb;background:#2b2e32;padding:12px;margin-bottom:16px;">
      <div style="font-weight:bold;color:#fff;margin-bottom:8px;text-align:center;">${tl('Excluded Poster UIDs / Names')}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:4px;" id="ss-excluded-table">
        <thead>
          <tr style="border:none;color:#ddd;font-size:12px;">
            <th style="text-align:center;padding:4px;">${tl('Display Name')}</th>
            <th style="text-align:center;padding:4px;">UID</th>
            <th style="text-align:center;padding:4px;width:70px;">${tl('Active?')}</th>
            <th style="text-align:center;padding:4px;width:40px;"></th>
          </tr>
        </thead>
        <tbody id="ss-excluded-tbody"></tbody>
      </table>
      <div style="text-align:center;margin-top:10px;">
        <button id="ss-add-excluded" style="background:#3a3d42;color:#fff;border:1px solid #999;border-radius:4px;padding:4px 16px;cursor:pointer;">${tl('Add User')}</button>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #555;padding-top:12px;">
      <button id="ss-set-sync-now" style="background:#2d6a7a;color:#fff;border:1px solid #5bc0de;padding:6px 14px;cursor:pointer;">${tl('Save &amp; Update {0} DB Now', forumLabel)}</button>
      <button id="ss-set-save" style="background:#3a5a40;color:#fff;border:1px solid #70a288;padding:6px 16px;cursor:pointer;">${tl('Save Settings')}</button>
      <button id="ss-set-cancel" style="background:#444;color:#ddd;border:1px solid #777;padding:6px 14px;cursor:pointer;">${tl('Close')}</button>
    </div>
  `;

  var tbody = panel.querySelector('#ss-excluded-tbody');

  function addExcludedRow(userObj) {
    var tr = document.createElement('tr');
    tr.style.border = 'none';
    tr.innerHTML = `
      <td style="padding:4px;text-align:center;">
        <input type="text" class="ss-ex-name" value="${escapeHtml(userObj.displayName || '')}" placeholder="${escapeHtml(tl('Seller Name'))}" style="width:90%;background:#fff;color:#000;border:1px solid #888;padding:3px 6px;" />
      </td>
      <td style="padding:4px;text-align:center;">
        <input type="text" class="ss-ex-uid" value="${escapeHtml(userObj.uid || '')}" placeholder="UID" style="width:85%;background:#999;color:#222;border:1px solid #888;padding:3px 6px;" />
      </td>
      <td style="padding:4px;text-align:center;">
        <input type="checkbox" class="ss-ex-active" ${userObj.active !== false ? 'checked' : ''} style="cursor:pointer;" />
      </td>
      <td style="padding:4px;text-align:center;">
        <button type="button" class="ss-ex-remove" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;" title="${escapeHtml(tl('Remove'))}">×</button>
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

  // Priority Shops (SMS-USR-088): rows are reordered by dragging the ☰ handle; the list is saved in this order
  var priorityBody = panel.querySelector('#ss-priority-tbody');
  var draggingRow = null;
  function addPriorityRow(shop) {
    var tr = document.createElement('tr');
    tr.style.border = 'none';
    tr.innerHTML = `
      <td style="padding:4px;text-align:center;">
        <span class="ss-pr-handle" draggable="true" title="${escapeHtml(tl('Drag to reorder'))}" style="cursor:grab;font-size:16px;color:#ccc;user-select:none;">☰</span>
      </td>
      <td style="padding:4px;text-align:center;">
        <input type="text" class="ss-pr-name" value="${escapeHtml(shop.displayName || '')}" placeholder="${escapeHtml(tl('Shop Owner Name'))}" style="width:90%;background:#fff;color:#000;border:1px solid #888;padding:3px 6px;" />
      </td>
      <td style="padding:4px;text-align:center;">
        <input type="text" class="ss-pr-uid" value="${escapeHtml(shop.uid || '')}" placeholder="UID" style="width:85%;background:#999;color:#222;border:1px solid #888;padding:3px 6px;" />
      </td>
      <td style="padding:4px;text-align:center;">
        <button type="button" class="ss-pr-remove" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;" title="${escapeHtml(tl('Remove'))}">×</button>
      </td>
    `;
    var handle = tr.querySelector('.ss-pr-handle');
    handle.addEventListener('dragstart', function(e) {
      draggingRow = tr;
      tr.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ''); // Firefox starts a drag only with data
      if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(tr, 10, 10);
    });
    handle.addEventListener('dragend', function() {
      tr.style.opacity = '';
      draggingRow = null;
    });
    tr.addEventListener('dragover', function(e) {
      if (!draggingRow || draggingRow === tr) return;
      e.preventDefault();
      var box = tr.getBoundingClientRect();
      priorityBody.insertBefore(draggingRow, e.clientY < box.top + box.height / 2 ? tr : tr.nextSibling);
    });
    tr.addEventListener('drop', function(e) {
      e.preventDefault();
    });
    tr.querySelector('.ss-pr-remove').addEventListener('click', function() {
      priorityBody.removeChild(tr);
    });
    priorityBody.appendChild(tr);
  }

  settings.priorityShops.forEach(addPriorityRow);

  panel.querySelector('#ss-add-priority').addEventListener('click', function() {
    addPriorityRow({ displayName: '', uid: '' });
  });

  function collectAndSave() {
    var rawRepo = panel.querySelector('#ss-github-repo').value.trim();
    var repoVal = rawRepo ? normalizeGithubRepo(rawRepo) : DEFAULT_SETTINGS.githubRepo;
    if (!repoVal) {
      alert(tl('Invalid GitHub Repo format. Expected "owner/repo" (or full GitHub repo URL).'));
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
    var shops = [];
    [].forEach.call(priorityBody.querySelectorAll('tr'), function(tr) {
      var shopName = tr.querySelector('.ss-pr-name').value.trim();
      var shopUid = tr.querySelector('.ss-pr-uid').value.trim();
      if (shopName || shopUid) shops.push({ displayName: shopName, uid: shopUid });
    });
    settings.priorityShops = shops;
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

  // Switching the language saves the panel and reloads the forum page, so every label uses it (SMS-USR-087)
  panel.querySelector('#ss-language').addEventListener('change', function() {
    if (!collectAndSave()) return;
    window.location.reload();
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
    var err = new Error(tl('Error deleting db {0}', event && event.target && event.target.errorCode));
    error(err.message);
    if (typeof onError === 'function') onError(err);
  };
  DBDeleteRequest.onblocked = function() {
    if (settled) return;
    settled = true;
    inProgress = false;
    var err = new Error(tl('Blocked deleting db {0}', DB_NAME));
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
    fail(tl('{0}: JSON stringify failed {1}', 'dbSet', e && e.message ? e.message : String(e)));
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
    fail(tl('{0}: Database blocked', 'dbSet'));
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
      fail(tl('{0}: Error on putReq {1}', 'dbSet', event && event.target && event.target.errorCode));
    };
    transaction.onerror = function(event) {
      try { db.close(); } catch (e) {}
      fail(tl('{0}: Error on transaction {1}', 'dbSet', event && event.target && event.target.errorCode));
    };
    transaction.onabort = function(event) {
      try { db.close(); } catch (e) {}
      fail(tl('{0}: Transaction aborted {1}', 'dbSet', event && event.target && event.target.errorCode));
    };
  };
  dbRequest.onerror = function(event) {
    fail(tl('{0}: Error opening db {1}', 'dbSet', event && event.target && event.target.errorCode));
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
    fail(tl('{0}: Database blocked', 'dbGet'));
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
        fail(tl('{0}: Failed to parse stored JSON', 'dbGet'));
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
      fail(tl('{0}: Error on getRequest {1}', 'dbGet', event && event.target && event.target.errorCode));
    };
    transaction.onerror = function(event) {
      try { db.close(); } catch (e) {}
      fail(tl('{0}: Error on transaction {1}', 'dbGet', event && event.target && event.target.errorCode));
    };
    transaction.onabort = function(event) {
      try { db.close(); } catch (e) {}
      fail(tl('{0}: Transaction aborted {1}', 'dbGet', event && event.target && event.target.errorCode));
    };
  };
  dbRequest.onerror = function(event) {
    fail(tl('{0}: Error opening db {1}', 'dbGet', event && event.target && event.target.errorCode));
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
