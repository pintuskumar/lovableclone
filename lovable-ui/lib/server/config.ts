const parseIntOr = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (!value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

export const IS_PROD = process.env.NODE_ENV === "production";

export const APP_URL = process.env.APP_URL || "";

const explicitRequireAuth = parseBoolean(process.env.REQUIRE_AUTH_FOR_GENERATION);

export const REQUIRE_AUTH_FOR_GENERATION = explicitRequireAuth ?? IS_PROD;

export const MAX_PROMPT_LENGTH = parseIntOr(
  process.env.MAX_PROMPT_LENGTH,
  4000,
);

export const RATE_LIMIT_WINDOW_MS = parseIntOr(
  process.env.RATE_LIMIT_WINDOW_MS,
  60_000,
);

export const RATE_LIMIT_GENERATE = parseIntOr(
  process.env.RATE_LIMIT_GENERATE,
  5,
);

export const RATE_LIMIT_GENERATE_DAYTONA = parseIntOr(
  process.env.RATE_LIMIT_GENERATE_DAYTONA,
  2,
);

export const RATE_LIMIT_SANDBOX_EDIT = parseIntOr(
  process.env.RATE_LIMIT_SANDBOX_EDIT,
  4,
);

export const RATE_LIMIT_AUTH = parseIntOr(process.env.RATE_LIMIT_AUTH, 10);
