import { Command } from "commander";

interface CliOptions {
  endpoint: string;
  from: string;
  to: string;
  headerFrom: string;
  subject: string;
  confirmUrl: string;
  invalidToken: boolean;
}

function buildRawEmail(options: CliOptions, messageId: string): string {
  const htmlBody = `<html><body><a href="${options.confirmUrl}">Yes, it's from me</a></body></html>`;
  return [
    `From: ${options.headerFrom}`,
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    htmlBody,
  ].join("\r\n");
}

function resolveConfirmUrl(options: CliOptions): string {
  if (!options.invalidToken) {
    return options.confirmUrl;
  }

  const parsed = new URL(options.confirmUrl);
  parsed.searchParams.set("invalid", "1");
  return parsed.toString();
}

async function main(): Promise<void> {
  const program = new Command()
    .name("test-local-email")
    .description("Send a sample email to wrangler local Email Worker endpoint")
    .option(
      "-e, --endpoint <url>",
      "Local email handler endpoint",
      "http://localhost:8787/cdn-cgi/handler/email",
    )
    .option(
      "-f, --from <address>",
      "Envelope sender used in URL query param",
      "info@account.netflix.com",
    )
    .option(
      "-t, --to <address>",
      "Recipient address used in URL query param and message header",
      "you@yourdomain.com",
    )
    .option(
      "--header-from <value>",
      'Raw "From" header value for MIME message',
      "Netflix <info@account.netflix.com>",
    )
    .option(
      "-s, --subject <text>",
      "Subject line for the generated test email",
      "Netflix Household verification",
    )
    .option(
      "-u, --confirm-url <url>",
      "Confirmation link included in HTML body",
      "http://127.0.0.1:3000/account/update-primary-location?nftoken=test-token",
    )
    .option(
      "--invalid-token",
      "Set invalid=1 on the confirmation URL to simulate expired token flow",
    );

  program.parse();
  const options = program.opts<CliOptions>();
  options.confirmUrl = resolveConfirmUrl(options);

  const messageId = `<auto-flixer-local-test-${Date.now()}@example.com>`;
  const rawEmail = buildRawEmail(options, messageId);

  const requestUrl = new URL(options.endpoint);
  requestUrl.searchParams.set("from", options.from);
  requestUrl.searchParams.set("to", options.to);

  console.log(`POST ${requestUrl.toString()}`);
  console.log(`Header From: ${options.headerFrom}`);
  console.log(`Confirm URL: ${options.confirmUrl}`);
  console.log(`Message-ID: ${messageId}`);

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "message/rfc822",
    },
    body: rawEmail,
  });
  const responseText = await response.text();

  if (!response.ok) {
    console.error(`Request failed (${response.status} ${response.statusText})`);
    if (responseText) {
      console.error(responseText);
    }
    process.exit(1);
  }

  console.log(`Request succeeded (${response.status} ${response.statusText})`);
  if (responseText) {
    console.log(responseText);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unexpected error: ${message}`);
  process.exit(1);
});
