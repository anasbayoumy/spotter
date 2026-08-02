"use client";

import {
  clientSummarySchema,
  contextTraceSchema,
  type ClientSummary,
  type ContextTrace,
} from "@spotter/contracts";
import { Database, LockKeyhole, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { z } from "zod";

import { Card } from "../../components/ui/card";
import { DefinitionList } from "../../components/ui/definition-list";
import { PageHeader } from "../../components/ui/page-header";
import { EmptyState, ErrorState, InlineStatus, LoadingState } from "../../components/ui/states";
import { requestApi, type ApiResult } from "../../lib/api/client";
import { useResource } from "../../lib/api/use-resource";
import { formatDateTime, formatLabel } from "../../lib/format";

interface TraceView {
  readonly client: ClientSummary | null;
  readonly trace: ContextTrace;
}

const clientListSchema = z.array(clientSummarySchema);

async function loadTrace(traceId: string, signal: AbortSignal): Promise<ApiResult<TraceView>> {
  const [trace, clients] = await Promise.all([
    requestApi(`/api/v1/traces/${traceId}`, contextTraceSchema, { signal }),
    requestApi("/api/v1/clients?limit=100", clientListSchema, { signal }),
  ]);
  return {
    data: {
      client: clients.data.find((client) => client.id === trace.data.clientId) ?? null,
      trace: trace.data,
    },
    meta: trace.meta,
  };
}

export function TraceInspectorPage({ traceId }: { readonly traceId: string }): React.JSX.Element {
  const resource = useResource(`trace:${traceId}`, (signal) => loadTrace(traceId, signal));
  if (resource.loading) return <LoadingState label="Loading exact context trace" />;
  if (resource.error !== null)
    return (
      <ErrorState error={resource.error} onRetry={resource.reload} title="Trace unavailable" />
    );
  if (resource.data === null)
    return (
      <EmptyState body="The trace response contained no evidence." title="Trace unavailable" />
    );

  const { client, trace } = resource.data;
  const usage = Math.min(100, Math.round((trace.tokenCount / trace.budget) * 100));
  return (
    <>
      <PageHeader
        actions={<span className="status-badge">{formatLabel(trace.intent)}</span>}
        description="The immutable, ordered context selected before the model call. No hidden reasoning or provider secrets are exposed."
        eyebrow="Audit evidence"
        title="Context trace"
      />
      <InlineStatus tone="info">
        This page contains synthetic handles and safe model input only. Hard constraints are visibly
        pinned and cannot be evicted.
      </InlineStatus>
      <div className="content-layout trace-layout">
        <div className="stack">
          <Card>
            <div className="card__header">
              <h2>Ordered context sections</h2>
              <span className="caption">{trace.sections.length} selected</span>
            </div>
            <div className="card__body">
              {trace.sections.length === 0 ? (
                <p className="muted caption">No context sections were selected for this run.</p>
              ) : (
                <ol className="trace-sections">
                  {trace.sections.map((section, index) => (
                    <li
                      className={
                        section.pinned ? "trace-section trace-section--pinned" : "trace-section"
                      }
                      key={section.id}
                    >
                      <div className="trace-section__index">
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <div className="trace-section__content">
                        <header>
                          <div>
                            <span>{formatLabel(section.kind)}</span>
                            <h3>{section.id}</h3>
                          </div>
                          {section.pinned ? (
                            <span className="pinned-badge">
                              <LockKeyhole aria-hidden="true" size={12} /> Pinned
                            </span>
                          ) : null}
                        </header>
                        <div className="trace-section__meta">
                          <span>{section.tokenEstimate} estimated tokens</span>
                          <span>{section.records.length} records</span>
                        </div>
                        {section.records.length === 0 ? null : (
                          <ul className="record-list">
                            {section.records.map((record) => (
                              <li key={record.recordId}>
                                <code>{record.recordId}</code>
                                <span>
                                  {record.source} · v{record.recordVersion ?? "none"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <details className="rendered-section">
                          <summary>Show rendered section</summary>
                          <pre>{section.rendered}</pre>
                        </details>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>
          <Card>
            <div className="card__header">
              <h2>Exact rendered model input</h2>
              <TerminalSquare aria-hidden="true" className="muted" size={18} />
            </div>
            <div className="card__body">
              <pre className="trace-rendered">{trace.rendered}</pre>
            </div>
          </Card>
        </div>
        <aside className="stack trace-sidebar">
          <Card>
            <div className="card__header">
              <h2>Trace metadata</h2>
              <Database aria-hidden="true" className="muted" size={18} />
            </div>
            <div className="card__body">
              <DefinitionList
                items={[
                  { label: "Trace ID", value: <code>{trace.id}</code> },
                  { label: "Turn ID", value: <code>{trace.turnId}</code> },
                  { label: "Intent", value: formatLabel(trace.intent) },
                  { label: "Created", value: formatDateTime(trace.createdAt) },
                  {
                    label: "Client",
                    value:
                      client === null ? (
                        "Unknown synthetic client"
                      ) : (
                        <Link className="text-link" href={`/clients/${client.id}`}>
                          {client.handle}
                        </Link>
                      ),
                  },
                ]}
              />
            </div>
          </Card>
          <Card>
            <div className="card__header">
              <h2>Context budget</h2>
            </div>
            <div className="card__body">
              <div className="budget-meter">
                <div className="budget-meter__values">
                  <strong>{trace.tokenCount.toLocaleString()}</strong>
                  <span>of {trace.budget.toLocaleString()} tokens</span>
                </div>
                <div
                  aria-label={`${String(usage)} percent of token budget used`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={usage}
                  className="budget-meter__track"
                  role="progressbar"
                >
                  <span style={{ width: `${String(usage)}%` }} />
                </div>
                <p>{usage}% of the configured budget selected.</p>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
