import PostalMime from "postal-mime";
import type { BrowserWorker } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";

const NETFLIX_SENDER_PATTERN = /^(.*\.)?netflix\.com$/i;
const NETFLIX_HOST_ALLOWLIST = /^([a-z0-9-]+\.)*netflix\.com$/i;
export const LOCAL_HOST_ALLOWLIST =
  /^(([a-z0-9-]+\.)*netflix\.com|127\.0\.0\.1)$/i;
const CONFIRM_PATH_PREFIX = "/account/update-primary-location";
const NETFLIX_CONFIRM_SELECTOR =
  'button[data-uia="set-primary-location-action"]';
const INVALID_TOKEN_SELECTOR = 'div[data-uia="upl-invalid-token"]';
const LINK_HREF_REGEX = /href=["']([^"']+)["']/gi;
const BROWSER_TIMEOUT_MS = 5000;

export interface Env {
  BROWSER: BrowserWorker;
  FORWARD_TO: string;
  /**
   * The environment the Worker is running in.
   * @default "production"
   */
  ENVIRONMENT: "local" | "production";
}

interface IncomingEmail {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export function isAllowedSender(from: string): boolean {
  const domain = from.split("@").pop();
  return domain !== undefined && NETFLIX_SENDER_PATTERN.test(domain);
}

export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return NETFLIX_HOST_ALLOWLIST.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function isConfirmationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      NETFLIX_HOST_ALLOWLIST.test(parsed.hostname) &&
      parsed.pathname.startsWith(CONFIRM_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}

export function extractConfirmationLinks(
  html: string,
  hostPattern: RegExp = NETFLIX_HOST_ALLOWLIST,
): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = LINK_HREF_REGEX.exec(html)) !== null) {
    const href = match[1];
    if (href) {
      try {
        const parsed = new URL(href);
        if (
          hostPattern.test(parsed.hostname) &&
          parsed.pathname.startsWith(CONFIRM_PATH_PREFIX)
        ) {
          links.push(href);
        }
      } catch {
        /* skip invalid URLs */
      }
    }
  }

  LINK_HREF_REGEX.lastIndex = 0;
  return links;
}

export function getElapsedSecondsSinceEmailDate(
  emailDateHeader: string | null,
  nowMs: number,
): number | null {
  if (!emailDateHeader) {
    return null;
  }

  const emailDateMs = Date.parse(emailDateHeader);
  if (Number.isNaN(emailDateMs)) {
    return null;
  }

  return Math.max(0, (nowMs - emailDateMs) / 1000);
}

async function clickConfirmLink(
  env: Env,
  url: string,
  emailDateHeader: string | null,
): Promise<void> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUT_MS,
    });

    const invalidToken = await page.$(INVALID_TOKEN_SELECTOR);
    if (invalidToken) {
      console.log(`Token is invalid or expired — skipping`);
      return;
    }

    await page.waitForSelector(NETFLIX_CONFIRM_SELECTOR, {
      timeout: BROWSER_TIMEOUT_MS,
    });
    await page.click(NETFLIX_CONFIRM_SELECTOR);

    const elapsedSeconds = getElapsedSecondsSinceEmailDate(
      emailDateHeader,
      Date.now(),
    );
    console.log(
      `✅ Confirmation clicked successfully${
        elapsedSeconds !== null ? ` (took ${elapsedSeconds.toFixed(1)}s)` : ""
      }`,
    );
  } catch (error) {
    console.error(`Error clicking confirmation link: ${error}`);
  } finally {
    await browser.close();
  }
}

function hostAllowlistForEnv(env: Env): RegExp {
  if (env.ENVIRONMENT === "local") {
    return LOCAL_HOST_ALLOWLIST;
  }

  return NETFLIX_HOST_ALLOWLIST;
}

async function processConfirmation(
  env: Env,
  parsed: { html?: string },
  emailDateHeader: string | null,
): Promise<void> {
  if (!parsed.html) {
    return;
  }

  const links = extractConfirmationLinks(parsed.html, hostAllowlistForEnv(env));

  if (links.length === 0) {
    console.log("No Netflix confirmation links found — skipping");
    return;
  }

  const confirmUrl = links[0]!;
  console.log(`Found confirmation link`);

  await clickConfirmLink(env, confirmUrl, emailDateHeader);
}

export default {
  async email(
    message: IncomingEmail,
    env: Env,
    ctx: WorkerExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(message.forward(env.FORWARD_TO));

    const parsed = await PostalMime.parse(message.raw);
    const headerFrom = parsed.from?.address ?? "";

    if (!isAllowedSender(headerFrom)) {
      return;
    }

    const emailDateHeader = message.headers.get("Date");
    ctx.waitUntil(processConfirmation(env, parsed, emailDateHeader));
  },
};
