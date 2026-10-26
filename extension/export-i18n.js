(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSAExportI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Report language is explicit and independent of the currently open UI.
  // These templates receive raw values; escaping belongs to the HTML/Markdown
  // renderer. Never translate a finished document or arbitrary user content.
  const messages = {};
  function add(source, english, simplified) { messages[source] = Object.freeze({en:english, 'zh-CN':simplified}); }
  add('MSA 對局分析資料', 'MSA match analysis record', 'MSA 对局分析资料');
  add('MSA 完整觀察紀錄', 'MSA complete observation record', 'MSA 完整观察记录');
  add('對局：{0}', 'Game: {0}', '对局：{0}');
  add('我的玩家名稱：{0}', 'My player name: {0}', '我的玩家名称：{0}');
  add('對局 {0} · 玩家 {1}', 'Game {0} · Player {1}', '对局 {0} · 玩家 {1}');
  add('公開紀錄：{0}', 'Public Log: {0}', '公开记录：{0}');
  add('已觀察到 Game started 至 Game ended 的連續公開紀錄。', 'A continuous public Log from Game started to Game ended was observed.', '已观察到 Game started 至 Game ended 的连续公开记录。');
  add('部分或仍在進行；請確認 coverage 與擷取警告。', 'Partial or still in progress; check coverage and capture warnings.', '部分或仍在进行；请确认 coverage 与撷取警告。');
  add('手牌首末代表該回合「第一次／最後一次觀察」，不保證是真正回合開始／結束手牌。', 'First/last hands are the first/last observations in a turn, not necessarily the hands at the actual turn boundaries.', '手牌首末代表该回合「第一次／最后一次观察」，不保证是真正回合开始／结束手牌。');
  add('公開事件的 capturedAt 是擷取時間，不是事件發生時間；不把手牌數量差推論成出牌、抽牌或棄牌。', 'Public-event capturedAt is the capture time, not the event time. Hand-count changes do not establish plays, draws or discards.', '公开事件的 capturedAt 是撷取时间，不是事件发生时间；不把手牌数量差推论成出牌、抽牌或弃牌。');
  add('公開部署／使用事件未必來自手牌；token 生成不列為手牌出牌。對手隱藏手牌未知。', 'Public deployments/uses may not come from hand; token generation is not a hand play. Hidden opponent hands are unknown.', '公开部署／使用事件未必来自手牌；token 生成不列为手牌出牌。对手隐藏手牌未知。');
  add('匯出前刷新：{0}', 'Pre-export refresh: {0}', '导出前刷新：{0}');
  add('匯出時間：{0}', 'Exported at: {0}', '导出时间：{0}');
  add('匯出 {0} · 手牌快照 {1} 筆 · 公開事件 {2} 筆', 'Exported {0} · {1} hand snapshots · {2} public events', '导出 {0} · 手牌快照 {1} 笔 · 公开事件 {2} 笔');
  add('警告：{0}', 'Warning: {0}', '警告：{0}');
  add('已見開局與結束，未標出已知公開紀錄缺口。', 'Start and end markers observed; no known public Log gaps are flagged.', '已见开局与结束，未标出已知公开记录缺口。');
  add('公開紀錄仍有缺口或未見完整起尾，不能稱為整場完整。', 'The public Log has gaps or lacks start/end markers; it cannot be called a complete match record.', '公开记录仍有缺口或未见完整起尾，不能称为整场完整。');
  add(' 每筆手牌皆是觀察，不能保證捕捉了每次變動；最早／最晚不等於真正回合起訖。數量差不代表已確認的抽牌、出牌或棄牌。', ' Each hand is an observation; not every change is guaranteed to have been captured. Earliest/latest observations are not actual turn boundaries. Count changes do not confirm draws, plays or discards.', ' 每笔手牌皆是观察，不能保证捕捉了每次变动；最早／最晚不等于真正回合起讫。数量差不代表已确认的抽牌、出牌或弃牌。');
  add('手牌擷取缺口', 'Hand capture gaps', '手牌撷取缺口');
  add('以下缺口獨立於公開 Log 涵蓋狀態；即使公開 Log 已見完整起尾，未存入的手牌觀察仍不可還原。', 'These gaps are independent of public Log coverage. Even with complete public start/end markers, unsaved hand observations cannot be recovered.', '以下缺口独立于公开 Log 涵盖状态；即使公开 Log 已见完整起尾，未存入的手牌观察仍不可还原。');
  add('以下缺口獨立於公開 Log 涵蓋狀態；公開 Log 完整也不能補回未存入的手牌觀察。', 'These gaps are independent of public Log coverage. A complete public Log cannot recover unsaved hand observations.', '以下缺口独立于公开 Log 涵盖状态；公开 Log 完整也不能补回未存入的手牌观察。');
  add('手牌擷取缺口：來源段落 {0}；觀察時間 {1}；代碼 {2}{3}；{4}。公開 Log 的完整性不能補回這段手牌觀察缺口。', 'Hand capture gap: source segment {0}; observed at {1}; code {2}{3}; {4}. A complete public Log cannot recover this gap in hand observations.', '手牌撷取缺口：来源段落 {0}；观察时间 {1}；代码 {2}{3}；{4}。公开 Log 的完整性不能补回这段手牌观察缺口。');
  add('；待存觀察 {0} 筆', '; {0} pending observations', '；待存观察 {0} 笔');
  add('原始欄位：{0}', 'Original fields: {0}', '原始字段：{0}');
  add('缺口原始欄位', 'Original gap fields', '缺口原始字段');
  add('開局或無法歸屬回合的公開事件', 'Setup or unassigned public events', '开局或无法归属回合的公开事件');
  add('開局前／未標回合事件', 'Before start / events without a turn', '开局前／未标回合事件');
  add('觀察回合 {0}（未對齊絕對回合）', 'Observed turn {0} (not aligned to an absolute turn)', '观察回合 {0}（未对齐绝对回合）');
  add('觀察回合 {0}（未校準）', 'Observed turn {0} (unaligned)', '观察回合 {0}（未校准）');
  add('推計第 {0} 回合', 'Estimated turn {0}', '推计第 {0} 回合');
  add('第 {0} 回合', 'Turn {0}', '第 {0} 回合');
  add('行動方：{0}（{1}）', 'Active player: {0} ({1})', '行动方：{0}（{1}）');
  add('行動方：{0} · 來源 {1} · {2} 筆手牌觀察', 'Active player: {0} · Source {1} · {2} hand observations', '行动方：{0} · 来源 {1} · {2} 笔手牌观察');
  add('手牌對齊：{0}；觀察數：{1}', 'Hand alignment: {0}; observations: {1}', '手牌对齐：{0}；观察数：{1}');
  add('首次手牌觀察：{0}', 'First hand observation: {0}', '首次手牌观察：{0}');
  add('最後手牌觀察：{0}', 'Last hand observation: {0}', '最后手牌观察：{0}');
  add('全部手牌快照', 'All hand snapshots', '全部手牌快照');
  add('未記錄手牌快照，不代表空手。', 'No hand snapshots recorded; this does not mean an empty hand.', '未记录手牌快照，不代表空手。');
  add('未觀察到手牌，不代表空手。', 'No hand observed; this does not mean an empty hand.', '未观察到手牌，不代表空手。');
  add('手牌快照 {0}', 'Hand snapshot {0}', '手牌快照 {0}');
  add('手牌快照 {0}：{1}', 'Hand snapshot {0}: {1}', '手牌快照 {0}：{1}');
  add('快照差值：{0}', 'Snapshot difference: {0}', '快照差值：{0}');
  add('公開事件', 'Public events', '公开事件');
  add('雙方公開事件與原文', 'Both players’ public events and original text', '双方公开事件与原文');
  add('未取得可對齊的公開事件。', 'No public events available for alignment.', '未取得可对齐的公开事件。');
  add('未取得可對齊的公開事件；不代表沒有行動。', 'No aligned public events available; this does not mean no action occurred.', '未取得可对齐的公开事件；不代表没有行动。');
  add('未合併擷取原文（先後次序待確認）', 'Unmerged capture originals (order unconfirmed)', '未合并撷取原文（先后次序待确认）');
  add('未合併擷取原文（先後順序待確認）', 'Unmerged capture originals (order unconfirmed)', '未合并撷取原文（先后顺序待确认）');
  add('擷取時間：{0}', 'Captured at: {0}', '撷取时间：{0}');
  add('原因：{0}', 'Reason: {0}', '原因：{0}');
  add('首次擷取 {0}；不是事件發生時間', 'First captured {0}; this is not the event time', '首次撷取 {0}；不是事件发生时间');
  add(' ｜卡牌：{0}', ' | Cards: {0}', ' ｜卡牌：{0}');
  add('{0}：{1}', '{0}: {1}', '{0}：{1}');
  add('未記錄；不可還原當時手牌。', 'Not recorded; the hand at that time cannot be recovered.', '未记录；不可还原当时手牌。');
  add('已觀察到空手', 'An empty hand was observed', '已观察到空手');
  add('已觀察到空手。', 'An empty hand was observed.', '已观察到空手。');
  add('未辨識 {0} 張', '{0} unrecognized cards', '未辨识 {0} 张');
  add('未知張數，並非確認空手', 'Unknown card count; an empty hand is not confirmed', '未知张数，并非确认空手');
  add('沒有可確認卡號，不能視為空手', 'No confirmed card codes; do not treat this as an empty hand', '没有可确认卡号，不能视为空手');
  add('沒有可確認卡號，不能視為空手。', 'No confirmed card codes; do not treat this as an empty hand.', '没有可确认卡号，不能视为空手。');
  add('{0}；品質 {1}；觀察時間 {2}；回合來源 {3}{4}；階段 {5}；{6}{7}', '{0}; quality {1}; observed at {2}; turn source {3}{4}; phase {5}; {6}{7}', '{0}；品质 {1}；观察时间 {2}；回合来源 {3}{4}；阶段 {5}；{6}{7}');
  add('；記錄段落 {0}', '; record segment {0}', '；记录段落 {0}');
  add('；原因 {0}', '; reason {0}', '；原因 {0}');
  add('等級 {0} · 一般可用 {1} · EX 可用 {2} · 合計 {3}', 'Level {0} · Active {1} · Active EX {2} · Total {3}', '等级 {0} · 一般可用 {1} · EX 可用 {2} · 合计 {3}');
  add('資源未辨識', 'Resources unrecognized', '资源未辨识');
  add('回合 {0} · 回合來源 {1} · 觀察回合 {2} · 階段 {3} · 來源段落 {4}', 'Turn {0} · Turn source {1} · Observed turn {2} · Phase {3} · Source segment {4}', '回合 {0} · 回合来源 {1} · 观察回合 {2} · 阶段 {3} · 来源段落 {4}');
  add('品質 {0} · 已辨識 {1} · 預期 {2} · 未辨識 {3}', 'Quality {0} · Recognized {1} · Expected {2} · Unrecognized {3}', '品质 {0} · 已辨识 {1} · 预期 {2} · 未辨识 {3}');
  add('辨識原因：{0}', 'Recognition reason: {0}', '辨识原因：{0}');
  add('首筆觀察，沒有可比較的前一筆。', 'First observation; no previous observation to compare.', '首笔观察，没有可比较的前一笔。');
  add('不同來源段落，不跨段推算手牌差值。', 'Different source segments; hand differences are not inferred across segments.', '不同来源段落，不跨段推算手牌差值。');
  add('相鄰觀察含不完整或未知手牌，不推算差值。', 'Adjacent observations include incomplete or unknown hands; no difference is inferred.', '相邻观察含不完整或未知手牌，不推算差值。');
  add('與前一筆完整觀察相比，卡號與數量未變。', 'Card codes and counts are unchanged from the previous complete observation.', '与前一笔完整观察相比，卡号与数量未变。');
  add('與前一筆完整觀察相比：{0}。僅表示觀察數量差，進出原因未知。', 'Compared with the previous complete observation: {0}. These are observed count changes only; their causes are unknown.', '与前一笔完整观察相比：{0}。仅表示观察数量差，进出原因未知。');
  add('書籤與筆記', 'Bookmarks and notes', '书签与笔记');
  add('僅顯示本玩家、本次來源段落的有效筆記；已刪除筆記不列在閱讀內容。', 'Only active notes for this player and these source segments are shown. Deleted notes are excluded from the readable report.', '仅显示本玩家、本次来源段落的有效笔记；已删除笔记不列在阅读内容。');
  add('僅顯示本玩家、本次來源段落的有效筆記；已刪除筆記只保留於匯出資訊原始資料。', 'Only active notes for this player and these source segments are shown. Deleted notes remain only in the original export metadata.', '仅显示本玩家、本次来源段落的有效笔记；已删除笔记只保留于导出信息原始资料。');
  add('本次來源段落沒有有效筆記。', 'No active notes in these source segments.', '本次来源段落没有有效笔记。');
  add('玩家身分或來源段落未確認，不顯示筆記。', 'Player identity or source segments are unconfirmed; notes are not shown.', '玩家身份或来源段落未确认，不显示笔记。');
  add('未設標籤', 'Untagged', '未设标签');
  add('（未填寫筆記）', '(No note text)', '（未填写笔记）');
  add('建立 {0} · 更新 {1}', 'Created {0} · Updated {1}', '建立 {0} · 更新 {1}');
  add('Log 校準 · T{0}', 'Log-aligned · T{0}', 'Log 校准 · T{0}');
  add('推計回合 · T{0}', 'Estimated turn · T{0}', '推计回合 · T{0}');
  add('觀察 {0} · 回合未校準', 'Observation {0} · Turn unaligned', '观察 {0} · 回合未校准');
  add('回合未校準', 'Turn unaligned', '回合未校准');
  add('來源段落 {0} · 來源快照 {1}{2}', 'Source segment {0} · Source snapshot {1}{2}', '来源段落 {0} · 来源快照 {1}{2}');
  add('；來源快照未在本次匯出中，不改接其他回合。', '; the source snapshot is absent from this export and is not reassigned to another turn.', '；来源快照未在本次导出中，不改接其他回合。');
  add('人工戰績與牌組', 'Manual result and deck', '人工战绩与牌组');
  add('尚無本玩家可顯示的最新人工確認結果；不從公開事件猜測勝負。', 'No latest manually confirmed result is available for this player. Results are not guessed from public events.', '尚无本玩家可显示的最新人工确认结果；不从公开事件猜测胜负。');
  add('結果來源段落：{0}', 'Result source segment: {0}', '结果来源段落：{0}');
  add('未提供可核對的綁定牌組版本。', 'No verifiable linked deck version was provided.', '未提供可核对的绑定牌组版本。');
  add('人工確認結果：{0} · {1} · 確認更新 {2}。這是整局人工記錄，不是依 Log 自動推定。', 'Manually confirmed result: {0} · {1} · Confirmation updated {2}. This is a manual record for the whole game, not an automatic inference from the Log.', '人工确认结果：{0} · {1} · 确认更新 {2}。这是整局人工记录，不是依 Log 自动推定。');
  add('勝', 'Win', '胜');
  add('負', 'Loss', '负');
  add('和局', 'Draw', '和局');
  add('本人投降（負）', 'Conceded (loss)', '本人投降（负）');
  add('先手', 'First', '先手');
  add('後手', 'Second', '后手');
  add('先後手未確認', 'Play order unconfirmed', '先后手未确认');
  add('牌組：{0} · 版本 {1} · 主牌 {2} · 資源 {3} · Token {4} · 內容識別 {5}。此摘要不驗證賽制合法性。', 'Deck: {0} · Version {1} · Main {2} · Resources {3} · Tokens {4} · Content ID {5}. This summary does not validate format legality.', '牌组：{0} · 版本 {1} · 主牌 {2} · 资源 {3} · Token {4} · 内容标识 {5}。此摘要不验证赛制合法性。');
  add('{0} 張', '{0} cards', '{0} 张');
  add('此匯出未提供刷新結果；只保留當時已儲存資料。', 'No refresh result was provided for this export; only data already saved at the time is included.', '此导出未提供刷新结果；只保留当时已保存资料。');
  add('已刷新，但仍有部分資料未確認', 'Refreshed, but some data remains unconfirmed', '已刷新，但仍有部分资料未确认');
  add('已完成匯出前刷新', 'Pre-export refresh completed', '已完成导出前刷新');
  add('未能確認刷新，匯出既有資料', 'Refresh unconfirmed; exporting existing data', '未能确认刷新，导出既有资料');
  add('{0}{1}。刷新成功也不表示所有歷史手牌均已記錄。', '{0}{1}. A successful refresh does not mean every historical hand was recorded.', '{0}{1}。刷新成功也不表示所有历史手牌均已记录。');
  add('：{0}', ': {0}', '：{0}');
  add('完整原始資料 JSON（全部快照、Battle Log 與原有欄位）', 'Complete original JSON (all snapshots, Battle Log and original fields)', '完整原始资料 JSON（全部快照、Battle Log 与原有字段）');
  add('此報告只保留已觀察與已擷取的內容，不補造未記錄手牌。下方非執行型 JSON 可供工具重新讀取；原始資料位於 msa-record-data，匯出資訊位於 msa-export-info。', 'This report preserves only observed and captured content; unrecorded hands are not invented. The non-executable JSON below can be reimported: original data is in msa-record-data and export metadata in msa-export-info.', '此报告只保留已观察与已撷取的内容，不补造未记录手牌。下方非执行型 JSON 可供工具重新读取；原始资料位于 msa-record-data，导出信息位于 msa-export-info。');
  add('未知', 'Unknown', '未知');
  add('時間未知', 'Time unknown', '时间未知');
  add('未標示', 'Not specified', '未标示');
  add('未提供', 'Not provided', '未提供');
  add('未辨識', 'Unrecognized', '未辨识');
  add('未確認', 'Unconfirmed', '未确认');
  add('未命名', 'Unnamed', '未命名');
  add('原因未提供', 'Reason not provided', '原因未提供');
  add('系統', 'System', '系统');
  add('玩家未標示', 'Player not specified', '玩家未标示');
  add('無 ID', 'No ID', '无 ID');
  add('；', '; ', '；');
  add('、', ', ', '、');

  // Only these exact recorder-authored reasons/warnings may be translated.
  // Unknown reasons, arbitrary prefixes and all raw records remain verbatim.
  const reasonKeys = [];
  function reason(source, english, simplified) { add(source, english, simplified); reasonKeys.push(source); }
  reason('公開紀錄已出現的前綴與新擷取不一致；新原文保留在 captures，未覆寫既有事件。', 'The existing public Log prefix differs from the new capture. New originals remain in captures; existing events were not overwritten.', '公开记录已出现的前缀与新撷取不一致；新原文保留在 captures，未覆写既有事件。');
  reason('完整起點擷取無法與既有部分紀錄對齊；新原文保留在 captures，未推測事件次序。', 'The capture from the start cannot be aligned with the existing partial Log. New originals remain in captures; event order was not inferred.', '完整起点撷取无法与既有部分记录对齐；新原文保留在 captures，未推测事件次序。');
  reason('新擷取與既有公開紀錄沒有可確認的重疊；原文保留在 captures，未推測其先後順序。', 'No confirmed overlap exists between the new capture and the existing public Log. Originals remain in captures; their order was not inferred.', '新撷取与既有公开记录没有可确认的重叠；原文保留在 captures，未推测其先后顺序。');
  reason('擷取標示從開局開始，但首行並非 Game started!；仍視為部分公開紀錄。', 'The capture is marked as starting at game start, but its first line is not Game started! It remains a partial public Log.', '撷取标示从开局开始，但首行并非 Game started!；仍视为部分公开记录。');
  reason('頁面／設定切換時仍有觀察尚未確認存妥；已隔離舊暫存', 'Some observations were not confirmed saved when the page/settings changed; the old buffer was quarantined', '页面／设置切换时仍有观察尚未确认存妥；已隔离旧暂存');
  reason('頁面或記錄設定切換時仍有觀察尚未確認存妥；舊暫存已隔離，未送往其他對局', 'Some observations were not confirmed as saved when the page or settings changed. The old buffer was quarantined and not sent to another match', '页面或记录设置切换时仍有观察尚未确认存妥；旧暂存已隔离，未送往其他对局');
  reason('暫存已滿，部分已觀察狀態未能排入儲存佇列', 'Buffer full. Some observed states could not be queued for saving', '暂存已满，部分已观察状态未能排入保存伫列');
  reason('部分觀察格式被拒絕，已隔離原件；有效觀察繼續保存，請在原分頁下載救援備份', 'Some observation formats were rejected and originals quarantined. Valid observations continue saving. Download a rescue backup in the original tab', '部分观察格式被拒绝，已隔离原件；有效观察继续保存，请在原分页下载救援备份');
  reason('已更新可見公開 Log；完整範圍依覆蓋標記判定', 'Visible public Log updated; coverage markers determine the confirmed scope', '已更新可见公开 Log；完整范围依覆盖标记判定');
  reason('記錄已暫停', 'Recording paused', '记录已暂停');
  reason('頁面已切換對局，未繼續操作', 'The page changed games; the operation stopped', '页面已切换对局，未继续操作');
  reason('本頁玩家與匯出玩家不符', 'The page player does not match the exported player', '本页玩家与导出玩家不符');
  reason('玩家正在操作或輸入；請停止操作後再更新', 'The player is interacting or typing; wait until idle before updating', '玩家正在操作或输入；请停止操作后再更新');
  reason('正在攻擊／選擇動作；請回主階段後再更新', 'An attack/action selection is in progress; return to the main phase before updating', '正在攻击／选择动作；请回主阶段后再更新');
  reason('找不到已驗證的 Battle Log 控制項，請手動開啟 L 後重試', 'No verified Battle Log control was found; open L manually and retry', '找不到已验证的 Battle Log 控件，请手动开启 L 后重试');
  reason('其他視窗開啟中，未操作 Battle Log', 'Another dialog is open; Battle Log was not operated', '其他窗口开启中，未操作 Battle Log');
  reason('收錄期間偵測到操作，已停止自動控制', 'Interaction was detected during capture; automatic control stopped', '收录期间检测到操作，已停止自动控制');
  reason('未讀到可見公開 Log，請手動開啟 L 後重試', 'No visible public Log was read; open L manually and retry', '未读到可见公开 Log，请手动开启 L 后重试');
  reason('公開 Log 仍在更新，這次範圍尚未確認', 'The public Log is still updating; this capture’s scope is unconfirmed', '公开 Log 仍在更新，这次范围尚未确认');
  reason('尚未讀到 Game ended!，不能確認結尾完整', 'Game ended! has not been read; the end cannot be confirmed complete', '尚未读到 Game ended!，不能确认结尾完整');
  reason('暫存尚未全部寫入；本次只能匯出已存資料', 'The buffer has not been fully saved; this export includes saved data only', '暂存尚未全部写入；本次只能导出已存资料');
  reason('記錄已暫停；匯出目前已儲存資料', 'Recording paused; exporting currently saved data', '记录已暂停；导出目前已保存资料');
  reason('找不到本場已連線頁面；請回到該場頁面，必要時重新整理後重試', 'No connected page was found for this game; return to it and refresh if needed before retrying', '找不到本场已连接页面；请回到该场页面，必要时重新整理后重试');
  reason('已更新公開 Log', 'Public Log updated', '已更新公开 Log');
  reason('等待本場收錄逾時；匯出目前已儲存資料', 'Capture timed out; exporting currently saved data', '等待本场收录超时；导出目前已保存资料');
  reason('無法連線本場記錄器；請重新整理該頁後重試', 'Cannot connect to this game’s recorder; refresh its page and retry', '无法连接本场记录器；请重新整理该页后重试');
  reason('無法更新公開 Log', 'Could not update the public Log', '无法更新公开 Log');
  reason('直接匯出已存資料，未要求刷新 MSA。', 'Exporting saved data directly; no MSA refresh was requested.', '直接导出已存资料，未要求刷新 MSA。');
  reason('未要求刷新 MSA', 'No MSA refresh requested', '未要求刷新 MSA');
  reason('匯出前刷新逾時；只匯出已儲存資料。', 'Pre-export refresh timed out. Exporting saved data only.', '导出前刷新逾时；只导出已保存数据。');
  reason('沒有收到刷新結果。', 'No refresh result received.', '没有收到刷新结果。');
  reason('；既有紀錄含暫存缺口，請查看報告警告', '; existing records contain buffer gaps; check report warnings', '；既有记录含暂存缺口，请查看报告警告');
  reason('；自動開啟的視窗未恢復（操作權已改變）', '; the automatically opened dialog was not restored (control ownership changed)', '；自动开启的窗口未恢复（操作权已改变）');
  const suffixes = ['；既有紀錄含暫存缺口，請查看報告警告', '；自動開啟的視窗未恢復（操作權已改變）'];
  const originals = new Map();
  for (const source of reasonKeys) {
    originals.set(source, source);
    for (const translated of Object.values(messages[source])) originals.set(translated, source);
  }
  Object.freeze(messages);
  function create(requestedLanguage) {
    const language = ['zh-TW', 'zh-CN', 'en'].includes(requestedLanguage) ? requestedLanguage : 'zh-TW';
    function t(source, ...values) {
      const template = messages[source]?.[language] ?? source;
      return template.replace(/\{(\d+)\}/g, (token, index) => index < values.length ? String(values[index] ?? '') : token);
    }
    function knownReason(value) {
      const source = value == null ? '' : String(value);
      if (originals.has(source)) return t(originals.get(source));
      // Handle only suffixes emitted by the recorder. Do not translate arbitrary
      // embedded phrases: those can be imported/user-authored evidence.
      for (const suffix of suffixes) {
        if (source.endsWith(suffix)) {
          const base = source.slice(0, -suffix.length);
          if (originals.has(base)) return t(originals.get(base)) + t(suffix);
        }
      }
      return source;
    }
    return Object.freeze({language, htmlLanguage:language === 'en' ? 'en' : language === 'zh-CN' ? 'zh-Hans' : 'zh-Hant', t, knownReason});
  }
  return Object.freeze({create, messages});
});
