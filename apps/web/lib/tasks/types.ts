// DTOs que cruzan el borde server → client. Todo serializable (fechas en ISO).

import type {
  TaskAutomationTrigger,
  TaskCategory,
  TaskPriority,
  TaskRecurrenceFreq,
  TaskSource,
  TaskStatus,
} from '@/lib/tasks/constants';

export interface TaskMember {
  /** users.id interno (el que referencian task_assignees y audit). */
  userId: string;
  clerkUserId: string;
  email: string;
  /** Nombre legible: el que Clerk expone, o el local part del email. */
  name: string;
  initials: string;
  role: string;
}

export interface ChecklistItemDTO {
  id: string;
  content: string;
  done: boolean;
  order: number;
}

export interface TaskCommentDTO {
  id: string;
  kind: 'comment' | 'activity';
  body: string;
  authorUserId: string | null;
  authorName: string | null;
  createdAt: string;
}

export interface TaskDTO {
  id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  boardPosition: number;
  dueAt: string | null;
  dueAllDay: boolean;
  completedAt: string | null;
  source: TaskSource;
  automationTrigger: TaskAutomationTrigger | null;
  templateId: string | null;
  requiresEvidence: boolean;
  evidenceNote: string | null;
  labels: string[];
  assigneeIds: string[];
  checklistTotal: number;
  checklistDone: number;
  commentCount: number;
  patientGhlContactId: string | null;
  patientName: string | null;
  patientPhone: string | null;
  callId: string | null;
  whatsappConversationId: string | null;
  ghlAppointmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetailDTO extends TaskDTO {
  checklist: ChecklistItemDTO[];
  comments: TaskCommentDTO[];
  createdByUserId: string | null;
}

export interface TaskTemplateItemDTO {
  id: string;
  content: string;
  order: number;
}

export interface TaskTemplateDTO {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  recurrenceFreq: TaskRecurrenceFreq;
  recurrenceInterval: number;
  recurrenceWeekdays: number[];
  recurrenceMonthDay: number | null;
  recurrenceMonth: number | null;
  dueTime: string;
  leadDays: number;
  defaultRole: string | null;
  defaultAssigneeUserId: string | null;
  requiresEvidence: boolean;
  enabled: boolean;
  isSystem: boolean;
  lastMaterializedOn: string | null;
  items: TaskTemplateItemDTO[];
  /** Cuántas instancias generó y cuántas se cerraron (últimos 30 días). */
  stats: { generated: number; completed: number };
}

export interface TaskAutomationRuleDTO {
  id: string;
  trigger: TaskAutomationTrigger;
  enabled: boolean;
  titleTemplate: string;
  descriptionTemplate: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  dueOffsetMinutes: number;
  assigneeUserId: string | null;
  assigneeRole: string | null;
  requiresEvidence: boolean;
  params: Record<string, unknown>;
  /** Tareas creadas por esta regla en los últimos 30 días. */
  generatedLast30d: number;
}

export interface TaskStatsDTO {
  overdue: number;
  today: number;
  upcoming: number;
  doneThisWeek: number;
  /** % de vencidas en 7 días que se cerraron. `null` = no hubo nada que vencer. */
  complianceRate: number | null;
  /** Horas medias entre creación y cierre (últimos 30 días). */
  avgCloseHours: number | null;
  automated: number;
  manual: number;
  routine: number;
  perMember: Array<{ userId: string; open: number; overdue: number; doneThisWeek: number }>;
}

export interface TasksBoardData {
  tasks: TaskDTO[];
  members: TaskMember[];
  stats: TaskStatsDTO;
  currentUserId: string | null;
  timezone: string;
  canEdit: boolean;
}
