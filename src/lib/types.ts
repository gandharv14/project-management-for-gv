export const TASK_STATUSES = ["backlog", "today", "in_progress", "blocked", "done"] as const;
export const BLOCKER_STATUSES = ["open", "acknowledged", "resolved"] as const;
export const SUGGESTION_STATUSES = ["open", "under_consideration", "accepted", "parked"] as const;
export const SUGGESTION_CATEGORIES = ["proposal", "project", "management", "process", "tooling", "other"] as const;
export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "custom"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type BlockerStatus = (typeof BLOCKER_STATUSES)[number];
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];
export type ProfileRole = "manager" | "member";
export type ProfileMembershipScope = "workspace" | "project";

export type Profile = {
  id: string;
  auth0_sub: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: ProfileRole;
  membership_scope: ProfileMembershipScope;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectMember = {
  project_id: string;
  profile_id: string;
  created_at: string;
  profiles?: Profile | null;
};

export type ProjectUserFlag = {
  id: string;
  project_id: string;
  flagged_by: string | null;
  email: string;
  discord_id: string | null;
  alias_email: string | null;
  reason: string;
  task_link: string | null;
  screenshot_urls: string[];
  created_at: string;
  updated_at: string;
  reporter?: Profile | null;
};

export type Task = {
  id: string;
  project_id: string;
  recurring_rule_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee_id: string | null;
  due_date: string | null;
  generated_for_date: string | null;
  sort_order: number;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  assignee?: Profile | null;
};

export type RecurringRule = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  frequency: RecurrenceFrequency;
  interval_days: number | null;
  weekdays: number[];
  next_run_on: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  assignee?: Profile | null;
};

export type Blocker = {
  id: string;
  project_id: string;
  task_id: string | null;
  title: string;
  description: string | null;
  status: BlockerStatus;
  owner_id: string | null;
  raised_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  owner?: Profile | null;
  raiser?: Profile | null;
  task?: Pick<Task, "id" | "title" | "assignee_id" | "status"> | null;
};

export type Suggestion = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  category: SuggestionCategory;
  status: SuggestionStatus;
  author_id: string | null;
  promoted_task_id: string | null;
  created_at: string;
  updated_at: string;
  author?: Profile | null;
  vote_count?: number;
  comment_count?: number;
  has_voted?: boolean;
};

export type SuggestionComment = {
  id: string;
  suggestion_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: Profile | null;
};

export type Notification = {
  id: string;
  profile_id: string;
  actor_id: string | null;
  type:
    | "assignment_created"
    | "blocker_status_changed"
    | "recurring_task_created"
    | "suggestion_traction"
    | "suggestion_promoted";
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};
