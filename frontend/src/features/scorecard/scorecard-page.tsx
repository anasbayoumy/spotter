"use client";

import { scorecardSchema, type Scorecard } from "@spotter/contracts";
import { BarChart3, Gauge, Radio, ShieldCheck, Sigma } from "lucide-react";

import { Card } from "../../components/ui/card";
import { PageHeader } from "../../components/ui/page-header";
import { EmptyState, ErrorState, InlineStatus, LoadingState } from "../../components/ui/states";
import { requestApi } from "../../lib/api/client";
import { useResource } from "../../lib/api/use-resource";
import { formatDateTime, formatLabel } from "../../lib/format";

interface MetricValue {
  readonly availability: "available" | "unavailable";
  readonly sampleSize: number;
  readonly value: number | null;
}

function MetricCard({
  format = "number",
  label,
  metric,
}: {
  readonly format?: "currency" | "milliseconds" | "number" | "percent";
  readonly label: string;
  readonly metric: MetricValue;
}): React.JSX.Element {
  let display = "Unavailable";
  if (metric.value !== null) {
    if (format === "percent") display = `${String(Math.round(metric.value * 100))}%`;
    else if (format === "currency") display = `$${metric.value.toFixed(3)}`;
    else if (format === "milliseconds") display = `${Math.round(metric.value).toLocaleString()} ms`;
    else display = metric.value.toFixed(2);
  }
  return (
    <Card className="metric-card">
      <span>{label}</span>
      <strong className={metric.value === null ? "metric-card__unavailable" : ""}>{display}</strong>
      <small>
        {metric.availability === "available"
          ? `${String(metric.sampleSize)} samples`
          : "No qualifying data"}
      </small>
    </Card>
  );
}

function Distribution({
  name,
  values,
}: {
  readonly name: string;
  readonly values: readonly number[];
}): React.JSX.Element {
  const max = Math.max(...values, 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <div className="distribution">
      <div className="distribution__header">
        <strong>{formatLabel(name)}</strong>
        <span>{total} scores</span>
      </div>
      <div aria-label={`${formatLabel(name)} score distribution`} className="distribution__bars">
        {values.map((value, index) => (
          <div key={`${name}:${String(index + 1)}`}>
            <span
              aria-label={`${String(value)} scores rated ${String(index + 1)}`}
              style={{
                height: `${String(value === 0 ? 0 : Math.max(5, Math.round((value / max) * 100)))}%`,
              }}
            />
            <small>{index + 1}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScorecardPage(): React.JSX.Element {
  const resource = useResource("scorecard", (signal) =>
    requestApi("/api/v1/scorecard", scorecardSchema, { signal }),
  );
  if (resource.loading) return <LoadingState label="Loading evaluation scorecard" />;
  if (resource.error !== null)
    return (
      <ErrorState error={resource.error} onRetry={resource.reload} title="Scorecard unavailable" />
    );
  if (resource.data === null)
    return <EmptyState body="No scorecard response is available." title="No evaluation data" />;

  const scorecard: Scorecard = resource.data;
  const safetyEntries = Object.entries(scorecard.safetyPassRateByGate).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const judgeEntries = Object.entries(scorecard.judgeDistribution).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const calibrationEntries = Object.entries(scorecard.calibrationKappaByJudge).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return (
    <>
      <PageHeader
        actions={
          <span className={`mode-badge mode-badge--${scorecard.mode}`}>
            <Radio aria-hidden="true" size={13} /> {formatLabel(scorecard.mode)} mode
          </span>
        }
        description={`Evaluation evidence generated ${formatDateTime(scorecard.generatedAt)}. Unavailable samples are never represented as zero.`}
        eyebrow="Quality & operations"
        title="Evaluation scorecard"
      />
      {scorecard.mode === "recorded" ? (
        <InlineStatus tone="info">
          Recorded mode reports deterministic fixture performance. It is not presented as live
          production evidence.
        </InlineStatus>
      ) : null}
      <div className="scorecard-metrics">
        <MetricCard format="percent" label="Review-band accuracy" metric={scorecard.bandAccuracy} />
        <MetricCard
          format="currency"
          label="Cost / published plan"
          metric={scorecard.costPerPublishedPlanUsd}
        />
        <MetricCard
          format="milliseconds"
          label="p50 model latency"
          metric={scorecard.latencyP50Ms}
        />
        <MetricCard
          format="milliseconds"
          label="p95 model latency"
          metric={scorecard.latencyP95Ms}
        />
      </div>
      <div className="scorecard-grid">
        <Card>
          <div className="card__header">
            <h2>Safety pass rate by gate</h2>
            <ShieldCheck aria-hidden="true" className="muted" size={18} />
          </div>
          <div className="card__body">
            {safetyEntries.length === 0 ? (
              <p className="muted caption">No safety gate samples are available.</p>
            ) : (
              <ul className="gate-metrics">
                {safetyEntries.map(([name, metric]) => (
                  <li key={name}>
                    <div>
                      <strong>{formatLabel(name)}</strong>
                      <span>
                        {metric.value === null
                          ? "Unavailable"
                          : `${String(Math.round(metric.value * 100))}%`}
                      </span>
                    </div>
                    <div aria-label={`${formatLabel(name)} pass rate`} className="metric-track">
                      <span
                        style={{
                          width: `${String(metric.value === null ? 0 : Math.round(metric.value * 100))}%`,
                        }}
                      />
                    </div>
                    <small>{metric.sampleSize} samples</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        <Card>
          <div className="card__header">
            <h2>Judge score distributions</h2>
            <BarChart3 aria-hidden="true" className="muted" size={18} />
          </div>
          <div className="card__body distribution-grid">
            {judgeEntries.length === 0 ? (
              <p className="muted caption">No judge score samples are available.</p>
            ) : (
              judgeEntries.map(([name, values]) => (
                <Distribution key={name} name={name} values={values} />
              ))
            )}
          </div>
        </Card>
        <Card className="scorecard-calibration">
          <div className="card__header">
            <h2>Judge calibration</h2>
            <Sigma aria-hidden="true" className="muted" size={18} />
          </div>
          <div className="card__body">
            {calibrationEntries.length === 0 ? (
              <p className="muted caption">No calibration pairs are available.</p>
            ) : (
              <ul className="calibration-list">
                {calibrationEntries.map(([name, metric]) => (
                  <li key={name}>
                    <span>{formatLabel(name)}</span>
                    <strong>
                      {metric.value === null ? "Unavailable" : metric.value.toFixed(2)}
                    </strong>
                    <small>{metric.sampleSize} pairs</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        <Card className="scorecard-note">
          <Gauge aria-hidden="true" size={22} />
          <div>
            <strong>Human control remains the outcome</strong>
            <p>
              These metrics characterize drafts and evidence quality. They do not authorize
              automatic publication or override deterministic safety blocks.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
