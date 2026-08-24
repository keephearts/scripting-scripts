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
  lowTemperature?: string
  feelsLike: string
  pop: string
  humidity: string
  windSpeed: string
  windDirection: string
  comfort: string
}

export type HourlyTemperaturePoint = {
  start: string
  temperature: string
  feelsLike: string
  humidity: string
  comfort: string
}

export type WeatherData = {
  city: string
  district: string
  updatedAt: number
  current: ForecastPoint
  hourly: ForecastPoint[]
  hourlyTemperature?: HourlyTemperaturePoint[]
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

const FORECAST_DATASETS: Record<string, string> = {
  "宜蘭縣": "F-D0047-001",
  "桃園市": "F-D0047-005",
  "新竹縣": "F-D0047-009",
  "苗栗縣": "F-D0047-013",
  "彰化縣": "F-D0047-017",
  "南投縣": "F-D0047-021",
  "雲林縣": "F-D0047-025",
  "嘉義縣": "F-D0047-029",
  "屏東縣": "F-D0047-033",
  "臺東縣": "F-D0047-037",
  "花蓮縣": "F-D0047-041",
  "澎湖縣": "F-D0047-045",
  "基隆市": "F-D0047-049",
  "新竹市": "F-D0047-053",
  "嘉義市": "F-D0047-057",
  "臺北市": "F-D0047-061",
  "高雄市": "F-D0047-065",
  "新北市": "F-D0047-069",
  "臺中市": "F-D0047-073",
  "臺南市": "F-D0047-077",
  "連江縣": "F-D0047-081",
  "金門縣": "F-D0047-085",
}

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

export function districtFromPlacemark(mark: any, city: string) {
  const normalizedCity = normalizeCity(city)
  const subAdministrativeArea = String(mark?.subAdministrativeArea ?? "").trim()
  if (subAdministrativeArea && normalizeCity(subAdministrativeArea) !== normalizedCity) {
    return subAdministrativeArea
  }
  const locality = String(mark?.locality ?? "").trim()
  if (locality && normalizeCity(locality) !== normalizedCity) return locality
  return ""
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

function firstValue(element: any, index: number, keys: string[]) {
  const value = element?.Time?.[index]?.ElementValue?.[0]
  for (const key of keys) {
    if (value?.[key] !== undefined && value?.[key] !== null) return String(value[key])
  }
  return "--"
}

function firstValueAtTime(element: any, time: string, keys: string[]) {
  const index = (element?.Time ?? []).findIndex(
    (item: any) => (item.DataTime ?? item.StartTime) === time,
  )
  return index >= 0 ? firstValue(element, index, keys) : "--"
}

function elementByName(elements: any[], name: string) {
  return elements.find(item => item.ElementName === name)
}

function pointFrom(elements: any[], index: number): ForecastPoint {
  const weather = elementByName(elements, "天氣現象")
  const temperature = elementByName(elements, "溫度")
  const weatherTime = weather?.Time?.[index]
  const temperatureTime = temperature?.Time?.[index]
  const start = weatherTime?.StartTime ?? temperatureTime?.DataTime ?? ""
  return {
    start,
    end: weatherTime?.EndTime ?? "",
    weather: firstValue(weather, index, ["Weather"]),
    temperature: firstValueAtTime(temperature, start, ["Temperature"]),
    feelsLike: firstValueAtTime(
      elementByName(elements, "體感溫度"),
      start,
      ["ApparentTemperature"],
    ),
    pop: firstValue(elementByName(elements, "3小時降雨機率"), index, ["ProbabilityOfPrecipitation"]),
    humidity: firstValueAtTime(elementByName(elements, "相對濕度"), start, ["RelativeHumidity"]),
    windSpeed: firstValue(elementByName(elements, "風速"), index, ["WindSpeed"]),
    windDirection: firstValue(elementByName(elements, "風向"), index, ["WindDirection"]),
    comfort: firstValueAtTime(
      elementByName(elements, "舒適度指數"),
      start,
      ["ComfortIndexDescription", "ComfortIndex"],
    ),
  }
}

function hourlyTemperatureFrom(elements: any[], index: number): HourlyTemperaturePoint {
  const temperature = elementByName(elements, "溫度")
  const time = temperature?.Time?.[index]?.DataTime ?? ""
  return {
    start: time,
    temperature: firstValue(temperature, index, ["Temperature"]),
    feelsLike: firstValue(elementByName(elements, "體感溫度"), index, ["ApparentTemperature"]),
    humidity: firstValue(elementByName(elements, "相對濕度"), index, ["RelativeHumidity"]),
    comfort: firstValue(elementByName(elements, "舒適度指數"), index, ["ComfortIndexDescription", "ComfortIndex"]),
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

function weeklyDataSet(shortDataSet: string) {
  const prefix = shortDataSet.slice(0, -3)
  const suffix = Number(shortDataSet.slice(-3)) + 2
  return prefix + suffix.toString().padStart(3, "0")
}

function weeklyDailyFrom(elements: any[]): ForecastPoint[] {
  const weather = elementByName(elements, "天氣現象")
  const high = elementByName(elements, "最高溫度")
  const low = elementByName(elements, "最低溫度")
  const pop = elementByName(elements, "12小時降雨機率")
  const windSpeed = elementByName(elements, "風速")
  const windDirection = elementByName(elements, "風向")
  const comfort = elementByName(elements, "最大舒適度指數")
  const groups = new Map<string, number[]>()

  for (let index = 0; index < (weather?.Time?.length ?? 0); index++) {
    const start = weather.Time[index]?.StartTime ?? ""
    const day = start.slice(0, 10)
    if (!day) continue
    const values = groups.get(day) ?? []
    values.push(index)
    groups.set(day, values)
  }

  return Array.from(groups.values()).slice(0, 7).map(indices => {
    const daytimeIndex = indices.find(index => {
      const hour = new Date(weather.Time[index]?.StartTime ?? "").getHours()
      return hour >= 6 && hour < 18
    }) ?? indices[0]
    const start = weather.Time[daytimeIndex]?.StartTime ?? ""
    return {
      start,
      end: weather.Time[daytimeIndex]?.EndTime ?? "",
      weather: firstValue(weather, daytimeIndex, ["Weather"]),
      temperature: firstValue(high, daytimeIndex, ["MaxTemperature", "Temperature"]),
      lowTemperature: firstValue(low, daytimeIndex, ["MinTemperature", "Temperature"]),
      feelsLike: "--",
      pop: firstValue(pop, daytimeIndex, ["ProbabilityOfPrecipitation"]),
      humidity: "--",
      windSpeed: firstValue(windSpeed, daytimeIndex, ["WindSpeed"]),
      windDirection: firstValue(windDirection, daytimeIndex, ["WindDirection"]),
      comfort: firstValue(comfort, daytimeIndex, ["ComfortIndexDescription", "ComfortIndex"]),
    }
  })
}

function localizeTown(city: string, district: string) {
  const normalizedCity = normalizeCity(city)
  return { city: normalizedCity, district: district.trim().replace(normalizedCity, "").trim() }
}

export async function fetchForecast(config: Config): Promise<WeatherData> {
  if (!config.apiKey.trim()) throw new Error("請先輸入中央氣象署 API Key")
  if (!config.district.trim()) throw new Error("請輸入區、鄉或鎮")

  const place = localizeTown(config.city, config.district)
  const dataSet = FORECAST_DATASETS[place.city]
  if (!dataSet) throw new Error(`尚不支援 ${place.city} 的鄉鎮預報資料`)

  const fetchDataSet = async (requestedDataSet: string) => {
    const url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/" + requestedDataSet
      + "?Authorization=" + encodeURIComponent(config.apiKey.trim())
      + "&format=JSON&LocationName=" + encodeURIComponent(place.district)
    const response = await fetch(url)
    if (!response.ok) throw new Error("天氣資料 HTTP " + response.status)
    const json = await response.json()
    if (json.success !== "true" && json.success !== true) {
      throw new Error("中央氣象署未接受此 API Key 或查詢")
    }
    return json
  }

  const [shortJson, weeklyJson] = await Promise.all([
    fetchDataSet(dataSet),
    fetchDataSet(weeklyDataSet(dataSet)),
  ])

  const group = (shortJson.records?.Locations ?? []).find(
    (item: any) => normalizeCity(item.LocationsName ?? "") === place.city,
  )
  const selected = (group?.Location ?? []).find((location: any) => location.LocationName === place.district)
  if (!selected) throw new Error(`找不到 ${place.city}${place.district} 的鄉鎮預報`)

  const elements = selected.WeatherElement ?? []
  const wxCount = elementByName(elements, "天氣現象")?.Time?.length ?? 0
  const hourlyCount = elementByName(elements, "溫度")?.Time?.length ?? 0
  if (!wxCount || hourlyCount < 8) throw new Error("中央氣象署回傳的短期預報格式不完整")
  const points = Array.from({ length: wxCount }, (_, index) => pointFrom(elements, index))
  const hourlyTemperature = Array.from(
    { length: hourlyCount },
    (_, index) => hourlyTemperatureFrom(elements, index),
  ).filter(point => point.start).slice(0, 8)

  const weeklyGroup = (weeklyJson.records?.Locations ?? []).find(
    (item: any) => normalizeCity(item.LocationsName ?? "") === place.city,
  )
  const weeklySelected = (weeklyGroup?.Location ?? []).find(
    (location: any) => location.LocationName === place.district,
  )
  if (!weeklySelected) throw new Error("找不到七日預報資料")
  const daily = weeklyDailyFrom(weeklySelected.WeatherElement ?? [])
  if (daily.length < 7) throw new Error("中央氣象署回傳的七日預報格式不完整")

  return {
    city: normalizeCity(group?.LocationsName ?? place.city),
    district: selected.LocationName,
    updatedAt: Date.now(),
    current: points[0],
    hourly: points.slice(0, 3),
    hourlyTemperature,
    daily,
  }
}
