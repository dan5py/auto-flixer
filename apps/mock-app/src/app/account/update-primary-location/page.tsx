import { Button } from "@/components/ui/button";

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function UpdatePrimaryLocationPage({
  searchParams,
}: PageProps) {
  const { invalid } = (await searchParams) ?? {};
  const isInvalid = invalid === "1";

  if (isInvalid) {
    return (
      <div
        className="mx-auto mt-20 max-w-xl text-center"
        data-uia="upl-invalid-token"
      >
        <h1 className="mb-3 text-3xl font-bold">
          This link is no longer valid
        </h1>
        <p className="text-muted-foreground">
          The confirmation link has expired or has already been used.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-20 max-w-xl text-center">
      <h1 className="mb-3 text-3xl font-bold">
        Is this your primary viewing location?
      </h1>
      <p className="mb-6 text-muted-foreground">
        Confirm this is where you primarily watch Netflix.
      </p>
      <form action="/account/update-primary-location/confirmed">
        <Button type="submit" data-uia="set-primary-location-action">
          Yes, this is my primary location
        </Button>
      </form>
    </div>
  );
}
