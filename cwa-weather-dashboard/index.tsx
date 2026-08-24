import {
  Button,
  FileManager,
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

// CWA Weather Dashboard – main page.
// API key and location are stored only in Scripting's App Group, never in GitHub.

type Config = {
  apiKey: string
  city: string
  district: string
  latitude?: number
  longitude?: number
  autoLocate: boolean
}

type ForecastPoint = {
  start: string
  end: string
  weather: string
  temperature: string
  feelsLike: string
  pop: string
  humidity: string
  windSpeed: string
  windDirection: string
  comfort: string
}

type WeatherData = {
  city: string
  district: string
  updatedAt: number
  current: ForecastPoint
  hourly: ForecastPoint[]
  daily: ForecastPoint[]
  observation?: {
    temperature: string
    humidity: string
    windSpeed: string
    windDirection: string
    pressure: string
    rain: string
    station: string
  }
}

const DATA_DIR = FileManager.appGroupDocumentsDirectory + "/CWAWeatherDashboard"
const CONFIG_PATH = DATA_DIR + "/config.json"
const CACHE_PATH = DATA_DIR + "/weather-cache.json"
const FORECAST_DATASET = "F-D0047-001"
const RADAR_URL = "https://qpeplus.cwa.gov.tw/"

function defaultConfig(): Config {
  return { apiKey: "", city: "臺中市", district: "北區", autoLocate: true }
}

function ensureDirectory() {
  if (!FileManager.existsSync(DATA_DIR)) {
    FileManager.createDirectorySync(DATA_DIR, true)
  }
}

function readJson<T>(path: string): T | null {
  try {
    return FileManager.existsSync(path)
      ? JSON.parse(FileManager.readAsStringSync(path))
      : null
  } catch {
    return null
  }
}

function writeJson(path: string, value: unknown) {
  ensureDirectory()
  FileManager.writeAsStringSync(path, JSON.stringify(value, null, 2))
}

function loadConfig(): Config {
  return { ...defaultConfig(), ...(readJson<Partial<Config>>(CONFIG_PATH) ?? {}) }
}

function normalizeCity(value: string) {
  return value.trim().replaceAll("台", "臺")
}

function weatherIcon(weather: string) {
  if (weather.includes("雷")) return "cloud.bolt.rain.fill"
  if (weather.includes("雪")) return "cloud.snow.fill"
  if (weather.includes("雨")) return "cloud.rain.fill"
  if (weather.includes("陰")) return "cloud.fill"
  if (weather.includes("多雲")) return "cloud.sun.fill"
  if (weather.includes("晴")) return "sun.max.fill"
  return "cloud.sun.fill"
}

function firstValue(element: any, index = 0) {
  const point = element?.time?.[index]
  const value = point?.elementValue?.[0]?.value ?? point?.parameter?.parameterName
  return String(value ?? "--")
}

function elementByName(elements: any[], name: string) {
  return elements.find(item => item.elementName === name)
}

function pointFrom(elements: any[], index: number): ForecastPoint {
  const wx = elementByName(elements, "Wx")
  const time = wx?.time?.[index]
  return {
    start: time?.startTime ?? "",
    end: time?.endTime ?? "",
    weather: firstValue(wx, index),
    temperature: firstValue(elementByName(elements, "T"), index),
    feelsLike: firstValue(elementByName(elements, "AT"), index),
    pop: firstValue(elementByName(elements, "PoP12h"), index) === "--"
      ? firstValue(elementByName(elements, "PoP"), index)
      : firstValue(elementByName(elements, "PoP12h"), index),
    humidity: firstValue(elementByName(elements, "RH"), index),
    windSpeed: firstValue(elementByName(elements, "WS"), index),
    windDirection: firstValue(elementByName(elements, "WD"), index),
    comfort: firstValue(elementByName(elements, "CI"), index),
  }
}

function formatHour(value: string) {
  if (!value) return "--"
  const date = new Date(value)
  return `${date.getHours().toString().padStart(2, "0")}:00`
}

function formatDay(value: string) {
  if (!value) return "--"
  return new Intl.DateTimeFormat("zh-TW", { weekday: "short" }).format(new Date(value))
}

function localizeTown(city: string, district: string) {
  const c = normalizeCity(city)
  const d = district.trim().replace(c, "").trim()
  return { city: c, district: d }
}

async function fetchForecast(config: Config): Promise<WeatherData> {
  if (!config.apiKey.trim()) throw new Error("請先輸入中央氣象署 API Key")
  if (!config.district.trim()) throw new Error("請輸入區、鄉或鎮")

  const place = localizeTown(config.city, config.district)
  const url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/" + FORECAST_DATASET
    + "?Authorization=" + encodeURIComponent(config.apiKey.trim())
    + "&format=JSON&locationName=" + encodeURIComponent(place.district)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`天氣資料 HTTP ${response.status}`)
  const json = await response.json()
  if (json.success !== "true" && json.success !== true) throw new Error("中央氣象署未接受此 API Key 或查詢")

  const groups = json.records?.locations ?? []
  const candidates = groups.flatMap((group: any) =>
    (group.location ?? []).map((location: any) => ({ location, city: group.locationsName ?? "" }))
  )
  const selected = candidates.find((item: any) =>
    normalizeCity(item.city) === place.city && item.location.locationName === place.district
  ) ?? candidates.find((item: any) => item.location.locationName === place.district)
  if (!selected) throw new Error(`找不到 ${place.city}${place.district} 的鄉鎮預報`)

  const elements = selected.location.weatherElement ?? []
  const wxCount = elementByName(elements, "Wx")?.time?.length ?? 0
  if (!wxCount) throw new Error("中央氣象署回傳的預報格式不完整")
  const points = Array.from({ length: wxCount }, (_, index) => pointFrom(elements, index))
  const daily = points.filter((point, index) => {
    if (index === 0) return true
    return new Date(point.start).getDate() !== new Date(points[index - 1].start).getDate()
  }).slice(0, 7)

  return {
    city: normalizeCity(selected.city || place.city),
    district: selected.location.locationName ?? place.district,
    updatedAt: Date.now(),
    current: points[0],
    hourly: points.slice(0, 8),
    daily,
  }
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
      const coordinate = station.GeoInfo?.Coordinates?.[0] ?? station.GeoInfo?.Coordinates?.[1]
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
  const district = (mark?.subLocality ?? mark?.locality ?? "").trim()
  if (!city || !district) throw new Error("定位成功，但無法辨識區、鄉或鎮；請改用地圖選點或手動輸入")
  return { city, district, latitude: location.latitude, longitude: location.longitude }
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <HStack>
    <Image systemName={icon} width={18} />
    <Text>{label}</Text>
    <Spacer />
    <Text foregroundStyle="secondary">{value}</Text>
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
      const forecast = await enrichObservation(await fetchForecast(nextConfig), nextConfig)
      setWeather(forecast)
      writeJson(CACHE_PATH, forecast)
      writeJson(CONFIG_PATH, nextConfig)
      await Widget.reloadUserWidgets()
      setStatus(`已更新 ${new Date(forecast.updatedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`)
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
      const district = (mark?.subLocality ?? mark?.locality ?? "").trim()
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
    await Safari.present(RADAR_URL)
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
              <Text font="caption" foregroundStyle="secondary">體感 {weather.current.feelsLike}° · 降雨 {weather.current.pop}%</Text>
            </VStack>
          </HStack> : <Text foregroundStyle="secondary">請輸入 API Key 後更新資料</Text>}
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
        {weather?.hourly.slice(0, 6).map(point => <HStack key={point.start}>
          <Text frame={{ width: 44 }} >{formatHour(point.start)}</Text>
          <Image systemName={weatherIcon(point.weather)} width={22} />
          <Text frame={{ maxWidth: "infinity" }}>{point.weather}</Text>
          <Text>{point.temperature}°</Text>
          <Text foregroundStyle="secondary">☔ {point.pop}%</Text>
        </HStack>) ?? <Text foregroundStyle="secondary">尚無預報資料</Text>}
      </Section>

      <Section header={<Text>未來一週</Text>}>
        {weather?.daily.map(point => <HStack key={point.start}>
          <Text frame={{ width: 48 }}>{formatDay(point.start)}</Text>
          <Image systemName={weatherIcon(point.weather)} width={22} />
          <Text frame={{ maxWidth: "infinity" }}>{point.weather}</Text>
          <Text>{point.temperature}°</Text>
          <Text foregroundStyle="secondary">☔ {point.pop}%</Text>
        </HStack>) ?? <Text foregroundStyle="secondary">尚無預報資料</Text>}
      </Section>

      <Section header={<Text>雷達回波</Text>} footer={<Text>開啟中央氣象署 QPESUMS，可縮放、切換圖層與查看連續動畫。</Text>}>
        <Button title="查看雷達回波" systemImage="dot.radiowaves.left.and.right" action={openRadar} />
      </Section>

      <Section header={<Text>設定</Text>} footer={<Text>API Key 和定位快取只存於本機；不要提交到 GitHub。</Text>}>
        <SecureField title="CWA API Key" value={config.apiKey} onChanged={value => setConfig({ ...config, apiKey: value })} prompt="CWA-..." />
        <TextField title="縣市" value={config.city} onChanged={value => setConfig({ ...config, city: value })} />
        <TextField title="區、鄉或鎮" value={config.district} onChanged={value => setConfig({ ...config, district: value })} />
        <Toggle title="Widget 自動定位" value={config.autoLocate} onChanged={value => setConfig({ ...config, autoLocate: value })} />
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

