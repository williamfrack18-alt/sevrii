// The marketing agent's data as the dashboard sees it (shared by the server
// actions in app/agentActions.ts and the panel in app/dashboard/AgentPanel.tsx).

export type AgentItemKind = "launch" | "budget" | "variation" | "pause" | "resume" | "info";
export type AgentItemStatus = "pending" | "approved" | "done" | "dismissed" | "auto" | "error";

export type AgentItem = {
  id: string;
  kind: AgentItemKind;
  status: AgentItemStatus;
  title: string; // one line, plain language
  detail: string; // why, numbers, what will happen
  campaignId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type AgentPostChannel = "facebook" | "instagram" | "google";
export type AgentPost = {
  id: string;
  channel: AgentPostChannel;
  day: string; // YYYY-MM-DD
  text: string;
  photo: number; // index in [cover, ...gallery]
  status: "ready" | "used";
};

export type AgentNumbers = { views: number; chats: number; contacts: number; spendUsd: number | null };

export type AgentState = {
  allowed: boolean; // the plan includes Marketing
  started: boolean; // the owner started the agent
  budgetUsd: number | null; // monthly maximum the owner set
  metaReady: boolean; // Sevrii's Meta app is configured
  metaConnected: boolean; // this owner connected Facebook (with ad account + page)
  pending: AgentItem[]; // waiting for the owner's OK
  activity: AgentItem[]; // what the agent did (newest first)
  posts: AgentPost[]; // upcoming free posts
  week: AgentNumbers; // last 7 days
  prevWeek: AgentNumbers; // the 7 days before
  lastRunAt: string | null;
};

export type AgentResult = { ok: true; state: AgentState } | { ok: false; error: string };
