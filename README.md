# SmartSearch-Cloud

A userscript for searching the equipment listed in the E-Hentai forums' WTS and Isekai Trade boards.
It downloads a ready-made database from this repo's Releases instead of crawling the forums in your browser.

搜尋 E-Hentai 論壇 WTS 與 Isekai Trade 版塊裝備的使用者腳本。
它從本 repo 的 Releases 下載整理好的資料庫，不需要在瀏覽器裡自己爬論壇。

## Install / 安裝

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser and finish the setup it asks for
   (some browsers require you to allow userscripts / extensions developer mode).
   安裝瀏覽器用的 Tampermonkey，並完成它要求的設定（部分瀏覽器需要允許執行使用者腳本或開啟擴充功能的開發人員模式）。
2. If you installed the earlier "HV SmartSearch" 2.x cloud edition, remove it in Tampermonkey first.
   Otherwise both scripts run and you get two search bars.
   如果裝過早期的「HV SmartSearch」2.x 雲端版，請先在 Tampermonkey 移除，否則兩支腳本會同時執行、出現兩組搜尋列。
3. Open [Install SmartSearch-Cloud](https://raw.githubusercontent.com/ericericsw/eric-s-SmartSearch/main/SmartSearch.user.js).
   開啟上面的安裝連結。
4. Click **Install** in Tampermonkey.
   在 Tampermonkey 的畫面按 **Install（安裝）**。
5. Open the WTS or Isekai Trade board and click **Update Database** once to download that board's database.
   開啟 WTS 或 Isekai Trade 版塊，按一次 **Update Database** 下載該版塊的資料庫。

If the link only shows the source code, Tampermonkey is not enabled or not allowed to run userscripts yet.
Check its settings, then open the link again.

如果連結只顯示原始碼，表示 Tampermonkey 尚未啟用或還不能執行使用者腳本；請檢查設定後再開一次連結。

## Updates / 更新

- The install link never changes. Tampermonkey checks it for new versions on its own and updates the script.
  安裝連結不會變。Tampermonkey 會自動從這個連結檢查新版並更新。
- To check right away: open the Tampermonkey menu and choose **Check for userscript updates**.
  想立即檢查：開啟 Tampermonkey 選單，選 **Check for userscript updates（檢查使用者腳本更新）**。
- The database is separate from the script. Click **Update Database** on a board to get its newest data;
  the button shows the version you are using and skips the download when you are already up to date.
  資料庫與腳本分開更新：在版塊頁按 **Update Database** 取得最新資料；按鈕會顯示目前使用的版本，已是最新時不會重複下載。

For maintainers: every script release must raise `@version` and replace `SmartSearch.user.js` on `main`.
The database Releases are published by the server; do not edit or delete them by hand.

維護者：每次發布腳本都要調高 `@version`，並覆蓋 `main` 上的 `SmartSearch.user.js`。
資料庫 Releases 由伺服器自動發布，請勿手動修改或刪除。

## Database / 資料庫

- A server reads the thread starter's posts (up to post #20) of every visible thread in WTS and Isekai Trade
  about every 6 hours, looks up each linked equipment on HentaiVerse, and publishes one Release named
  `SmartSearch DB <version>`. Each Release holds `SmartSearch_77.json` (WTS), `SmartSearch_90.json` (Isekai Trade),
  a compressed `.json.gz` copy of each, and `manifest.json`.
  伺服器約每 6 小時讀取 WTS 與 Isekai Trade 每個可見討論串的樓主貼文（最多到第 20 樓），向 HentaiVerse 查詢貼文中連結的裝備，
  再發布一個名為 `SmartSearch DB <版本號>` 的 Release，內含 `SmartSearch_77.json`（WTS）、`SmartSearch_90.json`（Isekai Trade）、
  兩者的 `.json.gz` 壓縮版，以及 `manifest.json`。
- The script downloads only the board you are viewing, preferring the compressed copy (about 0.7 MB for WTS).
  腳本只下載你正在看的版塊，並優先下載壓縮版（WTS 約 0.7 MB）。
- Equipment is re-checked on HentaiVerse every 5-9 days, so a sold item can stay listed for a few days.
  裝備每 5～9 天會向 HentaiVerse 重查一次，已售出的裝備可能還會顯示幾天。

## Features / 功能

- **Filter Search** searches your keyword right away; **Open Search Window** opens an empty search tab so you can set the conditions first.
  **Filter Search** 直接用關鍵字搜尋；**Open Search Window** 開啟空白搜尋分頁，先設定條件再搜尋。
- Results open in a new browser tab with a filter bar that stays at the top. Conditions are applied when you press **Search**.
  搜尋結果開在新分頁，篩選列會固定在頂端；條件在按下 **Search** 時才套用。
- **Equipment filter**: Category, Type, Prefix, Suffix, Slot and Primary attributes. Choices that cannot occur with what you picked are greyed out.
  **Equipment filter**：分類、類型、字首、字尾、部位與主屬性；與已選條件不可能同時成立的選項會反灰。
- Quality, Level, Price and ROLL % (base percentage) ranges, and sorting by post time, price, level or ROLL %.
  品質、等級、價格、ROLL %（Base 百分比）範圍篩選，並可依貼文時間、價格、等級或 ROLL % 排序。
- **Show Stats** adds Quality, Type, PAB, ROLL % and Base avg columns.
  **Show Stats** 會加上品質、類型、PAB、ROLL %、Base avg 欄位。
- In WTS, only lines that link a Tradeable equipment held by the poster are shown.
  WTS 只列出連到 Tradeable 裝備、且裝備仍在發文者手上的行。
- Lowest EID and thread title filters, Ignore for threads and posts, and Backup / Restore / Delete for each board's database.
  Lowest EID 與討論串標題過濾、忽略討論串或貼文，以及各版塊資料庫的備份／還原／刪除。
- Settings: Full Rebuild or Incremental update, exclude pinned threads, hide locked threads, show struck-out lines,
  wild guess prices without units, highlight old posts, and a list of posters (UID or name) to exclude.
  設定：完全重建或增量合併、排除置頂討論串、隱藏已鎖定討論串、顯示被刪除線劃掉的行、寬鬆猜測沒有單位的價格、標示過舊的貼文，以及要排除的發文者（UID 或名稱）。

It only activates on the WTS (77) and Isekai Trade (90) boards. WTB is not supported for now.
只在 WTS（77）與 Isekai Trade（90）版塊啟用，WTB 暫不支援。

Your settings and databases stay in your browser. The script does not read or change the original SmartSearch's data.
設定與資料庫都只存在你的瀏覽器裡；本腳本不會讀取或修改原版 SmartSearch 的資料。

## Credits / 致謝

Based on [SmartSearch](https://forums.e-hentai.org/index.php?showtopic=211111) by Superlatanium (original author),
with the modified version by nekolor. The search page, wildcard and regular-expression search, Lowest EID,
thread title filters and Ignore all come from the original script. Thank you both.

本腳本以 [SmartSearch](https://forums.e-hentai.org/index.php?showtopic=211111) 為基礎改寫。
搜尋頁面、萬用字元與正規表示式搜尋、Lowest EID、討論串標題過濾與忽略功能都來自原版。
感謝原作者 Superlatanium，以及提供修改版的 nekolor。

## License

[Apache License 2.0](LICENSE)
