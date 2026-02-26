import { Button } from "@/components/ui/button";
import Link from "next/link";

const confirmUrl = "/account/update-primary-location?nftoken=test-token";

export default function Home() {
  return (
    <div className="mx-auto mt-20 max-w-xl text-center space-y-6">
      <h1 className="mb-2 text-2xl font-semibold">Auto Flixer Mock App</h1>
      <p>Open the mock Netflix confirmation flow route for local testing.</p>
      <div>
        <pre className="text-sm bg-zinc-800 text-zinc-100 p-4 rounded-md whitespace-pre-wrap">
          <code>http://127.0.0.1:3000{confirmUrl}</code>
        </pre>
      </div>
      <Link href={confirmUrl}>
        <Button>Open confirmation page</Button>
      </Link>
    </div>
  );
}
