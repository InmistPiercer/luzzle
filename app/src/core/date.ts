export type Day = string

let dayOffset = 0

export const setDayOffset = (n: number) => {
  dayOffset = n
}


export const dayStr = (d: Date): Day =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const dayToDate = (day: Day): Date => new Date(`${day}T00:00:00`)

export const addDays = (day: Day, n: number): Day => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return dayStr(d)
}

export const diffDays = (a: Day, b: Day): number =>
  Math.round((new Date(`${a}T12:00:00`).getTime() - new Date(`${b}T12:00:00`).getTime()) / 86400000)

export const today = (): Day => addDays(dayStr(new Date()), dayOffset)
