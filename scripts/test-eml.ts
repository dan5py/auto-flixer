import PostalMime from "postal-mime";
import { isAllowedSender, extractConfirmationLinks } from "../src/index";

const path = process.argv[2];
if (!path) {
  console.error("Usage: bun scripts/test-eml.ts <path-to-file.eml>");
  process.exit(1);
}

const raw = await Bun.file(path).text();
const parsed = await PostalMime.parse(raw);

console.log("--- Email Metadata ---");
console.log(`From:    ${parsed.from?.address ?? "(none)"}`);
console.log(
  `To:      ${parsed.to?.map((a) => a.address).join(", ") ?? "(none)"}`,
);
console.log(`Subject: ${parsed.subject ?? "(none)"}`);
console.log(`Date:    ${parsed.date ?? "(none)"}`);
console.log();

const sender = parsed.from?.address ?? "";
const senderAllowed = isAllowedSender(sender);
console.log(`--- Sender Check ---`);
console.log(`Sender "${sender}" is Netflix: ${senderAllowed}`);
console.log();

if (!senderAllowed) {
  console.log(
    "Not a Netflix email — would only forward, no confirmation attempted.",
  );
  process.exit(0);
}

console.log("--- HTML Body ---");
if (!parsed.html) {
  console.log("(no HTML body)");
  process.exit(0);
}
console.log(`${parsed.html.length} characters`);
console.log();

const links = extractConfirmationLinks(parsed.html);
console.log("--- Confirmation Links ---");
if (links.length === 0) {
  console.log("No confirmation links found.");
} else {
  for (const link of links) {
    console.log(link);
  }
}
