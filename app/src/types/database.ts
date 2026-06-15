export interface Database {
  public: {
    Tables: {
      categories: {
        Row: Category
        Insert: CategoryInsert
        Update: CategoryUpdate
      }
      tags: {
        Row: Tag
        Insert: TagInsert
        Update: TagUpdate
      }
      weekly_template_blocks: {
        Row: WeeklyTemplateBlock
        Insert: WeeklyTemplateBlockInsert
        Update: WeeklyTemplateBlockUpdate
      }
      calendar_blocks: {
        Row: CalendarBlock
        Insert: CalendarBlockInsert
        Update: CalendarBlockUpdate
      }
      time_entries: {
        Row: TimeEntry
        Insert: TimeEntryInsert
        Update: TimeEntryUpdate
      }
      daily_plans: {
        Row: DailyPlan
        Insert: DailyPlanInsert
        Update: DailyPlanUpdate
      }
      daily_plan_items: {
        Row: DailyPlanItem
        Insert: DailyPlanItemInsert
        Update: DailyPlanItemUpdate
      }
    }
    Functions: {
      start_timer_stop_previous: {
        Args: {
          p_category_id: string
          p_title: string
          p_tags: string[]
        }
        Returns: string
      }
      stop_timer: {
        Args: { p_entry_id: string }
        Returns: void
      }
    }
  }
}

export type CategoryKind = 'essential' | 'discretionary'

export interface Category {
  id: string
  user_id: string
  name: string
  color: string
  icon: string | null
  kind: CategoryKind
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CategoryInsert {
  id?: string
  user_id?: string
  name: string
  color?: string
  icon?: string | null
  kind?: CategoryKind
  sort_order?: number
}

export interface CategoryUpdate {
  name?: string
  color?: string
  icon?: string | null
  kind?: CategoryKind
  sort_order?: number
  deleted_at?: string | null
}

export interface Tag {
  id: string
  user_id: string
  category_id: string
  name: string
  created_at: string
  deleted_at: string | null
}

export interface TagInsert {
  id?: string
  user_id?: string
  category_id: string
  name: string
}

export interface TagUpdate {
  name?: string
  deleted_at?: string | null
}

export interface WeeklyTemplateBlock {
  id: string
  user_id: string
  category_id: string
  title: string
  day_of_week: number
  start_time: string
  end_time: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface WeeklyTemplateBlockInsert {
  id?: string
  user_id?: string
  category_id: string
  title: string
  day_of_week: number
  start_time: string
  end_time: string
}

export interface WeeklyTemplateBlockUpdate {
  category_id?: string
  title?: string
  day_of_week?: number
  start_time?: string
  end_time?: string
  deleted_at?: string | null
}

export type RecurrenceType = 'none' | 'daily' | 'weekdays' | 'mwf' | 'weekly' | 'custom'
export type BlockSource = 'template' | 'manual' | 'google_calendar'

export interface CalendarBlock {
  id: string
  user_id: string
  template_block_id: string | null
  category_id: string
  title: string
  date: string
  start_time: string
  end_time: string
  source: BlockSource
  recurrence: RecurrenceType
  recurrence_days: number[] | null
  recurrence_end: string | null
  tags: string[]
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface CalendarBlockInsert {
  id?: string
  user_id?: string
  template_block_id?: string | null
  category_id: string
  title: string
  date: string
  start_time: string
  end_time: string
  source?: BlockSource
  recurrence?: RecurrenceType
  recurrence_days?: number[] | null
  recurrence_end?: string | null
  tags?: string[]
  notes?: string | null
}

export interface CalendarBlockUpdate {
  category_id?: string
  title?: string
  date?: string
  start_time?: string
  end_time?: string
  source?: BlockSource
  recurrence?: RecurrenceType
  recurrence_days?: number[] | null
  recurrence_end?: string | null
  tags?: string[]
  notes?: string | null
  deleted_at?: string | null
}

export interface TimeEntry {
  id: string
  user_id: string
  category_id: string
  calendar_block_id: string | null
  title: string
  start_time: string
  end_time: string | null
  is_running: boolean
  tags: string[]
  notes: string | null
  command_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface TimeEntryInsert {
  id?: string
  user_id?: string
  category_id: string
  calendar_block_id?: string | null
  title: string
  start_time: string
  end_time?: string | null
  is_running?: boolean
  tags?: string[]
  notes?: string | null
}

export interface TimeEntryUpdate {
  category_id?: string
  calendar_block_id?: string | null
  title?: string
  start_time?: string
  end_time?: string | null
  is_running?: boolean
  tags?: string[]
  notes?: string | null
  deleted_at?: string | null
}

// ─── Daily planning (OBJECTIVE #7) ───────────────────────────
// Foundation for custom + AI-generated day plans. `source='ai'` plans carry
// generation provenance (prompt/model/generation_meta) so a future Claude.ai
// pipeline can populate them without a schema change.
export type PlanSource = 'manual' | 'ai' | 'template'
export type PlanStatus = 'draft' | 'active' | 'archived'

export interface DailyPlan {
  id: string
  user_id: string
  date: string
  source: PlanSource
  status: PlanStatus
  title: string | null
  prompt: string | null
  model: string | null
  generation_meta: Record<string, unknown>
  generated_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface DailyPlanInsert {
  id?: string
  user_id?: string
  date: string
  source?: PlanSource
  status?: PlanStatus
  title?: string | null
  prompt?: string | null
  model?: string | null
  generation_meta?: Record<string, unknown>
  generated_at?: string | null
}

export interface DailyPlanUpdate {
  date?: string
  source?: PlanSource
  status?: PlanStatus
  title?: string | null
  prompt?: string | null
  model?: string | null
  generation_meta?: Record<string, unknown>
  generated_at?: string | null
  deleted_at?: string | null
}

export interface DailyPlanItem {
  id: string
  user_id: string
  plan_id: string
  category_id: string | null
  title: string
  start_time: string
  end_time: string
  tags: string[]
  notes: string | null
  sort_order: number
  calendar_block_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface DailyPlanItemInsert {
  id?: string
  user_id?: string
  plan_id: string
  category_id?: string | null
  title: string
  start_time: string
  end_time: string
  tags?: string[]
  notes?: string | null
  sort_order?: number
  calendar_block_id?: string | null
}

export interface DailyPlanItemUpdate {
  category_id?: string | null
  title?: string
  start_time?: string
  end_time?: string
  tags?: string[]
  notes?: string | null
  sort_order?: number
  calendar_block_id?: string | null
  deleted_at?: string | null
}
