export type SlackIngestionRetryMode = "off" | "enforce";

type Environment = Record<string, string | undefined>;

export function configuredSlackIngestionRetryMode(
  environment: Environment = process.env,
): SlackIngestionRetryMode {
  const raw = environment.SLACK_INGESTION_RETRY_MODE?.trim().toLowerCase();
  if (!raw || raw === "off") return "off";
  if (raw === "enforce") return "enforce";
  throw new Error("SLACK_INGESTION_RETRY_MODE must be either 'off' or 'enforce'");
}

export function slackIngestionRetryEnabled(
  environment: Environment = process.env,
): boolean {
  return configuredSlackIngestionRetryMode(environment) === "enforce";
}
