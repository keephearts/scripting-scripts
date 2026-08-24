import {
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
import {
  CACHE_PATH,
  CONFIG_PATH,
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

const RADAR_IMAGE_URL = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0058-001.png"

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
