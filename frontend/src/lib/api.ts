/**
 * The single data channel to the Research OS backend.
 * Pages never touch the database directly — everything goes through these
 * typed fetchers.
 *
 * API base resolution order (desktop packaging needs runtime control):
 * 1. window.__RESEARCH_OS_API_BASE__ — injected by the desktop shell
 *    (desktop/config.js), which knows the port of the bundled sidecar.
 * 2. NEXT_PUBLIC_API_URL — build-time override for self-hosted setups.
 * 3. http://localhost:8000 — dev default.
 */
export function resolveApiBase(): string {
  if (typeof window !== "undefined") {
    const injected = (window as unknown as { __RESEARCH_OS_API_BASE__?: string })
      .__RESEARCH_OS_API_BASE__;
    if (injected) return injected.replace(/\/$/, "");
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

const API_BASE = resolveApiBase();

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err) {
    throw new ApiError(
      `无法连接后端 (${API_BASE})，请确认 uvicorn 已启动`,
      0,
      { cause: err },
    );
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail))
        detail = body.detail
          .map((d: { msg?: string }) => d?.msg ?? JSON.stringify(d))
          .join("；");
      else if (body.detail) detail = JSON.stringify(body.detail);
    } catch {
      // keep statusText
    }
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ------------------------------ types ------------------------------ */

export type ProjectStatus = "active" | "paused" | "archived";
export type IdeaStatus = "exploring" | "testing" | "validated" | "refuted" | "parked";
export type RunStatus = "planned" | "running" | "succeeded" | "failed" | "stopped";
export type Verdict = "supports" | "refutes" | "inconclusive";
export type EdgeRelation =
  | "revision"
  | "derivation"
  | "merge"
  | "challenges"
  | "supersedes";

export interface Project {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  idea_count: number;
  run_count: number;
  note_count: number;
}

export interface IdeaVersion {
  id: number;
  idea_id: number;
  version_number: number;
  body: string;
  change_reason: string | null;
  created_at: string;
}

export interface EvidenceOnVersion {
  id: number;
  verdict: Verdict;
  note: string | null;
  run_id: number;
  run_name: string;
  run_status: RunStatus;
  created_at: string;
}

export interface IdeaVersionDetail extends IdeaVersion {
  evidence: EvidenceOnVersion[];
}

export interface Idea {
  research_idea_id: number | null;
  id: number;
  project_id: number;
  title: string;
  status: IdeaStatus;
  current_version_id: number | null;
  versions: IdeaVersion[];
  created_at: string;
  updated_at: string;
}

export interface IdeaEdge {
  id: number;
  src_version_id: number;
  dst_version_id: number;
  relation: EdgeRelation;
  note: string | null;
  created_at: string;
}

export interface IdeaGraph {
  idea: Idea;
  versions: IdeaVersionDetail[];
  edges: IdeaEdge[];
}

export interface Run {
  research_idea_id: number | null;
  target_version_id: number | null;
  id: number;
  project_id: number;
  name: string;
  status: RunStatus;
  external_source: string;
  external_key: string;
  git_commit: string | null;
  dataset: string | null;
  eval_protocol: string | null;
  notes: string | null;
  params: Record<string, unknown> | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetricPoint {
  name: string;
  step: number;
  value: number;
  timestamp: string;
}

export interface MetricSeries {
  name: string;
  points: MetricPoint[];
}

export interface RunMetricStat {
  name: string;
  count: number;
  last_step: number;
  last_value: number;
  min_value: number;
  max_value: number;
}

export interface EvidenceOnRun {
  id: number;
  verdict: Verdict;
  note: string | null;
  idea_id: number;
  idea_title: string;
  version_number: number;
  created_at: string;
  updated_at: string;
}

export interface RunDetail extends Run {
  metric_stats: RunMetricStat[];
  evidence: EvidenceOnRun[];
}

export interface ResearchNote {
  is_done: boolean;
  id: number;
  project_id: number;
  idea_id: number | null;
  run_id: number | null;
  title: string;
  content: string | null;
  created_at: string;
  updated_at: string;
}

/* ----------------------------- projects ----------------------------- */

export const listProjects = () => request<Project[]>("/api/projects");

export const createProject = (body: { name: string; description?: string; status?: ProjectStatus }) =>
  request<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) });

