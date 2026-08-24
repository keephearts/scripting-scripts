export type Config = {
  apiKey: string
  city: string
  district: string
  latitude?: number
  longitude?: number
  autoLocate: boolean
}

export type ForecastPoint = {
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

export type WeatherData = {
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

export const DATA_DIR = FileManager.appGroupDocumentsDirectory + "/CWAWeatherDashboard"
export const CONFIG_PATH = DATA_DIR + "/config.json"
export const CACHE_PATH = DATA_DIR + "/weather-cache.json"

export function readJson<T>(path: string): T | null {
  try {
    return FileManager.existsSync(path)
      ? JSON.parse(FileManager.readAsStringSync(path))
      : null
  } catch {
    return null
  }
}

export function writeJson(path: string, value: unknown) {
  if (!FileManager.existsSync(DATA_DIR)) FileManager.createDirectorySync(DATA_DIR, true)
  FileManager.writeAsStringSync(path, JSON.stringify(value, null, 2))
}

export function normalizeCity(value: string) {
  return value.trim().replaceAll("台", "臺")
}

export function weatherIcon(weather: string) {
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

export function formatHour(value: string) {
  if (!value) return "--"
  const date = new Date(value)
  return `${date.getHours().toString().padStart(2, "0")}:00`
}

export function formatDay(value: string) {
  if (!value) return "--"
  return new Intl.DateTimeFormat("zh-TW", { weekday: "short" }).format(new Date(value))
}

function localizeTown(city: string, district: string) {
  const normalizedCity = normalizeCity(city)
  return { city: normalizedCity, district: district.trim().replace(normalizedCity, "").trim() }
}

export async function fetchForecast(config: Config): Promise<WeatherData> {
  if (!config.apiKey.trim()) throw new Error("請先輸入中央氣象署 API Key")
  if (!config.district.trim()) throw new Error("請輸入區、鄉或鎮")

  const place = localizeTown(config.city, config.district)
  const url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-001"
    + "?Authorization=" + encodeURIComponent(config.apiKey.trim())
    + "&format=JSON&locationName=" + encodeURIComponent(place.district)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`天氣資料 HTTP ${response.status}`)
  const json = await response.json()
  if (json.success !== "true" && json.success !== true) throw new Error("中央氣象署未接受此 API Key 或查詢")

  const candidates = (json.records?.locations ?? []).flatMap((group: any) =>
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
