import { describe, expect, it } from "vitest";
import {
  configuredSlackIngestionRetryMode,
  slackIngestionRetryEnabled,
} from "@/server/integrations/slack-incoming-retry-mode";

describe("Slack ingestion retry rollout", () => {
  it("stays off until production migration rollout is explicitly activated", () => {
    expect(configuredSlackIngestionRetryMode({})).toBe("off");
    expect(slackIngestionRetryEnabled({ SLACK_INGESTION_RETRY_MODE: "off" })).toBe(false);
    expect(slackIngestionRetryEnabled({ SLACK_INGESTION_RETRY_MODE: "enforce" })).toBe(true);
  });

  it("rejects unknown rollout values instead of silently changing behavior", () => {
    expect(() => configuredSlackIngestionRetryMode({ SLACK_INGESTION_RETRY_MODE: "enabled" })).toThrow(
      "SLACK_INGESTION_RETRY_MODE must be either 'off' or 'enforce'",
    );
  });
});
