import {
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
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
  type HourlyTemperaturePoint,
  type WeatherData,
} from "./lib/weather"

async function resolveWidgetPlace(config: Config): Promise<Config> {
  // A Widget never prompts for permission. iOS decides whether this widget is eligible.
  if (!config.autoLocate || !Location.isAuthorizedForWidgetUpdates) return config
  try {
    const location = await Location.requestCurrent()
    if (!location) return config
    const marks = await Location.reverseGeocode({ latitude: location.latitude, longitude: location.longitude, locale: "zh-TW" })
    const mark = marks?.[0]
    const city = normalizeCity(mark?.administrativeArea ?? mark?.locality ?? "")
    const district = districtFromPlacemark(mark, city)
    if (!city || !district) return config
    return { ...config, city, district, latitude: location.latitude, longitude: location.longitude }
  } catch {
    return config
  }
}


type TemperaturePoint = Pick<HourlyTemperaturePoint, "start" | "temperature" | "weather" | "pop">

function nextEightHours(data: WeatherData): TemperaturePoint[] {
  return data.hourlyTemperature?.slice(0, 8) ?? data.hourly.slice(0, 8).map(point => ({
    start: point.start,
    temperature: point.temperature,
    weather: point.weather,
    pop: point.pop,
  }))
}

function HourlyTemperatureColumn({ point }: { point: TemperaturePoint }) {
  return <VStack spacing={2} frame={{ maxWidth: "infinity" }}>
    <Text font="caption2">{formatHour(point.start)}</Text>
    <Image systemName={weatherIcon(point.weather)} frame={{ width: 15, height: 15 }} />
    <Text font="caption" bold>{point.temperature}°</Text>
    <Text font="caption2" foregroundStyle="#aab8cd">{point.pop === "--" ? " " : point.pop + "%"}</Text>
  </VStack>
}

function DayColumn({ point }: { point: ForecastPoint }) {
  const range = point.lowTemperature
    ? point.lowTemperature + "–" + point.temperature + "°"
    : point.temperature + "°"
  return <VStack spacing={2} frame={{ maxWidth: "infinity" }}>
    <Text font="caption2" bold>{formatDay(point.start)}</Text>
    <Image systemName={weatherIcon(point.weather)} frame={{ width: 17, height: 17 }} />
    <Text font="caption2">{range}</Text>
    <Text font="caption2" foregroundStyle="#aab8cd">{point.pop === "--" ? " " : point.pop + "%"}</Text>
  </VStack>
}

function widgetSummary(value: string) {
  const sentences = value.match(/[^。！？!?]+[。！？!?]?/g) ?? [value]
  let summary = ""
  for (const sentence of sentences.slice(0, 2)) {
    if ((summary + sentence).length <= 42) {
      summary += sentence
    } else if (!summary) {
      return sentence.slice(0, 42).trimEnd() + "…"
    } else {
      break
    }
  }
  return summary || value.slice(0, 42).trimEnd() + "…"
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
  const hours = nextEightHours(data)
  const hourTitle = hours.length >= 8 ? "未來 8 小時" : "目前可用預報"
  return <VStack alignment="leading" spacing={7} padding={14} background="#17243b" foregroundStyle="white">
    <HStack>
      <VStack alignment="leading" spacing={2}>
        <Text font="headline">{data.city}{data.district}</Text>
        <Text font="caption" foregroundStyle="#cbd5e1">{data.current.weather} · 體感 {data.current.feelsLike}°</Text>
      </VStack>
      <Spacer />
      <Image systemName={weatherIcon(data.current.weather)} imageScale="large" />
      <Text font="title">{data.observation?.temperature ?? data.current.temperature}°</Text>
    </HStack>
    <Text font="caption2" foregroundStyle="#b7c6db">{hourTitle}</Text>
    <HStack>{hours.map(point => <HourlyTemperatureColumn key={point.start} point={point} />)}</HStack>
    <HStack>
      <Text font="caption">💧 {data.observation?.humidity ?? data.current.humidity}%</Text>
      <Spacer />
      <Text font="caption">💨 {data.observation?.windSpeed ?? data.current.windSpeed} m/s</Text>
      <Spacer />
      <Text font="caption">雨量 {data.observation?.rain ?? "--"} mm</Text>
    </HStack>
  </VStack>
}

function LargeWidget({ data }: { data: WeatherData }) {
  const hours = nextEightHours(data)
  const hourTitle = hours.length >= 8 ? "未來 8 小時" : "目前可用預報"
  const dailyTitle = data.daily.length >= 7 ? "未來七日" : "目前可用預報"
  const helperSummary = data.aiSummary ?? data.weatherHelperOverview
  const helperTitle = data.weatherHelperSource === "ai"
    ? "AI 天氣小幫手"
    : data.weatherHelperSource === "official"
      ? "官方天氣概況"
      : "天氣小幫手"
  const helperText = helperSummary
    ? widgetSummary(helperSummary)
    : "暫時無法取得，將於下次更新重試。"
  return <VStack alignment="leading" spacing={0} background="#101a2d" foregroundStyle="white" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <HStack padding={16}>
      <VStack alignment="leading" spacing={3}>
        <Text font="title2" bold>{data.city}{data.district}</Text>
        <Text font="caption" foregroundStyle="#d1dced">{data.current.weather} · 體感 {data.current.feelsLike}°</Text>
      </VStack>
      <Spacer />
      <VStack alignment="trailing" spacing={6}>
        <HStack>
          <Image systemName={weatherIcon(data.current.weather)} frame={{ width: 34, height: 34 }} />
          <Text font="largeTitle">{data.observation?.temperature ?? data.current.temperature}°</Text>
        </HStack>
        <Text font="caption" foregroundStyle="#d1dced">濕度 {data.observation?.humidity ?? data.current.humidity}% · 風 {data.observation?.windSpeed ?? data.current.windSpeed} m/s</Text>
        <Text font="caption" foregroundStyle="#d1dced">雨量 {data.observation?.rain ?? "--"} mm · 氣壓 {data.observation?.pressure ?? "--"} hPa</Text>
      </VStack>
    </HStack>
    <VStack alignment="leading" spacing={4} padding={14} background="#142039">
      <Text font="caption2" foregroundStyle="#b7c6db">{helperTitle}</Text>
      <Text font="caption" lineLimit={2}>{helperText}</Text>
    </VStack>
    <VStack alignment="leading" spacing={6} padding={14} background="#142039">
      <Text font="caption2" foregroundStyle="#b7c6db">{hourTitle}</Text>
      <HStack>{hours.map(point => <HourlyTemperatureColumn key={point.start} point={point} />)}</HStack>
    </VStack>
    <Spacer />
    <VStack alignment="leading" spacing={7} padding={14}>
      <Text font="caption2" foregroundStyle="#b7c6db">{dailyTitle}</Text>
      <HStack>{data.daily.slice(0, 7).map(point => <DayColumn key={point.start} point={point} />)}</HStack>
      <Text font="caption2" foregroundStyle="#94a3b8">更新 {new Date(data.updatedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</Text>
    </VStack>
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
    return
  }

  let data = readJson<WeatherData>(CACHE_PATH)
  try {
    config = await resolveWidgetPlace(config)
    const fresh = await fetchForecast(config, data ?? undefined)
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
    return
  }

  const family = Widget.family
  const content = family === "systemSmall"
    ? <SmallWidget data={data} />
    : family === "systemMedium"
      ? <MediumWidget data={data} />
      : <LargeWidget data={data} />
  Widget.present(content, { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) })
}

run()
