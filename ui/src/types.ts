export type Status = 'running' | 'done' | 'error';

export type Agent = {
  id: string;
  parentId: string | null;
  type: string;
  description: string | null;
  model: string | null;
  status: Status;
  startedAt: number;
  endedAt: number | null;
  toolCalls: number;
  lastAction: string | null;
  currentTool: string | null;
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number };
  costUsd: number | null;
};

export type Task = {
  id: string;
  subject: string;
  description?: string | null;
  activeForm?: string | null;
  status: 'pending' | 'in_progress' | 'completed' | string;
  agentId: string; // creator
  assignee?: string | null;
  assigneeBy?: 'explicit' | 'self' | 'match' | 'updater';
  helpers?: string[]; // other subagents Claude gave the same task id
  owner?: string;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
};

export type InboxItem = {
  id: string;
  kind: 'decision' | 'review' | 'info';
  title: string;
  body: string | null;
  taskId: string | null;
  agentId: string;
  createdAt: number;
  status: 'unread' | 'read' | 'answered';
  readAt?: number;
};

export type BackgroundTask = { id?: string; type?: string; name?: string; description?: string; status?: string; [k: string]: unknown };

export type Session = {
  id: string;
  cwd: string;
  transcriptPath: string | null;
  startedAt: number;
  endedAt: number | null;
  lastEventAt: number;
  waiting: 'input' | null;
  pid?: number;
  background: BackgroundTask[];
  tasks: Record<string, Task>;
  inbox: Record<string, InboxItem>;
  agents: Record<string, Agent>;
};

export type ActivityItem = {
  id: string;
  ts: number;
  agentId: string;
  kind: 'tool' | 'prompt' | 'reply' | 'agent' | 'approval' | 'notice' | 'board-message' | 'board-reply';
  name?: string;
  summary?: string;
  args?: unknown;
  result?: unknown;
  status: 'running' | 'success' | 'error' | 'info';
  duration?: number;
  childId?: string;
};

export type Question = {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
};

export type ApprovalRequest = {
  id: string;
  sessionId: string;
  agentId: string;
  agentType: string | null;
  cwd: string;
  toolName: string;
  toolInput: Record<string, unknown> & { questions?: Question[] };
  suggestions: unknown[];
  kind: 'permission' | 'question';
  createdAt: number;
  status: 'pending' | 'allowed' | 'denied' | 'answered' | 'elsewhere';
  resolvedAt?: number;
  answers?: Record<string, string> | null;
};

export type Decision = { behavior: 'allow' | 'deny'; answers?: Record<string, string>; remember?: boolean; message?: string };
