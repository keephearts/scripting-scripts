import {
  FileManager,
  HStack,
  Image,
  Link,
  Script,
  Spacer,
  Text,
  VStack,
  Widget,
  UIImage,
} from "scripting"

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
const RADAR_IMAGE_URL = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0058-001.png"

function readJson<T>(path: string): T | null {
  try {
    return FileManager.existsSync(path) ? JSON.parse(FileManager.readAsStringSync(path)) : null
  } catch {
    return null
  }
}

function writeJson(path: string, value: unknown) {
  if (!FileManager.existsSync(DATA_DIR)) FileManager.createDirectorySync(DATA_DIR, true)
  FileManager.writeAsStringSync(path, JSON.stringify(value, null, 2))
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
  return String(point?.elementValue?.[0]?.value ?? point?.parameter?.parameterName ?? "--")
}

function elementByName(elements: any[], name: string) {
  return elements.find(item => item.elementName === name)
}

function pointFrom(elements: any[], index: number): ForecastPoint {
  const wx = elementByName(elements, "Wx")
  const time = wx?.time?.[index]
  const pop12 = firstValue(elementByName(elements, "PoP12h"), index)
  return {
    start: time?.startTime ?? "",
    end: time?.endTime ?? "",
    weather: firstValue(wx, index),
    temperature: firstValue(elementByName(elements, "T"), index),
    feelsLike: firstValue(elementByName(elements, "AT"), index),
    pop: pop12 === "--" ? firstValue(elementByName(elements, "PoP"), index) : pop12,
    humidity: firstValue(elementByName(elements, "RH"), index),
    windSpeed: firstValue(elementByName(elements, "WS"), index),
    windDirection: firstValue(elementByName(elements, "WD"), index),
    comfort: firstValue(elementByName(elements, "CI"), index),
  }
}

async function resolveWidgetPlace(config: Config): Promise<Config> {
  // A Widget never prompts for permission. iOS decides whether this widget is eligible.
  if (!config.autoLocate || !Location.isAuthorizedForWidgetUpdates) return config
  try {
    const location = await Location.requestCurrent()
    if (!location) return config
    const marks = await Location.reverseGeocode({ latitude: location.latitude, longitude: location.longitude, locale: "zh-TW" })
    const mark = marks?.[0]
    const city = normalizeCity(mark?.administrativeArea ?? mark?.locality ?? "")
    const district = (mark?.subLocality ?? mark?.locality ?? "").trim()
    if (!city || !district) return config
    return { ...config, city, district, latitude: location.latitude, longitude: location.longitude }
  } catch {
    return config
  }
}

async function fetchForecast(config: Config): Promise<WeatherData> {
  if (!config.apiKey.trim()) throw new Error("尚未設定 API Key")
  const city = normalizeCity(config.city)
  const district = config.district.trim().replace(city, "").trim()
  const url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-001"
    + "?Authorization=" + encodeURIComponent(config.apiKey.trim())
    + "&format=JSON&locationName=" + encodeURIComponent(district)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const json = await response.json()
  const candidates = (json.records?.locations ?? []).flatMap((group: any) =>
    (group.location ?? []).map((location: any) => ({ location, city: group.locationsName ?? "" }))
  )
  const selected = candidates.find((item: any) => normalizeCity(item.city) === city && item.location.locationName === district)
    ?? candidates.find((item: any) => item.location.locationName === district)
  if (!selected) throw new Error("找不到這個行政區的預報")
  const elements = selected.location.weatherElement ?? []
  const count = elementByName(elements, "Wx")?.time?.length ?? 0
  if (!count) throw new Error("預報資料不完整")
  const hourly = Array.from({ length: count }, (_, index) => pointFrom(elements, index))
  const daily = hourly.filter((point, index) => index === 0 || new Date(point.start).getDate() !== new Date(hourly[index - 1].start).getDate()).slice(0, 7)
  return { city: normalizeCity(selected.city || city), district: selected.location.locationName ?? district, updatedAt: Date.now(), current: hourly[0], hourly: hourly.slice(0, 8), daily }
}

function formatHour(value: string) {
  if (!value) return "--"
  return new Date(value).getHours().toString().padStart(2, "0") + ":00"
}

function formatDay(value: string) {
  if (!value) return "--"
  return new Intl.DateTimeFormat("zh-TW", { weekday: "short" }).format(new Date(value))
}

function HourColumn({ point }: { point: ForecastPoint }) {
  return <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
    <Text font="caption2">{formatHour(point.start)}</Text>
    <Image systemName={weatherIcon(point.weather)} width={19} />
    <Text font="caption" bold>{point.temperature}°</Text>
    <Text font="caption2" foregroundStyle="secondary">☔ {point.pop}%</Text>
  </VStack>
}

function DayColumn({ point }: { point: ForecastPoint }) {
  return <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
    <Text font="caption" bold>{formatDay(point.start)}</Text>
    <Image systemName={weatherIcon(point.weather)} width={18} />
    <Text font="caption">{point.temperature}°</Text>
    <Text font="caption2" foregroundStyle="secondary">☔ {point.pop}%</Text>
  </VStack>
}

