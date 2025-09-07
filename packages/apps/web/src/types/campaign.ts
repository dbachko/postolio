export interface CampaignFormData {
  name: string
  startDate: string
  endDate: string
  frequency: 'daily' | 'every2days' | '3weekly' | ''
  themes: string[]
  style: string
  postingTime: string
  priority: number
}

export interface CampaignErrors {
  name?: string
  startDate?: string
  endDate?: string
  frequency?: string
  themes?: string[]
  style?: string
  postingTime?: string
  priority?: string
}