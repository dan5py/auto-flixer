import PostalMime from "postal-mime";
import type { BrowserWorker } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";

const NETFLIX_SENDER_PATTERN = /^(.*\.)?netflix\.com$/i;
const NETFLIX_HOST_ALLOWLIST = /^([a-z0-9-]+\.)*netflix\.com$/i;
const CONFIRM_PATH_PREFIX = "/account/update-primary-location";
const NETFLIX_CONFIRM_SELECTOR =
  'button[data-uia="set-primary-location-action"]';
const INVALID_TOKEN_SELECTOR = 'div[data-uia="upl-invalid-token"]';
const LINK_HREF_REGEX = /href=["']([^"']+)["']/gi;
const BROWSER_TIMEOUT_MS = 5000;

export interface Env {
  BROWSER: BrowserWorker;
  FORWARD_TO: string;
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

export function extractConfirmationLinks(html: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = LINK_HREF_REGEX.exec(html)) !== null) {
    const href = match[1];
    if (href && isConfirmationUrl(href)) {
      links.push(href);
    }
  }

  LINK_HREF_REGEX.lastIndex = 0;
  return links;
}

async function clickConfirmLink(env: Env, url: string): Promise<void> {
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

    console.log(`Confirmation clicked successfully`);
  } catch (error) {
    console.error(`Error clicking confirmation link: ${error}`);
  } finally {
    await browser.close();
  }
}

async function processConfirmation(
  env: Env,
  parsed: { html?: string },
): Promise<void> {
  if (!parsed.html) {
    return;
  }

  const links = extractConfirmationLinks(parsed.html);

  if (links.length === 0) {
    console.log("No Netflix confirmation links found — skipping");
    return;
  }

  const confirmUrl = links[0]!;
  console.log(`Found confirmation link`);

  await clickConfirmLink(env, confirmUrl);
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

    ctx.waitUntil(processConfirmation(env, parsed));
  },
};
