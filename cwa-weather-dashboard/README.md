# CWA Weather Dashboard for Scripting

這是一個單一 Scripting 專案，包含主頁與不同尺寸的 iOS 桌面 Widget。

## 功能

- 中央氣象署 `F-D0047-001` 鄉鎮市區預報
- 目前位置反查為縣市／區／鄉／鎮，亦可手動輸入或在地圖上選點
- 小、中、大 Widget 各自顯示不同資訊
- 大型 Widget 顯示中央氣象署雷達回波縮圖
- 主頁在 Scripting 內開啟 QPESUMS 雷達頁，可查看動畫、縮放與圖層
- Widget 被 iOS 喚醒時，若定位授權與系統條件允許，會重新定位；失敗時使用上次成功位置和快取天氣

## 安裝

1. 在 iPhone 的 Scripting 建立一個新的 Script Project，例如命名為 `CWA 天氣中心`。
2. 將 `index.tsx` 貼入專案的同名檔案。
3. 新增 `widget.tsx`，再貼入本資料夾的同名檔案。
4. 執行 `index.tsx`，輸入中央氣象署 API Key。
5. 按「使用目前位置」或輸入縣市、區／鄉／鎮後，按「儲存並更新」。
6. 到 iOS 主畫面新增 Scripting Widget，選擇 `CWA 天氣中心`，分別試用小、中、大尺寸。

## 定位權限

若要讓 Widget 嘗試自動切換所在地，先在主頁按「啟用背景定位權限」。若 iOS 仍未授予「永遠」權限，請到：

`設定 → 隱私權與安全性 → 定位服務 → Scripting → 永遠`

即使選擇「永遠」，Widget 更新頻率仍由 iOS WidgetKit 決定；這不是常駐 GPS 追蹤器。若更新時無法定位或無網路，Widget 會保留最近一次成功資料。

## 中央氣象署 API Key

向中央氣象署開放資料平臺申請 API Key。Key 只會保存在 iPhone 的 Scripting App Group 資料夾；不要放在原始碼、README、截圖或 GitHub Commit。

## 私人 GitHub Repository

建議 Repository 只放這三個不含個人資料的檔案：

```text
index.tsx
widget.tsx
README.md
```

`.gitignore` 請至少排除任何 `config.json`、`weather-cache.json`、`.env` 或匯出的含設定檔案。

私人 Repository 的 GitHub URL 不保證可被 Scripting 匿名直接匯入，因為它需要 GitHub 授權。安全流程是：在已登入 GitHub 的裝置下載／取得原始碼或 Scripting 匯出檔，再透過「檔案」App 分享到 Scripting 匯入。不要把 GitHub Personal Access Token 寫進此專案。

## 已知限制

- 中央氣象署預報與最近測站觀測是不同資料來源；找不到測站時仍會顯示鄉鎮預報。
- 雷達縮圖為全臺圖且約每 10 分鐘更新；互動式雷達動畫僅在主頁內。
- iOS 不保證 Widget 會依程式指定時間執行更新。