export const getProject = (id: number) => request<Project>(`/api/projects/${id}`);

export const updateProject = (id: number, body: { name?: string; description?: string; status?: ProjectStatus }) =>
  request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const deleteProject = (id: number) =>
  request<void>(`/api/projects/${id}`, { method: "DELETE" });

/* ------------------------------- ideas ------------------------------ */

export const listIdeas = (projectId: number) =>
  request<Idea[]>(`/api/projects/${projectId}/ideas`);

export const createIdea = (
  projectId: number,
  body: { title: string; body: string; change_reason?: string; research_idea_id?: number },
) => request<Idea>(`/api/projects/${projectId}/ideas`, { method: "POST", body: JSON.stringify(body) });

export const getIdea = (id: number) => request<Idea>(`/api/ideas/${id}`);

export const updateIdea = (id: number, body: { title?: string; status?: IdeaStatus; research_idea_id?: number | null }) =>
  request<Idea>(`/api/ideas/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const addIdeaVersion = (ideaId: number, body: { body: string; change_reason?: string }) =>
  request<IdeaVersion>(`/api/ideas/${ideaId}/versions`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getIdeaGraph = (ideaId: number) => request<IdeaGraph>(`/api/ideas/${ideaId}/graph`);

/* ------------------------------- runs ------------------------------- */

export const listRuns = (projectId: number) =>
  request<Run[]>(`/api/projects/${projectId}/runs`);

export const createRun = (
  projectId: number,
  body: {
    name: string;
    status?: RunStatus;
    git_commit?: string;
    dataset?: string;
    eval_protocol?: string;
    params?: Record<string, unknown>;
    notes?: string;
    target_version_id?: number | null;
    research_idea_id?: number | null;
  },
) => request<Run>(`/api/projects/${projectId}/runs`, { method: "POST", body: JSON.stringify(body) });

export const getRun = (id: number) => request<RunDetail>(`/api/runs/${id}`);

export const updateRun = (id: number, body: Partial<Pick<Run, "name" | "status" | "git_commit" | "dataset" | "eval_protocol" | "params" | "notes" | "started_at" | "finished_at" | "target_version_id" | "research_idea_id">>) =>
  request<Run>(`/api/runs/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const addMetrics = (id: number, points: { name: string; step: number; value: number }[]) =>
  request(`/api/runs/${id}/metrics`, { method: "POST", body: JSON.stringify({ points }) });

export const updateNote = (id: number, body: { title?: string; content?: string; is_done?: boolean }) =>
  request<ResearchNote>(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const getRunMetrics = (id: number) =>
  request<{ run_id: number; series: MetricSeries[] }>(`/api/runs/${id}/metrics`);

/* ------------------------------ evidence ---------------------------- */

export const linkEvidence = (body: {
  idea_version_id: number;
  run_id: number;
  verdict: Verdict;
  note?: string;
}) =>
  request<{ id: number }>("/api/evidence-links", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const listVersionEvidence = (versionId: number) =>
  request<EvidenceOnVersion[]>(`/api/idea-versions/${versionId}/evidence`);

/* --------------------------- idea graph (Phase 2) --------------------------- */

export interface GraphNode {
  id: number; // stable idea_versions.id
  idea_id: number;
  title: string;
  summary: string;
  status: IdeaStatus;
  version: number;
  change_reason: string | null;
  evidence_count: number;
  run_count: number;
  supports_count: number;
  refutes_count: number;
  created_at: string;
}

export interface GraphEdge {
  id: number;
  source: number;
  target: number;
  relation: EdgeRelation;
  reason: string | null;
  created_at: string;
}

export interface ProjectIdeaGraph {
  project_id: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphVersionBrief {
  id: number;
  idea_id: number;
  title: string;
  version_number: number;
  status: IdeaStatus;
}

export interface GraphRelationLink {
  edge_id: number;
  relation: EdgeRelation;
  reason: string | null;
  other: GraphVersionBrief;
}

export interface RunMetricBrief {
  name: string;
  last_step: number;
  last_value: number;
}

export interface EvidenceDetailItem {
  id: number;
  verdict: Verdict;
  note: string | null;
  created_at: string;
  run_id: number;
  run_name: string;
  run_status: RunStatus;
  run_metrics: RunMetricBrief[];
}

export interface IdeaVersionDetails {
  version: IdeaVersion;
  idea: {
    id: number;
    project_id: number;
    title: string;
    status: IdeaStatus;
    created_at: string;
    updated_at: string;
  };
  previous_version: IdeaVersion | null;
  incoming: GraphRelationLink[];
  outgoing: GraphRelationLink[];
  evidence: EvidenceDetailItem[];
  notes: ResearchNote[];
}

export const getProjectIdeaGraph = (projectId: number) =>
  request<ProjectIdeaGraph>(`/api/projects/${projectId}/idea-graph`);

export const getIdeaVersionDetails = (versionId: number) =>
  request<IdeaVersionDetails>(`/api/idea-versions/${versionId}/details`);

/* ------------------------------- notes ------------------------------ */

export const listNotes = (projectId: number) =>
  request<ResearchNote[]>(`/api/projects/${projectId}/notes`);

export const createNote = (
  projectId: number,
  body: { title: string; content?: string; idea_id?: number; run_id?: number },
) =>
  request<ResearchNote>(`/api/projects/${projectId}/notes`, {
    method: "POST",
    body: JSON.stringify(body),
  });

/* ------------------------ conversations & AI (Phase 3) ------------------------ */

export interface ConversationMessageRead {
  id: number;
  sequence: number;
  role: "user" | "assistant" | "system";
  content: string;
  sent_at: string | null;
}

export interface Conversation {
  id: number;
  project_id: number;
  title: string;
  source: string;
  content_hash: string;
  message_count: number;
  char_count: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: ConversationMessageRead[];
}

export interface ConversationImportResult {
  conversation: ConversationDetail;
  deduplicated: boolean;
  warnings: string[];
}

export interface PayloadPreview {
  conversation_id: number;
  segment_count: number;
  segment_max_chars: number;
  masked_chars: number;
  segments: string[];
}

export type AnalysisJobStatus =
  | "pending"
  | "parsing"
  | "extracting"
  | "matching"
  | "proposing"
  | "completed"
  | "failed";

export interface AnalysisJob {
  id: number;
  project_id: number;
  conversation_id: number;
  status: AnalysisJobStatus;
  model: string;
  prompt_version: string;
  segment_count: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisJobSummary extends AnalysisJob {
  event_count: number;
  proposal_count: number;
  pending_count: number;
  needs_revision_count: number;
  accepted_count: number;
  applied_count: number;
}

export interface ResearchEventRead {
  id: number;
  job_id: number;
  sequence: number;
  event_type: string;
  title: string;
  description: string;
  source_message_ids: number[];
  related_idea_version_ids: number[];
  reasoning: string;
  evidence_type: string;
  uncertainty: "low" | "medium" | "high";
  proposed_action: string;
  matched_idea_id: number | null;
  match_status: string;
  match_score: number | null;
}

export type ActionType =
  | "create_idea"
  | "create_idea_version"
  | "create_idea_edge"
  | "add_research_note"
  | "add_open_question"
  | "propose_status_change"
  | "link_existing_idea";

export type ReviewStatus = "pending" | "accepted" | "rejected" | "needs_revision" | "applied";

export interface GraphChangeProposal {
  id: number;
  job_id: number;
  project_id: number;
  event_id: number | null;
  action_type: ActionType;
  target_entity_id: number | null;
  payload: Record<string, unknown>;
  source_message_ids: number[];
  explanation: string;
  review_status: ReviewStatus;
  depends_on_proposal_ids: number[];
  baseline_version_id: number | null;
  review_note: string | null;
  applied_batch_id: number | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplyResult {
  batch_id: number;
  applied: { proposal_id: number; action_type: string; [key: string]: unknown }[];
  skipped: { proposal_id: number; action_type: string; reason: string }[];
  blocked: { proposal_id: number; action_type: string; reason: string }[];
  conversation_title: string | null;
}

export interface ProposalSummary {
  pending_count: number;
  total_count: number;
  latest_job_id: number | null;
}

export interface VersionSource {
  conversation_id: number;
  conversation_title: string | null;
  job_id: number | null;
  entity_type: string;
  entity_id: number;
  message_ids: number[];
}

export const importConversation = (
  projectId: number,
  body: { title?: string; source: "paste" | "file_md" | "file_txt" | "file_json"; content: string },
) =>
  request<ConversationImportResult>(`/api/projects/${projectId}/conversations`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const uploadConversationFile = async (
  projectId: number,
  file: File,
): Promise<ConversationImportResult> => {
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/projects/${projectId}/conversations/upload`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    throw new ApiError(`无法连接后端 (${API_BASE})`, 0, { cause: err });
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // keep statusText
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as ConversationImportResult;
};

export const listConversations = (projectId: number) =>
  request<Conversation[]>(`/api/projects/${projectId}/conversations`);

export const getConversation = (id: number) =>
  request<ConversationDetail>(`/api/conversations/${id}`);

export const getPayloadPreview = (id: number) =>
  request<PayloadPreview>(`/api/conversations/${id}/payload-preview`);

export const startAnalysis = (conversationId: number) =>
  request<AnalysisJob>(`/api/conversations/${conversationId}/analyze`, { method: "POST" });

export const getAnalysisJob = (jobId: number) =>
  request<AnalysisJobSummary>(`/api/analysis-jobs/${jobId}`);

export const listAnalysisJobs = (projectId: number) =>
  request<AnalysisJobSummary[]>(`/api/projects/${projectId}/analysis-jobs`);

export const getJobEvents = (jobId: number) =>
  request<ResearchEventRead[]>(`/api/analysis-jobs/${jobId}/events`);

export const getJobProposals = (jobId: number) =>
  request<GraphChangeProposal[]>(`/api/analysis-jobs/${jobId}/proposals`);

export const reviewProposal = (
  proposalId: number,
  body: {
    review_status?: ReviewStatus;
    review_note?: string;
    edits?: {
      title?: string;
      body?: string;
      change_reason?: string;
      target_idea_id?: number;
      relation?: EdgeRelation;
      status?: IdeaStatus;
      note_content?: string;
      src_version_id?: number;
      dst_version_id?: number;
    };
  },
) => request<GraphChangeProposal>(`/api/proposals/${proposalId}`, { method: "PATCH", body: JSON.stringify(body) });

export const applyProposals = (jobId: number, proposalIds?: number[]) =>
  request<ApplyResult>(`/api/analysis-jobs/${jobId}/apply`, {
    method: "POST",
    body: JSON.stringify(proposalIds ? { proposal_ids: proposalIds } : {}),
  });

export const getProposalSummary = (projectId: number) =>
  request<ProposalSummary>(`/api/projects/${projectId}/proposals-summary`);

export const getVersionSources = (versionId: number) =>
  request<VersionSource[]>(`/api/idea-versions/${versionId}/sources`);

/* -------------------------- agent prompt import (P4) -------------------------- */

export interface AgentPromptInfo {
  key: "session" | "idea" | "run" | "evidence" | "note";
  name: string;
  description: string;
  prompt: string;
}

export interface AgentImportItem {
  kind: string;
  label: string;
  status: "created" | "skipped" | "error";
  id: number | null;
  detail: string | null;
}

export interface AgentImportResult {
  ok: boolean;
  prompt_version: string;
  created: AgentImportItem[];
  skipped: AgentImportItem[];
  errors: AgentImportItem[];
}

export const getAgentPrompts = () =>
  request<{ version: string; prompts: AgentPromptInfo[] }>("/api/agent-prompts");

export const agentImport = (
  projectId: number,
  body: { module: AgentPromptInfo["key"]; content: string; dry_run: boolean },
) =>
  request<AgentImportResult>(`/api/projects/${projectId}/agent-import`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export interface ModelSettings { configured: boolean; base_url: string; model: string; temporary: boolean }
export const getModelSettings = () => request<ModelSettings>("/api/model-settings");
export const setModelSettings = (body: { api_key: string; base_url: string; model: string }) => request<ModelSettings>("/api/model-settings", { method: "PUT", body: JSON.stringify(body) });
export interface AgentParseResult {
  records: Record<string, Record<string, unknown>[]>;
  normalized: string;
  segments: number;
  masked_count: number;
  preview: AgentImportResult;
}
export const parseAgentContent = (projectId: number, module: AgentPromptInfo["key"], content: string) =>
  request<AgentParseResult>(`/api/projects/${projectId}/agent-import/parse`, { method: "POST", body: JSON.stringify({ module, content, dry_run: true }) });

export type ResearchSections = { background: string | null; goal: string | null; methods: string | null; innovation: string | null; theory: string | null; results: string | null; conclusions: string | null; future_plan: string | null };
export type ResearchIdeaStatus = "exploring" | "testing" | "promising" | "paused" | "abandoned" | "completed";
export interface ResearchIdea extends ResearchSections { id: number; project_id: number; title: string; status: ResearchIdeaStatus; status_reason: string | null; decision_source: string | null; decision_time: string | null; related_evidence: string | null }
export interface ResearchDocument { id: number; filename: string; created_at: string; content?: string }
export interface ResearchConclusion { id: number; run_id: number | null; content: string; created_at: string }
export interface ProposalParse { source_hash: string; sections: ResearchSections; hypotheses: { title: string; body: string }[]; segments: number; masked_count: number }
export const listResearchIdeas = (id: number) => request<ResearchIdea[]>(`/api/projects/${id}/research-ideas`);
export const createResearchIdea = (id: number, title: string) => request<ResearchIdea>(`/api/projects/${id}/research-ideas`, { method: "POST", body: JSON.stringify({ title }) });
export const getResearchIdea = (id: number) => request<ResearchIdea>(`/api/research-ideas/${id}`);
export const updateResearchIdea = (id: number, body: Partial<ResearchIdea>) => request<ResearchIdea>(`/api/research-ideas/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const getResearchPrompt = () => request<{prompt: string}>("/api/research-idea-prompt");
export const parseResearchDocument = (id: number, filename: string, content: string) => request<ProposalParse>(`/api/research-ideas/${id}/documents/parse`, { method: "POST", body: JSON.stringify({filename, content}) });
export const saveResearchDocument = (id: number, filename: string, content: string, parsed: ProposalParse) => request<{id: number}>(`/api/research-ideas/${id}/documents`, { method: "POST", body: JSON.stringify({filename, content, sections: parsed.sections, hypotheses: parsed.hypotheses, source_hash: parsed.source_hash}) });
export const listResearchDocuments = (id: number) => request<ResearchDocument[]>(`/api/research-ideas/${id}/documents`);
export const getResearchDocument = (id: number, doc: number) => request<ResearchDocument>(`/api/research-ideas/${id}/documents/${doc}`);
export const listResearchConclusions = (id: number) => request<ResearchConclusion[]>(`/api/research-ideas/${id}/conclusions`);
export const addResearchConclusion = (id: number, content: string, run_id: number | null) => request<ResearchConclusion>(`/api/research-ideas/${id}/conclusions`, { method: "POST", body: JSON.stringify({content, run_id}) });

export const deleteResearchConclusion = (id: number, conclusion: number) => request<void>(`/api/research-ideas/${id}/conclusions/${conclusion}`, { method: "DELETE" });

export interface IdeaEvolutionEdge { id: number; source_id: number; target_id: number; relation_type: string; reason: string | null; trigger_type: string | null; trigger_description: string | null; source_references: string | null; linked_run_ids: number[] }
export interface IdeaEvolutionGraph { project_id: number; nodes: (ResearchIdea & { run_count: number; hypothesis_count: number })[]; edges: IdeaEvolutionEdge[]; unlinked_hypotheses: number; unlinked_runs: number }
export interface ResearchIdeaVersion { id: number; version_number: number; snapshot: ResearchIdea; change_reason: string | null; created_at: string }
export const getResearchEvolution = (project: number) => request<IdeaEvolutionGraph>(`/api/projects/${project}/research-evolution`);
export const getResearchVersions = (id: number) => request<ResearchIdeaVersion[]>(`/api/research-ideas/${id}/versions`);
export type EdgeInput = Omit<IdeaEvolutionEdge, "id">;
export const createResearchEdge = (id: number, body: EdgeInput) => request<{id:number}>(`/api/projects/${id}/research-evolution/edges`, { method: "POST", body: JSON.stringify(body) });
export const updateResearchEdge = (id: number, body: EdgeInput) => request<{id:number}>(`/api/research-evolution/edges/${id}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteResearchEdge = (id: number) => request<{id:number}>(`/api/research-evolution/edges/${id}`, { method: "DELETE" });
export interface EvolutionHypothesis {title: string; body: string}
export type EvolutionRevision = Partial<ResearchSections> & {status: ResearchIdeaStatus | null; status_reason: string | null; change_reason: string | null};
export interface EvolutionIdea extends Omit<Partial<ResearchIdea>, "status"> { versions: EvolutionRevision[]; status: ResearchIdeaStatus | null; local_ref: string; title: string; hypotheses: EvolutionHypothesis[]; action: "unresolved" | "new" | "existing" | "version" | "skip"; existing_id: number | null; candidates: number[]; change_reason: string | null }
export interface EvolutionRun {local_ref:string; idea_ref:string; name:string; status: RunStatus | null; notes:string | null; dataset:string | null; eval_protocol:string | null; params:Record<string,unknown> | null; metrics:{name:string;step:number;value:number}[]; action:"new" | "existing" | "skip"; existing_id:number | null}
export interface EvolutionEdgeDraft {source_ref:string; target_ref:string; relation_type:string; reason:string | null; trigger_type:string | null; trigger_description:string | null; source_references:string | null; linked_run_refs:string[]; include:boolean}
export interface EvolutionEvidence {idea_ref:string; hypothesis_title:string; run_ref:string; verdict:"supports"|"refutes"|"inconclusive"; note:string|null; include:boolean}
export interface EvolutionDraft {ideas:EvolutionIdea[]; runs:EvolutionRun[]; edges:EvolutionEdgeDraft[]; evidence:EvolutionEvidence[]}
export interface EvolutionParse {draft:EvolutionDraft; source_hash:string; segments:number; masked_count:number; existing_ideas:{id:number;title:string}[]; existing_runs:{id:number;name:string}[]}
export const getEvolutionPrompt = () => request<{prompt:string}>("/api/research-evolution/prompt");
export const parseEvolution = (id:number,filename:string,content:string) => request<EvolutionParse>(`/api/projects/${id}/research-evolution/parse`,{method:"POST",body:JSON.stringify({filename,content})});
export const applyEvolution = (id:number,filename:string,content:string,parsed:EvolutionParse) => request<{counts:Record<string,number>;idea_ids:number[]}>(`/api/projects/${id}/research-evolution/apply`,{method:"POST",body:JSON.stringify({filename,content,source_hash:parsed.source_hash,draft:parsed.draft})});
