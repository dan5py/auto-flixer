import PostalMime, { addressParser } from "postal-mime";
import type { Browser, BrowserWorker } from "@cloudflare/puppeteer";
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
const CONFIRM_TIMEOUT_MS = 10_000;

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

export function parseHeaderAddress(header: string | null): string {
  if (!header) {
    return "";
  }
  const [first] = addressParser(header, { flatten: true });
  return first?.address ?? "";
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

function launchBrowser(env: Env): Promise<Browser> {
  const browser = puppeteer.launch(env.BROWSER);
  // Avoid an unhandled rejection if the launch fails before it is awaited.
  browser.catch(() => {});
  return browser;
}

async function closeBrowser(browser: Promise<Browser>): Promise<void> {
  try {
    await (await browser).close();
  } catch {
    /* launch failed or already closed */
  }
}

async function clickConfirmLink(
  browserPromise: Promise<Browser>,
  url: string,
  emailDateHeader: string | null,
): Promise<void> {
  try {
    const browser = await browserPromise;
    const page = await browser.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUT_MS,
    });

    const element = await page.waitForSelector(
      `${NETFLIX_CONFIRM_SELECTOR}, ${INVALID_TOKEN_SELECTOR}`,
      { timeout: BROWSER_TIMEOUT_MS },
    );
    if (!element) {
      throw new Error("Confirmation page did not render");
    }

    const isInvalidToken = await element.evaluate(
      (el, selector) => el.matches(selector),
      INVALID_TOKEN_SELECTOR,
    );
    if (isInvalidToken) {
      console.log(`Token is invalid or expired — skipping`);
      return;
    }

    await element.click();

    // Closing the browser before the page reacts can cut off the confirm request.
    try {
      await page.waitForSelector(NETFLIX_CONFIRM_SELECTOR, {
        hidden: true,
        timeout: CONFIRM_TIMEOUT_MS,
      });
    } catch (error) {
      throw new Error(
        `Confirm button still on the page after the click, the confirmation may not have gone through (${error})`,
      );
    }

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
    await closeBrowser(browserPromise);
  }
}

function hostAllowlistForEnv(env: Env): RegExp {
  if (env.ENVIRONMENT === "local") {
    return LOCAL_HOST_ALLOWLIST;
  }

  return NETFLIX_HOST_ALLOWLIST;
}

function findConfirmationUrl(
  env: Env,
  html: string | undefined,
): string | null {
  if (!html) {
    return null;
  }

  const [confirmUrl] = extractConfirmationLinks(html, hostAllowlistForEnv(env));
  if (!confirmUrl) {
    console.log("No Netflix confirmation links found — skipping");
    return null;
  }

  console.log(`Found confirmation link`);
  return confirmUrl;
}

export default {
  async email(
    message: IncomingEmail,
    env: Env,
    ctx: WorkerExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(message.forward(env.FORWARD_TO));

    // Start the browser while parsing. The parsed sender is still checked below.
    let earlyBrowser = isAllowedSender(
      parseHeaderAddress(message.headers.get("From")),
    )
      ? launchBrowser(env)
      : null;

    try {
      const parsed = await PostalMime.parse(message.raw);
      if (!isAllowedSender(parsed.from?.address ?? "")) {
        return;
      }

      const confirmUrl = findConfirmationUrl(env, parsed.html);
      if (!confirmUrl) {
        return;
      }

      const browser = earlyBrowser ?? launchBrowser(env);
      earlyBrowser = null;
      ctx.waitUntil(
        clickConfirmLink(browser, confirmUrl, message.headers.get("Date")),
      );
    } finally {
      if (earlyBrowser) {
        ctx.waitUntil(closeBrowser(earlyBrowser));
      }
    }
  },
};