function SmallWidget({ data }: { data: WeatherData }) {
  return <VStack alignment="leading" spacing={7} padding={14} background="#111827" foregroundStyle="white">
    <HStack>
      <Text font="headline">{data.city}{data.district}</Text>
      <Spacer />
      <Image systemName={weatherIcon(data.current.weather)} imageScale="large" />
    </HStack>
    <Spacer />
    <Text font="largeTitle">{data.observation?.temperature ?? data.current.temperature}°</Text>
    <Text>{data.current.weather}</Text>
    <HStack>
      <Text font="caption">☔ {data.current.pop}%</Text>
      <Spacer />
      <Text font="caption">{data.current.comfort}</Text>
    </HStack>
    <Text font="caption2" foregroundStyle="#cbd5e1">更新 {new Date(data.updatedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</Text>
  </VStack>
}

function MediumWidget({ data }: { data: WeatherData }) {
  return <VStack alignment="leading" spacing={8} padding={14} background="#111827" foregroundStyle="white">
    <HStack>
      <VStack alignment="leading" spacing={2}>
        <Text font="headline">{data.city}{data.district}</Text>
        <Text font="caption" foregroundStyle="#cbd5e1">{data.current.weather} · 體感 {data.current.feelsLike}°</Text>
      </VStack>
      <Spacer />
      <Image systemName={weatherIcon(data.current.weather)} imageScale="large" />
      <Text font="title">{data.observation?.temperature ?? data.current.temperature}°</Text>
    </HStack>
    <HStack>{data.hourly.slice(0, 4).map(point => <HourColumn key={point.start} point={point} />)}</HStack>
    <HStack>
      <Text font="caption">💧 {data.observation?.humidity ?? data.current.humidity}%</Text>
      <Spacer />
      <Text font="caption">💨 {data.observation?.windSpeed ?? data.current.windSpeed} m/s</Text>
      <Spacer />
      <Text font="caption">☔ {data.current.pop}%</Text>
    </HStack>
  </VStack>
}

function LargeWidget({ data, radar }: { data: WeatherData; radar: any }) {
  return <VStack alignment="leading" spacing={7} padding={14} background="#111827" foregroundStyle="white">
    <HStack>
      <VStack alignment="leading" spacing={2}>
        <Text font="headline">{data.city}{data.district}</Text>
        <Text font="caption" foregroundStyle="#cbd5e1">{data.current.weather} · {data.current.comfort}</Text>
      </VStack>
      <Spacer />
      <Image systemName={weatherIcon(data.current.weather)} imageScale="large" />
      <Text font="title">{data.observation?.temperature ?? data.current.temperature}°</Text>
    </HStack>
    <HStack>{data.hourly.slice(0, 6).map(point => <HourColumn key={point.start} point={point} />)}</HStack>
    <HStack>
      <Text font="caption">濕度 {data.observation?.humidity ?? data.current.humidity}%</Text>
      <Spacer />
      <Text font="caption">風 {data.observation?.windSpeed ?? data.current.windSpeed} m/s</Text>
      <Spacer />
      <Text font="caption">雨量 {data.observation?.rain ?? "--"} mm</Text>
    </HStack>
    {radar ? <Image image={radar} resizable scaleToFit frame={{ height: 104, maxWidth: "infinity" }} /> : <Text font="caption" foregroundStyle="#cbd5e1">雷達縮圖暫時無法載入</Text>}
    <HStack>{data.daily.slice(0, 5).map(point => <DayColumn key={point.start} point={point} />)}</HStack>
  </VStack>
}

function MissingWidget({ message }: { message: string }) {
  return <VStack alignment="leading" padding={14} background="#111827" foregroundStyle="white">
    <Text font="headline">CWA 天氣中心</Text>
    <Spacer />
    <Text>{message}</Text>
    <Text font="caption" foregroundStyle="#cbd5e1">請開啟主頁輸入 API Key 後按「儲存並更新」。</Text>
  </VStack>
}

async function run() {
  let config = readJson<Config>(CONFIG_PATH)
  if (!config?.apiKey) {
    Widget.present(<MissingWidget message="尚未完成設定" />)
    Script.exit()
    return
  }

  let data = readJson<WeatherData>(CACHE_PATH)
  try {
    config = await resolveWidgetPlace(config)
    const fresh = await fetchForecast(config)
    // The main page refreshes live station readings. Keep the last known reading
    // when this lightweight Widget refresh only needs forecast data.
    fresh.observation = data?.observation
    data = fresh
    writeJson(CONFIG_PATH, config)
    writeJson(CACHE_PATH, fresh)
  } catch {
    // WidgetKit may run while offline or without location permission; cached data is intentional.
  }

  if (!data) {
    Widget.present(<MissingWidget message="暫時無法取得天氣資料" />, { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) })
    Script.exit()
    return
  }

  const family = Widget.family
  const radar = family === "systemLarge" ? await UIImage.fromURL(RADAR_IMAGE_URL) : null
  const content = family === "systemSmall"
    ? <SmallWidget data={data} />
    : family === "systemMedium"
      ? <MediumWidget data={data} />
      : <LargeWidget data={data} radar={radar} />
  Widget.present(content, { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) })
  Script.exit()
}

run()

