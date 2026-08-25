import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Script,
  Section,
  SecureField,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  Widget,
  Safari,
  useEffect,
  useState,
} from "scripting"
import {
  CACHE_PATH,
  CONFIG_PATH,
  districtFromPlacemark,
  fetchForecast,
  formatDay,
  formatHour,
  normalizeCity,
  readJson,
  weatherIcon,
  writeJson,
  type Config,
  type ForecastPoint,
  type WeatherData,
} from "./lib/weather"

// CWA Weather Dashboard – main page.
// API key and location are stored only in Scripting's App Group, never in GitHub.

const RADAR_URL = "https://qpeplus.cwa.gov.tw/"
const CWA_AUTHORIZATION_URL = "https://pweb.cwa.gov.tw/emember/register/authorization"

function defaultConfig(): Config {
  return { apiKey: "", city: "臺中市", district: "北區", autoLocate: true }
}

function loadConfig(): Config {
  return { ...defaultConfig(), ...(readJson<Partial<Config>>(CONFIG_PATH) ?? {}) }
}

// Observations are optional. Forecast continues to work when an observation station is unavailable.
async function enrichObservation(data: WeatherData, config: Config): Promise<WeatherData> {
  if (config.latitude == null || config.longitude == null) return data
  try {
    const url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001"
      + "?Authorization=" + encodeURIComponent(config.apiKey.trim()) + "&format=JSON"
    const response = await fetch(url)
    if (!response.ok) return data
    const json = await response.json()
    const stations = json.records?.Station ?? []
    let closest: any = null
    let closestDistance = Number.POSITIVE_INFINITY
    for (const station of stations) {
      const coordinate = station.GeoInfo?.Coordinates?.find(
        (item: any) => item.CoordinateName === "WGS84"
      ) ?? station.GeoInfo?.Coordinates?.[0]
      const latitude = Number(coordinate?.StationLatitude)
      const longitude = Number(coordinate?.StationLongitude)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
      const distance = (latitude - config.latitude) ** 2 + (longitude - config.longitude) ** 2
      if (distance < closestDistance) {
        closest = station
        closestDistance = distance
      }
    }
    if (!closest) return data
    const weather = closest.WeatherElement ?? {}
    data.observation = {
      temperature: String(weather.AirTemperature ?? data.current.temperature),
      humidity: String(weather.RelativeHumidity ?? data.current.humidity),
      windSpeed: String(weather.WindSpeed ?? data.current.windSpeed),
      windDirection: String(weather.WindDirection ?? data.current.windDirection),
      pressure: String(weather.AirPressure ?? "--"),
      rain: "--",
      station: closest.StationName ?? closest.StationId ?? "最近測站",
    }

    // Rainfall is published by a separate CWA observation dataset.
    const rainResponse = await fetch(
      "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0002-001"
      + "?Authorization=" + encodeURIComponent(config.apiKey.trim()) + "&format=JSON"
    )
    if (rainResponse.ok) {
      const rainJson = await rainResponse.json()
      const rainStation = (rainJson.records?.Station ?? []).find(
        (station: any) => station.StationId === closest.StationId
      )
      const rain = rainStation?.RainfallElement?.Now?.Precipitation
        ?? rainStation?.RainfallElement?.Past1hr?.Precipitation
      if (rain != null && rain !== "-998.0") data.observation.rain = String(rain)
    }
  } catch {
    // The forecast is the primary feature; do not hide it because observations failed.
  }
  return data
}

async function resolveCurrentPlace(forceRequest: boolean): Promise<Pick<Config, "city" | "district" | "latitude" | "longitude">> {
  const location = await Location.requestCurrent({ forceRequest })
  if (!location) throw new Error("無法取得目前位置，請確認定位權限")
  const marks = await Location.reverseGeocode({
    latitude: location.latitude,
    longitude: location.longitude,
    locale: "zh-TW",
  })
  const mark = marks?.[0]
  const city = normalizeCity(mark?.administrativeArea ?? mark?.locality ?? "")
  const district = districtFromPlacemark(mark, city)
  if (!city || !district) throw new Error("定位成功，但無法辨識區、鄉或鎮；請改用地圖選點或手動輸入")
  return { city, district, latitude: location.latitude, longitude: location.longitude }
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <HStack>
    <Image systemName={icon} frame={{ width: 18, height: 18 }} />
    <Text>{label}</Text>
    <Spacer />
    <Text foregroundStyle="secondaryLabel">{value}</Text>
  </HStack>
}

function Dashboard() {
  const initial = loadConfig()
  const [config, setConfig] = useState<Config>(initial)
  const [weather, setWeather] = useState<WeatherData | null>(readJson<WeatherData>(CACHE_PATH))
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)

  async function refresh(options?: { locate?: boolean; force?: boolean }) {
    try {
      setLoading(true)
      setStatus("正在更新天氣…")
      let nextConfig = config
      if (options?.locate || config.autoLocate) {
        try {
          const place = await resolveCurrentPlace(Boolean(options?.force))
          nextConfig = { ...nextConfig, ...place }
          setConfig(nextConfig)
          writeJson(CONFIG_PATH, nextConfig)
        } catch (error) {
          if (options?.locate) throw error
          // Automatic positioning is best-effort. Keep the last known town on failure.
        }
      }
      const forecast = await enrichObservation(await fetchForecast(nextConfig, weather ?? undefined), nextConfig)
      setWeather(forecast)
      writeJson(CACHE_PATH, forecast)
      writeJson(CONFIG_PATH, nextConfig)
      await Widget.reloadUserWidgets()
      const aiConfigured = Boolean(nextConfig.aiBaseUrl?.trim() && nextConfig.aiApiKey?.trim() && nextConfig.aiModel?.trim())
      const helperStatus = forecast.weatherHelperSource === "ai"
        ? " · AI 摘要已更新"
        : forecast.weatherHelperOverview
          ? aiConfigured
            ? " · AI 摘要未取得，顯示官方概況"
            : " · 顯示官方天氣概況"
          : aiConfigured
            ? " · AI 與官方天氣概況暫時無法取得"
            : " · 官方天氣概況暫時無法取得"
      setStatus(`已更新 ${new Date(forecast.updatedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}${helperStatus}`)
    } catch (error: any) {
      setStatus("更新失敗：" + (error?.message ?? String(error)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initial.apiKey) void refresh()
  }, [])

  async function locateFromMap() {
    try {
      const picked = await Location.pickFromMap()
      if (!picked) return
      const marks = await Location.reverseGeocode({ latitude: picked.latitude, longitude: picked.longitude, locale: "zh-TW" })
      const mark = marks?.[0]
      const city = normalizeCity(mark?.administrativeArea ?? mark?.locality ?? "")
      const district = districtFromPlacemark(mark, city)
      if (!city || !district) throw new Error("這個位置無法辨識行政區")
      const next = { ...config, city, district, latitude: picked.latitude, longitude: picked.longitude }
      setConfig(next)
      writeJson(CONFIG_PATH, next)
      setStatus(`已選擇 ${city}${district}`)
    } catch (error: any) {
      setStatus("地圖選點失敗：" + (error?.message ?? String(error)))
    }
  }

  async function openRadar() {
    try {
      await Safari.present(RADAR_URL, false)
    } catch (error: any) {
      setStatus("開啟雷達回波失敗：" + (error?.message ?? String(error)))
    }
  }

  async function openCwaAuthorization() {
    try {
      await Safari.present(CWA_AUTHORIZATION_URL, false)
    } catch (error: any) {
      setStatus("開啟 CWA API Key 申請頁失敗：" + (error?.message ?? String(error)))
    }
  }

  async function requestBackgroundLocationPermission() {
    try {
      // This requests the iOS upgrade to "Always". Do not keep a listener alive:
      // the Widget itself will request one-shot locations when WidgetKit runs it.
      const result = await Location.startUpdatingLocation({ requestAlwaysAuthorization: true })
      Location.stopUpdatingLocation()
      setStatus(result.mode === "always"
        ? "已取得「永遠允許」定位；Widget 將在系統允許時自動定位。"
        : "目前僅有使用期間定位權限；請到 iOS 設定將 Scripting 改為「永遠」。")
    } catch (error: any) {
      setStatus("定位權限設定失敗：" + (error?.message ?? String(error)))
    }
  }

  return <NavigationStack>
    <List navigationTitle="CWA 天氣中心" navigationBarTitleDisplayMode="inline">
      <Section header={<Text>目前地點</Text>}>
        <VStack alignment="leading" spacing={8}>
          <Text font="title2" bold>{weather ? `${weather.city}${weather.district}` : `${config.city}${config.district}`}</Text>
          {weather ? <HStack>
            <Image systemName={weatherIcon(weather.current.weather)} imageScale="large" />
            <Text font="largeTitle">{weather.observation?.temperature ?? weather.current.temperature}°</Text>
            <VStack alignment="leading" spacing={2}>
              <Text>{weather.current.weather}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">體感 {weather.current.feelsLike}° · 降雨 {weather.current.pop}%</Text>
            </VStack>
          </HStack> : <Text foregroundStyle="secondaryLabel">請輸入 API Key 後更新資料</Text>}
        </VStack>
      </Section>

      <Section header={<Text>即時觀測與預報</Text>}>
        <DetailRow icon="thermometer.medium" label="體感溫度" value={`${weather?.current.feelsLike ?? "--"}°C`} />
        <DetailRow icon="drop.fill" label="濕度" value={`${weather?.observation?.humidity ?? weather?.current.humidity ?? "--"}%`} />
        <DetailRow icon="wind" label="風" value={`${weather?.observation?.windDirection ?? weather?.current.windDirection ?? "--"} ${weather?.observation?.windSpeed ?? weather?.current.windSpeed ?? "--"} m/s`} />
        <DetailRow icon="gauge.with.dots.needle.50percent" label="氣壓" value={`${weather?.observation?.pressure ?? "--"} hPa`} />
        <DetailRow icon="cloud.rain.fill" label="即時雨量" value={`${weather?.observation?.rain ?? "--"} mm`} />
        <DetailRow icon="umbrella.fill" label="降雨機率" value={`${weather?.current.pop ?? "--"}%`} />
        <DetailRow icon="heart.text.square" label="舒適度" value={weather?.current.comfort ?? "--"} />
      </Section>

      <Section header={<Text>未來時段</Text>}>
        {weather?.hourlyTemperature?.slice(0, 8).map(point => {
          return <HStack key={point.start}>
            <Text frame={{ width: 44 }} >{formatHour(point.start)}</Text>
            <Image systemName={weatherIcon(point.weather)} frame={{ width: 22, height: 22 }} />
            <Text frame={{ maxWidth: "infinity" }}>{point.weather}</Text>
            <Text>{point.temperature}°</Text>
            <Text foregroundStyle="secondaryLabel">{point.pop === "--" ? "" : "☔ " + point.pop + "%"}</Text>
          </HStack>
        }) ?? <Text foregroundStyle="secondaryLabel">尚無預報資料</Text>}
      </Section>

      <Section header={<Text>未來一週</Text>}>
        {weather?.daily.map(point => <HStack key={point.start}>
          <Text frame={{ width: 48 }}>{formatDay(point.start)}</Text>
          <Image systemName={weatherIcon(point.weather)} frame={{ width: 22, height: 22 }} />
          <Text frame={{ maxWidth: "infinity" }}>{point.weather}</Text>
          <Text>{point.lowTemperature ? point.lowTemperature + "–" + point.temperature + "°" : point.temperature + "°"}</Text>
          <Text foregroundStyle="secondaryLabel">☔ {point.pop}%</Text>
        </HStack>) ?? <Text foregroundStyle="secondaryLabel">尚無預報資料</Text>}
      </Section>

      <Section header={<Text>雷達回波</Text>} footer={<Text>開啟中央氣象署 QPESUMS，可縮放、切換圖層與查看連續動畫。</Text>}>
        <Button title="查看雷達回波" systemImage="dot.radiowaves.left.and.right" action={openRadar} />
      </Section>

      <Section header={<Text>設定</Text>} footer={<Text>API Key 和定位快取只存於本機；不要提交到 GitHub。啟用 AI 時會把縣市、鄉鎮與 CWA 預報文字傳送至你指定的服務。</Text>}>
        <SecureField title="CWA API Key" value={config.apiKey} onChanged={value => setConfig({ ...config, apiKey: value })} prompt="CWA-..." />
        <Button title="申請 CWA API Key" systemImage="person.badge.key.fill" action={openCwaAuthorization} />
        <TextField title="AI Base URL" value={config.aiBaseUrl ?? ""} onChanged={value => setConfig({ ...config, aiBaseUrl: value })} prompt="https://api.example.com/v1" />
        <SecureField title="AI API Key" value={config.aiApiKey ?? ""} onChanged={value => setConfig({ ...config, aiApiKey: value })} prompt="sk-..." />
        <TextField title="AI Model" value={config.aiModel ?? ""} onChanged={value => setConfig({ ...config, aiModel: value })} prompt="gpt-4.1-mini" />
        <Text font="caption" foregroundStyle="secondaryLabel">三項都填寫才會啟用 AI；請填 Base URL，不需輸入 /chat/completions。未啟用時顯示官方天氣概況。</Text>
        <TextField title="縣市" value={config.city} onChanged={value => setConfig({ ...config, city: value })} />
        <TextField title="區、鄉或鎮" value={config.district} onChanged={value => setConfig({ ...config, district: value })} />
        <Toggle title="Widget 自動定位" value={config.autoLocate} onChanged={value => setConfig({ ...config, autoLocate: value })} />
        <Text font="caption" foregroundStyle="secondaryLabel">Widget 自動定位需先按下方按鈕，並在 iOS 設定將 Scripting 定位權限設為「永遠」。</Text>
        <Button title="啟用背景定位權限" systemImage="location.circle.fill" action={requestBackgroundLocationPermission} />
        <Button title="使用目前位置" systemImage="location.fill" disabled={loading} action={() => refresh({ locate: true, force: true })} />
        <Button title="在地圖上選位置" systemImage="map.fill" disabled={loading} action={locateFromMap} />
        <Button title={loading ? "更新中…" : "儲存並更新"} systemImage="arrow.clockwise" disabled={loading} action={() => refresh({ force: true })} />
      </Section>

      {status ? <Section header={<Text>狀態</Text>}><Text>{status}</Text></Section> : null}
    </List>
  </NavigationStack>
}

async function run() {
  await Navigation.present({ element: <Dashboard /> })
  Script.exit()
}

run()
